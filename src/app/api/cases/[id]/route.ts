import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { CasePatch, updateCase } from "@/lib/repo/clients";

export const PATCH = handler<typeof CasePatch, { id: string }>({ schema: CasePatch }, async ({ user, params, body }) => ({
  case: await withUser(user.id, (q) => updateCase(q, user.id, zId.parse(params.id), body)),
}));
