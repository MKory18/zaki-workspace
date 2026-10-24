import { db } from "@/server/db";
import { emitRealtime } from "@/server/realtime/emit";

/**
 * REALTIME owns the implementation; the signature is the contract from
 * 11-PHASE3-SHARED.md — do not change it (`conversationId` is an optional narrowing).
 *
 * Delivery marks are written for DMs only (the ticks: sent / delivered / read).
 * Called when a person's SSE client connects and when a `message.created` event
 * of a DM reaches one of their connected clients. Never called for the OWNER in
 * oversight (oversight reads silently and marks nothing).
 *
 * Only a DM with a message from the OTHER person newer than the mark moves (the author's own
 * message never marks anything delivered), and each mark that moves emits
 * `conversation.delivered`, so the sender's ✓ turns into ✓✓ live.
 */
export async function markDeliveredForUser(userId: string, conversationId?: string): Promise<void> {
  const rows = await db.conversationMember.findMany({
    where: { userId, conversation: { kind: "DM" }, ...(conversationId ? { conversationId } : {}) },
    select: { conversationId: true, lastDeliveredAt: true, conversation: { select: { orgId: true } } },
  });
  for (const row of rows) {
    const newer = await db.chatMessage.findFirst({
      where: {
        conversationId: row.conversationId,
        authorId: { not: userId },
        kind: { not: "SYSTEM" },
        ...(row.lastDeliveredAt ? { createdAt: { gt: row.lastDeliveredAt } } : {}),
      },
      select: { id: true },
    });
    if (!newer) continue;
    await db.$transaction(async (tx) => {
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: row.conversationId, userId } },
        data: { lastDeliveredAt: new Date() },
      });
      await emitRealtime(tx, row.conversation.orgId, "conversation.delivered", { conversationId: row.conversationId, userId });
    });
  }
}
