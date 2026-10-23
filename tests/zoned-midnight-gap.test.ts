import { describe, expect, it } from "vitest";
import { zonedDayStart, zonedWallTime } from "@/lib/zoned-time";

/**
 * A day whose midnight the clocks skip: the day starts just after the gap, and its end is the next
 * day's start (shorter than 24 hours). Reviewer C verified the maths by brute force over 23 zones,
 * 2023–2027 (209,990 checks); these pin the numbers the reviewer gave.
 */
describe("days with a midnight gap (the clocks jump past 00:00)", () => {
  it("Beirut, 2026-03-29 (the clocks jump 00:00 → 01:00)", () => {
    // any instant of that calendar day gives its start: the day begins at 01:00 local = 22:00Z of the 28th
    expect(zonedDayStart(new Date("2026-03-29T12:00:00Z"), "Asia/Beirut").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(zonedDayStart(new Date("2026-03-28T22:00:00Z"), "Asia/Beirut").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(zonedDayStart(new Date("2026-03-28T21:59:00Z"), "Asia/Beirut").toISOString()).toBe("2026-03-27T22:00:00.000Z");
    expect(zonedWallTime({ year: 2026, month: 3, day: 30 }, "Asia/Beirut").toISOString()).toBe("2026-03-29T21:00:00.000Z");
  });

  it("Cairo, 2026-04-24 (the clocks jump 00:00 → 01:00)", () => {
    expect(zonedDayStart(new Date("2026-04-24T12:00:00Z"), "Africa/Cairo").toISOString()).toBe("2026-04-23T22:00:00.000Z");
    expect(zonedWallTime({ year: 2026, month: 4, day: 25 }, "Africa/Cairo").toISOString()).toBe("2026-04-24T21:00:00.000Z");
  });
});
