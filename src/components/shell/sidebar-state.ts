import type { KeyValueStore } from "@/lib/guide/storage";

/**
 * Whether the computer's side menu is folded to its icon rail, remembered on THIS device. A
 * convenience, never a source of truth: the storage can be missing (the server), blocked (a private
 * window, cleared site data) or edited by hand, so every read and write is wrapped and anything odd
 * reads as "open". Pure (the store is handed in: `browserStore()` in the browser), so it is tested.
 */

export const SIDEBAR_KEY = "zaki.shell.sidebar-collapsed";

export function readSidebarCollapsed(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(store: KeyValueStore | null, collapsed: boolean): void {
  if (!store) return;
  try {
    store.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* blocked or full: the menu just opens unfolded next time */
  }
}
