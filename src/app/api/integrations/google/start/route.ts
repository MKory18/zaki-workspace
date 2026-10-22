import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { appUrl } from "@/server/env";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { buildAuthUrl, googleEnv } from "@/server/services/google";

/**
 * GET: starts the Google consent screen. Drive is an org-level asset, so only an
 * org OWNER/ADMIN may start it: a guest or a plain member gets 403 and is never
 * sent to Google (checked before anything about the configuration is revealed).
 * Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the deployment env —
 * without them we redirect back with an explicit `not_configured` marker
 * instead of pretending.
 * Our own redirects are built from APP_URL, never from `req.url`: behind a reverse
 * proxy that is the bind host (https://localhost:3000), not where the user is.
 */
export async function GET() {
  const back = (query: string) => NextResponse.redirect(new URL(`${appUrl()}${query}`));
  let ctx;
  try {
    ctx = await activeOrgCtx();
  } catch {
    return back(`/login?next=${encodeURIComponent("/automation")}`);
  }
  const { orgId, userId } = ctx;
  return withApi(async () => {
    await assertOrgManager(orgId);
    if (!googleEnv()) return back("/automation?google=not_configured");
    return NextResponse.redirect(buildAuthUrl(orgId, userId));
  });
}
