import type { CardColor, CardItem, CardKind } from "./shared";

/**
 * What the person sees of the cards: filter, sort, group, and the view they chose. Pure (the screen calls these; the
 * tests call them without a browser). Pinned cards float first inside EVERY sort.
 */

export const CARD_VIEWS = ["grid", "list", "columns"] as const;
export type CardView = (typeof CARD_VIEWS)[number];

export const CARD_SORTS = ["manual", "newest", "oldest", "title"] as const;
export type CardSort = (typeof CARD_SORTS)[number];

export interface CardFilter {
  kind: CardKind | "ALL";
  /** A category, «بلا تصنيف» (`NONE`), or everything. */
  category: string | "ALL" | "NONE";
  tag: string | "ALL";
  color: CardColor | "ALL";
  q: string;
  pinnedOnly: boolean;
}

export const NO_FILTER: CardFilter = { kind: "ALL", category: "ALL", tag: "ALL", color: "ALL", q: "", pinnedOnly: false };

export function isFiltering(f: CardFilter): boolean {
  return f.kind !== "ALL" || f.category !== "ALL" || f.tag !== "ALL" || f.color !== "ALL" || f.q.trim() !== "" || f.pinnedOnly;
}

/** For searching: lower case, no short vowels or tatweel, one shape of alef, ya and ta marbuta. */
export function searchKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    // Arabic-Indic and Persian digits are the Western ones: «١٢٣» finds «123»
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.codePointAt(0) as number) & 0xf));
}

/** The words of a card the search reads: its title and its text (the note, the list items, the table cells). */
function haystack(card: CardItem): string {
  const parts = [card.title, card.body ?? ""];
  if (card.data && "items" in card.data) parts.push(...card.data.items.map((i) => i.text));
  if (card.data && "columns" in card.data) parts.push(...card.data.columns, ...card.data.rows.flat());
  return searchKey(parts.join("\n"));
}

export function applyFilter(cards: readonly CardItem[], f: CardFilter): CardItem[] {
  const needle = searchKey(f.q.trim());
  return cards.filter((c) => {
    if (f.kind !== "ALL" && c.kind !== f.kind) return false;
    if (f.category === "NONE" ? c.category !== null : f.category !== "ALL" && c.category !== f.category) return false;
    if (f.tag !== "ALL" && !c.tags.includes(f.tag)) return false;
    if (f.color !== "ALL" && c.color !== f.color) return false;
    if (f.pinnedOnly && !c.pinned) return false;
    if (needle && !haystack(c).includes(needle)) return false;
    return true;
  });
}

/** Pinned first; then the sort; the id breaks every tie so the order never flickers. */
export function sortCards(cards: readonly CardItem[], sort: CardSort): CardItem[] {
  const byId = (a: CardItem, b: CardItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const within = (a: CardItem, b: CardItem): number => {
    switch (sort) {
      case "newest":
        return b.createdAt.localeCompare(a.createdAt) || byId(a, b);
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt) || byId(a, b);
      case "title":
        return a.title.localeCompare(b.title, "ar") || byId(a, b);
      default:
        return a.position - b.position || byId(a, b);
    }
  };
  return [...cards].sort((a, b) => (a.pinned === b.pinned ? within(a, b) : a.pinned ? -1 : 1));
}

export function categoriesOf(cards: readonly CardItem[]): string[] {
  return [...new Set(cards.flatMap((c) => (c.category ? [c.category] : [])))].sort((a, b) => a.localeCompare(b, "ar"));
}

export function tagsOf(cards: readonly CardItem[]): string[] {
  return [...new Set(cards.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, "ar"));
}

export interface CardColumn {
  /** null: the cards with no category. */
  category: string | null;
  cards: CardItem[];
}

/** «أعمدة حسب التصنيف»: one column per category (alphabetical), the uncategorised ones last; the order inside is kept. */
export function groupByCategory(cards: readonly CardItem[]): CardColumn[] {
  const map = new Map<string, CardItem[]>();
  const none: CardItem[] = [];
  for (const c of cards) {
    if (c.category === null) none.push(c);
    else map.set(c.category, [...(map.get(c.category) ?? []), c]);
  }
  const named = [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "ar")).map(([category, list]) => ({ category, cards: list }));
  return none.length ? [...named, { category: null, cards: none }] : named;
}

// ---------- the view a person chose, remembered in the browser ----------

/** One key per person: two people on one browser each keep their own view. */
export const viewStorageKey = (userId: string) => `zk-cards-view:${userId}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered view; the grid when nothing is stored, the storage is shut, or the value is not one of ours. */
export function readView(userId: string, storage: StorageLike | null = browserStorage()): CardView {
  try {
    const v = storage?.getItem(viewStorageKey(userId));
    return (CARD_VIEWS as readonly string[]).includes(v ?? "") ? (v as CardView) : "grid";
  } catch {
    return "grid";
  }
}

export function writeView(userId: string, view: CardView, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(viewStorageKey(userId), view);
  } catch {
    /* a private window or blocked storage: the choice simply is not remembered */
  }
}
