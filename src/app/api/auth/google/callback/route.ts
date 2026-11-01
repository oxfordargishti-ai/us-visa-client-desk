import type { NextRequest } from "next/server";
import { capabilities, env } from "@/lib/env";
import { readOAuthCallback, redirectTo } from "@/lib/oauth";
import { decodeIdToken, exchangeCode } from "@/lib/google";
import { createSession } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { withSystem } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { clientIp } from "@/lib/api";

export async function GET(req: NextRequest) {
  if (!capabilities().googleLogin) return redirectTo("/login?error=google_off");
  const cb = readOAuthCallback(req);
  if (!cb.ok || cb.state.purpose !== "login") return redirectTo("/login?error=google_failed");
  try {
    const tokens = await exchangeCode(cb.code, `${env.appUrl}/api/auth/google/callback`);
    if (!tokens.id_token) return redirectTo("/login?error=google_failed");
    const id = decodeIdToken(tokens.id_token);
    if (!id.email || id.email_verified === false) return redirectTo("/login?error=google_failed");
    const user = await withSystem(async (q) => {
      const [u] = await q.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=$1 AND deleted_at IS NULL", [id.email.toLowerCase()]);
      if (!u) return null;
      await q.query("UPDATE users SET google_sub=COALESCE(google_sub,$2), last_login_at=now() WHERE id=$1", [u.id, id.sub]);
      await logActivity(q, { userId: u.id, entityType: "auth", action: "auth.login_google", summary: "Signed in with Google", ip: clientIp(req) });
      return u;
    });
    if (!user) return redirectTo("/login?error=not_authorized");
    const { token, expiresAt } = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    await setSessionCookie(token, expiresAt);
    return redirectTo("/dashboard");
  } catch {
    return redirectTo("/login?error=google_failed");
  }
}
