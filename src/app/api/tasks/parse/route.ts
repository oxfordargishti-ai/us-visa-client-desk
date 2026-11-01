import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { loadParseContext, parseTaskText } from "@/lib/ai/task-parser";
import { logActivity } from "@/lib/audit";

const Body = z.object({ text: z.string().trim().min(3, "Describe the task in a sentence").max(1500) });

/** Step 1 of the approval workflow: turns plain English into a PREVIEW. Nothing is saved here. */
export const POST = handler({ schema: Body }, async ({ user, body }) => {
  const { prefs, ctx } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    if (!prefs.ai_task_parsing) throw new HttpError(403, "AI task capture is turned off in Settings.", "ai_disabled");
    return { prefs, ctx: await loadParseContext(q, user.id, prefs.ai_share_client_names) };
  });
  const preview = await parseTaskText({
    text: body.text,
    now: new Date(),
    tz: prefs.timezone,
    clients: ctx.clients,
    shareClientNames: prefs.ai_share_client_names,
    defaultReminders: prefs.default_task_reminders,
    existing: ctx.existing,
  });
  await withUser(user.id, (q) => logActivity(q, { userId: user.id, entityType: "task", action: "ai.task_previewed", summary: "AI task preview generated" }));
  return { preview, timezone: prefs.timezone };
});
