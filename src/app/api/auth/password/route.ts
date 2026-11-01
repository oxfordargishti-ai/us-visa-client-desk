import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { destroyOtherSessions, hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth";
import { currentSessionToken } from "@/lib/session";
import { withSystem } from "@/lib/db";
import { logActivity } from "@/lib/audit";

export const POST = handler(
  { schema: z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }) },
  async ({ user, body, ip }) => {
    const problem = passwordPolicyError(body.next, user.email);
    if (problem) throw new HttpError(400, problem, "weak_password");
    await withSystem(async (q) => {
      const [row] = await q.query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id=$1", [user.id]);
      if (!(await verifyPassword(body.current, row?.password_hash ?? null))) throw new HttpError(403, "Your current password is incorrect.", "wrong_password");
      await q.query("UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1", [user.id, await hashPassword(body.next)]);
      await logActivity(q, { userId: user.id, entityType: "auth", action: "auth.password_changed", summary: "Password changed", ip });
    });
    await destroyOtherSessions(user.id, await currentSessionToken());
    return { ok: true };
  },
);
