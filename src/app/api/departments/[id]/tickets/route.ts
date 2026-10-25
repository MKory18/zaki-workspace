import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { assertNotGuest } from "@/server/services/guest-guard";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import {
  createTicket,
  createTicketSchema,
  listDepartmentTickets,
} from "@/server/services/tickets";

/** GET: the department's tickets — all of them for its people and the managers, one's own for anybody else (never guests). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const dept = await db.department.findFirst({
      where: { id: params.id, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!dept) throw new NotFoundError("dept.not_found");
    const tickets = await listDepartmentTickets(dept.id, ctx);
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
