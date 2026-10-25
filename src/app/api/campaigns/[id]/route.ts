import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { assertNotGuest } from "@/server/services/guest-guard";
import { parseJson } from "@/server/validation";
import {
  campaignDetail,
  deleteCampaign,
  updateCampaign,
  updateCampaignSchema,
} from "@/server/services/campaigns";

/** GET: full campaign detail (with dated items); never for guests (403). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const campaign = await campaignDetail(ctx, params.id);
    return NextResponse.json({ campaign });
  });
}

/** PATCH: edit / transition the campaign (dept members & org admins). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(updateCampaignSchema, req);
    const campaign = await updateCampaign(ctx, params.id, input);
    return NextResponse.json({ campaign });
  });
}

/** DELETE: remove the campaign (dept members & org admins). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteCampaign(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}