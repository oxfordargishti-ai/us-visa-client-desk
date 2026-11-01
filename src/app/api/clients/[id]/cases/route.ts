import { handler, notFound, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { CaseInput, createCase, getClient } from "@/lib/repo/clients";
import { logActivity } from "@/lib/audit";

export const POST = handler<typeof CaseInput, { id: string }>({ schema: CaseInput }, async ({ user, params, body }) =>
  withUser(user.id, async (q) => {
    const id = zId.parse(params.id);
    if (!(await getClient(q, user.id, id))) throw notFound("Client not found");
    const kase = await createCase(q, user.id, id, body);
    await logActivity(q, { userId: user.id, clientId: id, entityType: "case", entityId: kase.id, action: "case.created", summary: `New case opened: ${kase.visa_category}` });
    return { case: kase };
  }),
);
