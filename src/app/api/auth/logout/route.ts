import { handler } from "@/lib/api";
import { destroySession } from "@/lib/auth";
import { clearSessionCookie, currentSessionToken } from "@/lib/session";

export const POST = handler({ auth: "none" }, async () => {
  await destroySession(await currentSessionToken());
  await clearSessionCookie();
  return { ok: true };
});
