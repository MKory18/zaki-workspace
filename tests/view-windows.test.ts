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

describe("dayWindow with a company time zone", () => {
  it("is the COMPANY's day, whatever the server's clock says", () => {
    // 21:30 UTC on 15 March is 00:30 on 16 March in Damascus (UTC+3)
    const { from, to } = dayWindow(new Date("2026-03-15T21:30:00Z"), "Asia/Damascus");
    expect(from.toISOString()).toBe("2026-03-15T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-16T20:59:59.999Z");
  });

  it("the same instant is still the 15th in a zone behind UTC", () => {
    const { from } = dayWindow(new Date("2026-03-15T21:30:00Z"), "America/New_York");
    expect(from.toISOString()).toBe("2026-03-15T04:00:00.000Z"); // 00:00 EDT (UTC-4)
  });
});
