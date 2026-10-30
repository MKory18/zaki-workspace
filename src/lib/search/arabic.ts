/**
 * ARABIC-TOLERANT SEARCH — one pure module (no React, no server imports): the server builds the pattern it hands
 * to PostgreSQL's `~*`, the browser folds the text of a picker with the same rules, the tests read both.
 *
 * Why a pattern and not an extension: the production database is not known to have `unaccent` / `pg_trgm`, and a
 * migration that creates one would stop the deploy. So the application builds, from what the person typed, ONE
 * regular expression written in the common subset of PostgreSQL's ARE and JavaScript, and the database does the
 * matching: no migration, no extension, no change to a table.
 *
 * What is tolerated (and what deliberately is not):
 *   - أ إ آ ٱ ا are one letter                                  «احمد» finds «أحمد»
 *   - ة and ه are one letter                                     «مدرسه» finds «مدرسة» (and the other way)
 *   - tashkeel (U+064B-U+065F, U+0670) and tatweel (U+0640) may sit after any letter, in the stored text; they are
 *     dropped from the query                                     «محمد» finds «مُحَمَّد» and «محـمد»
 *   - Arabic-Indic (٠-٩) and Persian (۰-۹) digits are the Western digits   «١٢٣» finds «123»
 *   - Persian ک is ك, Persian ی is ي (the same letters from another keyboard)
 *   - Latin is case-insensitive (the `~*` operator, the `i` flag)
 *   - a run of spaces is one gap: it matches any run of white space
 *   NOT folded, on purpose: ى and ي. «علي» (a very common name) and «على» («on») are different words, and an
 *   Egyptian-style «مصطفي» for «مصطفى» is the price. ئ and ؤ stay as typed too (a hamza on a carrier is a spelling
 *   choice that changes the word often enough to over-match). The old search folded none of these either, so nothing
 *   that was found before is lost.
 *
 * SAFETY: every character of the query is either a letter or digit (emitted inside a fixed class or as itself),
 * white space (`\s+`) or escaped, so what a person types can never be a regular-expression operator. Control
 * characters (a NUL would be an error in PostgreSQL) and unpaired surrogates are dropped; the length is capped.
 * The pattern always travels to the database as a bound PARAMETER, never glued into SQL.
 */

/** The longest query that is searched (characters, after cleaning). */
export const MAX_QUERY_CHARS = 100;

/** Tashkeel U+064B-U+065F, dagger alef U+0670, tatweel U+0640 — as the inside of a character class. */
const MARKS_CLASS = "\u064B-\u065F\u0670\u0640";
const MARKS = new RegExp(`[${MARKS_CLASS}]`, "g");
const OPTIONAL_MARKS = `[${MARKS_CLASS}]*`;

/** Letters that are one letter for the search: the key is any member, the value is the whole class. */
const LETTER_GROUPS = ["أإآٱا", "ةه", "كک", "يی"] as const;
const LETTER_CLASS = new Map<string, string>();
for (const group of LETTER_GROUPS) for (const ch of group) LETTER_CLASS.set(ch, `[${group}]`);

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Every way to write a digit: «5», «٥», «۵». */
function digitValue(ch: string): number {
  const code = ch.codePointAt(0) as number;
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return code - ARABIC_INDIC_ZERO;
  if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) return code - PERSIAN_ZERO;
  return code - 0x30;
}
const isAnyDigit = (ch: string) => /^[0-9\u0660-\u0669\u06F0-\u06F9]$/.test(ch);
function digitClass(ch: string): string {
  const n = digitValue(ch);
  return `[${n}${String.fromCharCode(ARABIC_INDIC_ZERO + n)}${String.fromCharCode(PERSIAN_ZERO + n)}]`;
}

/** The only characters that are operators in a POSIX ARE and in a JavaScript pattern: always escaped. */
const OPERATORS = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}", "-", "/"]);

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * What is searched, cleaned: control and direction characters and unpaired surrogates dropped, white space
 * collapsed to one space, trimmed, cut to {@link MAX_QUERY_CHARS} characters. May be empty.
 */
export function cleanQuery(raw: string): string {
  const text = String(raw ?? "")
    .replace(UNPAIRED_SURROGATE, " ")
    // tab, newline and the like are white space, not "control": make them spaces before the control strip
    .replace(/[\t\n\r\f\v]/g, " ")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > MAX_QUERY_CHARS ? chars.slice(0, MAX_QUERY_CHARS).join("").trim() : text;
}

/** One character of the query as a piece of pattern. */
function atom(ch: string): string {
  if (isAnyDigit(ch)) return digitClass(ch) + OPTIONAL_MARKS;
  const group = LETTER_CLASS.get(ch);
  if (group) return group + OPTIONAL_MARKS;
  if (OPERATORS.has(ch)) return `\\${ch}`;
  // a letter of any script, or a symbol that is no operator: as itself (marks may follow a letter)
  return /^[\p{L}\p{N}]$/u.test(ch) ? ch + OPTIONAL_MARKS : ch;
}

export interface ArabicSearch {
  /** The cleaned text the person typed (marks and tatweel removed). */
  text: string;
  /** The pattern for «contains»: PostgreSQL `col ~* $1` and `new RegExp(source, "i")`. */
  source: string;
  /** The same, anchored at the start: «starts with». */
  prefix: string;
}

/**
 * The search for what was typed, or null when there is nothing to look for (empty, only spaces, only marks).
 * `source` has no flags and no group a caller could break; it is safe to bind as a parameter.
 */
export function arabicSearch(raw: string): ArabicSearch | null {
  const text = cleanQuery(raw).replace(MARKS, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const source = Array.from(text)
    .map((ch) => (ch === " " ? "\\s+" : atom(ch)))
    .join("");
  return { text, source, prefix: `^${source}` };
}

/**
 * The browser's side (pickers that filter a list already loaded): the text in the one spelling the pattern
 * above matches — marks and tatweel dropped, one alef, ة→ه, ک→ك, ی→ي, Western digits, lower case, one space.
 * `foldedIncludes(name, typed)` is the picker's test.
 */
export function foldForSearch(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ک/g, "ك")
    .replace(/ی/g, "ي")
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(digitValue(d)))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function foldedIncludes(haystack: string, typed: string): boolean {
  const needle = foldForSearch(typed);
  return !needle || foldForSearch(haystack).includes(needle);
}

/** Where the typed words start in a text (for centring a snippet), or -1. Same rules as the database pattern. */
export function findSpelled(haystack: string, raw: string): number {
  const s = arabicSearch(raw);
  if (!s) return -1;
  try {
    return new RegExp(s.source, "i").exec(haystack)?.index ?? -1;
  } catch {
    return -1;
  }
}
