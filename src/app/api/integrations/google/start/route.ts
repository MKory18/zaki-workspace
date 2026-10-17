import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { buildAuthUrl, googleEnv } from "@/server/services/google";

/**
 * GET: starts the Google consent screen. Requires GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET in the deployment env — without them we redirect back
 * with an explicit `not_configured` marker instead of pretending.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (query: string) => NextResponse.redirect(new URL(query, url.origin));
  if (!googleEnv()) return back("/automation?google=not_configured");
  let ctx;
  try {
    ctx = await activeOrgCtx();
  } catch {
    return back(`/login?next=${encodeURIComponent("/automation")}`);
  }
  return NextResponse.redirect(buildAuthUrl(ctx.orgId, ctx.userId));
}
