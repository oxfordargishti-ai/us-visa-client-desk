import { z } from "zod";
import { handler, HttpError, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { eraseClient } from "@/lib/repo/export";

const Body = z.object({ confirm_name: z.string().min(1).max(200) });

/** Permanent, irreversible deletion of a client and everything linked to them (files included). Requires typing their exact name. */
export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) => {
  const res = await withUser(user.id, (q) => eraseClient(q, user.id, zId.parse(params.id), body.confirm_name));
  if (!res) throw new HttpError(400, "The name you typed doesn't match this client.", "confirm_mismatch");
  return { ok: true, ...res };
});
