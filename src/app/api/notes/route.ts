import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { NoteInput, NoteListQuery, createNote, listNotes } from "@/lib/repo/notes";

export const GET = handler({ schema: NoteListQuery }, async ({ user, body }) => ({ notes: await withUser(user.id, (q) => listNotes(q, user.id, body)) }));
export const POST = handler({ schema: NoteInput }, async ({ user, body }) => ({ note: await withUser(user.id, (q) => createNote(q, user.id, body)) }));
