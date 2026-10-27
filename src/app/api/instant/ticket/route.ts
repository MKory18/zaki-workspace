import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { assertNotGuest } from "@/server/services/guest-guard";
import { createInstantTicket, instantTicketSchema } from "@/server/services/tickets";

/** POST: «تذكرة فورية» — no department, straight to a person (src/server/services/tickets.ts). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "instantWork");
    assertNotGuest(ctx);
    const input = await parseJson(instantTicketSchema, req);
    const ticket = await createInstantTicket(ctx, input);
    return NextResponse.json({ ticket }, { status: 201 });
  });
}
