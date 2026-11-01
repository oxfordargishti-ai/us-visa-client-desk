import { z } from "zod";
import { one, type Q } from "../db";
import { PRIORITIES, RECURRENCES, TASK_CATEGORIES, TASK_SOURCES } from "../constants";
import type { Task, Reminder } from "../types";
import { HttpError, notFound, zId, zIso } from "../errors";
import { logActivity } from "../audit";
import { DEFAULT_TZ, dayBoundsUtc, nextOccurrence, planReminders } from "../time";
import { getPrefs } from "./prefs";
import { DateTime } from "luxon";

export const TaskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  description: z.string().max(5000).nullish(),
  category: z.enum(TASK_CATEGORIES).default("Administrative Work"),
  priority: z.enum(PRIORITIES).default("Normal"),
  client_id: zId.nullish(),
  case_id: zId.nullish(),
  due_at: zIso.nullish(),
  duration_minutes: z.number().int().min(5).max(1440).default(30),
  recurrence: z.enum(RECURRENCES).nullish(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  reminder_offsets: z.array(z.number().int().min(0).max(129_600)).max(10).optional(),
  custom_reminders: z.array(zIso).max(5).default([]),
  source: z.enum(TASK_SOURCES).default("manual"),
  source_ref: z.string().max(200).nullish(),
  ai_original_text: z.string().max(2000).nullish(),
});
export type TaskInputT = z.infer<typeof TaskInput>;

export const TaskPatch = TaskInput.partial().omit({ source: true, source_ref: true, ai_original_text: true });
export type TaskPatchT = z.infer<typeof TaskPatch>;

const TASK_SELECT = `t.*, c.full_name AS client_name, c.phone AS client_phone, c.whatsapp AS client_whatsapp`;

export async function getTask(q: Q, userId: string, id: string): Promise<Task | null> {
  return one<Task>(
    q,
    `SELECT ${TASK_SELECT} FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
    [id, userId],
  );
}

export async function assertClientOwned(q: Q, userId: string, clientId: string | null | undefined) {
  if (!clientId) return;
  const c = await one(q, "SELECT 1 AS x FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [clientId, userId]);
  if (!c) throw new HttpError(400, "That client does not exist.", "bad_client");
}

// ───────────── calendar events ─────────────
export async function syncCalendarEvent(q: Q, userId: string, task: Task, extra: { location?: string | null } = {}) {
  const live = task.due_at && !task.deleted_at && task.status !== "cancelled";
  if (!live) {
    await q.query(
      `UPDATE calendar_events SET deleted_at = now(), google_dirty = (google_event_id IS NOT NULL), updated_at = now()
        WHERE task_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [task.id, userId],
    );
    return;
  }
  const ends = DateTime.fromISO(task.due_at!, { zone: "utc" }).plus({ minutes: task.duration_minutes }).toUTC().toISO()!;
  await q.query(
    `INSERT INTO calendar_events (user_id, task_id, client_id, title, category, starts_at, ends_at, location, google_dirty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
     ON CONFLICT (task_id) DO UPDATE SET
       client_id = EXCLUDED.client_id, title = EXCLUDED.title, category = EXCLUDED.category,
       starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
       location = COALESCE($8, calendar_events.location),
       deleted_at = NULL, google_dirty = true, updated_at = now()`,
    [userId, task.id, task.client_id, task.title, task.category, task.due_at, ends, extra.location ?? null],
  );
}

// ───────────── reminders ─────────────
async function cancelPendingReminders(q: Q, taskId: string, kinds?: string[]) {
  await q.query(
    `UPDATE task_reminders SET status = 'canceled', updated_at = now()
      WHERE task_id = $1 AND status = 'pending' AND ($2::text[] IS NULL OR kind = ANY($2::text[]))`,
    [taskId, kinds ?? null],
  );
}

/** Cancels the old offset-based reminders and creates a fresh schedule from the task's chosen offsets. */
export async function rebuildReminders(q: Q, userId: string, task: Task, now = new Date()): Promise<{ created: Reminder[]; skipped: { label: string; remind_at: string }[] }> {
  await cancelPendingReminders(q, task.id, ["scheduled"]);
  const created: Reminder[] = [];
  const skipped: { label: string; remind_at: string }[] = [];
  if (!task.due_at || task.status !== "pending") return { created, skipped };
  for (const r of planReminders(task.due_at, task.reminder_offsets, now)) {
    if (r.in_past) {
      skipped.push({ label: r.label, remind_at: r.remind_at });
      continue;
    }
    const rows = await q.query<Reminder>(
      `INSERT INTO task_reminders (user_id, task_id, remind_at, offset_minutes, kind)
       VALUES ($1,$2,$3,$4,'scheduled')
       ON CONFLICT (task_id, remind_at, kind) WHERE status IN ('pending','processing') DO NOTHING
       RETURNING *`,
      [userId, task.id, r.remind_at, r.offset_minutes],
    );
    created.push(...rows);
  }
  return { created, skipped };
}

async function addCustomReminders(q: Q, userId: string, taskId: string, times: string[], now = new Date()) {
  for (const t of times) {
    const iso = new Date(t).toISOString();
    if (new Date(iso).getTime() <= now.getTime()) continue;
    await q.query(
      `INSERT INTO task_reminders (user_id, task_id, remind_at, offset_minutes, kind) VALUES ($1,$2,$3,NULL,'custom')
       ON CONFLICT (task_id, remind_at, kind) WHERE status IN ('pending','processing') DO NOTHING`,
      [userId, taskId, iso],
    );
  }
}

export async function listReminders(q: Q, userId: string, taskId: string): Promise<Reminder[]> {
  return q.query<Reminder>("SELECT * FROM task_reminders WHERE task_id = $1 AND user_id = $2 ORDER BY remind_at", [taskId, userId]);
}

// ───────────── create / update ─────────────
export async function createTask(q: Q, userId: string, input: TaskInputT, now = new Date()) {
  if (input.recurrence && !input.due_at) throw new HttpError(400, "Recurring tasks need a date and time.", "bad_request");
  await assertClientOwned(q, userId, input.client_id);
  const prefs = await getPrefs(q, userId);
  const due = input.due_at ? new Date(input.due_at).toISOString() : null;
  const offsets = due ? [...new Set(input.reminder_offsets ?? prefs.default_task_reminders)].sort((a, b) => a - b) : [];
  const seriesId = input.recurrence ? crypto.randomUUID() : null;
  const [task] = await q.query<Task>(
    `INSERT INTO tasks (user_id, client_id, case_id, title, description, category, priority, due_at, duration_minutes,
                        recurrence, recurrence_until, series_id, reminder_offsets, source, source_ref, ai_original_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      userId, input.client_id ?? null, input.case_id ?? null, input.title, input.description ?? null, input.category, input.priority, due,
      input.duration_minutes, input.recurrence ?? null, input.recurrence_until ?? null, seriesId, offsets, input.source, input.source_ref ?? null,
      input.ai_original_text ?? null,
    ],
  );
  await syncCalendarEvent(q, userId, task);
  const { created, skipped } = await rebuildReminders(q, userId, task, now);
  await addCustomReminders(q, userId, task.id, input.custom_reminders, now);
  await logActivity(q, { userId, clientId: task.client_id, entityType: "task", entityId: task.id, action: "task.created", summary: `Task created: ${task.title}`, metadata: { source: input.source } });
  return { task: (await getTask(q, userId, task.id))!, reminders: created, skipped_reminders: skipped };
}

export async function updateTask(q: Q, userId: string, id: string, patch: TaskPatchT, now = new Date()) {
  const existing = await getTask(q, userId, id);
  if (!existing) throw notFound("Task not found");
  if (patch.client_id !== undefined) await assertClientOwned(q, userId, patch.client_id);

  const next = { ...existing, ...patch } as Task & TaskPatchT;
  const due = patch.due_at === undefined ? existing.due_at : patch.due_at ? new Date(patch.due_at).toISOString() : null;
  const recurrence = patch.recurrence === undefined ? existing.recurrence : patch.recurrence ?? null;
  if (recurrence && !due) throw new HttpError(400, "Recurring tasks need a date and time.", "bad_request");
  const offsets = patch.reminder_offsets ? [...new Set(patch.reminder_offsets)].sort((a, b) => a - b) : existing.reminder_offsets;

  const [updated] = await q.query<Task>(
    `UPDATE tasks SET title=$3, description=$4, category=$5, priority=$6, client_id=$7, case_id=$8, due_at=$9, duration_minutes=$10,
                      recurrence=$11, recurrence_until=$12, reminder_offsets=$13, updated_at=now(),
                      series_id = CASE WHEN $11::text IS NOT NULL AND series_id IS NULL THEN gen_random_uuid() ELSE series_id END
      WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING *`,
    [
      id, userId, next.title, next.description ?? null, next.category, next.priority, next.client_id ?? null, next.case_id ?? null, due,
      next.duration_minutes, recurrence, patch.recurrence_until === undefined ? existing.recurrence_until : patch.recurrence_until ?? null, offsets,
    ],
  );
  await syncCalendarEvent(q, userId, updated);
  // Keep the interview record (if this task is an interview) on the same instant as the task.
  if (due && existing.due_at !== due) await q.query("UPDATE interviews SET interview_at=$2, updated_at=now() WHERE task_id=$1 AND deleted_at IS NULL", [id, due]);

  const timeChanged = (existing.due_at ?? null) !== (due ?? null) || JSON.stringify(existing.reminder_offsets) !== JSON.stringify(offsets);
  let reminderResult = { created: [] as Reminder[], skipped: [] as { label: string; remind_at: string }[] };
  if (timeChanged) {
    // Old pending reminders are canceled and the schedule is rebuilt from the new time. Reminders that were already sent stay as history.
    reminderResult = await rebuildReminders(q, userId, updated, now);
  }
  if (patch.custom_reminders?.length) await addCustomReminders(q, userId, id, patch.custom_reminders, now);

  await logActivity(q, {
    userId, clientId: updated.client_id, entityType: "task", entityId: id,
    action: timeChanged ? "task.rescheduled" : "task.updated", summary: `${timeChanged ? "Task rescheduled" : "Task updated"}: ${updated.title}`,
    metadata: timeChanged ? { from: existing.due_at, to: updated.due_at } : {},
  });
  return { task: (await getTask(q, userId, id))!, reminders: reminderResult.created, skipped_reminders: reminderResult.skipped };
}

export async function deleteTask(q: Q, userId: string, id: string) {
  const existing = await getTask(q, userId, id);
  if (!existing) throw notFound("Task not found");
  await q.query("UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2", [id, userId]);
  await cancelPendingReminders(q, id);
  await syncCalendarEvent(q, userId, { ...existing, deleted_at: new Date().toISOString() });
  await logActivity(q, { userId, clientId: existing.client_id, entityType: "task", entityId: id, action: "task.deleted", summary: `Task deleted: ${existing.title}` });
}

// ───────────── complete / reopen / snooze ─────────────
export async function completeTask(q: Q, userId: string, id: string, now = new Date()) {
  const t = await getTask(q, userId, id);
  if (!t) throw notFound("Task not found");
  if (t.status === "completed") return { task: t, next: null as Task | null };
  const [done] = await q.query<Task>(
    "UPDATE tasks SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId],
  );
  await cancelPendingReminders(q, id);
  await syncCalendarEvent(q, userId, done);

  let next: Task | null = null;
  if (t.recurrence && t.due_at) {
    const prefs = await getPrefs(q, userId);
    let nextDue = nextOccurrence(t.due_at, t.recurrence, prefs.timezone);
    // If the task was completed very late, skip forward so the next one is in the future.
    let guard = 0;
    while (new Date(nextDue).getTime() <= now.getTime() && guard++ < 400) nextDue = nextOccurrence(nextDue, t.recurrence, prefs.timezone);
    const untilOk = !t.recurrence_until || DateTime.fromISO(nextDue, { zone: "utc" }).setZone(prefs.timezone).toFormat("yyyy-MM-dd") <= t.recurrence_until;
    if (untilOk) {
      const created = await createTask(
        q, userId,
        {
          title: t.title, description: t.description, category: t.category, priority: t.priority, client_id: t.client_id, case_id: t.case_id,
          due_at: nextDue, duration_minutes: t.duration_minutes, recurrence: t.recurrence, recurrence_until: t.recurrence_until,
          reminder_offsets: t.reminder_offsets, custom_reminders: [], source: t.source, source_ref: t.source_ref, ai_original_text: null,
        },
        now,
      );
      await q.query("UPDATE tasks SET series_id = $2 WHERE id = $1", [created.task.id, t.series_id]);
      next = (await getTask(q, userId, created.task.id))!;
    }
  }
  await logActivity(q, { userId, clientId: t.client_id, entityType: "task", entityId: id, action: "task.completed", summary: `Task completed: ${t.title}` });
  return { task: (await getTask(q, userId, id))!, next };
}

export async function reopenTask(q: Q, userId: string, id: string, now = new Date()) {
  const [row] = await q.query<Task>("SELECT * FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!row) throw notFound("Task not found");
  const [t] = await q.query<Task>("UPDATE tasks SET status='pending', completed_at=NULL, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId]);
  // Undo the auto-generated next occurrence of a recurring task if the owner hasn't touched it.
  if (row.recurrence && row.series_id) {
    const dueOfNext = row.due_at ? nextOccurrence(row.due_at, row.recurrence, (await getPrefs(q, userId)).timezone) : null;
    const dup = await q.query<{ id: string }>(
      `SELECT id FROM tasks WHERE user_id=$1 AND series_id=$2 AND id <> $3 AND status='pending' AND deleted_at IS NULL
          AND created_at > now() - interval '15 minutes' AND ($4::timestamptz IS NULL OR due_at >= $4::timestamptz)`,
      [userId, row.series_id, id, dueOfNext],
    );
    for (const d of dup) await deleteTask(q, userId, d.id);
  }
  await syncCalendarEvent(q, userId, t);
  await rebuildReminders(q, userId, t, now);
  await logActivity(q, { userId, clientId: t.client_id, entityType: "task", entityId: id, action: "task.reopened", summary: `Task reopened: ${t.title}` });
  return (await getTask(q, userId, id))!;
}

/** Creates a one-off reminder N minutes from now for a task (used by "Snooze" buttons and notification actions). */
export async function snoozeTask(q: Q, userId: string, taskId: string, minutes: number, now = new Date()) {
  const t = await getTask(q, userId, taskId);
  if (!t) throw notFound("Task not found");
  if (t.status !== "pending") throw new HttpError(409, "This task is already completed.", "conflict");
  const at = new Date(now.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  const [r] = await q.query<Reminder>(
    `INSERT INTO task_reminders (user_id, task_id, remind_at, offset_minutes, kind) VALUES ($1,$2,$3,NULL,'snooze')
     ON CONFLICT (task_id, remind_at, kind) WHERE status IN ('pending','processing') DO UPDATE SET updated_at = now()
     RETURNING *`,
    [userId, taskId, at.toISOString()],
  );
  await logActivity(q, { userId, clientId: t.client_id, entityType: "task", entityId: taskId, action: "task.snoozed", summary: `Reminder snoozed ${minutes} min: ${t.title}` });
  return r;
}

// ───────────── listing ─────────────
export const TaskListQuery = z.object({
  view: z.enum(["today", "upcoming", "overdue", "completed", "all"]).default("all"),
  client_id: zId.optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function listTasks(q: Q, userId: string, f: z.infer<typeof TaskListQuery>, tz = DEFAULT_TZ, now = new Date()): Promise<Task[]> {
  const where: string[] = ["t.user_id = $1", "t.deleted_at IS NULL"];
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const day = dayBoundsUtc(tz, now);
  let order = "t.due_at ASC NULLS LAST, t.created_at DESC";
  switch (f.view) {
    case "today":
      where.push(`((t.status = 'pending' AND t.due_at < ${p(day.end)}) OR (t.status = 'completed' AND t.completed_at >= ${p(day.start)} AND t.completed_at <= ${p(day.end)}))`);
      order = "(t.status = 'completed') ASC, t.due_at ASC NULLS LAST";
      break;
    case "overdue":
      where.push(`t.status = 'pending' AND t.due_at < ${p(now.toISOString())}`);
      break;
    case "upcoming":
      where.push(`t.status = 'pending' AND t.due_at >= ${p(now.toISOString())}`);
      break;
    case "completed":
      where.push("t.status = 'completed'");
      order = "t.completed_at DESC NULLS LAST";
      break;
    case "all":
      where.push("t.status = 'pending'");
      break;
  }
  if (f.client_id) where.push(`t.client_id = ${p(f.client_id)}`);
  if (f.category) where.push(`t.category = ${p(f.category)}`);
  if (f.q) where.push(`(t.title ILIKE ${p(`%${f.q.replace(/[%_]/g, "\\$&")}%`)} OR t.description ILIKE $${params.length})`);
  return q.query<Task>(
    `SELECT ${TASK_SELECT} FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${f.limit}`,
    params,
  );
}
