import { withSystem, withUser } from "./db";
import { purgeExpiredSessions } from "./auth";
import { purgeExpiredDocuments } from "./repo/documents";
import { dispatchDueReminders, type DispatchResult } from "./notifications";
import { refreshUnreadCount, syncDirtyEvents } from "./google";

export interface CronResult extends DispatchResult {
  documentsPurged: number;
  calendarSynced: number;
  errors: string[];
}

/** One tick of the scheduler: send due reminders, then tidy up. Safe to call as often as every minute and from several places at once. */
export async function runCron(): Promise<CronResult> {
  const errors: string[] = [];
  const dispatch = await dispatchDueReminders();
  // Heartbeat so Settings can warn if the scheduler was never wired up (or stopped).
  await withSystem((q) => q.query(
    `INSERT INTO system_state (key, value) VALUES ('cron:last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [new Date().toISOString()],
  )).catch((e) => errors.push(`heartbeat: ${(e as Error).message}`));
  let documentsPurged = 0;
  let calendarSynced = 0;

  try {
    await purgeExpiredSessions();
    await withSystem((q) => q.query("DELETE FROM auth_attempts WHERE window_started_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())"));
    await withSystem((q) => q.query("DELETE FROM notification_deliveries WHERE created_at < now() - interval '120 days'"));
  } catch (e) {
    errors.push(`cleanup: ${(e as Error).message}`);
  }

  // Per-user work: Google Calendar outbox, unread count, document retention.
  const users = await withSystem((q) => q.query<{ id: string; timezone: string; retention: number | null; google: boolean; sync: boolean }>(
    `SELECT u.id, COALESCE(p.timezone,'Asia/Yerevan') AS timezone, p.document_retention_days AS retention,
            (g.user_id IS NOT NULL) AS google, COALESCE(g.calendar_sync_enabled,false) AS sync
       FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id LEFT JOIN gmail_connections g ON g.user_id=u.id WHERE u.deleted_at IS NULL`));
  for (const u of users) {
    try {
      if (u.sync) calendarSynced += (await syncDirtyEvents(u.id, u.timezone)).synced;
      if (u.google && new Date().getMinutes() % 10 === 0) await refreshUnreadCount(u.id).catch(() => undefined);
      if (u.retention && new Date().getHours() === 3) documentsPurged += await withUser(u.id, (q) => purgeExpiredDocuments(q, u.id, u.retention));
    } catch (e) {
      errors.push(`user ${u.id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  return { ...dispatch, documentsPurged, calendarSynced, errors };
}
