import { describe, expect, it } from "vitest";
import { CARD_STATUSES, allowedStatusMoves, canMoveStatus, statusOf } from "@/lib/cards/status";
import { cleanStars, ratingSummary } from "@/lib/cards/rating";
import {
  FIRST_VERSION,
  changedFields,
  conflictRows,
  decideSave,
  defaultPick,
  diffSnapshots,
  nextVersion,
  patchFromChoices,
  stableStringify,
  type CardSnapshot,
} from "@/lib/cards/versions";
import { browserStorage, clearDraft, draftKey, loadDraft, saveDraft, type DraftStorage } from "@/lib/cards/draft";
import { fieldText, logText, snapshotOfItem } from "@/lib/cards/texts";
import { AR } from "@/lib/i18n/dict";

const t = (key: string, vars?: Record<string, string | number>) => {
  let s = AR[key] ?? `!${key}`;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

const base: CardSnapshot = { title: "A", body: "text", data: null, color: "none", category: null, tags: [], fileId: null };

describe("version numbering and the 409 decision", () => {
  it("the first version is 1 and every saved edit adds one", () => {
    expect(FIRST_VERSION).toBe(1);
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(41)).toBe(42);
    expect(nextVersion(0)).toBe(2); // a broken number never goes below the first version
  });

  it("a save that changes nothing writes nothing, whatever version it started from", () => {
    expect(decideSave({ baseVersion: 3, currentVersion: 7, changed: [] })).toEqual({ kind: "noop" });
  });

  it("a save from the current version applies; a save from an older one is a conflict", () => {
    expect(decideSave({ baseVersion: 4, currentVersion: 4, changed: ["title"] })).toEqual({ kind: "apply" });
    expect(decideSave({ baseVersion: 3, currentVersion: 4, changed: ["title"] })).toEqual({ kind: "conflict" });
    // a version from the future is not the card's either
    expect(decideSave({ baseVersion: 9, currentVersion: 4, changed: ["body"] })).toEqual({ kind: "conflict" });
  });

  it("an older client that sends no version still applies (the screen always sends one)", () => {
    expect(decideSave({ baseVersion: undefined, currentVersion: 4, changed: ["title"] })).toEqual({ kind: "apply" });
    expect(decideSave({ baseVersion: null, currentVersion: 4, changed: ["title"] })).toEqual({ kind: "apply" });
  });

  it("changed fields: only what is sent and differs; objects compare by content, not by key order", () => {
    expect(changedFields(base, { title: "A", body: "text" })).toEqual([]);
    expect(changedFields(base, { title: "B", tags: ["x"] })).toEqual(["title", "tags"]);
    const withData = { ...base, data: { items: [{ text: "a", done: false }] } };
    expect(changedFields(withData, { data: { items: [{ done: false, text: "a" }] } })).toEqual([]);
    expect(changedFields(withData, { data: { items: [{ text: "a", done: true }] } })).toEqual(["data"]);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it("the difference between two versions lists the fields that differ, in the card's order", () => {
    const later: CardSnapshot = { ...base, title: "B", tags: ["x"] };
    expect(diffSnapshots(base, later).map((d) => d.field)).toEqual(["title", "tags"]);
    expect(diffSnapshots(base, base)).toEqual([]);
  });
});

describe("«اللوحة تغيّرت»: the choice after a conflict", () => {
  const original = { ...base };
  const mine: CardSnapshot = { ...base, title: "mine", body: "my body", category: "mine-cat" };
  const theirs: CardSnapshot = { ...base, title: "theirs", tags: ["t"], category: "mine-cat" };
  const rows = conflictRows(original, mine, theirs);

  it("lists the fields where my version and the card differ, and who changed each", () => {
    expect(rows.map((r) => [r.field, r.byMe, r.byThem])).toEqual([
      ["title", true, true], // both changed it
      ["body", true, false], // only I did
      ["tags", false, true], // only they did
    ]);
  });

  it("by default my own changes are kept where nobody else touched the field, theirs everywhere else", () => {
    expect(rows.map(defaultPick)).toEqual(["theirs", "mine", "theirs"]);
    expect(patchFromChoices(rows, {})).toEqual({ body: "my body" });
  });

  it("a field both changed is taken from mine only when the person picks it", () => {
    expect(patchFromChoices(rows, { title: "mine" })).toEqual({ title: "mine", body: "my body" });
    expect(patchFromChoices(rows, { body: "theirs" })).toEqual({});
  });
});

describe("status transitions: which roles may move where", () => {
  it("there are four statuses, in the order the owner fixed", () => {
    expect([...CARD_STATUSES]).toEqual(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]);
    expect(statusOf("nonsense")).toBe("DRAFT");
    expect(statusOf(null)).toBe("DRAFT");
  });

  it("only a moderator moves a status at all", () => {
    for (const from of CARD_STATUSES) {
      expect(allowedStatusMoves(from, { moderator: false })).toEqual([]);
      for (const to of CARD_STATUSES) expect(canMoveStatus(from, to, { moderator: false })).toBe(false);
    }
  });

  it("a moderator follows the road: draft to review to approved; an approved card is reopened through review", () => {
    expect(canMoveStatus("DRAFT", "REVIEW", { moderator: true })).toBe(true);
    expect(canMoveStatus("REVIEW", "APPROVED", { moderator: true })).toBe(true);
    expect(canMoveStatus("REVIEW", "DRAFT", { moderator: true })).toBe(true);
    expect(canMoveStatus("DRAFT", "APPROVED", { moderator: true })).toBe(false); // review cannot be skipped
    expect(canMoveStatus("APPROVED", "DRAFT", { moderator: true })).toBe(false);
    expect(canMoveStatus("APPROVED", "REVIEW", { moderator: true })).toBe(true);
    expect(canMoveStatus("ARCHIVED", "DRAFT", { moderator: true })).toBe(true);
    expect(canMoveStatus("ARCHIVED", "APPROVED", { moderator: true })).toBe(false);
    expect(canMoveStatus("DRAFT", "DRAFT", { moderator: true })).toBe(false);
  });
});

describe("the stars: the average and the number of raters", () => {
  it("nobody rated: no average", () => {
    expect(ratingSummary([])).toEqual({ average: null, count: 0 });
  });
  it("one decimal, and the count", () => {
    expect(ratingSummary([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
    expect(ratingSummary([1, 2])).toEqual({ average: 1.5, count: 2 });
    expect(ratingSummary([5])).toEqual({ average: 5, count: 1 });
  });
  it("only whole numbers from 1 to 5 are stars", () => {
    expect([0, 6, 2.5, -1, "3", null, NaN].map(cleanStars)).toEqual([null, null, null, null, null, null, null]);
    expect([1, 2, 3, 4, 5].map(cleanStars)).toEqual([1, 2, 3, 4, 5]);
    expect(ratingSummary([0, 7, 3])).toEqual({ average: 3, count: 1 });
  });
});

describe("the local draft never breaks the page", () => {
  const memory = (): DraftStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it("saves, loads and clears a draft", () => {
    const storage = memory();
    const key = draftKey("u1", "c1");
    expect(saveDraft(storage, key, { baseVersion: 3, savedAt: "2026-10-30T10:00:00.000Z", payload: { title: "x" } })).toBe(true);
    expect(loadDraft<{ title: string }>(storage, key)).toEqual({ baseVersion: 3, savedAt: "2026-10-30T10:00:00.000Z", payload: { title: "x" } });
    clearDraft(storage, key);
    expect(loadDraft(storage, key)).toBeNull();
  });

  it("a draft belongs to one person and one card", () => {
    expect(draftKey("u1", "c1")).not.toBe(draftKey("u2", "c1"));
    expect(draftKey("u1", "c1")).not.toBe(draftKey("u1", "c2"));
  });

  it("storage that throws (private window, full, blocked) is survived on every call", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveDraft(broken, "k", { baseVersion: 1, savedAt: "x", payload: {} })).toBe(false);
    expect(loadDraft(broken, "k")).toBeNull();
    expect(() => clearDraft(broken, "k")).not.toThrow();
    expect(saveDraft(null, "k", { baseVersion: 1, savedAt: "x", payload: {} })).toBe(false);
    expect(loadDraft(null, "k")).toBeNull();
    expect(browserStorage()).toBeNull(); // no window here
  });

  it("junk in storage is no draft", () => {
    const storage = memory();
    storage.setItem("k", "{not json");
    expect(loadDraft(storage, "k")).toBeNull();
    storage.setItem("k", JSON.stringify({ baseVersion: "3" }));
    expect(loadDraft(storage, "k")).toBeNull();
    storage.setItem("k", JSON.stringify([1, 2]));
    expect(loadDraft(storage, "k")).toBeNull();
  });
});

describe("the words made from data", () => {
  it("a field's value: empty, tags, a colour, a list, a table", () => {
    expect(fieldText("title", "", t)).toBe(AR["cards.p.empty_value"]);
    expect(fieldText("category", null, t)).toBe(AR["cards.p.empty_value"]);
    expect(fieldText("tags", ["أ", "ب"], t)).toBe("أ، ب");
    expect(fieldText("tags", [], t)).toBe(AR["cards.p.empty_value"]);
    expect(fieldText("color", "ok", t)).toBe(AR["cards.color.ok"]);
    expect(fieldText("data", { items: [{ text: "a", done: true }, { text: "b", done: false }] }, t)).toBe("☑ a\n☐ b");
    expect(fieldText("data", { columns: ["x", "y"], rows: [["1", "2"]] }, t)).toBe("x | y\n1 | 2");
    expect(fieldText("data", { url: "https://example.com" }, t)).toBe("https://example.com");
  });

  it("a line of the log names no stars: a rating line says only that the stars changed", () => {
    const rated = logText({ action: "rated", actorName: "Sara", detail: {} }, t);
    expect(rated).toBe(AR["cards.log.rated"]);
    expect(logText({ action: "rated", actorName: null, detail: {} }, t)).toBe(AR["cards.log.rated_anon"]);
    expect(rated).not.toMatch(/[0-9٠-٩]/);
  });

  it("status, edit and restore lines carry their facts", () => {
    expect(logText({ action: "status", actorName: "A", detail: { from: "DRAFT", to: "REVIEW" } }, t)).toBe("نقل الحالة من «مسودة» إلى «قيد المراجعة»");
    expect(logText({ action: "edited", actorName: "A", detail: { version: 3, fields: "title,body" } }, t)).toContain("العنوان، النص");
    expect(logText({ action: "restored", actorName: "A", detail: { fromVersion: 1, version: 4 } }, t)).toContain("1");
  });

  it("a card on screen becomes the snapshot the version helpers compare", () => {
    expect(snapshotOfItem({ title: "A", body: null, data: null, color: "ok", category: "c", tags: ["t"], fileId: null })).toEqual({
      title: "A",
      body: null,
      data: null,
      color: "ok",
      category: "c",
      tags: ["t"],
      fileId: null,
    });
  });
});
