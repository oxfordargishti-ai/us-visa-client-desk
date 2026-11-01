import { NextResponse } from "next/server";
import { handler, HttpError, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getDocumentForDownload } from "@/lib/repo/documents";
import { getStorage } from "@/lib/storage";

/** Authenticated, ownership-checked access. Cloud storage → 60-second signed URL; local storage → streamed through the app. Never public. */
export const GET = handler<undefined, { id: string }>({}, async ({ user, params, search }) => {
  const inline = search.get("inline") === "1";
  const doc = await withUser(user.id, (q) => getDocumentForDownload(q, user.id, zId.parse(params.id)));
  const storage = getStorage();
  const signed = await storage.signedUrl(doc.storage_key, doc.filename, doc.mime_type, inline, 60);
  if (signed) return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  const obj = await storage.get(doc.storage_key);
  if (!obj) throw new HttpError(404, "The file is missing from storage.", "file_missing");
  const disp = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`;
  return new Response(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": disp,
      "Content-Length": String(obj.body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
});
