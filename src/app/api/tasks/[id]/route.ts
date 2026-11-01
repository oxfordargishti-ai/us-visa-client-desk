import { handler, notFound, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { TaskPatch, deleteTask, getTask, listReminders, updateTask } from "@/lib/repo/tasks";
import { scheduleGoogleSync } from "@/lib/svc";

type P = { id: string };

export const GET = handler<undefined, P>({}, async ({ user, params }) =>
  withUser(user.id, async (q) => {
    const id = zId.parse(params.id);
    const task = await getTask(q, user.id, id);
    if (!task) throw notFound("Task not found");
    return { task, reminders: await listReminders(q, user.id, id) };
  }),
);

export const PATCH = handler<typeof TaskPatch, P>({ schema: TaskPatch }, async ({ user, params, body }) => {
  const r = await withUser(user.id, (q) => updateTask(q, user.id, zId.parse(params.id), body));
  scheduleGoogleSync(user.id);
  return r;
});

export const DELETE = handler<undefined, P>({}, async ({ user, params }) => {
  await withUser(user.id, (q) => deleteTask(q, user.id, zId.parse(params.id)));
  scheduleGoogleSync(user.id);
  return { ok: true };
});
