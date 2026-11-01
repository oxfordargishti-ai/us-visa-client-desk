import { one, withSystem, type Q } from "./db";
import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { HttpError } from "./errors";

// Google OAuth 2.0 + Gmail (read-only) + Calendar (optional, events only). Talks to Google over plain HTTPS.
// Tokens are stored encrypted on the server and are NEVER sent to the browser.

export const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  identity: ["openid", "email", "profile"],
};
// Endpoints can be redirected to a local stand-in for automated tests (GOOGLE_TEST_ORIGIN). Leave unset in production.
const TEST = process.env.GOOGLE_TEST_ORIGIN?.replace(/\/$/, "");
const AUTH_URL = TEST ? `${TEST}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = TEST ? `${TEST}/token` : "https://oauth2.googleapis.com/token";
const GMAIL = TEST ? `${TEST}/gmail/v1/users/me` : "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = TEST ? `${TEST}/calendar/v3` : "https://www.googleapis.com/calendar/v3";

export const googleConfigured = () => Boolean(env.googleClientId && env.googleClientSecret);

export function buildAuthUrl(opts: { redirectUri: string; scopes: string[]; state: string; loginHint?: string; offline?: boolean }) {
  const offline = opts.offline ?? true;
  const p = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
  });
  if (offline) {
    p.set("access_type", "offline"); // gives us a refresh token so reading mail works while you are away
    p.set("include_granted_scopes", "true");
    p.set("prompt", "consent");
  } else {
    p.set("prompt", "select_account");
  }
  if (opts.loginHint) p.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    const err = new HttpError(res.status === 400 ? 401 : 502, json.error === "invalid_grant" ? "Google access has expired or was revoked. Please reconnect Gmail." : "Google rejected the request.", json.error === "invalid_grant" ? "google_reconnect" : "google_error");
    throw err;
  }
  return json;
}

export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

/** Decodes the (already Google-signed, received over TLS directly from Google) id_token payload. */
export function decodeIdToken(idToken: string): { sub: string; email: string; email_verified?: boolean; name?: string } {
  const payload = idToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

const accessCache = new Map<string, { token: string; exp: number }>();

export async function getAccessToken(userId: string): Promise<string> {
  const hit = accessCache.get(userId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const conn = await withSystem((q) => one<{ refresh_token_enc: string }>(q, "SELECT refresh_token_enc FROM gmail_connections WHERE user_id=$1", [userId]));
  if (!conn) throw new HttpError(409, "Gmail is not connected yet.", "gmail_not_connected");
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(conn.refresh_token_enc) });
    accessCache.set(userId, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof HttpError && e.code === "google_reconnect") {
      await withSystem((q) => q.query("UPDATE gmail_connections SET last_error='Access was revoked or expired — reconnect Gmail', updated_at=now() WHERE user_id=$1", [userId]));
    }
    throw e;
  }
}

type GoogleErrorBody = { error?: { message?: string; status?: string; details?: { reason?: string; metadata?: { service?: string } }[]; errors?: { reason?: string }[] } };

/** Turns Google's 403 into a plain-language next step. Google uses 403 for several different problems. */
export function explainGoogle403(body: GoogleErrorBody): { code: string; message: string } {
  const e = body.error ?? {};
  const reasons = [...(e.details ?? []).map((d) => d.reason), ...(e.errors ?? []).map((d) => d.reason)].filter(Boolean) as string[];
  const msg = e.message ?? "";
  if (reasons.some((r) => /SERVICE_DISABLED|accessNotConfigured/i.test(r)) || /has not been used in project|is disabled/i.test(msg)) {
    const api = /calendar/i.test(msg + JSON.stringify(e.details ?? [])) ? "Google Calendar API" : "Gmail API";
    return { code: "google_api_disabled", message: `The ${api} is not turned on in your Google Cloud project. Open console.cloud.google.com → APIs & Services → Library, enable the ${api}, wait 2–3 minutes and try again.` };
  }
  if (reasons.some((r) => /SCOPE_INSUFFICIENT|insufficientPermissions/i.test(r))) {
    return { code: "google_scope", message: "Google says this permission was not granted. Disconnect, connect again and tick every box on the consent screen." };
  }
  if (/admin|domain policy|organization/i.test(msg)) {
    return { code: "google_admin_blocked", message: "Your Google Workspace admin settings are blocking this app. In admin.google.com → Security → API controls, allow the app, then connect again." };
  }
  return { code: "google_forbidden", message: `Google refused the request: ${msg.slice(0, 200) || "permission denied"}` };
}

async function gfetch<T>(userId: string, url: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(userId);
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & GoogleErrorBody;
  if (!res.ok) {
    if (res.status === 401) accessCache.delete(userId);
    if (res.status === 403) {
      const why = explainGoogle403(json);
      throw new HttpError(403, why.message, why.code);
    }
    throw new HttpError(res.status === 404 ? 404 : 502, res.status === 404 ? "Not found in Google." : `Google API error (${res.status}).`, "google_error", { status: res.status });
  }
  return json;
}

export async function saveConnection(q: Q, userId: string, p: { googleEmail: string; refreshToken: string; scopes: string[] }) {
  const [existing] = await q.query<{ scopes: string[] }>("SELECT scopes FROM gmail_connections WHERE user_id=$1", [userId]);
  const merged = [...new Set([...(existing?.scopes ?? []), ...p.scopes])];
  await q.query(
    `INSERT INTO gmail_connections (user_id, google_email, refresh_token_enc, scopes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET google_email=EXCLUDED.google_email, refresh_token_enc=EXCLUDED.refresh_token_enc,
       scopes=$4, last_error=NULL, updated_at=now()`,
    [userId, p.googleEmail, encrypt(p.refreshToken), merged],
  );
  accessCache.delete(userId);
}

export async function getConnection(q: Q, userId: string) {
  return one<{ google_email: string; scopes: string[]; calendar_sync_enabled: boolean; calendar_id: string; last_error: string | null; connected_at: string; unread_cache: number | null }>(
    q, "SELECT google_email, scopes, calendar_sync_enabled, calendar_id, last_error, connected_at, unread_cache FROM gmail_connections WHERE user_id=$1", [userId]);
}

export async function disconnect(q: Q, userId: string) {
  const row = await one<{ refresh_token_enc: string }>(q, "SELECT refresh_token_enc FROM gmail_connections WHERE user_id=$1", [userId]);
  if (row) {
    // Best effort: also revoke the grant at Google so the app truly loses access.
    try {
      await fetch(TEST ? `${TEST}/revoke` : "https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decrypt(row.refresh_token_enc) }) });
    } catch {
      /* ignore */
    }
  }
  await q.query("DELETE FROM gmail_connections WHERE user_id=$1", [userId]);
  await q.query("UPDATE calendar_events SET google_event_id=NULL, google_synced_at=NULL, google_dirty=false WHERE user_id=$1", [userId]);
  accessCache.delete(userId);
}

// ───────────── Gmail ─────────────
export interface MailAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}
export interface MailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string | null;
  snippet: string;
  unread: boolean;
  body?: string;
  attachments?: MailAttachment[];
}

interface GPart { mimeType?: string; filename?: string; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GPart[]; headers?: { name: string; value: string }[] }
interface GMessage { id: string; threadId: string; snippet?: string; labelIds?: string[]; internalDate?: string; payload?: GPart }

const header = (m: GMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
export function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

function toMessage(m: GMessage): MailMessage {
  const from = parseAddress(header(m, "From"));
  return {
    id: m.id,
    threadId: m.threadId,
    from: from.email,
    fromName: from.name || from.email,
    to: header(m, "To"),
    subject: header(m, "Subject") || "(no subject)",
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    snippet: m.snippet ?? "",
    unread: (m.labelIds ?? []).includes("UNREAD"),
  };
}

function collect(part: GPart | undefined, out: { text: string[]; html: string[]; atts: Omit<MailAttachment, "messageId">[] }) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) out.atts.push({ attachmentId: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body.size ?? 0 });
  else if (part.mimeType === "text/plain" && part.body?.data) out.text.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  else if (part.mimeType === "text/html" && part.body?.data) out.html.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  for (const p of part.parts ?? []) collect(p, out);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

function toFullMessage(m: GMessage): MailMessage {
  const base = toMessage(m);
  const out = { text: [] as string[], html: [] as string[], atts: [] as Omit<MailAttachment, "messageId">[] };
  collect(m.payload, out);
  base.body = (out.text.join("\n").trim() || htmlToText(out.html.join("\n"))).slice(0, 20_000);
  base.attachments = out.atts.map((a) => ({ ...a, messageId: m.id }));
  return base;
}

async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function listInbox(userId: string, opts: { q?: string; unreadOnly?: boolean; max?: number; pageToken?: string }) {
  const parts = ["in:inbox"];
  if (opts.unreadOnly) parts.push("is:unread");
  if (opts.q) parts.push(opts.q);
  const params = new URLSearchParams({ q: parts.join(" "), maxResults: String(Math.min(opts.max ?? 25, 50)) });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const list = await gfetch<{ messages?: { id: string }[]; nextPageToken?: string }>(userId, `${GMAIL}/messages?${params}`);
  const msgs = await inChunks(list.messages ?? [], 6, (m) =>
    gfetch<GMessage>(userId, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`),
  );
  return { messages: msgs.map(toMessage), nextPageToken: list.nextPageToken ?? null };
}

export async function getThread(userId: string, threadId: string): Promise<MailMessage[]> {
  const t = await gfetch<{ messages?: GMessage[] }>(userId, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  return (t.messages ?? []).map(toFullMessage);
}

export async function getAttachment(userId: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const a = await gfetch<{ data: string }>(userId, `${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return Buffer.from(a.data, "base64url");
}

export async function refreshUnreadCount(userId: string): Promise<number> {
  const l = await gfetch<{ messagesUnread?: number }>(userId, `${GMAIL}/labels/INBOX`);
  const n = l.messagesUnread ?? 0;
  await withSystem((q) => q.query("UPDATE gmail_connections SET unread_cache=$2, unread_cached_at=now() WHERE user_id=$1", [userId, n]));
  return n;
}

const ACTION_WORDS = /\b(urgent|asap|deadline|action required|please (send|provide|confirm|reply)|documents?|passport|interview|appointment|reschedul\w*|payment|invoice|receipt|ds-?160|confirm\w*|required|reminder|visa)\b|срочно|документ\w*|собеседован\w*|оплат\w*|паспорт|վիզա|փաստաթուղթ\w*|հարցազրույց/i;
export function actionReasons(subject: string, snippet: string): string[] {
  const text = `${subject} ${snippet}`;
  const reasons = new Set<string>();
  const m = text.match(new RegExp(ACTION_WORDS.source, "gi"));
  for (const w of m ?? []) reasons.add(w.toLowerCase());
  return [...reasons].slice(0, 4);
}

// ───────────── Google Calendar (one-way: this app → Google) ─────────────
export async function syncDirtyEvents(userId: string, tz: string, limit = 25): Promise<{ synced: number; failed: number; skipped: boolean }> {
  const conn = await withSystem((q) => getConnection(q, userId));
  if (!conn || !conn.calendar_sync_enabled || !conn.scopes.includes(SCOPES.calendar)) return { synced: 0, failed: 0, skipped: true };
  const rows = await withSystem((q) =>
    q.query<{ id: string; title: string; category: string; starts_at: string; ends_at: string; location: string | null; google_event_id: string | null; deleted_at: string | null; client_name: string | null; task_status: string; task_id: string }>(
      `SELECT e.id, e.title, e.category, e.starts_at, e.ends_at, e.location, e.google_event_id, e.deleted_at, e.task_id, c.full_name AS client_name, t.status AS task_status
         FROM calendar_events e JOIN tasks t ON t.id=e.task_id LEFT JOIN clients c ON c.id=e.client_id
        WHERE e.user_id=$1 AND e.google_dirty ORDER BY e.updated_at LIMIT $2`, [userId, limit]),
  );
  let synced = 0, failed = 0;
  const cal = encodeURIComponent(conn.calendar_id || "primary");
  for (const e of rows) {
    try {
      if (e.deleted_at) {
        if (e.google_event_id) {
          try { await gfetch(userId, `${CAL}/calendars/${cal}/events/${e.google_event_id}`, { method: "DELETE" }); } catch (err) { if (!(err instanceof HttpError && err.status === 404)) throw err; }
        }
        await withSystem((q) => q.query("UPDATE calendar_events SET google_dirty=false, google_event_id=NULL, google_error=NULL WHERE id=$1", [e.id]));
        synced++;
        continue;
      }
      const body = {
        summary: `${e.task_status === "completed" ? "✓ " : ""}${e.title}`,
        description: [e.client_name ? `Client: ${e.client_name}` : null, `Category: ${e.category}`, `Open in desk: ${env.appUrl}/calendar`].filter(Boolean).join("\n"),
        location: e.location ?? undefined,
        start: { dateTime: e.starts_at, timeZone: tz },
        end: { dateTime: e.ends_at, timeZone: tz },
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: { private: { uvaTaskId: e.task_id } },
      };
      let gid = e.google_event_id;
      if (gid) {
        try { await gfetch(userId, `${CAL}/calendars/${cal}/events/${gid}`, { method: "PUT", body: JSON.stringify(body) }); }
        catch (err) { if (err instanceof HttpError && err.status === 404) gid = null; else throw err; }
      }
      if (!gid) {
        const created = await gfetch<{ id: string }>(userId, `${CAL}/calendars/${cal}/events`, { method: "POST", body: JSON.stringify(body) });
        gid = created.id;
      }
      await withSystem((q) => q.query("UPDATE calendar_events SET google_event_id=$2, google_synced_at=now(), google_dirty=false, google_error=NULL WHERE id=$1", [e.id, gid]));
      synced++;
    } catch (err) {
      failed++;
      await withSystem((q) => q.query("UPDATE calendar_events SET google_error=$2 WHERE id=$1", [e.id, ((err as Error).message || "sync failed").slice(0, 300)]));
    }
  }
  return { synced, failed, skipped: false };
}
