import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { listTasks } from "@/lib/repo/tasks";
import { suggestDayPlan } from "@/lib/ai/assist";

/** Advice only: returns a suggested order and reasons. It never edits, moves or completes a task. */
export const POST = handler({}, async ({ user }) => {
  const { prefs, tasks } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    if (!prefs.ai_planner_suggestions) throw new HttpError(403, "AI day suggestions are turned off in Settings.", "ai_disabled");
    const tasks = (await listTasks(q, user.id, { view: "today", limit: 60 }, prefs.timezone)).filter((t) => t.status === "pending");
    return { prefs, tasks };
  });
  if (!tasks.length) return { focus_note: "Nothing is scheduled for today — a good moment to follow up with clients.", ordered: [] };
  return suggestDayPlan(tasks, prefs.timezone, new Date());
});
