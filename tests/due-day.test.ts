import { describe, expect, it } from "vitest";
import { dueDayOf, dueInstantForDay, dayOfInstant, parseDayText } from "@/lib/due-day";
import { zonedParts } from "@/lib/zoned-time";

/**
 * B5 (Phase B review, fixed in Phase E): a due date is the day a person PICKED, in the company's zone.
 *
 * The date box used to build the instant itself (`new Date("2026-11-05T12:00:00")`), so the browser's
 * clock chose the day: somebody working from another country — or a phone set elsewhere — saved a day
 * the company does not live in, and the card showed the day before or the day after. The server now
 * turns the plain day into noon in the company's zone, and the screens show the company's day back.
 */
describe("a due day belongs to the company's zone, never the browser's", () => {
  it("the same picked day is noon in the company's zone — three hours apart is three hours, not another day", () => {
    const damascus = dueInstantForDay("2026-11-05", "Asia/Damascus");
    const utc = dueInstantForDay("2026-11-05", "UTC");
    expect(damascus?.toISOString()).toBe("2026-11-05T09:00:00.000Z"); // noon in Damascus, three hours ahead of UTC in November
    expect(utc?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    // either way the company reads back the day that was picked
    expect(dayOfInstant(damascus!, "Asia/Damascus")).toBe("2026-11-05");
    expect(dayOfInstant(utc!, "UTC")).toBe("2026-11-05");
  });

  it("a stored instant is shown as the company's day: 22:30 UTC on the 5th is already the 6th in Damascus", () => {
    const instant = new Date("2026-11-05T22:30:00Z");
    expect(dayOfInstant(instant, "Asia/Damascus")).toBe("2026-11-06");
    expect(dayOfInstant(instant, "UTC")).toBe("2026-11-05");
    expect(dueDayOf(instant, "Asia/Damascus")?.day).toBe("2026-11-06");
    expect(dueDayOf(instant, "Asia/Damascus")?.noon.toISOString()).toBe("2026-11-06T09:00:00.000Z");
  });

  it("a day that a browser in another hemisphere would send is the same day everywhere", () => {
    // the person in Tokyo picks the 5th; the browser in New York renders the same task the same day
    const stored = dueInstantForDay("2026-11-05", "Asia/Damascus")!;
    for (const zone of ["Asia/Damascus", "UTC", "America/New_York", "Asia/Tokyo", "Pacific/Auckland"]) {
      expect(dayOfInstant(stored, zone), zone).toBe("2026-11-05");
    }
  });

  it("nothing that is not a plain day is turned into one", () => {
    for (const bad of ["", "2026-11", "2026-13-01", "2026-00-10", "2026-11-32", "5/11/2026", "2026-11-05T10:00:00Z"]) {
      expect(parseDayText(bad), bad).toBeNull();
      expect(dueInstantForDay(bad, "UTC"), bad).toBeNull();
    }
    expect(parseDayText(" 2026-11-05 ")).toEqual({ year: 2026, month: 11, day: 5 });
  });

  it("noon is the company's noon, so no change of the clocks can move the day", () => {
    // spring forward (Damascus leaves DST) and autumn back: noon on either side is still the same date there
    for (const day of ["2026-03-27", "2026-03-28", "2026-10-30", "2026-10-31"]) {
      const instant = dueInstantForDay(day, "Asia/Damascus")!;
      const p = zonedParts(instant, "Asia/Damascus");
      expect(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, day).toBe(day);
      expect(p.hour).toBe(12);
    }
  });
});
