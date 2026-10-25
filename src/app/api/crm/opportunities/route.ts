import { NextResponse } from "next/server";
import { crmContext } from "@/app/api/_access";
import { withApi } from "@/server/api";
import { placeOf } from "@/server/services/space-place";
import { parseJson } from "@/server/validation";
import {
  createOpportunity,
  createOpportunitySchema,
  listOpportunities,
} from "@/server/services/crm";

/** GET: opportunities of the caller's org (staff with `crm.view`; guests get 403 `guest.no_access`). */
export async function GET() {
  return withApi(async () => {
    const ctx = await crmContext("view");
    const opportunities = await listOpportunities(ctx, await placeOf({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }));
    return NextResponse.json({ opportunities });
  });
}

/** POST: create an opportunity linked to an existing customer (`crm.edit`). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    const input = await parseJson(createOpportunitySchema, req);
    const opportunity = await createOpportunity(ctx, input);
    return NextResponse.json({ opportunity }, { status: 201 });
  });
}
