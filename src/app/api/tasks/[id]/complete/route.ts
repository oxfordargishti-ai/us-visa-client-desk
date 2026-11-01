import { z } from "zod";
import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { completeTask, reopenTask } from "@/lib/repo/tasks";
import { scheduleGoogleSync } from "@/lib/svc";

const Body = z.object({ undo: z.boolean().optional() });

export const POST = handler<typeof Body, { id: string }>({ schema: Body }, async ({ user, params, body }) => {
  const id = zId.parse(params.id);
  const result = await withUser(user.id, async (q) =>
    body.undo ? { task: await reopenTask(q, user.id, id), next: null } : completeTask(q, user.id, id),
  );
  scheduleGoogleSync(user.id);
  return result;
});
