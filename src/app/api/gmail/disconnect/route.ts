import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { disconnect } from "@/lib/google";
import { logActivity } from "@/lib/audit";

export const POST = handler({}, async ({ user }) => {
  await withUser(user.id, async (q) => {
    await disconnect(q, user.id);
    await logActivity(q, { userId: user.id, entityType: "google", action: "google.disconnected", summary: "Google disconnected — stored tokens deleted" });
  });
  return { ok: true };
});
