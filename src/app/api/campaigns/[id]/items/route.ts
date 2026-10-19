import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { addCampaignItem, campaignItemSchema } from "@/server/services/campaigns";

/** POST: add a dated item to the campaign calendar. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(campaignItemSchema, req);
    const ctx = await activeOrgCtx();
    const item = await addCampaignItem(ctx, params.id, input);
    return NextResponse.json({ item }, { status: 201 });
  });
}