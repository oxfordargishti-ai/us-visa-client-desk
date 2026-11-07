import { handler, zId } from "@/lib/api";
import { withUser } from "@/lib/db";
import { cancelPaymentRequest, RequestAction, verifyRequestNow } from "@/lib/repo/payments";
import { PaynetError } from "@/lib/paynet";
import { HttpError } from "@/lib/errors";

type P = { id: string };

// { "action": "cancel" } closes an open request; { "action": "verify" } re-reads its unfinished attempts from Paynet.
export const maxDuration = 30;
export const PATCH = handler<typeof RequestAction, P>({ schema: RequestAction }, async ({ user, params, body }) => {
  const id = zId.parse(params.id);
  if (body.action === "cancel") {
    await withUser(user.id, (q) => cancelPaymentRequest(q, user.id, id));
    return { ok: true };
  }
  try {
    return await withUser(user.id, (q) => verifyRequestNow(q, user.id, id));
  } catch (e) {
    if (e instanceof PaynetError) throw new HttpError(502, "Paynet could not be reached. Try again in a minute.", "paynet_unreachable");
    throw e;
  }
});
