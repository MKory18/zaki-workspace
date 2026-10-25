import { db } from "@/server/db";

/**
 * The topics every space starts with, so its chat is never an empty page (a space is like a separate site: it
 * opens on its own talk). Fixed ids per space (`cv_ws_<key>_<spaceId>`), so creating them twice, or from two
 * requests at once, makes them once.
 *
 *   «عام» — everybody talks; «التنبيهات» — the space's admins post, everybody reads.
 */
export const SPACE_STARTER_TOPICS = [
  { key: "general", title: "عام", emoji: "💬", topicType: "DISCUSSION", postingPolicy: "ALL", position: 0 },
  { key: "announcements", title: "التنبيهات", emoji: "📢", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS", position: 1 },
] as const;

export const spaceTopicIdOf = (spaceId: string, key: string): string => `cv_ws_${key}_${spaceId}`;

/** Gives a space with no topic at all its starter topics (a space that has any topic is left as it is). */
export async function ensureStarterTopics(orgId: string, spaceId: string): Promise<void> {
  const any = await db.conversation.findFirst({ where: { spaceId, kind: "TOPIC" }, select: { id: true } });
  if (any) return;
  await db.conversation.createMany({
    data: SPACE_STARTER_TOPICS.map((t) => ({
      id: spaceTopicIdOf(spaceId, t.key),
      orgId,
      spaceId,
      kind: "TOPIC" as const,
      title: t.title,
      emoji: t.emoji,
      topicType: t.topicType,
      postingPolicy: t.postingPolicy,
      systemKey: t.key,
      position: t.position,
    })),
    skipDuplicates: true,
  });
}
