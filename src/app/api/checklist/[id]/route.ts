import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { ChecklistPatch, updateChecklistItem } from "@/lib/repo/clients";

export const PATCH = handler<typeof ChecklistPatch, { id: string }>({ schema: ChecklistPatch }, async ({ user, params, body }) => ({
  item: await withUser(user.id, (q) => updateChecklistItem(q, user.id, zId.parse(params.id), body)),
}));
