import { describe, expect, it } from "vitest";
import {
  browserStore,
  dismissFirstSteps,
  dismissHint,
  isHintDismissed,
  isTourSeen,
  loadFirstStepsLocal,
  markFirstStepDone,
  markTourSeen,
  parseFirstStepsLocal,
  restoreFirstSteps,
  saveFirstStepsLocal,
  setFirstStepsCollapsed,
  storageKeys,
  type KeyValueStore,
} from "@/lib/guide/storage";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** What a private window or a blocked-storage browser does: every call throws. */
const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("storageKeys: namespaced, and the first-steps one is per person", () => {
  it("never mixes two people on one device, nor one tour with another", () => {
    expect(storageKeys.firstSteps("u1")).not.toBe(storageKeys.firstSteps("u2"));
    expect(storageKeys.firstSteps("u1")).toContain("u1");
    expect(storageKeys.tourSeen("shell")).not.toBe(storageKeys.tourSeen("today"));
    expect(storageKeys.hint("a")).not.toBe(storageKeys.hint("b"));
    for (const key of [storageKeys.firstSteps("u1"), storageKeys.tourSeen("shell"), storageKeys.hint("x")]) {
      expect(key.startsWith("zaki.guide.")).toBe(true);
    }
  });
});

describe("parseFirstStepsLocal: whatever is in storage, a safe value comes out", () => {
  const fresh = { dismissed: false, collapsed: false, done: [] };

  it("an empty, missing or garbage value is the fresh state", () => {
    expect(parseFirstStepsLocal(null)).toEqual(fresh);
    expect(parseFirstStepsLocal(undefined)).toEqual(fresh);
    expect(parseFirstStepsLocal("")).toEqual(fresh);
    expect(parseFirstStepsLocal("not json")).toEqual(fresh);
    expect(parseFirstStepsLocal("null")).toEqual(fresh);
    expect(parseFirstStepsLocal("[1,2]")).toEqual(fresh);
    expect(parseFirstStepsLocal('"x"')).toEqual(fresh);
  });

  it("reads a good value, and ignores the fields of the wrong type", () => {
    expect(parseFirstStepsLocal('{"v":1,"dismissed":true,"collapsed":true,"done":["install","open-guide"]}')).toEqual({
      dismissed: true,
      collapsed: true,
      done: ["install", "open-guide"],
    });
    expect(parseFirstStepsLocal('{"dismissed":"yes","collapsed":1,"done":"install"}')).toEqual(fresh);
    expect(parseFirstStepsLocal('{"done":["install",7,null,"open-guide"]}').done).toEqual(["install", "open-guide"]);
  });

  it("removes duplicates and caps the list (a tampered value cannot grow without bound)", () => {
    expect(parseFirstStepsLocal('{"done":["a","a","b"]}').done).toEqual(["a", "b"]);
    const many = JSON.stringify({ done: Array.from({ length: 500 }, (_, i) => `s${i}`) });
    expect(parseFirstStepsLocal(many).done.length).toBeLessThanOrEqual(50);
  });
});

describe("the first-steps card state, per person and per device", () => {
  it("loads the fresh state when nothing is saved, and when storage is blocked", () => {
    expect(loadFirstStepsLocal(memoryStore(), "u1")).toEqual({ dismissed: false, collapsed: false, done: [] });
    expect(loadFirstStepsLocal(throwing, "u1")).toEqual({ dismissed: false, collapsed: false, done: [] });
    expect(loadFirstStepsLocal(null, "u1")).toEqual({ dismissed: false, collapsed: false, done: [] });
  });

  it("marks a step done, once, and remembers it for that person only", () => {
    const store = memoryStore();
    markFirstStepDone(store, "u1", "install");
    markFirstStepDone(store, "u1", "install");
    markFirstStepDone(store, "u1", "open-guide");
    expect(loadFirstStepsLocal(store, "u1").done).toEqual(["install", "open-guide"]);
    expect(loadFirstStepsLocal(store, "u2").done).toEqual([]);
  });

  it("collapses, expands, dismisses and restores — each keeping the rest", () => {
    const store = memoryStore();
    markFirstStepDone(store, "u1", "install");
    setFirstStepsCollapsed(store, "u1", true);
    expect(loadFirstStepsLocal(store, "u1")).toEqual({ dismissed: false, collapsed: true, done: ["install"] });
    setFirstStepsCollapsed(store, "u1", false);
    dismissFirstSteps(store, "u1");
    expect(loadFirstStepsLocal(store, "u1")).toEqual({ dismissed: true, collapsed: false, done: ["install"] });
    restoreFirstSteps(store, "u1");
    expect(loadFirstStepsLocal(store, "u1")).toEqual({ dismissed: false, collapsed: false, done: ["install"] });
  });

  it("never throws when storage is blocked (private window, cleared site data): it just does not remember", () => {
    expect(() => markFirstStepDone(throwing, "u1", "install")).not.toThrow();
    expect(() => dismissFirstSteps(throwing, "u1")).not.toThrow();
    expect(() => restoreFirstSteps(throwing, "u1")).not.toThrow();
    expect(() => setFirstStepsCollapsed(throwing, "u1", true)).not.toThrow();
    expect(() => saveFirstStepsLocal(null, "u1", { dismissed: true, collapsed: false, done: [] })).not.toThrow();
  });

  it("returns the new state even when it could not be saved (the card still reacts for this visit)", () => {
    expect(markFirstStepDone(throwing, "u1", "install").done).toEqual(["install"]);
    expect(dismissFirstSteps(null, "u1").dismissed).toBe(true);
  });
});

describe("tours seen and hints dismissed: once per device", () => {
  it("remembers a finished tour, per tour", () => {
    const store = memoryStore();
    expect(isTourSeen(store, "shell")).toBe(false);
    markTourSeen(store, "shell");
    expect(isTourSeen(store, "shell")).toBe(true);
    expect(isTourSeen(store, "today")).toBe(false);
  });

  it("remembers a dismissed hint, per hint", () => {
    const store = memoryStore();
    expect(isHintDismissed(store, "board")).toBe(false);
    dismissHint(store, "board");
    expect(isHintDismissed(store, "board")).toBe(true);
    expect(isHintDismissed(store, "other")).toBe(false);
  });

  it("treats blocked storage as 'not seen' and does not throw", () => {
    expect(isTourSeen(throwing, "shell")).toBe(false);
    expect(isHintDismissed(throwing, "x")).toBe(false);
    expect(() => markTourSeen(throwing, "shell")).not.toThrow();
    expect(() => dismissHint(throwing, "x")).not.toThrow();
    expect(isTourSeen(null, "shell")).toBe(false);
    expect(() => dismissHint(null, "x")).not.toThrow();
  });
});

describe("browserStore: the real localStorage when there is one", () => {
  it("is null on the server (no window), never a throw", () => {
    expect(browserStore()).toBeNull();
  });
});
