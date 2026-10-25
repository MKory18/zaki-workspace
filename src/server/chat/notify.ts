import { db } from "@/server/db";
import { pushNotification } from "@/server/notify";
import { isOnline } from "@/server/realtime/presence";
import { canReadConversation, type ConversationFacts } from "@/server/policy/conversation";
import { hqSpaceId } from "@/server/chat/hq";

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
  // the space the message is in (a DM from before spaces had them is «الشركة»'s): the bell of that space shows it
  const conv = await db.conversation.findUnique({ where: { id: opts.conversationId }, select: { spaceId: true, orgId: true } });
  const workspaceId = conv?.spaceId ?? (conv ? await hqSpaceId(conv.orgId) : null);
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
      workspaceId,
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

/**
 * Who a new message may notify (spec, 12-PHASE3-TASKS §32): in a DM its other person; in a topic
 * (or a legacy group) only the people @mentioned and the author of the message replied to — the rest
 * of a topic is Phase 5. The author is never notified of their own message.
 * These are CANDIDATES: `readersAmong` keeps only the people who may read the conversation now.
 */
export function notifyCandidates(
  facts: ConversationFacts,
  authorId: string,
  mentionIds: string[],
  replyAuthorId: string | null,
): string[] {
  const ids = facts.kind === "DM" ? facts.memberIds : [...mentionIds, ...(replyAuthorId ? [replyAuthorId] : [])];
  return [...new Set(ids)].filter((id) => id !== authorId);
}

/**
 * The people among `ids` who may read the conversation right now, by the policy (their rank in the
 * conversation's own company, their space row, the topic's restriction). A ConversationMember row
 * alone proves nothing: one left behind by a removal must not keep receiving the messages.
 */
export async function readersAmong(conversationId: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) if (await canReadConversation(id, conversationId)) out.push(id);
  return out;
}
