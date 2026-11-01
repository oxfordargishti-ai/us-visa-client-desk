import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { SCOPES, syncDirtyEvents } from "@/lib/google";
import { getPrefs } from "@/lib/repo/prefs";

const Body = z.object({ enabled: z.boolean().optional(), sync_now: z.boolean().optional(), mark_all_dirty: z.boolean().optional() });

export const POST = handler({ schema: Body }, async ({ user, body }) => {
  const tz = await withUser(user.id, async (q) => {
    const [c] = await q.query<{ scopes: string[] }>("SELECT scopes FROM gmail_connections WHERE user_id=$1", [user.id]);
    if (!c || !c.scopes.includes(SCOPES.calendar)) throw new HttpError(409, "Connect Google Calendar first.", "calendar_not_connected");
    if (body.enabled !== undefined) await q.query("UPDATE gmail_connections SET calendar_sync_enabled=$2, updated_at=now() WHERE user_id=$1", [user.id, body.enabled]);
    if (body.enabled || body.mark_all_dirty) await q.query("UPDATE calendar_events SET google_dirty=true WHERE user_id=$1 AND deleted_at IS NULL AND starts_at > now() - interval '1 day'", [user.id]);
    return (await getPrefs(q, user.id)).timezone;
  });
  if (body.sync_now || body.enabled) return syncDirtyEvents(user.id, tz, 100);
  return { ok: true };
});
