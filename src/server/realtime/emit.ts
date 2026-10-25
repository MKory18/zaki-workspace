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
  | "membership.changed"
  // a call of a conversation started or ended (its readers refresh the «in a call» bar)
  | "call.changed"
  // somebody is ringing this ONE person (`targetUserId`) into a call
  | "call.ring";

export type RealtimeIds = {
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  /** WHO the event is about (the reader, the person who joined): it goes to everybody allowed to see it. */
  userId?: string;
  /** The call the event is about (call.changed, call.ring). */
  callId?: string;
  /** The ONE person the event is for, when it is for one person only (a mute in a space). */
  targetUserId?: string;
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
