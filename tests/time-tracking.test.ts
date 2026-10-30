import { describe, expect, it } from "vitest";
import {
  AUTO_STOP_SECONDS,
  CSV_BOM,
  MAX_DAY_SECONDS,
  addDays,
  closeTimer,
  csvCell,
  dayAnchor,
  dayKey,
  dayWindow,
  editWindowOpen,
  elapsedSeconds,
  fitsDay,
  formatBoth,
  formatClock,
  formatDecimal,
  formatHM,
  groupTotals,
  parseDayKey,
  presetRange,
  runningSeconds,
  secondsOfHM,
  sumSeconds,
  toCsv,
} from "@/lib/time-tracking";

const NY = "America/New_York"; // clocks change on 2026-03-08 (23-hour day) and 2026-11-01 (25-hour day)
const DAMASCUS = "Asia/Damascus";
const HOUR_MS = 3_600_000;

describe("«حساب وقت الشغل»: drawing a duration from integer seconds", () => {
  it("hh:mm rounds the minute half up and lets the hours pass 99", () => {
    expect(formatHM(0)).toBe("00:00");
    expect(formatHM(29)).toBe("00:00");
    expect(formatHM(30)).toBe("00:01");
    expect(formatHM(3599)).toBe("01:00");
    expect(formatHM(5400)).toBe("01:30");
    expect(formatHM(100 * 3600)).toBe("100:00");
  });

  it("a broken number never draws NaN or a minus sign", () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatHM(bad)).toBe("00:00");
      expect(formatDecimal(bad)).toBe("0.00");
      expect(formatClock(bad)).toBe("00:00");
    }
  });

  it("the decimal has two digits, from the integer seconds", () => {
    expect(formatDecimal(5400)).toBe("1.50");
    expect(formatDecimal(0)).toBe("0.00");
    expect(formatDecimal(1)).toBe("0.00");
    expect(formatDecimal(18)).toBe("0.01"); // 0.005 h rounds half up
    expect(formatDecimal(17)).toBe("0.00");
    expect(formatDecimal(3600 * 7 + 1200)).toBe("7.33");
    expect(formatDecimal(86400)).toBe("24.00");
    expect(formatBoth(5400)).toBe("01:30 (1.50)");
  });

  it("three entries of 20 minutes are exactly one hour: the sum is an integer and is drawn once", () => {
    const rows = [{ seconds: 1200 }, { seconds: 1200 }, { seconds: 1200 }];
    expect(sumSeconds(rows)).toBe(3600);
    expect(formatDecimal(sumSeconds(rows))).toBe("1.00");
    // the per-row decimals would add up to 1.01 (0.33 x 3 plus rounding): only the integer sum is ever drawn
    expect(formatDecimal(1200)).toBe("0.33");
  });

  it("the live clock is mm:ss, and h:mm:ss from one hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59)).toBe("00:59");
    expect(formatClock(61)).toBe("01:01");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(12 * 3600 - 1)).toBe("11:59:59");
  });
});

describe("«حساب وقت الشغل»: reading what a person types", () => {
  it("hours and minutes become seconds; 0 < t <= 24:00 and minutes 0-59", () => {
    expect(secondsOfHM(1, 30)).toBe(5400);
    expect(secondsOfHM(0, 1)).toBe(60);
    expect(secondsOfHM(24, 0)).toBe(86400);
    expect(secondsOfHM(0, 0)).toBeNull();
    expect(secondsOfHM(24, 1)).toBeNull();
    expect(secondsOfHM(25, 0)).toBeNull();
    expect(secondsOfHM(1, 60)).toBeNull();
    expect(secondsOfHM(-1, 30)).toBeNull();
    expect(secondsOfHM(1.5, 0)).toBeNull();
    expect(secondsOfHM("1", "30")).toBeNull();
    expect(secondsOfHM(Number.NaN, 0)).toBeNull();
  });
});

describe("«حساب وقت الشغل»: durations come from two clock readings", () => {
  const start = new Date("2031-03-10T08:00:00.000Z");

  it("whole seconds between the server's two instants, never negative", () => {
    expect(elapsedSeconds(start, new Date(start.getTime() + 90_999))).toBe(90);
    expect(elapsedSeconds(start, start)).toBe(0);
    expect(elapsedSeconds(start, new Date(start.getTime() - 5000))).toBe(0);
  });

  it("a timer closes at now; past 12 hours it closes at startedAt + 12h and says it was stopped automatically", () => {
    const soon = closeTimer(start, new Date(start.getTime() + 5 * HOUR_MS));
    expect(soon).toEqual({ stoppedAt: new Date(start.getTime() + 5 * HOUR_MS), seconds: 5 * 3600, autoStopped: false });
    // exactly 12 hours is still a normal stop: «more than 12 hours» is what the runner closes
    const exact = closeTimer(start, new Date(start.getTime() + 12 * HOUR_MS));
    expect(exact.autoStopped).toBe(false);
    expect(exact.seconds).toBe(AUTO_STOP_SECONDS);
    const late = closeTimer(start, new Date(start.getTime() + 12 * HOUR_MS + 1));
    expect(late).toEqual({ stoppedAt: new Date(start.getTime() + 12 * HOUR_MS), seconds: AUTO_STOP_SECONDS, autoStopped: true });
    const days = closeTimer(start, new Date(start.getTime() + 72 * HOUR_MS));
    expect(days.seconds).toBe(AUTO_STOP_SECONDS);
    expect(days.autoStopped).toBe(true);
  });

  it("a server clock that stepped back never closes a timer before it began", () => {
    const back = closeTimer(start, new Date(start.getTime() - 60_000));
    expect(back.seconds).toBe(0);
    expect(back.stoppedAt.getTime()).toBe(start.getTime());
  });

  it("the live number is the SERVER's startedAt and serverNow plus the browser's own passing seconds, capped at 12 hours", () => {
    const startedAt = "2031-03-10T08:00:00.000Z";
    const serverNow = "2031-03-10T08:10:00.000Z";
    // a browser clock that is hours wrong changes nothing: only the difference between two of ITS readings is used
    expect(runningSeconds(startedAt, serverNow, 5_000_000_000, 5_000_000_000)).toBe(600);
    expect(runningSeconds(startedAt, serverNow, 5_000_000_000, 5_000_000_000 + 7_900)).toBe(607);
    expect(runningSeconds(startedAt, serverNow, 5_000_000_000, 4_000_000_000)).toBe(600); // a clock stepped back adds nothing
    expect(runningSeconds(startedAt, "2031-03-12T08:00:00.000Z", 0, 0)).toBe(AUTO_STOP_SECONDS);
    expect(runningSeconds(serverNow, startedAt, 0, 0)).toBe(0);
  });
});

describe("«حساب وقت الشغل»: the company's day, across the zone and its clock changes", () => {
  it("reads a calendar date strictly", () => {
    expect(parseDayKey("2026-10-30")).toEqual({ year: 2026, month: 10, day: 30 });
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "26-01-01", "", "2026-10-30T00:00", 20261030, null, undefined]) {
      expect(parseDayKey(bad), String(bad)).toBeNull();
    }
    expect(parseDayKey("2028-02-29")).not.toBeNull();
    expect(parseDayKey("2027-02-29")).toBeNull();
  });

  it("a day belongs to the company's zone, not to UTC", () => {
    // 21:30 UTC is already the next day in Damascus (UTC+3)
    expect(dayKey(new Date("2026-10-30T21:30:00Z"), DAMASCUS)).toBe("2026-10-31");
    expect(dayKey(new Date("2026-10-30T20:59:59Z"), DAMASCUS)).toBe("2026-10-30");
    expect(dayKey(new Date("2026-10-30T21:30:00Z"), "UTC")).toBe("2026-10-30");
  });

  it("the day of spring-forward lasts 23 hours and the day of fall-back 25, and the windows tile without a gap", () => {
    const spring = dayWindow("2026-03-08", NY)!;
    expect((spring.end.getTime() - spring.start.getTime()) / HOUR_MS).toBe(23);
    const fall = dayWindow("2026-11-01", NY)!;
    expect((fall.end.getTime() - fall.start.getTime()) / HOUR_MS).toBe(25);
    const next = dayWindow("2026-11-02", NY)!;
    expect(next.start.getTime()).toBe(fall.end.getTime());
    const normal = dayWindow("2026-10-30", NY)!;
    expect((normal.end.getTime() - normal.start.getTime()) / HOUR_MS).toBe(24);
    expect(dayWindow("2026-02-30", NY)).toBeNull();
  });

  it("an instant lands on the right side of the fall-back day", () => {
    expect(dayKey(new Date("2026-11-01T04:30:00Z"), NY)).toBe("2026-11-01"); // 00:30 EDT
    expect(dayKey(new Date("2026-11-01T05:30:00Z"), NY)).toBe("2026-11-01"); // 01:30 EDT
    expect(dayKey(new Date("2026-11-01T06:30:00Z"), NY)).toBe("2026-11-01"); // 01:30 EST, the hour that happens twice
    expect(dayKey(new Date("2026-11-02T04:59:59Z"), NY)).toBe("2026-11-01"); // 23:59:59 EST
    expect(dayKey(new Date("2026-11-02T05:00:00Z"), NY)).toBe("2026-11-02");
    const w = dayWindow("2026-11-01", NY)!;
    expect(w.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("a manual entry is anchored at noon of its day, inside that day's window, on every kind of day", () => {
    for (const key of ["2026-03-08", "2026-11-01", "2026-10-30", "2028-02-29"]) {
      const anchor = dayAnchor(key, NY)!;
      const w = dayWindow(key, NY)!;
      expect(anchor.getTime()).toBeGreaterThanOrEqual(w.start.getTime());
      expect(anchor.getTime()).toBeLessThan(w.end.getTime());
      expect(dayKey(anchor, NY)).toBe(key);
    }
    expect(dayAnchor("2026-10-30", DAMASCUS)!.toISOString()).toBe("2026-10-30T09:00:00.000Z");
  });

  it("the 24-hour cap per day holds on a 23-hour day and a 25-hour day alike", () => {
    expect(MAX_DAY_SECONDS).toBe(86400);
    expect(fitsDay(0, 86400)).toBe(true);
    expect(fitsDay(3600, 86400)).toBe(false);
    expect(fitsDay(86399, 1)).toBe(true);
    expect(fitsDay(86400, 1)).toBe(false);
    // the cap is on the calendar day, whatever its length: 23 + 1 hours fit on the short day, 24 + 1 do not on the long one
    expect(fitsDay(23 * 3600, 3600)).toBe(true);
    expect(fitsDay(24 * 3600, 3600)).toBe(false);
  });

  it("counts days across a month end, a year end and a leap day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("the 14-day window closes after exactly 14 days", () => {
    const created = new Date("2026-10-01T10:00:00Z");
    expect(editWindowOpen(created, new Date(created.getTime() + 14 * 24 * HOUR_MS))).toBe(true);
    expect(editWindowOpen(created, new Date(created.getTime() + 14 * 24 * HOUR_MS + 1))).toBe(false);
    expect(editWindowOpen(created, created)).toBe(true);
  });

  it("the week preset runs Sunday to Saturday and the month preset the whole month, in the company's zone", () => {
    // 2026-10-30 is a Friday
    expect(presetRange("week", new Date("2026-10-30T10:00:00Z"), DAMASCUS)).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    // Friday 22:30 UTC is already Saturday in Damascus: still the same week, but a Saturday-night UTC instant is next week's Sunday there
    expect(presetRange("week", new Date("2026-10-31T21:30:00Z"), DAMASCUS)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(presetRange("week", new Date("2026-10-31T21:30:00Z"), "UTC")).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(presetRange("month", new Date("2026-10-30T10:00:00Z"), DAMASCUS)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("month", new Date("2028-02-10T10:00:00Z"), DAMASCUS)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(presetRange("month", new Date("2026-12-31T10:00:00Z"), DAMASCUS)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("«حساب وقت الشغل»: totals", () => {
  it("groups by key with integer sums, largest first, and the groups add up to the whole", () => {
    const rows = [
      { who: "a", label: "سامر", seconds: 1800 },
      { who: "b", label: "ليلى", seconds: 5400 },
      { who: "a", label: "سامر", seconds: 1801 },
      { who: "c", label: "هند", seconds: 60 },
    ];
    const groups = groupTotals(rows, (r) => ({ key: r.who, label: r.label }));
    expect(groups.map((g) => [g.key, g.seconds])).toEqual([
      ["a", 3601],
      ["b", 5400],
      ["c", 60],
    ].sort((x, y) => (y[1] as number) - (x[1] as number)));
    expect(groups.reduce((n, g) => n + g.seconds, 0)).toBe(sumSeconds(rows));
    expect(sumSeconds([])).toBe(0);
    expect(sumSeconds([{ seconds: -5 }, { seconds: 10 }])).toBe(10);
  });
});

describe("«حساب وقت الشغل»: the CSV file", () => {
  it("starts with the byte order mark, so Excel reads the Arabic", () => {
    const file = toCsv([["اسم"], ["سامر"]]);
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(CSV_BOM).toBe("﻿");
    expect(file).toBe("﻿اسم\r\nسامر\r\n");
  });

  it("a cell that Excel would read as a formula gets a leading apostrophe", () => {
    for (const evil of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "=HYPERLINK(\"http://x\")", "\tTAB", "\rCR"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'"), evil).toBe(true);
    }
    expect(csvCell("=1+1")).toBe("'=1+1");
    // an ordinary cell, a number, a time and a date are left alone
    expect(csvCell("مراجعة العرض")).toBe("مراجعة العرض");
    expect(csvCell(42)).toBe("42");
    expect(csvCell("01:30")).toBe("01:30");
    expect(csvCell("2026-10-30")).toBe("2026-10-30");
    expect(csvCell("1.50")).toBe("1.50");
    // only the START matters: a minus inside the text is text
    expect(csvCell("تصميم - نسخة ٢")).toBe("تصميم - نسخة ٢");
  });

  it("quotes a cell with a comma, a quote or a line break and doubles the quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    // the apostrophe and the quoting work together
    expect(csvCell('=A1,"x"')).toBe('"\'=A1,""x"""');
  });
});
