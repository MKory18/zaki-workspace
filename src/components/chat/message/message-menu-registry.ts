/**
 * The ONE source of what the message menu offers. Each decision mirrors the server's rule, so the menu
 * never shows a door the server would close (the old buttons offered «تعديل» to a moderator on
 * somebody else's message and «تثبيت» to the wrong people):
 *
 * - reply: wherever I may post (`me.canPost`);
 * - react: any message I may read, except while the OWNER reads in silent oversight (toggleReact);
 * - pin: a DM's two people; in a topic or group, its moderators (togglePin);
 * - forward: any message I may read (forwardMessage checks the target when it is picked);
 * - edit: my own message only, never a voice note (editMessage: author only; a voice note has no text);
 * - delete: my own message, or a moderator's (deleteMessage), after a confirmation;
 * - note: the moderators (addNote);
 * - copy: a message with text.
 *
 * Nothing at all on a deleted message, a system line, or for the owner in silent oversight.
 */
export type MessageMenuId = "reply" | "pin" | "forward" | "edit" | "delete" | "note" | "copy";

export interface MessageMenuContext {
  mine: boolean;
  deleted: boolean;
  kind: "TEXT" | "VOICE" | "SYSTEM";
  hasText: boolean;
  pinned: boolean;
  conversationKind: "DM" | "GROUP" | "TOPIC";
  canPost: boolean;
  canModerate: boolean;
  oversight: boolean;
}

/** `labelKey`: a key of ar.chat-conversation.json (the strings live there, not here). */
export type MessageMenuAction = { id: MessageMenuId; labelKey: (c: MessageMenuContext) => string; danger?: boolean; available: (c: MessageMenuContext) => boolean };

export const messageMenuItems: MessageMenuAction[] = [
  { id: "reply", labelKey: () => "chatc.menu.reply", available: (c) => c.canPost },
  { id: "pin", labelKey: (c) => (c.pinned ? "chatc.menu.unpin" : "chatc.menu.pin"), available: (c) => (c.conversationKind === "DM" ? true : c.canModerate) },
  { id: "forward", labelKey: () => "chatc.menu.forward", available: () => true },
  { id: "edit", labelKey: () => "chatc.menu.edit", available: (c) => c.mine && c.kind === "TEXT" && c.hasText },
  { id: "note", labelKey: () => "chatc.menu.note", available: (c) => c.canModerate },
  { id: "copy", labelKey: () => "chatc.menu.copy", available: (c) => c.hasText },
  { id: "delete", labelKey: () => "chatc.menu.delete", danger: true, available: (c) => c.mine || c.canModerate },
];

/** Is there a menu at all for this message (and a reaction bar)? */
export function menuOpen(c: MessageMenuContext): boolean {
  return !c.deleted && c.kind !== "SYSTEM" && !c.oversight;
}

/** The actions this person gets on this message, in menu order. */
export function menuFor(c: MessageMenuContext): MessageMenuAction[] {
  if (!menuOpen(c)) return [];
  return messageMenuItems.filter((item) => item.available(c));
}
