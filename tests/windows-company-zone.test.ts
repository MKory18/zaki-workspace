import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, zonedWallTime } from "@/lib/zoned-time";
import { dayIso, parseDayIso, runsOnDay } from "@/server/services/production";
import { periodWindow } from "@/server/services/goals";

/**
 * The daily checklist's default day and the goals' period windows are the COMPANY's days
 * (Organization.timezone), not the server's clock.
 */

describe("the production daily checklist's day helpers work in the company's zone", () => {
  it("dayIso(d, timeZone) is the zone's calendar day: 21:30Z on the 15th is the 16th in Damascus", () => {
    expect(dayIso(new Date("2026-03-15T21:30:00Z"), "Asia/Damascus")).toBe("2026-03-16");
    expect(dayIso(new Date("2026-03-15T21:30:00Z"))).toBe("2026-03-15"); // no zone = the machine's day
  });

  it("parseDayIso is noon of that day in the zone, so a boundary cannot move it", () => {
    expect(parseDayIso("2026-03-16", "Asia/Damascus").toISOString()).toBe("2026-03-16T09:00:00.000Z");
    expect(parseDayIso("2026-03-16").getHours()).toBe(12); // without a zone: the machine's own noon
  });

  it("a routine's weekdays are checked against the zone's weekday", () => {
    // 21:30Z on 15 March is Sunday the 15th in UTC but Monday the 16th in Damascus
    const monday = "1";
    expect(runsOnDay(monday, "2026-03-16", "Asia/Damascus")).toBe(true);
    expect(runsOnDay(monday, "2026-03-15", "Asia/Damascus")).toBe(false);
    expect(runsOnDay(monday, "2026-03-16")).toBe(true); // the machine (UTC) also says Monday there
  });
});

describe("goals cut their week and month in the company's zone", () => {
  const zone = "Asia/Damascus";

  it("a weekly goal anchored on Damascus Saturday 21:30Z starts on the zone's Sunday 00:00", () => {
    // 21:30Z on 2026-03-14 is 00:30 Damascus on Sunday the 15th; the week starts that local Sunday 00:00 (= Sat 21:00Z)
    const anchor = zonedWallTime({ year: 2026, month: 3, day: 15, hour: 0, minute: 30 }, zone);
    const win = periodWindow("WEEKLY", anchor, zone);
    expect(win.start.toISOString()).toBe("2026-03-14T21:00:00.000Z");
    expect(win.end.toISOString()).toBe("2026-03-21T20:59:59.999Z");
  });

  it("the same instant without a zone keeps the machine's window (Sunday 00:00 UTC+… of the machine)", () => {
    const anchor = new Date("2026-03-14T21:30:00Z");
    const win = periodWindow("WEEKLY", anchor);
    // machine UTC: still Saturday the 14th → the week started Sunday the 8th
    expect(win.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });

  it("a monthly goal anchored at 00:30 Damascus on the 1st is the zone's month", () => {
    const anchor = zonedWallTime({ year: 2026, month: 11, day: 1, hour: 0, minute: 30 }, zone);
    const win = periodWindow("MONTHLY", anchor, zone);
    expect(win.start.toISOString()).toBe("2026-10-31T21:00:00.000Z"); // local 1 Nov 00:00
    expect(win.end.toISOString()).toBe("2026-11-30T20:59:59.999Z"); // local 1 Dec 00:00 minus 1 ms
  });

  it("a mistyped zone falls back to the company default instead of throwing", () => {
    const anchor = new Date("2026-03-14T21:30:00Z");
    expect(() => periodWindow("WEEKLY", anchor, "Mars/Olympus")).not.toThrow();
    expect(periodWindow("WEEKLY", anchor, "Mars/Olympus")).toEqual(periodWindow("WEEKLY", anchor, DEFAULT_TIME_ZONE));
  });
});
