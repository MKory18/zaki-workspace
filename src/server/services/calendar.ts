import { monthWindow, type DateWindow } from "@/server/services/views";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";

/**
 * The calendar's data logic, taken out of the page so it can be tested with an injected `now`.
 *
 * The month, its window and "today" are the COMPANY's: `timeZone` is the organization's
 * `timezone` resolved with `resolveTimeZone` (a workspace view ctx carries it already). Without a
 * zone the page keeps its old behaviour (the machine's month, on a server UTC).
 */

/** "YYYY-MM" shifted by delta months (the string is validated before this runs). */
export function shiftMonth(ym: string, delta: number): string {
  const parts = ym.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export interface CalendarViewInput {
  /** The moment the page is opened at (injectable, so a test pins the day). */
  now: Date;
  /** The company's zone; absent = the machine's month, as the page behaved before. */
  timeZone?: string;
  /** A requested "YYYY-MM" (maybe invalid). */
  month?: string;
}

export interface CalendarViewData {
  /** The month the grid draws, "YYYY-MM". */
  month: string;
  /** The month's window (in the company's zone when one is given). */
  win: DateWindow;
  /** The company's today, "YYYY-MM-DD" (the machine's without a zone). */
  todayIso: string;
}

export function calendarView(input: CalendarViewInput): CalendarViewData {
  const valid = /^(\d{4})-(\d{2})$/.test(input.month ?? "");
  if (input.timeZone) {
    const zone = resolveTimeZone(input.timeZone);
    const p = zonedParts(input.now, zone);
    const month = valid
      ? input.month!
      : p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0");
    return {
      month,
      win: monthWindow(month, zone, input.now),
      // the company's today as "YYYY-MM-DD": the zone's calendar date, not a slice of the instant
      todayIso: p.year.toString().padStart(4, "0") + "-" + p.month.toString().padStart(2, "0") + "-" + p.day.toString().padStart(2, "0"),
    };
  }
  const month = valid ? input.month! : input.now.toISOString().slice(0, 7);
  return {
    month,
    win: monthWindow(month),
    todayIso: input.now.toISOString().slice(0, 10),
  };
}
