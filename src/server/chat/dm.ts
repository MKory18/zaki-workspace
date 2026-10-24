import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { writeSystemMessage } from "@/server/chat/system";
import { systemSentenceOfBody } from "@/lib/chat/system-sentence";

/**
 * DMs. A DM is its two people; nobody else WRITES in it. The OWNER reads it too, silently (decision
 * D-2, 2026-10-24: he reads everything; his reading leaves no mark). A person can only open a DM in
 * their own company; guests have no DMs at all.
 *
 * `dmKey` is `min|max` of the two user ids in plain code-unit order — the same key the data move
 * wrote, so the second person opening the same DM finds the row instead of creating a twin.
 */

export const dmKeyOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Opens (or finds) the DM between the viewer and `otherId`. Returns its id. */
export async function openDm(ctx: OrgAccessContext, otherId: string): Promise<{ id: string; created: boolean }> {
  if (otherId === ctx.userId) throw new ForbiddenError("chat.e.not_found");
  const [me, other] = await Promise.all([
    loadOrgFacts(ctx.userId, ctx.orgId),
    loadOrgFacts(otherId, ctx.orgId),
  ]);
  if (!me || !other || me.status !== "ACTIVE" || other.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (me.role === "GUEST" || other.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");

  const dmKey = dmKeyOf(ctx.userId, otherId);
  const existing = await db.conversation.findFirst({
    where: { orgId: ctx.orgId, dmKey },
    select: { id: true },
  });
  if (existing) {
    // a DM is never left (see leaveConversation), but a row lost before that rule (older data) is put
    // back for both people, so neither is locked out of their own history and the pair can talk again
    await db.conversationMember.createMany({
      data: [{ conversationId: existing.id, userId: ctx.userId }, { conversationId: existing.id, userId: otherId }],
      skipDuplicates: true,
    });
    return { id: existing.id, created: false };
  }

  // the OLDEST DM of the pair keeps the key when legacy duplicates exist: only claim it if free
  const created = await db.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        kind: "DM",
        dmKey,
        title: null,
        members: { create: [{ userId: ctx.userId }, { userId: otherId }] },
      },
      select: { id: true },
    });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: c.id, userId: otherId });
    return c;
  });
  return { id: created.id, created: true };
}

/** The DM list of a person: peers, last message, unread count. */
export async function listDms(ctx: OrgAccessContext) {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (org?.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const rows = await db.conversation.findMany({
    where: {
      orgId: ctx.orgId,
      kind: { in: ["DM", "GROUP"] },
      members: { some: { userId: ctx.userId } },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, kind: true, deletedAt: true, authorId: true, createdAt: true, author: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return Promise.all(
    rows.map(async (c) => {
      const mine = c.members.find((m) => m.userId === ctx.userId);
      const other = c.members.find((m) => m.userId !== ctx.userId);
      const last = c.messages[0] ?? null;
      const unread = last && mine
        ? await db.chatMessage.count({
            where: { conversationId: c.id, createdAt: { gt: mine.lastReadAt }, authorId: { not: ctx.userId }, deletedAt: null, kind: { not: "SYSTEM" } },
          })
        : 0;
      return {
        id: c.id,
        peer: { id: other?.userId ?? "", name: other?.user.name ?? "" },
        unread,
        lastMessage: last
          ? {
              at: last.createdAt.toISOString(),
              preview: last.kind === "SYSTEM" ? systemSentenceOfBody(last.body, last.author.name) : last.deletedAt ? null : last.body.slice(0, 140),
              mine: last.authorId === ctx.userId,
            }
          : null,
      };
    }),
  );
}

/** A GROUP (a private group chat, not a topic): creator plus invited ACTIVE people. */
export async function createGroup(ctx: OrgAccessContext, opts: { title: string; memberIds: string[]; emoji?: string | null }): Promise<{ id: string }> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!org || org.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");

  const ids = [...new Set([ctx.userId, ...opts.memberIds])];
  const people = await db.organizationMember.findMany({
    where: { organizationId: ctx.orgId, userId: { in: ids }, status: "ACTIVE", role: { not: "GUEST" } },
    select: { userId: true },
  });
  if (people.length !== ids.length) throw new NotFoundError("chat.e.not_found");

  const c = await db.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        kind: "GROUP",
        title: opts.title,
        emoji: opts.emoji ?? null,
        members: { create: ids.map((userId) => ({ userId, role: userId === ctx.userId ? "admin" : "member" })) },
      },
      select: { id: true },
    });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId: conv.id, authorId: ctx.userId, k: "topic_created", p: { title: opts.title } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: conv.id });
    return conv;
  });
  return { id: c.id };
}

/** Group settings: title, emoji, members (a group admin only). */
export async function manageGroup(
  ctx: OrgAccessContext,
  conversationId: string,
  input: { title?: string; emoji?: string | null; addMemberIds?: string[]; removeMemberIds?: string[] },
): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId, kind: "GROUP" }, select: { id: true } });
  if (!conv) throw new NotFoundError("chat.e.not_found");
  const me = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!me || me.role !== "admin") throw new ForbiddenError("chat.e.moderator_only");

  await db.$transaction(async (tx) => {
    if (input.title !== undefined || input.emoji !== undefined) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.emoji !== undefined ? { emoji: input.emoji } : {}) },
      });
    }
    if (input.addMemberIds?.length) {
      const people = await tx.organizationMember.findMany({
        where: { organizationId: ctx.orgId, userId: { in: input.addMemberIds }, status: "ACTIVE", role: { not: "GUEST" } },
        select: { userId: true },
      });
      await tx.conversationMember.createMany({
        data: people.map((p) => ({ conversationId, userId: p.userId })),
        skipDuplicates: true,
      });
      for (const p of people) {
        await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "member_added", p: { userId: p.userId } });
      }
    }
    if (input.removeMemberIds?.length) {
      // a person may always remove themselves; removing others is the group admin's act
      await tx.conversationMember.deleteMany({ where: { conversationId, userId: { in: input.removeMemberIds } } });
      for (const id of input.removeMemberIds) {
        await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "member_removed", p: { userId: id } });
      }
    }
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId });
  });
}

/**
 * Leaving a group: remove my row; the last person leaving deletes nothing (the group stays for the archive).
 * A DM is never left: removing one side's row locked the OTHER person out of their own history (the
 * policy needs both rows) and, the DM being found again by its pair key, blocked any new DM (review A7).
 */
export async function leaveConversation(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, select: { id: true, kind: true } });
  if (!conv) throw new NotFoundError("chat.e.not_found");
  if (conv.kind === "DM") throw new ForbiddenError("chat.e.dm_leave_denied");
  const me = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
    select: { id: true },
  });
  if (!me) throw new NotFoundError("chat.e.not_found");
  await db.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { id: me.id } });
    if (conv.kind === "GROUP") {
      await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "leave" });
    }
    await emitRealtime(tx, ctx.orgId, "membership.changed", { conversationId, userId: ctx.userId });
  });
}
