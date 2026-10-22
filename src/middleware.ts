import { NextResponse, type NextRequest } from "next/server";
import { originAllowed } from "@/lib/origin-guard";

/**
 * 1. Writes to the JSON API must come from this app's own pages (see origin-guard.ts).
 *    Machine-to-machine endpoints are exempt: they authenticate with their own
 *    token/signature and are not called from a browser.
 * 2. Cheap cookie check for app pages — full JWT verification runs in server code.
 *    API routes enforce auth themselves.
 */
const MACHINE_PATHS = ["/api/integrations/n8n/inbound", "/api/v1", "/api/health"];

/** Exact path or a sub-path ("/api/v1/ideas"); a look-alike such as "/api/healthx" is NOT a machine endpoint. */
function isMachinePath(pathname: string): boolean {
  return MACHINE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") && !isMachinePath(pathname)) {
    const allowed = originAllowed({
      method: req.method,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      appUrl: process.env["APP_URL"],
    });
    if (!allowed) {
      return NextResponse.json({ error: "forbidden", message: "origin.mismatch" }, { status: 403 });
    }
  }

  const publicPaths = ["/login", "/register", "/api/auth/login", "/api/auth/register"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith("/_next"))) {
    return NextResponse.next();
  }
  const hasSession = req.cookies.has("zaki_session");
  if (!hasSession && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
