import { fmtDMY, fmtShort, weekdayLong } from "@/lib/format";
import { dayKeyOf, parseDayKey, timeOfDay } from "@/lib/owner-board";

/** "الخميس 29 تشرين الأول 2026" from the company's day key "2026-10-29". */
export function fmtDayKey(key: string): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const stand = new Date(p.year, p.month - 1, p.day, 12, 0, 0, 0);
  return `${weekdayLong(stand.getDay())} ${fmtDMY(stand)}`;
}

/** The company's wall clock «21:05» of an ISO instant, or «—». */
export function fmtClock(iso: string | null | undefined, timeZone: string): string {
  return iso ? timeOfDay(new Date(iso), timeZone) : "—";
}

/** An address with the board's filters carried along (a value left out or empty is dropped). */
export function boardHref(path: string, params: Record<string, string | null | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

/** "29 تشرين الأول" from a day key. */
export function fmtDayShort(key: string): string {
  const p = parseDayKey(key);
  return p ? fmtShort(new Date(p.year, p.month - 1, p.day, 12, 0, 0, 0)) : key;
}

/** The company's short day and clock of an ISO instant: "29 تشرين الأول 21:05", or «—». */
export function fmtMoment(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fmtDayShort(dayKeyOf(d, timeZone))} ${timeOfDay(d, timeZone)}`;
}

/** The company's day of an ISO instant, written out: used for a due day. */
export function fmtDueDay(iso: string, timeZone: string): string {
  return fmtDayKey(dayKeyOf(new Date(iso), timeZone));
}
