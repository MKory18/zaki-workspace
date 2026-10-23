import { describe, expect, it } from "vitest";
import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";
import { dayWindow, monthWindow } from "../src/server/services/views";

/**
 * A mistyped zone must never throw: the window helpers resolve the zone first (a wrong name falls
 * back to the company default), and resolveTimeZone never throws for any input.
 */
describe("a mistyped zone name is resolved, never a RangeError", () => {
  it("dayWindow falls back to the company default for a wrong zone", () => {
    const now = new Date("2026-03-15T21:30:00Z");
    expect(() => dayWindow(now, "Asia/Damascuss")).not.toThrow();
    expect(() => dayWindow(now, "Not/AZone")).not.toThrow();
    expect(() => dayWindow(now, "")).not.toThrow();
    expect(() => dayWindow(now, undefined as unknown as string)).not.toThrow();
    // falling back to Asia/Damascus (UTC+3 in March): the same answer as the default zone's
    expect(dayWindow(now, "Not/AZone").from.toISOString()).toBe(dayWindow(now, "Asia/Damascus").from.toISOString());
  });

  it("resolveTimeZone never throws for any input, valid names come back as-is", () => {
    for (const bad of [undefined, null, "", "  ", "Mars/Olympus", " Not/AZone "]) {
      expect(() => resolveTimeZone(bad as string)).not.toThrow();
      expect(resolveTimeZone(bad as string)).toBe("Asia/Damascus");
    }
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("zonedDayStart still throws for a zone the platform does not know (the caller resolved first)", () => {
    expect(() => zonedDayStart(new Date(), "Not/AZone")).toThrow();
  });
});
