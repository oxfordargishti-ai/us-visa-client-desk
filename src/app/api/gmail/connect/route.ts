import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { startOAuth } from "@/lib/oauth";
import { SCOPES, googleConfigured } from "@/lib/google";

/** Starts Google's consent screen. Read-only Gmail access only (gmail.readonly) — this app can never send, delete or change mail. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/gmail?error=not_configured", env.appUrl));
  const purpose = new URL(req.url).searchParams.get("for") === "calendar" ? "calendar" : "gmail";
  const scopes = purpose === "calendar" ? [SCOPES.calendar, ...SCOPES.identity] : [SCOPES.gmail, ...SCOPES.identity];
  return startOAuth({ purpose, uid: user.id, scopes, redirectUri: `${env.appUrl}/api/gmail/callback`, loginHint: process.env.GMAIL_ACCOUNT || "info@usvisawithargishti.com" });
}
