import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_DAYS, getSessionUser, type SessionUser } from "./auth";
import { env } from "./env";

/** Reads the signed-in user for the current request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return getSessionUser(jar.get(SESSION_COOKIE)?.value);
});

/** For server components / pages: redirects to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expires: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    expires,
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The signed-in user's preferences, loaded once per request and shared by the layout and the page. */
export const getCurrentPrefs = cache(async () => {
  const user = await requireUser();
  const { withUser, readAsUser } = await import("./db");
  const { getPrefs } = await import("./repo/prefs");
  const [row] = await readAsUser<import("./types").Prefs>(user.id, "SELECT * FROM user_preferences WHERE user_id = $1", [user.id]);
  return row ?? withUser(user.id, (q) => getPrefs(q, user.id)); // first visit: create the defaults
});
