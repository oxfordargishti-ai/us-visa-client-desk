import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { snoozeTask } from "@/lib/repo/tasks";

const Body = z.object({ minutes: z.number().int().min(1).max(7 * 24 * 60).default(15) });

export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) => {
  const reminder = await withUser(user.id, (q) => snoozeTask(q, user.id, zId.parse(params.id), body.minutes));
  return { ok: true, reminder };
});
