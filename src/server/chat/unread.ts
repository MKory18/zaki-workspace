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
 */
export async function unreadTotal(ctx: OrgAccessContext): Promise<number> {
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
      )`;
  return rows[0]?.total ?? 0;
}
