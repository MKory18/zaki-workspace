import { zonedParts, zonedWallTime, zonedDayNumber, nextZonedDayStart } from "@/lib/zoned-time";

/**
 * «ذكّرني» — the clock of a reminder, pure (no React, no server imports): the next time a repeating reminder
 * fires, the snooze presets, and how a typed date-time is read.
 *
 * Every rule here is in the COMPANY's zone (`Organization.timezone`, never the server's and never the browser's),
 * with LOCAL-TIME semantics: a daily reminder set for 09:00 stays at 09:00 on the wall clock when the clocks change
 * (the instant moves, the hour a person reads does not). A month is a calendar month: the 31st of the first month repeats on
 * the last day of the second, and a day that does not exist in a month becomes that month's last day.
 *
 * ⚠️ A time that does not exist on the wall clock (02:30 when the clocks jump) is read as the moment just after the gap,
 * and the reminder continues from that. 🔧 Rare; the anchor below would fix both.
 * ⚠️ A monthly reminder keeps no memory of the day it was first set for: after a short month it continues from the
 * day it landed on (the 31st → the 28th → the 28th). 🔧 Say so on the screen, or store the anchor day later.
 */

export const REPEATS = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type Repeat = (typeof REPEATS)[number];

/** «بكرا الصبح»: the hour (company time) a morning snooze wakes the reminder. */
export const MORNING_HOUR = 9;

/** Seconds, milliseconds and the rest of a minute never count: a reminder is due «at 09:30». */
const MINUTE_MS = 60_000;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** `k` calendar days after the zone's date of `from`, at the same wall-clock time. */
function plusDays(from: Date, k: number, timeZone: string): Date {
  const p = zonedParts(from, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day + k, hour: p.hour, minute: p.minute }, timeZone);
}

/** `k` calendar months after the zone's date of `from`, at the same wall-clock time; a missing day is the month's last. */
function plusMonths(from: Date, k: number, timeZone: string): Date {
  const p = zonedParts(from, timeZone);
  const index = p.year * 12 + (p.month - 1) + k;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return zonedWallTime({ year, month, day, hour: p.hour, minute: p.minute }, timeZone);
}

/**
 * The next time a repeating reminder is due: the first occurrence STRICTLY AFTER `now` (a runner that was down for three
 * days fires once and moves on, it never replays what it missed). `NONE` has no next time: null.
 */
export function nextOccurrence(dueAt: Date, repeat: Repeat, timeZone: string, now: Date): Date | null {
  if (repeat === "NONE") return null;
  if (repeat === "MONTHLY") {
    // a month is at least 28 days: start near where `now` is, never before the first step
    const gapDays = Math.max(0, zonedDayNumber(now, timeZone) - zonedDayNumber(dueAt, timeZone));
    for (let k = Math.max(1, Math.floor(gapDays / 31)); k < 100_000; k++) {
      const candidate = plusMonths(dueAt, k, timeZone);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
    return null;
  }
  const step = repeat === "DAILY" ? 1 : 7;
  const gapDays = Math.max(0, zonedDayNumber(now, timeZone) - zonedDayNumber(dueAt, timeZone));
  // every step before this one falls on an EARLIER calendar day than `now`, so it is in the past: skip them
  for (let n = Math.max(1, Math.floor(gapDays / step) - 1); n < 400_000; n++) {
    const candidate = plusDays(dueAt, n * step, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

/** The two snooze buttons. */
export const SNOOZE_PRESETS = ["HOUR", "TOMORROW_MORNING"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

/** When a snoozed reminder is due again: an hour from now, or tomorrow at 09:00 in the company's zone. */
export function snoozeUntil(preset: SnoozePreset, now: Date, timeZone: string): Date {
  if (preset === "HOUR") return new Date(now.getTime() + 60 * MINUTE_MS);
  const tomorrow = nextZonedDayStart(now, timeZone);
  const p = zonedParts(tomorrow, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: MORNING_HOUR, minute: 0 }, timeZone);
}

/**
 * A typed date-time as an instant. Two shapes:
 *  - `2026-11-05T09:30` (what a `datetime-local` box sends): the COMPANY's wall clock, never the browser's;
 *  - a full ISO instant with an offset or `Z`: taken as it is.
 * Anything else is null.
 */
export function parseDueInput(text: string, timeZone: string): Date | null {
  const value = text.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (local) {
    const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((i) => Number(local[i]));
    if (month! < 1 || month! > 12 || day! < 1 || day! > daysInMonth(year!, month!) || hour! > 23 || minute! > 59) return null;
    return zonedWallTime({ year: year!, month: month!, day: day!, hour: hour!, minute: minute! }, timeZone);
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// «مهمة متكررة» — the rule of a repeating TASK, on the same clock (the company's zone, wall-clock time, month ends).
//
// A reminder repeats from the instant it last fired; a task series repeats from a RULE that stands on its own, so a
// weekday set, the 31st and a leap day never drift (a monthly «31» is the 28th in February and the 31st again in March;
// a yearly «29 شباط» is the 28th in a common year and the 29th again in the next leap year).
// ---------------------------------------------------------------------------------------------------------------------

export type RecurrenceRule =
  | { kind: "DAILY"; time: string }
  | { kind: "WEEKLY"; /** 0 is the first day of the week of the JavaScript Date, 6 the last (the screen lays them out from the weekend) */ days: number[]; time: string }
  | { kind: "MONTHLY"; /** 1..31; a month without that day uses its last day */ day: number; time: string }
  | { kind: "YEARLY"; month: number; day: number; time: string };

/** `HH:mm` → hour and minute (a malformed time is noon, the hour a plain due date has). */
function clockOf(time: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const hour = m ? Number(m[1]) : 12;
  const minute = m ? Number(m[2]) : 0;
  return hour > 23 || minute > 59 ? { hour: 12, minute: 0 } : { hour, minute };
}

/** Does the calendar day `y-m-d` (weekday `wd`) belong to the rule? */
function dayMatches(rule: RecurrenceRule, y: number, m: number, d: number, wd: number): boolean {
  switch (rule.kind) {
    case "DAILY":
      return true;
    case "WEEKLY":
      return rule.days.includes(wd);
    case "MONTHLY":
      return d === Math.min(rule.day, daysInMonth(y, m));
    case "YEARLY":
      return m === rule.month && d === Math.min(rule.day, daysInMonth(y, m));
  }
}

/** The rule's instant on the calendar day that is `k` days from the zone's date of `from`, or null when the day is not one. */
function ruleInstantOn(rule: RecurrenceRule, from: Date, k: number, timeZone: string): Date | null {
  const p = zonedParts(from, timeZone);
  const u = new Date(Date.UTC(p.year, p.month - 1, p.day + k));
  const [y, m, d] = [u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()];
  if (!dayMatches(rule, y, m, d, u.getUTCDay())) return null;
  const { hour, minute } = clockOf(rule.time);
  return zonedWallTime({ year: y, month: m, day: d, hour, minute }, timeZone);
}

/** Far enough for every rule: a yearly one is at most 366 days away. */
const RULE_HORIZON_DAYS = 800;

/** The first occurrence of the rule STRICTLY AFTER `after`, at the rule's wall-clock time in the company's zone. */
export function ruleOccurrenceAfter(rule: RecurrenceRule, timeZone: string, after: Date): Date | null {
  for (let k = 0; k < RULE_HORIZON_DAYS; k++) {
    const at = ruleInstantOn(rule, after, k, timeZone);
    if (at && at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** The last occurrence of the rule AT OR BEFORE `until` (what a runner that was down catches up to: one, never all). */
export function ruleOccurrenceAtOrBefore(rule: RecurrenceRule, timeZone: string, until: Date): Date | null {
  for (let k = 0; k > -RULE_HORIZON_DAYS; k--) {
    const at = ruleInstantOn(rule, until, k, timeZone);
    if (at && at.getTime() <= until.getTime()) return at;
  }
  return null;
}
