import { NextResponse, type NextRequest } from "next/server";

// First line of defence only: signed-out visitors never see an app page. (Every page and API route ALSO verifies the session
// against the database — this proxy just avoids rendering anything for people without a session cookie.)
const PUBLIC_PREFIXES = ["/login", "/api/", "/_next/", "/icons/", "/brand/", "/manifest.webmanifest", "/sw.js", "/favicon.ico", "/icon.png", "/apple-icon.png", "/offline"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("uva_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
