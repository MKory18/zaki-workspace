import { db } from "@/server/db";
import { pushNotification } from "@/server/notify";
import { isOnline } from "@/server/realtime/presence";
import type { ConversationFacts } from "@/server/policy/conversation";

/**
 * Chat notifications: a message reaches the people of its audience that are NOT looking at the
 * app right now. Online people see the message live; a notification for them would be noise.
 * A DM notifies its other person once per unread thread (no stacking of the same conversation).
 */

export async function notifyMessageToAudience(opts: {
  conversationId: string;
  authorId: string;
  audienceIds: string[]; // the audience WITHOUT the author
  kind: "DM" | "GROUP" | "TOPIC";
  title: string; // the conversation title (or the DM peer's name)
  preview: string; // the body preview (attachments -> an Arabic «أرسل مرفقًا»)
}): Promise<void> {
  const targets = new Set(opts.audienceIds);
  for (const userId of targets) {
    if (await isOnline(userId)) continue;
    if (opts.kind === "DM") {
      const unread = await db.notification.findFirst({
        where: { userId, readAt: null, type: "chat_message", linkUrl: { contains: opts.conversationId } },
        select: { id: true },
      });
      if (unread) continue;
    }
    await pushNotification({
      userId,
      type: "chat_message",
      title: opts.title,
      body: opts.preview,
      linkUrl: `/chat/${opts.conversationId}`,
    });
  }
}

/** The audience of a facts object that should be notified (members minus the author). */
export function audienceOf(facts: ConversationFacts, authorId: string): string[] {
  return facts.memberIds.filter((id) => id !== authorId);
}
