import crypto from "node:crypto";
import { promisify } from "node:util";
import { withSystem, type Q } from "./db";
import { sha256, randomToken } from "./crypto";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export const SESSION_COOKIE = "uva_session";
export const SESSION_TTL_DAYS = 30;
export const SESSION_IDLE_DAYS = 14;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
}

export function passwordPolicyError(password: string, email?: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (email && password.toLowerCase() === email.toLowerCase()) return "Password must not be your email address.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Include at least one letter and one number.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always burn the same CPU time, even for unknown users, to avoid revealing which emails exist.
  const parts = (stored || "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64")).split("$");
  if (parts[0] !== "scrypt" || parts.length !== 6) return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
  return Boolean(stored) && crypto.timingSafeEqual(actual, expected);
}

// ── Brute-force protection (stored in the DB so it works on serverless) ──
const MAX_FAILURES = 5;
const WINDOW_MIN = 15;
const LOCK_MIN = 15;

export async function loginLockedFor(q: Q, key: string): Promise<number> {
  const [row] = await q.query<{ locked_until: string | null }>("SELECT locked_until FROM auth_attempts WHERE key = $1", [key]);
  if (!row?.locked_until) return 0;
  const ms = new Date(row.locked_until).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export async function recordLoginFailure(q: Q, key: string) {
  await q.query(
    `INSERT INTO auth_attempts (key, attempts, window_started_at) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN auth_attempts.window_started_at < now() - ($2 || ' minutes')::interval THEN 1 ELSE auth_attempts.attempts + 1 END,
       window_started_at = CASE WHEN auth_attempts.window_started_at < now() - ($2 || ' minutes')::interval THEN now() ELSE auth_attempts.window_started_at END,
       locked_until = CASE WHEN (CASE WHEN auth_attempts.window_started_at < now() - ($2 || ' minutes')::interval THEN 1 ELSE auth_attempts.attempts + 1 END) >= $3
                           THEN now() + ($4 || ' minutes')::interval ELSE auth_attempts.locked_until END`,
    [key, String(WINDOW_MIN), MAX_FAILURES, String(LOCK_MIN)],
  );
}

export async function clearLoginFailures(q: Q, key: string) {
  await q.query("DELETE FROM auth_attempts WHERE key = $1", [key]);
}

// ── Sessions ──
export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await withSystem((q) =>
    q.query("INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)", [
      sha256(token), userId, expiresAt.toISOString(), meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300),
    ]),
  );
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20) return null;
  return withSystem(async (q) => {
    const [row] = await q.query<SessionUser & { last_seen_at: string }>(
      `SELECT u.id, u.email, u.name, u.role, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [sha256(token)],
    );
    if (!row) return null;
    const idleMs = Date.now() - new Date(row.last_seen_at).getTime();
    if (idleMs > SESSION_IDLE_DAYS * 86_400_000) {
      await q.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
      return null;
    }
    if (idleMs > 5 * 60_000) await q.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sha256(token)]);
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  });
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await withSystem((q) => q.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]));
}

export async function destroyOtherSessions(userId: string, keepToken?: string) {
  await withSystem((q) => q.query("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)", [userId, keepToken ? sha256(keepToken) : null]));
}

export async function purgeExpiredSessions() {
  await withSystem((q) => q.query("DELETE FROM sessions WHERE expires_at < now()"));
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" | "locked"; minutes?: number };

/** Email + password sign-in with lockout. Never reveals whether the email exists. */
export async function authenticate(email: string, password: string, ip: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const keyUser = `login:${normalized}:${ip}`;
  const keyIp = `login-ip:${ip}`;
  return withSystem(async (q) => {
    const locked = Math.max(await loginLockedFor(q, keyUser), await loginLockedFor(q, keyIp));
    if (locked) return { ok: false, reason: "locked", minutes: locked } as const;
    const [u] = await q.query<SessionUser & { password_hash: string | null }>(
      "SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = $1 AND deleted_at IS NULL",
      [normalized],
    );
    const good = await verifyPassword(password, u?.password_hash ?? null);
    if (!u || !good) {
      await recordLoginFailure(q, keyUser);
      await recordLoginFailure(q, keyIp);
      return { ok: false, reason: "invalid" } as const;
    }
    await clearLoginFailures(q, keyUser);
    await q.query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
    return { ok: true, user: { id: u.id, email: u.email, name: u.name, role: u.role } } as const;
  });
}

export async function createUser(input: { email: string; name: string; password?: string; role?: "owner" | "staff"; googleSub?: string }) {
  const hash = input.password ? await hashPassword(input.password) : null;
  return withSystem(async (q) => {
    const [u] = await q.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash, role, google_sub) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [input.email.trim().toLowerCase(), input.name, hash, input.role ?? "owner", input.googleSub ?? null],
    );
    await q.query("INSERT INTO user_preferences (user_id, notification_email) VALUES ($1, $2)", [u.id, input.email.trim().toLowerCase()]);
    return u.id;
  });
}
