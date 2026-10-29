import { NOON_HOUR } from "@/lib/today";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * The day a task is DUE, as a person picked it: `YYYY-MM-DD` in the COMPANY's zone, never the browser's.
 *
 * A due date is stored as the instant of noon (company time) on the day chosen — noon so that no change of
 * the clocks can move it to another day (`zonedStandIn` says the same thing on the reading side). The
 * browser used to build that instant itself (`new Date("2026-11-05T12:00:00")`), which meant a person
 * working from another country — or a phone whose clock was set elsewhere — saved a day the company does
 * not live in, and the card showed yesterday or tomorrow (review B5).
 */

/** `YYYY-MM-DD` → `{ year, month, day }`, or null when the text is not a plain date (two digits, a real month and day). */
export function parseDayText(day: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayNumber = Number(m[3]);
  if (month < 1 || month > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return { year, month, day: dayNumber };
}

/** The instant of noon (company time) on the day `day` — what the API stores. Null when the text is not a date. */
export function dueInstantForDay(day: string, timeZone: string): Date | null {
  const p = parseDayText(day);
  return p ? zonedWallTime({ ...p, hour: NOON_HOUR }, timeZone) : null;
}

/** The day (`YYYY-MM-DD`, company time) a stored due instant belongs to. */
export function dayOfInstant(instant: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(instant), timeZone);
  return `${p.year.toString().padStart(4, "0")}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

/** The stored dueDate the screens are given: the day, plus noon in the company's zone for the wording (`fmtRelative`). */
export interface DueDay {
  /** `YYYY-MM-DD` in the company's zone — what the date box shows and sends back. */
  day: string;
  /** The instant to write that day: noon in the company's zone. */
  noon: Date;
}

/** A stored due instant (or null) as the screens need it. */
export function dueDayOf(instant: Date | string | null | undefined, timeZone: string): DueDay | null {
  if (instant == null) return null;
  const day = dayOfInstant(instant, timeZone);
  const noon = dueInstantForDay(day, timeZone);
  return noon ? { day, noon } : null;
}
