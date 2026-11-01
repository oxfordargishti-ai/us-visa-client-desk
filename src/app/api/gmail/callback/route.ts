import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { readOAuthCallback, redirectTo } from "@/lib/oauth";
import { SCOPES, decodeIdToken, exchangeCode, refreshUnreadCount, saveConnection } from "@/lib/google";
import { withSystem, withUser } from "@/lib/db";
import { logActivity } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return redirectTo("/login");
  const cb = readOAuthCallback(req);
  const back = (q: string) => redirectTo(`${cb.ok && cb.state.purpose === "calendar" ? "/settings" : "/gmail"}?${q}`);
  if (!cb.ok) return redirectTo(`/gmail?error=${cb.reason}`);
  if (cb.state.uid !== user.id) return redirectTo("/gmail?error=invalid_state");
  try {
    const t = await exchangeCode(cb.code, `${env.appUrl}/api/gmail/callback`);
    const granted = (t.scope ?? "").split(" ");
    const email = t.id_token ? decodeIdToken(t.id_token).email : "";
    const existing = await withSystem((q) => q.query<{ refresh_token_enc: string }>("SELECT refresh_token_enc FROM gmail_connections WHERE user_id=$1", [user.id]));
    if (!t.refresh_token && !existing.length) return back("error=no_refresh_token");
    if (cb.state.purpose === "gmail" && !granted.includes(SCOPES.gmail)) return back("error=scope_missing");
    if (cb.state.purpose === "calendar" && !granted.includes(SCOPES.calendar)) return back("error=scope_missing");
    await withUser(user.id, async (q) => {
      if (t.refresh_token) await saveConnection(q, user.id, { googleEmail: email || "unknown", refreshToken: t.refresh_token, scopes: granted });
      if (cb.state.purpose === "calendar") await q.query("UPDATE gmail_connections SET calendar_sync_enabled=true, updated_at=now() WHERE user_id=$1", [user.id]);
      await logActivity(q, { userId: user.id, entityType: "google", action: cb.state.purpose === "calendar" ? "google.calendar_connected" : "google.gmail_connected", summary: cb.state.purpose === "calendar" ? "Google Calendar connected" : "Gmail connected (read-only)" });
    });
    if (cb.state.purpose === "gmail") await refreshUnreadCount(user.id).catch(() => undefined);
    return back("connected=1");
  } catch {
    return back("error=exchange_failed");
  }
}
