import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { portalOptions, portalRoute } from "@/lib/portal-api";
import { APPLICATION_ID, assertApplicationOwner } from "@/lib/portal-auth";
import { startCheckout } from "@/lib/repo/payments";

// POST /api/portal/payment/checkout   { "applicationId": "<Wix item id>" }
// Authorization: Bearer <Wix member access token>
// Starts (or reuses) a Paynet hosted checkout for the client's open payment request and returns its URL.
// The body carries no amount: the amount is the owner's payment request in the Desk database.
const Body = z.object({ applicationId: z.string().regex(APPLICATION_ID) }).strict();

export const maxDuration = 30;
export const OPTIONS = portalOptions;
export const POST = portalRoute({ member: true }, async ({ req, member, token }) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "bad_request");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Only the application id is accepted", "bad_request");
  await assertApplicationOwner(token!, parsed.data.applicationId, member!);
  return startCheckout(member!, parsed.data.applicationId);
});
