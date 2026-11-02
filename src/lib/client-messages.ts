// Messages sent TO clients: interview reminders (automatic) and documents requests / custom notes (sent by hand).
// Channels: email (the same SMTP service as the owner's fallback emails) and SMS (Twilio).
// Nothing is ever sent unless the client agreed to that channel (clients.notify_email / notify_sms).
import { DateTime } from "luxon";
import { withSystem, withUser, type Q } from "./db";
import { env } from "./env";
import { defaultMailer, type Mailer } from "./notifications";
import { tl, dateLocale, isLang, type Lang } from "./i18n";
import { HttpError } from "./errors";

export type Channel = "email" | "sms";
export type MessageKind = "interview_reminder" | "documents_request" | "custom" | "test";
export type SmsSender = (to: string, body: string) => Promise<{ id: string }>;

export const smsConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

/** Turns what people type ("098 94-82-90", "+374 98 948290", "0037498948290") into +37498948290. Armenia is the default country. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    if (s.startsWith("374") && s.length === 11) s = "+" + s;
    else if (s.startsWith("0") && s.length === 9) s = "+374" + s.slice(1);
    else if (s.length === 8) s = "+374" + s;
    else return null;
  }
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/** Twilio REST API (no SDK needed). TWILIO_API_BASE exists only so tests can point it at a local stand-in. */
export const defaultSmsSender: SmsSender = async (to, body) => {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const base = process.env.TWILIO_API_BASE || "https://api.twilio.com";
  const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !json.sid) throw new Error(`SMS service error${json.code ? ` ${json.code}` : ""}: ${json.message ?? res.status}`);
  return { id: json.sid };
};

const langOf = (v: string | null | undefined): Lang => (isLang(v) ? v : "hy");

// ───────────── message texts (three languages) ─────────────
export interface InterviewFacts {
  name: string;
  at: string; // ISO
  tz: string;
  place: string | null;
  phone: string | null;
}

export function interviewReminder(lang: Lang, f: InterviewFacts) {
  const d = DateTime.fromISO(f.at, { zone: "utc" }).setZone(f.tz).setLocale(dateLocale(lang));
  const vars = { name: f.name.split(/\s+/)[0] || f.name, date: d.toFormat("cccc, d MMMM"), time: d.toFormat("HH:mm"), place: f.place || tl(lang, "the U.S. Embassy"), phone: f.phone ?? "" };
  const text = tl(lang, "Hello {name}! A reminder of your U.S. visa interview on {date} at {time}, {place}. Please bring your passport, the DS-160 confirmation page and the appointment confirmation.", vars);
  const contact = f.phone ? " " + tl(lang, "Questions? Call {phone}.", vars) : "";
  return {
    subject: tl(lang, "Your U.S. visa interview — {date}, {time}", vars),
    text: `${text}${contact}\n\n— US VISA WITH ARGISHTI`,
    sms: `${tl(lang, "{name}, reminder: U.S. visa interview {date} at {time}, {place}. Bring passport, DS-160 confirmation and appointment letter.", vars)}${f.phone ? " " + f.phone : ""} — US VISA WITH ARGISHTI`,
  };
}

export function documentsRequest(lang: Lang, f: { name: string; items: string[]; phone: string | null }) {
  const vars = { name: f.name.split(/\s+/)[0] || f.name, phone: f.phone ?? "" };
  const list = f.items.map((i) => tl(lang, i)).join(", ");
  const text = `${tl(lang, "Hello {name}! To continue your application we still need these documents:", vars)} ${list}. ${tl(lang, "You can reply to this message or send them on WhatsApp.", vars)}${f.phone ? " " + tl(lang, "Questions? Call {phone}.", vars) : ""}`;
  return { subject: tl(lang, "Documents needed for your application", vars), text: `${text}\n\n— US VISA WITH ARGISHTI`, sms: `${text} — US VISA WITH ARGISHTI` };
}

function emailHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(text).split("\n\n").map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1426">
  <div style="border-top:4px solid #c9a86a;padding-top:18px;font-size:15px">${body}</div>
  <p style="margin-top:22px;font-size:11px;color:#6b7280">US VISA WITH ARGISHTI is an independent visa application support service and is not affiliated with the U.S. government.</p>
</div>`;
}

// ───────────── sending + log ─────────────
export interface SendDeps {
  mail?: Mailer;
  sms?: SmsSender;
  emailEnabled?: boolean;
  smsEnabled?: boolean;
}

interface ClientContact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  preferred_language: string | null;
}

/**
 * Sends one message and records it. With an idempotency key, a second attempt for the same key does nothing
 * (returns null) — the row is claimed BEFORE sending, so two schedulers can never both send it.
 */
export async function sendToClient(
  userId: string,
  c: ClientContact,
  m: { channel: Channel; kind: MessageKind; subject?: string; body: string; interviewId?: string | null; key?: string; requireConsent?: boolean },
  deps: SendDeps = {},
) {
  const emailOn = deps.emailEnabled ?? Boolean(env.smtp.host);
  const smsOn = deps.smsEnabled ?? smsConfigured();
  const to = m.channel === "email" ? c.email?.trim() || null : normalizePhone(c.phone);
  const consent = m.channel === "email" ? c.notify_email : c.notify_sms;
  let problem: string | null = null;
  if (!to) problem = m.channel === "email" ? "This client has no email address." : "This client has no valid mobile number.";
  else if (m.requireConsent !== false && !consent) problem = "The client hasn't agreed to messages on this channel.";
  else if (m.channel === "email" && !emailOn) problem = "Email isn't set up on the server yet (SMTP settings are missing).";
  else if (m.channel === "sms" && !smsOn) problem = "SMS isn't set up yet (Twilio settings are missing).";

  const claimed = await withUser(userId, async (q) => {
    const rows = await q.query<{ id: string }>(
      `INSERT INTO client_messages (user_id, client_id, interview_id, channel, kind, to_address, subject, body, status, error, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [userId, c.id, m.interviewId ?? null, m.channel, m.kind, to, m.subject ?? null, m.body, problem ? "skipped" : "sending", problem, m.key ?? null],
    );
    return rows[0]?.id ?? null;
  });
  if (!claimed) return null; // already handled
  if (problem) return { id: claimed, status: "skipped" as const, error: problem };

  try {
    let providerId: string | null = null;
    if (m.channel === "email") await (deps.mail ?? defaultMailer)({ to: to!, subject: m.subject ?? "US VISA WITH ARGISHTI", text: m.body, html: emailHtml(m.body) });
    else providerId = (await (deps.sms ?? defaultSmsSender)(to!, m.body)).id;
    await withUser(userId, (q) => q.query("UPDATE client_messages SET status='sent', sent_at=now(), provider_id=$2 WHERE id=$1", [claimed, providerId]));
    return { id: claimed, status: "sent" as const, error: null };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await withUser(userId, (q) => q.query("UPDATE client_messages SET status='failed', error=$2 WHERE id=$1", [claimed, msg]));
    return { id: claimed, status: "failed" as const, error: msg };
  }
}

// ───────────── automatic interview reminders (called by the scheduler every minute) ─────────────
export async function dispatchClientReminders(now = new Date(), deps: SendDeps = {}) {
  const due = await withSystem((q) =>
    q.query<ClientContact & { interview_id: string; interview_at: string; embassy: string | null; user_id: string; tz: string; offsets: number[]; business_phone: string | null }>(
      `SELECT i.id AS interview_id, i.interview_at, i.embassy, i.user_id,
              c.id, c.full_name, c.email, c.phone, c.notify_email, c.notify_sms, c.preferred_language,
              COALESCE(p.timezone, 'Asia/Yerevan') AS tz, COALESCE(p.client_reminder_offsets, '{1440,120}') AS offsets, p.business_phone
         FROM interviews i
         JOIN clients c ON c.id = i.client_id AND c.deleted_at IS NULL
         LEFT JOIN user_preferences p ON p.user_id = i.user_id
        WHERE i.deleted_at IS NULL AND i.outcome = 'Pending' AND i.interview_at > $1
          AND COALESCE(p.client_reminders_enabled, true)
          AND (c.notify_email OR c.notify_sms)
          AND i.interview_at <= $1::timestamptz + make_interval(mins => (SELECT max(o) FROM unnest(COALESCE(p.client_reminder_offsets, '{1440,120}')) o))`,
      [now.toISOString()],
    ),
  );
  let sent = 0, failed = 0, skipped = 0;
  for (const r of due) {
    const at = new Date(r.interview_at).getTime();
    // Offsets whose moment has passed; only the closest one is sent — older missed ones are recorded as skipped,
    // so a scheduler outage never fires a burst of stale reminders.
    const passed = [...r.offsets].sort((a, b) => a - b).filter((o) => now.getTime() >= at - o * 60_000);
    if (!passed.length) continue;
    const lang = langOf(r.preferred_language);
    const msg = interviewReminder(lang, { name: r.full_name, at: r.interview_at, tz: r.tz, place: r.embassy, phone: r.business_phone });
    for (const channel of ["email", "sms"] as const) {
      if (!(channel === "email" ? r.notify_email : r.notify_sms)) continue;
      for (const [idx, o] of passed.entries()) {
        const key = `iv:${r.interview_id}:${r.interview_at}:${o}:${channel}`;
        if (idx > 0) {
          // stale offset: record once as skipped, never send
          await withUser(r.user_id, (q) => q.query(
            `INSERT INTO client_messages (user_id, client_id, interview_id, channel, kind, body, status, error, idempotency_key)
             VALUES ($1,$2,$3,$4,'interview_reminder',$5,'skipped','A later reminder replaced this one',$6) ON CONFLICT (idempotency_key) DO NOTHING`,
            [r.user_id, r.id, r.interview_id, channel, channel === "email" ? msg.text : msg.sms, key]));
          continue;
        }
        const res = await sendToClient(r.user_id, r, { channel, kind: "interview_reminder", subject: msg.subject, body: channel === "email" ? msg.text : msg.sms, interviewId: r.interview_id, key }, deps);
        if (res?.status === "sent") sent++;
        else if (res?.status === "failed") failed++;
        else if (res?.status === "skipped") skipped++;
      }
    }
  }
  return { clientSent: sent, clientFailed: failed, clientSkipped: skipped };
}

// ───────────── for the client page ─────────────
export async function listClientMessages(q: Q, userId: string, clientId: string) {
  return q.query<{ id: string; channel: Channel; kind: MessageKind; to_address: string | null; subject: string | null; body: string; status: string; error: string | null; created_at: string; sent_at: string | null }>(
    "SELECT id, channel, kind, to_address, subject, body, status, error, created_at, sent_at FROM client_messages WHERE user_id=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 50",
    [userId, clientId],
  );
}

/** Builds the suggested text for the "Send message" form (the owner can edit it before sending). */
export async function draftForClient(q: Q, userId: string, clientId: string, kind: "interview_reminder" | "documents_request") {
  const [c] = await q.query<ClientContact & { tz: string; business_phone: string | null }>(
    `SELECT c.*, COALESCE(p.timezone,'Asia/Yerevan') AS tz, p.business_phone FROM clients c LEFT JOIN user_preferences p ON p.user_id=c.user_id
      WHERE c.id=$1 AND c.user_id=$2 AND c.deleted_at IS NULL`, [clientId, userId]);
  if (!c) throw new HttpError(404, "Client not found", "not_found");
  const lang = langOf(c.preferred_language);
  if (kind === "interview_reminder") {
    const [iv] = await q.query<{ interview_at: string; embassy: string | null }>(
      "SELECT interview_at, embassy FROM interviews WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL AND outcome='Pending' AND interview_at > now() ORDER BY interview_at LIMIT 1", [clientId, userId]);
    if (!iv) throw new HttpError(400, "This client has no upcoming interview.", "no_interview");
    return { lang, ...interviewReminder(lang, { name: c.full_name, at: iv.interview_at, tz: c.tz, place: iv.embassy, phone: c.business_phone }) };
  }
  const missing = await q.query<{ label: string }>(
    "SELECT label FROM document_checklists WHERE client_id=$1 AND user_id=$2 AND required AND status='missing' ORDER BY sort_order", [clientId, userId]);
  if (!missing.length) throw new HttpError(400, "No required documents are missing for this client.", "nothing_missing");
  return { lang, ...documentsRequest(lang, { name: c.full_name, items: missing.map((m) => m.label), phone: c.business_phone }) };
}
