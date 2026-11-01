import { z } from "zod";
import { handler, HttpError, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { logActivity } from "@/lib/audit";

const Body = z.object({
  client_id: zId,
  subject: z.string().max(300).nullish(),
  snippet: z.string().max(500).nullish(),
  from: z.string().max(200).nullish(),
  last_message_at: z.string().nullish(),
  origin: z.enum(["email_match", "ai", "manual"]).default("manual"),
});

/** The owner explicitly confirms an email ↔ client link. Nothing is linked automatically. */
export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) =>
  withUser(user.id, async (q) => {
    const threadId = decodeURIComponent(params.id);
    const [c] = await q.query<{ id: string }>("SELECT id FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [body.client_id, user.id]);
    if (!c) throw new HttpError(400, "That client does not exist.", "bad_client");
    await q.query(
      `INSERT INTO gmail_thread_links (user_id, client_id, thread_id, subject, snippet, from_addr, last_message_at, status, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8)
       ON CONFLICT (user_id, thread_id, client_id) DO UPDATE SET status='confirmed', subject=EXCLUDED.subject, snippet=EXCLUDED.snippet, updated_at=now()`,
      [user.id, body.client_id, threadId, body.subject ?? null, body.snippet ?? null, body.from ?? null, body.last_message_at && !Number.isNaN(Date.parse(body.last_message_at)) ? new Date(body.last_message_at).toISOString() : null, body.origin],
    );
    await logActivity(q, { userId: user.id, clientId: body.client_id, entityType: "gmail", entityId: threadId, action: "gmail.thread_linked", summary: `Email linked: ${(body.subject ?? "(no subject)").slice(0, 80)}` });
    return { ok: true };
  }),
);

const Del = z.object({ client_id: zId });
export const DELETE = handler<typeof Del, { id: string }>({ schema: Del }, async ({ user, params, body }) =>
  withUser(user.id, async (q) => {
    await q.query("UPDATE gmail_thread_links SET status='dismissed', updated_at=now() WHERE user_id=$1 AND thread_id=$2 AND client_id=$3", [user.id, decodeURIComponent(params.id), body.client_id]);
    return { ok: true };
  }),
);
