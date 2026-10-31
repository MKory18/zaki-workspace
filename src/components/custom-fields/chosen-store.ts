"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CHOSEN_KEY, parseChosen, toggleChosen } from "@/lib/custom-fields-ui";

/**
 * The fields a person chose to see on every row of the list and the board (at most 3), kept in THIS browser only. One shared
 * store so every row and the picker agree at once, and another tab's change arrives through the `storage` event. The browser's
 * storage can throw (blocked, private window, full): every read and write is guarded and the screens render without it.
 */
const EMPTY: readonly string[] = Object.freeze([]);
let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function readStorage(): readonly string[] {
  try {
    return parseChosen(window.localStorage.getItem(CHOSEN_KEY));
  } catch {
    return EMPTY;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== CHOSEN_KEY) return;
    cache = readStorage();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = (): readonly string[] => (cache ??= readStorage());
const serverSnapshot = (): readonly string[] => EMPTY;

export function useChosenFields(): { chosen: readonly string[]; toggle: (id: string) => void } {
  const chosen = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const toggle = useCallback((id: string) => {
    const next = toggleChosen(snapshot(), id);
    cache = next;
    try {
      window.localStorage.setItem(CHOSEN_KEY, JSON.stringify(next));
    } catch {
      /* the choice still holds for this page view */
    }
    for (const l of listeners) l();
  }, []);
  return { chosen, toggle };
}
