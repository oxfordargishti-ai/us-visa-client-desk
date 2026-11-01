import { NextResponse, type NextRequest } from "next/server";
import { randomToken, signPayload, verifyPayload } from "./crypto";
import { buildAuthUrl } from "./google";
import { env } from "./env";

const COOKIE = "uva_oauth";

export interface OAuthState {
  purpose: "login" | "gmail" | "calendar";
  uid?: string;
  nonce: string;
}

/** Redirects to Google. The signed `state` AND a matching httpOnly cookie must both come back — this blocks CSRF / login-fixation. */
export function startOAuth(opts: { purpose: OAuthState["purpose"]; uid?: string; scopes: string[]; redirectUri: string; loginHint?: string; offline?: boolean }) {
  const nonce = randomToken(18);
  const state = signPayload({ purpose: opts.purpose, uid: opts.uid, nonce }, 600);
  const res = NextResponse.redirect(buildAuthUrl({ redirectUri: opts.redirectUri, scopes: opts.scopes, state, loginHint: opts.loginHint, offline: opts.offline }));
  res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api", maxAge: 600 });
  return res;
}

export function readOAuthCallback(req: NextRequest): { ok: true; state: OAuthState; code: string } | { ok: false; reason: string } {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return { ok: false, reason: url.searchParams.get("error") === "access_denied" ? "cancelled" : "google_error" };
  const code = url.searchParams.get("code");
  const state = verifyPayload<OAuthState>(url.searchParams.get("state") || "");
  const nonce = req.cookies.get(COOKIE)?.value;
  if (!code || !state || !nonce || state.nonce !== nonce) return { ok: false, reason: "invalid_state" };
  return { ok: true, state, code };
}

export function redirectTo(path: string) {
  const res = NextResponse.redirect(new URL(path, env.appUrl));
  res.cookies.set(COOKIE, "", { path: "/api", maxAge: 0 });
  return res;
}
