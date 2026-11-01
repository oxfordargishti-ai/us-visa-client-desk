import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { SettingsView } from "@/components/settings-view";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const prefs = await withUser(user.id, (q) => getPrefs(q, user.id));
  return <SettingsView prefs={prefs} email={user.email} name={user.name} flash={sp.connected ? "Google Calendar connected." : sp.error ? "Google couldn't connect. Please try again." : null} />;
}
