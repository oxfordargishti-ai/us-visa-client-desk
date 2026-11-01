import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { freshDb, makeUser, withUser, withSystem, closeDriver } from "./helpers";
import { createTask, completeTask, updateTask, TaskInput } from "@/lib/repo/tasks";
import { createClient, ClientInput } from "@/lib/repo/clients";
import { dispatchDueReminders, saveSubscription, sendTestNotification, type PushSender, type Mailer } from "@/lib/notifications";
import { decrypt } from "@/lib/crypto";

const DUE = "2026-11-03T11:00:00.000Z"; // Tue 15:00 Yerevan
const CREATED_AT = new Date("2026-11-02T08:00:00Z");
const FIVE_HOURS_BEFORE = new Date("2026-11-03T06:00:30Z");
let uid: string;
let karen: string;

const sub = (n: number) => ({ endpoint: `https://push.example.test/device-${n}`, keys: { p256dh: "BPkey-" + "x".repeat(60), auth: "authkey-" + n + "-xxxx" } });

function recorder() {
  const sent: { endpoint: string; payload: any }[] = [];
  const push: PushSender = async (t, payload) => {
    sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload) });
  };
  const mails: { to: string; subject: string }[] = [];
  const mail: Mailer = async (m) => {
    mails.push({ to: m.to, subject: m.subject });
  };
  return { sent, push, mails, mail };
}

const mkTask = (o: Record<string, unknown> = {}) =>
  withUser(uid, (q) => createTask(q, uid, TaskInput.parse({ title: "Call Karen — Visa Interview Preparation", due_at: DUE, client_id: karen, reminder_offsets: [300], priority: "Normal", ...o }), CREATED_AT));

beforeAll(async () => {
  await freshDb();
  uid = await makeUser("owner@example.com");
  karen = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Karen Sargsyan" }))).client.id);
});
afterAll(closeDriver);
beforeEach(async () => {
  await withSystem(async (q) => {
    await q.query("DELETE FROM notification_deliveries");
    await q.query("DELETE FROM task_reminders");
    await q.query("DELETE FROM push_subscriptions");
    await q.query("DELETE FROM tasks");
  });
});

describe("acceptance: background notification without an open browser tab", () => {
  it("delivers a due reminder to a subscribed device from the server alone", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "iPhone Safari", "My iPhone"));
    const { task } = await mkTask();
    const r = recorder();
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: false });
    expect(res).toMatchObject({ claimed: 1, sent: 1, pushSent: 1, failed: 0 });
    expect(r.sent).toHaveLength(1);
    const p = r.sent[0].payload;
    expect(p.title).toBe("US VISA WITH ARGISHTI — Reminder");
    expect(p.body).toContain("Call Karen — Visa Interview Preparation");
    expect(p.body).toContain("Tue 3 Nov, 3:00 PM"); // shown in Asia/Yerevan, not UTC
    expect(p.icon).toBe("/icons/icon-192.png");
    expect(p.data.url).toBe(`/tasks?open=${task.id}`);
    expect(p.actions.map((a: any) => a.action)).toEqual(["open", "snooze"]);
  });

  it("does nothing before the reminder time", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    const r = recorder();
    const res = await dispatchDueReminders({ now: new Date("2026-11-03T05:59:00Z"), push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: false });
    expect(res.claimed).toBe(0);
    expect(r.sent).toHaveLength(0);
  });

  it("stores push keys encrypted at rest", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    const [row] = await withSystem((q) => q.query<{ p256dh_enc: string; auth_enc: string }>("SELECT p256dh_enc, auth_enc FROM push_subscriptions"));
    expect(row.auth_enc).not.toContain("authkey");
    expect(decrypt(row.auth_enc)).toBe("authkey-1-xxxx");
  });
});

describe("idempotency: no duplicate deliveries", () => {
  it("two overlapping dispatcher runs send exactly one notification", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    const r = recorder();
    const run = () => dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: false });
    await Promise.all([run(), run()]);
    await run();
    expect(r.sent).toHaveLength(1);
    const inapp = await withSystem((q) => q.query("SELECT 1 FROM notification_deliveries WHERE channel='inapp'"));
    expect(inapp).toHaveLength(1);
  });

  it("a retried reminder never re-sends to a device that already received it", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await withUser(uid, (q) => saveSubscription(q, uid, sub(2), "UA", null));
    await mkTask();
    const calls: string[] = [];
    let failTwo = true;
    const push: PushSender = async (t) => {
      calls.push(t.endpoint);
      if (t.endpoint.endsWith("device-2") && failTwo) throw Object.assign(new Error("temporary outage"), { statusCode: 503 });
    };
    const first = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push, pushEnabled: true, emailEnabled: false });
    expect(first.pushSent).toBe(1);
    expect(first.retrying).toBe(1); // device 2 failed transiently → retried later
    failTwo = false;
    const second = await dispatchDueReminders({ now: new Date(FIVE_HOURS_BEFORE.getTime() + 10 * 60_000), push, pushEnabled: true, emailEnabled: false });
    expect(second.sent).toBe(1);
    expect(calls.filter((c) => c.endsWith("device-1"))).toHaveLength(1); // never re-sent
    expect(calls.filter((c) => c.endsWith("device-2"))).toHaveLength(2); // failed once, delivered on retry
  });
});

describe("failure handling", () => {
  it("retries with backoff when the push service is down, then gives up and records the error", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    const { task } = await mkTask();
    let attempts = 0;
    const push: PushSender = async () => {
      attempts++;
      throw Object.assign(new Error("push service unavailable"), { statusCode: 503 });
    };
    let t = FIVE_HOURS_BEFORE.getTime();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await dispatchDueReminders({ now: new Date(t), push, pushEnabled: true, emailEnabled: false }));
      t += 4 * 3600_000; // jump past any backoff window
    }
    expect(results[0].retrying).toBe(1);
    expect(attempts).toBe(5); // MAX_ATTEMPTS
    const [r] = await withSystem((q) => q.query<{ status: string; last_error: string; attempt_count: number }>("SELECT status, last_error, attempt_count FROM task_reminders WHERE task_id=$1", [task.id]));
    expect(r.status).toBe("failed");
    expect(r.attempt_count).toBe(5);
    expect(r.last_error).toBeTruthy();
    const failedDelivery = await withSystem((q) => q.query<{ status: string; error: string }>("SELECT status, error FROM notification_deliveries WHERE channel='push'"));
    expect(failedDelivery[0].status).toBe("failed");
    expect(failedDelivery[0].error).toMatch(/503/);
  });

  it("does not retry before the backoff window has passed", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    let attempts = 0;
    const push: PushSender = async () => {
      attempts++;
      throw Object.assign(new Error("down"), { statusCode: 500 });
    };
    await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push, pushEnabled: true, emailEnabled: false });
    await dispatchDueReminders({ now: new Date(FIVE_HOURS_BEFORE.getTime() + 20_000), push, pushEnabled: true, emailEnabled: false });
    expect(attempts).toBe(1);
    await dispatchDueReminders({ now: new Date(FIVE_HOURS_BEFORE.getTime() + 61_000), push, pushEnabled: true, emailEnabled: false });
    expect(attempts).toBe(2);
  });

  it("marks expired subscriptions (HTTP 410) as expired and stops using them", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    const push: PushSender = async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    };
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push, pushEnabled: true, emailEnabled: false });
    expect(res.expiredSubscriptions).toBe(1);
    const [s] = await withSystem((q) => q.query<{ status: string }>("SELECT status FROM push_subscriptions"));
    expect(s.status).toBe("expired");
    const [d] = await withSystem((q) => q.query<{ status: string; error: string }>("SELECT status, error FROM notification_deliveries WHERE channel='push'"));
    expect(d.status).toBe("expired");
    expect(d.error).toMatch(/re-enable/i);
  });
});

describe("email fallback and in-app centre", () => {
  it("falls back to email when no device is subscribed", async () => {
    await mkTask();
    const r = recorder();
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: true });
    expect(res.emailSent).toBe(1);
    expect(r.mails[0].to).toBe("owner@example.com");
    expect(r.mails[0].subject).toContain("Call Karen");
    const rows = await withSystem((q) => q.query<{ channel: string; status: string }>("SELECT channel, status FROM notification_deliveries ORDER BY channel"));
    expect(rows).toEqual(expect.arrayContaining([{ channel: "email", status: "sent" }, { channel: "inapp", status: "sent" }, { channel: "push", status: "skipped" }]));
  });

  it("falls back to email when push fails permanently for every device", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    const r = recorder();
    const push: PushSender = async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    };
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push, mail: r.mail, pushEnabled: true, emailEnabled: true });
    expect(res.emailSent).toBe(1);
    expect(res.sent).toBe(1);
  });

  it("does not email when push already reached a device", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask();
    const r = recorder();
    await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: true });
    expect(r.mails).toHaveLength(0);
  });

  it("with no device and no email, the in-app entry exists and the gap is reported honestly", async () => {
    const { task } = await mkTask();
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, pushEnabled: true, emailEnabled: false });
    expect(res.inAppOnly).toBe(1);
    const [r] = await withSystem((q) => q.query<{ status: string; last_error: string }>("SELECT status, last_error FROM task_reminders WHERE task_id=$1", [task.id]));
    expect(r.status).toBe("sent");
    expect(r.last_error).toMatch(/in-app only/);
    const inapp = await withSystem((q) => q.query("SELECT 1 FROM notification_deliveries WHERE channel='inapp'"));
    expect(inapp).toHaveLength(1);
  });

  it("respects the owner turning push off", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await withUser(uid, (q) => q.query("UPDATE user_preferences SET notif_push=false WHERE user_id=$1", [uid]));
    await mkTask();
    const r = recorder();
    await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, mail: r.mail, pushEnabled: true, emailEnabled: true });
    expect(r.sent).toHaveLength(0);
    expect(r.mails).toHaveLength(1);
    await withUser(uid, (q) => q.query("UPDATE user_preferences SET notif_push=true WHERE user_id=$1", [uid]));
  });
});

describe("cancelled / changed tasks", () => {
  it("never sends a reminder for a task that was completed in the meantime", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    const { task } = await mkTask();
    await withUser(uid, (q) => completeTask(q, uid, task.id, CREATED_AT));
    const r = recorder();
    const res = await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, pushEnabled: true, emailEnabled: false });
    expect(res.claimed).toBe(0);
    expect(r.sent).toHaveLength(0);
  });

  it("after rescheduling, the OLD time stays silent and the NEW time fires", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    const { task } = await mkTask();
    await withUser(uid, (q) => updateTask(q, uid, task.id, { due_at: "2026-11-10T11:00:00.000Z" }, CREATED_AT));
    const r = recorder();
    await dispatchDueReminders({ now: FIVE_HOURS_BEFORE, push: r.push, pushEnabled: true, emailEnabled: false });
    expect(r.sent).toHaveLength(0);
    await dispatchDueReminders({ now: new Date("2026-11-10T06:00:10Z"), push: r.push, pushEnabled: true, emailEnabled: false });
    expect(r.sent).toHaveLength(1);
  });

  it("flags urgent tasks and late deliveries in the message", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", null));
    await mkTask({ priority: "Urgent" });
    const r = recorder();
    await dispatchDueReminders({ now: new Date("2026-11-03T08:00:00Z"), push: r.push, pushEnabled: true, emailEnabled: false }); // 2h late
    expect(r.sent[0].payload.body).toContain("URGENT");
    expect(r.sent[0].payload.body).toContain("(delayed)");
    expect(r.sent[0].payload.requireInteraction).toBe(true);
  });
});

describe("test notification", () => {
  it("sends to every active device and records the outcome per device", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, sub(1), "UA", "Office Mac"));
    await withUser(uid, (q) => saveSubscription(q, uid, sub(2), "UA", "My iPhone"));
    const push: PushSender = async (t) => {
      if (t.endpoint.endsWith("device-2")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    };
    const res = await withUser(uid, (q) => sendTestNotification(q, uid, { push, pushEnabled: true }));
    expect(res.devices).toBe(2);
    expect(res.results).toEqual(expect.arrayContaining([{ device: "Office Mac", status: "sent" }, expect.objectContaining({ device: "My iPhone", status: "expired" })]));
  });
  it("reports clearly when push is not configured", async () => {
    const res = await withUser(uid, (q) => sendTestNotification(q, uid, { pushEnabled: false }));
    expect(res.configured).toBe(false);
  });
});
