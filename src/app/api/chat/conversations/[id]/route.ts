import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { ForbiddenError } from "@/server/auth";
import { conversationDetail, joinTopic, leaveTopic } from "@/server/chat/topics";
import { manageGroup, leaveConversation } from "@/server/chat/dm";
import { markRead } from "@/server/chat/messages";

/** The body of PATCH (group settings): the shape dm.ts `manageGroup` expects. */
const patchSchema = z.object({
  title: z.string().trim().min(2).max(60).optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  addMemberIds: z.array(z.string().min(1)).max(50).optional(),
  removeMemberIds: z.array(z.string().min(1)).max(50).optional(),
});

const pageQuery = z.object({
  before: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

async function requireNonGuest(ctx: Awaited<ReturnType<typeof activeOrgCtx>>) {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (org?.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
}

async function allowGuestTopicOnly(ctx: Awaited<ReturnType<typeof activeOrgCtx>>, conversationId: string) {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (org?.role !== "GUEST") return;
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  if (facts?.kind !== "TOPIC") throw new ForbiddenError("chat.guest_forbidden");
}

/** GET: conversation header + members + one page of messages (oldest first). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await allowGuestTopicOnly(ctx, params.id);
    const q = pageQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    const detail = await conversationDetail(ctx, params.id, { before: q.before, limit: q.limit });
    return NextResponse.json(detail);
  });
}

/** POST: mark the conversation as read (`?upTo=<messageId>` caps the mark; the owner in oversight reads silently). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await allowGuestTopicOnly(ctx, params.id);
    const upTo = new URL(req.url).searchParams.get("upTo") ?? undefined;
    await markRead(ctx, params.id, upTo);
    return NextResponse.json({ ok: true });
  });
}

/** PATCH: group settings — title, emoji, members (a group admin only; the service refuses topics). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const ctx = await activeOrgCtx();
    await requireNonGuest(ctx);
    await manageGroup(ctx, params.id, input);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: leave — a topic through `leaveTopic`, a group/DM through `leaveConversation`. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await requireNonGuest(ctx);
    try {
      await leaveConversation(ctx, params.id);
    } catch (err) {
      // not found / not a member here may mean it is a topic: try the topic path once
      if (err instanceof Error && err.name === "NotFoundError") {
        await leaveTopic(ctx, params.id);
        return NextResponse.json({ ok: true });
      }
      throw err;
    }
    return NextResponse.json({ ok: true });
  });
}
