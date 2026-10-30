import { authorizeFeedRequest, buildFeedFor, feedEtag } from "@/server/services/calendar-feed";
import { clientIp } from "@/server/rate-limit";
import { log } from "@/server/log";

/**
 * «اشتراك التقويم» — the private feed a calendar app polls: GET /api/calendar/feed/<token>.ics
 *
 * No session cookie: the token in the address IS the credential (a calendar app cannot sign in). It is a GET, so the Origin
 * guard of the middleware does not apply and no machine path is needed; nothing here sets a cookie.
 *
 * Every refusal is the same empty 404 (a link that never existed, a revoked one, a suspended person, a guest, a switched-off
 * feature): nobody learns which. Too many requests from one address or for one link: 429 with Retry-After.
 * The answer is rebuilt from the database on every request (src/server/services/calendar-feed.ts) and carries an ETag, so a
 * calendar app that asks again with `If-None-Match` gets 304.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  try {
    const raw = params.token.replace(/\.ics$/i, "");
    const access = await authorizeFeedRequest(raw, clientIp(req));
    if (!access.ok) {
      if (access.reason === "limited") {
        return new Response(null, { status: 429, headers: { "Retry-After": String(Math.max(1, access.retryAfterSec)), "Cache-Control": "no-store" } });
      }
      return NOT_FOUND();
    }
    const body = await buildFeedFor(access.identity);
    const etag = feedEtag(body);
    const headers = {
      "Cache-Control": "private, max-age=300",
      ETag: etag,
    };
    if (req.headers.get("if-none-match")?.split(",").some((v) => v.trim() === etag)) return new Response(null, { status: 304, headers });
    return new Response(body, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="zaki.ics"' },
    });
  } catch (err) {
    // whatever failed is ours to fix, and says nothing to the caller
    log.error("calendar_feed.failed", { name: err instanceof Error ? err.name : "unknown", message: err instanceof Error ? err.message : String(err) });
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
