import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { createPaymentRequest, listPaymentRequests, portalConfig, RequestInput } from "@/lib/repo/payments";
import { paynetProblem } from "@/lib/paynet";

type P = { id: string };

/** The client's online payment requests with every checkout attempt, plus whether online payment is switched on. */
export const GET = handler<undefined, P>({}, async ({ user, params }) => {
  const requests = await withUser(user.id, (q) => listPaymentRequests(q, user.id, zId.parse(params.id)));
  return { requests, payments: { ...portalConfig(), problem: paynetProblem() } };
});

/** Owner sets what the client owes. This row is the only source of the amount Paynet is asked to charge. */
export const POST = handler<typeof RequestInput, P>({ schema: RequestInput }, async ({ user, params, body }) => ({
  request: await withUser(user.id, (q) => createPaymentRequest(q, user.id, zId.parse(params.id), body)),
}));
