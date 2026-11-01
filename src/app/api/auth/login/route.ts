import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { authenticate, createSession } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { withSystem } from "@/lib/db";
import { logActivity } from "@/lib/audit";

export const POST = handler(
  { auth: "none", schema: z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) }) },
  async ({ body, ip, req }) => {
    const result = await authenticate(body.email, body.password, ip);
    if (!result.ok) {
      if (result.reason === "locked") {
        throw new HttpError(429, `Too many attempts. Try again in ${result.minutes} minute${result.minutes === 1 ? "" : "s"}.`, "locked");
      }
      throw new HttpError(401, "Incorrect email or password.", "invalid_credentials");
    }
    const { token, expiresAt } = await createSession(result.user.id, { ip, userAgent: req.headers.get("user-agent") });
    await setSessionCookie(token, expiresAt);
    await withSystem((q) => logActivity(q, { userId: result.user.id, entityType: "auth", action: "auth.login", summary: "Signed in", ip }));
    return { ok: true, user: { name: result.user.name, email: result.user.email } };
  },
);
