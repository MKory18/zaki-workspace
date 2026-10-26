import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { endWatch } from "@/server/services/watch";

/** POST: end a session — whoever started it, the space's admins, the owner. Its talk stays. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    await endWatch(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
