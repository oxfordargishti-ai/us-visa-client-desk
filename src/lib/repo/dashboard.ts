import type { Q } from "../db";
import { dayBoundsUtc } from "../time";
import type { Task, InterviewRow } from "../types";
import { DateTime } from "luxon";

export interface DashboardData {
  now: string;
  tz: string;
  next_task: Task | null;
  today: Task[];
  overdue: Task[];
  upcoming_interviews: InterviewRow[];
  pending_applications: { total: number; items: { client_id: string; full_name: string; visa_category: string; application_status: string }[] };
  awaiting_documents: { client_id: string; full_name: string; missing: number; case_id: string }[];
  needs_follow_up: { client_id: string; full_name: string; days_since: number; application_status: string }[];
  important_deadlines: Task[];
  recently_completed: Task[];
  weekly: { date: string; label: string; completed: number; due: number }[];
  weekly_rate: number;
  unread_gmail: number | null;
}

const TASK = `t.*, c.full_name AS client_name, c.phone AS client_phone, c.whatsapp AS client_whatsapp`;

export async function getDashboard(q: Q, userId: string, tz: string, now = new Date()): Promise<DashboardData> {
  const day = dayBoundsUtc(tz, now);
  const nowIso = now.toISOString();
  const weekStart = DateTime.fromJSDate(now).setZone(tz).startOf("day").minus({ days: 6 });
  const weekStartIso = weekStart.toUTC().toISO()!;

  const [today, overdue, interviews, pending, awaiting, followUp, deadlines, recent, completedByDay, dueByDay, gmail] = await Promise.all([
    q.query<Task>(
      `SELECT ${TASK} FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
        WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='pending' AND t.due_at >= $2 AND t.due_at <= $3
        ORDER BY t.due_at`, [userId, nowIso, day.end]),
    q.query<Task>(
      `SELECT ${TASK} FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
        WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='pending' AND t.due_at < $2
        ORDER BY t.due_at LIMIT 50`, [userId, nowIso]),
    q.query<InterviewRow>(
      `SELECT i.*, c.full_name AS client_name, c.phone AS client_phone, c.whatsapp AS client_whatsapp
         FROM interviews i JOIN clients c ON c.id=i.client_id
        WHERE i.user_id=$1 AND i.deleted_at IS NULL AND i.outcome='Pending' AND i.interview_at >= $2 AND i.interview_at <= $3
        ORDER BY i.interview_at`, [userId, nowIso, new Date(now.getTime() + 7 * 86_400_000).toISOString()]),
    q.query<{ client_id: string; full_name: string; visa_category: string; application_status: string }>(
      `SELECT c.id AS client_id, c.full_name, k.visa_category, k.application_status
         FROM client_cases k JOIN clients c ON c.id=k.client_id
        WHERE k.user_id=$1 AND k.deleted_at IS NULL AND c.deleted_at IS NULL AND k.application_status NOT IN ('Visa Issued','Visa Refused','Case Closed')
        ORDER BY k.updated_at DESC LIMIT 100`, [userId]),
    q.query<{ client_id: string; full_name: string; missing: number; case_id: string }>(
      `SELECT c.id AS client_id, c.full_name, k.id AS case_id,
              (SELECT count(*)::int FROM document_checklists d WHERE d.case_id=k.id AND d.required AND d.status='missing') AS missing
         FROM client_cases k JOIN clients c ON c.id=k.client_id
        WHERE k.user_id=$1 AND k.deleted_at IS NULL AND c.deleted_at IS NULL AND k.application_status NOT IN ('Visa Issued','Visa Refused','Case Closed')
          AND (k.application_status = 'Documents Pending' OR EXISTS (SELECT 1 FROM document_checklists d WHERE d.case_id=k.id AND d.required AND d.status='missing'))
        ORDER BY missing DESC, c.full_name LIMIT 30`, [userId]),
    q.query<{ client_id: string; full_name: string; days_since: number; application_status: string }>(
      `SELECT c.id AS client_id, c.full_name, k.application_status,
              GREATEST(0, floor(extract(epoch FROM ($2::timestamptz - GREATEST(
                (SELECT max(n.created_at) FROM notes n WHERE n.client_id=c.id AND n.deleted_at IS NULL),
                (SELECT max(t.completed_at) FROM tasks t WHERE t.client_id=c.id),
                c.created_at))) / 86400))::int AS days_since
         FROM client_cases k JOIN clients c ON c.id=k.client_id
        WHERE k.user_id=$1 AND k.deleted_at IS NULL AND c.deleted_at IS NULL AND k.application_status NOT IN ('Visa Issued','Visa Refused','Case Closed')
          AND GREATEST(
                (SELECT max(n.created_at) FROM notes n WHERE n.client_id=c.id AND n.deleted_at IS NULL),
                (SELECT max(t.completed_at) FROM tasks t WHERE t.client_id=c.id),
                c.created_at) < $2::timestamptz - interval '7 days'
        ORDER BY days_since DESC LIMIT 20`, [userId, nowIso]),
    q.query<Task>(
      `SELECT ${TASK} FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
        WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='pending' AND t.due_at >= $2 AND t.due_at <= $3
          AND (t.priority IN ('High','Urgent') OR t.category IN ('Visa Interview','Embassy Appointment','Urgent Task'))
        ORDER BY t.due_at LIMIT 8`, [userId, nowIso, new Date(now.getTime() + 14 * 86_400_000).toISOString()]),
    q.query<Task>(
      `SELECT ${TASK} FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
        WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='completed' ORDER BY t.completed_at DESC LIMIT 5`, [userId]),
    q.query<{ completed_at: string }>(
      "SELECT completed_at FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND status='completed' AND completed_at >= $2", [userId, weekStartIso]),
    q.query<{ due_at: string; status: string }>(
      "SELECT due_at, status FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND status IN ('pending','completed') AND due_at >= $2 AND due_at <= $3", [userId, weekStartIso, day.end]),
    q.query<{ unread_cache: number | null }>("SELECT unread_cache FROM gmail_connections WHERE user_id=$1", [userId]),
  ]);

  const weekly = Array.from({ length: 7 }, (_, i) => {
    const d = weekStart.plus({ days: i });
    return { date: d.toFormat("yyyy-MM-dd"), label: d.toFormat("ccc"), completed: 0, due: 0 };
  });
  const bucket = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
  for (const c of completedByDay) {
    const b = weekly.find((w) => w.date === bucket(c.completed_at));
    if (b) b.completed++;
  }
  for (const t of dueByDay) {
    const b = weekly.find((w) => w.date === bucket(t.due_at));
    if (b) b.due++;
  }
  const completed = weekly.reduce((n, w) => n + w.completed, 0);
  const due = weekly.reduce((n, w) => n + Math.max(w.due, 0), 0);

  const nextTask = [...overdue, ...today][0] ?? (await q.query<Task>(
    `SELECT ${TASK} FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
      WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='pending' AND t.due_at >= $2 ORDER BY t.due_at LIMIT 1`, [userId, day.end]))[0] ?? null;

  return {
    now: nowIso,
    tz,
    next_task: nextTask,
    today,
    overdue,
    upcoming_interviews: interviews,
    pending_applications: { total: pending.length, items: pending.slice(0, 6) },
    awaiting_documents: awaiting,
    needs_follow_up: followUp,
    important_deadlines: deadlines,
    recently_completed: recent,
    weekly,
    weekly_rate: due > 0 ? Math.min(100, Math.round((completed / Math.max(due, completed)) * 100)) : completed > 0 ? 100 : 0,
    unread_gmail: gmail[0]?.unread_cache ?? null,
  };
}
