import { z } from "zod";
import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getAttachment } from "@/lib/google";
import { logActivity } from "@/lib/audit";
import { safeFilename } from "@/lib/storage";

const Query = z.object({ messageId: z.string().min(5).max(64), attachmentId: z.string().min(5).max(2000), filename: z.string().max(200).default("attachment") });

/** Authorised download of an email attachment. Always served as a forced download (never rendered), because senders are untrusted. */
export const GET = handler({ schema: Query }, async ({ user, body }) => {
  const bytes = await getAttachment(user.id, body.messageId, body.attachmentId);
  await withUser(user.id, (q) => logActivity(q, { userId: user.id, entityType: "gmail", entityId: body.messageId, action: "gmail.attachment_downloaded", summary: "Email attachment downloaded" }));
  const name = safeFilename(body.filename);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
