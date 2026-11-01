import { handler, notFound, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { ClientPatch, getClientDetail, softDeleteClient, updateClient } from "@/lib/repo/clients";

type P = { id: string };

export const GET = handler<undefined, P>({}, async ({ user, params }) => {
  const d = await withUser(user.id, (q) => getClientDetail(q, user.id, zId.parse(params.id)));
  if (!d) throw notFound("Client not found");
  return d;
});

export const PATCH = handler<typeof ClientPatch, P>({ schema: ClientPatch }, async ({ user, params, body }) => ({
  client: await withUser(user.id, (q) => updateClient(q, user.id, zId.parse(params.id), body)),
}));

/** Archives the client (hidden everywhere, reminders stopped). Permanent erasure is POST /api/clients/:id/erase. */
export const DELETE = handler<undefined, P>({}, async ({ user, params }) => {
  await withUser(user.id, (q) => softDeleteClient(q, user.id, zId.parse(params.id)));
  return { ok: true };
});
