import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import {
  conversationDetail,
  manageGroup as manageGroupService,
  manageGroupSchema,
  markRead,
  requireConversationMember,
} from "@/server/services/chat";

/** GET: conversation header + members + recent messages (ascending). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const detail = await conversationDetail(params.id, ctx.userId);
    return NextResponse.json(detail);
  });
}

/** POST: mark the conversation as read (called when the thread is opened). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await requireConversationMember(params.id, ctx.userId);
    await markRead(ctx.userId, params.id);
    return NextResponse.json({ ok: true });
  });
}

/** PATCH: rename/re-emote + add/remove members. GROUP, admin only. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(manageGroupSchema, req);
    const ctx = await activeOrgCtx();
    await manageGroupService(ctx, params.id, input);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: leave a group (DMs are immutable). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const member = await requireConversationMember(params.id, ctx.userId);
    if (member.conversation.kind !== "GROUP") throw new ForbiddenError("chat.dm_immutable");
    await db.conversationMember.delete({
      where: { conversationId_userId: { conversationId: params.id, userId: ctx.userId } },
    });
    return NextResponse.json({ ok: true });
  });
}
