import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/checkins",
}));

import { AR } from "@/lib/i18n/dict";
import { CheckinForm, RosterSummary, TeamAnswers } from "@/components/checkins/checkin-parts";
import { TodayPanel } from "@/components/checkins/checkins-view";
import { HistoryList } from "@/components/checkins/history-panel";
import { CheckinCardBody } from "@/components/checkins/my-checkin-card";
import { SettingsForm } from "@/components/checkins/settings-dialog";
import type { AnswerDto, HistoryView, RosterEntry, TodayView } from "@/server/services/checkins";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The rules every screen of the feature keeps: theme tokens only, logical (RTL-safe) directions, no raw hex. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

const QUESTIONS = ["شو خلّصت أمس؟", "شو بدك تخلّص اليوم؟", "في شي عاثر معك؟"];
const roster: RosterEntry[] = [
  { userId: "u1", name: "سارة", status: "answered" },
  { userId: "u2", name: "عمر", status: "excused" },
  { userId: "u3", name: "ليلى", status: "pending" },
];
const counts = { answered: 1, excused: 1, pending: 1, missed: 0 };
const answer = (over: Partial<AnswerDto> = {}): AnswerDto => ({
  userId: "u1",
  userName: "سارة",
  answers: ["خلصت التقرير", "بدي أراجع العقد", ""],
  tasks: [{ id: "t1", title: "مراجعة العقد" }],
  submittedAt: "2031-03-10T07:00:00.000Z",
  editedAt: null,
  ...over,
});

const today = (over: Partial<TodayView> = {}): TodayView => ({
  enabled: true,
  canManage: false,
  timeZone: "Asia/Damascus",
  day: "2031-03-10",
  schedule: { timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4] },
  round: { id: "r1", day: "2031-03-10", questions: QUESTIONS, open: true, openedAt: "2031-03-10T06:00:00.000Z", closesAt: "2031-03-10T21:00:00.000Z" },
  me: { participant: true, answered: false, excused: false, answers: [], taskIds: [], tasks: [], canEdit: true },
  myTasks: [{ id: "t1", title: "مراجعة العقد" }],
  roster,
  counts,
  team: null,
  ...over,
});

describe("the form of today", () => {
  const markup = render(createElement(CheckinForm, { questions: QUESTIONS, initial: { answers: [], taskIds: [] }, tasks: [{ id: "t1", title: "مراجعة العقد" }, { id: "t2", title: "إرسال الفاتورة" }], alreadySent: false }));

  it("draws one box per question, each capped at 1000 characters and named after its question", () => {
    expect(markup.match(/<textarea/g)).toHaveLength(3);
    expect(markup.match(/maxLength="1000"|maxlength="1000"/gi)).toHaveLength(3);
    for (const q of QUESTIONS) expect(textOf(markup)).toContain(q);
    expect(markup).toContain(`aria-label="${AR["checkins.form.answer_label"]!.replace("{question}", QUESTIONS[0]!)}"`);
  });

  it("offers «مهام اليوم» as ticks, the submit button (disabled while everything is blank) and «إجازة اليوم»", () => {
    expect(textOf(markup)).toContain("مهام اليوم");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(textOf(markup)).toContain("مراجعة العقد");
    expect(textOf(markup)).toContain("إرسال التسجيل");
    expect(/<button[^>]*type="submit"[^>]*disabled/.test(markup)).toBe(true);
    expect(textOf(markup)).toContain("إجازة اليوم");
  });

  it("an answer already sent shows the edit button and the edit hint, and no «إجازة اليوم»", () => {
    const sent = render(createElement(CheckinForm, { questions: QUESTIONS, initial: { answers: ["أ", "", ""], taskIds: ["t1"] }, tasks: [{ id: "t1", title: "مراجعة العقد" }], alreadySent: true }));
    expect(textOf(sent)).toContain("حفظ التعديل");
    expect(textOf(sent)).toContain(AR["checkins.form.edit_hint"]);
    expect(textOf(sent)).not.toContain("إجازة اليوم");
    expect(/<button[^>]*type="submit"[^>]*disabled/.test(sent)).toBe(false);
    expect(sent).toMatch(/checked/);
  });

  it("says why it failed in the dictionary's words, and nothing in English", () => {
    const failed = render(createElement(CheckinForm, { questions: QUESTIONS, initial: { answers: ["أ"], taskIds: [] }, tasks: [], alreadySent: false, error: "checkins.e.closed" }));
    expect(failed).toContain('role="alert"');
    expect(textOf(failed)).toContain(AR["checkins.e.closed"]);
    expect(textOf(failed)).toContain(AR["checkins.form.no_tasks"]);
    expect(textOf(markup)).not.toMatch(/[A-Za-z]{3,}/);
  });

  it("keeps to the theme's tokens and logical directions", () => expectClean(markup));
});

describe("the summary: who answered and who did not", () => {
  const markup = render(createElement(RosterSummary, { roster, counts }));

  it("lists each person with their state, and the counts in words", () => {
    expect(markup).toContain('data-person="u1"');
    expect(textOf(markup)).toContain("سارة");
    expect(/data-status="answered"/.test(markup)).toBe(true);
    expect(/data-status="excused"/.test(markup)).toBe(true);
    expect(/data-status="pending"/.test(markup)).toBe(true);
    expect(textOf(markup)).toContain("في إجازة");
    expect(textOf(markup)).toContain("سجّل 1 · إجازة 1 · لم يسجّل بعد 1 · لم يسجّل 0");
  });

  it("an empty round says so", () => {
    expect(textOf(render(createElement(RosterSummary, { roster: [], counts: { answered: 0, excused: 0, pending: 0, missed: 0 } })))).toContain(AR["checkins.roster.empty"]);
  });

  it("keeps to the theme's tokens and logical directions", () => expectClean(markup));
});

describe("the team's answers", () => {
  it("are hidden, with the reason, until the reader has answered (null from the server)", () => {
    const locked = render(createElement(TeamAnswers, { team: null, questions: QUESTIONS, silent: false }));
    expect(locked).toContain("data-team-locked");
    expect(textOf(locked)).toContain(AR["checkins.team.locked"]);
    expect(locked).not.toContain("data-answer-of");
  });

  it("show each person's texts under the questions, with their tasks as read-only links", () => {
    const shown = render(createElement(TeamAnswers, { team: [answer(), answer({ userId: "u3", userName: "ليلى", answers: ["أنهيت التصميم", "", ""], tasks: [], editedAt: "2031-03-10T08:00:00.000Z" })], questions: QUESTIONS, silent: false }));
    expect(shown.match(/data-answer-of=/g)).toHaveLength(2);
    expect(textOf(shown)).toContain("خلصت التقرير");
    expect(textOf(shown)).toContain(QUESTIONS[1]);
    expect(shown).toContain('href="/tasks/t1"');
    expect(shown).toContain('data-task-chip="t1"');
    expect(textOf(shown)).toContain(AR["checkins.team.edited"]);
    expectClean(shown);
  });

  it("the owner's and the space ADMIN's reading says it is silent; an empty list says there is nothing yet", () => {
    expect(textOf(render(createElement(TeamAnswers, { team: [], questions: QUESTIONS, silent: true })))).toContain(AR["checkins.team.silent"]);
    expect(textOf(render(createElement(TeamAnswers, { team: [], questions: QUESTIONS, silent: false })))).toContain(AR["checkins.team.empty"]);
  });

  it("an answer's text is plain text, never markup", () => {
    const hostile = render(createElement(TeamAnswers, { team: [answer({ answers: ["<script>alert(1)</script>", "", ""] })], questions: QUESTIONS, silent: false }));
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&lt;script&gt;");
  });
});

describe("the page's panel for today", () => {
  it("off: says so, and tells the space's ADMIN where to turn it on", () => {
    const member = render(createElement(TodayPanel, { view: today({ enabled: false, round: null, me: null }) }));
    expect(member).toContain("data-checkins-off");
    expect(textOf(member)).toContain(AR["checkins.off.member"]);
    const manager = render(createElement(TodayPanel, { view: today({ enabled: false, canManage: true, round: null, me: null }) }));
    expect(textOf(manager)).toContain(AR["checkins.off.manage"]);
  });

  it("on but before its time: says when the round opens and on which days", () => {
    const waiting = render(createElement(TodayPanel, { view: today({ round: null, me: null }) }));
    expect(waiting).toContain("data-checkins-waiting");
    expect(textOf(waiting)).toContain("09:00");
    expect(textOf(waiting)).toContain("الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس");
  });

  it("on a day the check-in does not run, says so with the days it runs on", () => {
    // 2031-03-14 is a Friday
    const friday = render(createElement(TodayPanel, { view: today({ day: "2031-03-14", round: null, me: null }) }));
    expect(textOf(friday)).toContain("ليس اليوم يوم تسجيل");
    expect(textOf(friday)).toContain("الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس");
  });

  it("open and not answered yet: the form and the roster, the teammates' answers still closed", () => {
    const panel = render(createElement(TodayPanel, { view: today() }));
    expect(panel).toContain("data-checkin-form");
    expect(panel).toContain("data-checkins-roster");
    expect(panel).toContain("data-team-locked");
    expectClean(panel);
  });

  it("answered: the form to edit, and the teammates' answers", () => {
    const view = today({
      me: { participant: true, answered: true, excused: false, answers: ["أ", "ب", ""], taskIds: ["t1"], tasks: [{ id: "t1", title: "مراجعة العقد" }], canEdit: true },
      team: [answer()],
    });
    const panel = render(createElement(TodayPanel, { view }));
    expect(textOf(panel)).toContain("حفظ التعديل");
    expect(panel).toContain('data-answer-of="u1"');
    expect(panel).not.toContain("data-team-locked");
  });

  it("excused: the banner with «إلغاء الإجازة» and no form", () => {
    const panel = render(createElement(TodayPanel, { view: today({ me: { participant: true, answered: false, excused: true, answers: [], taskIds: [], tasks: [], canEdit: true } }) }));
    expect(panel).toContain("data-checkins-excused");
    expect(textOf(panel)).toContain("إلغاء الإجازة");
    expect(panel).not.toContain("data-checkin-form");
  });

  it("closed: says it is closed and offers no form; a reader who is not a participant is told so", () => {
    const closed = render(createElement(TodayPanel, { view: today({ round: { ...today().round!, open: false } }) }));
    expect(textOf(closed)).toContain(AR["checkins.round.closed"]);
    expect(closed).not.toContain("data-checkin-form");
    const outside = render(createElement(TodayPanel, { view: today({ canManage: true, me: { participant: false, answered: false, excused: false, answers: [], taskIds: [], tasks: [], canEdit: false }, team: [answer()] }) }));
    expect(outside).toContain("data-checkins-not-participant");
    expect(outside).not.toContain("data-checkin-form");
    expect(textOf(outside)).toContain(AR["checkins.team.silent"]);
  });
});

describe("the history", () => {
  const data: HistoryView = {
    timeZone: "Asia/Damascus",
    from: "2031-03-01",
    to: "2031-03-10",
    people: [{ id: "u1", name: "سارة" }],
    rounds: [
      { round: { id: "r2", day: "2031-03-10", questions: QUESTIONS, open: false, openedAt: "2031-03-10T06:00:00.000Z", closesAt: "2031-03-10T21:00:00.000Z" }, roster, counts, canSee: true, answers: [answer()] },
      { round: { id: "r1", day: "2031-03-09", questions: QUESTIONS, open: false, openedAt: "2031-03-09T06:00:00.000Z", closesAt: "2031-03-09T21:00:00.000Z" }, roster, counts, canSee: false, answers: [] },
    ],
  };

  it("lists the rounds newest first, a day by its Arabic name, with the answers of the rounds the reader may open", () => {
    const markup = render(createElement(HistoryList, { data }));
    expect(markup.indexOf('data-round-day="2031-03-10"')).toBeLessThan(markup.indexOf('data-round-day="2031-03-09"'));
    expect(textOf(markup)).toContain("الاثنين 10 آذار 2031");
    expect(markup).toContain('data-answer-of="u1"');
    expectClean(markup);
  });

  it("a round the reader did not answer says so instead of showing its answers", () => {
    const markup = render(createElement(HistoryList, { data }));
    expect(markup).toContain("data-round-locked");
    expect(textOf(markup)).toContain(AR["checkins.history.locked"]);
  });

  it("no rounds in the period says so", () => {
    expect(textOf(render(createElement(HistoryList, { data: { ...data, rounds: [] } })))).toContain(AR["checkins.history.empty"]);
  });
});

describe("the card on «اليوم»", () => {
  it("«لسا ما سجّلت» with a way in, when the round is open and not answered", () => {
    const markup = render(createElement(CheckinCardBody, { state: "pending" }));
    expect(textOf(markup)).toContain("تسجيلك اليومي");
    expect(textOf(markup)).toContain("لسا ما سجّلت");
    expect(markup).toContain('href="/checkins"');
    expectClean(markup);
  });

  it("says so when answered or on leave, and draws nothing when there is nothing for the person today", () => {
    expect(textOf(render(createElement(CheckinCardBody, { state: "answered" })))).toContain(AR["checkins.card.answered"]);
    expect(textOf(render(createElement(CheckinCardBody, { state: "excused" })))).toContain(AR["checkins.card.excused"]);
    expect(render(createElement(CheckinCardBody, { state: "none" }))).toBe("");
  });

  it("is mounted on the Today page by one line, only while the switch is on and never for a partner", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).toMatch(/\{checkinsOn \? <MyCheckinCard \/> : null\}/);
    expect(page).toMatch(/!actor\.isExternal && \(await actorFeatureOn\(actor, "checkins"\)\)/);
  });
});

describe("the settings of a space", () => {
  const initial = { active: true, questions: [...QUESTIONS], timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL" as const, participantIds: [] };
  const people = [{ id: "u1", name: "سارة" }, { id: "u2", name: "عمر" }];

  it("shows the questions, the time, the seven weekdays, and the participants choice", () => {
    const markup = render(createElement(SettingsForm, { initial, candidates: people, timeZone: "Asia/Damascus" }));
    expect(markup).toContain("data-checkin-settings");
    for (const q of QUESTIONS) expect(markup).toContain(q);
    expect(markup).toMatch(/type="time"/);
    for (const day of ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]) expect(textOf(markup)).toContain(day);
    expect(textOf(markup)).toContain("بتوقيت الشركة: Asia/Damascus");
    expect(textOf(markup)).toContain(AR["checkins.settings.participants_all"]);
    expect(textOf(markup)).toContain(AR["checkins.settings.warn"]);
    expect(textOf(markup)).toContain(AR["checkins.settings.fix"]);
    expectClean(markup);
  });

  it("offers «إضافة سؤال» under five questions and not at five", () => {
    expect(textOf(render(createElement(SettingsForm, { initial, candidates: people, timeZone: "Asia/Damascus" })))).toContain(AR["checkins.settings.add_question"]);
    const five = { ...initial, questions: ["1", "2", "3", "4", "5"] };
    expect(textOf(render(createElement(SettingsForm, { initial: five, candidates: people, timeZone: "Asia/Damascus" })))).not.toContain(AR["checkins.settings.add_question"]);
  });

  it("a chosen list shows the people to tick; saving is off while a list is empty", () => {
    const list = render(createElement(SettingsForm, { initial: { ...initial, participantsMode: "LIST" }, candidates: people, timeZone: "Asia/Damascus" }));
    expect(textOf(list)).toContain("سارة");
    expect(textOf(list)).toContain("عمر");
    expect(/<button[^>]*type="submit"[^>]*disabled/.test(list)).toBe(true);
  });
});

describe("the dictionary and the code agree", () => {
  const pages = ["src/components/checkins/checkin-parts.tsx", "src/components/checkins/checkins-view.tsx", "src/components/checkins/history-panel.tsx", "src/components/checkins/settings-dialog.tsx", "src/components/checkins/my-checkin-card.tsx", "src/lib/checkins-client.ts", "src/lib/checkins.ts", "src/server/services/checkins.ts", "src/server/services/checkins-space.ts", "src/server/jobs/checkins.ts"];

  it("every literal key the checkin code names exists, and every checkin string is used", () => {
    const named = new Set<string>();
    for (const file of pages) for (const m of read(file).matchAll(/["'`]((?:checkins\.|notif\.type\.checkin)[\w.]*)["'`]/g)) if (m[1] !== "checkins.config_saved") named.add(m[1]!); // the audit action's name, not a string
    // keys built from a status or a tab name
    for (const s of ["answered", "excused", "pending", "missed"]) named.add(`checkins.status.${s}`);
    for (const s of ["today", "history"]) named.add(`checkins.tab.${s}`);
    for (const key of named) expect(AR[key], key).toBeTruthy();
    const own = Object.keys(JSON.parse(read("src/lib/i18n/ar.checkins.json")) as Record<string, string>);
    const unused = own.filter((key) => !named.has(key) && !["nav.tab.checkins", "checkins.title"].includes(key) && !read("src/lib/nav/places.ts").includes(key) && !read("src/app/(app)/checkins/page.tsx").includes(key));
    expect(unused, "strings no checkin code uses").toEqual([]);
  });

  it("the error strings are written in plain Arabic (فصحى), with no Latin letter", () => {
    const own = JSON.parse(read("src/lib/i18n/ar.checkins.json")) as Record<string, string>;
    for (const [key, value] of Object.entries(own)) if (key.startsWith("checkins.e.")) expect(value, key).not.toMatch(/[A-Za-z]/);
  });
});
