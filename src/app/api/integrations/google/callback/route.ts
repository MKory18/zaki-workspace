import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError, UnauthorizedError } from "@/server/auth";
import { appUrl } from "@/server/env";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { exchangeCode, connectGoogle, verifyState } from "@/server/services/google";

/**
 * GET: Google consent redirect lands here — exchanges the code, stores tokens.
 * Every redirect is built from APP_URL, the address the user really uses. `req.url` is NOT
 * that address behind a reverse proxy (under `next start` it is the bind host,
 * https://localhost:3000), so the user would land on a dead page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (query: string) => NextResponse.redirect(new URL(`${appUrl()}${query}`));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("/automation?google=error&reason=missing_params");

  const parsed = verifyState(state);
  if (!parsed) return back("/automation?google=error&reason=bad_state");

  return withApi(async () => {
    // Only "nobody is signed in" goes to the login screen; every other refusal (a person who has not
    // finished onboarding, for instance) is answered as the error it is (403 + its message key).
    let ctx;
    try {
      ctx = await activeOrgCtx();
    } catch (err) {
      if (err instanceof UnauthorizedError) return back("/login?next=" + encodeURIComponent("/automation"));
      throw err;
    }
    const sessionUserId = ctx.userId;

    // Connecting Drive is an org-level decision: the caller must hold `integrations.manage` in the
    // org the state names, and the state must have been issued to the very person who is
    // finishing the flow (a state is signed, not secret — it must not be replayable by others).
    await assertOrgManager(parsed.orgId);
    if (parsed.userId !== sessionUserId) throw new ForbiddenError("forbidden");

    const tokens = await exchangeCode(code);
    if (!tokens.ok) {
      const reason = encodeURIComponent(tokens.error.slice(0, 100));
      return back(`/automation?google=error&reason=${reason}`);
    }
    await connectGoogle(parsed.orgId, parsed.userId, tokens);
    return back("/automation?google=connected");
  });
}
