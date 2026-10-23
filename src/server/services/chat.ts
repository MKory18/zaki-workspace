import { z } from "zod";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { logEvent } from "@/server/services/integrations";

/** Reaction palette — single source of truth, mirrored in the UI and tests. */
export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"] as const;
export type Reaction = (typeof ALLOWED_REACTIONS)[number];

export function isAllowedReaction(emoji: string): emoji is Reaction {
  return (ALLOWED_REACTIONS as readonly string[]).includes(emoji);
}

export interface ChatPermInput {
  conversationKind: "DM" | "GROUP";
  isGroupAdmin: boolean;
  authorId: string;
  viewerId: string;
}

/** Pure policy: who may edit/soft-delete a message. */
export function canModifyMessage(p: ChatPermInput): boolean {
  if (p.authorId === p.viewerId) return true;
  return p.conversationKind === "GROUP" && p.isGroupAdmin;
}

/** Pure policy: who may toggle the pin on a message. */
export function canPinMessage(p: ChatPermInput): boolean {
  // DM: both participants; GROUP: admins only
  if (p.conversationKind === "DM") return true;
  return p.isGroupAdmin;
}

/** Canonical DM pair key: same two ids regardless of who initiates. */
export function dmMembersKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Org-scope chat event log — the same audit surface n8n listens to. */
export async function logChat(orgId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  await logEvent(orgId, { direction: "IN", type, payload: payload as Prisma.InputJsonValue });
}

/**
 * Chat is closed to org GUESTs, for reading as much as for writing: every function below that a
 * route can reach starts with this check, so a member who is demoted to guest loses every thread
 * they were in (their conversation rows stay, but nothing serves them).
 */
export async function assertChatAllowed(orgRole: string): Promise<void> {
  if (orgRole === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
}

export async function requireConversationMember(conversationId: string, userId: string) {
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: { select: { id: true, orgId: true, kind: true, title: true } } },
  });
  if (!member) throw new NotFoundError("chat.not_member");
  return member;
}

// ---------- creation ----------

export const createGroupSchema = z.object({
  kind: z.literal("GROUP"),
  title: z.string().trim().min(2).max(60),
  emoji: z.string().trim().max(16, "chat.bad_emoji").optional().nullable(),
  memberIds: z.array(z.string().min(1)).min(1, "chat.group_needs_members").max(50),
});

export const createDmSchema = z.object({
  kind: z.literal("DM"),
  userId: z.string().min(1),
});

export async function createDm(ctx: OrgAccessContext, otherUserId: string): Promise<string> {
  await assertChatAllowed(ctx.orgRole);
  if (otherUserId === ctx.userId) throw new ForbiddenError("chat.dm_self");
  // the other person must be an ACTIVE, non-GUEST member of the SAME org (guests cannot chat; a
  // suspended or offboarded colleague is not somebody you can start a conversation with)
  const other = await db.organizationMember.findFirst({
    where: { organizationId: ctx.orgId, userId: otherUserId, role: { not: "GUEST" }, status: "ACTIVE" },
    select: { userId: true },
  });
  if (!other) throw new NotFoundError("chat.not_org_member");

  // exactly one DM per pair PER ORG — find it by member signature, whatever creation
  // order; a conversation of another org is never a match
  const mine = await db.conversation.findMany({
    where: { orgId: ctx.orgId, kind: "DM", members: { some: { userId: ctx.userId } } },
    select: { id: true, members: { select: { userId: true } } },
  });
  const existing = mine.find(
    (c) => c.members.length === 2 && c.members.some((m) => m.userId === otherUserId),
  );
  if (existing) return existing.id;

  const conv = await db.conversation.create({
    data: {
      orgId: ctx.orgId,
      kind: "DM",
      members: { create: [{ userId: ctx.userId }, { userId: otherUserId }] },
    },
    select: { id: true },
  });
  await logChat(ctx.orgId, "chat.dm_created", { conversationId: conv.id });
  return conv.id;
}

export async function createGroup(ctx: OrgAccessContext, input: z.infer<typeof createGroupSchema>): Promise<string> {
  await assertChatAllowed(ctx.orgRole);
  const invited = Array.from(new Set(input.memberIds.filter((id) => id !== ctx.userId)));
  // invitees must be ACTIVE members of the same org AND not be guests
  const valid = await db.organizationMember.findMany({
    where: { organizationId: ctx.orgId, userId: { in: invited }, role: { not: "GUEST" }, status: "ACTIVE" },
    select: { userId: true },
  });
  if (valid.length === 0) throw new ForbiddenError("chat.group_needs_members");

  const conv = await db.conversation.create({
    data: {
      orgId: ctx.orgId,
      kind: "GROUP",
      title: input.title,
      emoji: input.emoji ? input.emoji : null,
      members: {
        create: [{ userId: ctx.userId, role: "admin" }, ...valid.map((v) => ({ userId: v.userId }))],
      },
    },
    select: { id: true },
  });
  await logChat(ctx.orgId, "chat.group_created", { conversationId: conv.id, members: valid.length + 1 });
  return conv.id;
}

/** Org-level chat directory (recipients picker; guests excluded — they cannot chat; only ACTIVE people are offered). */
export async function chatDirectory(orgId: string) {
  return db.organizationMember.findMany({
    where: { organizationId: orgId, role: { not: "GUEST" }, status: "ACTIVE" },
    select: {
      userId: true,
      role: true,
      user: { select: { id: true, name: true, jobTitle: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

// ---------- group management (admin only) ----------

export const manageGroupSchema = z.object({
  title: z.string().trim().min(2).max(60).optional(),
  emoji: z.string().trim().max(16, "chat.bad_emoji").nullable().optional(),
  addUserIds: z.array(z.string()).max(50).optional(),
  removeUserIds: z.array(z.string()).max(50).optional(),
});

export async function manageGroup(
  ctx: OrgAccessContext,
  conversationId: string,
  input: z.infer<typeof manageGroupSchema>,
): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  const me = await requireConversationMember(conversationId, ctx.userId);
  if (me.conversation.kind !== "GROUP") throw new ForbiddenError("chat.dm_immutable");
  if (me.role !== "admin") throw new ForbiddenError("chat.group_admin_only");

  const updates: { title?: string; emoji?: string | null } = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.emoji !== undefined) updates.emoji = input.emoji ? input.emoji : null;

  await db.$transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.conversation.update({ where: { id: conversationId }, data: updates });
    }
    if (input.addUserIds?.length) {
      const valid = await tx.organizationMember.findMany({
        where: { organizationId: ctx.orgId, userId: { in: input.addUserIds }, role: { not: "GUEST" }, status: "ACTIVE" },
        select: { userId: true },
      });
      for (const v of valid) {
        await tx.conversationMember.upsert({
          where: { conversationId_userId: { conversationId, userId: v.userId } },
          create: { conversationId, userId: v.userId },
          update: {},
        });
      }
    }
    if (input.removeUserIds?.length) {
      // never remove the last admin — the group must stay manageable
      const admins = await tx.conversationMember.count({
        where: { conversationId, role: "admin" },
      });
      const removing = await tx.conversationMember.count({
        where: { conversationId, userId: { in: input.removeUserIds }, role: "admin" },
      });
      if (admins <= removing) throw new ForbiddenError("chat.last_admin");
      await tx.conversationMember.deleteMany({
        where: { conversationId, userId: { in: input.removeUserIds } },
      });
    }
  });
  await logChat(ctx.orgId, "chat.group_updated", { conversationId, ...input });
}

// ---------- writes ----------

export const sendSchema = z.object({
  body: z.string().trim().min(1, "chat.empty_message").max(4000),
  replyToId: z.string().min(1).max(64).optional(),
});

export async function sendMessage(
  ctx: OrgAccessContext,
  conversationId: string,
  input: z.infer<typeof sendSchema>,
) {
  await assertChatAllowed(ctx.orgRole);
  await requireConversationMember(conversationId, ctx.userId);
  if (input.replyToId) {
    const parent = await db.chatMessage.findFirst({
      where: { id: input.replyToId, conversationId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundError("chat.reply_not_found");
  }
  const msg = await db.chatMessage.create({
    data: {
      orgId: ctx.orgId,
      conversationId,
      authorId: ctx.userId,
      body: input.body,
      replyToId: input.replyToId ?? null,
    },
    select: { id: true, createdAt: true },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  await markRead(ctx.userId, conversationId);
  await logChat(ctx.orgId, "chat.message_sent", { conversationId, messageId: msg.id });
  return msg;
}

export async function editMessage(ctx: OrgAccessContext, messageId: string, body: string): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, authorId: true, deletedAt: true, conversation: { select: { kind: true, members: { select: { userId: true, role: true } } } } },
  });
  if (!msg) throw new NotFoundError("chat.message_not_found");
  const me = msg.conversation.members.find((m) => m.userId === ctx.userId);
  if (!me) throw new NotFoundError("chat.not_member");
  if (!canModifyMessage({ conversationKind: msg.conversation.kind as "DM" | "GROUP", isGroupAdmin: me.role === "admin", authorId: msg.authorId, viewerId: ctx.userId })) {
    throw new ForbiddenError("chat.not_author");
  }
  if (msg.deletedAt) throw new ForbiddenError("chat.deleted");
  await db.chatMessage.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
  await logChat(ctx.orgId, "chat.message_edited", { messageId });
}

export async function deleteMessage(ctx: OrgAccessContext, messageId: string): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, authorId: true, conversation: { select: { kind: true, members: { select: { userId: true, role: true } } } } },
  });
  if (!msg) throw new NotFoundError("chat.message_not_found");
  const me = msg.conversation.members.find((m) => m.userId === ctx.userId);
  if (!me) throw new NotFoundError("chat.not_member");
  if (!canModifyMessage({ conversationKind: msg.conversation.kind as "DM" | "GROUP", isGroupAdmin: me.role === "admin", authorId: msg.authorId, viewerId: ctx.userId })) {
    throw new ForbiddenError("chat.not_author");
  }
  await db.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: "", pinned: false } });
  await logChat(ctx.orgId, "chat.message_deleted", { messageId });
}

export async function toggleReact(ctx: OrgAccessContext, messageId: string, emoji: string): Promise<{ mine: boolean }> {
  await assertChatAllowed(ctx.orgRole);
  if (!isAllowedReaction(emoji)) throw new ForbiddenError("chat.bad_reaction");
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { conversation: { select: { members: { select: { userId: true } } } } },
  });
  if (!msg) throw new NotFoundError("chat.message_not_found");
  const isMember = msg.conversation.members.some((m) => m.userId === ctx.userId);
  if (!isMember) throw new NotFoundError("chat.not_member");
  const existing = await db.chatReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: ctx.userId, emoji } },
  });
  if (existing) {
    await db.chatReaction.delete({ where: { id: existing.id } });
    return { mine: false };
  }
  await db.chatReaction.create({ data: { messageId, userId: ctx.userId, emoji } });
  return { mine: true };
}

export async function togglePin(ctx: OrgAccessContext, messageId: string): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, pinned: true, conversation: { select: { kind: true, members: { select: { userId: true, role: true } } } } },
  });
  if (!msg) throw new NotFoundError("chat.message_not_found");
  const me = msg.conversation.members.find((m) => m.userId === ctx.userId);
  if (!me) throw new NotFoundError("chat.not_member");
  if (!canPinMessage({ conversationKind: msg.conversation.kind as "DM" | "GROUP", isGroupAdmin: me.role === "admin", authorId: "", viewerId: ctx.userId })) {
    throw new ForbiddenError("chat.pin_admin_only");
  }
  const next = !msg.pinned;
  await db.chatMessage.update({ where: { id: messageId }, data: { pinned: next } });
  await logChat(ctx.orgId, "chat.message_pinned", { messageId, pinned: next });
}


export interface ConversationSummary {
  id: string;
  kind: "DM" | "GROUP";
  title: string;
  emoji: string | null;
  updatedAt: Date;
  lastReadAt: Date | null;
  lastMessage: { at: Date; body: string | null; mine: boolean } | null;
  unread: number;
  otherMembers: { id: string; name: string }[];
}

export async function listConversations(ctx: OrgAccessContext): Promise<ConversationSummary[]> {
  await assertChatAllowed(ctx.orgRole);
  const { userId, orgId } = ctx;
  const rows = await db.conversation.findMany({
    where: { orgId, members: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      emoji: true,
      updatedAt: true,
      // only people who are in: a suspended person is not shown to the others (their rows stay for when they return)
      members: {
        where: { user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } } },
        select: { userId: true, lastReadAt: true, user: { select: { id: true, name: true } } },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, deletedAt: true, createdAt: true, authorId: true },
      },
    },
  });

  const unreadByConv = new Map<string, number>();
  await Promise.all(
    rows.map(async (row) => {
      const myMember = row.members.find((m) => m.userId === userId);
      if (!myMember) return;
      const unread = await db.chatMessage.count({
        where: {
          conversationId: row.id,
          deletedAt: null,
          authorId: { not: userId },
          createdAt: { gt: myMember.lastReadAt },
        },
      });
      unreadByConv.set(row.id, unread);
    }),
  );

  return rows.map((row) => {
    const me = row.members.find((m) => m.userId === userId);
    const others = row.members.filter((m) => m.userId !== userId);
    const last = row.messages[0];
    return {
      id: row.id,
      kind: row.kind as "DM" | "GROUP",
      title: row.kind === "GROUP" ? row.title ?? "…" : others.map((m) => m.user.name).join(", ") || "·",
      emoji: row.emoji,
      updatedAt: row.updatedAt,
      lastReadAt: me?.lastReadAt ?? null,
      lastMessage: last
        ? { at: last.createdAt, body: last.deletedAt ? null : last.body, mine: last.authorId === userId }
        : null,
      unread: unreadByConv.get(row.id) ?? 0,
      otherMembers: others.map((m) => ({ id: m.userId, name: m.user.name })),
    };
  });
}

export async function markRead(userId: string, conversationId: string): Promise<void> {
  await db.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
}

/** A member opened the thread: mark it read. (`markRead` itself is for callers that already passed the guard.) */
export async function markConversationRead(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  await requireConversationMember(conversationId, ctx.userId);
  await markRead(ctx.userId, conversationId);
}

/** Leave a group (DMs are immutable). */
export async function leaveConversation(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  await assertChatAllowed(ctx.orgRole);
  const member = await requireConversationMember(conversationId, ctx.userId);
  if (member.conversation.kind !== "GROUP") throw new ForbiddenError("chat.dm_immutable");
  await db.conversationMember.delete({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
  });
}

export async function conversationDetail(ctx: OrgAccessContext, conversationId: string) {
  await assertChatAllowed(ctx.orgRole);
  const userId = ctx.userId;
  const member = await requireConversationMember(conversationId, userId);
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      kind: true,
      title: true,
      emoji: true,
      createdAt: true,
      members: {
        where: { user: { memberships: { some: { organizationId: ctx.orgId, status: "ACTIVE" } } } },
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, name: true, jobTitle: true } },
        },
      },
    },
  });
  if (!conv) throw new NotFoundError("chat.not_member");
  const messages = await db.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      pinned: true,
      replyToId: true,
      replyTo: {
        select: {
          id: true,
          body: true,
          deletedAt: true,
          author: { select: { name: true } },
        },
      },
      author: { select: { id: true, name: true } },
      reactions: { select: { emoji: true, userId: true } },
    },
  });
  messages.reverse();
  const myRole = conv.members.find((m) => m.userId === userId)?.role ?? "member";
  return {
    id: conv.id,
    kind: conv.kind as "DM" | "GROUP",
    title: conv.kind === "GROUP" ? conv.title ?? "…" : conv.members.filter((m) => m.userId !== userId).map((m) => m.user.name).join(", ") || "·",
    emoji: conv.emoji,
    members: conv.members.map((m) => ({ id: m.userId, name: m.user.name, jobTitle: m.user.jobTitle, role: m.role })),
    myRole,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.deletedAt ? null : m.body,
      deleted: Boolean(m.deletedAt),
      edited: Boolean(m.editedAt),
      pinned: m.pinned,
      mine: m.authorId === userId,
      authorId: m.authorId,
      authorName: m.author.name,
      createdAt: m.createdAt,
      replyToId: m.replyToId,
      replyPreview: m.replyTo
        ? { id: m.replyTo.id, body: m.replyTo.deletedAt ? null : m.replyTo.body, authorName: m.replyTo.author.name }
        : null,
      reactions: Object.entries(
        m.reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
          acc[r.emoji] ??= { count: 0, mine: false };
          acc[r.emoji]!.count += 1;
          if (r.userId === userId) acc[r.emoji]!.mine = true;
          return acc;
        }, {}),
      ).map(([emoji, v]) => ({ emoji, ...v })),
    })),
  };
}
