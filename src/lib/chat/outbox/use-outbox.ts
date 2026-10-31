"use client";
import React from "react";
import type { Outbox, OutboxItem } from "@/lib/chat/outbox/queue";
import { outboxFor } from "@/lib/chat/outbox/registry";

const NONE: readonly OutboxItem[] = [];
const noopSubscribe = () => () => undefined;

/**
 * The signed-in person's outbox, for a screen. `enabled` false (the «الميزات» switch is off, or the person is not known
 * yet) is the older behaviour: no queue, nothing stored, an empty list. The queue itself lives in the page (registry.ts),
 * so leaving a conversation does not stop it.
 */
export function useOutbox(userId: string | undefined, enabled: boolean): { outbox: Outbox | null; items: readonly OutboxItem[] } {
  const active = enabled && Boolean(userId);
  // the browser's queue exists only on the client; the server render (and the first client render) is empty
  const [outbox, setOutbox] = React.useState<Outbox | null>(null);
  React.useEffect(() => {
    setOutbox(active && userId ? outboxFor(userId) : null);
  }, [active, userId]);
  const subscribe = React.useCallback((listener: () => void) => (outbox ? outbox.subscribe(listener) : noopSubscribe()), [outbox]);
  const items = React.useSyncExternalStore(subscribe, () => (outbox ? outbox.getSnapshot() : NONE), () => NONE);
  return { outbox, items };
}

/** Is the browser online? True on the server and until the browser says otherwise (the status line's «ما في نت»). */
export function useOnline(): boolean {
  const subscribe = React.useCallback((listener: () => void) => {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  }, []);
  return React.useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true);
}
