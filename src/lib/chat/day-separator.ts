import { dayDiff, fmtLongDate } from "@/lib/format";
import { AR } from "@/lib/i18n/dict";

/**
 * THE DAY SEPARATOR of a message log (the owner, 2026-10-29: «نظام دردشة نفس التطبيقات الحديثة»): one
 * quiet line that says which day the messages under it belong to — «اليوم», «أمس», or the long date —
 * so a long thread reads as days and not as one wall.
 *
 * It is pure: the caller walks the messages in order and asks which of them opens a new day.
 */
export function dayLabelOf(at: string | Date, now: Date = new Date()): string {
  const diff = dayDiff(at, now);
  if (diff === 0) return AR["time.today"] ?? "";
  if (diff === -1) return AR["time.yesterday"] ?? "";
  return fmtLongDate(at);
}

/** True when this message opens a new day in the log (the first one always does). */
export function opensDay(current: string | Date, previous: string | Date | null): boolean {
  if (!previous) return true;
  const a = new Date(current);
  const b = new Date(previous);
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
}
