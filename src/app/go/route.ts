import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE, spacesOf } from "@/server/services/current-space";
import { safeNext } from "@/lib/space-link";

/**
 * GET /go?space=<id>&next=<path> — enters a space and opens `next` (its «اليوم» by default).
 *
 * The space switcher, the «كل المساحات» page and every link to work of another space go through here. A space
 * the person may not open is not entered (the cookie stays as it was) and `next` then answers for itself
 * («not found»). The Location is RELATIVE: behind the proxy `req.url` is not the address the person uses.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const url = new URL(req.url);
    const wanted = url.searchParams.get("space");
    const res = new NextResponse(null, { status: 303, headers: { Location: safeNext(url.searchParams.get("next")) } });
    if (wanted && (await spacesOf(actor)).some((s) => s.id === wanted)) {
      res.cookies.set(SPACE_COOKIE, wanted, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return res;
  });
}
