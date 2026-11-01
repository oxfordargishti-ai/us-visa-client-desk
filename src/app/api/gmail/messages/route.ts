import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { actionReasons, listInbox, refreshUnreadCount } from "@/lib/google";

const Query = z.object({
  q: z.string().max(200).optional(),
  unread: z.enum(["1", "0"]).default("1"),
  client_id: z.string().optional(),
  page: z.string().max(300).optional(),
});

export const GET = handler({ schema: Query }, async ({ user, body }) => {
  let q = body.q?.trim() || "";
  // "Search by client": expand a client to their email address.
  const { clientRow, known } = await withUser(user.id, async (db) => {
    let clientRow: { id: string; full_name: string; email: string | null } | null = null;
    if (body.client_id && /^[0-9a-f-]{36}$/i.test(body.client_id)) {
      [clientRow] = await db.query<{ id: string; full_name: string; email: string | null }>("SELECT id, full_name, email FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [body.client_id, user.id]);
    }
    return { clientRow, known: null as null };
  });
  if (clientRow) {
    if (!clientRow.email) throw new HttpError(400, `${clientRow.full_name} has no email address saved yet.`, "no_email");
    q = `(from:${clientRow.email} OR to:${clientRow.email}) ${q}`.trim();
  }
  void known;
  const list = await listInbox(user.id, { q, unreadOnly: body.unread === "1" && !clientRow, pageToken: body.page });

  const senders = [...new Set(list.messages.map((m) => m.from))];
  const threadIds = [...new Set(list.messages.map((m) => m.threadId))];
  const { clients, links } = await withUser(user.id, async (db) => ({
    clients: senders.length ? await db.query<{ id: string; full_name: string; email: string }>("SELECT id, full_name, email FROM clients WHERE user_id=$1 AND deleted_at IS NULL AND lower(email) = ANY($2::text[])", [user.id, senders]) : [],
    links: threadIds.length ? await db.query<{ thread_id: string; client_id: string; full_name: string; status: string }>(
      `SELECT l.thread_id, l.client_id, c.full_name, l.status FROM gmail_thread_links l JOIN clients c ON c.id=l.client_id WHERE l.user_id=$1 AND l.thread_id = ANY($2::text[]) AND l.status <> 'dismissed'`, [user.id, threadIds]) : [],
  }));
  const messages = list.messages.map((m) => {
    const s = clients.find((c) => c.email.toLowerCase() === m.from);
    const link = links.find((l) => l.thread_id === m.threadId);
    const reasons = actionReasons(m.subject, m.snippet);
    return {
      ...m,
      needs_action: m.unread && reasons.length > 0,
      action_reasons: reasons,
      suggestion: !link && s ? { client_id: s.id, full_name: s.full_name } : null,
      linked: link ? { client_id: link.client_id, full_name: link.full_name, status: link.status } : null,
    };
  });
  if (body.unread === "1" && !clientRow && !body.q && !body.page) refreshUnreadCount(user.id).catch(() => undefined);
  return { messages, next: list.nextPageToken };
});
