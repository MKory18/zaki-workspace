import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  createOpportunity,
  createOpportunitySchema,
  listOpportunities,
} from "@/server/services/crm";

/** GET: opportunities of the caller's org. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const opportunities = await listOpportunities(ctx.orgId);
    return NextResponse.json({ opportunities });
  });
}

/** POST: create an opportunity linked to an existing customer. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createOpportunitySchema, req);
    const ctx = await activeOrgCtx();
    const opportunity = await createOpportunity(ctx, input);
    return NextResponse.json({ opportunity }, { status: 201 });
  });
}
