import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { freshDb, makeUser, withUser, withSystem, closeDriver } from "./helpers";
import { createClient, ClientInput, getClientDetail, updateChecklistItem, listClients, updateCase, softDeleteClient } from "@/lib/repo/clients";
import { createInterview, updateInterview, listInterviews, deleteInterview } from "@/lib/repo/interviews";
import { listEvents } from "@/lib/repo/calendar";
import { listReminders } from "@/lib/repo/tasks";
import { getDashboard } from "@/lib/repo/dashboard";
import { saveDocument, getDocumentForDownload, deleteDocument, purgeExpiredDocuments, listDocuments } from "@/lib/repo/documents";
import { eraseClient, exportAll } from "@/lib/repo/export";
import { globalSearch } from "@/lib/repo/search";
import { createNote } from "@/lib/repo/notes";
import { sniffUpload, safeFilename, getStorage } from "@/lib/storage";

const NOW = new Date("2026-11-01T06:59:00Z");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);

let uid: string;
let other: string;
let karen: { id: string; caseId: string };

beforeAll(async () => {
  await freshDb();
  uid = await makeUser("owner@example.com");
  other = await makeUser("other@example.com");
  karen = await withUser(uid, async (q) => {
    const r = await createClient(q, uid, ClientInput.parse({ full_name: "Karen Sargsyan", email: "karen@example.com", phone: "+37499000001", case: { visa_category: "B1/B2 Visitor", application_status: "Documents Pending", embassy: "U.S. Embassy Yerevan" } }));
    return { id: r.client.id, caseId: r.case.id };
  });
});
afterAll(async () => {
  fs.rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
  await closeDriver();
});

describe("acceptance: upcoming interviews", () => {
  let interviewId: string;
  let taskId: string;
  it("an interview appears in the calendar, the interview list and the dashboard widget", async () => {
    const iv = await withUser(uid, (q) => createInterview(q, uid, { client_id: karen.id, interview_at: "2026-11-04T06:30:00.000Z", reminder_offsets: [1440, 300] }, NOW));
    interviewId = iv.id;
    taskId = iv.task_id!;
    expect(iv.embassy).toBe("U.S. Embassy Yerevan"); // inherited from the case
    expect(iv.prep_checklist.length).toBeGreaterThan(3);
    expect(iv.docs_status).toBe("Missing");

    const events = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-04T00:00:00Z", end: "2026-11-05T00:00:00Z", interviews_only: "true" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ is_interview: true, category: "Visa Interview", location: "U.S. Embassy Yerevan", client_name: "Karen Sargsyan" });

    const list = await withUser(uid, (q) => listInterviews(q, uid, { scope: "upcoming", limit: 50 }));
    expect(list.map((i) => i.id)).toContain(iv.id);

    const dash = await withUser(uid, (q) => getDashboard(q, uid, "Asia/Yerevan", NOW));
    expect(dash.upcoming_interviews.map((i) => i.id)).toContain(iv.id);
    expect(dash.upcoming_interviews[0].client_name).toBe("Karen Sargsyan");
  });

  it("moves the case to 'Interview Scheduled' and creates the reminder schedule", async () => {
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    expect(d!.cases[0].application_status).toBe("Interview Scheduled");
    const rem = await withUser(uid, (q) => listReminders(q, uid, taskId));
    expect(rem.filter((r) => r.status === "pending").map((r) => r.remind_at).sort()).toEqual(["2026-11-03T06:30:00.000Z", "2026-11-04T01:30:00.000Z"]);
  });

  it("rescheduling an interview moves the event and rebuilds reminders", async () => {
    const iv = await withUser(uid, (q) => updateInterview(q, uid, interviewId, { interview_at: "2026-11-06T08:00:00.000Z" }, NOW));
    expect(iv.interview_at).toBe("2026-11-06T08:00:00.000Z");
    const ev = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-06T00:00:00Z", end: "2026-11-07T00:00:00Z" }));
    expect(ev.some((e) => e.task_id === taskId)).toBe(true);
    const pending = (await withUser(uid, (q) => listReminders(q, uid, taskId))).filter((r) => r.status === "pending").map((r) => r.remind_at).sort();
    expect(pending).toEqual(["2026-11-05T08:00:00.000Z", "2026-11-06T03:00:00.000Z"]);
  });

  it("dragging the calendar entry keeps the interview record in step", async () => {
    const ev = (await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-06T00:00:00Z", end: "2026-11-07T00:00:00Z" }))).find((e) => e.task_id === taskId)!;
    const { moveEvent } = await import("@/lib/repo/calendar");
    await withUser(uid, (q) => moveEvent(q, uid, ev.id, { starts_at: "2026-11-07T09:00:00.000Z" }));
    const iv = (await withUser(uid, (q) => listInterviews(q, uid, { scope: "all", limit: 50 }))).find((i) => i.id === interviewId)!;
    expect(iv.interview_at).toBe("2026-11-07T09:00:00.000Z");
  });

  it("recording an outcome completes the interview task and advances the case", async () => {
    await withUser(uid, (q) => updateInterview(q, uid, interviewId, { outcome: "Approved" }, NOW));
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    expect(d!.tasks.find((t) => t.id === taskId)!.status).toBe("completed");
    expect(d!.cases[0].application_status).toBe("Interview Completed");
    const upcoming = await withUser(uid, (q) => listInterviews(q, uid, { scope: "upcoming", limit: 50 }));
    expect(upcoming.map((i) => i.id)).not.toContain(interviewId);
  });

  it("deleting an interview removes it everywhere", async () => {
    const iv = await withUser(uid, (q) => createInterview(q, uid, { client_id: karen.id, interview_at: "2026-11-10T06:30:00.000Z" }, NOW));
    await withUser(uid, (q) => deleteInterview(q, uid, iv.id));
    expect((await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-10T00:00:00Z", end: "2026-11-11T00:00:00Z" }))).length).toBe(0);
  });

  it("will not schedule an interview for someone else's client", async () => {
    await expect(withUser(other, (q) => createInterview(q, other, { client_id: karen.id, interview_at: "2026-11-10T06:30:00.000Z" }, NOW))).rejects.toThrow(/existing client/);
  });
});

describe("upload validation", () => {
  it("accepts real files and checks the bytes, not the browser's claim", () => {
    expect(sniffUpload("scan.pdf", PDF)).toEqual({ ok: true, mime: "application/pdf" });
    expect(sniffUpload("photo.png", PNG)).toEqual({ ok: true, mime: "image/png" });
    expect(sniffUpload("evil.pdf", Buffer.from("<script>alert(1)</script>"))).toMatchObject({ ok: false });
    expect(sniffUpload("virus.exe", Buffer.from("MZ"))).toMatchObject({ ok: false });
    expect(sniffUpload("empty.pdf", Buffer.alloc(0))).toMatchObject({ ok: false });
    expect(sniffUpload("big.pdf", Buffer.concat([PDF, Buffer.alloc(16 * 1024 * 1024)]))).toMatchObject({ ok: false, error: expect.stringMatching(/15 MB/) });
  });
  it("sanitises filenames", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename('a"b<c>.pdf')).toBe("abc.pdf");
    expect(safeFilename("   ")).toBe("file");
  });
});

describe("acceptance: client document linking & privacy", () => {
  let docId: string;
  it("an uploaded document is stored privately, linked to the client and ticks the checklist", async () => {
    const doc = await withUser(uid, (q) => saveDocument(q, uid, { clientId: karen.id, category: "Passport", filename: "karen passport.pdf", body: PDF, notes: "photo page" }));
    docId = doc.id;
    expect(doc).toMatchObject({ category: "Passport", mime_type: "application/pdf", size_bytes: PDF.length });
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    expect(d!.documents.map((x) => x.id)).toContain(doc.id);
    expect(d!.checklist.find((c) => c.category === "Passport")).toMatchObject({ status: "received", document_id: doc.id });
    // the object key contains no filename or personal data and the file is retrievable only through storage
    const [row] = await withSystem((q) => q.query<{ storage_key: string }>("SELECT storage_key FROM documents WHERE id=$1", [doc.id]));
    expect(row.storage_key).not.toMatch(/karen|passport/i);
    expect((await getStorage().get(row.storage_key))!.body.equals(PDF)).toBe(true);
  });

  it("is invisible to another user: listing, downloading and searching all come back empty", async () => {
    expect(await withUser(other, (q) => listDocuments(q, other, { limit: 50 }))).toHaveLength(0);
    await expect(withUser(other, (q) => getDocumentForDownload(q, other, docId))).rejects.toThrow(/not found/i);
    expect(await withUser(other, (q) => globalSearch(q, other, { q: "passport" }))).toHaveLength(0);
    expect(await withUser(other, (q) => getClientDetail(q, other, karen.id))).toBeNull();
  });

  it("the audit trail records access but never the filename or contents", async () => {
    await withUser(uid, (q) => getDocumentForDownload(q, uid, docId));
    const logs = await withSystem((q) => q.query<{ action: string; summary: string; metadata: unknown }>("SELECT action, summary, metadata FROM activity_logs WHERE entity_type='document'"));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["document.uploaded", "document.accessed"]));
    expect(JSON.stringify(logs)).not.toMatch(/karen passport/i);
  });

  it("rejects a disguised file", async () => {
    await expect(withUser(uid, (q) => saveDocument(q, uid, { clientId: karen.id, category: "Other", filename: "x.pdf", body: Buffer.from("not a pdf") }))).rejects.toThrow(/contents/);
  });

  it("the checklist drives the interview's document status", async () => {
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    const required = d!.checklist.filter((c) => c.required && c.status === "missing");
    const iv = await withUser(uid, (q) => createInterview(q, uid, { client_id: karen.id, interview_at: "2026-11-20T06:30:00.000Z" }, NOW));
    expect(iv.docs_status).toBe("Partial"); // passport received, others missing
    for (const item of required) await withUser(uid, (q) => updateChecklistItem(q, uid, item.id, { status: "waived" }));
    const after = (await withUser(uid, (q) => listInterviews(q, uid, { scope: "all", limit: 50 }))).find((i) => i.id === iv.id)!;
    expect(after.docs_status).toBe("Complete");
  });

  it("deleting a document removes the file and reopens the checklist item", async () => {
    const [{ storage_key }] = await withSystem((q) => q.query<{ storage_key: string }>("SELECT storage_key FROM documents WHERE id=$1", [docId]));
    await withUser(uid, (q) => deleteDocument(q, uid, docId));
    expect(await getStorage().get(storage_key)).toBeNull();
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    expect(d!.checklist.find((c) => c.category === "Passport")!.status).toBe("missing");
  });
});

describe("retention, export and erasure", () => {
  it("retention only deletes files of cases closed for longer than the chosen period", async () => {
    const c = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Old Case", case: { application_status: "Case Closed" } }))));
    const active = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Active Case" }))));
    const a = await withUser(uid, (q) => saveDocument(q, uid, { clientId: c.client.id, category: "Other", filename: "old.pdf", body: PDF }));
    const b = await withUser(uid, (q) => saveDocument(q, uid, { clientId: active.client.id, category: "Other", filename: "active.pdf", body: PDF }));
    await withSystem((q) => q.query("UPDATE client_cases SET closed_at = now() - interval '400 days' WHERE client_id=$1", [c.client.id]));
    expect(await withUser(uid, (q) => purgeExpiredDocuments(q, uid, null))).toBe(0); // retention off by default
    expect(await withUser(uid, (q) => purgeExpiredDocuments(q, uid, 365))).toBe(1);
    const left = (await withUser(uid, (q) => listDocuments(q, uid, { limit: 100 }))).map((d) => d.id);
    expect(left).not.toContain(a.id);
    expect(left).toContain(b.id);
  });

  it("exports everything except secrets", async () => {
    const data = await withUser(uid, (q) => exportAll(q, uid));
    expect(data.clients.length).toBeGreaterThan(2);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/storage_key|refresh_token|password_hash|p256dh|auth_enc/);
  });

  it("permanently erases a client, their files, tasks and audit rows — but only when the exact name is typed", async () => {
    const c = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Erase Me" }))).client.id);
    const doc = await withUser(uid, (q) => saveDocument(q, uid, { clientId: c, category: "Other", filename: "x.pdf", body: PDF }));
    await withUser(uid, (q) => createNote(q, uid, { client_id: c, body: "secret note", kind: "note", pinned: false }));
    await withUser(uid, (q) => createInterview(q, uid, { client_id: c, interview_at: "2026-12-01T06:30:00.000Z" }, NOW));
    const [{ storage_key }] = await withSystem((q) => q.query<{ storage_key: string }>("SELECT storage_key FROM documents WHERE id=$1", [doc.id]));

    expect(await withUser(uid, (q) => eraseClient(q, uid, c, "wrong name"))).toBeNull();
    expect(await getStorage().get(storage_key)).not.toBeNull();

    expect(await withUser(uid, (q) => eraseClient(q, uid, c, "erase me"))).toEqual({ files_removed: 1 });
    expect(await getStorage().get(storage_key)).toBeNull();
    for (const t of ["clients", "notes", "documents", "interviews", "tasks"]) {
      const col = t === "clients" ? "id" : t === "tasks" ? "client_id" : t === "interviews" ? "client_id" : "client_id";
      const rows = await withSystem((q) => q.query(`SELECT 1 FROM ${t} WHERE ${col} = $1`, [c]));
      expect(rows, t).toHaveLength(0);
    }
    const logs = await withSystem((q) => q.query("SELECT 1 FROM activity_logs WHERE summary ILIKE '%Erase Me%'"));
    expect(logs).toHaveLength(0);
  });
});

describe("clients, dashboard and search", () => {
  it("lists clients with their case status, open tasks and missing documents", async () => {
    const list = await withUser(uid, (q) => listClients(q, uid, { q: "karen", limit: 50 }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ full_name: "Karen Sargsyan", visa_category: "B1/B2 Visitor" });
    expect(list[0].missing_docs).toBeGreaterThan(0);
  });
  it("filters by pipeline status", async () => {
    const closed = await withUser(uid, (q) => listClients(q, uid, { status: "Case Closed", limit: 50 }));
    expect(closed.every((c) => c.application_status === "Case Closed")).toBe(true);
  });
  it("changing a case's status is recorded in the client's timeline", async () => {
    await withUser(uid, (q) => updateCase(q, uid, karen.caseId, { application_status: "Administrative Processing", payment_status: "Paid" }));
    const d = await withUser(uid, (q) => getClientDetail(q, uid, karen.id));
    expect(d!.activity.map((a) => a.summary).join("\n")).toMatch(/status Interview Completed → Administrative Processing/);
  });
  it("global search finds clients, tasks, notes and documents across the workspace", async () => {
    await withUser(uid, (q) => createNote(q, uid, { client_id: karen.id, body: "Karen is nervous about the finances question", kind: "call", pinned: false }));
    const hits = await withUser(uid, (q) => globalSearch(q, uid, { q: "karen" }));
    const types = new Set(hits.map((h) => h.type));
    expect(types).toEqual(new Set(["client", "task", "event", "note"]));
    expect(hits.find((h) => h.type === "client")!.href).toBe(`/clients/${karen.id}`);
    const filtered = await withUser(uid, (q) => globalSearch(q, uid, { q: "karen", types: "clients" }));
    expect(filtered.every((h) => h.type === "client")).toBe(true);
    expect(await withUser(uid, (q) => globalSearch(q, uid, { q: "100%_%" }))).toEqual([]); // wildcard characters are escaped
  });
  it("archiving a client hides them and silences their reminders", async () => {
    const c = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Archive Me" }))).client.id);
    await withUser(uid, (q) => createInterview(q, uid, { client_id: c, interview_at: "2026-12-05T06:30:00.000Z" }, NOW));
    await withUser(uid, (q) => softDeleteClient(q, uid, c));
    expect(await withUser(uid, (q) => listClients(q, uid, { q: "Archive Me", limit: 5 }))).toHaveLength(0);
    const pend = await withSystem((q) => q.query("SELECT 1 FROM task_reminders r JOIN tasks t ON t.id=r.task_id WHERE t.client_id=$1 AND r.status='pending'", [c]));
    expect(pend).toHaveLength(0);
  });
  it("the dashboard reports pending applications, missing documents and clients needing follow-up", async () => {
    const later = new Date("2026-11-20T06:00:00Z");
    const dash = await withUser(uid, (q) => getDashboard(q, uid, "Asia/Yerevan", later));
    expect(dash.pending_applications.total).toBeGreaterThan(0);
    expect(dash.awaiting_documents.length).toBeGreaterThan(0);
    expect(dash.needs_follow_up.some((f) => f.days_since >= 7)).toBe(true);
    expect(dash.weekly).toHaveLength(7);
  });
});
