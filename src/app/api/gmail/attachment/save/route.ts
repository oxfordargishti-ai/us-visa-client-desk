import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { getAttachment } from "@/lib/google";
import { saveDocument } from "@/lib/repo/documents";

const Body = z.object({
  message_id: z.string().min(5).max(64),
  attachment_id: z.string().min(5).max(2000),
  filename: z.string().min(1).max(200),
  client_id: zId,
  category: z.enum(DOCUMENT_CATEGORIES).default("Client Correspondence"),
});

/** Copies an email attachment into a client's private document store — only after the owner picks the client. */
export const POST = handler({ schema: Body }, async ({ user, body }) => {
  const bytes = await getAttachment(user.id, body.message_id, body.attachment_id);
  const doc = await withUser(user.id, (q) =>
    saveDocument(q, user.id, { clientId: body.client_id, category: body.category, filename: body.filename, body: bytes, source: "gmail", sourceRef: body.message_id }),
  );
  return { document: doc };
});
