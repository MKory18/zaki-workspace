import { beforeEach, describe, expect, it } from "vitest";
import * as recurrenceRoute from "@/app/api/tasks/[id]/recurrence/route";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import { withFeature } from "@/lib/features";
import { dayOfInstant, dueInstantForDay } from "@/lib/due-day";
import { runDueJobs } from "@/server/jobs/run";
import { moveTask, setTaskCompletion } from "@/server/services/tasks";
import { recurringTaskIds } from "@/server/services/task-recurrence";
import { flushPushesForTests } from "@/server/notify";
import { zonedParts } from "@/lib/zoned-time";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { suspend } from "./active-helpers";

/**
 * «مهمة متكررة» — a task that repeats (the owner's backlog, 2026-10-30).
 *
 * What this pins:
 *  - a series is set from the task (one row, the task points at it), in the company's zone; who may set it is who may
 *    edit the task: a guest never, somebody outside the space never, the owner reading silently never (403, like steps);
 *  - «حسب الجدول»: the runner makes the next task ONCE at its day — two `runDueJobs` at the same moment write one task —
 *    as a REAL task (title, description, priority, labels, people, the step TITLES unticked, the first column of the same
 *    board, the due date the rule gives, `recurrenceId`), also when the previous one is still open, never while an open one
 *    is not yet due, and after an outage ONE task, not one per missed day;
 *  - «عند الإنجاز»: finishing a task of the series makes the next one in the same commit, exactly once, however many clicks,
 *    on the tick box or by moving to the done column; reopening and finishing again adds nothing while one is open;
 *  - the rank rule of a hand-made task holds: an assignee ABOVE the maker is asked (a request), never assigned;
 *  - the end date stops the series; an archived space, project or board, or a maker who left, stops it with a reason;
 *  - the company's «مهمة متكررة» switch: off, the routes answer 404, the runner and the completion make nothing; on again
 *    they do;
 *  - stopping keeps every task already made.
 */

const ZONE = "Asia/Damascus";
const DAY = 24 * 3600_000;

// The runner works on EVERY company's series and the test database is shared by the whole file: start each test empty.
beforeEach(async () => {
  await db.taskRecurrence.deleteMany({});
});

/** The company's `YYYY-MM-DD` that is `n` days from now. */
const dayFromNow = (n: number) => dayOfInstant(new Date(Date.now() + n * DAY), ZONE);
const noonOf = (day: string) => dueInstantForDay(day, ZONE)!;

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "زميل" });
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "قائد" });
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.member.id }, { userId: mate.id }, { userId: lead.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }],
    "مساحة",
  );
  const made = await makeProject(ws.id, "مشروع");
  const label = await db.label.create({ data: { orgId: team.org.id, name: "مهم", color: "#3b82f6" } });
  const mk = async (over: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: made.project.id,
      boardId: made.board.id,
      columnId: made.todo.id,
      creatorId: team.member.id,
      assigneeId: mate.id,
      title: "تقرير الأسبوع",
      priority: "HIGH",
      dueDate: noonOf(dayFromNow(2)),
      ...over,
    });
  const task = await mk();
  await db.task.update({ where: { id: task.id }, data: { description: "اكتب التقرير وأرسله", labels: { create: [{ labelId: label.id }] } } });
  await db.taskStep.createMany({
    data: [
      { orgId: team.org.id, taskId: task.id, title: "اجمع الأرقام", position: 1000, done: true, doneById: team.member.id, doneAt: new Date() },
      { orgId: team.org.id, taskId: task.id, title: "راجعها", position: 2000 },
    ],
  });
  return { ...team, mate, lead, ws, made, label, task, mk };
}
type World = Awaited<ReturnType<typeof world>>;

type Rec = { id: string; rule: { kind: string }; mode: string; active: boolean; stoppedReason: string | null; nextDueAt: string | null; endsOn: string | null; isTemplate: boolean };
const put = (taskId: string, body: Record<string, unknown>) => call(recurrenceRoute.PUT, { method: "PUT", params: { id: taskId }, body });
const get = (taskId: string) => call(recurrenceRoute.GET, { params: { id: taskId } });
const stop = (taskId: string) => call(recurrenceRoute.DELETE, { method: "DELETE", params: { id: taskId } });
const recOf = (res: { json: Record<string, unknown> | null }) => res.json?.["recurrence"] as Rec | null;

const DAILY = { rule: { kind: "DAILY" } };
/** The series row of a task, as the database holds it. */
const rowOf = (taskId: string) => db.taskRecurrence.findUniqueOrThrow({ where: { templateTaskId: taskId } });
/** The tasks of a series other than its template, oldest first. */
const copies = (w: World, seriesId: string) =>
  db.task.findMany({ where: { recurrenceId: seriesId, id: { not: w.task.id } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { labels: true, coAssignees: true, steps: { orderBy: { position: "asc" } } } });
const after = (d: Date | null, ms = 60_000) => new Date(d!.getTime() + ms);

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "recurringTasks", on) as Prisma.InputJsonValue } });
}

describe("«تكرار»: setting a series from the task", () => {
  it("starts a series on the task (one row, the task points at it) and reads it back with the company's zone", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await put(w.task.id, { rule: { kind: "WEEKLY", days: [3, 0, 3] }, mode: "SCHEDULE", endsOn: dayFromNow(60) });
    expect(res.status).toBe(200);
    expect(recOf(res)).toMatchObject({ rule: { kind: "WEEKLY", days: [0, 3], time: "12:00" }, mode: "SCHEDULE", active: true, isTemplate: true, endsOn: dayFromNow(60) });
    expect(res.json?.["timeZone"]).toBe(ZONE);

    const row = await rowOf(w.task.id);
    expect(row).toMatchObject({ orgId: w.org.id, workspaceId: w.ws.id, projectId: w.made.project.id, boardId: w.made.board.id, createdById: w.member.id, active: true, stoppedReason: null });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).recurrenceId).toBe(row.id);
    // the first copy comes on the first chosen weekday after BOTH the task's own day and now, at noon, company time
    expect(row.nextDueAt!.getTime()).toBeGreaterThan(w.task.dueDate!.getTime());
    const p = zonedParts(row.nextDueAt!, ZONE);
    expect([0, 3]).toContain(p.weekday);
    expect([p.hour, p.minute]).toEqual([12, 0]);
    expect(row.endsAt!.toISOString()).toBe(new Date(noonOf(dayFromNow(60)).getTime() + 12 * 3600_000 - 1).toISOString());

    const read = await get(w.task.id);
    expect(recOf(read)?.id).toBe(row.id);
    expect(await recurringTaskIds([w.task.id])).toEqual(new Set([w.task.id]));
  });

  it("setting it again changes the SAME series (one row per template); an «on completion» series has no schedule", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const res = await put(w.task.id, { rule: { kind: "MONTHLY", day: 31 }, mode: "ON_COMPLETE" });
    expect(recOf(res)).toMatchObject({ rule: { kind: "MONTHLY", day: 31 }, mode: "ON_COMPLETE", nextDueAt: null });
    expect(await db.taskRecurrence.count({ where: { templateTaskId: w.task.id } })).toBe(1);
  });

  it("refuses a weekly rule without days, a bad end date, an end in the past and an end before the first task", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await put(w.task.id, { rule: { kind: "WEEKLY", days: [] }, mode: "SCHEDULE" })).status).toBe(422);
    expect((await put(w.task.id, { rule: { kind: "HOURLY" }, mode: "SCHEDULE" })).status).toBe(422);
    expect((await put(w.task.id, { ...DAILY, mode: "EVERY_NOW_AND_THEN" })).status).toBe(422);
    const bad = await put(w.task.id, { ...DAILY, mode: "SCHEDULE", endsOn: "2031-02-30" });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.json)).toContain("recurrence.end_invalid");
    const past = await put(w.task.id, { ...DAILY, mode: "SCHEDULE", endsOn: dayFromNow(-3) });
    expect(JSON.stringify(past.json)).toContain("recurrence.end_past");
    // the task is due in two days, so the first copy is in three: ending tomorrow ends before it
    const early = await put(w.task.id, { ...DAILY, mode: "SCHEDULE", endsOn: dayFromNow(1) });
    expect(JSON.stringify(early.json)).toContain("recurrence.end_before_first");
    expect(await db.taskRecurrence.count({ where: { templateTaskId: w.task.id } })).toBe(0);
  });
});

describe("«تكرار»: who may set it", () => {
  it("a guest of the space reads and never writes", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    await loginAs(w.guest.id);
    expect((await get(w.task.id)).status).toBe(200);
    expect((await put(w.task.id, { rule: { kind: "YEARLY" }, mode: "SCHEDULE" })).status).toBe(403);
    expect((await stop(w.task.id)).status).toBe(403);
    expect((await rowOf(w.task.id)).rule).toMatchObject({ kind: "DAILY" });
  });

  it("somebody who is not in the space, and another company's owner, get nothing", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "من برّا" });
    await loginAs(outsider.id);
    expect((await put(w.task.id, { ...DAILY, mode: "SCHEDULE" })).status).not.toBe(200);
    expect((await get(w.task.id)).status).not.toBe(200);
    const elsewhere = await makeTeam();
    await loginAs(elsewhere.owner.id);
    expect((await put(w.task.id, { ...DAILY, mode: "SCHEDULE" })).status).not.toBe(200);
    expect(await db.taskRecurrence.count({ where: { templateTaskId: w.task.id } })).toBe(0);
  });

  it("the owner reading a space he is not in reads, and sets nothing (403); once he has joined, he sets like anybody", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const refused = await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("recurrence.oversight_readonly");
    expect((await get(w.task.id)).status).toBe(200);
    expect(await db.taskRecurrence.count({ where: { templateTaskId: w.task.id } })).toBe(0);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "ADMIN" } });
    expect((await put(w.task.id, { ...DAILY, mode: "SCHEDULE" })).status).toBe(200);
  });

  it("any task of the series edits the series; a copy says it is not the template", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await runDueJobs(after(series.nextDueAt));
    const [copy] = await copies(w, series.id);
    expect(copy).toBeTruthy();
    await loginAs(w.mate.id);
    const seen = await get(copy!.id);
    expect(recOf(seen)).toMatchObject({ id: series.id, isTemplate: false });
    const res = await put(copy!.id, { rule: { kind: "WEEKLY", days: [1] }, mode: "SCHEDULE" });
    expect(res.status).toBe(200);
    expect(await db.taskRecurrence.count({ where: { orgId: w.org.id } })).toBe(1);
    expect((await rowOf(w.task.id)).createdById).toBe(w.mate.id);
  });
});

describe("«حسب الجدول»: the runner makes the next task once", () => {
  it("makes a REAL task with the template's details, and two runs at the same moment make ONE", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // the template sits in the done column: the copy must still land in the FIRST column of the board, open
    await db.task.update({ where: { id: w.task.id }, data: { columnId: w.made.done.id, completedAt: new Date() } });
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    const moment = after(series.nextDueAt);

    const [a, b] = await Promise.all([runDueJobs(moment), runDueJobs(moment)]);
    expect((a.recurrences?.created ?? 0) + (b.recurrences?.created ?? 0)).toBe(1);
    expect(a.failed.concat(b.failed)).toEqual([]);
    await flushPushesForTests();

    const made = await copies(w, series.id);
    expect(made).toHaveLength(1);
    const copy = made[0]!;
    expect(copy).toMatchObject({
      title: "تقرير الأسبوع",
      description: "اكتب التقرير وأرسله",
      priority: "HIGH",
      type: "TASK",
      columnId: w.made.todo.id,
      boardId: w.made.board.id,
      projectId: w.made.project.id,
      workspaceId: w.ws.id,
      assigneeId: w.mate.id,
      creatorId: w.member.id,
      completedAt: null,
      recurrenceId: series.id,
    });
    expect(copy.dueDate!.toISOString()).toBe(series.nextDueAt!.toISOString());
    expect(copy.labels.map((l) => l.labelId)).toEqual([w.label.id]);
    // the step TITLES, unticked
    expect(copy.steps.map((s) => [s.title, s.done, s.doneById])).toEqual([
      ["اجمع الأرقام", false, null],
      ["راجعها", false, null],
    ]);
    // the template's own steps are untouched
    expect((await db.taskStep.findMany({ where: { taskId: w.task.id }, orderBy: { position: "asc" } })).map((s) => s.done)).toEqual([true, false]);

    const moved = await rowOf(w.task.id);
    expect(moved.nextDueAt!.getTime()).toBeGreaterThan(moment.getTime());
    expect(moved.lastCreatedAt).not.toBeNull();
    expect(moved.active).toBe(true);

    // the assignee is told once, with the usual new-task bell
    expect(await db.notification.count({ where: { userId: w.mate.id, type: "task_assigned", taskId: copy.id } })).toBe(1);
    // a run at the same moment later makes nothing more
    const again = await runDueJobs(moment);
    expect(again.recurrences?.created).toBe(0);
    expect(await copies(w, series.id)).toHaveLength(1);
  });

  it("a task of a series is also a task of the board: the badge reads it and `createdAt` order is the series order", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await runDueJobs(after(series.nextDueAt));
    const [copy] = await copies(w, series.id);
    expect(await recurringTaskIds([w.task.id, copy!.id, "nope"])).toEqual(new Set([w.task.id, copy!.id]));
    await stop(w.task.id);
    expect(await recurringTaskIds([w.task.id, copy!.id])).toEqual(new Set());
  });

  it("creates the next one even though the last is still open (the series is on a schedule, not waiting)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await runDueJobs(after(series.nextDueAt));
    const second = (await rowOf(w.task.id)).nextDueAt;
    const run = await runDueJobs(after(second));
    expect(run.recurrences?.created).toBe(1);
    const made = await copies(w, series.id);
    expect(made).toHaveLength(2);
    expect(made.every((t) => t.completedAt === null)).toBe(true);
    expect(made[1]!.dueDate!.getTime()).toBeGreaterThan(made[0]!.dueDate!.getTime());
  });

  it("makes none while an open occurrence is not yet due (and still moves the date on)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    // somebody already has an open one due far ahead
    const future = await w.mk({ title: "قادمة", dueDate: new Date(series.nextDueAt!.getTime() + 30 * DAY) });
    await db.task.update({ where: { id: future.id }, data: { recurrenceId: series.id } });
    const run = await runDueJobs(after(series.nextDueAt));
    expect(run.recurrences).toMatchObject({ created: 0, skipped: 1 });
    expect(await copies(w, series.id)).toHaveLength(1);
    expect((await rowOf(w.task.id)).nextDueAt!.getTime()).toBeGreaterThan(series.nextDueAt!.getTime());
  });

  it("after an outage makes ONE task (the latest occurrence that has passed), never one per missed day", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    const late = new Date(series.nextDueAt!.getTime() + 9 * DAY + 3600_000);
    const run = await runDueJobs(late);
    expect(run.recurrences?.created).toBe(1);
    const made = await copies(w, series.id);
    expect(made).toHaveLength(1);
    // the one task is due on the latest day that has passed, not on the first missed one
    expect(made[0]!.dueDate!.toISOString()).toBe(new Date(series.nextDueAt!.getTime() + 9 * DAY).toISOString());
    expect((await rowOf(w.task.id)).nextDueAt!.toISOString()).toBe(new Date(series.nextDueAt!.getTime() + 10 * DAY).toISOString());
    expect((await runDueJobs(late)).recurrences?.created).toBe(0);
  });

  it("a series with no due date makes tasks with none, and waits while one is open", async () => {
    const w = await world();
    const bare = await w.mk({ title: "بلا موعد", dueDate: null });
    await loginAs(w.member.id);
    await put(bare.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(bare.id);
    expect(series.nextDueAt).not.toBeNull();
    expect((await runDueJobs(after(series.nextDueAt))).recurrences?.created).toBe(1);
    const [first] = await db.task.findMany({ where: { recurrenceId: series.id, id: { not: bare.id } } });
    expect(first!.dueDate).toBeNull();
    // no due date: nothing is ever late, so one open occurrence is enough
    const next = (await rowOf(bare.id)).nextDueAt;
    expect((await runDueJobs(after(next))).recurrences).toMatchObject({ created: 0, skipped: 1 });
  });
});

describe("«عند الإنجاز»: finishing one makes the next, once", () => {
  it("the tick box makes the next task (due on the next occurrence), copies the steps unticked, and a double click makes ONE", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE" });
    const series = await rowOf(w.task.id);
    const ctx = { userId: w.member.id, orgId: w.org.id };

    // two clicks at the same moment: one completion, one hook
    await Promise.all([setTaskCompletion(ctx, w.task.id, true), setTaskCompletion(ctx, w.task.id, true)]);
    await flushPushesForTests();
    const made = await copies(w, series.id);
    expect(made).toHaveLength(1);
    const copy = made[0]!;
    // the template was due in two days: the next one is the day after, at noon, company time
    expect(copy.dueDate!.toISOString()).toBe(new Date(w.task.dueDate!.getTime() + DAY).toISOString());
    expect(copy).toMatchObject({ title: "تقرير الأسبوع", columnId: w.made.todo.id, assigneeId: w.mate.id, completedAt: null, recurrenceId: series.id });
    expect(copy.steps.map((s) => [s.title, s.done])).toEqual([["اجمع الأرقام", false], ["راجعها", false]]);
    expect(await db.notification.count({ where: { userId: w.mate.id, type: "task_assigned", taskId: copy.id } })).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).not.toBeNull();

    // the same click through the route, once more: still one
    await loginAs(w.member.id);
    const again = await call(completeRoute.POST, { params: { id: w.task.id }, body: { complete: true } });
    expect(again.status).toBe(200);
    expect(await copies(w, series.id)).toHaveLength(1);
  });

  it("reopening and finishing again adds nothing while an open occurrence exists; finishing that one makes the next", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE" });
    const series = await rowOf(w.task.id);
    const ctx = { userId: w.member.id, orgId: w.org.id };
    await setTaskCompletion(ctx, w.task.id, true);
    await setTaskCompletion(ctx, w.task.id, false);
    await setTaskCompletion(ctx, w.task.id, true);
    const [first] = await copies(w, series.id);
    expect(await copies(w, series.id)).toHaveLength(1);

    await setTaskCompletion(ctx, first!.id, true);
    const made = await copies(w, series.id);
    expect(made).toHaveLength(2);
    expect(made[1]!.dueDate!.getTime()).toBeGreaterThan(first!.dueDate!.getTime());
  });

  it("moving the card into the done column is the same completion (and only the move INTO it)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE" });
    const series = await rowOf(w.task.id);
    const ctx = { userId: w.member.id, orgId: w.org.id };
    await moveTask(ctx, w.task.id, { columnId: w.made.done.id });
    expect(await copies(w, series.id)).toHaveLength(1);
    // dragged around inside the done column, or out and in again while the copy is open: nothing more
    await moveTask(ctx, w.task.id, { columnId: w.made.done.id, index: 0 });
    await moveTask(ctx, w.task.id, { columnId: w.made.todo.id });
    await moveTask(ctx, w.task.id, { columnId: w.made.done.id });
    expect(await copies(w, series.id)).toHaveLength(1);
  });

  it("a task that is not in a series, and a series that is stopped or on a schedule, make nothing on completion", async () => {
    const w = await world();
    const plain = await w.mk({ title: "عادية" });
    const ctx = { userId: w.member.id, orgId: w.org.id };
    await setTaskCompletion(ctx, plain.id, true);
    expect(await db.task.count({ where: { orgId: w.org.id, title: "عادية" } })).toBe(1);

    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await setTaskCompletion(ctx, w.task.id, true);
    expect(await copies(w, series.id)).toHaveLength(0);

    await setTaskCompletion(ctx, w.task.id, false);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE" });
    await stop(w.task.id);
    await setTaskCompletion(ctx, w.task.id, true);
    expect(await copies(w, series.id)).toHaveLength(0);
  });

  it("the end date: past it, finishing makes nothing and the series ends", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE", endsOn: dayFromNow(60) });
    const series = await rowOf(w.task.id);
    // the series ends the day the template is due: the next one would be after it
    await db.taskRecurrence.update({ where: { id: series.id }, data: { endsAt: new Date(w.task.dueDate!.getTime() + 3600_000) } });
    await setTaskCompletion({ userId: w.member.id, orgId: w.org.id }, w.task.id, true);
    expect(await copies(w, series.id)).toHaveLength(0);
    expect(await rowOf(w.task.id)).toMatchObject({ active: false, stoppedReason: "ENDED" });
  });

  it("a series that cannot go on never costs the person their own completion", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "ON_COMPLETE" });
    const series = await rowOf(w.task.id);
    await suspend(w.org.id, w.member.id); // the maker is gone
    // somebody else finishes it
    await setTaskCompletion({ userId: w.mate.id, orgId: w.org.id }, w.task.id, true);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).completedAt).not.toBeNull();
    expect(await copies(w, series.id)).toHaveLength(0);
    expect(await rowOf(w.task.id)).toMatchObject({ active: false, stoppedReason: "CREATOR_INACTIVE" });
  });
});

describe("a series acts as the person who set it: the rank rule of a hand-made task holds", () => {
  it("an assignee ABOVE the maker is asked (a request, nobody assigned); one below is assigned; a lead's equal is assigned", async () => {
    const w = await world();
    // the template's people: an admin (above the member who sets the series) and the colleague (the maker's own rank)
    const above = await w.mk({ title: "إلى المدير", assigneeId: w.admin.id });
    const level = await w.mk({ title: "إلى الزميل", assigneeId: w.mate.id });
    await loginAs(w.member.id);
    for (const t of [above, level]) await put(t.id, { ...DAILY, mode: "SCHEDULE" });
    const now = after((await rowOf(above.id)).nextDueAt);
    await runDueJobs(now);
    await flushPushesForTests();

    const aboveSeries = await rowOf(above.id);
    const [askedCopy] = await db.task.findMany({ where: { recurrenceId: aboveSeries.id, id: { not: above.id } } });
    expect(askedCopy).toMatchObject({ assigneeId: null, creatorId: w.member.id });
    const requests = await db.taskAssignRequest.findMany({ where: { taskId: askedCopy!.id } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ fromUserId: w.member.id, toUserId: w.admin.id, status: "PENDING" });
    expect(await db.notification.count({ where: { userId: w.admin.id, type: "task_assign_request", taskId: askedCopy!.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.admin.id, type: "task_assigned", taskId: askedCopy!.id } })).toBe(0);

    const levelSeries = await rowOf(level.id);
    const [direct] = await db.task.findMany({ where: { recurrenceId: levelSeries.id, id: { not: level.id } } });
    expect(direct!.assigneeId).toBe(w.mate.id);
    expect(await db.taskAssignRequest.count({ where: { taskId: direct!.id } })).toBe(0);
  });

  it("the people beside the first are copied through the same judge (a higher one is asked, the rest are added)", async () => {
    const w = await world();
    const task = await w.mk({ title: "لأكثر من شخص", assigneeId: w.mate.id });
    await db.taskCoAssignee.createMany({ data: [{ taskId: task.id, userId: w.lead.id }, { taskId: task.id, userId: w.admin.id }] });
    await loginAs(w.member.id);
    await put(task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(task.id);
    await runDueJobs(after(series.nextDueAt));
    const [copy] = await db.task.findMany({ where: { recurrenceId: series.id, id: { not: task.id } }, include: { coAssignees: true } });
    expect(copy!.assigneeId).toBe(w.mate.id);
    // the lead is ABOVE a member too, so only the first person is direct; both higher people are asked
    const asked = await db.taskAssignRequest.findMany({ where: { taskId: copy!.id } });
    expect(asked.map((r) => r.toUserId).sort()).toEqual([w.admin.id, w.lead.id].sort());
    expect(copy!.coAssignees).toHaveLength(0);
  });

  it("an admin who sets the series gives the same template to the colleague directly", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    expect(series.createdById).toBe(w.admin.id);
    await runDueJobs(after(series.nextDueAt));
    const [copy] = await copies(w, series.id);
    expect(copy).toMatchObject({ assigneeId: w.mate.id, creatorId: w.admin.id });
    expect(await db.taskAssignRequest.count({ where: { taskId: copy!.id } })).toBe(0);
  });
});

describe("the end of a series, and a series that cannot go on", () => {
  it("makes the last task that falls on or before the end date, then stops; a later run makes nothing", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE", endsOn: dayFromNow(5) });
    const series = await rowOf(w.task.id);
    // the runner was down past the end date: the one task is the last occurrence ON the end day, and the series ends
    const run = await runDueJobs(new Date(series.endsAt!.getTime() + 3 * DAY));
    expect(run.recurrences?.created).toBe(1);
    const made = await copies(w, series.id);
    expect(made).toHaveLength(1);
    expect(made[0]!.dueDate!.getTime()).toBeLessThanOrEqual(series.endsAt!.getTime());
    expect(await rowOf(w.task.id)).toMatchObject({ active: false, stoppedReason: "ENDED" });
    expect((await runDueJobs(new Date(series.endsAt!.getTime() + 9 * DAY))).recurrences?.created).toBe(0);
    expect(await copies(w, series.id)).toHaveLength(1);
  });

  it("a series already past its end makes nothing and ends", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await db.taskRecurrence.update({ where: { id: series.id }, data: { endsAt: new Date(series.nextDueAt!.getTime() - 1000) } });
    const run = await runDueJobs(after(series.nextDueAt));
    expect(run.recurrences).toMatchObject({ created: 0, stopped: 1 });
    expect(await rowOf(w.task.id)).toMatchObject({ active: false, stoppedReason: "ENDED" });
    expect(await copies(w, series.id)).toHaveLength(0);
  });

  it.each([
    ["the space is archived", (w: World) => db.workspace.update({ where: { id: w.ws.id }, data: { archivedAt: new Date() } })],
    ["the project is archived", (w: World) => db.project.update({ where: { id: w.made.project.id }, data: { status: "ARCHIVED" } })],
    ["the board is archived", (w: World) => db.board.update({ where: { id: w.made.board.id }, data: { archived: true } })],
  ])("%s: the series stops with the reason, and makes nothing", async (_name, archive) => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await archive(w);
    const run = await runDueJobs(after(series.nextDueAt));
    expect(run.recurrences).toMatchObject({ created: 0, stopped: 1 });
    expect(await rowOf(w.task.id)).toMatchObject({ active: false, stoppedReason: "ARCHIVED" });
    expect(await copies(w, series.id)).toHaveLength(0);
  });

  it("a deleted project takes its series with it, and the runner has nothing to trip over; deleting the template deletes its series, the copies stay", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await runDueJobs(after(series.nextDueAt));
    const [copy] = await copies(w, series.id);
    await db.task.delete({ where: { id: w.task.id } });
    expect(await db.taskRecurrence.count({ where: { id: series.id } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: copy!.id } })).recurrenceId).toBeNull();

    const other = await w.mk({ title: "ثانية" });
    await put(other.id, { ...DAILY, mode: "SCHEDULE" });
    const second = await rowOf(other.id);
    await db.project.delete({ where: { id: w.made.project.id } });
    expect(await db.taskRecurrence.count({ where: { id: second.id } })).toBe(0);
    expect((await runDueJobs(after(second.nextDueAt))).failed).toEqual([]);
  });

  it("a maker who is no longer ACTIVE stops the series (CREATOR_INACTIVE); somebody else's series is untouched", async () => {
    const w = await world();
    const mine = w.task;
    const theirs = await w.mk({ title: "لغيري" });
    await loginAs(w.member.id);
    await put(mine.id, { ...DAILY, mode: "SCHEDULE" });
    await loginAs(w.admin.id);
    await put(theirs.id, { ...DAILY, mode: "SCHEDULE" });
    const stopped = await rowOf(mine.id);
    const kept = await rowOf(theirs.id);
    await suspend(w.org.id, w.member.id);
    const run = await runDueJobs(after(kept.nextDueAt));
    expect(run.recurrences).toMatchObject({ created: 1, stopped: 1 });
    expect(await rowOf(mine.id)).toMatchObject({ active: false, stoppedReason: "CREATOR_INACTIVE" });
    expect(await copies(w, stopped.id)).toHaveLength(0);
    expect(await db.task.count({ where: { recurrenceId: kept.id, id: { not: theirs.id } } })).toBe(1);
  });

  it("one series that fails never blocks the others", async () => {
    const w = await world();
    const bad = await w.mk({ title: "معطوبة" });
    await loginAs(w.member.id);
    await put(bad.id, { ...DAILY, mode: "SCHEDULE" });
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const broken = await rowOf(bad.id);
    // a rule that no longer parses: stopped as FAILED, the other series still runs
    await db.taskRecurrence.update({ where: { id: broken.id }, data: { rule: { nonsense: true } } });
    const run = await runDueJobs(after((await rowOf(w.task.id)).nextDueAt, 3600_000));
    expect(run.failed).toEqual([]);
    expect(run.recurrences).toMatchObject({ created: 1, stopped: 1 });
    expect(await rowOf(bad.id)).toMatchObject({ active: false, stoppedReason: "FAILED" });
  });
});

describe("stopping a series keeps every task already made", () => {
  it("«إيقاف»: the runner skips it, the tasks stay, and setting it again starts it again", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    await runDueJobs(after(series.nextDueAt));
    expect(await copies(w, series.id)).toHaveLength(1);

    const res = await stop(w.task.id);
    expect(res.status).toBe(200);
    expect(recOf(res)).toMatchObject({ active: false, stoppedReason: null });
    const next = (await rowOf(w.task.id)).nextDueAt;
    expect((await runDueJobs(after(next, 5 * DAY))).recurrences).toMatchObject({ created: 0 });
    expect(await copies(w, series.id)).toHaveLength(1);

    const back = await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    expect(recOf(back)).toMatchObject({ active: true });
    expect((await rowOf(w.task.id)).active).toBe(true);
  });

  it("stopping a task that is in no series is «not found»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await stop(w.task.id);
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("recurrence.not_found");
  });
});

describe("«الميزات»: the «مهمة متكررة» switch", () => {
  it("off: the routes answer 404, the runner and the completion make nothing, and the series waits; on again, they work", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const onComplete = await w.mk({ title: "عند الإنجاز" });
    await put(onComplete.id, { ...DAILY, mode: "ON_COMPLETE" });
    const series = await rowOf(w.task.id);
    const chain = await rowOf(onComplete.id);

    await setSwitch(w.org.id, false);
    for (const res of [await get(w.task.id), await put(w.task.id, { ...DAILY, mode: "SCHEDULE" }), await stop(w.task.id)]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    const moment = after(series.nextDueAt);
    const off = await runDueJobs(moment);
    expect(off.recurrences?.created).toBe(0);
    await setTaskCompletion({ userId: w.member.id, orgId: w.org.id }, onComplete.id, true);
    expect(await copies(w, series.id)).toHaveLength(0);
    expect(await db.task.count({ where: { recurrenceId: chain.id, id: { not: onComplete.id } } })).toBe(0);
    // nothing was lost and nothing moved
    expect((await rowOf(w.task.id)).nextDueAt!.toISOString()).toBe(series.nextDueAt!.toISOString());
    expect((await rowOf(w.task.id)).active).toBe(true);

    await setSwitch(w.org.id, true);
    expect((await get(w.task.id)).status).toBe(200);
    const on = await runDueJobs(moment);
    expect(on.recurrences?.created).toBe(1);
    expect(await copies(w, series.id)).toHaveLength(1);
  });

  it("another company's switch does not touch this company's series", async () => {
    const w = await world();
    const other = await makeTeam();
    await setSwitch(other.org.id, false);
    await loginAs(w.member.id);
    await put(w.task.id, { ...DAILY, mode: "SCHEDULE" });
    const series = await rowOf(w.task.id);
    expect((await runDueJobs(after(series.nextDueAt))).recurrences?.created).toBe(1);
  });
});
