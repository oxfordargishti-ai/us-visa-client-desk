import { handler, notFound, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { InterviewPatch, deleteInterview, getInterview, updateInterview } from "@/lib/repo/interviews";
import { scheduleGoogleSync } from "@/lib/svc";

type P = { id: string };

export const GET = handler<undefined, P>({}, async ({ user, params }) => {
  const i = await withUser(user.id, (q) => getInterview(q, user.id, zId.parse(params.id)));
  if (!i) throw notFound("Interview not found");
  return { interview: i };
});

export const PATCH = handler<typeof InterviewPatch, P>({ schema: InterviewPatch }, async ({ user, params, body }) => {
  const interview = await withUser(user.id, (q) => updateInterview(q, user.id, zId.parse(params.id), body));
  scheduleGoogleSync(user.id);
  return { interview };
});

export const DELETE = handler<undefined, P>({}, async ({ user, params }) => {
  await withUser(user.id, (q) => deleteInterview(q, user.id, zId.parse(params.id)));
  scheduleGoogleSync(user.id);
  return { ok: true };
});
