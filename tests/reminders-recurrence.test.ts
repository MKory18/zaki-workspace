import { describe, expect, it } from "vitest";
import { nextOccurrence, parseDueInput, snoozeUntil } from "@/lib/reminders/recurrence";
import { zonedParts } from "@/lib/zoned-time";

/**
 * «ذكّرني» — the recurrence math, pure. Damascus has no clock change; Berlin has one, which is what proves the
 * rule is the WALL CLOCK of the company's zone and not "add 24 hours".
 */

const DAM = "Asia/Damascus";
const BER = "Europe/Berlin";

/** The wall clock of a zone as `YYYY-MM-DD HH:mm`, for readable expectations. */
function wall(d: Date | null, zone: string): string {
  if (!d) return "null";
  const p = zonedParts(d, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}
const at = (text: string, zone: string): Date => {
  const d = parseDueInput(text, zone);
  if (!d) throw new Error(`bad test date ${text}`);
  return d;
};

describe("parseDueInput", () => {
  it("reads a datetime-local box in the COMPANY's zone, whatever the machine's zone is", () => {
    expect(at("2026-11-05T09:30", DAM).toISOString()).toBe("2026-11-05T06:30:00.000Z"); // Damascus is UTC+3 in winter 2026
    expect(wall(at("2026-11-05T09:30", BER), BER)).toBe("2026-11-05 09:30");
  });
  it("takes a full instant as it is, and refuses everything else", () => {
    expect(parseDueInput("2026-11-05T09:30:00Z", DAM)?.toISOString()).toBe("2026-11-05T09:30:00.000Z");
    expect(parseDueInput("2026-11-05T09:30:00+02:00", DAM)?.toISOString()).toBe("2026-11-05T07:30:00.000Z");
    for (const bad of ["", "tomorrow", "2026-11-05", "2026-13-05T09:30", "2026-02-30T09:30", "2026-11-05T25:00", "2026-11-05T09:61"]) {
      expect(parseDueInput(bad, DAM), bad).toBeNull();
    }
  });
});

describe("a reminder that does not repeat has no next time", () => {
  it("NONE is null", () => {
    expect(nextOccurrence(at("2026-11-05T09:30", DAM), "NONE", DAM, new Date("2026-11-05T07:00:00Z"))).toBeNull();
  });
});

describe("daily", () => {
  it("tomorrow, at the same wall-clock time", () => {
    const due = at("2026-11-05T09:30", DAM);
    expect(wall(nextOccurrence(due, "DAILY", DAM, due), DAM)).toBe("2026-11-06 09:30");
  });
  it("goes over a month and a year end", () => {
    expect(wall(nextOccurrence(at("2026-12-31T22:15", DAM), "DAILY", DAM, at("2026-12-31T22:15", DAM)), DAM)).toBe("2027-01-01 22:15");
  });
  it("a runner that was down for days fires once and continues from the first time after now (never a replay)", () => {
    const due = at("2026-11-05T09:30", DAM);
    const now = at("2026-11-12T12:00", DAM);
    expect(wall(nextOccurrence(due, "DAILY", DAM, now), DAM)).toBe("2026-11-13 09:30");
    // the same minute as the due time is not «after now»
    expect(wall(nextOccurrence(due, "DAILY", DAM, at("2026-11-12T09:30", DAM)), DAM)).toBe("2026-11-13 09:30");
    // and a moment before it is still today
    expect(wall(nextOccurrence(due, "DAILY", DAM, at("2026-11-12T09:29", DAM)), DAM)).toBe("2026-11-12 09:30");
  });
  it("keeps the wall clock across the change of the clocks in a zone that has one (Berlin, 29 March 2026)", () => {
    const due = at("2026-03-28T09:00", BER); // CET, UTC+1  → 08:00Z
    const next = nextOccurrence(due, "DAILY", BER, due)!;
    expect(wall(next, BER)).toBe("2026-03-29 09:00");
    expect(due.toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(next.toISOString()).toBe("2026-03-29T07:00:00.000Z"); // CEST, UTC+2: the instant moved, the hour did not
    // and back in the autumn (25 October 2026)
    const autumn = at("2026-10-24T09:00", BER);
    expect(wall(nextOccurrence(autumn, "DAILY", BER, autumn), BER)).toBe("2026-10-25 09:00");
    expect(nextOccurrence(autumn, "DAILY", BER, autumn)!.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
  it("Damascus has no change: the next day is exactly 24 hours later, and the same in Berlin only by luck", () => {
    const due = at("2026-03-28T09:00", DAM);
    expect(nextOccurrence(due, "DAILY", DAM, due)!.getTime() - due.getTime()).toBe(24 * 3_600_000);
    const berlin = at("2026-03-28T09:00", BER);
    expect(nextOccurrence(berlin, "DAILY", BER, berlin)!.getTime() - berlin.getTime()).toBe(23 * 3_600_000);
  });
});

describe("weekly", () => {
  it("seven days later, same weekday and wall time", () => {
    const due = at("2026-11-05T09:30", DAM); // a Thursday
    const next = nextOccurrence(due, "WEEKLY", DAM, due)!;
    expect(wall(next, DAM)).toBe("2026-11-12 09:30");
    expect(zonedParts(next, DAM).weekday).toBe(zonedParts(due, DAM).weekday);
  });
  it("catches up to the first week after now", () => {
    const due = at("2026-11-05T09:30", DAM);
    expect(wall(nextOccurrence(due, "WEEKLY", DAM, at("2026-12-01T00:00", DAM)), DAM)).toBe("2026-12-03 09:30");
    expect(wall(nextOccurrence(due, "WEEKLY", DAM, at("2026-11-12T09:30", DAM)), DAM)).toBe("2026-11-19 09:30");
  });
  it("keeps the wall clock across the autumn change in Berlin", () => {
    const due = at("2026-10-22T18:00", BER);
    expect(wall(nextOccurrence(due, "WEEKLY", BER, due), BER)).toBe("2026-10-29 18:00");
    expect(nextOccurrence(due, "WEEKLY", BER, due)!.toISOString()).toBe("2026-10-29T17:00:00.000Z"); // CET again
  });
});

describe("monthly", () => {
  it("the same day of the next month", () => {
    const due = at("2026-11-05T09:30", DAM);
    expect(wall(nextOccurrence(due, "MONTHLY", DAM, due), DAM)).toBe("2026-12-05 09:30");
  });
  it("the 31st goes to the last day of a shorter month", () => {
    expect(wall(nextOccurrence(at("2026-01-31T10:00", DAM), "MONTHLY", DAM, at("2026-01-31T10:00", DAM)), DAM)).toBe("2026-02-28 10:00");
    expect(wall(nextOccurrence(at("2028-01-31T10:00", DAM), "MONTHLY", DAM, at("2028-01-31T10:00", DAM)), DAM)).toBe("2028-02-29 10:00"); // a leap year
    expect(wall(nextOccurrence(at("2026-03-31T10:00", DAM), "MONTHLY", DAM, at("2026-03-31T10:00", DAM)), DAM)).toBe("2026-04-30 10:00");
    expect(wall(nextOccurrence(at("2026-05-30T10:00", DAM), "MONTHLY", DAM, at("2026-05-30T10:00", DAM)), DAM)).toBe("2026-06-30 10:00");
  });
  it("goes over a year end", () => {
    expect(wall(nextOccurrence(at("2026-12-15T08:00", DAM), "MONTHLY", DAM, at("2026-12-15T08:00", DAM)), DAM)).toBe("2027-01-15 08:00");
  });
  it("catches up to the first month after now", () => {
    const due = at("2026-01-15T09:00", DAM);
    expect(wall(nextOccurrence(due, "MONTHLY", DAM, at("2026-06-20T00:00", DAM)), DAM)).toBe("2026-07-15 09:00");
    expect(wall(nextOccurrence(due, "MONTHLY", DAM, at("2026-06-15T08:59", DAM)), DAM)).toBe("2026-06-15 09:00");
  });
  it("is the wall clock in Berlin too (a March reminder at 09:00 stays at 09:00 in April, after the change)", () => {
    const due = at("2026-03-15T09:00", BER);
    const next = nextOccurrence(due, "MONTHLY", BER, due)!;
    expect(wall(next, BER)).toBe("2026-04-15 09:00");
    expect(next.toISOString()).toBe("2026-04-15T07:00:00.000Z");
  });
});

describe("snooze presets", () => {
  it("«بعد ساعة» is an hour from now", () => {
    const now = new Date("2026-11-05T10:20:30Z");
    expect(snoozeUntil("HOUR", now, DAM).toISOString()).toBe("2026-11-05T11:20:30.000Z");
  });
  it("«بكرا الصبح» is 09:00 tomorrow in the company's zone, not the server's", () => {
    // 23:30 in Damascus on the 5th is already 20:30Z: «tomorrow» is the 6th in Damascus
    const now = at("2026-11-05T23:30", DAM);
    expect(wall(snoozeUntil("TOMORROW_MORNING", now, DAM), DAM)).toBe("2026-11-06 09:00");
    // 01:00 in Damascus on the 6th is still the 5th in UTC: tomorrow is the 7th there
    expect(wall(snoozeUntil("TOMORROW_MORNING", at("2026-11-06T01:00", DAM), DAM), DAM)).toBe("2026-11-07 09:00");
    expect(wall(snoozeUntil("TOMORROW_MORNING", at("2026-03-28T12:00", BER), BER), BER)).toBe("2026-03-29 09:00");
  });
});
