import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import {
  createCampaign,
  createCampaignSchema,
  listDepartmentCampaigns,
} from "@/server/services/campaigns";

/** GET: campaigns of the caller's org department. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const dept = await db.department.findFirst({
      where: { id: params.id, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!dept) throw new NotFoundError("dept.not_found");
    const campaigns = await listDepartmentCampaigns(dept.id);
    return NextResponse.json({ campaigns });
  });
}

/** POST: create a campaign in this department (org member, not a guest). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(createCampaignSchema, req);
    const campaign = await createCampaign(ctx, params.id, input);
    return NextResponse.json({ campaign }, { status: 201 });
  });
}