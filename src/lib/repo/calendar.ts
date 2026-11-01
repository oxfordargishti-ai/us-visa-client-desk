import { z } from "zod";
import { one, type Q } from "../db";
import { TASK_CATEGORIES } from "../constants";
import type { CalendarEventRow } from "../types";
import { notFound, zId, zIso } from "../errors";
import { updateTask } from "./tasks";

export const EventRangeQuery = z.object({
  start: zIso,
  end: zIso,
  category: z.enum(TASK_CATEGORIES).optional(),
  client_id: zId.optional(),
  interviews_only: z.enum(["true", "false"]).optional(),
});

export async function listEvents(q: Q, userId: string, f: z.infer<typeof EventRangeQuery>): Promise<CalendarEventRow[]> {
  const params: unknown[] = [userId, new Date(f.start).toISOString(), new Date(f.end).toISOString()];
  const where = ["e.user_id = $1", "e.deleted_at IS NULL", "e.starts_at < $3", "e.ends_at > $2"];
  if (f.category) where.push(`e.category = $${params.push(f.category)}`);
  if (f.client_id) where.push(`e.client_id = $${params.push(f.client_id)}`);
  if (f.interviews_only === "true") where.push("EXISTS (SELECT 1 FROM interviews i WHERE i.task_id = e.task_id AND i.deleted_at IS NULL)");
  return q.query<CalendarEventRow>(
    `SELECT e.id, e.task_id, e.client_id, e.title, e.category, e.starts_at, e.ends_at, e.location,
            t.status AS task_status, t.priority, c.full_name AS client_name,
            EXISTS (SELECT 1 FROM interviews i WHERE i.task_id = e.task_id AND i.deleted_at IS NULL) AS is_interview
       FROM calendar_events e
       JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
       LEFT JOIN clients c ON c.id = e.client_id
      WHERE ${where.join(" AND ")} ORDER BY e.starts_at LIMIT 1000`,
    params,
  );
}

export const EventMove = z.object({ starts_at: zIso, ends_at: zIso.optional() });

/** Drag-and-drop / resize from the calendar. The task is the source of truth, so reminders follow automatically. */
export async function moveEvent(q: Q, userId: string, eventId: string, move: z.infer<typeof EventMove>) {
  const ev = await one<{ task_id: string; starts_at: string; ends_at: string }>(q, "SELECT task_id, starts_at, ends_at FROM calendar_events WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [eventId, userId]);
  if (!ev) throw notFound("Event not found");
  const start = new Date(move.starts_at);
  const durationMin = move.ends_at
    ? Math.max(5, Math.round((new Date(move.ends_at).getTime() - start.getTime()) / 60_000))
    : Math.max(5, Math.round((new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60_000));
  return updateTask(q, userId, ev.task_id, { due_at: start.toISOString(), duration_minutes: Math.min(durationMin, 1440) });
}
