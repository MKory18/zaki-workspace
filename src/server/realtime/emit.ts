import { Prisma, PrismaClient } from "@prisma/client";

export type RealtimeKind =
  | "message.created"
  | "message.edited"
  | "message.deleted"
  | "message.reacted"
  | "message.pinned"
  | "conversation.read"
  | "conversation.delivered"
  | "conversation.changed"
  | "membership.changed";

export type RealtimeIds = {
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  userId?: string;
};

export type RealtimeClient = Prisma.TransactionClient | PrismaClient;

/**
 * Writes one `RealtimeEvent` row: the ids only, never message content. The realtime
 * layer notifies readers through the Postgres trigger on this table (migration
 * `20261024092000_chat_realtime_trigger`).
 */
export async function emitRealtime(
  client: RealtimeClient,
  orgId: string,
  kind: RealtimeKind,
  ids: RealtimeIds,
): Promise<void> {
  await client.realtimeEvent.create({
    data: { orgId, kind, ids: ids as Prisma.InputJsonValue },
  });
}
