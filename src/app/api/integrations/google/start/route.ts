import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { UnauthorizedError } from "@/server/auth";
import { appUrl } from "@/server/env";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { buildAuthUrl, googleApp } from "@/server/services/google";

/**
 * GET: starts the Google consent screen. Drive is an org-level asset, so only whoever holds the
 * `integrations.manage` capability (the owner, admins by default) may start it: a guest or a plain
 * member gets 403 and is never sent to Google (checked before anything about the configuration is
 * revealed).
 * Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the deployment env —
 * without them we redirect back with an explicit `not_configured` marker
 * instead of pretending.
 * Our own redirects are built from APP_URL, never from `req.url`: behind a reverse proxy that is the
 * bind host (https://localhost:3000), not where the user is.
 * Only "nobody is signed in" is sent to the login screen; every other refusal (for instance a person
 * who has not finished onboarding: 403 `auth.onboarding_required`) is answered as the error it is.
 */
export async function GET() {
  const back = (query: string) => NextResponse.redirect(new URL(`${appUrl()}${query}`));
  return withApi(async () => {
    let ctx;
    try {
      ctx = await activeOrgCtx();
    } catch (err) {
      if (err instanceof UnauthorizedError) return back(`/login?next=${encodeURIComponent("/automation")}`);
      throw err;
    }
    const { orgId, userId } = ctx;
    await assertOrgManager(orgId);
    if (!(await googleApp(ctx.orgId))) return back("/automation?google=not_configured");
    return NextResponse.redirect(await buildAuthUrl(orgId, userId));
  });
}
