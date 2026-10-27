import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { listInstantTickets } from "@/server/services/tickets";

/** GET: every «تذكرة فورية» of the company, for the OWNER and the ADMINs (anybody else: an empty list). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    return NextResponse.json({ tickets: await listInstantTickets(ctx) });
  });
}
