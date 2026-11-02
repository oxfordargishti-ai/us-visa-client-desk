import { z } from "zod";
import { handler, notFound, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { listClientMessages, sendToClient } from "@/lib/client-messages";

type P = { id: string };

/** Messages sent to this client (newest first). */
export const GET = handler<undefined, P>({}, async ({ user, params }) => ({
  messages: await withUser(user.id, (q) => listClientMessages(q, user.id, zId.parse(params.id))),
}));

const SendInput = z.object({
  channel: z.enum(["email", "sms"]),
  kind: z.enum(["interview_reminder", "documents_request", "custom"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(2, "Write the message first").max(1600),
});

/** Sends a message to the client now (the owner reviewed and possibly edited the text). Consent for the channel is required. */
export const POST = handler<typeof SendInput, P>({ schema: SendInput }, async ({ user, params, body }) => {
  const id = zId.parse(params.id);
  const client = await withUser(user.id, async (q) => (await q.query<{ id: string; full_name: string; email: string | null; phone: string | null; notify_email: boolean; notify_sms: boolean; preferred_language: string | null }>(
    "SELECT id, full_name, email, phone, notify_email, notify_sms, preferred_language FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, user.id]))[0]);
  if (!client) throw notFound("Client not found");
  const res = await sendToClient(user.id, client, { channel: body.channel, kind: body.kind, subject: body.subject, body: body.body });
  return { result: res };
});
