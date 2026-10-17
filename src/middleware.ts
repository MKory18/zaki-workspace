import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap cookie check only — full JWT verification runs in server code.
 * Protects app pages; API routes enforce auth themselves.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
