import { db } from "@/server/db";

/**
 * REALTIME owns the implementation; the signature is the contract from
 * 11-PHASE3-SHARED.md — do not change it.
 *
 * Delivery marks are written for DMs only (the ticks: sent / delivered / read).
 * Called when a person's SSE client connects and when a `message.created` event
 * of a DM reaches one of their connected clients. Never called for the OWNER in
 * oversight (oversight reads silently and marks nothing).
 */
export async function markDeliveredForUser(userId: string): Promise<void> {
  const now = new Date();
  await db.conversationMember.updateMany({
    where: {
      userId,
      conversation: { kind: "DM" },
      OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: now } }],
    },
    data: { lastDeliveredAt: now },
  });
}
