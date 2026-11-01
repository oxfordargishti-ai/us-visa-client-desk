import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { EventMove, moveEvent } from "@/lib/repo/calendar";
import { scheduleGoogleSync } from "@/lib/svc";

export const PATCH = handler<typeof EventMove, { id: string }>({ schema: EventMove }, async ({ user, params, body }) => {
  const r = await withUser(user.id, (q) => moveEvent(q, user.id, zId.parse(params.id), body));
  scheduleGoogleSync(user.id);
  return r;
});
