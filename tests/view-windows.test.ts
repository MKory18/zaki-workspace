import { describe, expect, it } from "vitest";
import { dayWindow, monthWindow, shiftMonth } from "../src/server/services/views";

describe("dayWindow", () => {
  it("covers the full local day", () => {
    const { from, to } = dayWindow(new Date(2026, 2, 15, 14, 30));
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getDate()).toBe(15);
  });

  it("defaults to today", () => {
    const { from } = dayWindow();
    expect(from.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("monthWindow", () => {
  it("returns UTC bounds for a valid YYYY-MM", () => {
    const { from, to } = monthWindow("2025-01");
    expect(from.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    // January has 31 days → day 31 23:59:59.999
    expect(to.toISOString()).toBe("2025-01-31T23:59:59.999Z");
  });

  it("handles February of a leap year", () => {
    const { to } = monthWindow("2024-02");
    expect(to.toISOString()).toBe("2024-02-29T23:59:59.999Z");
  });

  it("falls back to the current month on invalid input", () => {
    const expected = new Date().toISOString().slice(0, 7);
    const { from } = monthWindow("2025-13");
    expect(from.toISOString().slice(0, 7)).toBe(expected);
  });
});

describe("shiftMonth", () => {
  it("wraps across year boundaries", () => {
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("shifts within the year", () => {
    expect(shiftMonth("2026-07", 2)).toBe("2026-09");
    expect(shiftMonth("2026-07", -3)).toBe("2026-04");
  });

  it("falls back to the current month for garbage input", () => {
    const expected = new Date().toISOString().slice(0, 7);
    expect(shiftMonth("nonsense", 5)).toBe(expected);
  });
});
