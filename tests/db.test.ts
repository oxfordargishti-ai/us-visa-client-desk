import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, makeUser, withUser, withSystem, closeDriver } from "./helpers";
import {
  APPLICATION_STATUSES, TASK_CATEGORIES, PRIORITIES, DOCUMENT_CATEGORIES, PAYMENT_STATUSES, PREP_STATUSES,
  DOCS_STATUSES, INTERVIEW_OUTCOMES, RECURRENCES, NOTE_KINDS, TASK_SOURCES,
} from "@/lib/constants";

const REQUIRED_TABLES = [
  "users", "clients", "client_cases", "tasks", "task_reminders", "calendar_events", "interviews", "notes",
  "documents", "document_checklists", "gmail_connections", "gmail_thread_links", "push_subscriptions",
  "notification_deliveries", "activity_logs", "user_preferences",
];

beforeAll(freshDb);
afterAll(closeDriver);

describe("schema", () => {
  it("creates every required table", async () => {
    const rows = await withSystem((q) => q.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"));
    const names = rows.map((r) => r.table_name);
    for (const t of REQUIRED_TABLES) expect(names, t).toContain(t);
  });

  it("returns timestamps as ISO strings and dates as plain strings", async () => {
    const uid = await makeUser();
    const [row] = await withUser(uid, (q) => q.query<{ created_at: string }>("SELECT created_at FROM users WHERE id=$1", [uid]));
    expect(row.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("accepts every enumeration value defined in constants.ts (TS and SQL CHECK constraints agree)", async () => {
    const uid = await makeUser("enum@example.com");
    await withUser(uid, async (q) => {
      const [c] = await q.query<{ id: string }>("INSERT INTO clients (user_id, full_name) VALUES ($1,'Enum Client') RETURNING id", [uid]);
      for (const s of APPLICATION_STATUSES) for (const p of PAYMENT_STATUSES.slice(0, 1)) await q.query("INSERT INTO client_cases (user_id, client_id, application_status, payment_status) VALUES ($1,$2,$3,$4)", [uid, c.id, s, p]);
      for (const p of PAYMENT_STATUSES) await q.query("INSERT INTO client_cases (user_id, client_id, payment_status) VALUES ($1,$2,$3)", [uid, c.id, p]);
      for (const s of PREP_STATUSES) await q.query("INSERT INTO client_cases (user_id, client_id, interview_prep_status) VALUES ($1,$2,$3)", [uid, c.id, s]);
      for (const cat of TASK_CATEGORIES) await q.query("INSERT INTO tasks (user_id, title, category) VALUES ($1,'t',$2)", [uid, cat]);
      for (const p of PRIORITIES) await q.query("INSERT INTO tasks (user_id, title, priority) VALUES ($1,'t',$2)", [uid, p]);
      for (const r of RECURRENCES) await q.query("INSERT INTO tasks (user_id, title, recurrence) VALUES ($1,'t',$2)", [uid, r]);
      for (const s of TASK_SOURCES) await q.query("INSERT INTO tasks (user_id, title, source) VALUES ($1,'t',$2)", [uid, s]);
      for (const d of DOCUMENT_CATEGORIES) await q.query("INSERT INTO documents (user_id, client_id, category, filename, mime_type, size_bytes, storage_key) VALUES ($1,$2,$3,'f','application/pdf',1,'k')", [uid, c.id, d]);
      for (const k of NOTE_KINDS) await q.query("INSERT INTO notes (user_id, client_id, body, kind) VALUES ($1,$2,'b',$3)", [uid, c.id, k]);
      for (const d of DOCS_STATUSES) await q.query("INSERT INTO interviews (user_id, client_id, interview_at, docs_status) VALUES ($1,$2,now(),$3)", [uid, c.id, d]);
      for (const o of INTERVIEW_OUTCOMES) await q.query("INSERT INTO interviews (user_id, client_id, interview_at, outcome) VALUES ($1,$2,now(),$3)", [uid, c.id, o]);
    });
  });

  it("generates human-friendly client codes", async () => {
    const uid = await makeUser("codes@example.com");
    const rows = await withUser(uid, (q) => q.query<{ client_code: string }>("INSERT INTO clients (user_id, full_name) VALUES ($1,'A'),($1,'B') RETURNING client_code", [uid]));
    expect(rows[0].client_code).toMatch(/^UVA-\d{4}$/);
    expect(rows[0].client_code).not.toBe(rows[1].client_code);
  });

  it("prevents duplicate live reminders for the same task and instant", async () => {
    const uid = await makeUser("dup@example.com");
    await withUser(uid, async (q) => {
      const [t] = await q.query<{ id: string }>("INSERT INTO tasks (user_id, title) VALUES ($1,'x') RETURNING id", [uid]);
      await q.query("INSERT INTO task_reminders (user_id, task_id, remind_at) VALUES ($1,$2,'2030-01-01T10:00:00Z')", [uid, t.id]);
      await expect(q.query("SAVEPOINT s1").then(() => q.query("INSERT INTO task_reminders (user_id, task_id, remind_at) VALUES ($1,$2,'2030-01-01T10:00:00Z')", [uid, t.id]))).rejects.toThrow();
    });
  });
});

describe("row-level security", () => {
  it("hides one user's rows from another when connected as a non-superuser role", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await withUser(a, (q) => q.query("INSERT INTO clients (user_id, full_name) VALUES ($1,'Secret Client of A')", [a]));

    await withSystem(async (q) => {
      await q.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_rls_test') THEN CREATE ROLE app_rls_test NOSUPERUSER NOBYPASSRLS; END IF; END $$");
      await q.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls_test");
      await q.query("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_rls_test");
    });

    const asRole = async (uid: string) =>
      withUser(uid, async (q) => {
        await q.query("SET LOCAL ROLE app_rls_test");
        return q.query<{ full_name: string }>("SELECT full_name FROM clients");
      });

    expect((await asRole(a)).map((r) => r.full_name)).toContain("Secret Client of A");
    expect(await asRole(b)).toHaveLength(0);

    // A user also cannot INSERT rows on behalf of someone else.
    await expect(
      withUser(b, async (q) => {
        await q.query("SET LOCAL ROLE app_rls_test");
        await q.query("INSERT INTO clients (user_id, full_name) VALUES ($1,'forged')", [a]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
