/**
 * What the guide remembers on THIS device: which tours were seen, which hints were dismissed, and
 * the state of the first-steps card (collapsed, dismissed, the steps the device confirmed).
 *
 * `localStorage` is a convenience, never a source of truth: it can be missing (the server), blocked
 * (private window, cleared site data, a browser that throws on access) or edited by hand. So every
 * read and write is wrapped, a bad value reads as "nothing remembered", and a failed write only
 * means the card forgets next visit. Pure (the store is passed in), so the rules are unit-tested.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const NS = "zaki.guide.";

export const storageKeys = {
  /** Per person: two people on one phone each have their own card. */
  firstSteps: (userId: string) => `${NS}first-steps.${userId}`,
  tourSeen: (tour: string) => `${NS}tour.${tour}`,
  hint: (id: string) => `${NS}hint.${id}`,
} as const;

/** The browser's localStorage, or null when there is none (server render) or it cannot be reached. */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(store: KeyValueStore | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    /* blocked or full: the card just forgets next time */
  }
}

// ---- the first-steps card ----

export interface FirstStepsLocal {
  /** The person hid the card on this device. */
  dismissed: boolean;
  /** The card is folded down to its header. */
  collapsed: boolean;
  /** Steps this device confirmed (the install step, the guide step). */
  done: string[];
}

const MAX_DONE = 50;

/** Whatever is stored, a safe value comes out: only well-typed fields survive, the list is capped. */
export function parseFirstStepsLocal(raw: string | null | undefined): FirstStepsLocal {
  const fresh: FirstStepsLocal = { dismissed: false, collapsed: false, done: [] };
  if (!raw) return fresh;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fresh;
  const o = value as Record<string, unknown>;
  const done: string[] = [];
  if (Array.isArray(o["done"])) {
    for (const item of o["done"]) {
      if (typeof item === "string" && item && !done.includes(item) && done.length < MAX_DONE) done.push(item);
    }
  }
  return { dismissed: o["dismissed"] === true, collapsed: o["collapsed"] === true, done };
}

export function loadFirstStepsLocal(store: KeyValueStore | null, userId: string): FirstStepsLocal {
  return parseFirstStepsLocal(read(store, storageKeys.firstSteps(userId)));
}

export function saveFirstStepsLocal(store: KeyValueStore | null, userId: string, value: FirstStepsLocal): void {
  write(store, storageKeys.firstSteps(userId), JSON.stringify({ v: 1, ...value }));
}

/** Changes the saved state and hands back the new one (even if it could not be saved). */
function update(store: KeyValueStore | null, userId: string, change: (v: FirstStepsLocal) => FirstStepsLocal): FirstStepsLocal {
  const next = change(loadFirstStepsLocal(store, userId));
  saveFirstStepsLocal(store, userId, next);
  return next;
}

export function markFirstStepDone(store: KeyValueStore | null, userId: string, stepId: string): FirstStepsLocal {
  return update(store, userId, (v) => (v.done.includes(stepId) ? v : { ...v, done: [...v.done, stepId].slice(-MAX_DONE) }));
}

export function setFirstStepsCollapsed(store: KeyValueStore | null, userId: string, collapsed: boolean): FirstStepsLocal {
  return update(store, userId, (v) => ({ ...v, collapsed }));
}

export function dismissFirstSteps(store: KeyValueStore | null, userId: string): FirstStepsLocal {
  return update(store, userId, (v) => ({ ...v, dismissed: true }));
}

/** Brings a dismissed card back (the guide offers this), open. */
export function restoreFirstSteps(store: KeyValueStore | null, userId: string): FirstStepsLocal {
  return update(store, userId, (v) => ({ ...v, dismissed: false, collapsed: false }));
}

// ---- tours and hints ----

export function isTourSeen(store: KeyValueStore | null, tour: string): boolean {
  return read(store, storageKeys.tourSeen(tour)) === "1";
}

export function markTourSeen(store: KeyValueStore | null, tour: string): void {
  write(store, storageKeys.tourSeen(tour), "1");
}

export function isHintDismissed(store: KeyValueStore | null, id: string): boolean {
  return read(store, storageKeys.hint(id)) === "1";
}

export function dismissHint(store: KeyValueStore | null, id: string): void {
  write(store, storageKeys.hint(id), "1");
}
