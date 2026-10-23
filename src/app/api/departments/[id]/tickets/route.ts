import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import {
  createTicket,
  createTicketSchema,
  listDepartmentTickets,
} from "@/server/services/tickets";

/** GET: all tickets of the caller's org department. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const dept = await db.department.findFirst({
      where: { id: params.id, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!dept) throw new NotFoundError("dept.not_found");
    const tickets = await listDepartmentTickets(dept.id);
    return NextResponse.json({ tickets });
  });
}

/** POST: open a ticket in this department (org member, not a guest; dept members assign). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(createTicketSchema, req);
    const ticket = await createTicket(ctx, params.id, input);
    return NextResponse.json({ ticket }, { status: 201 });
  });
}
