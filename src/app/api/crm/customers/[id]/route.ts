import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  deleteCustomer,
  getCustomer,
  updateCustomer,
  updateCustomerSchema,
} from "@/server/services/crm";

/** GET: single customer with its opportunities. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const customer = await getCustomer(ctx, params.id);
    return NextResponse.json({ customer });
  });
}

/** PATCH: update customer fields. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(updateCustomerSchema, req);
    const ctx = await activeOrgCtx();
    const customer = await updateCustomer(ctx, params.id, input);
    return NextResponse.json({ customer });
  });
}

/** DELETE: remove customer (opportunities cascade). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteCustomer(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
