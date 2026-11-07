import type { Q } from "../db";
import { notFound } from "../errors";
import { logActivity } from "../audit";
import { getStorage } from "../storage";

/** Everything the owner has stored, as one JSON-serialisable object. Secrets (tokens, push keys, password hashes) are never included. */
export async function exportAll(q: Q, userId: string) {
  const own = (table: string, extra = "") => q.query(`SELECT * FROM ${table} WHERE user_id = $1 ${extra}`, [userId]);
  const [prefs, clients, cases, tasks, reminders, events, interviews, notes, documents, checklists, links, deliveries, activity, paymentRequests, onlinePayments] = await Promise.all([
    own("user_preferences"), own("clients"), own("client_cases"), own("tasks"), own("task_reminders"), own("calendar_events"), own("interviews"),
    own("notes"), q.query("SELECT id, client_id, case_id, category, filename, mime_type, size_bytes, notes, source, uploaded_at, deleted_at FROM documents WHERE user_id=$1", [userId]),
    own("document_checklists"), q.query("SELECT id, client_id, thread_id, subject, snippet, from_addr, last_message_at, status, origin FROM gmail_thread_links WHERE user_id=$1", [userId]),
    own("notification_deliveries"), own("activity_logs", "ORDER BY created_at"),
    own("payment_requests"), q.query("SELECT id, client_id, request_id, wix_application_id, order_id, amount_amd, currency, status, provider_payment_id, failure_code, livemode, rrn, duplicate, created_at, updated_at, verified_at, completed_at FROM online_payments WHERE user_id=$1", [userId]),
  ]);
  await logActivity(q, { userId, entityType: "export", action: "export.created", summary: "Full data export downloaded" });
  return {
    exported_at: new Date().toISOString(),
    note: "Document files are not embedded; download them from each client's Documents tab. Secrets are never exported.",
    preferences: prefs[0] ?? null, clients, client_cases: cases, tasks, task_reminders: reminders, calendar_events: events, interviews, notes,
    documents_metadata: documents, document_checklists: checklists, gmail_thread_links: links, notification_deliveries: deliveries, activity_logs: activity,
    payment_requests: paymentRequests, online_payments: onlinePayments,
  };
}

/** Irreversible erase of one client: files, notes, tasks, interviews, reminders, email links and audit rows that name them. */
export async function eraseClient(q: Q, userId: string, clientId: string, confirmName: string) {
  const [c] = await q.query<{ id: string; full_name: string }>("SELECT id, full_name FROM clients WHERE id=$1 AND user_id=$2", [clientId, userId]);
  if (!c) throw notFound("Client not found");
  if (c.full_name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) return null;
  const docs = await q.query<{ storage_key: string }>("SELECT storage_key FROM documents WHERE client_id=$1 AND user_id=$2", [clientId, userId]);
  const storage = getStorage();
  let filesRemoved = 0;
  for (const d of docs) {
    try {
      await storage.delete(d.storage_key);
      filesRemoved++;
    } catch (e) {
      console.error("[erase] file delete failed:", (e as Error).message);
    }
  }
  // Tasks (and via cascade their reminders + calendar events) that belong to this client; the soft-deleted ones too.
  await q.query("DELETE FROM tasks WHERE client_id=$1 AND user_id=$2", [clientId, userId]);
  await q.query("DELETE FROM activity_logs WHERE client_id=$1 AND user_id=$2", [clientId, userId]);
  await q.query("DELETE FROM clients WHERE id=$1 AND user_id=$2", [clientId, userId]); // cascades cases, notes, documents, checklists, interviews, email links
  await logActivity(q, { userId, entityType: "client", action: "client.erased", summary: "A client and all linked data were permanently erased", metadata: { files_removed: filesRemoved } });
  return { files_removed: filesRemoved };
}
