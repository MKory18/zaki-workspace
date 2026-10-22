import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { loadOrgFacts, isSpaceAdmin } from "@/server/policy/conversation";
import { listDms } from "@/server/chat/dm";
import type { DmSummaryDto, HomeDto, SpaceSummaryDto, TopicSummaryDto } from "@/server/chat/dto";
import { previewOf } from "@/server/chat/redact";

/**
 * The chat home: the spaces the viewer is in (with their topics), the viewer's DMs, and whether
 * the archive/oversight door is theirs. One query round per level, then one unread count per topic
 * and per DM — all computed from `lastReadAt`, never from a stored counter.
 */

export async function chatHome(ctx: OrgAccessContext): Promise<HomeDto> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const isOwner = org?.role === "OWNER";

  // my spaces: the rows I am in, plus (for the OWNER) every space — he reads silently
  const mySpaceRows = await db.workspaceMember.findMany({
    where: { userId: ctx.userId, workspace: { organizationId: ctx.orgId } },
    select: { workspaceId: true, role: true, mutedUntil: true },
  });
  const mySpaceIds = new Set(mySpaceRows.map((r) => r.workspaceId));

  const spacesRows = await db.workspace.findMany({
    where: isOwner ? { organizationId: ctx.orgId } : { organizationId: ctx.orgId, id: { in: [...mySpaceIds] } },
    select: {
      id: true,
      name: true,
      emoji: true,
      kind: true,
      conversations: {
        where: { kind: "TOPIC" },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          emoji: true,
          topicType: true,
          restricted: true,
          postingPolicy: true,
          closedAt: true,
          systemKey: true,
          members: { where: { userId: ctx.userId }, select: { lastReadAt: true } },
        },
      },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  const spaces: SpaceSummaryDto[] = [];
  for (const s of spacesRows) {
    const spaceRole = mySpaceRows.find((r) => r.workspaceId === s.id)?.role ?? null;
    const spaceMuted = mySpaceRows.find((r) => r.workspaceId === s.id)?.mutedUntil ?? null;
    const topics: TopicSummaryDto[] = [];
    let spaceUnread = 0;

    for (const t of s.conversations) {
      // a restricted topic is read by its own rows (and by the OWNER); a guest sees what everyone sees
      const passes =
        isOwner || (!t.restricted && spaceRole !== null) || (t.restricted && t.members.length > 0);
      if (!passes) continue;

      const lastRead = t.members[0]?.lastReadAt ?? null;
      const [last, unread, mentions] = await Promise.all([
        db.chatMessage.findFirst({
          where: { conversationId: t.id },
          orderBy: { createdAt: "desc" },
          select: { body: true, deletedAt: true, createdAt: true, authorId: true },
        }),
        lastRead
          ? db.chatMessage.count({ where: { conversationId: t.id, createdAt: { gt: lastRead }, authorId: { not: ctx.userId }, deletedAt: null } })
          : db.chatMessage.count({ where: { conversationId: t.id, authorId: { not: ctx.userId }, deletedAt: null } }),
        lastRead
          ? db.chatMessage.count({
              where: { conversationId: t.id, createdAt: { gt: lastRead }, authorId: { not: ctx.userId }, deletedAt: null, mentions: { has: ctx.userId } },
            })
          : 0,
      ]);

      const canPost =
        !t.closedAt &&
        (isOwner
          ? t.members.length > 0
          : isSpaceAdmin(spaceRole)
            ? true
            : !(spaceMuted && spaceMuted > new Date()) && t.postingPolicy !== "ADMINS" && !(org?.role === "GUEST" && t.topicType === "ANNOUNCEMENTS"));

      topics.push({
        id: t.id,
        title: t.title ?? "",
        emoji: t.emoji,
        topicType: t.topicType as TopicSummaryDto["topicType"],
        unread,
        mentions,
        closed: !!t.closedAt,
        restricted: t.restricted,
        canPost,
        lastMessage: last
          ? { at: last.createdAt.toISOString(), preview: previewOf(last.body, last.deletedAt), mine: last.authorId === ctx.userId }
          : null,
      });
      spaceUnread += unread;
    }
    if (!topics.length) continue; // a space where I read nothing is not on my list

    spaces.push({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      kind: s.kind,
      hasExternal: false,
      unread: spaceUnread,
      topics,
    });
  }

  // DMs: never for a guest, never in the owner's oversight (a DM is not his to read)
  const dms: DmSummaryDto[] = org?.role === "GUEST" ? [] : await listDms(ctx);

  return { spaces, dms, canOversee: isOwner };
}
