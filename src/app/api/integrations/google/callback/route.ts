import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
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

  // The signed state is org+user bound; still verify membership defensively.
  try {
    await activeOrgCtx();
  } catch {
    return back("/login?next=" + encodeURIComponent("/automation"));
  }

  const tokens = await exchangeCode(code);
  if (!tokens.ok) {
    const reason = encodeURIComponent(tokens.error.slice(0, 100));
    return back(`/automation?google=error&reason=${reason}`);
  }
  await connectGoogle(parsed.orgId, parsed.userId, tokens);
  return back("/automation?google=connected");
}
