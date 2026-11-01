import { NextResponse, type NextRequest } from "next/server";
import { capabilities, env } from "@/lib/env";
import { startOAuth } from "@/lib/oauth";
import { SCOPES } from "@/lib/google";

// Optional "Sign in with Google" — only for people who already have an account in this desk (no self sign-up).
export async function GET(_req: NextRequest) {
  if (!capabilities().googleLogin) return NextResponse.redirect(new URL("/login?error=google_off", env.appUrl));
  return startOAuth({ purpose: "login", scopes: SCOPES.identity, redirectUri: `${env.appUrl}/api/auth/google/callback`, offline: false });
}
