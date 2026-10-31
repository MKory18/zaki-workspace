/**
 * The browser side of the outbox: ONE queue per signed-in person for the life of the page (it keeps flushing while
 * the person moves between conversations), started on first use, woken by the network coming back, the page coming
 * back and the window getting focus. Sign-out clears every queue of this browser.
 */
import { Outbox, OUTBOX_KEY_PREFIX } from "@/lib/chat/outbox/queue";
import { browserOutboxStorage } from "@/lib/chat/outbox/storage";
import { sendOutboxItem } from "@/lib/chat/outbox/send";

interface Target {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * The three moments a queue should try at once instead of waiting for its timer: `online` (the network is back),
 * `visibilitychange` to visible (the person came back to the page) and `focus` (the window got focus). Returns the detach.
 */
export function attachTriggers(outbox: Pick<Outbox, "flush">, win: Target, doc: Target & { visibilityState?: string }): () => void {
  const wake = () => void outbox.flush({ force: true });
  const visible = () => {
    if (doc.visibilityState === undefined || doc.visibilityState === "visible") wake();
  };
  win.addEventListener("online", wake);
  win.addEventListener("focus", wake);
  doc.addEventListener("visibilitychange", visible);
  return () => {
    win.removeEventListener("online", wake);
    win.removeEventListener("focus", wake);
    doc.removeEventListener("visibilitychange", visible);
  };
}

interface Entry {
  outbox: Outbox;
  detach: () => void;
}
const entries = new Map<string, Entry>();

/** This person's queue, restored from the browser's storage and listening for the moments to flush. Browser only. */
export function outboxFor(userId: string): Outbox {
  const found = entries.get(userId);
  if (found) return found.outbox;
  const outbox = new Outbox({ userId, storage: browserOutboxStorage(), send: sendOutboxItem });
  const detach = attachTriggers(outbox, window, document);
  entries.set(userId, { outbox, detach });
  void outbox.load();
  return outbox;
}

/** Sign-out: stop every queue of this page and wipe what the browser holds for any person (the next one to sign in starts empty). */
export async function clearAllOutboxes(): Promise<void> {
  for (const { outbox, detach } of entries.values()) {
    detach();
    await outbox.clear();
    outbox.dispose();
  }
  entries.clear();
  try {
    await browserOutboxStorage().removeAll(OUTBOX_KEY_PREFIX);
  } catch {
    /* nothing more can be done: the keys carry the user id, so another person never reads them */
  }
}
