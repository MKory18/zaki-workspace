import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  deleteOpportunity,
  getOpportunity,
  updateOpportunity,
  updateOpportunitySchema,
} from "@/server/services/crm";

/** GET: single opportunity with customer details. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const opportunity = await getOpportunity(ctx, params.id);
    return NextResponse.json({ opportunity });
  });
}

/** PATCH: update opportunity stage/value/etc. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(updateOpportunitySchema, req);
    const opportunity = await updateOpportunity(ctx, params.id, input);
    return NextResponse.json({ opportunity });
  });
}

/** DELETE: remove opportunity. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteOpportunity(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
