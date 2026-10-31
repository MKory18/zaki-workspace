import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKDAYS,
  MAX_ANSWER_LENGTH,
  NUDGE_DELAY_MS,
  cleanAnswers,
  cleanQuestions,
  defaultQuestions,
  idsOf,
  normalizeWeekdays,
  nudgeDue,
  openingFor,
  parseTimeOfDay,
  roundIsOpen,
  statsOfRounds,
  weekdaysOf,
} from "@/lib/checkins";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { zonedParts } from "@/lib/zoned-time";

/**
 * «التسجيل اليومي»: the pure rules. The schedule is the COMPANY's: its zone, its week (الأحد first), its day (closing at the
 * end of that day, which is 23 or 25 hours long when the clocks change).
 */

const DAMASCUS = "Asia/Damascus"; // UTC+3 all year
const NEW_YORK = "America/New_York"; // DST: 2031-03-09 spring forward, 2031-11-02 fall back
const SCHEDULE = { timeOfDay: "09:00", weekdays: DEFAULT_WEEKDAYS };
const at = (iso: string) => new Date(iso);

describe("the schedule: the company's zone, week and day", () => {
  it("2031-03-10 is a Monday in Damascus, and the week is counted from الأحد", () => {
    expect(zonedParts(at("2031-03-10T06:00:00Z"), DAMASCUS).weekday).toBe(1);
    expect(zonedParts(at("2031-03-09T06:00:00Z"), DAMASCUS).weekday).toBe(0);
  });

  it("Damascus: nothing before 09:00 local, the round opens at 09:00 and stays due all day, closing at the end of the company's day", () => {
    expect(openingFor(at("2031-03-10T05:59:59Z"), DAMASCUS, SCHEDULE)).toBeNull();
    const open = openingFor(at("2031-03-10T06:00:00Z"), DAMASCUS, SCHEDULE);
    expect(open).toMatchObject({ day: "2031-03-10" });
    expect(open?.scheduledAt.toISOString()).toBe("2031-03-10T06:00:00.000Z");
    expect(open?.closesAt.toISOString()).toBe("2031-03-10T21:00:00.000Z");
    // a runner that was down all morning still opens it, at 20:30 local
    expect(openingFor(at("2031-03-10T17:30:00Z"), DAMASCUS, SCHEDULE)?.day).toBe("2031-03-10");
  });

  it("the day is the company's, not the server's: 21:30 UTC is already Tuesday 00:30 in Damascus, so Monday's round is over and Tuesday's not yet due", () => {
    expect(zonedParts(at("2031-03-10T21:30:00Z"), DAMASCUS).weekday).toBe(2);
    expect(openingFor(at("2031-03-10T21:30:00Z"), DAMASCUS, SCHEDULE)).toBeNull();
    const tuesday = openingFor(at("2031-03-11T06:00:00Z"), DAMASCUS, SCHEDULE);
    expect(tuesday?.day).toBe("2031-03-11");
    expect(tuesday?.closesAt.toISOString()).toBe("2031-03-11T21:00:00.000Z");
  });

  it("only the configured weekdays: الأحد to الخميس by default, never الجمعة or السبت", () => {
    // 2031-03-14 is a Friday, 2031-03-15 a Saturday, 2031-03-16 a Sunday
    expect(openingFor(at("2031-03-14T09:00:00Z"), DAMASCUS, SCHEDULE)).toBeNull();
    expect(openingFor(at("2031-03-15T09:00:00Z"), DAMASCUS, SCHEDULE)).toBeNull();
    expect(openingFor(at("2031-03-16T09:00:00Z"), DAMASCUS, SCHEDULE)?.day).toBe("2031-03-16");
    expect(openingFor(at("2031-03-14T09:00:00Z"), DAMASCUS, { ...SCHEDULE, weekdays: [5] })?.day).toBe("2031-03-14");
  });

  it("a zone with DST: the time is local wall clock, and the day that loses an hour closes after 23 hours", () => {
    // Sunday 2031-03-09, New York springs forward at 02:00: 09:00 is EDT (UTC-4), 13:00Z
    expect(openingFor(at("2031-03-09T12:59:59Z"), NEW_YORK, SCHEDULE)).toBeNull();
    const spring = openingFor(at("2031-03-09T13:00:00Z"), NEW_YORK, SCHEDULE);
    expect(spring).toMatchObject({ day: "2031-03-09" });
    expect(spring?.scheduledAt.toISOString()).toBe("2031-03-09T13:00:00.000Z");
    expect(spring?.closesAt.toISOString()).toBe("2031-03-10T04:00:00.000Z");
    // midnight of that day was EST (05:00Z): the day is 23 hours long
    expect((spring!.closesAt.getTime() - Date.parse("2031-03-09T05:00:00Z")) / 3_600_000).toBe(23);
    // the day after, 09:00 EDT is still 13:00Z; before the change it was 14:00Z
    expect(openingFor(at("2031-03-08T13:59:59Z"), NEW_YORK, { timeOfDay: "09:00", weekdays: [6] })).toBeNull();
    expect(openingFor(at("2031-03-08T14:00:00Z"), NEW_YORK, { timeOfDay: "09:00", weekdays: [6] })?.scheduledAt.toISOString()).toBe("2031-03-08T14:00:00.000Z");
  });

  it("a zone with DST: the day that gains an hour closes after 25 hours", () => {
    // Sunday 2031-11-02, New York falls back at 02:00: 09:00 is EST (UTC-5), 14:00Z; midnight was EDT (04:00Z)
    const fall = openingFor(at("2031-11-02T14:00:00Z"), NEW_YORK, SCHEDULE);
    expect(fall?.day).toBe("2031-11-02");
    expect(fall?.closesAt.toISOString()).toBe("2031-11-03T05:00:00.000Z");
    expect((fall!.closesAt.getTime() - Date.parse("2031-11-02T04:00:00Z")) / 3_600_000).toBe(25);
  });

  it("a wrong time or no time of day opens nothing", () => {
    expect(openingFor(at("2031-03-10T12:00:00Z"), DAMASCUS, { timeOfDay: "25:00", weekdays: [1] })).toBeNull();
    expect(openingFor(at("2031-03-10T12:00:00Z"), DAMASCUS, { timeOfDay: "", weekdays: [1] })).toBeNull();
  });

  it("the round takes answers until its closing instant, exclusive", () => {
    const round = { closedAt: at("2031-03-10T21:00:00Z") };
    expect(roundIsOpen(round, at("2031-03-10T20:59:59.999Z"))).toBe(true);
    expect(roundIsOpen(round, at("2031-03-10T21:00:00Z"))).toBe(false);
  });
});

describe("the nudge: once, three hours after opening, while the round is open", () => {
  const round = { openedAt: at("2031-03-10T06:00:00Z"), closedAt: at("2031-03-10T21:00:00Z"), nudgedAt: null as Date | null };
  it("is due at +3h exactly, not before", () => {
    expect(NUDGE_DELAY_MS).toBe(3 * 3_600_000);
    expect(nudgeDue(round, at("2031-03-10T08:59:59Z"))).toBe(false);
    expect(nudgeDue(round, at("2031-03-10T09:00:00Z"))).toBe(true);
  });
  it("is never due twice, nor after the round closed", () => {
    expect(nudgeDue({ ...round, nudgedAt: at("2031-03-10T09:00:00Z") }, at("2031-03-10T10:00:00Z"))).toBe(false);
    expect(nudgeDue(round, at("2031-03-10T21:00:00Z"))).toBe(false);
  });
});

describe("what a configuration and an answer may hold", () => {
  it("time of day is HH:MM, 24 hours", () => {
    expect(parseTimeOfDay("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    for (const bad of ["9:00", "24:00", "09:60", "09-00", "", 900, null, undefined]) expect(parseTimeOfDay(bad), String(bad)).toBeNull();
  });

  it("weekdays: whole numbers 0 to 6, sorted, no repeats, at least one", () => {
    expect(normalizeWeekdays([4, 0, 2, 2])).toEqual([0, 2, 4]);
    for (const bad of [[], [7], [-1], [1.5], ["1"], "0", null, [0, 1, 2, 3, 4, 5, 6, 0]]) expect(normalizeWeekdays(bad), JSON.stringify(bad)).toBeNull();
    expect(weekdaysOf(null)).toEqual([0, 1, 2, 3, 4]);
    expect(weekdaysOf([6, 5])).toEqual([5, 6]);
  });

  it("questions: one to five, trimmed, each 1 to 200 characters", () => {
    expect(cleanQuestions([" شو؟ ", "ليش؟"])).toEqual(["شو؟", "ليش؟"]);
    expect(cleanQuestions([])).toBeNull();
    expect(cleanQuestions(["1", "2", "3", "4", "5", "6"])).toBeNull();
    expect(cleanQuestions(["   "])).toBeNull();
    expect(cleanQuestions(["x".repeat(201)])).toBeNull();
    expect(cleanQuestions(["x".repeat(200)])).toEqual(["x".repeat(200)]);
    expect(cleanQuestions([1])).toBeNull();
    expect(cleanQuestions("x")).toBeNull();
  });

  it("the defaults are the owner's three questions, in his words", () => {
    expect(defaultQuestions()).toEqual(["شو خلّصت أمس؟", "شو بدك تخلّص اليوم؟", "في شي عاثر معك؟"]);
  });

  it("answers: one per question (fewer are padded), each at most 1000 characters, one not blank", () => {
    expect(cleanAnswers(["أ", " ب "], 3)).toEqual({ ok: true, answers: ["أ", "ب", ""] });
    expect(cleanAnswers(["", "  ", ""], 3)).toEqual({ ok: false, problem: "empty" });
    expect(cleanAnswers(["a", "b", "c", "d"], 3)).toEqual({ ok: false, problem: "count" });
    expect(cleanAnswers("x", 3)).toEqual({ ok: false, problem: "count" });
    expect(cleanAnswers([1], 3)).toEqual({ ok: false, problem: "count" });
    expect(cleanAnswers(["x".repeat(MAX_ANSWER_LENGTH + 1)], 1)).toEqual({ ok: false, problem: "long" });
    expect(cleanAnswers(["x".repeat(MAX_ANSWER_LENGTH)], 1)).toMatchObject({ ok: true });
  });

  it("id lists keep strings only, once each, up to a cap", () => {
    expect(idsOf(["a", "b", "a", 3, "", null, "c"])).toEqual(["a", "b", "c"]);
    expect(idsOf(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(idsOf("a")).toEqual([]);
  });
});

describe("the counts", () => {
  const closed = at("2031-03-11T00:00:00Z");
  const round = (day: string, participantIds: string[], answers: { userId: string; excused: boolean }[], closedAt = closed) => ({ day, closedAt, participantIds, answers });
  const NOW = at("2031-03-12T00:00:00Z");

  it("answered, missed and excused are counted apart, per person per day and per person", () => {
    const { days, people } = statsOfRounds(
      [
        round("2031-03-09", ["a", "b", "c"], [{ userId: "a", excused: false }, { userId: "b", excused: true }]),
        round("2031-03-10", ["a", "b", "c"], [{ userId: "a", excused: false }, { userId: "c", excused: false }]),
      ],
      NOW,
    );
    expect(days.filter((d) => d.day === "2031-03-09")).toEqual([
      { userId: "a", day: "2031-03-09", answered: 1, missed: 0, excused: 0, pending: 0 },
      { userId: "b", day: "2031-03-09", answered: 0, missed: 0, excused: 1, pending: 0 },
      { userId: "c", day: "2031-03-09", answered: 0, missed: 1, excused: 0, pending: 0 },
    ]);
    expect(people).toEqual([
      { userId: "a", answered: 2, missed: 0, excused: 0, pending: 0 },
      { userId: "b", answered: 0, missed: 1, excused: 1, pending: 0 },
      { userId: "c", answered: 1, missed: 1, excused: 0, pending: 0 },
    ]);
  });

  it("a round still open counts «pending», never missed; an excused day is never missed", () => {
    const open = round("2031-03-12", ["a", "b"], [{ userId: "b", excused: true }], at("2031-03-12T21:00:00Z"));
    const { days } = statsOfRounds([open], NOW);
    expect(days).toEqual([
      { userId: "a", day: "2031-03-12", answered: 0, missed: 0, excused: 0, pending: 1 },
      { userId: "b", day: "2031-03-12", answered: 0, missed: 0, excused: 1, pending: 0 },
    ]);
  });

  it("somebody who answered without being in the morning's list still counts as answered; no rounds, no counts", () => {
    const { days } = statsOfRounds([round("2031-03-10", ["a"], [{ userId: "z", excused: false }])], NOW);
    expect(days.find((d) => d.userId === "z")).toMatchObject({ answered: 1, missed: 0 });
    expect(statsOfRounds([], NOW)).toEqual({ days: [], people: [] });
  });

  it("every day of every person adds up to exactly one state", () => {
    const rounds = [
      round("2031-03-08", ["a", "b"], [{ userId: "a", excused: false }]),
      round("2031-03-09", ["a", "b"], [{ userId: "b", excused: true }]),
      round("2031-03-12", ["a", "b"], [], at("2031-03-13T00:00:00Z")),
    ];
    const { days, people } = statsOfRounds(rounds, NOW);
    for (const d of days) expect(d.answered + d.missed + d.excused + d.pending, `${d.userId} ${d.day}`).toBe(1);
    expect(people.reduce((n, p) => n + p.answered + p.missed + p.excused + p.pending, 0)).toBe(days.length);
  });
});

describe("«التسجيل اليومي» is a switch: on by default, with its words", () => {
  it("is a feature, default on, with a name and a hint in Arabic", () => {
    expect(FEATURES).toContain("checkins");
    expect(FEATURE_DEFAULTS.checkins).toBe(true);
    expect(featureOn({}, "checkins")).toBe(true);
    expect(featureOn({ features: { checkins: false } }, "checkins")).toBe(false);
    expect(AR["features.checkins.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.checkins.hint"]).toMatch(/[؀-ۿ]/);
  });
});
