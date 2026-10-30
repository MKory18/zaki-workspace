import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtShort } from "@/lib/format";
import { zonedParts, zonedStandIn } from "@/lib/zoned-time";

/**
 * «ذكّرني» on the screen, pure and provider-free (the chat's menu and the Today card render without a query client,
 * so these components read the dictionary directly, like the chat's `ct`).
 */

/** A string of the dictionary, with `{name}` placeholders filled. */
export function rt(key: string, vars?: Record<string, string | number>): string {
  return interpolate(AR[key] ?? key, vars);
}

const two = (n: number) => String(n).padStart(2, "0");

/** What a datetime-local box holds for this instant on the COMPANY's wall clock: `2026-11-05T09:30`. */
export function wallText(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** The time the box starts at: an hour from now, on the hour, in the company's zone. */
export function defaultWhenText(now: Date, timeZone: string): string {
  const later = new Date(now.getTime() + 60 * 60_000);
  return wallText(later, timeZone).replace(/:\d{2}$/, ":00");
}

/** «5 تشرين الثاني · 09:30», in the company's zone, Western digits. */
export function whenLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const p = zonedParts(d, timeZone);
  return `${fmtShort(zonedStandIn(d, timeZone))} · ${two(p.hour)}:${two(p.minute)}`;
}

/**
 * The dictionary key of what a failed request said: a refusal carries `message` (`reminder.not_found`), a validation
 * failure carries the keys in `details[].message`. Anything the dictionary does not know is the general error.
 */
export function errorKeyOf(body: unknown, fallback = "reminder.failed"): string {
  const b = (body ?? {}) as { message?: unknown; details?: unknown };
  const detail = Array.isArray(b.details) ? (b.details as { message?: unknown }[]).find((d) => typeof d?.message === "string" && d.message in AR) : undefined;
  if (detail) return detail.message as string;
  if (typeof b.message === "string" && b.message in AR) return b.message;
  return fallback;
}
