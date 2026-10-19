import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import {
  deleteTicketComment,
  editTicketComment,
  ticketCommentSchema,
} from "@/server/services/tickets";

/** PATCH: edit a comment (author or org admin). */
export async function PATCH(req: Request, { params }: { params: { id: string; commentId: string } }) {
  return withApi(async () => {
    const input = await parseJson(ticketCommentSchema, req);
    const ctx = await activeOrgCtx();
    const comment = await editTicketComment(ctx, params.id, params.commentId, input.body);
    return NextResponse.json({ comment });
  });
}

/** DELETE: remove a comment (author or org admin). */
export async function DELETE(_req: Request, { params }: { params: { id: string; commentId: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteTicketComment(ctx, params.id, params.commentId);
    return NextResponse.json({ ok: true });
  });
}