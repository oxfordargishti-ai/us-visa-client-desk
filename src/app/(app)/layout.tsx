import { requireUser, getCurrentPrefs } from "@/lib/session";
import { readAsUser } from "@/lib/db";
import { capabilities, env } from "@/lib/env";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [prefs, unread] = await Promise.all([
    getCurrentPrefs(),
    readAsUser<{ n: number }>(user.id, "SELECT count(*)::int AS n FROM notification_deliveries WHERE user_id=$1 AND channel='inapp' AND read_at IS NULL", [user.id]).then((r) => r[0].n),
  ]);
  const caps = capabilities();
  return (
    <AppShell
      user={{ id: user.id, name: user.name, email: user.email }}
      tz={prefs.timezone}
      soundEnabled={prefs.sound_enabled}
      caps={caps}
      vapidKey={env.vapidPublic}
      defaultReminders={prefs.default_task_reminders}
      aiEnabled={caps.ai && prefs.ai_task_parsing}
      initialUnread={unread}
    >
      {children}
    </AppShell>
  );
}
