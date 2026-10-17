import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteTicket, updateTicket, updateTicketSchema } from "@/server/services/tickets";

/** PATCH: edit / transition / assign a ticket (dept members & org admins). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(updateTicketSchema, req);
    const ctx = await activeOrgCtx();
    const ticket = await updateTicket(ctx, params.id, input);
    return NextResponse.json({ ticket });
  });
}

/** DELETE: remove a ticket (dept members & org admins). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteTicket(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
