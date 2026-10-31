/**
 * The composer's draft: what a person typed in a conversation and did not send survives a navigation, a reload and a
 * closed tab (localStorage, one small entry per person per conversation; cleared on send). Every access is inside
 * try/catch: storage may be missing, full or blocked, and the composer works the same without it.
 *
 * Only the words and the ids of the people mentioned are kept: never a file, never a name.
 */
import { browserStorage, type DraftStorage } from "@/lib/cards/draft";

export const COMPOSER_DRAFT_PREFIX = "zaki.chat-draft.v1.";

export interface ComposerDraft {
  body: string;
  mentions: string[];
}

export const composerDraftKey = (userId: string, conversationId: string): string => `${COMPOSER_DRAFT_PREFIX}${userId}.${conversationId}`;

/** Keep the draft; an empty one removes the entry. */
export function saveComposerDraft(userId: string, conversationId: string, draft: ComposerDraft, storage: DraftStorage | null = browserStorage()): void {
  if (!storage || !userId) return;
  try {
    const key = composerDraftKey(userId, conversationId);
    if (!draft.body.trim()) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ body: draft.body.slice(0, 4000), mentions: draft.mentions.slice(0, 50) }));
  } catch {
    /* the draft lives until the page closes */
  }
}

export function loadComposerDraft(userId: string, conversationId: string, storage: DraftStorage | null = browserStorage()): ComposerDraft | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(composerDraftKey(userId, conversationId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as { body?: unknown; mentions?: unknown };
    if (typeof p.body !== "string" || !p.body.trim()) return null;
    const mentions = Array.isArray(p.mentions) ? p.mentions.filter((m): m is string => typeof m === "string") : [];
    return { body: p.body, mentions };
  } catch {
    return null;
  }
}

export function clearComposerDraft(userId: string, conversationId: string, storage: DraftStorage | null = browserStorage()): void {
  if (!storage || !userId) return;
  try {
    storage.removeItem(composerDraftKey(userId, conversationId));
  } catch {
    /* nothing to do */
  }
}
