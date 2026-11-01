import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { capabilities, env } from "@/lib/env";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { prefs, unread } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    const [{ n }] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM notification_deliveries WHERE user_id=$1 AND channel='inapp' AND read_at IS NULL", [user.id]);
    return { prefs, unread: n };
  });
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
