import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createCustomer, createCustomerSchema, listCustomers } from "@/server/services/crm";

/** GET: customers of the caller's org. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const customers = await listCustomers(ctx.orgId);
    return NextResponse.json({ customers });
  });
}

/** POST: create a customer (org member; guests blocked in service). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createCustomerSchema, req);
    const ctx = await activeOrgCtx();
    const customer = await createCustomer(ctx, input);
    return NextResponse.json({ customer }, { status: 201 });
  });
}
