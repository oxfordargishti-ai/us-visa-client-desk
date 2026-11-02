import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { draftForClient } from "@/lib/client-messages";

type P = { id: string };
const Q = z.object({ kind: z.enum(["interview_reminder", "documents_request"]) });

/** Suggested text in the client's language, for the owner to review before sending. */
export const GET = handler<typeof Q, P>({ schema: Q }, async ({ user, params, body }) => ({
  draft: await withUser(user.id, (q) => draftForClient(q, user.id, zId.parse(params.id), body.kind)),
}));
