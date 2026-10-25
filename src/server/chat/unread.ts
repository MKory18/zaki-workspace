import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";

/**
 * The number on «الدردشة» in the menus: messages waiting for me, in ONE query.
 *
 * - Only conversations I have a row in (I wrote, read or joined there; my DMs): a topic I never opened
 *   is the chat home's business, and counting a company's whole history would make the badge useless.
 * - Never my own messages, deleted ones, or system lines («انضم»، «ثبّت»).
 * - A topic counts only while I am still in its space (rows outlive leaving it); the OWNER's rows are
 *   the topics he joined and his own DMs, so his silent oversight never adds anything.
 * - A guest: topics only.
 * - A topic of a «مقطع» counts for its people and the space's managers only (the same rule as `canRead`).
 * - Inside a space (`spaceId`, the space the person is in): that space's topics, plus the DMs (they belong to no
 *   space yet). Another space's topics are on the space switcher instead (`unreadBySpace`).
 */
export async function unreadTotal(ctx: OrgAccessContext, spaceId: string | null = null): Promise<number> {
  const isOwner = ctx.orgRole === "OWNER";
  const isGuest = ctx.orgRole === "GUEST";
  const rows = await db.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*)::int AS total
    FROM "ChatMessage" m
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${ctx.userId}
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."orgId" = ${ctx.orgId}
      AND m."createdAt" > cm."lastReadAt"
      AND m."authorId" <> ${ctx.userId}
      AND m."deletedAt" IS NULL
      AND m.kind <> 'SYSTEM'
      AND (${isGuest} = false OR c.kind = 'TOPIC')
      AND (
        c.kind <> 'TOPIC'
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId})
      )
      AND (c.kind <> 'TOPIC' OR ${spaceId}::text IS NULL OR c."spaceId" = ${spaceId})
      AND (
        c."teamId" IS NULL
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId" = c."teamId" AND tm."userId" = ${ctx.userId})
        OR EXISTS (
          SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId}
            AND (w.role = 'ADMIN' OR ${ctx.orgRole === "ADMIN"} = true)
        )
      )`;
  return rows[0]?.total ?? 0;
}

/**
 * The same count per space, topics only (the number beside every space on the switcher, like the accounts of
 * a messaging app): `{ spaceId: count }`, spaces with nothing waiting left out.
 */
export async function unreadBySpace(ctx: OrgAccessContext): Promise<Record<string, number>> {
  const isOwner = ctx.orgRole === "OWNER";
  const rows = await db.$queryRaw<Array<{ spaceId: string; total: number }>>`
    SELECT c."spaceId" AS "spaceId", COUNT(*)::int AS total
    FROM "ChatMessage" m
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${ctx.userId}
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."orgId" = ${ctx.orgId}
      AND c.kind = 'TOPIC'
      AND c."spaceId" IS NOT NULL
      AND m."createdAt" > cm."lastReadAt"
      AND m."authorId" <> ${ctx.userId}
      AND m."deletedAt" IS NULL
      AND m.kind <> 'SYSTEM'
      AND (
        ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId})
      )
      AND (
        c."teamId" IS NULL
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId" = c."teamId" AND tm."userId" = ${ctx.userId})
        OR EXISTS (
          SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId}
            AND (w.role = 'ADMIN' OR ${ctx.orgRole === "ADMIN"} = true)
        )
      )
    GROUP BY c."spaceId"`;
  return Object.fromEntries(rows.map((r) => [r.spaceId, r.total]));
}
