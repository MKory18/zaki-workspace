import { NextResponse } from "next/server";
import { crmContext } from "@/app/api/_access";
import { withApi } from "@/server/api";
import { placeOf } from "@/server/services/space-place";
import { parseJson } from "@/server/validation";
import { createCustomer, createCustomerSchema, listCustomers } from "@/server/services/crm";

/** GET: customers of the caller's org (staff with `crm.view`; guests get 403 `guest.no_access`). */
export async function GET() {
  return withApi(async () => {
    const ctx = await crmContext("view");
    const customers = await listCustomers(ctx, await placeOf({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }));
    return NextResponse.json({ customers });
  });
}

/** POST: create a customer (`crm.edit`; guests get 403 `guest.no_access`). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await crmContext("edit");
    const input = await parseJson(createCustomerSchema, req);
    const customer = await createCustomer(ctx, input, (await placeOf({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole })).spaceId);
    return NextResponse.json({ customer }, { status: 201 });
  });
}
