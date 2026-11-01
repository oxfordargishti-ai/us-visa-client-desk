import { z } from "zod";
import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { capabilities } from "@/lib/env";
import type { NotificationRow } from "@/lib/types";

const Query = z.object({ channel: z.enum(["inapp", "all"]).default("inapp"), limit: z.coerce.number().int().min(1).max(200).default(60) });

export const GET = handler({ schema: Query }, async ({ user, body }) =>
  withUser(user.id, async (q) => {
    const rows = await q.query<NotificationRow>(
      `SELECT id, channel, status, title, body, url, priority, error, sent_at, read_at, created_at FROM notification_deliveries
        WHERE user_id=$1 ${body.channel === "inapp" ? "AND channel='inapp'" : ""} ORDER BY created_at DESC LIMIT ${body.limit}`,
      [user.id],
    );
    const [{ n }] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM notification_deliveries WHERE user_id=$1 AND channel='inapp' AND read_at IS NULL", [user.id]);
    const devices = await q.query<{ id: string; device_label: string | null; user_agent: string | null; status: string; last_success_at: string | null; last_error: string | null; created_at: string }>(
      "SELECT id, device_label, user_agent, status, last_success_at, last_error, created_at FROM push_subscriptions WHERE user_id=$1 AND status <> 'revoked' ORDER BY created_at DESC", [user.id]);
    const upcoming = await q.query<{ id: string; task_id: string; remind_at: string; status: string; title: string; last_error: string | null; attempt_count: number }>(
      `SELECT r.id, r.task_id, r.remind_at, r.status, t.title, r.last_error, r.attempt_count FROM task_reminders r JOIN tasks t ON t.id=r.task_id
        WHERE r.user_id=$1 AND r.status IN ('pending','failed') AND t.deleted_at IS NULL AND t.status='pending' ORDER BY r.remind_at LIMIT 12`, [user.id]);
    return { notifications: rows, unread: n, devices, upcoming, capabilities: capabilities() };
  }),
);
