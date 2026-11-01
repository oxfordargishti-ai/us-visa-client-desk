import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { InterviewInput, InterviewListQuery, createInterview, listInterviews } from "@/lib/repo/interviews";
import { scheduleGoogleSync } from "@/lib/svc";

export const GET = handler({ schema: InterviewListQuery }, async ({ user, body }) => ({
  interviews: await withUser(user.id, (q) => listInterviews(q, user.id, body)),
}));

export const POST = handler({ schema: InterviewInput }, async ({ user, body }) => {
  const interview = await withUser(user.id, (q) => createInterview(q, user.id, body));
  scheduleGoogleSync(user.id);
  return { interview };
});
