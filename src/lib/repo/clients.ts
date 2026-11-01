import { z } from "zod";
import { one, type Q } from "../db";
import {
  APPLICATION_STATUSES, DEFAULT_DOCUMENT_CHECKLIST, PAYMENT_STATUSES, PREP_STATUSES, VISA_CATEGORIES,
} from "../constants";
import type { CaseRow, ClientRow, DocumentRow, InterviewRow, NoteRow, Task } from "../types";
import { notFound, zId } from "../errors";
import { logActivity } from "../audit";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullish());

export const CaseInput = z.object({
  visa_category: z.string().trim().min(1).max(80).default(VISA_CATEGORIES[0]),
  application_status: z.enum(APPLICATION_STATUSES).default("New Client"),
  embassy: optText(160),
  ds160_confirmation: optText(60),
  payment_status: z.enum(PAYMENT_STATUSES).default("Unpaid"),
  interview_prep_status: z.enum(PREP_STATUSES).default("Not Started"),
});
export type CaseInputT = z.infer<typeof CaseInput>;

export const ClientInput = z.object({
  full_name: z.string().trim().min(1, "Enter the client's full name").max(160),
  email: z.preprocess(blank, z.string().trim().email("That email address looks wrong").max(200).nullish()),
  phone: optText(40),
  whatsapp: optText(40),
  preferred_language: optText(20),
  case: CaseInput.optional(),
});
export const ClientPatch = ClientInput.omit({ case: true }).partial();
export const CasePatch = CaseInput.partial();

// ───────────── clients ─────────────
export async function createClient(q: Q, userId: string, input: z.infer<typeof ClientInput>) {
  const [client] = await q.query<ClientRow>(
    `INSERT INTO clients (user_id, full_name, email, phone, whatsapp, preferred_language) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, input.full_name, input.email ?? null, input.phone ?? null, input.whatsapp ?? null, input.preferred_language ?? null],
  );
  const kase = await createCase(q, userId, client.id, input.case ?? CaseInput.parse({}));
  await logActivity(q, { userId, clientId: client.id, entityType: "client", entityId: client.id, action: "client.created", summary: `Client created: ${client.full_name}` });
  return { client, case: kase };
}

export async function updateClient(q: Q, userId: string, id: string, patch: z.infer<typeof ClientPatch>) {
  const existing = await one<ClientRow>(q, "SELECT * FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!existing) throw notFound("Client not found");
  const m = { ...existing, ...patch };
  const [client] = await q.query<ClientRow>(
    `UPDATE clients SET full_name=$3, email=$4, phone=$5, whatsapp=$6, preferred_language=$7, updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, userId, m.full_name, m.email ?? null, m.phone ?? null, m.whatsapp ?? null, m.preferred_language ?? null],
  );
  await logActivity(q, { userId, clientId: id, entityType: "client", entityId: id, action: "client.updated", summary: `Client details updated: ${client.full_name}` });
  return client;
}

export async function softDeleteClient(q: Q, userId: string, id: string) {
  const c = await one<ClientRow>(q, "SELECT * FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!c) throw notFound("Client not found");
  await q.query("UPDATE clients SET deleted_at=now() WHERE id=$1 AND user_id=$2", [id, userId]);
  await q.query("UPDATE client_cases SET deleted_at=now() WHERE client_id=$1 AND user_id=$2", [id, userId]);
  // Pending tasks of an archived client no longer need reminders.
  await q.query(
    `UPDATE task_reminders SET status='canceled', updated_at=now()
      WHERE status='pending' AND task_id IN (SELECT id FROM tasks WHERE client_id=$1 AND user_id=$2)`,
    [id, userId],
  );
  await logActivity(q, { userId, clientId: id, entityType: "client", entityId: id, action: "client.archived", summary: `Client archived: ${c.full_name}` });
}

export interface ClientListItem extends ClientRow {
  case_id: string | null;
  visa_category: string | null;
  application_status: string | null;
  embassy: string | null;
  payment_status: string | null;
  next_interview_at: string | null;
  open_tasks: number;
  missing_docs: number;
  last_touch_at: string | null;
}

export const ClientListQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  visa: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function listClients(q: Q, userId: string, f: z.infer<typeof ClientListQuery>): Promise<ClientListItem[]> {
  const where = ["c.user_id = $1", "c.deleted_at IS NULL"];
  const params: unknown[] = [userId];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    const ph = p(like);
    where.push(`(c.full_name ILIKE ${ph} OR c.email ILIKE ${ph} OR c.phone ILIKE ${ph} OR c.whatsapp ILIKE ${ph} OR c.client_code ILIKE ${ph})`);
  }
  if (f.status) where.push(`k.application_status = ${p(f.status)}`);
  if (f.visa) where.push(`k.visa_category = ${p(f.visa)}`);
  return q.query<ClientListItem>(
    `SELECT c.*, k.id AS case_id, k.visa_category, k.application_status, k.embassy, k.payment_status,
            (SELECT min(i.interview_at) FROM interviews i WHERE i.client_id = c.id AND i.deleted_at IS NULL AND i.interview_at >= now() AND i.outcome = 'Pending') AS next_interview_at,
            (SELECT count(*)::int FROM tasks t WHERE t.client_id = c.id AND t.status = 'pending' AND t.deleted_at IS NULL) AS open_tasks,
            (SELECT count(*)::int FROM document_checklists d WHERE d.case_id = k.id AND d.required AND d.status = 'missing') AS missing_docs,
            GREATEST(
              (SELECT max(n.created_at) FROM notes n WHERE n.client_id = c.id AND n.deleted_at IS NULL),
              (SELECT max(t.completed_at) FROM tasks t WHERE t.client_id = c.id),
              c.created_at) AS last_touch_at
       FROM clients c
       LEFT JOIN LATERAL (SELECT * FROM client_cases kk WHERE kk.client_id = c.id AND kk.deleted_at IS NULL ORDER BY (kk.application_status = 'Case Closed'), kk.opened_at DESC LIMIT 1) k ON true
      WHERE ${where.join(" AND ")}
      ORDER BY (k.application_status IN ('Case Closed','Visa Issued','Visa Refused')) ASC, c.updated_at DESC
      LIMIT ${f.limit}`,
    params,
  );
}

export async function getClient(q: Q, userId: string, id: string) {
  return one<ClientRow>(q, "SELECT * FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
}

export async function getClientDetail(q: Q, userId: string, id: string) {
  const client = await getClient(q, userId, id);
  if (!client) return null;
  const [cases, interviews, tasks, notes, documents, links, activity, checklist] = await Promise.all([
    q.query<CaseRow>("SELECT * FROM client_cases WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY opened_at DESC", [id, userId]),
    q.query<InterviewRow>("SELECT * FROM interviews WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY interview_at DESC", [id, userId]),
    q.query<Task>(
      `SELECT * FROM tasks WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL
        ORDER BY (status='completed') ASC, due_at ASC NULLS LAST, completed_at DESC LIMIT 100`, [id, userId]),
    q.query<NoteRow>("SELECT * FROM notes WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY pinned DESC, created_at DESC LIMIT 200", [id, userId]),
    q.query<DocumentRow>("SELECT id, client_id, case_id, category, filename, mime_type, size_bytes, notes, source, uploaded_at FROM documents WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY uploaded_at DESC", [id, userId]),
    q.query<{ id: string; thread_id: string; subject: string | null; snippet: string | null; from_addr: string | null; last_message_at: string | null; status: string; origin: string }>(
      "SELECT id, thread_id, subject, snippet, from_addr, last_message_at, status, origin FROM gmail_thread_links WHERE client_id=$1 AND user_id=$2 AND status <> 'dismissed' ORDER BY last_message_at DESC NULLS LAST", [id, userId]),
    q.query<{ id: string; action: string; summary: string; created_at: string }>(
      "SELECT id, action, summary, created_at FROM activity_logs WHERE client_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 60", [id, userId]),
    q.query<ChecklistItem>("SELECT id, case_id, label, category, required, status, document_id, sort_order FROM document_checklists WHERE client_id=$1 AND user_id=$2 ORDER BY sort_order", [id, userId]),
  ]);
  return { client, cases, interviews, tasks, notes, documents, links, activity, checklist };
}

// ───────────── cases & checklist ─────────────
export interface ChecklistItem {
  id: string;
  case_id: string;
  label: string;
  category: string;
  required: boolean;
  status: "missing" | "received" | "waived";
  document_id: string | null;
  sort_order: number;
}

export async function createCase(q: Q, userId: string, clientId: string, input: CaseInputT) {
  const [kase] = await q.query<CaseRow>(
    `INSERT INTO client_cases (user_id, client_id, visa_category, application_status, embassy, ds160_confirmation, payment_status, interview_prep_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [userId, clientId, input.visa_category, input.application_status, input.embassy ?? null, input.ds160_confirmation ?? null, input.payment_status, input.interview_prep_status],
  );
  let i = 0;
  for (const item of DEFAULT_DOCUMENT_CHECKLIST) {
    await q.query(
      "INSERT INTO document_checklists (user_id, client_id, case_id, label, category, required, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [userId, clientId, kase.id, item.label, item.category, item.required, i++],
    );
  }
  return kase;
}

export async function updateCase(q: Q, userId: string, caseId: string, patch: z.infer<typeof CasePatch>) {
  const existing = await one<CaseRow & { client_id: string }>(q, "SELECT * FROM client_cases WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [caseId, userId]);
  if (!existing) throw notFound("Case not found");
  const m = { ...existing, ...patch };
  const closed = m.application_status === "Case Closed" ? existing.closed_at ?? new Date().toISOString() : null;
  const [row] = await q.query<CaseRow>(
    `UPDATE client_cases SET visa_category=$3, application_status=$4, embassy=$5, ds160_confirmation=$6, payment_status=$7,
            interview_prep_status=$8, closed_at=$9, updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING *`,
    [caseId, userId, m.visa_category, m.application_status, m.embassy ?? null, m.ds160_confirmation ?? null, m.payment_status, m.interview_prep_status, closed],
  );
  await q.query("UPDATE clients SET updated_at = now() WHERE id = $1", [existing.client_id]);
  const changes: string[] = [];
  if (patch.application_status && patch.application_status !== existing.application_status) changes.push(`status ${existing.application_status} → ${patch.application_status}`);
  if (patch.payment_status && patch.payment_status !== existing.payment_status) changes.push(`payment ${existing.payment_status} → ${patch.payment_status}`);
  await logActivity(q, {
    userId, clientId: existing.client_id, entityType: "case", entityId: caseId,
    action: patch.application_status && patch.application_status !== existing.application_status ? "case.status_changed" : "case.updated",
    summary: changes.length ? `Case updated: ${changes.join(", ")}` : "Case details updated",
  });
  return row;
}

/** Keeps upcoming interviews' "documents status" in step with the checklist (all required received → Complete). */
export async function recomputeDocsStatus(q: Q, userId: string, caseId: string) {
  const [s] = await q.query<{ required: number; received: number }>(
    `SELECT count(*) FILTER (WHERE required AND status <> 'waived')::int AS required,
            count(*) FILTER (WHERE required AND status = 'received')::int AS received
       FROM document_checklists WHERE case_id = $1 AND user_id = $2`,
    [caseId, userId],
  );
  const status = s.required === 0 || s.received >= s.required ? "Complete" : s.received > 0 ? "Partial" : "Missing";
  await q.query(
    "UPDATE interviews SET docs_status=$3, updated_at=now() WHERE case_id=$1 AND user_id=$2 AND deleted_at IS NULL AND outcome='Pending'",
    [caseId, userId, status],
  );
  return status;
}

export const ChecklistPatch = z.object({
  status: z.enum(["missing", "received", "waived"]).optional(),
  document_id: zId.nullish(),
  label: z.string().trim().min(1).max(160).optional(),
  required: z.boolean().optional(),
});

export async function updateChecklistItem(q: Q, userId: string, itemId: string, patch: z.infer<typeof ChecklistPatch>) {
  const item = await one<ChecklistItem & { client_id: string }>(q, "SELECT * FROM document_checklists WHERE id=$1 AND user_id=$2", [itemId, userId]);
  if (!item) throw notFound("Checklist item not found");
  const m = { ...item, ...patch };
  await q.query(
    "UPDATE document_checklists SET status=$3, document_id=$4, label=$5, required=$6, updated_at=now() WHERE id=$1 AND user_id=$2",
    [itemId, userId, m.status, patch.status === "missing" ? null : m.document_id ?? null, m.label, m.required],
  );
  await recomputeDocsStatus(q, userId, item.case_id);
  return one<ChecklistItem>(q, "SELECT id, case_id, label, category, required, status, document_id, sort_order FROM document_checklists WHERE id=$1", [itemId]);
}

export async function addChecklistItem(q: Q, userId: string, caseId: string, label: string, category = "Other", required = false) {
  const kase = await one<{ client_id: string }>(q, "SELECT client_id FROM client_cases WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [caseId, userId]);
  if (!kase) throw notFound("Case not found");
  const [row] = await q.query<ChecklistItem>(
    `INSERT INTO document_checklists (user_id, client_id, case_id, label, category, required, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(sort_order),0)+1 FROM document_checklists WHERE case_id=$3)) RETURNING id, case_id, label, category, required, status, document_id, sort_order`,
    [userId, kase.client_id, caseId, label, category, required],
  );
  await recomputeDocsStatus(q, userId, caseId);
  return row;
}
