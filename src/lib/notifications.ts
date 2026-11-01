import { withSystem, type Q, type Row } from "./db";
import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { formatInTz } from "./time";
import { logActivity } from "./audit";
import type { Prefs } from "./types";

export const BRAND_TITLE = "US VISA WITH ARGISHTI — Reminder";
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 15, 60, 180];
const STALE_LOCK_MIN = 5;

// ───────────── transport interfaces (injectable so the dispatcher can be tested without the internet) ─────────────
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;
export type Mailer = (msg: { to: string; subject: string; text: string; html: string }) => Promise<void>;

export const defaultPushSender: PushSender = async (target, payload) => {
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
  await webpush.sendNotification(target, payload, { TTL: 6 * 3600, urgency: "high" });
};

export const defaultMailer: Mailer = async (msg) => {
  const nodemailer = (await import("nodemailer")).default;
  const s = env.smtp;
  const transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  await transport.sendMail({ from: s.from, ...msg });
};

export const pushConfigured = () => Boolean(env.vapidPublic && env.vapidPrivate);
export const emailConfigured = () => Boolean(env.smtp.host);

// ───────────── payloads ─────────────
export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
  icon: string;
  badge: string;
  tag: string;
  requireInteraction: boolean;
  actions: { action: string; title: string }[];
  data: { taskId: string | null; reminderId: string | null; url: string; priority: string };
}

export function buildPayload(opts: { taskId: string; reminderId: string | null; title: string; clientName: string | null; dueAt: string | null; priority: string; tz: string; late?: boolean }): ReminderPayload {
  const clientBit = opts.clientName && !opts.title.toLowerCase().includes(opts.clientName.toLowerCase().split(" ")[0]) ? ` · ${opts.clientName}` : "";
  const when = opts.dueAt ? ` — ${formatInTz(opts.dueAt, opts.tz, "EEE d MMM, h:mm a")}` : "";
  const prefix = opts.priority === "Urgent" ? "⚠ URGENT · " : opts.priority === "High" ? "High priority · " : "";
  const url = `/tasks?open=${opts.taskId}`;
  return {
    title: BRAND_TITLE,
    body: `${prefix}${opts.title}${clientBit}${when}${opts.late ? " (delayed)" : ""}`,
    url,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: `task-${opts.taskId}`,
    requireInteraction: opts.priority === "Urgent" || opts.priority === "High",
    actions: [
      { action: "open", title: "Open" },
      { action: "snooze", title: "Snooze 15 min" },
    ],
    data: { taskId: opts.taskId, reminderId: opts.reminderId, url, priority: opts.priority },
  };
}

function emailContent(p: ReminderPayload) {
  const link = `${env.appUrl}${p.url}`;
  const text = `${p.title}\n\n${p.body}\n\nOpen: ${link}`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html><body style="margin:0;background:#F8F9FC;font-family:Arial,Helvetica,sans-serif;color:#0B1426">
<div style="max-width:520px;margin:0 auto;padding:24px">
<div style="background:#0B1426;border-radius:16px 16px 0 0;padding:20px 24px;text-align:center"><img src="${env.appUrl}/brand/logo-320.png" width="96" alt="US VISA WITH ARGISHTI" style="border-radius:12px;background:#fff"></div>
<div style="background:#fff;border:1px solid #E4E7EF;border-top:3px solid #C9A86A;border-radius:0 0 16px 16px;padding:24px">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8A6A2F">Reminder</p>
<p style="margin:0 0 20px;font-size:18px;line-height:1.4">${esc(p.body)}</p>
<a href="${link}" style="display:inline-block;background:#0B1426;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Open task</a>
</div><p style="text-align:center;font-size:11px;color:#667085;margin-top:16px">Independent visa application support service — not affiliated with the U.S. government.</p></div></body></html>`;
  return { subject: `Reminder: ${p.body.slice(0, 90)}`, text, html };
}

// ───────────── dispatcher ─────────────
export interface DispatchResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  canceled: number;
  inAppOnly: number;
  pushSent: number;
  emailSent: number;
  expiredSubscriptions: number;
}

interface DispatchDeps {
  now?: Date;
  push?: PushSender;
  mail?: Mailer;
  limit?: number;
  pushEnabled?: boolean;
  emailEnabled?: boolean;
}

interface ClaimedReminder extends Row {
  id: string;
  user_id: string;
  task_id: string;
  remind_at: string;
  attempt_count: number;
}

export async function dispatchDueReminders(deps: DispatchDeps = {}): Promise<DispatchResult> {
  const now = deps.now ?? new Date();
  const push = deps.push ?? defaultPushSender;
  const mail = deps.mail ?? defaultMailer;
  const pushEnabled = deps.pushEnabled ?? pushConfigured();
  const emailEnabled = deps.emailEnabled ?? emailConfigured();
  const res: DispatchResult = { claimed: 0, sent: 0, retrying: 0, failed: 0, canceled: 0, inAppOnly: 0, pushSent: 0, emailSent: 0, expiredSubscriptions: 0 };

  // 1. Atomically claim due reminders. FOR UPDATE SKIP LOCKED makes overlapping cron runs safe: two workers never get the same row.
  const claimed = await withSystem(async (q) => {
    await q.query(
      `UPDATE task_reminders SET status='pending', updated_at=now()
        WHERE status='processing' AND locked_at < $1::timestamptz - ($2 || ' minutes')::interval`,
      [now.toISOString(), String(STALE_LOCK_MIN)],
    );
    return q.query<ClaimedReminder>(
      `UPDATE task_reminders SET status='processing', locked_at=$1, attempt_count=attempt_count+1, updated_at=now()
        WHERE id IN (SELECT id FROM task_reminders
                      WHERE status='pending' AND remind_at <= $1 AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
                      ORDER BY remind_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [now.toISOString(), deps.limit ?? 100],
    );
  });
  res.claimed = claimed.length;

  // 2. Process each reminder in its own transaction so one failure never blocks the others.
  for (const r of claimed) {
    try {
      await withSystem((q) => processReminder(q, r, { now, push, mail, pushEnabled, emailEnabled }, res));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await withSystem((q) => finishReminder(q, r, "retry", msg, now, res));
    }
  }
  return res;
}

async function finishReminder(q: Q, r: ClaimedReminder, outcome: "sent" | "retry" | "canceled", error: string | null, now: Date, res: DispatchResult) {
  if (outcome === "sent") {
    await q.query("UPDATE task_reminders SET status='sent', sent_at=$2, last_error=$3, locked_at=NULL, updated_at=now() WHERE id=$1", [r.id, now.toISOString(), error]);
    res.sent++;
  } else if (outcome === "canceled") {
    await q.query("UPDATE task_reminders SET status='canceled', locked_at=NULL, updated_at=now() WHERE id=$1", [r.id]);
    res.canceled++;
  } else if (r.attempt_count >= MAX_ATTEMPTS) {
    await q.query("UPDATE task_reminders SET status='failed', last_error=$2, locked_at=NULL, updated_at=now() WHERE id=$1", [r.id, (error ?? "failed").slice(0, 500)]);
    res.failed++;
  } else {
    const wait = BACKOFF_MIN[Math.min(r.attempt_count - 1, BACKOFF_MIN.length - 1)];
    await q.query(
      "UPDATE task_reminders SET status='pending', last_error=$2, next_attempt_at=$3, locked_at=NULL, updated_at=now() WHERE id=$1",
      [r.id, (error ?? "failed").slice(0, 500), new Date(now.getTime() + wait * 60_000).toISOString()],
    );
    res.retrying++;
  }
}

async function processReminder(q: Q, r: ClaimedReminder, d: Required<Pick<DispatchDeps, "push" | "mail" | "pushEnabled" | "emailEnabled">> & { now: Date }, res: DispatchResult) {
  const [t] = await q.query<{ id: string; title: string; status: string; due_at: string | null; priority: string; client_id: string | null; deleted_at: string | null; client_name: string | null }>(
    `SELECT t.id, t.title, t.status, t.due_at, t.priority, t.client_id, t.deleted_at, c.full_name AS client_name
       FROM tasks t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = $1`,
    [r.task_id],
  );
  if (!t || t.deleted_at || t.status !== "pending") return finishReminder(q, r, "canceled", null, d.now, res);

  const [prefs] = await q.query<Prefs & { email: string }>(
    "SELECT p.*, u.email FROM user_preferences p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1",
    [r.user_id],
  );
  const tz = prefs?.timezone ?? "Asia/Yerevan";
  const late = d.now.getTime() - new Date(r.remind_at).getTime() > 10 * 60_000;
  const payload = buildPayload({ taskId: t.id, reminderId: r.id, title: t.title, clientName: t.client_name, dueAt: t.due_at, priority: t.priority, tz, late });
  const base = { userId: r.user_id, reminderId: r.id, taskId: t.id, title: payload.title, body: payload.body, url: payload.url, priority: t.priority };

  // In-app notification centre entry (always created, once).
  await q.query(
    `INSERT INTO notification_deliveries (user_id, reminder_id, task_id, channel, status, title, body, url, priority, idempotency_key, sent_at)
     VALUES ($1,$2,$3,'inapp','sent',$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING`,
    [base.userId, base.reminderId, base.taskId, base.title, base.body, base.url, base.priority, `${r.id}:inapp:-`, d.now.toISOString()],
  );

  let pushSent = 0;
  let pushRetryable = 0;
  let pushTargets = 0;
  const wantsPush = (prefs?.notif_push ?? true) && d.pushEnabled;

  if (wantsPush) {
    const subs = await q.query<{ id: string; endpoint: string; p256dh_enc: string; auth_enc: string }>(
      "SELECT id, endpoint, p256dh_enc, auth_enc FROM push_subscriptions WHERE user_id=$1 AND status='active'",
      [r.user_id],
    );
    for (const sub of subs) {
      // Idempotency: a delivery that already succeeded for this reminder+device is never sent again, even if the reminder is retried.
      const claimedDelivery = await q.query<{ id: string }>(
        `INSERT INTO notification_deliveries (user_id, reminder_id, task_id, subscription_id, channel, status, title, body, url, priority, idempotency_key)
         VALUES ($1,$2,$3,$4,'push','pending',$5,$6,$7,$8,$9)
         ON CONFLICT (idempotency_key) DO UPDATE SET status='pending', error=NULL WHERE notification_deliveries.status = 'failed'
         RETURNING id`,
        [base.userId, base.reminderId, base.taskId, sub.id, base.title, base.body, base.url, base.priority, `${r.id}:push:${sub.id}`],
      );
      if (!claimedDelivery.length) {
        pushSent++; // already delivered earlier
        continue;
      }
      pushTargets++;
      try {
        await d.push({ endpoint: sub.endpoint, keys: { p256dh: decrypt(sub.p256dh_enc), auth: decrypt(sub.auth_enc) } }, JSON.stringify(payload));
        await q.query("UPDATE notification_deliveries SET status='sent', sent_at=$2 WHERE id=$1", [claimedDelivery[0].id, d.now.toISOString()]);
        await q.query("UPDATE push_subscriptions SET last_success_at=$2, last_error=NULL, updated_at=now() WHERE id=$1", [sub.id, d.now.toISOString()]);
        pushSent++;
        res.pushSent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const msg = ((e as Error).message || "push failed").slice(0, 300);
        if (status === 404 || status === 410) {
          // The browser/OS revoked this subscription: stop using it and tell the owner they need to re-enable notifications.
          await q.query("UPDATE notification_deliveries SET status='expired', error=$2 WHERE id=$1", [claimedDelivery[0].id, "Subscription expired — re-enable notifications on this device"]);
          await q.query("UPDATE push_subscriptions SET status='expired', last_error=$2, updated_at=now() WHERE id=$1", [sub.id, `HTTP ${status}`]);
          res.expiredSubscriptions++;
        } else {
          await q.query("UPDATE notification_deliveries SET status='failed', error=$2 WHERE id=$1", [claimedDelivery[0].id, `${status ? `HTTP ${status}: ` : ""}${msg}`]);
          pushRetryable++;
        }
      }
    }
    if (!subs.length) {
      await q.query(
        `INSERT INTO notification_deliveries (user_id, reminder_id, task_id, channel, status, title, body, url, priority, error, idempotency_key)
         VALUES ($1,$2,$3,'push','skipped',$4,$5,$6,$7,'No active device — open Notifications and enable alerts on this device',$8) ON CONFLICT (idempotency_key) DO NOTHING`,
        [base.userId, base.reminderId, base.taskId, base.title, base.body, base.url, base.priority, `${r.id}:push:none`],
      );
    }
  }

  // Email fallback: when push could not reach any device (unsupported, no subscription, expired, or failing).
  let emailSent = false;
  let emailFailed = false;
  const needEmail = (prefs?.notif_email_fallback ?? true) && d.emailEnabled && pushSent === 0;
  if (needEmail) {
    const to = prefs?.notification_email || prefs?.email;
    const dup = await q.query<{ id: string }>(
      `INSERT INTO notification_deliveries (user_id, reminder_id, task_id, channel, status, title, body, url, priority, idempotency_key)
       VALUES ($1,$2,$3,'email','pending',$4,$5,$6,$7,$8)
       ON CONFLICT (idempotency_key) DO UPDATE SET status='pending', error=NULL WHERE notification_deliveries.status = 'failed' RETURNING id`,
      [base.userId, base.reminderId, base.taskId, base.title, base.body, base.url, base.priority, `${r.id}:email:-`],
    );
    if (dup.length && to) {
      try {
        await d.mail({ to, ...emailContent(payload) });
        await q.query("UPDATE notification_deliveries SET status='sent', sent_at=$2 WHERE id=$1", [dup[0].id, d.now.toISOString()]);
        emailSent = true;
        res.emailSent++;
      } catch (e) {
        await q.query("UPDATE notification_deliveries SET status='failed', error=$2 WHERE id=$1", [dup[0].id, ((e as Error).message || "email failed").slice(0, 300)]);
        emailFailed = true;
      }
    } else if (!dup.length) emailSent = true; // an earlier attempt already delivered the email
  }

  const externalDelivered = pushSent > 0 || emailSent;
  // A device that failed transiently is retried even if another device already got the alert; the idempotency keys
  // guarantee the devices that succeeded are never notified twice.
  if (pushRetryable > 0 && r.attempt_count < MAX_ATTEMPTS) return finishReminder(q, r, "retry", "A device could not be reached — retrying", d.now, res);
  if (externalDelivered) return finishReminder(q, r, "sent", null, d.now, res);
  if (pushRetryable > 0 || emailFailed) return finishReminder(q, r, "retry", "Delivery failed — will retry", d.now, res);
  // Nothing external was possible (no device, no email configured). The in-app entry exists; make that visible rather than pretending.
  res.inAppOnly++;
  return finishReminder(q, r, "sent", "in-app only: no push device or email fallback available", d.now, res);
}

// ───────────── subscriptions ─────────────
export async function saveSubscription(q: Q, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null, label: string | null) {
  const [row] = await q.query<{ id: string }>(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_enc, auth_enc, user_agent, device_label, status)
     VALUES ($1,$2,$3,$4,$5,$6,'active')
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh_enc=EXCLUDED.p256dh_enc, auth_enc=EXCLUDED.auth_enc,
       user_agent=EXCLUDED.user_agent, device_label=COALESCE(EXCLUDED.device_label, push_subscriptions.device_label), status='active', last_error=NULL, updated_at=now()
     RETURNING id`,
    [userId, sub.endpoint, encrypt(sub.keys.p256dh), encrypt(sub.keys.auth), (userAgent ?? "").slice(0, 300), label],
  );
  await logActivity(q, { userId, entityType: "push", entityId: row.id, action: "push.subscribed", summary: "Notifications enabled on a device" });
  return row.id;
}

/** Sends an immediate test notification to every active device (and records it in the notification centre). */
export async function sendTestNotification(q: Q, userId: string, deps: { push?: PushSender; pushEnabled?: boolean; now?: Date } = {}) {
  const push = deps.push ?? defaultPushSender;
  const enabled = deps.pushEnabled ?? pushConfigured();
  const now = deps.now ?? new Date();
  const payload = buildPayload({ taskId: "test", reminderId: null, title: "Test notification — your reminders are working", clientName: null, dueAt: null, priority: "Normal", tz: "Asia/Yerevan" });
  payload.url = "/notifications";
  payload.data.url = "/notifications";
  payload.tag = "uva-test";
  payload.actions = [{ action: "open", title: "Open" }];
  const key = `test:${crypto.randomUUID()}`;
  await q.query(
    `INSERT INTO notification_deliveries (user_id, channel, status, title, body, url, idempotency_key, sent_at) VALUES ($1,'inapp','sent',$2,$3,'/notifications',$4,$5)`,
    [userId, payload.title, payload.body, `${key}:inapp`, now.toISOString()],
  );
  const results: { device: string | null; status: "sent" | "expired" | "failed"; error?: string }[] = [];
  if (!enabled) return { configured: false, devices: 0, results };
  const subs = await q.query<{ id: string; endpoint: string; p256dh_enc: string; auth_enc: string; device_label: string | null; user_agent: string | null }>(
    "SELECT id, endpoint, p256dh_enc, auth_enc, device_label, user_agent FROM push_subscriptions WHERE user_id=$1 AND status='active'",
    [userId],
  );
  for (const s of subs) {
    const label = s.device_label || (s.user_agent ?? "").slice(0, 40) || "device";
    try {
      await push({ endpoint: s.endpoint, keys: { p256dh: decrypt(s.p256dh_enc), auth: decrypt(s.auth_enc) } }, JSON.stringify(payload));
      await q.query(
        `INSERT INTO notification_deliveries (user_id, subscription_id, channel, status, title, body, url, idempotency_key, sent_at) VALUES ($1,$2,'push','sent',$3,$4,'/notifications',$5,$6)`,
        [userId, s.id, payload.title, payload.body, `${key}:push:${s.id}`, now.toISOString()],
      );
      results.push({ device: label, status: "sent" });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      const expired = status === 404 || status === 410;
      const msg = expired ? "Subscription expired — re-enable notifications on this device" : `${status ? `HTTP ${status}: ` : ""}${((e as Error).message || "failed").slice(0, 200)}`;
      if (expired) await q.query("UPDATE push_subscriptions SET status='expired', last_error=$2, updated_at=now() WHERE id=$1", [s.id, `HTTP ${status}`]);
      await q.query(
        `INSERT INTO notification_deliveries (user_id, subscription_id, channel, status, title, body, url, error, idempotency_key) VALUES ($1,$2,'push',$3,$4,$5,'/notifications',$6,$7)`,
        [userId, s.id, expired ? "expired" : "failed", payload.title, payload.body, msg, `${key}:push:${s.id}`],
      );
      results.push({ device: label, status: expired ? "expired" : "failed", error: msg });
    }
  }
  return { configured: true, devices: subs.length, results };
}
