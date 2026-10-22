import { NextResponse } from "next/server";
import { crmContext } from "@/app/api/_access";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  deleteCustomer,
  getCustomer,
  updateCustomer,
  updateCustomerSchema,
} from "@/server/services/crm";

/** GET: single customer with its opportunities (`crm.view`). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("view");
    const customer = await getCustomer(ctx, params.id);
    return NextResponse.json({ customer });
  });
}

/** PATCH: update customer fields (`crm.edit`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    const input = await parseJson(updateCustomerSchema, req);
    const customer = await updateCustomer(ctx, params.id, input);
    return NextResponse.json({ customer });
  });
}

/** DELETE: remove customer (opportunities cascade; `crm.edit`). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    await deleteCustomer(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
