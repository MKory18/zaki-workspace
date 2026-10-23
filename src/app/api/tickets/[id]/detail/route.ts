import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  addTicketComment,
  ticketCommentSchema,
  ticketDetail,
} from "@/server/services/tickets";

/** GET: full ticket detail (comments + activity log) — org-scoped. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const ticket = await ticketDetail(ctx, params.id);
    return NextResponse.json({ ticket });
  });
}

/** POST: add a comment to the ticket (org member; guests get 403 from the service). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(ticketCommentSchema, req);
    const comment = await addTicketComment(ctx, params.id, input.body);
    return NextResponse.json({ comment }, { status: 201 });
  });
}