import { describe, expect, it } from "vitest";
import { parseDueInput, ruleOccurrenceAfter, ruleOccurrenceAtOrBefore, type RecurrenceRule } from "@/lib/reminders/recurrence";
import { completeRule, endDayOf, endOfDayInstant, noonOfToday, parseStoredRule, ruleInputSchema, ruleSchema, ruleToInput } from "@/lib/task-recurrence";
import { zonedParts } from "@/lib/zoned-time";

/**
 * «مهمة متكررة» — the rule's clock, pure. Berlin changes its clocks (the proof that a rule is the WALL CLOCK of the
 * company's zone and not "add 24 hours"); Damascus has no change but is the company's default zone.
 */

const DAM = "Asia/Damascus";
const BER = "Europe/Berlin";

const two = (n: number) => String(n).padStart(2, "0");
function wall(d: Date | null, zone: string): string {
  if (!d) return "null";
  const p = zonedParts(d, zone);
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}
const at = (text: string, zone: string): Date => {
  const d = parseDueInput(text, zone);
  if (!d) throw new Error(`bad test date ${text}`);
  return d;
};
/** The first `n` occurrences after `from`, as wall-clock text. */
function series(rule: RecurrenceRule, zone: string, from: Date, n: number): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i < n; i++) {
    const next = ruleOccurrenceAfter(rule, zone, cursor);
    if (!next) break;
    out.push(wall(next, zone));
    cursor = next;
  }
  return out;
}

describe("daily", () => {
  it("every day at the rule's wall-clock time, across Berlin's spring change (the UTC hour moves, the 09:00 does not)", () => {
    const rule: RecurrenceRule = { kind: "DAILY", time: "09:00" };
    const from = at("2027-03-26T10:00", BER);
    expect(series(rule, BER, from, 4)).toEqual(["2027-03-27 09:00", "2027-03-28 09:00", "2027-03-29 09:00", "2027-03-30 09:00"]);
    expect(ruleOccurrenceAfter(rule, BER, at("2027-03-27T09:00", BER))?.toISOString()).toBe("2027-03-28T07:00:00.000Z"); // 09:00 CEST
    expect(at("2027-03-27T09:00", BER).toISOString()).toBe("2027-03-27T08:00:00.000Z"); // 09:00 CET the day before
  });

  it("is strictly after: the very instant of an occurrence is not its own next one", () => {
    const rule: RecurrenceRule = { kind: "DAILY", time: "12:00" };
    const noon = at("2031-03-10T12:00", DAM);
    expect(wall(ruleOccurrenceAfter(rule, DAM, noon), DAM)).toBe("2031-03-11 12:00");
    expect(wall(ruleOccurrenceAfter(rule, DAM, new Date(noon.getTime() - 1)), DAM)).toBe("2031-03-10 12:00");
  });
});

describe("weekly on chosen weekdays", () => {
  // 2031-03-10 is a Monday
  it("walks the chosen days in order, and a week later starts over", () => {
    const rule: RecurrenceRule = { kind: "WEEKLY", days: [0, 2, 4], time: "12:00" }; // Sun, Tue, Thu
    expect(series(rule, DAM, at("2031-03-10T12:00", DAM), 5)).toEqual([
      "2031-03-11 12:00", // Tue
      "2031-03-13 12:00", // Thu
      "2031-03-16 12:00", // Sun
      "2031-03-18 12:00",
      "2031-03-20 12:00",
    ]);
  });

  it("one weekday is every seven days; the same weekday later today still counts", () => {
    const rule: RecurrenceRule = { kind: "WEEKLY", days: [1], time: "18:00" }; // Monday evening
    expect(wall(ruleOccurrenceAfter(rule, DAM, at("2031-03-10T09:00", DAM)), DAM)).toBe("2031-03-10 18:00");
    expect(wall(ruleOccurrenceAfter(rule, DAM, at("2031-03-10T18:00", DAM)), DAM)).toBe("2031-03-17 18:00");
  });

  it("keeps the wall clock across both of Berlin's changes (spring 2027-03-28, autumn 2027-10-31)", () => {
    const rule: RecurrenceRule = { kind: "WEEKLY", days: [6, 0], time: "09:00" }; // Sat, Sun
    expect(series(rule, BER, at("2027-03-26T12:00", BER), 3)).toEqual(["2027-03-27 09:00", "2027-03-28 09:00", "2027-04-03 09:00"]);
    expect(series(rule, BER, at("2027-10-29T12:00", BER), 3)).toEqual(["2027-10-30 09:00", "2027-10-31 09:00", "2027-11-06 09:00"]);
    // the UTC instant of the same 09:00 moves by an hour over the change
    const sat = ruleOccurrenceAfter(rule, BER, at("2027-10-29T12:00", BER))!;
    const sun = ruleOccurrenceAfter(rule, BER, sat)!;
    expect(sat.toISOString()).toBe("2027-10-30T07:00:00.000Z");
    expect(sun.toISOString()).toBe("2027-10-31T08:00:00.000Z");
  });

  it("a time that does not exist (02:30 when the clocks jump) lands just after the gap, on the same day", () => {
    const rule: RecurrenceRule = { kind: "DAILY", time: "02:30" };
    const next = ruleOccurrenceAfter(rule, BER, at("2027-03-27T12:00", BER));
    expect(zonedParts(next!, BER).day).toBe(28);
  });
});

describe("monthly on a day of the month (31 is the month's last day)", () => {
  it("the 31st: 31 January, then 28 February (the last day), then 31 March: it never drifts to the 28th for good", () => {
    const rule: RecurrenceRule = { kind: "MONTHLY", day: 31, time: "12:00" };
    expect(series(rule, DAM, at("2027-01-01T12:00", DAM), 5)).toEqual(["2027-01-31 12:00", "2027-02-28 12:00", "2027-03-31 12:00", "2027-04-30 12:00", "2027-05-31 12:00"]);
  });

  it("a leap February has a 29th", () => {
    const rule: RecurrenceRule = { kind: "MONTHLY", day: 31, time: "12:00" };
    expect(series(rule, DAM, at("2028-01-31T12:00", DAM), 2)).toEqual(["2028-02-29 12:00", "2028-03-31 12:00"]);
  });

  it("the 15th is the 15th; Berlin keeps 09:00 across the change", () => {
    const rule: RecurrenceRule = { kind: "MONTHLY", day: 15, time: "09:00" };
    expect(series(rule, BER, at("2027-02-20T12:00", BER), 3)).toEqual(["2027-03-15 09:00", "2027-04-15 09:00", "2027-05-15 09:00"]);
    expect(ruleOccurrenceAfter(rule, BER, at("2027-02-20T12:00", BER))?.toISOString()).toBe("2027-03-15T08:00:00.000Z");
    expect(ruleOccurrenceAfter(rule, BER, at("2027-03-20T12:00", BER))?.toISOString()).toBe("2027-04-15T07:00:00.000Z");
  });

  it("the 30th in a year across a December", () => {
    const rule: RecurrenceRule = { kind: "MONTHLY", day: 30, time: "12:00" };
    expect(series(rule, DAM, at("2027-11-30T12:00", DAM), 3)).toEqual(["2027-12-30 12:00", "2028-01-30 12:00", "2028-02-29 12:00"]);
  });
});

describe("yearly", () => {
  it("the same date every year", () => {
    const rule: RecurrenceRule = { kind: "YEARLY", month: 3, day: 10, time: "12:00" };
    expect(series(rule, DAM, at("2031-03-10T12:00", DAM), 3)).toEqual(["2032-03-10 12:00", "2033-03-10 12:00", "2034-03-10 12:00"]);
  });

  it("29 February: the 28th in a common year, the 29th again in the next leap year (no drift)", () => {
    const rule: RecurrenceRule = { kind: "YEARLY", month: 2, day: 29, time: "12:00" };
    expect(series(rule, DAM, at("2027-01-01T12:00", DAM), 4)).toEqual(["2027-02-28 12:00", "2028-02-29 12:00", "2029-02-28 12:00", "2030-02-28 12:00"]);
    expect(series(rule, BER, at("2027-01-01T12:00", BER), 2)).toEqual(["2027-02-28 12:00", "2028-02-29 12:00"]);
  });

  it("a yearly date in a zone that changes clocks keeps its wall hour", () => {
    const rule: RecurrenceRule = { kind: "YEARLY", month: 7, day: 1, time: "09:00" };
    expect(ruleOccurrenceAfter(rule, BER, at("2027-02-01T12:00", BER))?.toISOString()).toBe("2027-07-01T07:00:00.000Z");
  });
});

describe("catching up: the last occurrence at or before a moment", () => {
  it("is the latest one that has already happened, never one in the future", () => {
    const rule: RecurrenceRule = { kind: "WEEKLY", days: [1, 4], time: "12:00" }; // Mon, Thu
    const now = at("2031-03-14T09:00", DAM); // Friday morning
    expect(wall(ruleOccurrenceAtOrBefore(rule, DAM, now), DAM)).toBe("2031-03-13 12:00");
    expect(wall(ruleOccurrenceAtOrBefore(rule, DAM, at("2031-03-13T12:00", DAM)), DAM)).toBe("2031-03-13 12:00");
    expect(wall(ruleOccurrenceAtOrBefore(rule, DAM, at("2031-03-13T11:59", DAM)), DAM)).toBe("2031-03-10 12:00");
  });

  it("is consistent with `after`: the occurrence after it is in the future", () => {
    const rule: RecurrenceRule = { kind: "MONTHLY", day: 31, time: "12:00" };
    const now = at("2027-03-05T10:00", DAM);
    const last = ruleOccurrenceAtOrBefore(rule, DAM, now)!;
    expect(wall(last, DAM)).toBe("2027-02-28 12:00");
    expect(wall(ruleOccurrenceAfter(rule, DAM, now), DAM)).toBe("2027-03-31 12:00");
  });
});

describe("the rule's shape (zod)", () => {
  it("a stored rule has every field; weekdays are de-duplicated and sorted", () => {
    expect(ruleSchema.parse({ kind: "WEEKLY", days: [4, 0, 4, 2], time: "09:30" })).toEqual({ kind: "WEEKLY", days: [0, 2, 4], time: "09:30" });
    expect(ruleSchema.parse({ kind: "YEARLY", month: 2, day: 29, time: "12:00" })).toEqual({ kind: "YEARLY", month: 2, day: 29, time: "12:00" });
  });

  it("refuses an unknown kind, an empty or out-of-range weekday set, a bad day, a bad time and extra keys", () => {
    for (const bad of [
      { kind: "HOURLY", time: "12:00" },
      { kind: "WEEKLY", days: [], time: "12:00" },
      { kind: "WEEKLY", days: [7], time: "12:00" },
      { kind: "WEEKLY", days: [-1], time: "12:00" },
      { kind: "MONTHLY", day: 0, time: "12:00" },
      { kind: "MONTHLY", day: 32, time: "12:00" },
      { kind: "YEARLY", month: 13, day: 1, time: "12:00" },
      { kind: "DAILY", time: "25:00" },
      { kind: "DAILY", time: "9:00" },
      { kind: "DAILY", time: "12:00", every: 2 },
      { kind: "DAILY" },
      "DAILY",
      null,
    ]) {
      expect(ruleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(parseStoredRule({ nonsense: true })).toBeNull();
    expect(parseStoredRule({ kind: "DAILY", time: "12:00" })).toEqual({ kind: "DAILY", time: "12:00" });
  });

  it("a pick from the form: weekly needs days; monthly may leave the day out", () => {
    expect(ruleInputSchema.safeParse({ kind: "WEEKLY", days: [] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ kind: "WEEKLY" }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ kind: "MONTHLY" }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ kind: "MONTHLY", day: 40 }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ kind: "DAILY", time: "10:00" }).success).toBe(false);
  });

  it("completes a pick from the task's own due date, in the company's zone", () => {
    const due = at("2031-03-10T12:00", DAM); // a Monday, noon
    expect(completeRule({ kind: "DAILY" }, due, DAM)).toEqual({ kind: "DAILY", time: "12:00" });
    expect(completeRule({ kind: "MONTHLY" }, due, DAM)).toEqual({ kind: "MONTHLY", day: 10, time: "12:00" });
    expect(completeRule({ kind: "MONTHLY", day: 31 }, due, DAM)).toEqual({ kind: "MONTHLY", day: 31, time: "12:00" });
    expect(completeRule({ kind: "YEARLY" }, due, DAM)).toEqual({ kind: "YEARLY", month: 3, day: 10, time: "12:00" });
    expect(completeRule({ kind: "WEEKLY", days: [3, 1, 1] }, due, DAM)).toEqual({ kind: "WEEKLY", days: [1, 3], time: "12:00" });
    // the same instant read in Berlin is another wall clock: the zone decides the hour and the day
    expect(completeRule({ kind: "DAILY" }, due, BER)).toEqual({ kind: "DAILY", time: "10:00" });
    expect(ruleToInput({ kind: "YEARLY", month: 3, day: 10, time: "12:00" })).toEqual({ kind: "YEARLY" });
    expect(ruleToInput({ kind: "WEEKLY", days: [1], time: "12:00" })).toEqual({ kind: "WEEKLY", days: [1] });
  });

  it("noon of today in the company's zone (the anchor of a task with no due date)", () => {
    expect(noonOfToday(new Date("2031-03-10T23:30:00Z"), DAM).toISOString()).toBe("2031-03-11T09:00:00.000Z"); // 02:30 on the 11th in Damascus: noon of the 11th
  });
});

describe("the day a series ends", () => {
  it("is the last instant of that day in the company's zone, and reads back as the same day", () => {
    const end = endOfDayInstant("2031-03-10", DAM)!;
    expect(end.toISOString()).toBe("2031-03-10T20:59:59.999Z");
    expect(endDayOf(end, DAM)).toBe("2031-03-10");
    expect(endDayOf(null, DAM)).toBeNull();
    // an occurrence at noon on the end day still happens; the next day's does not
    const rule: RecurrenceRule = { kind: "DAILY", time: "12:00" };
    expect(ruleOccurrenceAfter(rule, DAM, at("2031-03-10T00:00", DAM))!.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(ruleOccurrenceAfter(rule, DAM, at("2031-03-10T12:00", DAM))!.getTime()).toBeGreaterThan(end.getTime());
  });

  it("refuses text that is not a real date", () => {
    for (const bad of ["", "غدًا", "2031-02-30", "2031-13-01", "2031-3-1"]) expect(endOfDayInstant(bad, DAM), bad).toBeNull();
  });
});
