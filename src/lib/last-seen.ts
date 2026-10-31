/**
 * «آخر ظهور» — the words under a person's name when they are not at their screen, like a messenger.
 *
 * Pure (no React, no server): the screens hand it the instant the server recorded, and "now". Days are the COMPANY's
 * days (`Organization.timezone`, src/lib/zoned-time.ts), so «اليوم» and «أمس» change at the company's midnight and not
 * at the server's or the phone's. Every phrase is a dictionary entry (`lastSeen.*`), every number is plural-formed with
 * `arabicPlural`, and every date and time is written with Arabic names and Western digits.
 *
 *   online                      →  متصل الآن
 *   under an hour               →  آخر ظهور قبل دقيقة / دقيقتين / 3 دقايق / 11 دقيقة
 *   under six hours             →  آخر ظهور قبل ساعة / ساعتين / 3 ساعات
 *   the same day of the company →  آخر ظهور اليوم 3:40 م
 *   the day before              →  آخر ظهور أمس 3:40 م
 *   within the last six days    →  آخر ظهور الجمعة
 *   older                       →  آخر ظهور 12 تشرين الأول (the year too when it is not this year's)
 *   nothing recorded or hidden  →  غير معروف
 */
import { AR } from "./i18n/dict";
import { interpolate } from "./i18n/interpolate";
import { arabicPlural, monthName, weekdayLong } from "./format";
import { resolveTimeZone, zonedDayNumber, zonedParts } from "./zoned-time";

const word = (key: string, vars?: Record<string, string | number>): string => interpolate(AR[key] ?? key, vars);

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Up to here a moment is said as «قبل N ساعات»; after it, as a clock reading of a day. */
const HOURS_AS_AGO = 6;
/** Up to here (days back) a day is named by its weekday; after it, by its date. */
const WEEKDAY_DAYS = 6;

/** A moment as an instant, or null for nothing / something that is not a date. */
function instantOf(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «3:40 م»: 12-hour clock with ص / م, Western digits, no leading zero on the hour. */
function clockOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const m = p.minute < 10 ? `0${p.minute}` : String(p.minute);
  return word(p.hour < 12 ? "lastSeen.time.am" : "lastSeen.time.pm", { h: h12, m });
}

export interface LastSeenInput {
  /** At their screen right now: the answer is «متصل الآن» whatever the time says. */
  online?: boolean;
  /** The recorded time: an ISO string or a date. null / empty / unparsable is «غير معروف». */
  lastSeenAt?: Date | string | number | null;
  /** "now"; the device's own clock when absent. */
  now?: Date;
  /** The company's IANA zone; a missing or unknown name falls back to the company default. */
  timeZone?: string | null;
}

/** The phrase for a person's last seen (never empty). */
export function lastSeenText(input: LastSeenInput): string {
  if (input.online) return word("lastSeen.online");
  const at = instantOf(input.lastSeenAt);
  if (!at) return word("lastSeen.unknown");
  const now = input.now ?? new Date();
  const zone = resolveTimeZone(input.timeZone);

  // a clock that runs ahead of the server is «just now», never a negative time
  const elapsed = Math.max(0, now.getTime() - at.getTime());
  if (elapsed < HOUR_MS) {
    const n = Math.max(1, Math.floor(elapsed / MINUTE_MS));
    return word(`lastSeen.minute.${arabicPlural(n)}`, { n });
  }
  if (elapsed < HOURS_AS_AGO * HOUR_MS) {
    const n = Math.floor(elapsed / HOUR_MS);
    return word(`lastSeen.hour.${arabicPlural(n)}`, { n });
  }

  const daysBack = zonedDayNumber(now, zone) - zonedDayNumber(at, zone);
  if (daysBack <= 0) return word("lastSeen.today", { time: clockOf(at, zone) });
  if (daysBack === 1) return word("lastSeen.yesterday", { time: clockOf(at, zone) });
  const p = zonedParts(at, zone);
  if (daysBack <= WEEKDAY_DAYS) return word("lastSeen.weekday", { day: weekdayLong(p.weekday) });
  const sameYear = zonedParts(now, zone).year === p.year;
  const date = `${p.day} ${monthName(p.month - 1)}${sameYear ? "" : ` ${p.year}`}`;
  return word("lastSeen.date", { date });
}

/**
 * The text a row shows, or null when the row must say what it said before this feature: the server leaves
 * `lastSeenAt` out entirely (the company's switch is off, or this answer comes from an older server), so the caller keeps
 * its own «غير متصل». `null` is a real answer («غير معروف»: nothing recorded, or hidden).
 */
export function lastSeenLabel(row: { online: boolean; lastSeenAt?: string | null }, opts: { now?: Date; timeZone?: string | null } = {}): string | null {
  if (row.lastSeenAt === undefined) return null;
  return lastSeenText({ online: row.online, lastSeenAt: row.lastSeenAt, ...opts });
}
