import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtShort } from "@/lib/format";
import { dayAnchor, formatDecimal, formatHM, parseDayKey } from "@/lib/time-tracking";

/**
 * «حساب وقت الشغل» on the screen, pure and provider-free (the Today card and the report render without a query client,
 * so these components read the dictionary directly, like «ذكّرني»).
 */

/** A string of the dictionary, with `{name}` placeholders filled. */
export function tt(key: string, vars?: Record<string, string | number>): string {
  return interpolate(AR[key] ?? key, vars);
}

/**
 * The dictionary key of what a failed request said: a refusal carries `message` (`tt.e.not_found`), a validation failure
 * carries the keys in `details[].message`. Anything the dictionary does not know is the general error.
 */
export function errorKeyOf(body: unknown, fallback = "tt.failed"): string {
  const b = (body ?? {}) as { message?: unknown; details?: unknown };
  const detail = Array.isArray(b.details) ? (b.details as { message?: unknown }[]).find((d) => typeof d?.message === "string" && d.message in AR) : undefined;
  if (detail) return detail.message as string;
  if (typeof b.message === "string" && b.message in AR) return b.message;
  return fallback;
}

/** «5 تشرين الثاني» for a company day key (`2026-11-05`), Western digits, no server or browser zone involved. */
export function dayLabel(key: string): string {
  const d = parseDayKey(key);
  return d ? fmtShort(new Date(d.year, d.month - 1, d.day, 12)) : key;
}

/** `hh:mm · 1.50`, the two readings together, for a row. */
export function bothText(seconds: number): string {
  return `${formatHM(seconds)} · ${formatDecimal(seconds)}`;
}

export { dayAnchor };
