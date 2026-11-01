import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { TaskInput, TaskListQuery, createTask, listTasks } from "@/lib/repo/tasks";
import { getPrefs } from "@/lib/repo/prefs";
import { scheduleGoogleSync } from "@/lib/svc";

export const GET = handler({ schema: TaskListQuery }, async ({ user, body }) =>
  withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    return { tasks: await listTasks(q, user.id, body, prefs.timezone) };
  }),
);

export const POST = handler({ schema: TaskInput }, async ({ user, body }) => {
  const result = await withUser(user.id, (q) => createTask(q, user.id, body));
  scheduleGoogleSync(user.id);
  return result;
});
