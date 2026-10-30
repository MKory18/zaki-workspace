import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { loadInternal } from "@/server/services/card-guards";
import { CARD_AUDIT_PREFIX } from "@/server/services/card-audit";
import type { LinkedTask, LinkedTopic, LinksView } from "@/lib/cards/page";

/**
 * What the card was turned into: the tasks made from it («حوّلها لمهمة») and the topic it was sent to («أرسل»). Both are
 * remembered as lines of the audit log, and each is shown only to a viewer who may open it: a task outside the viewer's
 * scope and a topic they may not read are simply not in the list.
 */

const LINK_LIMIT = 100;

export async function listLinks(actor: Actor, cardId: string): Promise<LinksView> {
  const { row } = await loadInternal(actor, cardId);
  const rows = await db.auditLog.findMany({
    where: { orgId: actor.orgId, target: row.id, action: { in: [`${CARD_AUDIT_PREFIX}task`, `${CARD_AUDIT_PREFIX}sent`] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINK_LIMIT,
    select: { action: true, meta: true },
  });
  const taskIds: string[] = [];
  const sent: Array<{ conversationId: string; messageId: string | null }> = [];
  for (const r of rows) {
    const m = typeof r.meta === "object" && r.meta !== null ? (r.meta as Record<string, unknown>) : {};
    if (r.action.endsWith("task") && typeof m["taskId"] === "string") taskIds.push(m["taskId"]);
    if (r.action.endsWith("sent") && typeof m["conversationId"] === "string") {
      sent.push({ conversationId: m["conversationId"], messageId: typeof m["messageId"] === "string" ? m["messageId"] : null });
    }
  }

  let tasks: LinkedTask[] = [];
  if (taskIds.length) {
    const scope = await loadWorkScope(actor.userId);
    const found = await db.task.findMany({
      where: { id: { in: taskIds }, orgId: actor.orgId, AND: [taskVisibleWhere(scope)] },
      select: { id: true, title: true, number: true, organization: { select: { keyPrefix: true } } },
    });
    const byId = new Map(found.map((t) => [t.id, t]));
    tasks = taskIds.flatMap((id) => {
      const t = byId.get(id);
      return t ? [{ id: t.id, title: t.title, key: `${t.organization.keyPrefix}-${t.number}` }] : [];
    });
  }

  const topics: LinkedTopic[] = [];
  const seen = new Set<string>();
  for (const s of sent) {
    const key = `${s.conversationId}:${s.messageId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await canReadConversation(actor.userId, s.conversationId))) continue;
    const topic = await db.conversation.findFirst({ where: { id: s.conversationId, orgId: actor.orgId }, select: { title: true, emoji: true } });
    if (!topic) continue;
    // a message that is gone is not linked to (the topic still is)
    const message = s.messageId ? await db.chatMessage.findFirst({ where: { id: s.messageId, conversationId: s.conversationId, deletedAt: null }, select: { id: true } }) : null;
    topics.push({ conversationId: s.conversationId, messageId: message?.id ?? null, title: topic.title ?? "", emoji: topic.emoji });
  }
  return { tasks, topics };
}
