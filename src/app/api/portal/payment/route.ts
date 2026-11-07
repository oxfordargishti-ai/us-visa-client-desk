import { HttpError } from "@/lib/errors";
import { portalOptions, portalRoute } from "@/lib/portal-api";
import { APPLICATION_ID, assertApplicationOwner } from "@/lib/portal-auth";
import { portalSummary } from "@/lib/repo/payments";

// GET /api/portal/payment?applicationId=<Wix item id>[&attempt=<attempt id>]
// Authorization: Bearer <Wix member access token>
// The signed-in client's own payment request and latest attempt. With `attempt` (coming back from Paynet) the attempt is
// first read back from Paynet's API, so the status shown is the confirmed one, never the redirect's word.
export const maxDuration = 30;
export const OPTIONS = portalOptions;
export const GET = portalRoute({ member: true }, async ({ member, token, search }) => {
  const applicationId = search.get("applicationId") || "";
  const attempt = search.get("attempt");
  if (!APPLICATION_ID.test(applicationId)) throw new HttpError(400, "Missing application", "bad_request");
  if (attempt && !/^[0-9a-f-]{36}$/i.test(attempt)) throw new HttpError(400, "Bad payment reference", "bad_request");
  await assertApplicationOwner(token!, applicationId, member!);
  return portalSummary(member!, applicationId, attempt);
});
