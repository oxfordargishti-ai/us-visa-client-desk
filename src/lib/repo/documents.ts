import { z } from "zod";
import crypto from "node:crypto";
import { one, type Q } from "../db";
import { DOCUMENT_CATEGORIES } from "../constants";
import type { DocumentRow } from "../types";
import { HttpError, notFound, zId } from "../errors";
import { logActivity } from "../audit";
import { recomputeDocsStatus } from "./clients";
import { getStorage, safeFilename, sniffUpload } from "../storage";
import { sha256 } from "../crypto";

export const DocumentPatch = z.object({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  notes: z.string().max(2000).nullish(),
  filename: z.string().trim().min(1).max(150).optional(),
});

export const DocumentListQuery = z.object({
  client_id: zId.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function listDocuments(q: Q, userId: string, f: z.infer<typeof DocumentListQuery>): Promise<DocumentRow[]> {
  const params: unknown[] = [userId];
  const where = ["d.user_id=$1", "d.deleted_at IS NULL"];
  if (f.client_id) where.push(`d.client_id=$${params.push(f.client_id)}`);
  if (f.category) where.push(`d.category=$${params.push(f.category)}`);
  if (f.q) {
    const ph = `$${params.push(`%${f.q.replace(/[%_]/g, "\\$&")}%`)}`;
    where.push(`(d.filename ILIKE ${ph} OR d.notes ILIKE ${ph} OR c.full_name ILIKE ${ph})`);
  }
  return q.query<DocumentRow>(
    `SELECT d.id, d.client_id, d.case_id, d.category, d.filename, d.mime_type, d.size_bytes, d.notes, d.source, d.uploaded_at, c.full_name AS client_name
       FROM documents d JOIN clients c ON c.id = d.client_id
      WHERE ${where.join(" AND ")} ORDER BY d.uploaded_at DESC LIMIT ${f.limit}`,
    params,
  );
}

export interface UploadInput {
  clientId: string;
  caseId?: string | null;
  category: (typeof DOCUMENT_CATEGORIES)[number];
  filename: string;
  body: Buffer;
  notes?: string | null;
  source?: "upload" | "gmail";
  sourceRef?: string | null;
}

/** Validates the bytes, stores the file privately, records it, and ticks the matching checklist item. */
export async function saveDocument(q: Q, userId: string, input: UploadInput) {
  const client = await one<{ id: string }>(q, "SELECT id FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [input.clientId, userId]);
  if (!client) throw new HttpError(400, "Choose an existing client for this document.", "bad_client");
  const filename = safeFilename(input.filename);
  const sniff = sniffUpload(filename, input.body);
  if (!sniff.ok) throw new HttpError(400, sniff.error, "bad_file");

  let caseId = input.caseId ?? null;
  if (caseId) {
    const k = await one(q, "SELECT 1 AS x FROM client_cases WHERE id=$1 AND client_id=$2 AND user_id=$3 AND deleted_at IS NULL", [caseId, input.clientId, userId]);
    if (!k) throw new HttpError(400, "That case does not belong to this client.", "bad_case");
  } else {
    const k = await one<{ id: string }>(q, "SELECT id FROM client_cases WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY (application_status='Case Closed'), opened_at DESC LIMIT 1", [input.clientId, userId]);
    caseId = k?.id ?? null;
  }

  const key = `${userId}/${input.clientId}/${crypto.randomUUID()}`; // no filename or personal data in the object key
  await getStorage().put(key, input.body, sniff.mime);
  let doc: DocumentRow;
  try {
    [doc] = await q.query<DocumentRow>(
      `INSERT INTO documents (user_id, client_id, case_id, category, filename, mime_type, size_bytes, storage_key, checksum_sha256, notes, source, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, client_id, case_id, category, filename, mime_type, size_bytes, notes, source, uploaded_at`,
      [userId, input.clientId, caseId, input.category, filename, sniff.mime, input.body.length, key, sha256(input.body), input.notes ?? null, input.source ?? "upload", input.sourceRef ?? null],
    );
  } catch (e) {
    await getStorage().delete(key).catch(() => {});
    throw e;
  }
  if (caseId) {
    const item = await one<{ id: string }>(
      q,
      "SELECT id FROM document_checklists WHERE case_id=$1 AND user_id=$2 AND category=$3 AND status='missing' ORDER BY sort_order LIMIT 1",
      [caseId, userId, input.category],
    );
    if (item) await q.query("UPDATE document_checklists SET status='received', document_id=$2, updated_at=now() WHERE id=$1", [item.id, doc.id]);
    await recomputeDocsStatus(q, userId, caseId);
  }
  // The audit trail records THAT a document was added — never its contents or even its filename.
  await logActivity(q, { userId, clientId: input.clientId, entityType: "document", entityId: doc.id, action: "document.uploaded", summary: `Document added (${input.category})`, metadata: { source: input.source ?? "upload", size: input.body.length } });
  return doc;
}

export async function getDocumentForDownload(q: Q, userId: string, id: string) {
  const d = await one<{ id: string; client_id: string; filename: string; mime_type: string; storage_key: string }>(
    q, "SELECT id, client_id, filename, mime_type, storage_key FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!d) throw notFound("Document not found");
  await logActivity(q, { userId, clientId: d.client_id, entityType: "document", entityId: id, action: "document.accessed", summary: "Document opened or downloaded" });
  return d;
}

export async function updateDocument(q: Q, userId: string, id: string, patch: z.infer<typeof DocumentPatch>) {
  const ex = await one<DocumentRow>(q, "SELECT * FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!ex) throw notFound("Document not found");
  const m = { ...ex, ...patch };
  const [row] = await q.query<DocumentRow>(
    `UPDATE documents SET category=$3, notes=$4, filename=$5, updated_at=now() WHERE id=$1 AND user_id=$2
     RETURNING id, client_id, case_id, category, filename, mime_type, size_bytes, notes, source, uploaded_at`,
    [id, userId, m.category, m.notes ?? null, patch.filename ? safeFilename(patch.filename) : ex.filename],
  );
  return row;
}

export async function deleteDocument(q: Q, userId: string, id: string, reason = "document.deleted") {
  const d = await one<{ id: string; client_id: string; case_id: string | null; storage_key: string }>(q, "SELECT id, client_id, case_id, storage_key FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!d) throw notFound("Document not found");
  await getStorage().delete(d.storage_key).catch((e) => console.error("[storage] delete failed:", (e as Error).message));
  await q.query("UPDATE documents SET deleted_at=now() WHERE id=$1", [id]);
  await q.query("UPDATE document_checklists SET status='missing', document_id=NULL, updated_at=now() WHERE document_id=$1 AND status='received'", [id]);
  if (d.case_id) await recomputeDocsStatus(q, userId, d.case_id);
  await logActivity(q, { userId, clientId: d.client_id, entityType: "document", entityId: id, action: reason, summary: "Document deleted" });
}

/** Retention policy: delete files of cases that have been closed for longer than the owner's chosen number of days. */
export async function purgeExpiredDocuments(q: Q, userId: string, retentionDays: number | null): Promise<number> {
  if (!retentionDays) return 0;
  const rows = await q.query<{ id: string }>(
    `SELECT d.id FROM documents d
      WHERE d.user_id=$1 AND d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM client_cases k WHERE k.client_id = d.client_id AND k.deleted_at IS NULL AND (k.closed_at IS NULL OR k.closed_at > now() - ($2 || ' days')::interval))
        AND EXISTS (SELECT 1 FROM client_cases k WHERE k.client_id = d.client_id AND k.deleted_at IS NULL)`,
    [userId, String(retentionDays)],
  );
  for (const r of rows) await deleteDocument(q, userId, r.id, "document.retention_purged");
  return rows.length;
}
