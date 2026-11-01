import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getThread } from "@/lib/google";
import { getPrefs } from "@/lib/repo/prefs";
import { analyzeEmailThread } from "@/lib/ai/assist";
import { logActivity } from "@/lib/audit";

/** Opt-in. Sends a trimmed, redacted copy of the conversation to Claude and returns a summary + suggested follow-ups. Changes nothing. */
export const POST = handler<undefined, { id: string }>({}, async ({ user, params }) => {
  const threadId = decodeURIComponent(params.id);
  const { prefs, clients } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    if (!prefs.ai_email_analysis) throw new HttpError(403, "AI email analysis is off. Turn it on in Settings → AI & privacy first.", "ai_disabled");
    const clients = prefs.ai_share_client_names ? await q.query<{ id: string; full_name: string }>("SELECT id, full_name FROM clients WHERE user_id=$1 AND deleted_at IS NULL LIMIT 200", [user.id]) : null;
    return { prefs, clients };
  });
  void prefs;
  const messages = await getThread(user.id, threadId);
  const analysis = await analyzeEmailThread(messages.map((m) => ({ fromName: m.fromName, date: m.date, subject: m.subject, body: m.body ?? m.snippet })), clients);
  await withUser(user.id, (q) => logActivity(q, { userId: user.id, entityType: "gmail", entityId: threadId, action: "gmail.ai_analyzed", summary: "AI summary generated for an email conversation" }));
  return { analysis };
});
