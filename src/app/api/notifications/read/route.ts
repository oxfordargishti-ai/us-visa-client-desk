import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";

const Body = z.object({ ids: z.array(zId).max(200).optional(), all: z.boolean().optional() });

export const POST = handler({ schema: Body }, async ({ user, body }) =>
  withUser(user.id, async (q) => {
    if (body.all) await q.query("UPDATE notification_deliveries SET read_at=now() WHERE user_id=$1 AND channel='inapp' AND read_at IS NULL", [user.id]);
    else if (body.ids?.length) await q.query("UPDATE notification_deliveries SET read_at=now() WHERE user_id=$1 AND id = ANY($2::uuid[]) AND read_at IS NULL", [user.id, body.ids]);
    return { ok: true };
  }),
);
