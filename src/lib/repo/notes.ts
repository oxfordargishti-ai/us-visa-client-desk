import { z } from "zod";
import { one, type Q } from "../db";
import { NOTE_KINDS } from "../constants";
import type { NoteRow } from "../types";
import { HttpError, notFound, zId } from "../errors";
import { logActivity } from "../audit";
import { assertClientOwned } from "./tasks";

export const NoteInput = z.object({
  client_id: zId.nullish(),
  body: z.string().trim().min(1, "Write something first").max(10_000),
  kind: z.enum(NOTE_KINDS).default("note"),
  pinned: z.boolean().default(false),
});
export const NotePatch = NoteInput.partial().omit({ client_id: true });

export async function createNote(q: Q, userId: string, input: z.infer<typeof NoteInput>) {
  await assertClientOwned(q, userId, input.client_id);
  const [n] = await q.query<NoteRow>(
    "INSERT INTO notes (user_id, client_id, body, kind, pinned) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, input.client_id ?? null, input.body, input.kind, input.pinned],
  );
  if (input.client_id) await q.query("UPDATE clients SET updated_at=now() WHERE id=$1", [input.client_id]);
  await logActivity(q, { userId, clientId: input.client_id, entityType: "note", entityId: n.id, action: "note.created", summary: `${input.kind === "note" ? "Note" : input.kind[0].toUpperCase() + input.kind.slice(1) + " logged"}: ${input.body.slice(0, 80)}` });
  return n;
}

export async function updateNote(q: Q, userId: string, id: string, patch: z.infer<typeof NotePatch>) {
  const ex = await one<NoteRow>(q, "SELECT * FROM notes WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]);
  if (!ex) throw notFound("Note not found");
  const m = { ...ex, ...patch };
  const [n] = await q.query<NoteRow>("UPDATE notes SET body=$3, kind=$4, pinned=$5, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, m.body, m.kind, m.pinned]);
  return n;
}

export async function deleteNote(q: Q, userId: string, id: string) {
  const rows = await q.query("UPDATE notes SET deleted_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id", [id, userId]);
  if (!rows.length) throw new HttpError(404, "Note not found", "not_found");
}

export const NoteListQuery = z.object({ client_id: zId.optional(), q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(300).default(100) });

export async function listNotes(q: Q, userId: string, f: z.infer<typeof NoteListQuery>): Promise<NoteRow[]> {
  const params: unknown[] = [userId];
  const where = ["n.user_id=$1", "n.deleted_at IS NULL"];
  if (f.client_id) where.push(`n.client_id=$${params.push(f.client_id)}`);
  if (f.q) where.push(`n.body ILIKE $${params.push(`%${f.q.replace(/[%_]/g, "\\$&")}%`)}`);
  return q.query<NoteRow>(
    `SELECT n.*, c.full_name AS client_name FROM notes n LEFT JOIN clients c ON c.id=n.client_id
      WHERE ${where.join(" AND ")} ORDER BY n.pinned DESC, n.created_at DESC LIMIT ${f.limit}`,
    params,
  );
}
