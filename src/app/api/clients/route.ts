import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { ClientInput, ClientListQuery, createClient, listClients } from "@/lib/repo/clients";

export const GET = handler({ schema: ClientListQuery }, async ({ user, body }) => ({
  clients: await withUser(user.id, (q) => listClients(q, user.id, body)),
}));

export const POST = handler({ schema: ClientInput }, async ({ user, body }) => withUser(user.id, (q) => createClient(q, user.id, body)));
