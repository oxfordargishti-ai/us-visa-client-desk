import { requireUser, getCurrentPrefs } from "@/lib/session";
import { SettingsView } from "@/components/settings-view";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const prefs = await getCurrentPrefs();
  return <SettingsView prefs={prefs} email={user.email} name={user.name} flash={sp.connected ? "Google Calendar connected." : sp.error ? "Google couldn't connect. Please try again." : null} />;
}
