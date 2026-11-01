import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUser, type SessionUser } from "./auth";
import { env } from "./env";
import { safeEqual } from "./crypto";

import { HttpError, badRequest } from "./errors";
export { HttpError, badRequest, notFound, conflict, zId, zIso } from "./errors";

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, "Bad origin", "csrf");
    }
    const appHost = (() => {
      try {
        return new URL(env.appUrl).host;
      } catch {
        return "";
      }
    })();
    if (originHost !== host && originHost !== appHost) throw new HttpError(403, "Cross-site request blocked", "csrf");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) throw new HttpError(403, "Cross-site request blocked", "csrf");
  if (!site && env.isProd) throw new HttpError(403, "Missing origin", "csrf");
}

export interface Ctx<B, P> {
  req: NextRequest;
  user: SessionUser;
  params: P;
  body: B;
  search: URLSearchParams;
  ip: string;
}

type Opts<S extends z.ZodType | undefined> = {
  schema?: S;
  /** "user" (default) requires a session; "cron" requires Authorization: Bearer CRON_SECRET; "none" is public. */
  auth?: "user" | "cron" | "none";
};

/** Wraps a route handler with auth, CSRF protection, JSON/zod validation and uniform error responses. */
export function handler<S extends z.ZodType | undefined = undefined, P extends Record<string, string> = Record<string, string>>(
  opts: Opts<S>,
  fn: (ctx: Ctx<S extends z.ZodType ? z.infer<S> : undefined, P>) => Promise<unknown>,
) {
  return async (req: NextRequest, rc?: { params: Promise<P> }): Promise<Response> => {
    try {
      const mode = opts.auth ?? "user";
      let user = null as SessionUser | null;
      if (mode === "cron") {
        const auth = req.headers.get("authorization") || "";
        if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) throw new HttpError(401, "Unauthorized", "unauthorized");
      } else {
        assertSameOrigin(req);
        if (mode === "user") {
          user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
          if (!user) throw new HttpError(401, "Please sign in again.", "unauthorized");
        }
      }
      let body: unknown = undefined;
      if (opts.schema) {
        let raw: unknown = {};
        if (req.method === "GET" || req.method === "DELETE") {
          raw = Object.fromEntries(new URL(req.url).searchParams);
        } else {
          try {
            raw = await req.json();
          } catch {
            throw badRequest("Request body must be valid JSON");
          }
        }
        const parsed = (opts.schema as z.ZodType).safeParse(raw);
        if (!parsed.success) {
          throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), parsed.error.issues);
        }
        body = parsed.data;
      }
      const params = (rc?.params ? await rc.params : {}) as P;
      const result = await fn({
        req,
        user: user as SessionUser,
        params,
        body: body as never,
        search: new URL(req.url).searchParams,
        ip: clientIp(req),
      });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
      }
      // Never echo internals (or request bodies, which may contain client data) to the browser or the logs.
      console.error("[api] unhandled error:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
      return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "internal" }, { status: 500 });
    }
  };
}
