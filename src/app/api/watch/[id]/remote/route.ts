import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { handOverRemote, handOverSchema, pressRemote, pressSchema, watchRemote } from "@/server/services/watch";

/** The remote of a «نتفرّج سوا» session. Its people only (and the owner); anybody else: 404. */

/** GET: where the session is (playing or paused, from which second, as of when), and the server's clock. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    return NextResponse.json({ remote: await watchRemote(ctx, params.id) });
  });
}

/** POST: a press (play, pause, a jump) by whoever holds the remote. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    const body = await parseJson(pressSchema, req);
    return NextResponse.json({ remote: await pressRemote(ctx, params.id, body) });
  });
}

/** PATCH: hand the remote to one of the session's people, or «الكل بيتحكّم» on or off. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    const body = await parseJson(handOverSchema, req);
    return NextResponse.json({ remote: await handOverRemote(ctx, params.id, body) });
  });
}
