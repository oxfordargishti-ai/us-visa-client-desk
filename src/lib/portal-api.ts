// Route wrapper for calls coming from the client portal (another origin). Unlike `handler` in ./api it does not use the
// Desk session cookie at all: the caller is identified by a Wix member token in the Authorization header, and CORS is
// granted only to the portal's own origins. Errors come back as the same { error, code } JSON.
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "./errors";
import { paynetConfig } from "./paynet";
import { bearerToken, verifyPortalMember, type PortalMember } from "./portal-auth";

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && paynetConfig.portalOrigins.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

/** Preflight: answered for the portal's origins only. */
export function portalOptions(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = !!origin && paynetConfig.portalOrigins.includes(origin);
  return new NextResponse(null, { status: allowed ? 204 : 403, headers: corsHeaders(origin) });
}

export function portalRoute<T>(
  opts: { member: boolean },
  fn: (ctx: { req: NextRequest; member: PortalMember | null; token: string | null; search: URLSearchParams }) => Promise<T>,
) {
  return async (req: NextRequest): Promise<Response> => {
    const origin = req.headers.get("origin");
    const headers = corsHeaders(origin);
    try {
      // A browser on any other site is refused outright (a request without Origin is a server or a test tool).
      if (origin && !paynetConfig.portalOrigins.includes(origin)) throw new HttpError(403, "Not allowed from this site", "origin");
      const token = bearerToken(req);
      const member = opts.member ? await verifyPortalMember(token) : null;
      const result = await fn({ req, member, token, search: new URL(req.url).searchParams });
      return NextResponse.json(result ?? { ok: true }, { headers });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers });
      // Never echo internals, tokens or client data to the browser or the logs.
      console.error("[portal] unhandled error:", e instanceof Error ? e.name : "unknown");
      return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "internal" }, { status: 500, headers });
    }
  };
}
