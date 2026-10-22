/**
 * The TypeScript shapes of every chat response (Phase 3). Dates are ISO strings, so a
 * DTO crosses a JSON boundary unchanged; the UI agents import these with `import type`.
 */

export type TopicType = "DISCUSSION" | "ANNOUNCEMENTS" | "TASKS" | "IDEAS" | "FOLLOWUP";
export type PostingPolicy = "ALL" | "ADMINS";
export type ConversationKind = "DM" | "GROUP" | "TOPIC";
export type MessageKind = "TEXT" | "VOICE" | "SYSTEM";

/** `{k, p}` of a system message — the client composes the Arabic sentence from it. */
export interface SystemMeta {
  k: string; // join | leave | pin | close | reopen | topic_created | member_added | member_removed | forwarded
  p?: Record<string, string | number>;
}

export interface AttachmentDto {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  peaks?: number[];
  url: string;
}

export interface ReactionDto {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface NoteDto {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  kind: MessageKind;
  /** null for a deleted message (everybody) and for a system message. */
  body: string | null;
  deleted: boolean;
  edited: boolean;
  pinned: boolean;
  mine: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  clientId?: string | null;
  replyTo?: { id: string; preview: string | null; authorName: string; deleted?: boolean } | null;
  forwardedFrom?: { name: string } | null;
  mentions: string[];
  attachments: AttachmentDto[];
  reactions: ReactionDto[];
  /** DMs only, on my own messages: sent | delivered | read. */
  status?: "sent" | "delivered" | "read";
  /** space admins and the OWNER only. */
  notes?: NoteDto[];
  /** the OWNER only, on a deleted message. */
  original?: { body: string; deletedBy: string; deletedAt: string } | null;
  /** the OWNER only, on an edited message. */
  history?: { body: string; editedAt: string }[];
  system?: SystemMeta | null;
}

export interface SpaceSummaryDto {
  id: string;
  name: string;
  emoji: string | null;
  kind: string;
  hasExternal: boolean;
  unread: number;
  topics: TopicSummaryDto[];
}

export interface TopicSummaryDto {
  id: string;
  title: string;
  emoji: string | null;
  topicType: TopicType;
  unread: number;
  mentions: number;
  closed: boolean;
  restricted: boolean;
  canPost: boolean;
  lastMessage: { at: string; preview: string | null; mine: boolean } | null;
}

export interface DmSummaryDto {
  id: string;
  peer: { id: string; name: string };
  unread: number;
  lastMessage: { at: string; preview: string | null; mine: boolean } | null;
}

export interface HomeDto {
  spaces: SpaceSummaryDto[];
  dms: DmSummaryDto[];
  canOversee: boolean;
}

export interface MemberDto {
  id: string;
  name: string;
  online: boolean;
  role?: string;
  muted?: boolean;
}

export interface ReaderDto {
  userId: string;
  name: string;
  messageId: string;
}

export interface ConversationDto {
  id: string;
  kind: ConversationKind;
  title: string;
  emoji: string | null;
  topicType?: TopicType;
  postingPolicy?: PostingPolicy;
  restricted?: boolean;
  closed: boolean;
  space?: { id: string; name: string; hasExternal: boolean } | null;
  me: { canPost: boolean; canModerate: boolean; muted: boolean; oversight: boolean };
  members?: MemberDto[];
  messages: MessageDto[];
  readers: ReaderDto[];
  /** pagination: the oldest message id on the page; pass it as `before` for the next page. */
  oldestId?: string | null;
}

export interface OversightConversationDto {
  id: string;
  kind: ConversationKind;
  title: string;
  emoji: string | null;
  spaceId: string | null;
  spaceName: string | null;
  membersCount: number;
  lastMessageAt: string | null;
}

export type ArchiveType = "deleted" | "edited" | "moderation" | "closed";

export interface ArchiveItemDto {
  type: ArchiveType;
  /** deleted / edited: the message. moderation: the audit entry. closed: the topic. */
  id: string;
  conversationId: string | null;
  spaceId: string | null;
  spaceName: string | null;
  /** deleted / edited */
  messageId?: string;
  body?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  at?: string | null;
  /** deleted: who deleted it and when */
  deletedById?: string | null;
  deletedByName?: string | null;
  deletedAt?: string | null;
  /** edited: the version BEFORE the edit */
  previousBody?: string | null;
  /** moderation */
  action?: string | null;
  actorName?: string | null;
  targetName?: string | null;
  meta?: Record<string, unknown> | null;
  /** closed */
  title?: string | null;
}

export interface ArchivePageDto {
  items: ArchiveItemDto[];
  /** pass as `cursor` for the next page; null when there is nothing older. */
  nextCursor: string | null;
}

export interface DirectoryPersonDto {
  userId: string;
  role: string;
  name: string;
  jobTitle: string | null;
}
