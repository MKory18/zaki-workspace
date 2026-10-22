/**
 * THE COMPANY'S CLOCK.
 *
 * "Today", "overdue" and "tomorrow" are the company's days, not the server's: a task due at 23:30 in Damascus is
 * due today there, whatever the container's own clock says (a server is usually on UTC, three hours behind).
 * The zone is `Organization.timezone`, an IANA name that defaults to Asia/Damascus.
 *
 * Pure, with no library: the platform already carries the whole time-zone database (Node 22 ships with all of it
 * and so does every browser), and answers through the DateTimeFormat of the Intl object.
 *
 * ⚠️ This is the one file that asks the platform for zone data, and it only ever READS NUMBERS from it (year,
 * month, day, hour ...). It never writes a word for a person: every date a screen shows still goes through
 * lib/format.ts, in Arabic and with Western digits.
 *
/**
 * 🔧 tests/arabic-ui.test.ts no longer names this file: it uses `Intl` normally now, and the test has an
 * exemption beside the one for lib/format.ts (a clock reading is not a formatted date).
 *
 * 🔧 To print a date or a relative day in the company's zone, give lib/format.ts a stand-in date
 * (`zonedStandIn`): a date whose year, month and day, read the way the formatters read them, are the zone's.
 */

/** The zone a company has when its row names none, or names one this platform does not know. It is the schema's default. */
export const DEFAULT_TIME_ZONE = "Asia/Damascus";

interface PartsFormatter {
  formatToParts(date: Date): Array<{ type: string; value: string }>;
}

const formatters = new Map<string, PartsFormatter>();

/** One formatter per zone, kept (building one costs far more than using it). Throws a RangeError for a name that is not a zone. */
function formatterFor(timeZone: string): PartsFormatter {
  let found = formatters.get(timeZone);
  if (!found) {
    // "en-US" only so that the parts come out as plain Western digits to read back as numbers; nothing is shown
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    // a company has one zone, so this never grows; the cap is for the day somebody writes a thousand different ones
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timeZone, found);
  }
  return found;
}

/** Is this the name of a time zone this platform knows? */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** The zone to count days in: the one the company's row names, or the company default when it names none or a wrong one. Never throws. */
export function resolveTimeZone(value: string | null | undefined): string {
  if (isValidTimeZone(value)) return value;
  return isValidTimeZone(DEFAULT_TIME_ZONE) ? DEFAULT_TIME_ZONE : "UTC";
}

export interface ZonedParts {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  /** 0 to 23: midnight is 0, never 24 */
  hour: number;
  minute: number;
  second: number;
  /** 0 is the first day of the week (الأحد), as `Date#getDay` counts */
  weekday: number;
}

const DAY_MS = 86_400_000;

/** The wall clock of a zone at an instant (the milliseconds are dropped). */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const read = new Map<string, number>();
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") read.set(part.type, Number(part.value));
  }
  const need = (type: string): number => {
    const value = read.get(type);
    if (value === undefined || Number.isNaN(value)) throw new RangeError(`no ${type} for ${timeZone}`);
    return value;
  };
  const year = need("year");
  const month = need("month");
  const day = need("day");
  return {
    year,
    month,
    day,
    hour: need("hour") % 24,
    minute: need("minute"),
    second: need("second"),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function offsetMsAt(ms: number, timeZone: string): number {
  const p = zonedParts(new Date(ms), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which a zone's wall clock reads the given time, written as if it were UTC (`wallAsUtcMs`).
 * Around a change of the clocks there are two odd cases: a time that happens twice gives its first reading, and
 * a time that never happens (the clocks jumped over it) gives the moment just after the gap.
 */
function wallToInstantMs(wallAsUtcMs: number, timeZone: string): number {
  const first = offsetMsAt(wallAsUtcMs, timeZone);
  let instant = wallAsUtcMs - first;
  const second = offsetMsAt(instant, timeZone);
  if (second === first) return instant;
  instant -= second - first;
  const third = offsetMsAt(instant, timeZone);
  if (third === second) return instant;
  return wallAsUtcMs - Math.min(second, third);
}

export interface WallTime {
  year: number;
  /** 1 to 12 */
  month: number;
  /** may run past the end of the month: `day + 1` is tomorrow */
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** The instant at which this zone's wall clock reads the given time. */
export function zonedWallTime(wall: WallTime, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0);
  return new Date(wallToInstantMs(asUtc, timeZone));
}

/** The instant the zone's calendar day containing `instant` began (its midnight; a day with no midnight begins just after the gap). */
export function zonedDayStart(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** The instant the NEXT calendar day of the zone begins: the end of this one, exclusive. */
export function nextZonedDayStart(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day + 1 }, timeZone);
}

/** The zone's calendar days counted from a fixed origin, so that the difference of two is whole days. */
export function zonedDayNumber(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/**
 * A date whose year, month and day, read the way lib/format.ts reads them (in the process's own time), are the
 * zone's calendar date at `instant`. Noon, so that no change of the clocks can move it to another day. Give it to
 * `fmtLongDate` or `fmtRelative` (twice, for the day and for "now") to say a day in the company's zone.
 */
export function zonedStandIn(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return new Date(p.year, p.month - 1, p.day, 12, 0, 0, 0);
}
