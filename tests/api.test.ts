import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Minimal stand-in for Next's request-scoped cookie jar so route handlers can run under vitest.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)),
  }),
  headers: async () => new Headers(),
}));
// Claude is replaced by a canned answer so the approval workflow can be exercised without the network.
let claudeAnswer: unknown = {};
vi.mock("@/lib/ai/claude", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, callClaudeTool: async () => claudeAnswer };
});

import { freshDb, withSystem, closeDriver } from "./helpers";
import { createUser } from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as listTasksRoute, POST as createTaskRoute } from "@/app/api/tasks/route";
import { POST as parseRoute } from "@/app/api/tasks/parse/route";
import { PATCH as patchTask } from "@/app/api/tasks/[id]/route";
import { POST as completeRoute } from "@/app/api/tasks/[id]/complete/route";
import { GET as calendarRoute } from "@/app/api/calendar/events/route";
import { POST as clientsPost } from "@/app/api/clients/route";
import { GET as cron } from "@/app/api/cron/dispatch/route";
import { GET as exportRoute } from "@/app/api/export/route";
import { POST as subscribe } from "@/app/api/push/subscribe/route";
import { POST as uploadRoute } from "@/app/api/documents/route";
import { GET as downloadRoute } from "@/app/api/documents/[id]/download/route";
import { PATCH as prefsPatch } from "@/app/api/preferences/route";

const ORIGIN = "http://localhost:3000";
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, host: "localhost:3000", "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

beforeAll(async () => {
  await freshDb();
  await createUser({ email: "info@usvisawithargishti.com", name: "Argishti", password: "GoodPass2026" });
});
afterAll(closeDriver);
beforeEach(() => jar.clear());

async function signIn() {
  const r = await login(req("POST", "/api/auth/login", { email: "info@usvisawithargishti.com", password: "GoodPass2026" }));
  expect(r.status).toBe(200);
}

describe("authentication & request protection", () => {
  it("rejects anonymous API calls", async () => {
    const r = await json(await listTasksRoute(req("GET", "/api/tasks")));
    expect(r.status).toBe(401);
  });
  it("signs in, sets a session and then allows access", async () => {
    await signIn();
    expect(jar.get("uva_session")).toBeTruthy();
    expect((await listTasksRoute(req("GET", "/api/tasks"))).status).toBe(200);
  });
  it("rejects wrong credentials with a generic message", async () => {
    const r = await json(await login(req("POST", "/api/auth/login", { email: "info@usvisawithargishti.com", password: "wrong-password" })));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("Incorrect email or password.");
    expect(jar.has("uva_session")).toBe(false);
  });
  it("blocks cross-site state-changing requests (CSRF)", async () => {
    await signIn();
    const r = await json(await createTaskRoute(req("POST", "/api/tasks", { title: "x" }, { origin: "https://evil.example" })));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf");
  });
  it("logging out ends the session", async () => {
    await signIn();
    await logout(req("POST", "/api/auth/logout", {}));
    expect(jar.has("uva_session")).toBe(false);
    expect((await listTasksRoute(req("GET", "/api/tasks"))).status).toBe(401);
  });
  it("validates input and returns readable errors", async () => {
    await signIn();
    const r = await json(await createTaskRoute(req("POST", "/api/tasks", { title: "" })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/title/i);
    const bad = await json(await createTaskRoute(new NextRequest(`${ORIGIN}/api/tasks`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000" }, body: "{nope" })));
    expect(bad.status).toBe(400);
  });
});

describe("acceptance: AI task creation requires explicit approval", () => {
  it("the parse step returns a preview and saves NOTHING; the task exists only after the owner confirms", async () => {
    await signIn();
    const c = await json(await clientsPost(req("POST", "/api/clients", { full_name: "Karen Sargsyan", phone: "+37499000001" })));
    expect(c.status).toBe(200);
    const clientId = c.body.client.id;

    // tomorrow relative to the real clock, whatever day the tests run on
    claudeAnswer = { title: "Call Karen — Visa Interview Preparation", category: "Interview Preparation", priority: "Normal", client_name: "Karen", date_basis: "tomorrow", time: "15:00", reminders_minutes_before: [300], missing_information: [], assumptions: [] };
    const p = await json(await parseRoute(req("POST", "/api/tasks/parse", { text: "Call Karen tomorrow at 3 PM to prepare him for his U.S. visa interview. Remind me five hours before." })));
    expect(p.status).toBe(200);
    expect(p.body.preview).toMatchObject({ title: "Call Karen — Visa Interview Preparation", category: "Interview Preparation", client_id: clientId, time: "15:00", reminder_offsets: [300] });
    expect(p.body.preview.due_at).toBeTruthy();

    // nothing saved yet
    expect((await json(await listTasksRoute(req("GET", "/api/tasks?view=all")))).body.tasks).toHaveLength(0);
    expect((await withSystem((q) => q.query("SELECT 1 FROM task_reminders"))).length).toBe(0);

    // the owner reviews, (here) edits the priority, and confirms
    const pv = p.body.preview;
    const saved = await json(await createTaskRoute(req("POST", "/api/tasks", {
      title: pv.title, category: pv.category, priority: "High", client_id: pv.client_id, due_at: pv.due_at, duration_minutes: pv.duration_minutes,
      reminder_offsets: pv.reminder_offsets, source: "ai", ai_original_text: pv.ai_original_text,
    })));
    expect(saved.status).toBe(200);
    expect(saved.body.task).toMatchObject({ source: "ai", priority: "High", status: "pending" });
    expect(saved.body.reminders).toHaveLength(1);
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const ev = await json(await calendarRoute(req("GET", `/api/calendar/events?start=${start}&end=${end}`)));
    expect(ev.body.events.some((e: { task_id: string }) => e.task_id === saved.body.task.id)).toBe(true);
  });

  it("is honest when AI is switched off", async () => {
    await signIn();
    await prefsPatch(req("PATCH", "/api/preferences", { ai_task_parsing: false }));
    const r = await json(await parseRoute(req("POST", "/api/tasks/parse", { text: "Call Karen tomorrow" })));
    expect(r.status).toBe(403);
    await prefsPatch(req("PATCH", "/api/preferences", { ai_task_parsing: true }));
  });
});

describe("tasks over HTTP", () => {
  it("complete → undo, and reschedule through PATCH", async () => {
    await signIn();
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const t = (await json(await createTaskRoute(req("POST", "/api/tasks", { title: "HTTP task", due_at: due, reminder_offsets: [60] })))).body.task;
    const moved = await json(await patchTask(req("PATCH", `/api/tasks/${t.id}`, { due_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }), ctx(t.id)));
    expect(moved.body.reminders).toHaveLength(1);
    const done = await json(await completeRoute(req("POST", `/api/tasks/${t.id}/complete`, {}), ctx(t.id)));
    expect(done.body.task.status).toBe("completed");
    const undo = await json(await completeRoute(req("POST", `/api/tasks/${t.id}/complete`, { undo: true }), ctx(t.id)));
    expect(undo.body.task.status).toBe("pending");
  });
  it("cannot read or modify a task that doesn't exist / belongs to someone else", async () => {
    await signIn();
    const r = await json(await patchTask(req("PATCH", "/api/tasks/00000000-0000-4000-8000-000000000000", { title: "x" }), ctx("00000000-0000-4000-8000-000000000000")));
    expect(r.status).toBe(404);
    const bad = await json(await patchTask(req("PATCH", "/api/tasks/not-a-uuid", { title: "x" }), ctx("not-a-uuid")));
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});

describe("cron endpoint", () => {
  it("requires the shared secret", async () => {
    expect((await cron(req("GET", "/api/cron/dispatch", undefined, { origin: "" }))).status).toBe(401);
    expect((await cron(req("GET", "/api/cron/dispatch", undefined, { authorization: "Bearer wrong" }))).status).toBe(401);
  });
  it("runs a dispatch tick with the right secret", async () => {
    const r = await json(await cron(req("GET", "/api/cron/dispatch", undefined, { authorization: "Bearer test-cron-secret-0123456789" })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, claimed: expect.any(Number), errors: [] });
  });
});

describe("push subscription endpoint", () => {
  it("reports clearly when the server has no VAPID keys", async () => {
    await signIn();
    const r = await json(await subscribe(req("POST", "/api/push/subscribe", { endpoint: "https://fcm.example/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(12) } })));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("push_not_configured");
  });
  it("stores a subscription when configured, and refuses non-https endpoints", async () => {
    await signIn();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "BPublicKeyForTesting");
    vi.stubEnv("VAPID_PRIVATE_KEY", "privateKeyForTesting");
    const ok = await json(await subscribe(req("POST", "/api/push/subscribe", { endpoint: "https://fcm.example/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(12) } })));
    expect(ok.status).toBe(200);
    const http = await json(await subscribe(req("POST", "/api/push/subscribe", { endpoint: "http://insecure.example/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(12) } })));
    expect(http.status).toBe(400);
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
  });
});

describe("documents over HTTP", () => {
  it("uploads with multipart, downloads only when signed in, and rejects fake files", async () => {
    await signIn();
    const c = (await json(await clientsPost(req("POST", "/api/clients", { full_name: "Doc Client" })))).body.client;
    const form = new FormData();
    form.set("file", new File([Buffer.from("%PDF-1.4\n%%EOF")], "scan.pdf", { type: "application/pdf" }));
    form.set("client_id", c.id);
    form.set("category", "Passport");
    const up = await uploadRoute(new NextRequest(`${ORIGIN}/api/documents`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000" }, body: form }));
    expect(up.status).toBe(200);
    const doc = (await up.json()).document;

    const dl = await downloadRoute(req("GET", `/api/documents/${doc.id}/download`), ctx(doc.id));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("cache-control")).toContain("no-store");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await dl.arrayBuffer()).toString()).toContain("%PDF-1.4");

    const fake = new FormData();
    fake.set("file", new File([Buffer.from("MZ not a pdf")], "x.pdf"));
    fake.set("client_id", c.id);
    fake.set("category", "Other");
    const bad = await uploadRoute(new NextRequest(`${ORIGIN}/api/documents`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000" }, body: fake }));
    expect(bad.status).toBe(400);

    jar.clear(); // signed out
    expect((await downloadRoute(req("GET", `/api/documents/${doc.id}/download`), ctx(doc.id))).status).toBe(401);
  });
});

describe("export", () => {
  it("downloads a JSON export as an attachment", async () => {
    await signIn();
    const r = await exportRoute(req("GET", "/api/export"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const data = await r.json();
    expect(data.clients.length).toBeGreaterThan(0);
  });
});
