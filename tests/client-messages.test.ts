import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { freshDb, makeUser, withUser, withSystem, closeDriver } from "./helpers";
import { createClient } from "@/lib/repo/clients";
import { createInterview, updateInterview } from "@/lib/repo/interviews";
import { dispatchClientReminders, normalizePhone, sendToClient, draftForClient, interviewReminder } from "@/lib/client-messages";

let owner: string;
const sent: { channel: string; to: string; body: string }[] = [];
const deps = {
  emailEnabled: true,
  smsEnabled: true,
  mail: async (m: { to: string; text: string }) => void sent.push({ channel: "email", to: m.to, body: m.text }),
  sms: async (to: string, body: string) => (sent.push({ channel: "sms", to, body }), { id: "SM" + sent.length }),
};

beforeAll(async () => {
  await freshDb();
  owner = await makeUser();
});
afterAll(closeDriver);
beforeEach(() => void (sent.length = 0));

async function clientWithInterview(opts: { email?: boolean; sms?: boolean; lang?: string; at: Date }) {
  const { client } = await withUser(owner, (q) =>
    createClient(q, owner, { full_name: "Arman Simonyan", email: "arman@example.com", phone: "098 94-82-90", preferred_language: opts.lang ?? "hy", notify_email: opts.email ?? false, notify_sms: opts.sms ?? false }),
  );
  const iv = await withUser(owner, (q) => createInterview(q, owner, { client_id: client.id, interview_at: opts.at.toISOString(), embassy: "U.S. Embassy Yerevan" }));
  return { client, interview: iv };
}

describe("phone numbers", () => {
  it("normalises Armenian numbers the way people type them", () => {
    expect(normalizePhone("098 94-82-90")).toBe("+37498948290");
    expect(normalizePhone("+374 98 948290")).toBe("+37498948290");
    expect(normalizePhone("0037498948290")).toBe("+37498948290");
    expect(normalizePhone("37498948290")).toBe("+37498948290");
    expect(normalizePhone("+1 503 809 0905")).toBe("+15038090905");
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("automatic interview reminders to clients", () => {
  it("sends nothing to a client who has not agreed", async () => {
    const now = new Date();
    await clientWithInterview({ at: new Date(now.getTime() + 60 * 60_000) });
    const r = await dispatchClientReminders(now, deps);
    expect(r.clientSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends the 1-day reminder once, by email and SMS, in the client's language", async () => {
    const now = new Date("2030-03-10T08:00:00Z");
    const { client } = await clientWithInterview({ email: true, sms: true, lang: "ru", at: new Date("2030-03-11T07:30:00Z") });
    const first = await dispatchClientReminders(now, deps);
    expect(first.clientSent).toBe(2);
    expect(sent.map((s) => s.channel).sort()).toEqual(["email", "sms"]);
    expect(sent.find((s) => s.channel === "sms")!.to).toBe("+37498948290");
    expect(sent[0].body).toMatch(/Arman/);
    expect(sent.find((s) => s.channel === "email")!.body).toMatch(/собеседовани/i); // Russian text
    // the scheduler runs again a minute later: nothing is sent twice
    const again = await dispatchClientReminders(new Date(now.getTime() + 60_000), deps);
    expect(again.clientSent).toBe(0);
    expect(sent).toHaveLength(2);
    const log = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM client_messages WHERE client_id=$1", [client.id]));
    expect(log.map((l) => l.status)).toEqual(["sent", "sent"]);
  });

  it("after a scheduler outage sends only the closest reminder, not a burst of stale ones", async () => {
    const now = new Date("2031-05-01T09:00:00Z");
    const { client } = await clientWithInterview({ sms: true, at: new Date("2031-05-01T10:00:00Z") }); // both 1-day and 2-hour moments have passed
    await dispatchClientReminders(now, deps);
    expect(sent).toHaveLength(1);
    const log = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM client_messages WHERE client_id=$1 ORDER BY status", [client.id]));
    expect(log.map((l) => l.status)).toEqual(["sent", "skipped"]);
  });

  it("a rescheduled interview gets fresh reminders for the new time", async () => {
    const now = new Date("2032-01-10T08:00:00Z");
    const { client } = await clientWithInterview({ email: true, at: new Date("2032-01-11T07:00:00Z") });
    await dispatchClientReminders(now, deps);
    expect(sent).toHaveLength(1);
    const [iv] = await withUser(owner, (q) => q.query<{ id: string }>("SELECT id FROM interviews WHERE client_id=$1", [client.id]));
    await withUser(owner, (q) => updateInterview(q, owner, iv.id, { interview_at: "2032-01-20T07:00:00Z" }, now));
    await dispatchClientReminders(new Date("2032-01-19T08:00:00Z"), deps);
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toMatch(/20/);
  });

  it("is switched off entirely by the owner's setting", async () => {
    await withSystem((q) => q.query("UPDATE user_preferences SET client_reminders_enabled=false WHERE user_id=$1", [owner]));
    const now = new Date("2033-02-02T08:00:00Z");
    await clientWithInterview({ email: true, sms: true, at: new Date("2033-02-02T09:00:00Z") });
    expect((await dispatchClientReminders(now, deps)).clientSent).toBe(0);
    await withSystem((q) => q.query("UPDATE user_preferences SET client_reminders_enabled=true WHERE user_id=$1", [owner]));
  });
});

describe("messages sent by hand", () => {
  it("refuses a channel the client hasn't agreed to and records why", async () => {
    const { client } = await withUser(owner, (q) => createClient(q, owner, { full_name: "No Consent", phone: "098000000", notify_sms: false }));
    const r = await sendToClient(owner, { ...client, notify_email: false, notify_sms: false }, { channel: "sms", kind: "custom", body: "Hi" }, deps);
    expect(r?.status).toBe("skipped");
    expect(r?.error).toMatch(/agreed/);
    expect(sent).toHaveLength(0);
  });
  it("records a provider failure without throwing", async () => {
    const { client } = await withUser(owner, (q) => createClient(q, owner, { full_name: "Fail Case", phone: "098111111", notify_sms: true }));
    const r = await sendToClient(owner, { ...client, notify_email: false, notify_sms: true }, { channel: "sms", kind: "custom", body: "Hi" }, { ...deps, sms: async () => { throw new Error("SMS service error 21211: invalid number"); } });
    expect(r?.status).toBe("failed");
    expect(r?.error).toMatch(/21211/);
  });
  it("drafts a documents request listing what is still missing, in the client's language", async () => {
    const { client } = await withUser(owner, (q) => createClient(q, owner, { full_name: "Ani Petrosyan", preferred_language: "hy" }));
    const d = await withUser(owner, (q) => draftForClient(q, owner, client.id, "documents_request"));
    expect(d.lang).toBe("hy");
    expect(d.text).toMatch(/Ani/);
    expect(d.text).toMatch(/Անձնագիր/); // "Passport" in Armenian, from the default checklist
  });
  it("writes interview reminders in all three languages", () => {
    const f = { name: "Arman Simonyan", at: "2030-03-11T07:30:00Z", tz: "Asia/Yerevan", place: "U.S. Embassy Yerevan", phone: "+374 99 000000" };
    expect(interviewReminder("en", f).text).toMatch(/Hello Arman! A reminder of your U\.S\. visa interview on Monday, 11 March at 11:30/);
    expect(interviewReminder("hy", f).sms).toMatch(/Arman/);
    expect(interviewReminder("ru", f).subject).toMatch(/11:30/);
  });
});
