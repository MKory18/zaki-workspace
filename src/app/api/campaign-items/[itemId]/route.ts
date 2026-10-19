import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { deleteCampaignItem, toggleCampaignItem } from "@/server/services/campaigns";

/** POST: toggle item done/undone. */
export async function POST(_req: Request, { params }: { params: { itemId: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const item = await toggleCampaignItem(ctx, params.itemId);
    return NextResponse.json({ item });
  });
}

/** DELETE: remove the item. */
export async function DELETE(_req: Request, { params }: { params: { itemId: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteCampaignItem(ctx, params.itemId);
    return NextResponse.json({ ok: true });
  });
}