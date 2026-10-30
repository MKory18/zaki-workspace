/**
 * A local draft of what a person is typing into a card, kept in the browser (localStorage) so a closed tab or a lost
 * network never loses the typing. Every access is wrapped: storage can be missing, full or blocked (a private window),
 * and the screen must work the same without it. Pure apart from the storage object it is handed.
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredDraft<T> {
  /** The version of the card the person started from. */
  baseVersion: number;
  savedAt: string;
  payload: T;
}

export const draftKey = (userId: string, cardId: string): string => `zaki.card-draft.${userId}.${cardId}`;

/** The browser's storage, or null when it is not there or refuses. */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(storage: DraftStorage | null, key: string, draft: StoredDraft<T>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft<T>(storage: DraftStorage | null, key: string): StoredDraft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const d = parsed as Partial<StoredDraft<T>>;
    if (typeof d.baseVersion !== "number" || typeof d.savedAt !== "string" || typeof d.payload !== "object" || d.payload === null) return null;
    return { baseVersion: d.baseVersion, savedAt: d.savedAt, payload: d.payload };
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to do: the draft stays, and is offered again */
  }
}
