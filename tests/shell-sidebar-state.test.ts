import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@/lib/guide/storage";
import { SIDEBAR_KEY, readSidebarCollapsed, writeSidebarCollapsed } from "@/components/shell/sidebar-state";

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("the side menu remembers whether it was folded, on this device", () => {
  it("is open until somebody folds it", () => {
    expect(readSidebarCollapsed(memory())).toBe(false);
    expect(readSidebarCollapsed(null)).toBe(false);
  });

  it("remembers folding and unfolding", () => {
    const store = memory();
    writeSidebarCollapsed(store, true);
    expect(store.data[SIDEBAR_KEY]).toBe("1");
    expect(readSidebarCollapsed(store)).toBe(true);
    writeSidebarCollapsed(store, false);
    expect(readSidebarCollapsed(store)).toBe(false);
  });

  it("a value edited by hand reads as open", () => {
    expect(readSidebarCollapsed(memory({ [SIDEBAR_KEY]: "yes please" }))).toBe(false);
  });

  it("a blocked storage (private window, cleared site data) never throws: the menu is simply open", () => {
    expect(() => writeSidebarCollapsed(broken, true)).not.toThrow();
    expect(readSidebarCollapsed(broken)).toBe(false);
    expect(() => writeSidebarCollapsed(null, true)).not.toThrow();
  });
});
