import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { DocumentPatch, deleteDocument, updateDocument } from "@/lib/repo/documents";

type P = { id: string };

export const PATCH = handler<typeof DocumentPatch, P>({ schema: DocumentPatch }, async ({ user, params, body }) => ({
  document: await withUser(user.id, (q) => updateDocument(q, user.id, zId.parse(params.id), body)),
}));
export const DELETE = handler<undefined, P>({}, async ({ user, params }) => {
  await withUser(user.id, (q) => deleteDocument(q, user.id, zId.parse(params.id)));
  return { ok: true };
});
