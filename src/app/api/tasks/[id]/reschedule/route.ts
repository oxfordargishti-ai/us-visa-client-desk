import { z } from "zod";
import { handler, zId, zIso } from "@/lib/api";
import { withUser } from "@/lib/db";
import { updateTask } from "@/lib/repo/tasks";
import { scheduleGoogleSync } from "@/lib/svc";

const Body = z.object({ due_at: zIso });

export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) => {
  const r = await withUser(user.id, (q) => updateTask(q, user.id, zId.parse(params.id), { due_at: body.due_at }));
  scheduleGoogleSync(user.id);
  return r;
});
