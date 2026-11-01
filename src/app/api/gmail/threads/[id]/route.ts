import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getThread } from "@/lib/google";
import { logActivity } from "@/lib/audit";

export const GET = handler<undefined, { id: string }>({}, async ({ user, params }) => {
  const id = decodeURIComponent(params.id);
  const messages = await getThread(user.id, id);
  const links = await withUser(user.id, async (q) => {
    await logActivity(q, { userId: user.id, entityType: "gmail", entityId: id, action: "gmail.thread_opened", summary: "Opened an email conversation" });
    return q.query<{ id: string; client_id: string; full_name: string; status: string }>(
      "SELECT l.id, l.client_id, c.full_name, l.status FROM gmail_thread_links l JOIN clients c ON c.id=l.client_id WHERE l.user_id=$1 AND l.thread_id=$2 AND l.status <> 'dismissed'", [user.id, id]);
  });
  return { thread_id: id, messages, links, gmail_url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}` };
});
