import { z } from "zod";
import { zonedParts, zonedWallTime, nextZonedDayStart } from "@/lib/zoned-time";
import { dayOfInstant, parseDayText } from "@/lib/due-day";
import { NOON_HOUR } from "@/lib/today";
import type { RecurrenceRule } from "@/lib/reminders/recurrence";

/**
 * «مهمة متكررة» — the shapes of a repeating task, pure (no React, no server imports): the rule and how a person's
 * pick becomes one, the two modes, the day a series ends, and why an automatic stop happened.
 *
 * The math lives next to the reminders' (src/lib/reminders/recurrence.ts: `ruleOccurrenceAfter`): one clock for the
 * whole app, in the COMPANY's zone.
 */

export type { RecurrenceRule } from "@/lib/reminders/recurrence";

export const RECURRENCE_KINDS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

/** «عند الإنجاز» (the next one is made when the current one is finished) or «حسب الجدول» (the runner makes it on its day). */
export const RECURRENCE_MODES = ["ON_COMPLETE", "SCHEDULE"] as const;
export type RecurrenceModeKey = (typeof RECURRENCE_MODES)[number];

/** Why a series stopped on its own (a person's own stop has no reason). Each has a line in the dictionary. */
export const STOP_REASONS = ["ENDED", "ARCHIVED", "CREATOR_INACTIVE", "FAILED"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "recurrence.rule_invalid");
const weekday = z.number().int().min(0).max(6);

/** The STORED rule: every field present, so the math never has to guess (`completeRule` fills the gaps of a pick). */
export const ruleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DAILY"), time }).strict(),
  z
    .object({
      kind: z.literal("WEEKLY"),
      days: z.array(weekday).min(1, "recurrence.days_required").max(7).transform((days) => [...new Set(days)].sort((a, b) => a - b)),
      time,
    })
    .strict(),
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31), time }).strict(),
  z.object({ kind: z.literal("YEARLY"), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31), time }).strict(),
]);

/** What a client sends: only the pick (the time, the month and the day are taken from the task's own due date). */
export const ruleInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DAILY") }).strict(),
  z.object({ kind: z.literal("WEEKLY"), days: z.array(weekday).min(1, "recurrence.days_required").max(7) }).strict(),
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31).optional() }).strict(),
  z.object({ kind: z.literal("YEARLY") }).strict(),
]);
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** A stored rule read back from the database; null when it no longer parses (the runner then stops the series). */
export function parseStoredRule(value: unknown): RecurrenceRule | null {
  const parsed = ruleSchema.safeParse(value);
  return parsed.success ? (parsed.data as RecurrenceRule) : null;
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The stored rule for a person's pick. `anchor` is the task's due date (or, without one, noon of today): it gives the
 * hour of the day, and the day of the month / the date of the year when the pick did not name them. A due date is a
 * plain day stored as noon of the company's zone, so a series made from day-dates repeats at noon.
 */
export function completeRule(input: RuleInput, anchor: Date, timeZone: string): RecurrenceRule {
  const p = zonedParts(anchor, timeZone);
  const at = `${two(p.hour)}:${two(p.minute)}`;
  switch (input.kind) {
    case "DAILY":
      return { kind: "DAILY", time: at };
    case "WEEKLY":
      return { kind: "WEEKLY", days: [...new Set(input.days)].sort((a, b) => a - b), time: at };
    case "MONTHLY":
      return { kind: "MONTHLY", day: input.day ?? p.day, time: at };
    case "YEARLY":
      return { kind: "YEARLY", month: p.month, day: p.day, time: at };
  }
}

/** A rule back to what the form shows (the pick without the derived time). */
export function ruleToInput(rule: RecurrenceRule): RuleInput {
  switch (rule.kind) {
    case "DAILY":
      return { kind: "DAILY" };
    case "WEEKLY":
      return { kind: "WEEKLY", days: [...rule.days] };
    case "MONTHLY":
      return { kind: "MONTHLY", day: rule.day };
    case "YEARLY":
      return { kind: "YEARLY" };
  }
}

/** Noon of the zone's today: the anchor of a task with no due date. */
export function noonOfToday(now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: NOON_HOUR, minute: 0 }, timeZone);
}

/**
 * The last instant of the chosen day in the company's zone: a series ends on that DAY, so an occurrence on it still
 * happens. `YYYY-MM-DD` in, an instant out; null for text that is not a real date.
 */
export function endOfDayInstant(day: string, timeZone: string): Date | null {
  const p = parseDayText(day);
  if (!p) return null;
  const start = zonedWallTime({ ...p, hour: 0, minute: 0 }, timeZone);
  // `zonedWallTime` rolls a day that does not exist (31 February) into the next month: refuse it
  if (zonedParts(start, timeZone).day !== p.day) return null;
  return new Date(nextZonedDayStart(start, timeZone).getTime() - 1);
}

/** The day (`YYYY-MM-DD`, company zone) a stored `endsAt` belongs to. */
export function endDayOf(endsAt: Date | string | null, timeZone: string): string | null {
  return endsAt ? dayOfInstant(endsAt, timeZone) : null;
}
