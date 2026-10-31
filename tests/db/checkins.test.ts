import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as configRoute from "@/app/api/checkins/config/route";
import * as todayRoute from "@/app/api/checkins/today/route";
import * as answerRoute from "@/app/api/checkins/answer/route";
import * as excuseRoute from "@/app/api/checkins/excuse/route";
import * as historyRoute from "@/app/api/checkins/history/route";
import * as mineRoute from "@/app/api/checkins/mine/route";
import { withFeature } from "@/lib/features";
import { dayKey } from "@/lib/time-tracking";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { runDueJobs } from "@/server/jobs/run";
import { flushPushesForTests } from "@/server/notify";
import { cardState, checkinStats, getToday, history, saveConfig, setExcused, submitAnswer } from "@/server/services/checkins";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «التسجيل اليومي» — a short daily stand-up per space (the owner's approved backlog, 2026-10-31).
 *
 * What this pins, against a real PostgreSQL:
 *  - `runDueJobs(now)` opens ONE round per space per day, however many runners race (INSERT ... ON CONFLICT DO NOTHING), and
 *    writes one bell notice per participant in that same commit; the round holds the questions and the people of that morning;
 *  - the schedule is the COMPANY's: its zone (Asia/Damascus and a zone with DST), its weekdays, its end of day;
 *  - a participant answers once, edits until the round closes, and is refused after; the texts are bounded; the tasks attached
 *    are their own open ones;
 *  - nobody copies: a member reads the teammates' answers only after submitting their own (the owner and the space's ADMIN
 *    read all, silently: nothing is written); a person outside the space never, a guest never;
 *  - «إجازة اليوم» is counted apart from missed; one nudge at +3 hours, once per person, never to those who answered or are
 *    excused; a suspended person is skipped; the list of participants is respected;
 *  - the switch off: every route 404, the runner skips; on again, the round opens;
 *  - the push and the bell carry generic words, never an answer; `checkinStats` adds up.
 */

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

beforeEach(async () => {
  // the runner works on EVERY company's check-ins and the test database is shared by the whole file: start each test empty
  await db.checkinRound.deleteMany({});
  await db.checkinConfig.deleteMany({});
  await db.notification.deleteMany({ where: { type: { in: ["checkin_open", "checkin_nudge"] } } });
  setPushSenderForTests(null);
});
afterAll(async () => {
  await db.checkinRound.deleteMany({});
  await db.checkinConfig.deleteMany({});
  await db.notification.deleteMany({ where: { type: { in: ["checkin_open", "checkin_nudge"] } } });
  setPushSenderForTests(null);
});

const HOUR = 3_600_000;
// Damascus is UTC+3 all year: Monday 2031-03-10 09:00 local is 06:00Z, the round closes at 21:00Z, the nudge is due at 09:00Z
const OPEN = new Date("2031-03-10T06:00:00.000Z");
const at = (ms: number) => new Date(OPEN.getTime() + ms);
const QUESTIONS = ["شو خلّصت أمس؟", "شو بدك تخلّص اليوم؟", "في شي عاثر معك؟"];

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "زميل" });
  const lead = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "قائد المساحة" });
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "غريب عن المساحة" });
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.member.id }, { userId: mate.id }, { userId: lead.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }],
    "مساحة التسجيل",
  );
  // a second space: the outsider is its ADMIN, the member is not in it
  const other = await makeWorkspace(team.org.id, [{ userId: outsider.id, role: "ADMIN" }, { userId: mate.id }], "مساحة ثانية");
  return { ...team, mate, lead, outsider, ws, other };
}

type World = Awaited<ReturnType<typeof world>>;

const configure = (spaceId: string, over: Partial<Prisma.CheckinConfigUncheckedCreateInput> = {}) =>
  db.checkinConfig.create({ data: { workspaceId: spaceId, questions: QUESTIONS, timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL", participantIds: [], active: true, ...over } });

/** A round written straight to the table, for the tests that go through the routes (they read the real clock). */
async function liveRound(w: World, participantIds: string[], over: Partial<Prisma.CheckinRoundUncheckedCreateInput> = {}) {
  const day = dayKey(new Date(), "Asia/Damascus");
  return db.checkinRound.create({
    data: { workspaceId: w.ws.id, day: new Date(`${day}T00:00:00.000Z`), openedAt: new Date(Date.now() - HOUR), closedAt: new Date(Date.now() + 6 * HOUR), questions: QUESTIONS, participantIds, ...over },
  });
}

const everyone = (w: World) => [w.member.id, w.mate.id, w.lead.id, w.admin.id];
const ANSWER = ["خلصت التقرير", "بدي أراجع العقد", ""];
const notices = (userId: string, type = "checkin_open") => db.notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "checkins", on) as Prisma.InputJsonValue } });
}

const openedBy = async (w: World, now = OPEN) => {
  await runDueJobs(now);
  return db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.ws.id } });
};

describe("the runner opens a round: once per space per day", () => {
  it("opens it at the configured time with the questions and the people of that morning, and tells each of them once", async () => {
    const w = await world();
    await configure(w.ws.id);
    const before = await runDueJobs(at(-1000));
    expect(before.checkins).toMatchObject({ opened: 0 });
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(0);

    const run = await runDueJobs(OPEN);
    expect(run.failed).toEqual([]);
    const rounds = await db.checkinRound.findMany({ where: { workspaceId: w.ws.id } });
    expect(rounds).toHaveLength(1);
    const round = rounds[0]!;
    expect(round.day.toISOString().slice(0, 10)).toBe("2031-03-10");
    expect(round.openedAt.toISOString()).toBe(OPEN.toISOString());
    expect(round.closedAt.toISOString()).toBe("2031-03-10T21:00:00.000Z");
    expect(round.questions).toEqual(QUESTIONS);
    // everybody ACTIVE and not a guest: the member, the mate, the space admin (the lead) and the org admin who is in it; never the guest, the owner (no row) or the outsider
    expect([...(round.participantIds as string[])].sort()).toEqual(everyone(w).sort());
    for (const id of everyone(w)) expect(await notices(id), id).toHaveLength(1);
    for (const id of [w.guest.id, w.owner.id, w.outsider.id]) expect(await notices(id), id).toHaveLength(0);
    const one = (await notices(w.member.id))[0]!;
    expect(one).toMatchObject({ type: "checkin_open", linkUrl: "/checkins", workspaceId: w.ws.id, organizationId: w.org.id });

    // a second run the same day changes nothing
    await runDueJobs(at(HOUR));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(1);
    expect(await notices(w.member.id)).toHaveLength(1);
  });

  it("two runners at the same moment make ONE round and ONE notice each", async () => {
    const w = await world();
    await configure(w.ws.id);
    const runs = await Promise.all([runDueJobs(OPEN), runDueJobs(OPEN), runDueJobs(OPEN)]);
    expect(runs.flatMap((r) => r.failed)).toEqual([]);
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(1);
    expect(runs.reduce((n, r) => n + (r.checkins?.opened ?? 0), 0)).toBe(1);
    for (const id of everyone(w)) expect(await notices(id), id).toHaveLength(1);
    // the table itself refuses a second round for the same space and day
    await expect(db.checkinRound.create({ data: { workspaceId: w.ws.id, day: new Date("2031-03-10T00:00:00.000Z"), closedAt: at(HOUR) } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("the next working day makes the next round; the day off (الجمعة) makes none", async () => {
    const w = await world();
    await configure(w.ws.id);
    await runDueJobs(OPEN);
    await runDueJobs(new Date("2031-03-11T06:00:00.000Z"));
    expect((await db.checkinRound.findMany({ where: { workspaceId: w.ws.id }, orderBy: { day: "asc" } })).map((r) => r.day.toISOString().slice(0, 10))).toEqual(["2031-03-10", "2031-03-11"]);
    // Friday 2031-03-14 and Saturday the 15th are not in الأحد-الخميس
    await runDueJobs(new Date("2031-03-14T09:00:00.000Z"));
    await runDueJobs(new Date("2031-03-15T09:00:00.000Z"));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(2);
    // Sunday opens again
    await runDueJobs(new Date("2031-03-16T09:00:00.000Z"));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(3);
  });

  it("the day and the time are the company's: Damascus at 21:30Z is already Tuesday 00:30, before the time, so nothing opens", async () => {
    const w = await world();
    await configure(w.ws.id);
    await runDueJobs(new Date("2031-03-10T21:30:00.000Z"));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    await configure(w.other.id, { timeOfDay: "00:15" });
    await runDueJobs(new Date("2031-03-10T21:30:00.000Z"));
    const r = await db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.other.id } });
    expect(r.day.toISOString().slice(0, 10)).toBe("2031-03-11");
    expect(r.closedAt.toISOString()).toBe("2031-03-11T21:00:00.000Z");
  });

  it("a company in a zone with DST: the time is local wall clock and the day that loses an hour closes after 23", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "America/New_York" } });
    await configure(w.ws.id);
    // Sunday 2031-03-09: New York springs forward at 02:00, so 09:00 is EDT (UTC-4) = 13:00Z
    await runDueJobs(new Date("2031-03-09T12:59:00.000Z"));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    await runDueJobs(new Date("2031-03-09T13:00:00.000Z"));
    const round = await db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.ws.id } });
    expect(round.day.toISOString().slice(0, 10)).toBe("2031-03-09");
    expect(round.closedAt.toISOString()).toBe("2031-03-10T04:00:00.000Z");
    expect((round.closedAt.getTime() - Date.parse("2031-03-09T05:00:00Z")) / HOUR).toBe(23);
  });

  it("a runner that was down in the morning still opens the round, in the evening, until the day ends", async () => {
    const w = await world();
    await configure(w.ws.id);
    await runDueJobs(at(11 * HOUR + 30 * 60_000)); // 20:30 local
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(1);
  });

  it("the participants list is respected: only the people chosen are in the round and told", async () => {
    const w = await world();
    await configure(w.ws.id, { participantsMode: "LIST", participantIds: [w.member.id, w.guest.id, w.outsider.id] });
    const round = await openedBy(w);
    // the guest and the outsider are not eligible even when named
    expect(round.participantIds).toEqual([w.member.id]);
    expect(await notices(w.member.id)).toHaveLength(1);
    expect(await notices(w.mate.id)).toHaveLength(0);
    await loginAs(w.mate.id);
    await expect(submitAnswer(w.ws.id, { answers: ANSWER }, at(HOUR))).rejects.toMatchObject({ message: "checkins.e.not_participant" });
    await loginAs(w.member.id);
    await expect(submitAnswer(w.ws.id, { answers: ANSWER }, at(HOUR))).resolves.toEqual({ edited: false });
  });

  it("a suspended person is skipped, an offboarded one too, and a guest never", async () => {
    const w = await world();
    await configure(w.ws.id);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.mate.id } }, data: { status: "SUSPENDED" } });
    const round = await openedBy(w);
    expect(round.participantIds as string[]).not.toContain(w.mate.id);
    expect(await notices(w.mate.id)).toHaveLength(0);
    expect(await notices(w.member.id)).toHaveLength(1);
  });

  it("an archived space and a check-in that is off get no round", async () => {
    const w = await world();
    await configure(w.ws.id, { active: false });
    await configure(w.other.id);
    await db.workspace.update({ where: { id: w.other.id }, data: { archivedAt: new Date() } });
    await runDueJobs(OPEN);
    expect(await db.checkinRound.count({ where: { workspaceId: { in: [w.ws.id, w.other.id] } } })).toBe(0);
  });

  it("the company's switch off: the runner skips it; on again, the round opens", async () => {
    const w = await world();
    await configure(w.ws.id);
    await setSwitch(w.org.id, false);
    await runDueJobs(OPEN);
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    expect(await notices(w.member.id)).toHaveLength(0);
    await setSwitch(w.org.id, true);
    await runDueJobs(at(HOUR));
    expect(await db.checkinRound.count({ where: { workspaceId: w.ws.id } })).toBe(1);
  });
});

describe("answering: once, editable until the round closes", () => {
  it("submits, edits until the end of the company's day, and is refused after", async () => {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.member.id);
    expect(await submitAnswer(w.ws.id, { answers: ANSWER }, at(HOUR))).toEqual({ edited: false });
    const first = await db.checkinAnswer.findUniqueOrThrow({ where: { roundId_userId: { roundId: round.id, userId: w.member.id } } });
    expect(first).toMatchObject({ excused: false, editedAt: null });
    expect(first.answers).toEqual(ANSWER);
    expect(first.submittedAt.toISOString()).toBe(at(HOUR).toISOString());

    // an edit at 20:59:59 local-day still lands, and keeps one row
    expect(await submitAnswer(w.ws.id, { answers: ["عدّلت", "", "لا"] }, at(11 * HOUR + 59 * 60_000 + 59_000))).toEqual({ edited: true });
    const edited = await db.checkinAnswer.findMany({ where: { roundId: round.id, userId: w.member.id } });
    expect(edited).toHaveLength(1);
    expect(edited[0]!.answers).toEqual(["عدّلت", "", "لا"]);
    expect(edited[0]!.editedAt).not.toBeNull();

    // at the closing instant the company's day has changed: the round of THAT day is refused, and nothing changed
    await expect(submitAnswer(w.ws.id, { day: "2031-03-10", answers: ["متأخر", "", ""] }, at(15 * HOUR))).rejects.toMatchObject({ message: "checkins.e.closed" });
    await expect(submitAnswer(w.ws.id, { day: "2031-03-10", answers: ["متأخر", "", ""] }, at(15 * HOUR + 3600_000))).rejects.toMatchObject({ message: "checkins.e.closed" });
    await expect(submitAnswer(w.ws.id, { answers: ["متأخر", "", ""] }, at(15 * HOUR))).rejects.toMatchObject({ message: "checkins.e.no_round" });
    expect((await db.checkinAnswer.findUniqueOrThrow({ where: { id: edited[0]!.id } })).answers).toEqual(["عدّلت", "", "لا"]);
  });

  it("through the route: a late answer for a round that has closed is refused whatever the browser says", async () => {
    const w = await world();
    // yesterday's round, closed at the end of yesterday (the real clock is later than that)
    const closed = await liveRound(w, everyone(w), { day: new Date("2026-03-10T00:00:00.000Z"), openedAt: new Date("2026-03-10T06:00:00.000Z"), closedAt: new Date("2026-03-10T21:00:00.000Z") });
    await loginAs(w.member.id);
    const res = await call(answerRoute.POST, { body: { workspaceId: w.ws.id, day: "2026-03-10", answers: ANSWER } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("checkins.e.closed");
    expect(await db.checkinAnswer.count({ where: { roundId: closed.id } })).toBe(0);
  });

  it("the texts are bounded: one per question, each at most 1000 characters, at least one not blank", async () => {
    const w = await world();
    const round = await liveRound(w, everyone(w));
    await loginAs(w.member.id);
    const send = (answers: unknown) => call(answerRoute.POST, { body: { workspaceId: w.ws.id, answers } });
    expect((await send(["x".repeat(1001), "", ""])).json?.["details"]).toBeDefined();
    expect((await send(["x".repeat(1001), "", ""])).status).toBe(422);
    const empty = await send(["", "  ", ""]);
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.json)).toContain("checkins.e.answer_empty");
    const many = await send(["a", "b", "c", "d"]);
    expect(many.status).toBe(422);
    expect(JSON.stringify(many.json)).toContain("checkins.e.answer_count");
    expect((await send(["x".repeat(1000), "", ""])).status).toBe(200);
    expect(await db.checkinAnswer.count({ where: { roundId: round.id } })).toBe(1);
  });

  it("only a person of the round answers; before any round exists there is nothing to answer", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await expect(submitAnswer(w.ws.id, { answers: ANSWER })).rejects.toMatchObject({ message: "checkins.e.no_round" });
    await liveRound(w, [w.mate.id]);
    await expect(submitAnswer(w.ws.id, { answers: ANSWER })).rejects.toMatchObject({ message: "checkins.e.not_participant" });
    // the owner, who is not in the space, answers nothing either (and leaves nothing behind)
    await loginAs(w.owner.id);
    await expect(submitAnswer(w.ws.id, { answers: ANSWER })).rejects.toMatchObject({ message: "checkins.e.not_participant" });
    expect(await db.checkinAnswer.count()).toBe(0);
  });

  it("two submissions at once leave one answer", async () => {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.member.id);
    const settled = await Promise.allSettled([submitAnswer(w.ws.id, { answers: ["أ", "", ""] }, at(HOUR)), submitAnswer(w.ws.id, { answers: ["ب", "", ""] }, at(HOUR))]);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    expect(await db.checkinAnswer.count({ where: { roundId: round.id, userId: w.member.id } })).toBe(1);
  });
});

describe("nobody copies: answers are read after submitting", () => {
  async function answered() {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.mate.id);
    await submitAnswer(w.ws.id, { answers: ["جواب الزميل", "", ""] }, at(HOUR));
    return { w, round };
  }

  it("a member who has not answered sees who answered, never what; after answering, sees the teammates' texts", async () => {
    const { w } = await answered();
    await loginAs(w.member.id);
    const before = await getToday(w.ws.id, at(2 * HOUR));
    expect(before.team).toBeNull();
    expect(before.roster.find((r) => r.userId === w.mate.id)?.status).toBe("answered");
    expect(before.roster.find((r) => r.userId === w.member.id)?.status).toBe("pending");
    expect(JSON.stringify(before)).not.toContain("جواب الزميل");
    // the route says the same
    const viaRoute = await call(todayRoute.GET, { url: `http://localhost/api/checkins/today?workspaceId=${w.ws.id}` });
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.text).not.toContain("جواب الزميل");

    await submitAnswer(w.ws.id, { answers: ["جوابي", "", ""] }, at(2 * HOUR));
    const after = await getToday(w.ws.id, at(2 * HOUR));
    expect(after.team?.map((a) => a.userName).sort()).toEqual(["Member", "زميل"].sort());
    expect(after.team?.find((a) => a.userId === w.mate.id)?.answers[0]).toBe("جواب الزميل");
  });

  it("a person on leave submitted nothing, so reads nothing", async () => {
    const { w } = await answered();
    await loginAs(w.member.id);
    await setExcused(w.ws.id, true, {}, at(2 * HOUR));
    expect((await getToday(w.ws.id, at(2 * HOUR))).team).toBeNull();
  });

  it("the owner and the space's ADMIN read all answers without having answered", async () => {
    const { w } = await answered();
    for (const reader of [w.owner, w.lead, w.admin]) {
      await loginAs(reader.id);
      const view = await getToday(w.ws.id, at(2 * HOUR));
      expect(view.canManage, reader.name).toBe(true);
      expect(view.team?.map((a) => a.userId), reader.name).toEqual([w.mate.id]);
    }
  });

  it("the owner's reading is silent: it writes no answer, no notice, no audit row and no mark", async () => {
    const { w } = await answered();
    const count = async () => [await db.checkinAnswer.count(), await db.notification.count(), await db.auditLog.count(), await db.checkinRound.count(), await db.checkinConfig.count()];
    await loginAs(w.owner.id);
    const before = await count();
    const view = await getToday(w.ws.id, at(2 * HOUR));
    expect(view.team).toHaveLength(1);
    expect(view.me).toMatchObject({ participant: false, answered: false, excused: false, canEdit: false });
    await history(w.ws.id, {}, at(2 * HOUR));
    await call(todayRoute.GET, { url: `http://localhost/api/checkins/today?workspaceId=${w.ws.id}` });
    await call(historyRoute.GET, { url: `http://localhost/api/checkins/history?workspaceId=${w.ws.id}` });
    expect(await count()).toEqual(before);
  });

  it("the history follows the same rule, round by round: a manager reads all, a member only the rounds they answered", async () => {
    const w = await world();
    await configure(w.ws.id);
    const day1 = await openedBy(w);
    await loginAs(w.mate.id);
    await submitAnswer(w.ws.id, { answers: ["جواب الزميل الأول", "", ""] }, at(HOUR));
    await loginAs(w.member.id);
    await submitAnswer(w.ws.id, { answers: ["جوابي الأول", "", ""] }, at(HOUR));
    // day two: the mate answers, the member does not
    const NEXT = new Date("2031-03-11T06:00:00.000Z");
    await runDueJobs(NEXT);
    await loginAs(w.mate.id);
    await submitAnswer(w.ws.id, { answers: ["جواب الزميل الثاني", "", ""] }, new Date(NEXT.getTime() + HOUR));

    await loginAs(w.member.id);
    const mine = await history(w.ws.id, {}, new Date("2031-03-12T06:00:00.000Z"));
    const byDay = new Map(mine.rounds.map((r) => [r.round.day, r]));
    expect(byDay.get("2031-03-10")?.canSee).toBe(true);
    expect(byDay.get("2031-03-10")?.answers.map((a) => a.userId).sort()).toEqual([w.member.id, w.mate.id].sort());
    expect(byDay.get("2031-03-11")?.canSee).toBe(false);
    expect(byDay.get("2031-03-11")?.answers).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain("جواب الزميل الثاني");
    expect(mine.rounds.map((r) => r.round.day)).toEqual(["2031-03-11", "2031-03-10"]);

    await loginAs(w.lead.id);
    const all = await history(w.ws.id, {}, new Date("2031-03-12T06:00:00.000Z"));
    expect(all.rounds.every((r) => r.canSee)).toBe(true);
    expect(JSON.stringify(all)).toContain("جواب الزميل الثاني");

    // search by day, and one person's timeline
    const one = await history(w.ws.id, { day: "2031-03-10" }, new Date("2031-03-12T06:00:00.000Z"));
    expect(one.rounds.map((r) => r.round.day)).toEqual(["2031-03-10"]);
    const person = await history(w.ws.id, { userId: w.mate.id }, new Date("2031-03-12T06:00:00.000Z"));
    expect(person.rounds.flatMap((r) => r.answers.map((a) => a.userId))).toEqual([w.mate.id, w.mate.id]);
    expect(person.people.map((p) => p.id).sort()).toEqual(expect.arrayContaining([w.mate.id, w.member.id]));
    expect(day1.id).toBeTruthy();
  });

  it("a bad day or a range longer than a year is refused", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    const bad = await call(historyRoute.GET, { url: `http://localhost/api/checkins/history?workspaceId=${w.ws.id}&day=2031-13-40` });
    expect(bad.status).toBe(422);
    const long = await call(historyRoute.GET, { url: `http://localhost/api/checkins/history?workspaceId=${w.ws.id}&from=2029-01-01&to=2031-01-01` });
    expect(long.status).toBe(422);
  });
});

describe("«إجازة اليوم»: counted apart from missed", () => {
  it("marks the person excused, shows it on the roster, and a later answer turns it into an answer", async () => {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.member.id);
    expect(await setExcused(w.ws.id, true, {}, at(HOUR))).toEqual({ excused: true });
    expect(await setExcused(w.ws.id, true, {}, at(HOUR))).toEqual({ excused: true });
    expect(await db.checkinAnswer.count({ where: { roundId: round.id, userId: w.member.id, excused: true } })).toBe(1);
    expect((await getToday(w.ws.id, at(HOUR))).roster.find((r) => r.userId === w.member.id)?.status).toBe("excused");

    await submitAnswer(w.ws.id, { answers: ANSWER }, at(2 * HOUR));
    expect(await db.checkinAnswer.findUniqueOrThrow({ where: { roundId_userId: { roundId: round.id, userId: w.member.id } } })).toMatchObject({ excused: false, editedAt: null });
    // having answered, the person cannot also be on leave
    await expect(setExcused(w.ws.id, true, {}, at(3 * HOUR))).rejects.toMatchObject({ message: "checkins.e.already_answered" });
  });

  it("can be taken back; and is refused after the round closed or to somebody who is not in the round", async () => {
    const w = await world();
    await configure(w.ws.id, { participantsMode: "LIST", participantIds: [w.member.id] });
    await openedBy(w);
    await loginAs(w.member.id);
    await setExcused(w.ws.id, true, {}, at(HOUR));
    expect(await setExcused(w.ws.id, false, {}, at(2 * HOUR))).toEqual({ excused: false });
    expect(await db.checkinAnswer.count()).toBe(0);
    await expect(setExcused(w.ws.id, true, { day: "2031-03-10" }, at(15 * HOUR))).rejects.toMatchObject({ message: "checkins.e.closed" });
    await loginAs(w.mate.id);
    await expect(setExcused(w.ws.id, true, {}, at(HOUR))).rejects.toMatchObject({ message: "checkins.e.not_participant" });
  });

  it("through the route", async () => {
    const w = await world();
    const round = await liveRound(w, everyone(w));
    await loginAs(w.member.id);
    expect((await call(excuseRoute.POST, { body: { workspaceId: w.ws.id } })).status).toBe(200);
    expect(await db.checkinAnswer.count({ where: { roundId: round.id, excused: true } })).toBe(1);
    expect((await call(excuseRoute.POST, { body: { workspaceId: w.ws.id, on: false } })).status).toBe(200);
    expect(await db.checkinAnswer.count({ where: { roundId: round.id } })).toBe(0);
  });
});

describe("the nudge: once, three hours after opening", () => {
  it("goes to those who have not answered and are not excused, exactly once however many runners race", async () => {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.member.id);
    await submitAnswer(w.ws.id, { answers: ANSWER }, at(HOUR));
    await loginAs(w.mate.id);
    await setExcused(w.ws.id, true, {}, at(HOUR));

    // not yet three hours
    await runDueJobs(at(3 * HOUR - 1000));
    expect(await db.notification.count({ where: { type: "checkin_nudge" } })).toBe(0);
    // at +3h, three runners at once
    const runs = await Promise.all([runDueJobs(at(3 * HOUR)), runDueJobs(at(3 * HOUR)), runDueJobs(at(3 * HOUR))]);
    expect(runs.flatMap((r) => r.failed)).toEqual([]);
    expect(runs.reduce((n, r) => n + (r.checkins?.nudged ?? 0), 0)).toBe(1);
    expect((await db.checkinRound.findUniqueOrThrow({ where: { id: round.id } })).nudgedAt).not.toBeNull();
    // the lead and the org admin have not answered: one nudge each; the member answered and the mate is excused: none
    for (const id of [w.lead.id, w.admin.id]) expect(await notices(id, "checkin_nudge"), id).toHaveLength(1);
    for (const id of [w.member.id, w.mate.id, w.guest.id, w.owner.id]) expect(await notices(id, "checkin_nudge"), id).toHaveLength(0);
    // later runs send nothing more
    await runDueJobs(at(5 * HOUR));
    expect(await db.notification.count({ where: { type: "checkin_nudge" } })).toBe(2);
    expect((await notices(w.lead.id, "checkin_nudge"))[0]).toMatchObject({ linkUrl: "/checkins", workspaceId: w.ws.id });
  });

  it("is not sent after the round closed, nor to somebody suspended since the morning, nor when the switch is off", async () => {
    const w = await world();
    await configure(w.ws.id);
    await openedBy(w);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { status: "SUSPENDED" } });
    await setSwitch(w.org.id, false);
    await runDueJobs(at(3 * HOUR));
    expect(await db.notification.count({ where: { type: "checkin_nudge" } })).toBe(0);
    await setSwitch(w.org.id, true);
    await runDueJobs(at(3 * HOUR));
    expect(await notices(w.lead.id, "checkin_nudge")).toHaveLength(0);
    expect(await notices(w.mate.id, "checkin_nudge")).toHaveLength(1);

    // a round nudged too late (after it closed) is never nudged
    await db.checkinRound.updateMany({ data: { nudgedAt: null } });
    const before = await db.notification.count({ where: { type: "checkin_nudge" } });
    await runDueJobs(at(16 * HOUR));
    expect(await db.notification.count({ where: { type: "checkin_nudge" } })).toBe(before);
  });
});

describe("who may configure, and what a configuration may hold", () => {
  const good = (over: Record<string, unknown> = {}) => ({ active: true, questions: QUESTIONS, timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL", participantIds: [], ...over });

  it("the space's ADMIN and the owner save it; a member, a stranger to the space and a guest are refused", async () => {
    const w = await world();
    for (const who of [w.lead, w.admin, w.owner]) {
      await loginAs(who.id);
      const res = await call(configRoute.PUT, { method: "PUT", body: { workspaceId: w.ws.id, ...good() } });
      expect(res.status, who.name).toBe(200);
    }
    const row = await db.checkinConfig.findUniqueOrThrow({ where: { workspaceId: w.ws.id } });
    expect(row).toMatchObject({ active: true, timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL", updatedById: w.owner.id });
    expect(await db.auditLog.count({ where: { action: "checkins.config_saved", target: w.ws.id } })).toBe(3);
    for (const who of [w.member, w.mate, w.outsider, w.guest]) {
      await loginAs(who.id);
      expect((await call(configRoute.PUT, { method: "PUT", body: { workspaceId: w.ws.id, ...good({ active: false }) } })).status, who.name).toBe(403);
      expect((await call(configRoute.GET, { url: `http://localhost/api/checkins/config?workspaceId=${w.ws.id}` })).status, who.name).toBe(403);
    }
    expect((await db.checkinConfig.findUniqueOrThrow({ where: { workspaceId: w.ws.id } })).active).toBe(true);
  });

  it("returns the defaults before anything is saved, with the people who may be chosen", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    const res = await call(configRoute.GET, { url: `http://localhost/api/checkins/config?workspaceId=${w.ws.id}` });
    expect(res.status).toBe(200);
    const body = res.json as { config: { exists: boolean; active: boolean; questions: string[]; timeOfDay: string; weekdays: number[] }; candidates: { id: string }[] };
    expect(body.config).toMatchObject({ exists: false, active: false, questions: QUESTIONS, timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4] });
    expect(body.candidates.map((c) => c.id).sort()).toEqual(everyone(w).sort());
  });

  it("refuses six questions, an empty question, a long one, a bad time, no weekday, a participant who is not in the space, an empty list", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    const put = (over: Record<string, unknown>) => call(configRoute.PUT, { method: "PUT", body: { workspaceId: w.ws.id, ...good(over) } });
    const refused = async (over: Record<string, unknown>, key: string) => {
      const res = await put(over);
      expect(res.status, key).toBe(422);
      expect(JSON.stringify(res.json), key).toContain(key);
    };
    await refused({ questions: ["1", "2", "3", "4", "5", "6"] }, "checkins.e.questions_invalid");
    await refused({ questions: ["", "x"] }, "checkins.e.questions_invalid");
    await refused({ questions: ["x".repeat(201)] }, "checkins.e.questions_invalid");
    await refused({ questions: [] }, "checkins.e.questions_invalid");
    await refused({ timeOfDay: "9am" }, "checkins.e.time_invalid");
    await refused({ weekdays: [] }, "checkins.e.weekdays_invalid");
    await refused({ weekdays: [9] }, "checkins.e.weekdays_invalid");
    await refused({ participantsMode: "LIST", participantIds: [w.outsider.id] }, "checkins.e.participants_invalid");
    await refused({ participantsMode: "LIST", participantIds: [w.guest.id] }, "checkins.e.participants_invalid");
    await refused({ participantsMode: "LIST", participantIds: [] }, "checkins.e.participants_empty");
    await refused({ participantsMode: "EVERYBODY" }, "checkins.e.participants_invalid");
    expect(await db.checkinConfig.count()).toBe(0);
    expect((await put({ questions: ["1", "2", "3", "4", "5"] })).status).toBe(200);
  });

  it("changing the questions does not rewrite a round already opened", async () => {
    const w = await world();
    await configure(w.ws.id);
    const round = await openedBy(w);
    await loginAs(w.lead.id);
    await saveConfig(w.ws.id, good({ questions: ["سؤال جديد"] }));
    expect((await db.checkinRound.findUniqueOrThrow({ where: { id: round.id } })).questions).toEqual(QUESTIONS);
    // and an answer to the old round is read against the old questions
    await loginAs(w.member.id);
    await expect(submitAnswer(w.ws.id, { answers: ["أ", "ب", "ج", "د"] }, at(HOUR))).rejects.toMatchObject({ message: "validation.failed" });
    await submitAnswer(w.ws.id, { answers: ["أ", "ب", "ج"] }, at(HOUR));
  });
});

describe("isolation: the space, the guest, the company's switch", () => {
  it("a guest never reaches any door", async () => {
    const w = await world();
    await liveRound(w, everyone(w));
    await loginAs(w.guest.id);
    const url = (p: string) => `http://localhost/api/checkins/${p}?workspaceId=${w.ws.id}`;
    expect((await call(todayRoute.GET, { url: url("today") })).status).toBe(403);
    expect((await call(historyRoute.GET, { url: url("history") })).status).toBe(403);
    expect((await call(configRoute.GET, { url: url("config") })).status).toBe(403);
    expect((await call(answerRoute.POST, { body: { workspaceId: w.ws.id, answers: ANSWER } })).status).toBe(403);
    expect((await call(excuseRoute.POST, { body: { workspaceId: w.ws.id } })).status).toBe(403);
    expect((await call(mineRoute.GET)).status).toBe(403);
    expect(await db.checkinAnswer.count()).toBe(0);
  });

  it("a person who is not in the space reads and writes nothing of it, even in the same company", async () => {
    const w = await world();
    await liveRound(w, everyone(w));
    await db.checkinAnswer.create({ data: { roundId: (await db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.ws.id } })).id, userId: w.mate.id, answers: ["سر المساحة", "", ""] } });
    for (const who of [w.outsider]) {
      await loginAs(who.id);
      const url = (p: string) => `http://localhost/api/checkins/${p}?workspaceId=${w.ws.id}`;
      const today = await call(todayRoute.GET, { url: url("today") });
      expect(today.status, who.name).toBe(403);
      expect(today.text).not.toContain("سر المساحة");
      expect((await call(historyRoute.GET, { url: url("history") })).status).toBe(403);
      expect((await call(answerRoute.POST, { body: { workspaceId: w.ws.id, answers: ANSWER } })).status).toBe(403);
      expect((await call(excuseRoute.POST, { body: { workspaceId: w.ws.id } })).status).toBe(403);
    }
    // the space ADMIN of ANOTHER space reads nothing here either
    await loginAs(w.outsider.id);
    await expect(getToday(w.ws.id)).rejects.toMatchObject({ message: "not_workspace_member" });
  });

  it("another company's person never reaches it", async () => {
    const w = await world();
    const stranger = await makeTeam();
    await liveRound(w, everyone(w));
    await loginAs(stranger.owner.id);
    expect((await call(todayRoute.GET, { url: `http://localhost/api/checkins/today?workspaceId=${w.ws.id}` })).status).toBe(403);
    expect((await call(historyRoute.GET, { url: `http://localhost/api/checkins/history?workspaceId=${w.ws.id}` })).status).toBe(403);
  });

  it("a round of one space never appears in another", async () => {
    const w = await world();
    await configure(w.ws.id);
    await configure(w.other.id);
    await runDueJobs(OPEN);
    const here = await db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.ws.id } });
    await loginAs(w.mate.id); // in both spaces
    await submitAnswer(w.ws.id, { answers: ["هنا فقط", "", ""] }, at(HOUR));
    await submitAnswer(w.other.id, { answers: ["هناك فقط", "", ""] }, at(HOUR));
    const view = await getToday(w.other.id, at(2 * HOUR));
    expect(view.team?.map((a) => a.answers[0])).toEqual(["هناك فقط"]);
    expect(JSON.stringify(view)).not.toContain("هنا فقط");
    expect(here.workspaceId).toBe(w.ws.id);
  });

  it("the switch off: every route answers 404 and nothing is lost; on again, it is all back", async () => {
    const w = await world();
    const round = await liveRound(w, everyone(w));
    await db.checkinAnswer.create({ data: { roundId: round.id, userId: w.member.id, answers: ANSWER } });
    await setSwitch(w.org.id, false);
    await loginAs(w.lead.id);
    const url = (p: string) => `http://localhost/api/checkins/${p}?workspaceId=${w.ws.id}`;
    for (const res of [
      await call(todayRoute.GET, { url: url("today") }),
      await call(historyRoute.GET, { url: url("history") }),
      await call(configRoute.GET, { url: url("config") }),
      await call(configRoute.PUT, { method: "PUT", body: { workspaceId: w.ws.id, active: true, questions: QUESTIONS, timeOfDay: "09:00", weekdays: [1], participantsMode: "ALL" } }),
      await call(answerRoute.POST, { body: { workspaceId: w.ws.id, answers: ANSWER } }),
      await call(excuseRoute.POST, { body: { workspaceId: w.ws.id } }),
      await call(mineRoute.GET),
    ]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    expect(await db.checkinAnswer.count({ where: { roundId: round.id } })).toBe(1);
    await setSwitch(w.org.id, true);
    expect((await call(todayRoute.GET, { url: url("today") })).status).toBe(200);
  });
});

describe("the push and the bell carry generic words, never an answer", () => {
  it("a person with a phone gets a push whose text names no question and no answer", async () => {
    const w = await world();
    await configure(w.ws.id, { questions: ["سؤال سري جدًا؟"] });
    const sent: PushMessage[] = [];
    setPushSenderForTests(async (_sub, payload) => {
      sent.push(JSON.parse(payload) as PushMessage);
      return { statusCode: 201 };
    });
    await db.pushSubscription.create({ data: { userId: w.member.id, endpoint: `https://push.test.local/${w.member.id}`, p256dh: "p256dh-key", auth: "auth-key" } });
    const round = await openedBy(w);
    await loginAs(w.member.id);
    await submitAnswer(w.ws.id, { answers: ["جواب لا يخرج من التطبيق"] }, at(HOUR));
    await runDueJobs(at(3 * HOUR));
    await flushPushesForTests();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const msg of sent) {
      const text = JSON.stringify(msg);
      expect(text).not.toContain("سؤال سري");
      expect(text).not.toContain("جواب لا يخرج");
      expect(msg.kind).toBe("note");
    }
    expect(sent[0]).toMatchObject({ title: "تسجيلك اليومي" });
    expect(sent[0]!.url).toBe(`/go?space=${w.ws.id}&next=%2Fcheckins`);
    // and the bell rows (open and nudge) are the same generic words
    for (const row of await db.notification.findMany({ where: { type: { in: ["checkin_open", "checkin_nudge"] } } })) {
      expect(`${row.title} ${row.body ?? ""}`).not.toMatch(/سري|لا يخرج/);
    }
    expect(round.id).toBeTruthy();
  });
});

describe("attached tasks: the person's own open tasks, as read-only chips", () => {
  async function withTasks() {
    const w = await world();
    const made = await makeProject(w.ws.id, "مشروع");
    const mk = (title: string, assigneeId: string, over: Record<string, unknown> = {}) =>
      makeTask({ orgId: w.org.id, workspaceId: w.ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: w.owner.id, assigneeId, title, ...over });
    const mine = await mk("مهمتي المفتوحة", w.member.id);
    const done = await mk("مهمة منتهية", w.member.id, { completedAt: new Date() });
    const theirs = await mk("مهمة الزميل", w.mate.id);
    return { w, mine, done, theirs, made };
  }

  it("accepts my open tasks, refuses a finished one, somebody else's, or a task that does not exist; readers see the titles", async () => {
    const { w, mine, done, theirs } = await withTasks();
    await configure(w.ws.id);
    await openedBy(w);
    await loginAs(w.member.id);
    const today = await getToday(w.ws.id, at(HOUR));
    expect(today.myTasks.map((t) => t.id)).toEqual([mine.id]);
    for (const bad of [[done.id], [theirs.id], ["nope"], [mine.id, theirs.id]]) {
      await expect(submitAnswer(w.ws.id, { answers: ANSWER, taskIds: bad }, at(HOUR)), JSON.stringify(bad)).rejects.toMatchObject({ message: "validation.failed" });
    }
    expect(await db.checkinAnswer.count()).toBe(0);
    await submitAnswer(w.ws.id, { answers: ANSWER, taskIds: [mine.id] }, at(HOUR));
    // a task finished since stays attached on an edit (it was the person's choice that morning)
    await db.task.update({ where: { id: mine.id }, data: { completedAt: new Date() } });
    await submitAnswer(w.ws.id, { answers: ["عدّلت", "", ""], taskIds: [mine.id] }, at(2 * HOUR));
    await loginAs(w.mate.id);
    await submitAnswer(w.ws.id, { answers: ["أنا"], taskIds: [] }, at(2 * HOUR));
    const seen = await getToday(w.ws.id, at(3 * HOUR));
    expect(seen.team?.find((a) => a.userId === w.member.id)?.tasks).toEqual([{ id: mine.id, title: "مهمتي المفتوحة" }]);
  });

  it("a chip the reader may not open is dropped, not named (a task of a team the reader is not in)", async () => {
    const { w, mine, made } = await withTasks();
    const team = await db.team.create({ data: { workspaceId: w.ws.id, name: "فريق مغلق" } });
    await db.teamMember.create({ data: { teamId: team.id, userId: w.member.id } });
    await db.project.update({ where: { id: made.project.id }, data: { teamId: team.id } });
    await configure(w.ws.id);
    await openedBy(w);
    await loginAs(w.member.id);
    await submitAnswer(w.ws.id, { answers: ANSWER, taskIds: [mine.id] }, at(HOUR));
    await loginAs(w.mate.id);
    await submitAnswer(w.ws.id, { answers: ["أنا"] }, at(HOUR));
    const seen = await getToday(w.ws.id, at(2 * HOUR));
    const chips = seen.team?.find((a) => a.userId === w.member.id)?.tasks;
    expect(chips).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain("مهمتي المفتوحة");
    // the space's ADMIN opens it
    await loginAs(w.lead.id);
    expect((await getToday(w.ws.id, at(2 * HOUR))).team?.find((a) => a.userId === w.member.id)?.tasks).toEqual([{ id: mine.id, title: "مهمتي المفتوحة" }]);
  });
});

describe("the card on «اليوم»", () => {
  it("says pending, then answered or excused, and none when there is nothing for the person", async () => {
    const w = await world();
    await configure(w.ws.id);
    await openedBy(w);
    await loginAs(w.member.id);
    expect(await cardState(w.ws.id, at(HOUR))).toBe("pending");
    await submitAnswer(w.ws.id, { answers: ANSWER }, at(HOUR));
    expect(await cardState(w.ws.id, at(2 * HOUR))).toBe("answered");
    await loginAs(w.mate.id);
    await setExcused(w.ws.id, true, {}, at(HOUR));
    expect(await cardState(w.ws.id, at(2 * HOUR))).toBe("excused");
    expect(await cardState(w.ws.id, at(15 * HOUR))).toBe("none");
    await loginAs(w.owner.id);
    expect(await cardState(w.ws.id, at(HOUR))).toBe("none");
  });

  it("the route answers for the space the person is in (the cookie)", async () => {
    const w = await world();
    await liveRound(w, everyone(w));
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.ws.id);
    const res = await call(mineRoute.GET);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ state: "pending" });
  });
});

describe("checkinStats: answered, missed and excused per person per day", () => {
  it("adds up over the rounds of a space, apart from other spaces", async () => {
    const w = await world();
    const mk = (workspaceId: string, day: string, closedAt: string, participantIds: string[]) =>
      db.checkinRound.create({ data: { workspaceId, day: new Date(`${day}T00:00:00.000Z`), openedAt: new Date(`${day}T06:00:00.000Z`), closedAt: new Date(closedAt), questions: QUESTIONS, participantIds } });
    const ids = [w.member.id, w.mate.id, w.lead.id];
    const r1 = await mk(w.ws.id, "2031-03-09", "2031-03-09T21:00:00.000Z", ids);
    const r2 = await mk(w.ws.id, "2031-03-10", "2031-03-10T21:00:00.000Z", ids);
    const r3 = await mk(w.ws.id, "2031-03-11", "2031-03-11T21:00:00.000Z", ids); // still open at NOW
    const outside = await mk(w.other.id, "2031-03-10", "2031-03-10T21:00:00.000Z", [w.mate.id]);
    const put = (roundId: string, userId: string, excused = false) => db.checkinAnswer.create({ data: { roundId, userId, excused, answers: excused ? [] : ANSWER } });
    await put(r1.id, w.member.id);
    await put(r1.id, w.mate.id, true);
    await put(r2.id, w.member.id);
    await put(r2.id, w.lead.id);
    await put(r3.id, w.member.id);
    await put(outside.id, w.mate.id);

    const NOW = new Date("2031-03-11T12:00:00.000Z");
    const stats = await checkinStats(w.ws.id, { from: "2031-03-09", to: "2031-03-11" }, NOW);
    const totals = Object.fromEntries(stats.people.map((p) => [p.userId, p]));
    expect(totals[w.member.id]).toMatchObject({ answered: 3, missed: 0, excused: 0, pending: 0 });
    expect(totals[w.mate.id]).toMatchObject({ answered: 0, missed: 1, excused: 1, pending: 1 });
    expect(totals[w.lead.id]).toMatchObject({ answered: 1, missed: 1, excused: 0, pending: 1 });
    expect(stats.days).toHaveLength(9);
    expect(stats.days.find((d) => d.userId === w.mate.id && d.day === "2031-03-09")).toMatchObject({ excused: 1, missed: 0 });
    expect(stats.days.find((d) => d.userId === w.mate.id && d.day === "2031-03-10")).toMatchObject({ missed: 1, answered: 0 });
    // a narrower range, and another space's rounds never leak in
    expect((await checkinStats(w.ws.id, { from: "2031-03-10", to: "2031-03-10" }, NOW)).days).toHaveLength(3);
    expect((await checkinStats(w.other.id, { from: "2031-03-09", to: "2031-03-11" }, NOW)).people).toEqual([{ userId: w.mate.id, answered: 1, missed: 0, excused: 0, pending: 0 }]);
    await expect(checkinStats(w.ws.id, { from: "x", to: "2031-03-11" }, NOW)).rejects.toMatchObject({ message: "validation.failed" });
  });
});

describe("deleting a space takes its check-in with it", () => {
  it("the configuration, the rounds and the answers go with the space (cascade)", async () => {
    const w = await world();
    await configure(w.other.id);
    await runDueJobs(OPEN);
    const round = await db.checkinRound.findFirstOrThrow({ where: { workspaceId: w.other.id } });
    await db.checkinAnswer.create({ data: { roundId: round.id, userId: w.mate.id, answers: ANSWER } });
    await db.workspace.delete({ where: { id: w.other.id } });
    expect(await db.checkinConfig.count({ where: { workspaceId: w.other.id } })).toBe(0);
    expect(await db.checkinRound.count({ where: { workspaceId: w.other.id } })).toBe(0);
    expect(await db.checkinAnswer.count({ where: { roundId: round.id } })).toBe(0);
  });
});
