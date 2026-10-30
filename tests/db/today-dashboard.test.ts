import { describe, expect, it } from "vitest";
import { getTodayDashboard } from "@/server/services/today-dashboard";
import { db, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace } from "./scoping-helpers";
import { actorOf, at, isPlain, put, setMember, setZone, world, type World } from "./today-helpers";

/**
 * getTodayDashboard(actor): the numbers behind the smart cards of «اليوم». The rules, each proved here with real rows:
 *  - only the spaces the person can open (and only the space they are in, when the page says so): a task or a
 *    message of a space they are not in adds nothing to any number;
 *  - a guest (an external partner) gets no cards at all;
 *  - the company's day and week (from Sunday), by Organization.timezone;
 *  - the team strip is counts only, for the owner and whoever holds users.manage;
 *  - the unread chat is the badge's own count, so a topic of a space the person left or never joined is not in it.
 */

// Thursday 22 October 2026; the company's clock is UTC in `world()`, so its week runs Sun 18 - Sat 24 (25 exclusive)
const NOW = at("2026-10-22T09:00:00Z");

const dashFor = async (userId: string, opts: Parameters<typeof getTodayDashboard>[1] = {}) =>
  getTodayDashboard(await actorOf(userId), { now: NOW, ...opts });

/** A finished task whose finishing moment is the given one (the fixture stamps "now", which is not the day of NOW). */
async function finished(w: World, place: "in" | "out", assigneeId: string, when: string) {
  const task = await put(w, place, { assigneeId, completed: true });
  await db.task.update({ where: { id: task.id }, data: { completedAt: at(when) } });
  return task;
}

describe("mine: open, overdue, due today, finished this week, the week's progress", () => {
  it("counts only the person's own open work in the spaces they are in, never a space they are not in", async () => {
    const w = await world();
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-20T10:00:00Z") }); // overdue
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") }); // today
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-24T10:00:00Z") }); // later this week
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-30T10:00:00Z") }); // next week
    await put(w, "in", { assigneeId: w.member.id }); // no date
    // none of these may count: another person's, nobody's, archived, and the whole closed space
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: null, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z"), archived: true });
    await put(w, "out", { assigneeId: w.member.id, due: at("2026-10-20T10:00:00Z") });
    await put(w, "out", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "out", { assigneeId: w.member.id });
    await finished(w, "out", w.member.id, "2026-10-21T10:00:00Z");

    const dash = await dashFor(w.member.id);
    expect(dash?.mine).toEqual({ open: 5, overdue: 1, dueToday: 1, doneWeek: 0, weekTotal: 3, percent: 0 });
  });

  it("finished this week counts from Sunday to Saturday by the company's clock: last Saturday and next Sunday are outside", async () => {
    const w = await world();
    await finished(w, "in", w.member.id, "2026-10-18T00:00:00Z"); // Sunday, first moment: in
    await finished(w, "in", w.member.id, "2026-10-21T10:00:00Z"); // in
    await finished(w, "in", w.member.id, "2026-10-24T23:59:00Z"); // Saturday night: in
    await finished(w, "in", w.member.id, "2026-10-17T23:59:00Z"); // last Saturday: out
    await finished(w, "in", w.member.id, "2026-10-25T00:00:00Z"); // next Sunday: out
    await finished(w, "in", w.lead.id, "2026-10-21T10:00:00Z"); // somebody else's: out
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-23T10:00:00Z") }); // left this week

    const mine = (await dashFor(w.member.id))?.mine;
    expect(mine).toMatchObject({ doneWeek: 3, weekTotal: 4, percent: 75 });
  });

  it("the week's progress is finished of (finished + still due by the end of the week, the late ones included)", async () => {
    const w = await world();
    await finished(w, "in", w.member.id, "2026-10-19T10:00:00Z");
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-01T10:00:00Z") }); // late
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T20:00:00Z") }); // today
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-24T20:00:00Z") }); // Saturday
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-25T20:00:00Z") }); // next week: not the week's
    await put(w, "in", { assigneeId: w.member.id }); // no date: not the week's
    expect((await dashFor(w.member.id))?.mine).toEqual({ open: 5, overdue: 1, dueToday: 1, doneWeek: 1, weekTotal: 4, percent: 25 });
  });

  it("a week with no work has no percent (the card says so instead of a ring of nothing)", async () => {
    const w = await world();
    await put(w, "in", { assigneeId: w.member.id });
    expect((await dashFor(w.member.id))?.mine).toMatchObject({ open: 1, weekTotal: 0, percent: null });
  });

  it("counts by the company's midnight, not the server's", async () => {
    const w = await world();
    await setZone(w.org.id, "Asia/Damascus"); // UTC+3 in October 2026: 22:30 UTC on the 21st is 01:30 on the 22nd
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-21T22:30:00Z") }); // today there
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-21T20:00:00Z") }); // 23:00 on the 21st there: overdue
    const mine = (await dashFor(w.member.id))?.mine;
    expect(mine).toMatchObject({ overdue: 1, dueToday: 1 });
  });

  it("inside a space (the page passes the one the person is in) counts that space only", async () => {
    const w = await world();
    const second = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "المساحة الثانية");
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    const other = await makeProject(second.id, "مشروع ثانٍ");
    for (let i = 0; i < 2; i++) {
      await makeTask({
        orgId: w.org.id,
        workspaceId: second.id,
        projectId: other.project.id,
        boardId: other.board.id,
        columnId: other.todo.id,
        creatorId: w.owner.id,
        assigneeId: w.member.id,
        dueDate: at("2026-10-20T10:00:00Z"),
      });
    }
    expect((await dashFor(w.member.id))?.mine).toMatchObject({ open: 3, overdue: 2, dueToday: 1 });
    expect((await dashFor(w.member.id, { space: { id: w.wsIn.id, kind: "TEAM" } }))?.mine).toMatchObject({ open: 1, overdue: 0, dueToday: 1 });
    expect((await dashFor(w.member.id, { space: { id: second.id, kind: "TEAM" } }))?.mine).toMatchObject({ open: 2, overdue: 2, dueToday: 0 });
    // a space the person is not in: nothing, not even the numbers of the spaces they ARE in
    expect(await dashFor(w.member.id, { space: { id: w.wsOut.id, kind: "TEAM" } })).toBeNull();
  });

  it("never another company's: a person in two companies gets the one they work in now", async () => {
    const w = await world();
    const other = await makeTeam();
    const person = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "عامل بشركتين" });
    await joinWorkspace(person.id, w.wsIn.id);
    await joinOrg(person.id, other.org.id, "MEMBER");
    await makeWorkspace(other.org.id, [{ userId: person.id }], "مساحة شركة أخرى");
    await put(w, "in", { assigneeId: person.id, due: at("2026-10-22T15:00:00Z") });
    expect((await dashFor(person.id))?.mine).toMatchObject({ open: 1, dueToday: 1 });
  });
});

describe("nobody gets numbers they may not see", () => {
  it("a person in no space gets no cards", async () => {
    const w = await world();
    await put(w, "in", { assigneeId: w.admin.id, due: at("2026-10-22T15:00:00Z") });
    expect(await dashFor(w.admin.id)).toBeNull(); // an admin gets no space by rank
    await joinWorkspace(w.admin.id, w.wsIn.id);
    expect((await dashFor(w.admin.id))?.mine).toMatchObject({ open: 1 });
    const fresh = await makeTeam();
    expect(await dashFor(fresh.owner.id)).toBeNull();
  });

  it("a guest gets none: no numbers of their own, no company numbers, whatever a stored row says", async () => {
    const w = await world();
    await joinWorkspace(w.guest.id, w.wsIn.id);
    await put(w, "in", { assigneeId: w.guest.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-20T15:00:00Z") });
    await setMember(w.org.id, w.guest.id, { capabilities: ["users.manage", "directory.view"] });
    expect(await dashFor(w.guest.id)).toBeNull();
  });

  it("without the tasks box there are no work numbers", async () => {
    const w = await world();
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    const actor = await actorOf(w.member.id);
    const dash = await getTodayDashboard({ ...actor, caps: new Set([...actor.caps].filter((c) => c !== "tasks.view")) }, { now: NOW });
    expect(dash?.mine).toBeNull();
    expect(dash?.team).toBeNull();
  });

  it("a team-mate in a team the person is not in leaves no trace (the teams rule)", async () => {
    const w = await world();
    const team = await db.team.create({ data: { workspaceId: w.wsIn.id, name: "فريق آخر", members: { create: [{ userId: w.lead.id }] } } });
    const hiddenProject = await db.project.update({ where: { id: w.inside.project.id }, data: { teamId: team.id } });
    expect(hiddenProject.teamId).toBe(team.id);
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    // the only project of the space belongs to a team the member is not in: its tasks are not theirs to see
    expect((await dashFor(w.member.id))?.mine).toMatchObject({ open: 0, dueToday: 0 });
    // the person who is in that team sees it
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-22T15:00:00Z") });
    expect((await dashFor(w.lead.id))?.mine).toMatchObject({ open: 1, dueToday: 1 });
  });
});

describe("the team strip: counts only, for the owner and whoever holds users.manage", () => {
  async function busy() {
    const w = await world();
    await finished(w, "in", w.member.id, "2026-10-20T10:00:00Z");
    await finished(w, "in", w.lead.id, "2026-10-21T10:00:00Z");
    await finished(w, "out", w.member.id, "2026-10-21T10:00:00Z");
    await finished(w, "in", w.lead.id, "2026-10-10T10:00:00Z"); // last week
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "out", { assigneeId: w.lead.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-15T10:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-14T10:00:00Z") });
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-14T10:00:00Z") });
    await put(w, "out", { assigneeId: w.admin.id, due: at("2026-10-14T10:00:00Z") });
    return w;
  }

  it("the owner counts every space of the company, with no name in the result", async () => {
    const w = await busy();
    const team = (await dashFor(w.owner.id))?.team;
    expect(team).toEqual({ doneWeek: 3, dueToday: 2, peopleLate: 3 });
    expect(JSON.stringify(await dashFor(w.owner.id))).not.toMatch(/[؀-ۿ]|Member|Lead|Admin/);
  });

  it("an admin or a member given users.manage counts only the spaces they can open; the others get none", async () => {
    const w = await busy();
    await joinWorkspace(w.admin.id, w.wsIn.id);
    expect((await dashFor(w.admin.id))?.team).toEqual({ doneWeek: 2, dueToday: 1, peopleLate: 2 });
    expect((await dashFor(w.member.id))?.team).toBeNull();
    expect((await dashFor(w.lead.id))?.team).toBeNull();
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    expect((await dashFor(w.member.id))?.team).toEqual({ doneWeek: 2, dueToday: 1, peopleLate: 2 });
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    expect((await dashFor(w.admin.id))?.team).toBeNull();
  });

  it("a person who is no longer active is not counted among the people who are late", async () => {
    const w = await busy();
    await setMember(w.org.id, w.lead.id, { status: "SUSPENDED" });
    expect((await dashFor(w.owner.id))?.team?.peopleLate).toBe(2);
  });
});

describe("unread chat: the badge's own count", () => {
  async function topic(w: World, spaceId: string, authorId: string, title: string) {
    const conv = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title, spaceId } });
    return conv;
  }
  const say = (orgId: string, conversationId: string, authorId: string, body = "مرحبا") =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body } });
  const joinChat = (conversationId: string, userId: string) =>
    db.conversationMember.create({ data: { conversationId, userId, lastReadAt: new Date("2020-01-01T00:00:00Z") } });

  it("counts what waits in the person's spaces, never their own lines, and never a topic of a space they are not in", async () => {
    const w = await world();
    const mine = await topic(w, w.wsIn.id, w.owner.id, "موضوع الفريق");
    const closed = await topic(w, w.wsOut.id, w.owner.id, "موضوع مغلق");
    await joinChat(mine.id, w.member.id);
    await joinChat(closed.id, w.member.id); // a leftover row from before the person left that space
    await say(w.org.id, mine.id, w.owner.id);
    await say(w.org.id, mine.id, w.owner.id);
    await say(w.org.id, mine.id, w.member.id); // their own
    await say(w.org.id, closed.id, w.owner.id);
    await say(w.org.id, closed.id, w.owner.id);
    await say(w.org.id, closed.id, w.owner.id);

    const dash = await dashFor(w.member.id);
    expect(dash?.unreadChat).toBe(2);
    expect((await dashFor(w.member.id, { space: { id: w.wsIn.id, kind: "TEAM" } }))?.unreadChat).toBe(2);
  });

  it("the owner's silent reading adds nothing: only a topic he joined counts", async () => {
    const w = await world();
    const topicIn = await topic(w, w.wsIn.id, w.member.id, "موضوع الفريق");
    await say(w.org.id, topicIn.id, w.member.id);
    await say(w.org.id, topicIn.id, w.member.id);
    expect((await dashFor(w.owner.id))?.unreadChat).toBe(0);
  });
});

it("hands over plain data only", async () => {
  const w = await world();
  await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
  for (const who of [w.member.id, w.owner.id, w.guest.id]) expect(isPlain(await dashFor(who)), who).toBe(true);
});
