import { handler, HttpError, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { DocumentListQuery, listDocuments, saveDocument } from "@/lib/repo/documents";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const GET = handler({ schema: DocumentListQuery }, async ({ user, body }) => ({
  documents: await withUser(user.id, (q) => listDocuments(q, user.id, body)),
}));

/** multipart/form-data: file, client_id, category, [case_id], [notes] */
export const POST = handler({}, async ({ user, req }) => {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES + 512 * 1024) throw new HttpError(413, "Files can be up to 15 MB.", "too_large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Upload failed — please try again.", "bad_upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.", "no_file");
  const clientId = zId.safeParse(form.get("client_id"));
  if (!clientId.success) throw new HttpError(400, "Choose which client this document belongs to.", "no_client");
  const category = String(form.get("category") || "Other");
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, "Unknown document category.", "bad_category");
  const caseId = form.get("case_id") ? zId.safeParse(form.get("case_id")) : null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const doc = await withUser(user.id, (q) =>
    saveDocument(q, user.id, {
      clientId: clientId.data,
      caseId: caseId?.success ? caseId.data : null,
      category: category as (typeof DOCUMENT_CATEGORIES)[number],
      filename: file.name,
      body: bytes,
      notes: (form.get("notes") as string | null)?.slice(0, 2000) || null,
    }),
  );
  return { document: doc };
});
