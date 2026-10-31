import type { ConversationDto } from "@/server/chat/dto";
import { lastSeenText } from "@/lib/last-seen";

/**
 * The line under the name in the head of a PRIVATE chat: the other person's «آخر ظهور» («متصل الآن», «آخر ظهور قبل 5
 * دقايق»). null — the caller keeps the line it always had — for a topic or a group, and for an answer that carries no
 * `peerLastSeenAt` at all (the company's «آخر ظهور» switch is off, an older server, a guest).
 */
export function dmSubtitle(
  detail: Pick<ConversationDto, "kind" | "peerLastSeenAt" | "timeZone" | "members" | "me"> | null | undefined,
  now?: Date,
): string | null {
  if (!detail || detail.kind !== "DM" || detail.peerLastSeenAt === undefined) return null;
  const peer = detail.members?.find((m) => m.id !== detail.me.id);
  return lastSeenText({ online: peer?.online === true, lastSeenAt: detail.peerLastSeenAt, timeZone: detail.timeZone, ...(now ? { now } : {}) });
}
