import { z } from "zod";
import { one, type Q } from "../db";
import { APPLICATION_STATUSES, DEFAULT_PREP_CHECKLIST, DOCS_STATUSES, INTERVIEW_OUTCOMES, PREP_STATUSES } from "../constants";
import type { CaseRow, InterviewRow } from "../types";
import { HttpError, notFound, zId, zIso } from "../errors";
import { logActivity } from "../audit";
import { completeTask, createTask, deleteTask, syncCalendarEvent, getTask, updateTask } from "./tasks";
import { recomputeDocsStatus } from "./clients";
import { getPrefs } from "./prefs";

const optText = (max: number) => z.string().trim().max(max).nullish();

export const InterviewInput = z.object({
  client_id: zId,
  case_id: zId.nullish(),
  visa_category: optText(80),
  embassy: optText(160),
  interview_at: zIso,
  prep_status: z.enum(PREP_STATUSES).optional(),
  notes: z.string().max(5000).nullish(),
  reminder_offsets: z.array(z.number().int().min(0).max(129_600)).max(10).optional(),
});

export const InterviewPatch = z.object({
  visa_category: optText(80),
  embassy: optText(160),
  interview_at: zIso.optional(),
  prep_status: z.enum(PREP_STATUSES).optional(),
  docs_status: z.enum(DOCS_STATUSES).optional(),
  outcome: z.enum(INTERVIEW_OUTCOMES).optional(),
  notes: z.string().max(5000).nullish(),
  checklist: z.array(z.object({ id: z.string().max(64), label: z.string().trim().min(1).max(200), done: z.boolean() })).max(40).optional(),
});

const SELECT = `i.*, c.full_name AS client_name, c.phone AS client_phone, c.whatsapp AS client_whatsapp`;

export async function getInterview(q: Q, userId: string, id: string) {
  return one<InterviewRow>(
    q,
    `SELECT ${SELECT} FROM interviews i JOIN clients c ON c.id = i.client_id WHERE i.id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL`,
    [id, userId],
  );
}

export async function createInterview(q: Q, userId: string, input: z.infer<typeof InterviewInput>, now = new Date()) {
  const client = await one<{ id: string; full_name: string }>(q, "SELECT id, full_name FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [input.client_id, userId]);
  if (!client) throw new HttpError(400, "Choose an existing client for this interview.", "bad_client");
  let kase: CaseRow | null = null;
  if (input.case_id) kase = await one<CaseRow>(q, "SELECT * FROM client_cases WHERE id=$1 AND client_id=$2 AND user_id=$3 AND deleted_at IS NULL", [input.case_id, client.id, userId]);
  else kase = await one<CaseRow>(q, "SELECT * FROM client_cases WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY (application_status = 'Case Closed'), opened_at DESC LIMIT 1", [client.id, userId]);
  if (input.case_id && !kase) throw new HttpError(400, "That case does not belong to this client.", "bad_case");

  const prefs = await getPrefs(q, userId);
  const embassy = input.embassy ?? kase?.embassy ?? null;
  const visa = input.visa_category ?? kase?.visa_category ?? null;
  const { task } = await createTask(
    q, userId,
    {
      title: `Visa Interview — ${client.full_name}`,
      description: embassy ? `Interview at ${embassy}` : null,
      category: "Visa Interview", priority: "High", client_id: client.id, case_id: kase?.id ?? null,
      due_at: input.interview_at, duration_minutes: 90,
      reminder_offsets: input.reminder_offsets ?? prefs.default_interview_reminders,
      custom_reminders: [], source: "manual",
    },
    now,
  );
  await q.query("UPDATE calendar_events SET location=$2 WHERE task_id=$1", [task.id, embassy]);

  const checklist = DEFAULT_PREP_CHECKLIST.map((label, i) => ({ id: `c${i + 1}`, label, done: false }));
  const [row] = await q.query<InterviewRow>(
    `INSERT INTO interviews (user_id, client_id, case_id, task_id, visa_category, embassy, interview_at, prep_status, notes, prep_checklist)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
    [userId, client.id, kase?.id ?? null, task.id, visa, embassy, new Date(input.interview_at).toISOString(), input.prep_status ?? "Not Started", input.notes ?? null, JSON.stringify(checklist)],
  );
  if (kase) {
    const idx = (s: string) => APPLICATION_STATUSES.indexOf(s as never);
    const advance = idx(kase.application_status) < idx("Interview Scheduled");
    await q.query(
      `UPDATE client_cases SET application_status = CASE WHEN $3 THEN 'Interview Scheduled' ELSE application_status END,
              embassy = COALESCE(embassy, $4), updated_at = now() WHERE id=$1 AND user_id=$2`,
      [kase.id, userId, advance, embassy],
    );
    await recomputeDocsStatus(q, userId, kase.id);
  }
  await logActivity(q, { userId, clientId: client.id, entityType: "interview", entityId: row.id, action: "interview.created", summary: `Interview scheduled for ${client.full_name}`, metadata: { at: input.interview_at } });
  return (await getInterview(q, userId, row.id))!;
}

export async function updateInterview(q: Q, userId: string, id: string, patch: z.infer<typeof InterviewPatch>, now = new Date()) {
  const existing = await getInterview(q, userId, id);
  if (!existing) throw notFound("Interview not found");

  if (patch.interview_at && new Date(patch.interview_at).toISOString() !== existing.interview_at && existing.task_id) {
    // Reuses the task reschedule path: old pending reminders are canceled and a new schedule is saved.
    await updateTask(q, userId, existing.task_id, { due_at: patch.interview_at }, now);
  }
  const m = { ...existing, ...patch };
  await q.query(
    `UPDATE interviews SET visa_category=$3, embassy=$4, interview_at=COALESCE($5::timestamptz, interview_at), prep_status=$6, docs_status=$7,
            outcome=$8, notes=$9, prep_checklist=$10::jsonb, updated_at=now() WHERE id=$1 AND user_id=$2`,
    [
      id, userId, m.visa_category ?? null, m.embassy ?? null, patch.interview_at ? new Date(patch.interview_at).toISOString() : null,
      m.prep_status, m.docs_status, m.outcome, m.notes ?? null, JSON.stringify(patch.checklist ?? existing.prep_checklist),
    ],
  );
  if (patch.embassy !== undefined && existing.task_id) await q.query("UPDATE calendar_events SET location=$2, google_dirty=true, updated_at=now() WHERE task_id=$1", [existing.task_id, patch.embassy ?? null]);

  if (existing.case_id) {
    if (patch.prep_status) await q.query("UPDATE client_cases SET interview_prep_status=$3, updated_at=now() WHERE id=$1 AND user_id=$2", [existing.case_id, userId, patch.prep_status]);
    if (patch.outcome && patch.outcome !== "Pending") {
      const idx = (s: string) => APPLICATION_STATUSES.indexOf(s as never);
      await q.query(
        `UPDATE client_cases SET application_status = CASE WHEN $3 THEN 'Interview Completed' ELSE application_status END, updated_at=now() WHERE id=$1 AND user_id=$2`,
        [existing.case_id, userId, (await one<{ application_status: string }>(q, "SELECT application_status FROM client_cases WHERE id=$1", [existing.case_id]).then((r) => (r ? idx(r.application_status) < idx("Interview Completed") : false)))],
      );
    }
  }
  // An interview with a recorded outcome is "done": close the linked task so it stops showing as overdue.
  if (patch.outcome && !["Pending", "Rescheduled"].includes(patch.outcome) && existing.task_id) {
    const t = await getTask(q, userId, existing.task_id);
    if (t && t.status === "pending") await completeTask(q, userId, existing.task_id, now);
  }
  await logActivity(q, { userId, clientId: existing.client_id, entityType: "interview", entityId: id, action: patch.outcome ? "interview.outcome" : "interview.updated", summary: patch.outcome ? `Interview outcome: ${patch.outcome}` : "Interview details updated" });
  return (await getInterview(q, userId, id))!;
}

export async function deleteInterview(q: Q, userId: string, id: string) {
  const existing = await getInterview(q, userId, id);
  if (!existing) throw notFound("Interview not found");
  await q.query("UPDATE interviews SET deleted_at=now() WHERE id=$1 AND user_id=$2", [id, userId]);
  if (existing.task_id) await deleteTask(q, userId, existing.task_id);
  await logActivity(q, { userId, clientId: existing.client_id, entityType: "interview", entityId: id, action: "interview.deleted", summary: "Interview removed" });
}

export const InterviewListQuery = z.object({
  scope: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  client_id: zId.optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});

export async function listInterviews(q: Q, userId: string, f: z.infer<typeof InterviewListQuery>): Promise<InterviewRow[]> {
  const where = ["i.user_id=$1", "i.deleted_at IS NULL"];
  const params: unknown[] = [userId];
  if (f.client_id) where.push(`i.client_id=$${params.push(f.client_id)}`);
  if (f.scope === "upcoming") where.push("i.interview_at >= now() - interval '2 hours' AND i.outcome = 'Pending'");
  if (f.scope === "past") where.push("(i.interview_at < now() - interval '2 hours' OR i.outcome <> 'Pending')");
  return q.query<InterviewRow>(
    `SELECT ${SELECT} FROM interviews i JOIN clients c ON c.id=i.client_id WHERE ${where.join(" AND ")}
      ORDER BY i.interview_at ${f.scope === "past" ? "DESC" : "ASC"} LIMIT ${f.limit}`,
    params,
  );
}
