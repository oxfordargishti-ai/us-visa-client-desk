import { requireUser, getCurrentPrefs } from "@/lib/session";
import { parallelReader } from "@/lib/db";
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
  const tz = (await getCurrentPrefs()).timezone;
  const day = dayBoundsUtc(tz);
  // Independent reads run side by side, each on its own connection.
  const [tasks, upcoming, counts] = await Promise.all([
    listTasks(parallelReader(user.id), user.id, { view, limit: 300 }, tz),
    view === "today" ? listTasks(parallelReader(user.id), user.id, { view: "upcoming", limit: 100 }, tz) : Promise.resolve([]),
    parallelReader(user.id).query<{ overdue: number; today: number }>(
        `SELECT count(*) FILTER (WHERE status='pending' AND due_at < now())::int AS overdue,
                count(*) FILTER (WHERE status='pending' AND due_at >= $2 AND due_at <= $3)::int AS today
           FROM tasks WHERE user_id=$1 AND deleted_at IS NULL`,
        [user.id, day.start, day.end],
      ).then((r) => r[0]),
  ]);
  const deadlines = upcoming.filter(
    (t) => t.due_at! > day.end && new Date(t.due_at!).getTime() < Date.now() + 7 * 86_400_000 && (t.priority === "High" || t.priority === "Urgent" || t.category === "Visa Interview" || t.category === "Embassy Appointment"),
  );
  return <TasksView view={view} tasks={tasks} deadlines={deadlines} tz={tz} counts={counts} />;
}
