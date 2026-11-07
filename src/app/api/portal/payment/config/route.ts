import { portalOptions, portalRoute } from "@/lib/portal-api";
import { portalConfig } from "@/lib/repo/payments";

// Public: whether online payment is switched on, so the portal knows whether to show «Վճարել առցանց».
// Holds no client data and no secret.
export const OPTIONS = portalOptions;
export const GET = portalRoute({ member: false }, async () => portalConfig());
