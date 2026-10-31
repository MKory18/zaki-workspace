import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  MIN_TEAM_FOR_MEDIAN,
  baselineFor,
  bandOf,
  composite,
  countToScore,
  currentPeriod,
  isFuture,
  manualAverage,
  manualToScore,
  median,
  onTimeToScore,
  parsePeriod,
  periodDays,
  periodOfDay,
  previousPeriod,
  previousPeriods,
  ratingAverage,
  readWeights,
  shownScore,
  suggestedLight,
  type IndicatorInput,
} from "@/lib/team-score";

/** «السكور» — the arithmetic, with fixed fixtures: no database, no clock, nothing invented. */

describe("periods: a month or a quarter, in the company's days", () => {
  it("parses months and quarters and nothing else", () => {
    expect(parsePeriod("2026-10")).toMatchObject({ kind: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriod("2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(parsePeriod("2028-02")).toMatchObject({ to: "2028-02-29" });
    expect(parsePeriod("2026-Q4")).toMatchObject({ kind: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(parsePeriod("2026-Q1")).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
    for (const bad of ["2026-13", "2026-00", "2026-Q5", "2026-Q0", "26-10", "2026-1", "x", "", "2026-10-01", "1999-10", "2101-01", null, 5, undefined]) {
      expect(parsePeriod(bad), String(bad)).toBeNull();
    }
  });

  it("no period is longer than the board's 92-day window", () => {
    for (let year = 2026; year <= 2028; year++) {
      for (let q = 1; q <= 4; q++) expect(periodDays(parsePeriod(`${year}-Q${q}`)!)).toBeLessThanOrEqual(92);
      for (let m = 1; m <= 12; m++) expect(periodDays(parsePeriod(`${year}-${String(m).padStart(2, "0")}`)!)).toBeLessThanOrEqual(31);
    }
  });

  it("finds the period of a day, the one before it and the three before that, across a year end", () => {
    expect(periodOfDay("2026-10-31", "month").key).toBe("2026-10");
    expect(periodOfDay("2026-10-31", "quarter").key).toBe("2026-Q4");
    expect(previousPeriod(parsePeriod("2026-01")!).key).toBe("2025-12");
    expect(previousPeriod(parsePeriod("2026-Q1")!).key).toBe("2025-Q4");
    expect(previousPeriods(parsePeriod("2026-02")!, 3).map((p) => p.key)).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(previousPeriods(parsePeriod("2026-Q2")!, 3).map((p) => p.key)).toEqual(["2026-Q1", "2025-Q4", "2025-Q3"]);
  });

  it("the current period follows the company's zone, not UTC (23:30 UTC on the 31st is already November in Damascus)", () => {
    const instant = new Date("2026-10-31T22:30:00Z");
    expect(currentPeriod(instant, "UTC").key).toBe("2026-10");
    expect(currentPeriod(instant, "Asia/Damascus").key).toBe("2026-11");
    expect(isFuture(parsePeriod("2026-11")!, "2026-10-31")).toBe(true);
    expect(isFuture(parsePeriod("2026-10")!, "2026-10-31")).toBe(false);
  });
});

describe("each indicator to 0-100", () => {
  it("reviewers' ratings: (average − 1) ÷ 4 × 100", () => {
    expect(manualToScore(1)).toBe(0);
    expect(manualToScore(3)).toBe(50);
    expect(manualToScore(5)).toBe(100);
    expect(manualToScore(4.2)).toBeCloseTo(80, 6);
    expect(manualToScore(null)).toBeNull();
  });

  it("on-time: the rate as it is; no rate is «—», never 0", () => {
    expect(onTimeToScore(0.75)).toBe(75);
    expect(onTimeToScore(0)).toBe(0);
    expect(onTimeToScore(1)).toBe(100);
    expect(onTimeToScore(null)).toBeNull();
  });

  it("a count against its baseline: 100 at it or above, proportional below, nothing without a baseline", () => {
    expect(countToScore(10, 10)).toBe(100);
    expect(countToScore(25, 10)).toBe(100);
    expect(countToScore(5, 10)).toBe(50);
    expect(countToScore(0, 10)).toBe(0);
    expect(countToScore(5, null)).toBeNull();
    expect(countToScore(5, 0)).toBeNull();
  });

  it("the ratings of a review are averaged per review first; a review with no rating does not count", () => {
    expect(ratingAverage({ a: 4, b: 2 })).toBe(3);
    expect(ratingAverage({})).toBeNull();
    expect(ratingAverage({ a: 9, b: 0 })).toBeNull(); // out of 1-5: ignored
    // two reviews: 5,5,5 (average 5) and 1 (average 1) → 3, not (5+5+5+1)/4 = 4
    expect(manualAverage([{ a: 5, b: 5, c: 5 }, { a: 1 }])).toEqual({ average: 3, count: 2 });
    expect(manualAverage([])).toEqual({ average: null, count: 0 });
    expect(manualAverage([{}])).toEqual({ average: null, count: 0 });
  });
});

describe("the baseline: the person's own median first, the team's median when there is no history", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([4])).toBe(4);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("uses the median of the last periods in which the person did something; zero periods are not history", () => {
    expect(baselineFor([6, 10, 8], [])).toEqual({ value: 8, source: "own", n: 3 });
    expect(baselineFor([0, 10, 6], [1, 2, 3, 4])).toEqual({ value: 8, source: "own", n: 2 });
    expect(baselineFor([0, 0, 7], [1, 2, 3])).toEqual({ value: 7, source: "own", n: 1 });
  });

  it("with no history of their own, the team's median of this period, but only when enough people have a number", () => {
    expect(baselineFor([0, 0, 0], [2, 4, 6, 0, 0])).toEqual({ value: 4, source: "team", n: 3 });
    expect(baselineFor([], [5, 9, 7])).toEqual({ value: 7, source: "team", n: 3 });
    expect(MIN_TEAM_FOR_MEDIAN).toBe(3);
    expect(baselineFor([], [5, 9])).toBeNull();
    expect(baselineFor([], [])).toBeNull();
    expect(baselineFor([0, 0, 0], [0, 0, 0, 5, 5])).toBeNull();
  });
});

describe("the composite: weighted average of what is present, weights re-normalised, nothing invented", () => {
  const inputs = (m: number | null, c: number | null, o: number | null, s: number | null): IndicatorInput[] => [
    { key: "manual", value: m },
    { key: "completed", value: c },
    { key: "onTime", value: o },
    { key: "steps", value: s },
  ];

  it("with every indicator present it is the plain weighted average: 50/20/20/10", () => {
    // 80·50 + 60·20 + 100·20 + 40·10 = 4000 + 1200 + 2000 + 400 = 7600 → 76
    const c = composite(inputs(80, 60, 100, 40), DEFAULT_WEIGHTS);
    expect(c.score).toBeCloseTo(76, 9);
    expect(c.lines.map((l) => l.share)).toEqual([50, 20, 20, 10]);
    expect(shownScore(c.score)).toBe(76);
  });

  it("a missing indicator is left out and the other weights are re-normalised over the present ones", () => {
    // no manual rating this period: 60·20 + 100·20 + 40·10 = 3600 over 50 → 72
    const c = composite(inputs(null, 60, 100, 40), DEFAULT_WEIGHTS);
    expect(c.score).toBeCloseTo(72, 9);
    expect(c.lines[0]).toMatchObject({ key: "manual", value: null, share: null });
    expect(c.lines.slice(1).map((l) => l.share)).toEqual([40, 40, 20]);
    expect(c.lines.reduce((sum, l) => sum + (l.share ?? 0), 0)).toBeCloseTo(100, 9);
  });

  it("only the reviewers' ratings present: they are the whole score; only one automatic indicator: it is", () => {
    expect(composite(inputs(75, null, null, null), DEFAULT_WEIGHTS).score).toBe(75);
    expect(composite(inputs(null, null, 90, null), DEFAULT_WEIGHTS).score).toBe(90);
  });

  it("nothing present: no score, no band, no light — never a zero", () => {
    const c = composite(inputs(null, null, null, null), DEFAULT_WEIGHTS);
    expect(c).toMatchObject({ score: null, band: null, light: null });
    expect(shownScore(c.score)).toBeNull();
  });

  it("a zero is a number: a person who finished 0 of a baseline of 10 scores 0 on that indicator (and drags the average down)", () => {
    const c = composite(inputs(null, 0, 100, null), { manual: 50, completed: 20, onTime: 20, steps: 10 });
    expect(c.score).toBe(50);
  });

  it("an owner's weight of 0 switches an indicator off, and the rest re-normalise", () => {
    const c = composite(inputs(80, 60, 100, 40), { manual: 100, completed: 0, onTime: 0, steps: 0 });
    expect(c.score).toBe(80);
    expect(c.lines.find((l) => l.key === "completed")?.share).toBeNull();
  });

  it("bands and the suggested light sit exactly at their edges", () => {
    expect(bandOf(80)).toBe("excellent");
    expect(bandOf(79.9)).toBe("good");
    expect(bandOf(60)).toBe("good");
    expect(bandOf(59.9)).toBe("support");
    expect(bandOf(null)).toBeNull();
    expect(suggestedLight(70)).toBe("GREEN");
    expect(suggestedLight(69.9)).toBe("AMBER");
    expect(suggestedLight(50)).toBe("AMBER");
    expect(suggestedLight(49.9)).toBe("RED");
    expect(suggestedLight(null)).toBeNull();
  });

  it("the owner's stored weights are read strictly: whole numbers 0-100 with one above zero, otherwise the defaults", () => {
    expect(readWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(readWeights({ manual: 40, completed: 30, onTime: 20, steps: 10 })).toEqual({ manual: 40, completed: 30, onTime: 20, steps: 10 });
    expect(readWeights({ manual: 100, completed: 0, onTime: 0, steps: 0 })).toEqual({ manual: 100, completed: 0, onTime: 0, steps: 0 });
    for (const bad of [{ manual: 0, completed: 0, onTime: 0, steps: 0 }, { manual: -1, completed: 30, onTime: 20, steps: 10 }, { manual: 50, completed: 20, onTime: 20 }, { manual: 50.5, completed: 20, onTime: 20, steps: 10 }, { manual: 101, completed: 0, onTime: 0, steps: 0 }, "x"]) {
      expect(readWeights(bad), JSON.stringify(bad)).toEqual(DEFAULT_WEIGHTS);
    }
  });
});
