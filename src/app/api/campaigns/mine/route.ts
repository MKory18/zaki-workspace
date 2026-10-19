import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { myCampaigns } from "@/server/services/campaigns";

/** GET: «حملاتي» — campaigns owned by the caller in their org. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const campaigns = await myCampaigns(ctx);
    return NextResponse.json({ campaigns });
  });
}