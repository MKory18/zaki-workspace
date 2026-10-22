/**
 * Looking things up in Arabic. A pure module: the guide's search box (in the browser) and the
 * article search (on the server) use the same rules.
 *
 * People type the same word many ways - with or without the little vowel marks, with أ إ آ or a
 * bare ا, ة or ه at the end, ى or ي - so both sides are folded to one spelling before comparing.
 */

/** Tashkeel: fathatan..sukun, the dagger alef, and the Quranic small marks. */
const MARKS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

const FOLD: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ى": "ي",
  "ة": "ه",
  "ؤ": "و",
  "ئ": "ي",
};

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits become 0-9. */
function digits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => String((d.codePointAt(0) as number) & 0xf));
}

/** Everything that is not a letter or a digit separates words: Arabic and Latin punctuation, symbols. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/**
 * One spelling for matching: tashkeel and tatweel removed, أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و,
 * ئ → ي, Arabic digits → 0-9, Latin lowercased, punctuation → single spaces.
 */
export function normalizeArabic(input: string): string {
  return digits(input)
    .normalize("NFKC")
    .replace(MARKS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱىةؤئ]/g, (c) => FOLD[c] ?? c)
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .trim();
}

/** The definite article, alone or with a one-letter word before it (وال بال فال كال لل). */
const ARTICLE_PREFIX = /^(?:وال|بال|فال|كال|لل|ال)/;

/**
 * The words of a search, ready to look for: normalized, the definite article dropped (so «المهام»
 * finds «مهام»), never cut down to a single letter, without repeats.
 */
export function queryTokens(query: string): string[] {
  const out: string[] = [];
  for (const word of normalizeArabic(query).split(" ")) {
    if (!word) continue;
    const bare = word.replace(ARTICLE_PREFIX, "");
    const token = bare.length >= 2 ? bare : word;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/** What can be searched: a title, a summary, extra words people may use, and the body. */
export interface Searchable {
  title: string;
  summary?: string;
  keywords?: readonly string[];
  text?: string;
}

const WEIGHT = { title: 10, keywords: 6, summary: 4, text: 1 } as const;

/**
 * How well an entry answers the words. 0 means it does not: every word has to be found somewhere.
 * A hit in the title counts most, then the keywords, the summary and the body.
 */
function scoreEntry(entry: Searchable, tokens: readonly string[]): number {
  const title = normalizeArabic(entry.title);
  const keywords = normalizeArabic((entry.keywords ?? []).join(" "));
  const summary = normalizeArabic(entry.summary ?? "");
  const text = normalizeArabic(entry.text ?? "");
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (title.includes(token)) best += WEIGHT.title;
    if (keywords.includes(token)) best += WEIGHT.keywords;
    if (summary.includes(token)) best += WEIGHT.summary;
    if (text.includes(token)) best += WEIGHT.text;
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * The entries that answer the search, best first; equal scores keep their original order. An empty
 * search keeps every entry as it was.
 */
export function rankEntries<T extends Searchable>(entries: readonly T[], query: string): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.entry);
}
