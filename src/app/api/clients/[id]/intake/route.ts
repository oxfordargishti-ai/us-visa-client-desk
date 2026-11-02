import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { listIntakes } from "@/lib/intake";

type P = { id: string };

/** DS-160 questionnaires received for this client (newest first). */
export const GET = handler<undefined, P>({}, async ({ user, params }) => ({
  intakes: await withUser(user.id, (q) => listIntakes(q, user.id, zId.parse(params.id))),
}));
