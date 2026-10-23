import { describe, expect, it } from "vitest";
import { fmtLongDate, fmtRelative } from "@/lib/format";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  nextZonedDayStart,
  resolveTimeZone,
  zonedDayNumber,
  zonedDayStart,
  zonedParts,
  zonedStandIn,
  zonedWallTime,
} from "@/lib/zoned-time";
import { firstNameOf, greetingPeriod } from "@/lib/today";

/**
 * "Today" is the COMPANY's day, not the server's: Organization.timezone decides where a day starts. These
 * tests pin the clock maths with zones that never change their offset (Tokyo, Phoenix, Kolkata, UTC) and two
 * zones that do (New York's two transitions of 2026), so the answers are the same on every machine.
 */

const iso = (d: Date) => d.toISOString();
const at = (text: string) => new Date(text);

describe("zonedParts: the wall clock of a zone at an instant", () => {
  const A = at("2026-10-22T15:30:00Z");

  it("reads the same instant differently in different zones", () => {
    expect(zonedParts(A, "UTC")).toEqual({ year: 2026, month: 10, day: 22, hour: 15, minute: 30, second: 0, weekday: 4 });
    expect(zonedParts(A, "Asia/Tokyo")).toEqual({ year: 2026, month: 10, day: 23, hour: 0, minute: 30, second: 0, weekday: 5 });
    expect(zonedParts(A, "America/Phoenix")).toEqual({ year: 2026, month: 10, day: 22, hour: 8, minute: 30, second: 0, weekday: 4 });
    expect(zonedParts(A, "Asia/Kolkata")).toEqual({ year: 2026, month: 10, day: 22, hour: 21, minute: 0, second: 0, weekday: 4 });
  });

  it("writes midnight as hour 0, never 24, and ignores the milliseconds", () => {
    expect(zonedParts(at("2026-10-22T00:00:00.000Z"), "UTC").hour).toBe(0);
    expect(zonedParts(at("2026-10-22T15:00:00.000Z"), "Asia/Tokyo")).toMatchObject({ day: 23, hour: 0, minute: 0, second: 0 });
    expect(zonedParts(at("2026-10-22T14:59:59.999Z"), "Asia/Tokyo")).toMatchObject({ day: 22, hour: 23, minute: 59, second: 59 });
  });

  it("follows the daylight-saving change of a zone that has one", () => {
    // New York: UTC-4 until 2026-11-01 06:00Z, UTC-5 after it
    expect(zonedParts(at("2026-11-01T05:59:00Z"), "America/New_York")).toMatchObject({ day: 1, hour: 1, minute: 59 });
    expect(zonedParts(at("2026-11-01T06:00:00Z"), "America/New_York")).toMatchObject({ day: 1, hour: 1, minute: 0 });
  });
});

describe("the start of the company's day", () => {
  const A = at("2026-10-22T15:30:00Z");

  it("is the zone's own midnight, as an instant", () => {
    expect(iso(zonedDayStart(A, "UTC"))).toBe("2026-10-22T00:00:00.000Z");
    expect(iso(zonedDayStart(A, "Asia/Tokyo"))).toBe("2026-10-22T15:00:00.000Z"); // Tokyo is already on the 23rd
    expect(iso(zonedDayStart(A, "America/Phoenix"))).toBe("2026-10-22T07:00:00.000Z");
    expect(iso(zonedDayStart(A, "Asia/Kolkata"))).toBe("2026-10-21T18:30:00.000Z");
  });

  it("and the next day starts exactly when this one ends", () => {
    expect(iso(nextZonedDayStart(A, "UTC"))).toBe("2026-10-23T00:00:00.000Z");
    expect(iso(nextZonedDayStart(A, "Asia/Tokyo"))).toBe("2026-10-23T15:00:00.000Z");
    expect(iso(nextZonedDayStart(A, "America/Phoenix"))).toBe("2026-10-23T07:00:00.000Z");
    expect(iso(nextZonedDayStart(A, "Asia/Kolkata"))).toBe("2026-10-22T18:30:00.000Z");
  });

  it("puts the very second of midnight in the new day and the millisecond before it in the old one", () => {
    expect(iso(zonedDayStart(at("2026-10-22T15:00:00.000Z"), "Asia/Tokyo"))).toBe("2026-10-22T15:00:00.000Z");
    expect(iso(zonedDayStart(at("2026-10-22T14:59:59.999Z"), "Asia/Tokyo"))).toBe("2026-10-21T15:00:00.000Z");
  });

  it("is 25 hours long on the day the clocks go back and 23 hours long on the day they go forward", () => {
    const back = at("2026-11-01T12:00:00Z");
    expect(iso(zonedDayStart(back, "America/New_York"))).toBe("2026-11-01T04:00:00.000Z");
    expect(iso(nextZonedDayStart(back, "America/New_York"))).toBe("2026-11-02T05:00:00.000Z");
    const forward = at("2026-03-08T12:00:00Z");
    expect(iso(zonedDayStart(forward, "America/New_York"))).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(nextZonedDayStart(forward, "America/New_York"))).toBe("2026-03-09T04:00:00.000Z");
  });

  it("rolls over the end of a month and of a year", () => {
    expect(iso(nextZonedDayStart(at("2026-10-31T12:00:00Z"), "UTC"))).toBe("2026-11-01T00:00:00.000Z");
    expect(iso(nextZonedDayStart(at("2026-12-31T12:00:00Z"), "UTC"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("a wall-clock time of a zone, as an instant", () => {
  it("is exact in a zone with a fixed offset", () => {
    expect(iso(zonedWallTime({ year: 2026, month: 10, day: 23, hour: 12 }, "Asia/Tokyo"))).toBe("2026-10-23T03:00:00.000Z");
    expect(iso(zonedWallTime({ year: 2026, month: 10, day: 23 }, "Asia/Kolkata"))).toBe("2026-10-22T18:30:00.000Z");
  });

  it("takes a day past the end of the month (tomorrow is `day + 1`)", () => {
    expect(iso(zonedWallTime({ year: 2026, month: 10, day: 32, hour: 12 }, "UTC"))).toBe("2026-11-01T12:00:00.000Z");
  });

  it("picks the first of the two readings of a time that happens twice, and moves a time that never happens past the gap", () => {
    // 01:30 on 2026-11-01 in New York is said twice: at 05:30Z (daylight time) and again at 06:30Z (standard time)
    expect(iso(zonedWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    // 02:30 on 2026-03-08 never happens there: the clocks jump from 02:00 to 03:00
    expect(iso(zonedWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("round-trips through zonedParts", () => {
    for (const zone of ["UTC", "Asia/Tokyo", "America/Phoenix", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"]) {
      const instant = zonedWallTime({ year: 2026, month: 7, day: 14, hour: 9, minute: 5, second: 7 }, zone);
      expect(zonedParts(instant, zone), zone).toMatchObject({ year: 2026, month: 7, day: 14, hour: 9, minute: 5, second: 7 });
    }
  });
});

describe("counting days in the company's zone", () => {
  it("numbers the calendar days of a zone, so the difference is whole days", () => {
    const a = zonedDayNumber(at("2026-10-31T12:00:00Z"), "UTC");
    const b = zonedDayNumber(at("2026-11-01T12:00:00Z"), "UTC");
    expect(b - a).toBe(1);
    // 19:00 and 23:30 are the same Tokyo day (and 10:00 and 14:30 the same UTC day); one minute across midnight is a whole day apart
    expect(zonedDayNumber(at("2026-10-22T14:30:00Z"), "Asia/Tokyo")).toBe(zonedDayNumber(at("2026-10-22T10:00:00Z"), "Asia/Tokyo"));
    expect(zonedDayNumber(at("2026-10-22T14:30:00Z"), "UTC")).toBe(zonedDayNumber(at("2026-10-22T10:00:00Z"), "UTC"));
    expect(zonedDayNumber(at("2026-10-22T15:00:00Z"), "Asia/Tokyo")).toBe(zonedDayNumber(at("2026-10-22T14:59:00Z"), "Asia/Tokyo") + 1);
  });
});

describe("the stand-in date the screens' formatters read", () => {
  const A = at("2026-10-22T15:30:00Z");

  it("carries the zone's calendar date in the process's own fields, so lib/format writes the zone's weekday and date", () => {
    expect(fmtLongDate(zonedStandIn(A, "America/Phoenix"))).toBe("الخميس 22 تشرين الأول 2026");
    expect(fmtLongDate(zonedStandIn(A, "Asia/Tokyo"))).toBe("الجمعة 23 تشرين الأول 2026");
  });

  it("says «اليوم» «أمس» «بكرا» by the company's days: a task due 23:30 local is tomorrow in one zone and today in another", () => {
    const now = at("2026-10-22T20:00:00Z");
    const label = (due: string, zone: string) => fmtRelative(zonedStandIn(at(due), zone), zonedStandIn(now, zone));
    // 2026-10-22 14:30Z = 23:30 on the 22nd in Tokyo, where it is already 05:00 on the 23rd
    expect(label("2026-10-22T14:30:00Z", "Asia/Tokyo")).toBe("أمس");
    expect(label("2026-10-22T14:30:00Z", "UTC")).toBe("اليوم");
    expect(label("2026-10-22T14:30:00Z", "America/Phoenix")).toBe("اليوم");
    // 2026-10-23 06:30Z = 23:30 on the 22nd in Phoenix
    expect(label("2026-10-23T06:30:00Z", "America/Phoenix")).toBe("اليوم");
    expect(label("2026-10-23T06:30:00Z", "UTC")).toBe("بكرا");
    expect(label("2026-10-23T06:30:00Z", "Asia/Tokyo")).toBe("اليوم");
  });

  it("counts several days the way lib/format does (قبل يومين, بعد 3 أيام)", () => {
    const now = at("2026-10-22T09:00:00Z");
    expect(fmtRelative(zonedStandIn(at("2026-10-20T12:00:00Z"), "UTC"), zonedStandIn(now, "UTC"))).toBe("قبل يومين");
    expect(fmtRelative(zonedStandIn(at("2026-10-25T12:00:00Z"), "UTC"), zonedStandIn(now, "UTC"))).toBe("بعد 3 أيام");
  });
});

describe("the zone an organization row names", () => {
  it("accepts a real zone and refuses anything else", () => {
    expect(isValidTimeZone("Asia/Damascus")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("falls back to the company default (the schema's default) when the value is missing or wrong, and never throws", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Damascus");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveTimeZone("Mars/Olympus")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(() => zonedParts(at("2026-10-22T15:30:00Z"), resolveTimeZone("???"))).not.toThrow();
  });
});

describe("the greeting", () => {
  it("is «صباح الخير» from five in the morning until noon and «مساء الخير» for the rest of the day and the night", () => {
    expect(greetingPeriod(5)).toBe("morning");
    expect(greetingPeriod(9)).toBe("morning");
    expect(greetingPeriod(11)).toBe("morning");
    expect(greetingPeriod(12)).toBe("evening");
    expect(greetingPeriod(18)).toBe("evening");
    expect(greetingPeriod(23)).toBe("evening");
    expect(greetingPeriod(0)).toBe("evening");
    expect(greetingPeriod(4)).toBe("evening");
  });

  it("uses the first name only, whatever the spacing", () => {
    expect(firstNameOf("أحمد الزكي")).toBe("أحمد");
    expect(firstNameOf("  سارة   خالد ")).toBe("سارة");
    expect(firstNameOf("Owner")).toBe("Owner");
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf("   ")).toBe("");
  });

  it("keeps the two words of a name that cannot stand on its first word: «عبد الله», «أبو نزار», «أم خالد»", () => {
    // «عبد» alone means «servant»: «صباح الخير يا عبد» would be wrong
    expect(firstNameOf("عبد الله الأحمد")).toBe("عبد الله");
    expect(firstNameOf("عبد   الرحمن  سالم")).toBe("عبد الرحمن");
    expect(firstNameOf("أبو نزار")).toBe("أبو نزار");
    expect(firstNameOf("ابو نزار المصري")).toBe("ابو نزار");
    expect(firstNameOf("أم خالد")).toBe("أم خالد");
    // spelled as one word they are one word already
    expect(firstNameOf("عبدالله علي")).toBe("عبدالله");
    // a name that merely contains one of them, or has it second, is just its first word
    expect(firstNameOf("محمد عبد الله")).toBe("محمد");
    expect(firstNameOf("أمل حسن")).toBe("أمل");
    expect(firstNameOf("عبد")).toBe("عبد");
  });
});
