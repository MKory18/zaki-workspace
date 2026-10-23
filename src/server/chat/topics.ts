import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canModerate, canPost, canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { isSpaceAdmin } from "@/server/policy/conversation";
import { writeSystemMessage } from "@/server/chat/system";
import type { ConversationDto, MemberDto, MessageDto } from "@/server/chat/dto";
import { presentMessage, type Viewer } from "@/server/chat/redact";
import { messageInclude, dmStatusFor } from "@/server/chat/messages";
import type { Prisma } from "@prisma/client";

/** ---------- create topic ---------- */

export const createTopicSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().trim().min(1, "chat.e.empty").max(120, "chat.e.too_long"),
  emoji: z.string().max(16).optional(),
  restricted: z.boolean().optional(),
  postingPolicy: z.enum(["ALL", "ADMINS"]).optional(),
});

export async function createTopic(ctx: OrgAccessContext, input: z.infer<typeof createTopicSchema>): Promise<{ id: string }> {
  // only a space admin of THIS space (or the org OWNER) opens a topic
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const sm = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.spaceId, userId: ctx.userId } },
    select: { role: true },
  });
  const ws = await db.workspace.findFirst({ where: { id: input.spaceId, organizationId: ctx.orgId }, select: { id: true } });
  if (!ws) throw new NotFoundError("chat.e.not_found");
  if (!(org?.role === "OWNER" || isSpaceAdmin(sm?.role ?? null))) throw new ForbiddenError("chat.e.moderator_only");

  const topic = await db.$transaction(async (tx) => {
    const t = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        spaceId: input.spaceId,
        kind: "TOPIC",
        title: input.title,
        emoji: input.emoji ?? null,
        topicType: "DISCUSSION",
        restricted: input.restricted ?? false,
        postingPolicy: input.postingPolicy ?? "ALL",
        members: { create: { userId: ctx.userId } }, // the creator is in their own topic
      },
      select: { id: true },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: input.spaceId });
    return t;
  });
  return { id: topic.id };
}

/** ---------- settings (space admins / owner only) ---------- */

export const updateTopicSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  emoji: z.string().max(16).nullable().optional(),
  restricted: z.boolean().optional(),
  postingPolicy: z.enum(["ALL", "ADMINS"]).optional(),
});

export async function updateTopic(ctx: OrgAccessContext, conversationId: string, input: z.infer<typeof updateTopicSchema>): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { ...input } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- join / leave ---------- */

export async function joinTopic(ctx: OrgAccessContext, conversationId: string): Promise<{ joined: boolean }> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (facts.viewerIsMember) return { joined: true };
  if (org.role === "GUEST" && facts.topicType === "ANNOUNCEMENTS") throw new ForbiddenError("chat.e.guest_read_only");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.create({ data: { conversationId, userId: ctx.userId } });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "join" });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId, spaceId: facts.spaceId ?? undefined });
  });
  return { joined: true };
}

export async function leaveTopic(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const { facts } = await guardTopic(ctx, conversationId);
  if (!facts.viewerIsMember) throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId: ctx.userId } } });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- add / remove member (space admins + owner; restricted topics only) ---------- */

export async function addMember(ctx: OrgAccessContext, conversationId: string, userId: string): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  const target = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
    select: { status: true },
  });
  if (!target || target.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId },
      update: {},
    });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId, spaceId: facts.spaceId ?? undefined });
  });
}

export async function removeMember(ctx: OrgAccessContext, conversationId: string, userId: string): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.deleteMany({ where: { conversationId, userId } });
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- close / reopen (space admins + owner) ---------- */

export async function setTopicClosed(ctx: OrgAccessContext, conversationId: string, closed: boolean): Promise<void> {
  const { facts, org } = await guardTopic(ctx, conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { closedAt: closed ? new Date() : null } });
    await tx.chatMessage.create({
      data: {
        orgId: ctx.orgId,
        conversationId,
        authorId: ctx.userId,
        body: JSON.stringify({ k: closed ? "close" : "reopen", p: {} }),
        kind: "SYSTEM",
      },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, spaceId: facts.spaceId ?? undefined });
  });
}

/** ---------- pagination + detail ---------- */

const PAGE = 50;

/** The detail page of one conversation for one viewer (the newest `limit` messages). */
export async function conversationDetail(
  ctx: OrgAccessContext,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ConversationDto> {
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  // another company's conversation does not exist for this viewer, whatever their rank at home
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");

  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), PAGE);
  const where: Prisma.ChatMessageWhereInput = { conversationId };
  if (opts.before) {
    const anchor = await db.chatMessage.findUnique({ where: { id: opts.before }, select: { createdAt: true } });
    if (!anchor) throw new NotFoundError("chat.e.not_found");
    where.createdAt = { lt: anchor.createdAt };
  }

  const [rows, conv] = await Promise.all([
    db.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1, // one extra: is there an older page?
      include: messageInclude(),
    }),
    db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        space: { select: { id: true, name: true, organizationId: true } },
        members: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    }),
  ]);
  if (!conv) throw new NotFoundError("chat.e.not_found");

  const hasOlder = rows.length > limit;
  const page = rows.slice(0, limit);

  // who is online, for the member pills
  const { onlineUserIds } = await import("@/server/realtime/presence");
  const online = new Set(await onlineUserIds(ctx.orgId));

  const canModerateHere = canModerate(facts, org!);
  const viewer: Viewer = { userId: ctx.userId, role: org!.role, canModerateHere };

  // DM ticks: the OTHER person's marks decide my own messages' status
  let otherMember: { lastDeliveredAt: Date | null; lastReadAt: Date | null } | null = null;
  if (facts.kind === "DM") {
    otherMember = conv.members.find((m) => m.userId !== ctx.userId) ?? null;
  }

  const messages: MessageDto[] = page.map((row) =>
    presentMessage(
      row as never,
      viewer,
      facts.kind === "DM" && row.authorId === ctx.userId ? dmStatusFor(otherMember, row.createdAt) : undefined,
    ),
  );

  const members: MemberDto[] = conv.members.map((m) => ({
    id: m.userId,
    name: m.user.name,
    online: online.has(m.userId),
    role: m.role,
  }));

  const title =
    facts.kind === "DM"
      ? (conv.members.find((m) => m.userId !== ctx.userId)?.user.name ?? conv.title ?? "")
      : (conv.title ?? "");

  return {
    id: conv.id,
    kind: facts.kind,
    title,
    emoji: conv.emoji,
    topicType: conv.topicType as ConversationDto["topicType"],
    postingPolicy: conv.postingPolicy as ConversationDto["postingPolicy"],
    restricted: conv.restricted,
    closed: !!conv.closedAt,
    space: conv.space ? { id: conv.space.id, name: conv.space.name, hasExternal: false } : null,
    me: {
      canPost: canPost(facts, org!, { ownerJoined: facts.viewerIsMember }),
      canModerate: canModerateHere,
      muted: !!(facts.mutedUntil && facts.mutedUntil > new Date()),
      oversight: org!.role === "OWNER" && !facts.viewerIsMember,
    },
    members,
    messages: messages.reverse(), // oldest first in the payload
    readers: [], // the UI shows readers from the realtime read receipts, not a list here
    oldestId: hasOlder ? (messages[0]?.id ?? null) : null,
  };
}

/** Shared guard: the conversation exists, is of this org, and facts/org are non-null. */
export async function guardTopic(ctx: OrgAccessContext, conversationId: string) {
  const [facts, org] = await Promise.all([
    loadConversationFacts(ctx.userId, conversationId),
    loadOrgFacts(ctx.userId, ctx.orgId),
  ]);
  if (!facts || !org || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  return { facts, org };
}

