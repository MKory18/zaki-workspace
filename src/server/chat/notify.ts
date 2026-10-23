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
  messageId: string; // in the link, so an edit or a delete can reach the preview again
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
      linkUrl: messageLink(opts.conversationId, opts.messageId),
    });
  }
}

/** The link a chat notification carries: the conversation, and the message it was about. */
export function messageLink(conversationId: string, messageId: string): string {
  return `/chat/${conversationId}?m=${messageId}`;
}

/** The text shown in place of a deleted message's preview (the bell never keeps it). */
export const DELETED_PREVIEW = "حُذفت الرسالة";

/**
 * An edited or deleted message: every notification that still carries its old preview gets the new
 * one (the edited text, or «حُذفت الرسالة»). Runs inside the edit/delete transaction.
 */
export async function rewriteMessagePreviews(
  tx: Pick<typeof db, "notification">,
  conversationId: string,
  messageId: string,
  preview: string,
): Promise<void> {
  await tx.notification.updateMany({
    where: { type: "chat_message", linkUrl: messageLink(conversationId, messageId) },
    data: { body: preview },
  });
}

/** The audience of a facts object that should be notified (members minus the author). */
export function audienceOf(facts: ConversationFacts, authorId: string): string[] {
  return facts.memberIds.filter((id) => id !== authorId);
}
