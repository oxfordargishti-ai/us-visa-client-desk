import { DateTime } from "luxon";
import { requireUser, getCurrentPrefs } from "@/lib/session";
import { parallelReader } from "@/lib/db";
import { getDashboard } from "@/lib/repo/dashboard";
import { DashboardView } from "@/components/dashboard-view";
import { dateLocale, getLang, tl } from "@/lib/i18n";

export const metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const tz = (await getCurrentPrefs()).timezone;
  const data = await getDashboard(parallelReader(user.id), user.id, tz);
  const local = DateTime.fromISO(data.now, { zone: "utc" }).setZone(tz);
  const lang = getLang();
  const greeting = tl(lang, local.hour < 5 ? "Working late" : local.hour < 12 ? "Good morning" : local.hour < 18 ? "Good afternoon" : "Good evening");
  return <DashboardView data={data} greeting={greeting} dateLine={local.setLocale(dateLocale(lang)).toFormat("cccc, d MMMM")} />;
}
