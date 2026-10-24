import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { arabicPlural } from "@/lib/format";

/**
 * The chat screens' words, from the ar.chat-*.json fragments. The chat components read the dictionary
 * directly (they also render on their own, in tests, without the I18n provider): never an Arabic
 * literal in their JSX, so the Arabic guards see every chat string.
 */
export function ct(key: string, vars?: Record<string, string | number>): string {
  return interpolate(AR[key] ?? key, vars);
}

/** A counted phrase in its Arabic number form: `<base>.one|two|few|many` with `{n}`. */
export function ctCount(base: string, n: number): string {
  return ct(`${base}.${arabicPlural(n)}`, { n });
}
