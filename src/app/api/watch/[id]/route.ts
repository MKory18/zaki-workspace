import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { watchDetail } from "@/server/services/watch";

/** GET: one session, for the people it was started for (and the owner); anybody else: 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    const { spaceId: _space, ...session } = await watchDetail(ctx, params.id);
    return NextResponse.json({ session });
  });
}
