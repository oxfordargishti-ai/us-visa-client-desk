import { after } from "next/server";
import { withSystem } from "./db";
import { syncDirtyEvents } from "./google";

/** After any change to tasks/events, push dirty events to Google Calendar (when connected) once the response has been sent. */
export function scheduleGoogleSync(userId: string) {
  try {
    after(async () => {
      try {
        const [p] = await withSystem((q) => q.query<{ timezone: string }>("SELECT timezone FROM user_preferences WHERE user_id=$1", [userId]));
        await syncDirtyEvents(userId, p?.timezone ?? "Asia/Yerevan");
      } catch (e) {
        console.error("[google-sync] failed:", (e as Error).message);
      }
    });
  } catch {
    /* outside a request scope (tests / scripts): the cron dispatcher will pick the dirty events up */
  }
}
