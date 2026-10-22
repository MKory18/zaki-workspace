import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { exchangeCode, connectGoogle, verifyState } from "@/server/services/google";

/** GET: Google consent redirect lands here — exchanges the code, stores tokens. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (query: string) => NextResponse.redirect(new URL(query, url.origin));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("/automation?google=error&reason=missing_params");

  const parsed = verifyState(state);
  if (!parsed) return back("/automation?google=error&reason=bad_state");

  let ctx;
  try {
    ctx = await activeOrgCtx();
  } catch {
    return back("/login?next=" + encodeURIComponent("/automation"));
  }
  const sessionUserId = ctx.userId;

  return withApi(async () => {
    // Connecting Drive is an org-level decision: the caller must be an OWNER/ADMIN of the
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
