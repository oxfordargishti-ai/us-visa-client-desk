import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getConnection, googleConfigured, SCOPES } from "@/lib/google";
import { getPrefs } from "@/lib/repo/prefs";

export const GET = handler({}, async ({ user }) =>
  withUser(user.id, async (q) => {
    const c = await getConnection(q, user.id);
    const prefs = await getPrefs(q, user.id);
    return {
      configured: googleConfigured(),
      connected: Boolean(c),
      account: c?.google_email ?? null,
      expected_account: process.env.GMAIL_ACCOUNT || "info@usvisawithargishti.com",
      gmail_scope: Boolean(c?.scopes.includes(SCOPES.gmail)),
      calendar_scope: Boolean(c?.scopes.includes(SCOPES.calendar)),
      calendar_sync_enabled: Boolean(c?.calendar_sync_enabled),
      last_error: c?.last_error ?? null,
      connected_at: c?.connected_at ?? null,
      unread: c?.unread_cache ?? null,
      ai_email_analysis: prefs.ai_email_analysis,
    };
  }),
);
