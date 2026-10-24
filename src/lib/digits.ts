/**
 * «الأرقام: 123 / ١٢٣» — how a person sees the digits 0-9. A pure module (no React, no server imports): the root
 * layout, the route, the sign-in, the menu and the tests read it.
 *
 * How it works, and why this way: NOT ONE NUMBER IN THE CODE CHANGES. The page always holds 0-9 — the server's
 * HTML, React's text, the dictionary, a field, a copy, a search — and the root layout writes the choice on <html>
 * as `data-digits`. With "arabic", globals.css puts the font "Zaki Digits" (public/fonts, the ten Arabic-Indic
 * digits of IBM Plex Sans Arabic drawn for 0-9, `unicode-range: U+0030-0039`) first in every text stack, so a
 * browser DRAWS 0-9 as ٠-٩ and nothing else moves. Rewriting every number on the way out would have to agree
 * between the server and the browser on the first render, reach the numbers that never pass through a helper,
 * and still keep fields, copies and searches Western: the font does all of that by construction.
 *
 * Kept like the theme: `User.digits` follows the person to every device (the sign-in sets the cookie there),
 * the `zk-digits` cookie paints the first frame on the server. Anything stored that is not a mode is "latin".
 */

export const DIGIT_MODES = ["latin", "arabic"] as const;
export type DigitMode = (typeof DIGIT_MODES)[number];

export const DEFAULT_DIGITS: DigitMode = "latin";
export const DIGITS_COOKIE = "zk-digits";

export function isDigitMode(value: unknown): value is DigitMode {
  return typeof value === "string" && (DIGIT_MODES as readonly string[]).includes(value);
}

export function digitsOf(value: unknown): DigitMode {
  return isDigitMode(value) ? value : DEFAULT_DIGITS;
}

/** What a mode looks like, for the menu: the same three digits in both shapes. */
export const DIGIT_SAMPLES: Record<DigitMode, string> = { latin: "123", arabic: "١٢٣" };
