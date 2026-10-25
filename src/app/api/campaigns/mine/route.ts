import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { assertNotGuest } from "@/server/services/guest-guard";
import { myCampaigns } from "@/server/services/campaigns";

/** GET: «حملاتي» — campaigns owned by the caller in their org (never for guests: 403). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const campaigns = await myCampaigns(ctx);
    return NextResponse.json({ campaigns });
  });
}