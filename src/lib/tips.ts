/**
 * Short usage tips for the loading screen (src/app/(app)/loading.tsx): one is shown at a time, so the
 * seconds a page takes to arrive teach something about the system.
 *
 * A pure module (no React, no server imports). The texts are NOT here: like every sentence of the
 * interface they live in the Arabic dictionary, `src/lib/i18n/ar.ui.json`, under these keys, and are read
 * with `t(key)`. Rules for a tip, pinned by tests/tips.test.ts: Arabic only (no Latin letter), at most 90
 * characters, about a feature that exists, one tip per key, never a repeat.
 */

export const TIP_KEYS = [
  "tips.search",
  "tips.places",
  "tips.task",
  "tips.today",
  "tips.tabs",
  "tips.chat",
  "tips.bell",
  "tips.files",
  "tips.calendar",
  "tips.ideas",
  "tips.theme",
  "tips.install",
  "tips.guide",
] as const;

export type TipKey = (typeof TIP_KEYS)[number];

/** How long one tip stays the tip of the moment. */
export const TIP_ROTATION_MS = 30_000;

/** The seed of a moment: the same number for everybody inside one 30-second window. */
export function tipSeed(nowMs: number): number {
  return Math.floor(nowMs / TIP_ROTATION_MS);
}

/**
 * The tip for a seed. A pure function, on purpose: a tip picked with Math.random at render time would
 * differ between the server and the browser (a hydration mismatch) and could not be tested. Any number is
 * a valid seed (negative, fractional, NaN, Infinity); consecutive seeds walk through all the tips in order.
 */
export function tipFor(seed: number): TipKey {
  const whole = Number.isFinite(seed) ? Math.trunc(Math.abs(seed)) : 0;
  return TIP_KEYS[whole % TIP_KEYS.length] as TipKey;
}

/** The tips a guest may see: the chat and library tips promise things the server refuses them. */
const GUEST_EXCLUDED: readonly TipKey[] = ["tips.chat", "tips.files"];

export function tipsFor(audience: "everyone" | "staff" | "managers" = "staff"): readonly TipKey[] {
  return audience === "everyone" ? TIP_KEYS.filter((k) => !GUEST_EXCLUDED.includes(k)) : TIP_KEYS;
}
