import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { addChecklistItem } from "@/lib/repo/clients";

const Body = z.object({ label: z.string().trim().min(1).max(160), category: z.enum(DOCUMENT_CATEGORIES).default("Other"), required: z.boolean().default(false) });

export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) => ({
  item: await withUser(user.id, (q) => addChecklistItem(q, user.id, zId.parse(params.id), body.label, body.category, body.required)),
}));
