import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { NotePatch, deleteNote, updateNote } from "@/lib/repo/notes";

type P = { id: string };

export const PATCH = handler<typeof NotePatch, P>({ schema: NotePatch }, async ({ user, params, body }) => ({
  note: await withUser(user.id, (q) => updateNote(q, user.id, zId.parse(params.id), body)),
}));
export const DELETE = handler<undefined, P>({}, async ({ user, params }) => {
  await withUser(user.id, (q) => deleteNote(q, user.id, zId.parse(params.id)));
  return { ok: true };
});
