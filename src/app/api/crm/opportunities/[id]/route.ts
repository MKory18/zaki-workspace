import { NextResponse } from "next/server";
import { crmContext } from "@/app/api/_access";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  deleteOpportunity,
  getOpportunity,
  updateOpportunity,
  updateOpportunitySchema,
} from "@/server/services/crm";

/** GET: single opportunity with customer details (`crm.view`). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("view");
    const opportunity = await getOpportunity(ctx, params.id);
    return NextResponse.json({ opportunity });
  });
}

/** PATCH: update opportunity stage/value/etc. (`crm.edit`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    const input = await parseJson(updateOpportunitySchema, req);
    const opportunity = await updateOpportunity(ctx, params.id, input);
    return NextResponse.json({ opportunity });
  });
}

/** DELETE: remove opportunity (`crm.edit`). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    await deleteOpportunity(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
