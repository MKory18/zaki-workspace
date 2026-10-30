import { describe, expect, it } from "vitest";
import {
  CARD_COLORS,
  CHAT_BODY_MAX,
  LIMITS,
  cardMessageText,
  cardTaskDescription,
  cleanCardData,
  cleanCategory,
  cleanTags,
  isSafeHttpsUrl,
  type CardItem,
} from "@/lib/cards/shared";
import { MIN_GAP, POSITION_STEP, neighboursOf, positionBetween, positionOnTop, renumbered } from "@/lib/cards/order";
import {
  NO_FILTER,
  applyFilter,
  categoriesOf,
  groupByCategory,
  isFiltering,
  readView,
  searchKey,
  sortCards,
  tagsOf,
  viewStorageKey,
  writeView,
} from "@/lib/cards/view";

let n = 0;
function card(over: Partial<CardItem> = {}): CardItem {
  n += 1;
  return {
    id: `c${String(n).padStart(3, "0")}`,
    kind: "NOTE",
    title: `card ${n}`,
    body: null,
    data: null,
    color: "none",
    category: null,
    tags: [],
    pinned: false,
    position: n * 1000,
    fileId: null,
    file: null,
    archivedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    createdById: "u1",
    createdByName: "u",
    ...over,
  };
}

describe("links are https only", () => {
  it("accepts a plain https address", () => {
    expect(isSafeHttpsUrl("https://example.com")).toBe(true);
    expect(isSafeHttpsUrl("  https://example.com/a?b=1#c  ")).toBe(true);
  });

  it("refuses every other scheme, a password in the address, a bad address and a very long one", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PGI+eDwvYj4=",
      "http://example.com",
      "ftp://example.com",
      "//example.com",
      "https://user:secret@example.com",
      "https://",
      "example.com",
      "",
      "   ",
      `https://example.com/${"a".repeat(LIMITS.url)}`,
    ]) {
      expect(isSafeHttpsUrl(bad), bad).toBe(false);
    }
    expect(isSafeHttpsUrl(null)).toBe(false);
    expect(isSafeHttpsUrl(42)).toBe(false);
  });
});

describe("cleanCardData", () => {
  it("keeps a list's items, drops the empty ones, trims, keeps `done`", () => {
    const out = cleanCardData("LIST", { items: [{ text: " a ", done: true }, { text: "  ", done: false }, { text: "b" }] });
    expect(out).toEqual({ ok: true, value: { items: [{ text: "a", done: true }, { text: "b", done: false }] } });
  });

  it("refuses a list that is too long or malformed", () => {
    expect(cleanCardData("LIST", { items: Array.from({ length: LIMITS.listItems + 1 }, () => ({ text: "x", done: false })) }).ok).toBe(false);
    expect(cleanCardData("LIST", { items: [{ text: 5 }] }).ok).toBe(false);
    expect(cleanCardData("LIST", { items: "x" }).ok).toBe(false);
    expect(cleanCardData("LIST", undefined)).toEqual({ ok: true, value: { items: [] } });
  });

  it("a table is padded to its columns, and too many columns, rows or a cell too long are refused", () => {
    expect(cleanCardData("TABLE", { columns: [" a ", "b"], rows: [["1"], ["2", "3"]] })).toEqual({
      ok: true,
      value: { columns: ["a", "b"], rows: [["1", ""], ["2", "3"]] },
    });
    expect(cleanCardData("TABLE", { columns: Array(LIMITS.tableColumns + 1).fill("c"), rows: [] }).ok).toBe(false);
    expect(cleanCardData("TABLE", { columns: [], rows: [] }).ok).toBe(false);
    expect(cleanCardData("TABLE", { columns: ["a"], rows: Array(LIMITS.tableRows + 1).fill(["x"]) }).ok).toBe(false);
    expect(cleanCardData("TABLE", { columns: ["a"], rows: [["x", "too wide"]] }).ok).toBe(false);
    expect(cleanCardData("TABLE", { columns: ["a"], rows: [["x".repeat(LIMITS.tableCell + 1)]] }).ok).toBe(false);
    expect(cleanCardData("TABLE", { columns: [1], rows: [] }).ok).toBe(false);
  });

  it("a link needs a safe address; the kinds without data carry none", () => {
    expect(cleanCardData("LINK", { url: "https://example.com" })).toEqual({ ok: true, value: { url: "https://example.com" } });
    expect(cleanCardData("LINK", { url: "javascript:1" })).toEqual({ ok: false, error: "cards.e.link" });
    expect(cleanCardData("LINK", null).ok).toBe(false);
    for (const kind of ["NOTE", "PROMPT", "FILE"] as const) expect(cleanCardData(kind, { anything: 1 })).toEqual({ ok: true, value: null });
  });

  it("category and tags are trimmed, de-duplicated and limited", () => {
    expect(cleanCategory("  ideas ")).toBe("ideas");
    expect(cleanCategory("   ")).toBeNull();
    expect(cleanCategory(5)).toBeNull();
    expect(cleanTags(["#a", "a", " b ", "", 7, "##c"])).toEqual(["a", "b", "c"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(LIMITS.tags);
    expect(cleanTags("nope")).toEqual([]);
  });

  it("the colour set is only theme token names (no hex, no palette colour)", () => {
    for (const c of CARD_COLORS) expect(c).toMatch(/^(none|accent|ok|warn|danger|info|cat-[1-6])$/);
  });
});

describe("the sentence a card becomes in the chat", () => {
  it("a note is its title and its text", () => {
    expect(cardMessageText(card({ title: "T", body: "B" }))).toBe("T\nB");
    expect(cardMessageText(card({ title: "T", body: null }))).toBe("T");
  });

  it("a list shows its ticks, a link its address, a table its rows", () => {
    expect(cardMessageText(card({ kind: "LIST", title: "L", data: { items: [{ text: "x", done: true }, { text: "y", done: false }] } }))).toBe("L\n☑ x\n☐ y");
    expect(cardMessageText(card({ kind: "LINK", title: "K", data: { url: "https://example.com" } }))).toBe("K\nhttps://example.com");
    expect(cardMessageText(card({ kind: "TABLE", title: "S", data: { columns: ["a", "b"], rows: [["1", "2"]] } }))).toBe("S\na | b\n1 | 2");
  });

  it("a file card sends its words only: no file, no address of it", () => {
    const text = cardMessageText(card({ kind: "FILE", title: "contract", body: "signed", fileId: "f1", file: { name: "secret.pdf", mimeType: "application/pdf", size: 1 } }));
    expect(text).toBe("contract\nsigned");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("f1");
  });

  it("an unsafe link in a damaged row is never repeated; a very long card is cut to what a message takes", () => {
    expect(cardMessageText(card({ kind: "LINK", title: "K", data: { url: "javascript:alert(1)" } }))).toBe("K");
    expect(cardMessageText(card({ title: "T", body: "x".repeat(10_000) })).length).toBe(CHAT_BODY_MAX);
  });

  it("the task description carries the words, never a table or a file", () => {
    expect(cardTaskDescription(card({ kind: "NOTE", body: "do it" }))).toBe("do it");
    expect(cardTaskDescription(card({ kind: "NOTE", body: null }))).toBeUndefined();
    expect(cardTaskDescription(card({ kind: "LIST", body: "n", data: { items: [{ text: "a", done: false }] } }))).toBe("n\n☐ a");
  });
});

describe("fractional order", () => {
  it("goes between two neighbours, on top, at the bottom, and alone", () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(positionBetween(null, 1000)).toBe(1000 - POSITION_STEP);
    expect(positionBetween(2000, null)).toBe(2000 + POSITION_STEP);
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
    expect(positionOnTop(1000)).toBe(0);
    expect(positionOnTop(null)).toBe(POSITION_STEP);
  });

  it("says «no room» when the neighbours are equal, reversed or touching", () => {
    expect(positionBetween(5, 5)).toBeNull();
    expect(positionBetween(9, 3)).toBeNull();
    expect(positionBetween(1, 1 + MIN_GAP / 2)).toBeNull();
  });

  it("fifty moves into the same gap still find a number, then the caller renumbers", () => {
    let lo = 0;
    const hi = 1000;
    let moves = 0;
    for (; moves < 100; moves++) {
      const p = positionBetween(lo, hi);
      if (p === null) break;
      expect(p).toBeGreaterThan(lo);
      expect(p).toBeLessThan(hi);
      lo = p;
    }
    expect(moves).toBeGreaterThan(15);
    expect(moves).toBeLessThan(100);
    expect(renumbered(3)).toEqual([1000, 2000, 3000]);
  });

  it("the neighbours of a moved card are those of its own pinned group", () => {
    const shown = [
      { id: "p1", pinned: true },
      { id: "p2", pinned: true },
      { id: "a", pinned: false },
      { id: "b", pinned: false },
      { id: "c", pinned: false },
    ];
    expect(neighboursOf(shown, "b")).toEqual({ previousId: "a", nextId: "c" });
    expect(neighboursOf(shown, "a")).toEqual({ previousId: null, nextId: "b" });
    expect(neighboursOf(shown, "p2")).toEqual({ previousId: "p1", nextId: null });
    expect(neighboursOf(shown, "missing")).toEqual({ previousId: null, nextId: null });
  });
});

describe("filter, sort, group", () => {
  const a = card({ title: "Prompt for ads", kind: "PROMPT", body: "write a headline", category: "ads", tags: ["draft"], color: "ok" });
  const b = card({ title: "قائمة التسوق", kind: "LIST", data: { items: [{ text: "حليب", done: false }] }, category: "home", tags: ["weekly", "draft"] });
  const c = card({ title: "جدول المواصفات", kind: "TABLE", data: { columns: ["الحجم"], rows: [["كبير"]] }, pinned: true });
  const d = card({ title: "رابط", kind: "LINK", data: { url: "https://example.com" }, category: "ads", color: "warn" });
  const all = [a, b, c, d];

  it("filters by kind, category, tag, colour and pinned", () => {
    expect(applyFilter(all, { ...NO_FILTER, kind: "LIST" })).toEqual([b]);
    expect(applyFilter(all, { ...NO_FILTER, category: "ads" })).toEqual([a, d]);
    expect(applyFilter(all, { ...NO_FILTER, category: "NONE" })).toEqual([c]);
    expect(applyFilter(all, { ...NO_FILTER, tag: "draft" })).toEqual([a, b]);
    expect(applyFilter(all, { ...NO_FILTER, color: "warn" })).toEqual([d]);
    expect(applyFilter(all, { ...NO_FILTER, pinnedOnly: true })).toEqual([c]);
    expect(applyFilter(all, { ...NO_FILTER, kind: "LIST", category: "ads" })).toEqual([]);
  });

  it("searches the title and the text, in lists and tables too, ignoring case, short vowels and alef shapes", () => {
    expect(applyFilter(all, { ...NO_FILTER, q: "HEADLINE" })).toEqual([a]);
    expect(applyFilter(all, { ...NO_FILTER, q: "حليب" })).toEqual([b]);
    expect(applyFilter(all, { ...NO_FILTER, q: "كبير" })).toEqual([c]);
    expect(applyFilter(all, { ...NO_FILTER, q: "  المواصفات " })).toEqual([c]);
    expect(applyFilter(all, { ...NO_FILTER, q: "ads" })).toEqual([a]);
    expect(applyFilter(all, { ...NO_FILTER, q: "nothing like it" })).toEqual([]);
    expect(searchKey("أَحمد")).toBe(searchKey("احمد"));
    expect(searchKey("مدرسة")).toBe(searchKey("مدرسه"));
  });

  it("says whether anything is filtered", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ ...NO_FILTER, q: " " })).toBe(false);
    expect(isFiltering({ ...NO_FILTER, pinnedOnly: true })).toBe(true);
  });

  it("every sort puts the pinned cards first", () => {
    for (const sort of ["manual", "newest", "oldest", "title"] as const) {
      expect(sortCards(all, sort)[0], sort).toBe(c);
    }
  });

  it("manual follows the position, newest and oldest the date, title the alphabet; the id breaks ties", () => {
    const rest = [a, b, d];
    expect(sortCards(rest, "manual")).toEqual([a, b, d]);
    expect(sortCards([d, b, a], "manual")).toEqual([a, b, d]);
    expect(sortCards(rest, "newest")).toEqual([d, b, a]);
    expect(sortCards(rest, "oldest")).toEqual([a, b, d]);
    const titles = sortCards(rest, "title").map((x) => x.title);
    expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y, "ar")));
    const t1 = card({ position: 5 });
    const t2 = card({ position: 5 });
    expect(sortCards([t2, t1], "manual")).toEqual([t1, t2]);
  });

  it("lists the categories and tags once each, and groups the cards by category with the uncategorised last", () => {
    expect(categoriesOf(all)).toEqual(["ads", "home"]);
    expect(tagsOf(all)).toEqual(["draft", "weekly"]);
    const columns = groupByCategory(all);
    expect(columns.map((col) => col.category)).toEqual(["ads", "home", null]);
    expect(columns[0]!.cards).toEqual([a, d]);
    expect(columns[2]!.cards).toEqual([c]);
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("the view a person chose is remembered, and never breaks anything", () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };

  it("is the grid until a view was chosen; each person has their own", () => {
    expect(readView("u1", store())).toBe("grid");
    const s = store();
    writeView("u1", "list", s);
    writeView("u2", "columns", s);
    expect(readView("u1", s)).toBe("list");
    expect(readView("u2", s)).toBe("columns");
    expect(s.data[viewStorageKey("u1")]).toBe("list");
  });

  it("ignores a value that is not a view, a storage that throws, and no storage at all", () => {
    expect(readView("u1", store({ [viewStorageKey("u1")]: "<script>" }))).toBe("grid");
    const shut = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readView("u1", shut)).toBe("grid");
    expect(() => writeView("u1", "list", shut)).not.toThrow();
    expect(readView("u1", null)).toBe("grid");
    expect(() => writeView("u1", "list", null)).not.toThrow();
  });
});
