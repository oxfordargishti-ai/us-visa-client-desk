import { DateTime } from "luxon";
import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { getDashboard } from "@/lib/repo/dashboard";
import { DashboardView } from "@/components/dashboard-view";

export const metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const { data, tz } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    return { tz: prefs.timezone, data: await getDashboard(q, user.id, prefs.timezone) };
  });
  const local = DateTime.fromISO(data.now, { zone: "utc" }).setZone(tz);
  const greeting = local.hour < 5 ? "Working late" : local.hour < 12 ? "Good morning" : local.hour < 18 ? "Good afternoon" : "Good evening";
  return <DashboardView data={data} greeting={greeting} dateLine={local.toFormat("cccc, d MMMM")} />;
}
