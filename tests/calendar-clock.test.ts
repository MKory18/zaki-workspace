import { describe, expect, it } from "vitest";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { calendarView } from "@/server/services/calendar";

/**
 * The calendar is the COMPANY's month, cut in Organization.timezone. A company in Damascus opens its
 * browser on a server on UTC: at 00:30 on 1 November local (21:30Z on 31 October) the calendar must
 * open on November with today = 1 November, and tasks due just after local midnight are drawn on the
 * local day, in November's window — not a day or a month behind.
 */
describe("the calendar cuts the month and the days in the company's zone", () => {
  const zone = "Asia/Damascus";

  it("at 00:30 Damascus on 1 November (21:30Z on 31 October) it opens on November with today = 1 November", () => {
    const now = new Date("2026-10-31T21:30:00Z");
    const view = calendarView({ now, timeZone: zone });
    expect(view.month).toBe("2026-11");
    expect(view.todayIso).toBe("2026-11-01");
    // November's window: the local 1st 00:00 to the local 30th 23:59:59.999
    expect(view.win.from.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(view.win.to.toISOString()).toBe("2026-11-30T20:59:59.999Z");
  });

  it("a task due 01:00 Damascus on 1 Nov falls in November's window and is drawn on the 1st", () => {
    const due = zonedWallTime({ year: 2026, month: 11, day: 1, hour: 1 }, zone);
    expect(due.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    const view = calendarView({ now: new Date("2026-10-31T21:30:00Z"), timeZone: zone, month: "2026-11" });
    expect(due.getTime()).toBeGreaterThanOrEqual(view.win.from.getTime());
    expect(due.getTime()).toBeLessThanOrEqual(view.win.to.getTime());
    expect(bucketIso(due, zone)).toBe("2026-11-01");
  });

  it("a task due 01:00 Damascus on the 16th is drawn on the 16th, not the 15th", () => {
    const due = zonedWallTime({ year: 2026, month: 11, day: 16, hour: 1 }, zone);
    expect(due.toISOString()).toBe("2026-11-15T22:00:00.000Z");
    expect(bucketIso(due, zone)).toBe("2026-11-16");
  });

  it("a bad ym falls back to the month of `now` in the company's zone", () => {
    const view = calendarView({ now: new Date("2026-10-31T21:30:00Z"), timeZone: zone, month: "nonsense" });
    expect(view.month).toBe("2026-11");
  });

  it("without a zone it stays the machine's month (UTC on the server), as before", () => {
    const view = calendarView({ now: new Date("2026-10-31T21:30:00Z") });
    expect(view.month).toBe("2026-10");
    expect(view.todayIso).toBe("2026-10-31");
  });
});

/** What the grid computes for a task with `zonedParts` (the same maths, pinned here for the client). */
function bucketIso(due: Date, timeZone: string): string {
  const p = zonedParts(due, timeZone);
  return (
    p.year.toString().padStart(4, "0") +
    "-" +
    p.month.toString().padStart(2, "0") +
    "-" +
    p.day.toString().padStart(2, "0")
  );
}
