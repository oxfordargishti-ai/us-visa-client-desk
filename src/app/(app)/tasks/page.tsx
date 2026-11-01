import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { listTasks } from "@/lib/repo/tasks";
import { TasksView } from "@/components/tasks-view";
import { dayBoundsUtc } from "@/lib/time";

export const metadata = { title: "My Tasks" };
export const dynamic = "force-dynamic";

const VIEWS = ["today", "upcoming", "overdue", "all", "completed"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const view = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as (typeof VIEWS)[number]) : "today";
  const user = await requireUser();
  const { tasks, deadlines, tz, counts } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    const tasks = await listTasks(q, user.id, { view, limit: 300 }, prefs.timezone);
    const day = dayBoundsUtc(prefs.timezone);
    const deadlines =
      view === "today"
        ? (await listTasks(q, user.id, { view: "upcoming", limit: 100 }, prefs.timezone)).filter(
            (t) => t.due_at! > day.end && new Date(t.due_at!).getTime() < Date.now() + 7 * 86_400_000 && (t.priority === "High" || t.priority === "Urgent" || t.category === "Visa Interview" || t.category === "Embassy Appointment"),
          )
        : [];
    const [c] = await q.query<{ overdue: number; today: number }>(
      `SELECT count(*) FILTER (WHERE status='pending' AND due_at < now())::int AS overdue,
              count(*) FILTER (WHERE status='pending' AND due_at >= $2 AND due_at <= $3)::int AS today
         FROM tasks WHERE user_id=$1 AND deleted_at IS NULL`,
      [user.id, day.start, day.end],
    );
    return { tasks, deadlines, tz: prefs.timezone, counts: c };
  });
  return <TasksView view={view} tasks={tasks} deadlines={deadlines} tz={tz} counts={counts} />;
}
