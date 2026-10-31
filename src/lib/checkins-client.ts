import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtLongDate, weekdayLong } from "@/lib/format";

/**
 * «التسجيل اليومي» on the screen, pure and provider-free (the Today card renders without a query client, so these
 * components read the dictionary directly, like `rt` of the reminders).
 */

/** A string of the dictionary, with `{name}` placeholders filled. */
export function ck(key: string, vars?: Record<string, string | number>): string {
  return interpolate(AR[key] ?? key, vars);
}

/**
 * The dictionary key of what a failed request said: a refusal carries `message` (`checkins.e.closed`), a validation failure
 * carries the keys in `details[].message`. Anything the dictionary does not know is the general error.
 */
export function errorKeyOf(body: unknown, fallback = "checkins.e.failed"): string {
  const b = (body ?? {}) as { message?: unknown; details?: unknown };
  const detail = Array.isArray(b.details) ? (b.details as { message?: unknown }[]).find((d) => typeof d?.message === "string" && d.message in AR) : undefined;
  if (detail) return detail.message as string;
  if (typeof b.message === "string" && b.message in AR) return b.message;
  return fallback;
}

/** «الخميس 5 تشرين الثاني 2026» for a company day `YYYY-MM-DD` (noon, so no clock change moves it). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return fmtLongDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0));
}

/** «الأحد، الاثنين، …» for the week days a check-in runs on. */
export function weekdaysLabel(days: readonly number[]): string {
  return [...days].sort((a, b) => a - b).map(weekdayLong).join("، ");
}
