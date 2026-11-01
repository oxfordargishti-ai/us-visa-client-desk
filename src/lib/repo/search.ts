import { z } from "zod";
import type { Q } from "../db";

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  types: z.string().optional(), // comma list: clients,tasks,events,notes,documents,emails
  client_id: z.string().optional(),
});

export interface SearchHit {
  type: "client" | "task" | "event" | "note" | "document" | "email";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  client_id?: string | null;
  at?: string | null;
}

export async function globalSearch(q: Q, userId: string, f: z.infer<typeof SearchQuery>): Promise<SearchHit[]> {
  const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
  const want = new Set((f.types ?? "clients,tasks,events,notes,documents,emails").split(","));
  const clientFilter = f.client_id && /^[0-9a-f-]{36}$/i.test(f.client_id) ? f.client_id : null;
  const hits: SearchHit[] = [];

  const jobs: Promise<void>[] = [];
  if (want.has("clients")) {
    jobs.push(
      q.query<{ id: string; full_name: string; email: string | null; phone: string | null; client_code: string; status: string | null }>(
        `SELECT c.id, c.full_name, c.email, c.phone, c.client_code,
                (SELECT application_status FROM client_cases k WHERE k.client_id=c.id AND k.deleted_at IS NULL ORDER BY k.opened_at DESC LIMIT 1) AS status
           FROM clients c WHERE c.user_id=$1 AND c.deleted_at IS NULL AND ($3::uuid IS NULL OR c.id=$3)
            AND (c.full_name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2 OR c.whatsapp ILIKE $2 OR c.client_code ILIKE $2)
          ORDER BY c.full_name LIMIT 8`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "client", id: r.id, title: r.full_name, subtitle: [r.client_code, r.status, r.email].filter(Boolean).join(" · "), href: `/clients/${r.id}` }))),
    );
  }
  if (want.has("tasks")) {
    jobs.push(
      q.query<{ id: string; title: string; due_at: string | null; status: string; client_id: string | null; client_name: string | null }>(
        `SELECT t.id, t.title, t.due_at, t.status, t.client_id, c.full_name AS client_name FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
          WHERE t.user_id=$1 AND t.deleted_at IS NULL AND ($3::uuid IS NULL OR t.client_id=$3) AND (t.title ILIKE $2 OR t.description ILIKE $2)
          ORDER BY (t.status='pending') DESC, t.due_at DESC NULLS LAST LIMIT 8`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "task", id: r.id, title: r.title, subtitle: [r.status === "completed" ? "Completed" : "Open", r.client_name].filter(Boolean).join(" · "), href: `/tasks?open=${r.id}`, client_id: r.client_id, at: r.due_at }))),
    );
  }
  if (want.has("events")) {
    jobs.push(
      q.query<{ id: string; title: string; starts_at: string; location: string | null; client_id: string | null }>(
        `SELECT e.id, e.title, e.starts_at, e.location, e.client_id FROM calendar_events e
          WHERE e.user_id=$1 AND e.deleted_at IS NULL AND ($3::uuid IS NULL OR e.client_id=$3) AND (e.title ILIKE $2 OR e.location ILIKE $2 OR e.notes ILIKE $2)
          ORDER BY e.starts_at DESC LIMIT 6`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "event", id: r.id, title: r.title, subtitle: r.location, href: `/calendar?date=${r.starts_at.slice(0, 10)}`, client_id: r.client_id, at: r.starts_at }))),
    );
  }
  if (want.has("notes")) {
    jobs.push(
      q.query<{ id: string; body: string; client_id: string | null; client_name: string | null; created_at: string }>(
        `SELECT n.id, n.body, n.client_id, c.full_name AS client_name, n.created_at FROM notes n LEFT JOIN clients c ON c.id=n.client_id
          WHERE n.user_id=$1 AND n.deleted_at IS NULL AND ($3::uuid IS NULL OR n.client_id=$3) AND n.body ILIKE $2 ORDER BY n.created_at DESC LIMIT 6`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "note", id: r.id, title: r.body.length > 90 ? r.body.slice(0, 90) + "…" : r.body, subtitle: r.client_name, href: r.client_id ? `/clients/${r.client_id}?tab=notes` : "/clients", client_id: r.client_id, at: r.created_at }))),
    );
  }
  if (want.has("documents")) {
    jobs.push(
      q.query<{ id: string; filename: string; category: string; client_id: string; client_name: string }>(
        `SELECT d.id, d.filename, d.category, d.client_id, c.full_name AS client_name FROM documents d JOIN clients c ON c.id=d.client_id
          WHERE d.user_id=$1 AND d.deleted_at IS NULL AND ($3::uuid IS NULL OR d.client_id=$3) AND (d.filename ILIKE $2 OR d.notes ILIKE $2 OR d.category ILIKE $2)
          ORDER BY d.uploaded_at DESC LIMIT 6`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "document", id: r.id, title: r.filename, subtitle: `${r.category} · ${r.client_name}`, href: `/clients/${r.client_id}?tab=documents`, client_id: r.client_id }))),
    );
  }
  if (want.has("emails")) {
    jobs.push(
      q.query<{ id: string; subject: string | null; from_addr: string | null; client_id: string; client_name: string; last_message_at: string | null }>(
        `SELECT l.id, l.subject, l.from_addr, l.client_id, c.full_name AS client_name, l.last_message_at FROM gmail_thread_links l JOIN clients c ON c.id=l.client_id
          WHERE l.user_id=$1 AND l.status='confirmed' AND ($3::uuid IS NULL OR l.client_id=$3) AND (l.subject ILIKE $2 OR l.snippet ILIKE $2 OR l.from_addr ILIKE $2)
          ORDER BY l.last_message_at DESC NULLS LAST LIMIT 6`, [userId, like, clientFilter],
      ).then((rows) => rows.forEach((r) => hits.push({ type: "email", id: r.id, title: r.subject || "(no subject)", subtitle: `${r.from_addr ?? ""} · ${r.client_name}`, href: `/clients/${r.client_id}?tab=emails`, client_id: r.client_id, at: r.last_message_at }))),
    );
  }
  // PGlite runs one statement at a time; Promise.all is still correct (they queue) and parallel on node-postgres... except inside a single transaction client where they also queue.
  for (const j of jobs) await j;
  return hits;
}
