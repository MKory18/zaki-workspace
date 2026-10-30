import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as taskTimeRoute from "@/app/api/tasks/[id]/time/route";
import * as startRoute from "@/app/api/tasks/[id]/time/start/route";
import * as manualRoute from "@/app/api/tasks/[id]/time/manual/route";
import * as stopRoute from "@/app/api/time/stop/route";
import * as meRoute from "@/app/api/time/me/route";
import * as entryRoute from "@/app/api/time/[id]/route";
import { withFeature } from "@/lib/features";
import { AUTO_STOP_SECONDS } from "@/lib/time-tracking";
import { runDueJobs } from "@/server/jobs/run";
import { addManualEntry, deleteEntry, myTimeToday, startTimer, stopTimer, taskTimeCard, updateEntry } from "@/server/services/time-tracking";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «حساب وقت الشغل» — the time people log on tasks (the owner, 2026-10-30).
 *
 * What this pins, against a real PostgreSQL:
 *  - a timer's length is two readings of the SERVER's clock; nothing a browser sends is read (a body claiming another
 *    start or another length changes nothing);
 *  - ONE running timer per person: starting on another task closes the first and says which; the same task twice changes
 *    nothing; parallel starts leave exactly one; and the partial unique index refuses a second running row on its own;
 *  - `runDueJobs(now)` closes a timer that ran MORE than 12 hours at `startedAt + 12h`, marks it, writes ONE audit row even
 *    when several runs race, skips a company whose switch is off, and does not touch what is not yet due;
 *  - a manual entry is at most 24 h, a person logs at most 24 h on one calendar day of the COMPANY's zone (across a zone
 *    that is not UTC and across the day the clocks change), never in the future, and not older than 14 days for a member;
 *  - an entry is changed or deleted by its owner within 14 days of creating it, or by the space's OWNER/ADMIN always;
 *    every change keeps the previous values in `AuditLog`; a running timer's time is locked;
 *  - spaces and people are separate: a member never reads another person's entries, a manager reads those of THEIR space
 *    only, and an entry of another space is «not found»;
 *  - a guest never tracks, the owner reading a space he is not in never starts a timer (403), the company's switch closes
 *    every door (404) and the runner;
 *  - an archived task keeps its entries, and a task that is hard-deleted leaves them with their title and no task.
 */

// The runner works on EVERY company's timers and the test database is shared by the whole run: start each test empty.
beforeEach(async () => {
  await db.timeEntry.deleteMany({});
});
afterAll(async () => {
  await db.timeEntry.deleteMany({});
});

const HOUR = 3_600_000;

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "زميل" });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: mate.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  const mk = (title: string, workspaceId = ws.id, project = made) =>
    makeTask({ orgId: team.org.id, workspaceId, projectId: project.project.id, boardId: project.board.id, columnId: project.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title });
  const task = await mk("المهمة");
  const other = await mk("مهمة تانية");
  // a second space: only the member's mate is in it
  const ws2 = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: mate.id }], "مساحة ثانية");
  const made2 = await makeProject(ws2.id, "مشروع ثاني");
  const task2 = await mk("مهمة المساحة الثانية", ws2.id, made2);
  return { ...team, mate, ws, ws2, made, made2, task, other, task2, mk };
}

type World = Awaited<ReturnType<typeof world>>;

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "timeTracking", on) as Prisma.InputJsonValue } });
}

/** A finished entry written straight to the table (so a test does not depend on the routes' clock). */
const seed = (w: World, userId: string, taskId: string | null, over: Partial<Prisma.TimeEntryUncheckedCreateInput> = {}) =>
  db.timeEntry.create({
    data: { orgId: w.org.id, workspaceId: w.ws.id, userId, taskId, taskTitle: "مهمة", startedAt: new Date("2031-03-10T06:00:00.000Z"), stoppedAt: new Date("2031-03-10T07:00:00.000Z"), seconds: 3600, source: "TIMER", ...over },
  });

const T0 = new Date("2031-03-10T06:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

/** The company's day `n` days before today, safe for both UTC and Damascus (the routes run on the real clock). */
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * HOUR).toISOString().slice(0, 10);
/** A moment relative to the real clock (an entry's `createdAt` is the real one, so the 14-day window is measured from it). */
const NOWMS = Date.now();
const live = (ms = 0) => new Date(NOWMS + ms);

const auditOf = (action: string, target: string) => db.auditLog.findMany({ where: { action, target }, orderBy: { createdAt: "asc" } });

describe("the timer: lengths come from the server's clock", () => {
  it("starts and stops: the duration is the difference of the server's two readings", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const started = await startTimer(w.task.id, T0);
    expect(started.entry).toMatchObject({ running: true, stoppedAt: null, seconds: 0, source: "TIMER", taskId: w.task.id, taskTitle: "المهمة", userId: w.member.id });
    expect(started.stopped).toBeNull();
    expect(started.already).toBe(false);
    const row = await db.timeEntry.findUniqueOrThrow({ where: { id: started.entry.id } });
    expect(row).toMatchObject({ orgId: w.org.id, workspaceId: w.ws.id, stoppedAt: null, seconds: 0, autoStopped: false });
    expect(row.startedAt.toISOString()).toBe(T0.toISOString());

    const stopped = await stopTimer(at(5400_000 + 999));
    expect(stopped).toMatchObject({ running: false, seconds: 5400, autoStopped: false });
    const done = await db.timeEntry.findUniqueOrThrow({ where: { id: started.entry.id } });
    expect(done.stoppedAt!.toISOString()).toBe(at(5400_999).toISOString());
    expect(done.seconds).toBe(5400);
  });

  it("reads nothing the browser says about time: a body that claims another start or another length changes nothing", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const before = Date.now();
    const res = await call(startRoute.POST, { params: { id: w.task.id }, body: { startedAt: "1999-01-01T00:00:00Z", seconds: 99999 } });
    expect(res.status).toBe(201);
    const id = (res.json as { entry: { id: string } }).entry.id;
    const row = await db.timeEntry.findUniqueOrThrow({ where: { id } });
    expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.startedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(row.seconds).toBe(0);

    const stop = await call(stopRoute.POST, { body: { seconds: 86400, stoppedAt: "2099-01-01T00:00:00Z" } });
    expect(stop.status).toBe(200);
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id } });
    expect(closed.seconds).toBeLessThan(30);
    expect(closed.stoppedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("a stop with nothing running is «not running»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(stopRoute.POST, { body: {} });
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("tt.e.not_running");
  });

  it("a timer past 12 hours that a person stops closes at startedAt + 12h and is marked, with an audit row", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const { entry } = await startTimer(w.task.id, T0);
    const stopped = await stopTimer(at(20 * HOUR));
    expect(stopped).toMatchObject({ seconds: AUTO_STOP_SECONDS, autoStopped: true });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).stoppedAt!.toISOString()).toBe(at(12 * HOUR).toISOString());
    expect(await auditOf("time.entry_auto_stopped", entry.id)).toHaveLength(1);
  });

  it("today's line: the finished time of the company's day and the running timer, with the server's clock", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const now = new Date("2031-03-10T10:00:00.000Z");
    await seed(w, w.member.id, w.task.id, { startedAt: new Date("2031-03-10T06:00:00.000Z"), stoppedAt: new Date("2031-03-10T07:30:00.000Z"), seconds: 5400 });
    // yesterday does not count
    await seed(w, w.member.id, w.task.id, { startedAt: new Date("2031-03-08T06:00:00.000Z"), stoppedAt: new Date("2031-03-08T09:00:00.000Z"), seconds: 10800 });
    await startTimer(w.task.id, new Date("2031-03-10T09:50:00.000Z"));
    const today = await myTimeToday(now);
    expect(today.todaySeconds).toBe(5400);
    expect(today.running).toMatchObject({ taskId: w.task.id, running: true });
    expect(today.serverNow).toBe(now.toISOString());
    const viaRoute = await call(meRoute.GET);
    expect(viaRoute.status).toBe(200);
  });
});

describe("one running timer per person", () => {
  it("starting on another task closes the first and says which; the same task twice changes nothing", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await startTimer(w.task.id, T0);
    const again = await startTimer(w.task.id, at(60_000));
    expect(again.already).toBe(true);
    expect(again.entry.id).toBe(a.entry.id);
    expect(again.stopped).toBeNull();
    expect(await db.timeEntry.count({ where: { userId: w.member.id } })).toBe(1);

    const b = await startTimer(w.other.id, at(600_000));
    expect(b.stopped).toMatchObject({ id: a.entry.id, taskTitle: "المهمة", seconds: 600, running: false });
    expect(b.entry).toMatchObject({ taskId: w.other.id, running: true });
    const rows = await db.timeEntry.findMany({ where: { userId: w.member.id }, orderBy: { startedAt: "asc" } });
    expect(rows.map((r) => r.stoppedAt === null)).toEqual([false, true]);
    expect(rows[0]!.seconds).toBe(600);
  });

  it("five starts at once leave exactly one running timer and lose no entry", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const tasks = [w.task, w.other, await w.mk("ثالثة"), await w.mk("رابعة"), await w.mk("خامسة")];
    const results = await Promise.all(tasks.map((t) => startTimer(t.id)));
    expect(results).toHaveLength(5);
    const rows = await db.timeEntry.findMany({ where: { userId: w.member.id } });
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.stoppedAt === null)).toHaveLength(1);
    // the ones that were closed carry a real length, never a negative or an absurd one
    for (const r of rows.filter((x) => x.stoppedAt !== null)) {
      expect(r.seconds).toBeGreaterThanOrEqual(0);
      expect(r.seconds).toBeLessThan(60);
    }
  });

  it("the database itself refuses a second running row for a person (the partial unique index), and only for a running one", async () => {
    const w = await world();
    const running = (userId: string) => seed(w, userId, w.task.id, { stoppedAt: null, seconds: 0 });
    await running(w.member.id);
    await expect(running(w.member.id)).rejects.toThrow();
    // another person may run one at the same time
    await expect(running(w.mate.id)).resolves.toBeTruthy();
    // a finished row never collides, however many
    await seed(w, w.member.id, w.task.id);
    await seed(w, w.member.id, w.task.id);
    expect(await db.timeEntry.count({ where: { userId: w.member.id, stoppedAt: null } })).toBe(1);
    // and closing the running one frees the slot
    await db.timeEntry.updateMany({ where: { userId: w.member.id, stoppedAt: null }, data: { stoppedAt: at(HOUR) } });
    await expect(running(w.member.id)).resolves.toBeTruthy();
  });

  it("two people each have their own running timer", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await startTimer(w.task.id, T0);
    await loginAs(w.mate.id);
    await startTimer(w.task.id, at(1000));
    expect(await db.timeEntry.count({ where: { stoppedAt: null } })).toBe(2);
  });
});

describe("the job runner closes a timer left running more than 12 hours", () => {
  const stale = (w: World, over: Partial<Prisma.TimeEntryUncheckedCreateInput> = {}, userId = w.member.id) =>
    seed(w, userId, w.task.id, { startedAt: T0, stoppedAt: null, seconds: 0, ...over });

  it("not at 12 hours exactly; one second past it, at startedAt + 12h, marked, with an audit row", async () => {
    const w = await world();
    const row = await stale(w);
    expect((await runDueJobs(at(12 * HOUR))).timeEntries).toEqual({ stopped: 0 });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: row.id } })).stoppedAt).toBeNull();

    expect((await runDueJobs(at(12 * HOUR + 1000))).timeEntries).toEqual({ stopped: 1 });
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: row.id } });
    expect(closed.stoppedAt!.toISOString()).toBe(at(12 * HOUR).toISOString());
    expect(closed.seconds).toBe(AUTO_STOP_SECONDS);
    expect(closed.autoStopped).toBe(true);
    const audit = await auditOf("time.entry_auto_stopped", row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ orgId: w.org.id, workspaceId: w.ws.id, actorId: null });
    expect(audit[0]!.meta).toMatchObject({ by: "job", userId: w.member.id, seconds: AUTO_STOP_SECONDS });
    // a later run finds nothing more
    expect((await runDueJobs(at(13 * HOUR))).timeEntries).toEqual({ stopped: 0 });
    expect(await auditOf("time.entry_auto_stopped", row.id)).toHaveLength(1);
  });

  it("a runner that was down for a day still closes it at the 12th hour, never at the moment it ran", async () => {
    const w = await world();
    const row = await stale(w);
    await runDueJobs(at(30 * HOUR));
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: row.id } });
    expect(closed.stoppedAt!.toISOString()).toBe(at(12 * HOUR).toISOString());
    expect(closed.seconds).toBe(AUTO_STOP_SECONDS);
  });

  it("exactly once when several runs race: one closure, one audit row", async () => {
    const w = await world();
    const row = await stale(w);
    const runs = await Promise.all([runDueJobs(at(13 * HOUR)), runDueJobs(at(13 * HOUR)), runDueJobs(at(13 * HOUR)), runDueJobs(at(13 * HOUR))]);
    expect(runs.reduce((n, r) => n + (r.timeEntries?.stopped ?? 0), 0)).toBe(1);
    expect(runs.every((r) => r.failed.length === 0)).toBe(true);
    expect(await auditOf("time.entry_auto_stopped", row.id)).toHaveLength(1);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: row.id } })).seconds).toBe(AUTO_STOP_SECONDS);
  });

  it("a person who stops it in the same instant and the runner never both write: one closure, one audit row", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const row = await stale(w);
    const [job] = await Promise.all([runDueJobs(at(13 * HOUR)), stopTimer(at(13 * HOUR)).catch(() => null)]);
    expect(job.failed).toEqual([]);
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: row.id } });
    expect(closed.stoppedAt!.toISOString()).toBe(at(12 * HOUR).toISOString());
    expect(closed.seconds).toBe(AUTO_STOP_SECONDS);
    expect(await auditOf("time.entry_auto_stopped", row.id)).toHaveLength(1);
  });

  it("leaves a timer that is not yet due, and one that is already stopped", async () => {
    const w = await world();
    const fresh = await stale(w, { startedAt: at(10 * HOUR) });
    const done = await seed(w, w.mate.id, w.task.id, { startedAt: T0, stoppedAt: at(HOUR), seconds: 3600 });
    expect((await runDueJobs(at(13 * HOUR))).timeEntries).toEqual({ stopped: 0 });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: fresh.id } })).stoppedAt).toBeNull();
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: done.id } })).seconds).toBe(3600);
  });

  it("skips a company whose switch is off, and closes it when the switch is back; another company is unaffected", async () => {
    const a = await world();
    const b = await world();
    await setSwitch(a.org.id, false);
    const rowA = await stale(a);
    const rowB = await stale(b);
    expect((await runDueJobs(at(13 * HOUR))).timeEntries).toEqual({ stopped: 1 });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: rowA.id } })).stoppedAt).toBeNull();
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: rowB.id } })).autoStopped).toBe(true);
    await setSwitch(a.org.id, true);
    expect((await runDueJobs(at(13 * HOUR))).timeEntries).toEqual({ stopped: 1 });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: rowA.id } })).autoStopped).toBe(true);
  });

  it("the marked entry can be corrected by its owner, and the mark goes with the correction (the audit row keeps what it was)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const row = await stale(w);
    await runDueJobs(at(13 * HOUR));
    const fixed = await updateEntry(row.id, { hours: 3, minutes: 30 }, live());
    expect(fixed).toMatchObject({ seconds: 12600, autoStopped: false });
    const audit = await auditOf("time.entry_edited", row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ before: { seconds: AUTO_STOP_SECONDS, autoStopped: true }, after: { seconds: 12600, autoStopped: false } });
  });
});

describe("a manual entry", () => {
  const NOW = new Date("2031-03-10T10:00:00.000Z"); // 13:00 in Damascus (UTC+3)

  it("is stored in whole seconds at noon of its day in the company's zone, and shows in the task's total", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const entry = await addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 30, note: "  اجتماع  " }, NOW);
    expect(entry).toMatchObject({ source: "MANUAL", seconds: 5400, note: "اجتماع", day: "2031-03-09", running: false, taskTitle: "المهمة" });
    const row = await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.startedAt.toISOString()).toBe("2031-03-09T09:00:00.000Z"); // noon in Damascus
    expect(row.stoppedAt!.toISOString()).toBe("2031-03-09T10:30:00.000Z");
    const card = await taskTimeCard(w.task.id, NOW);
    expect(card.totalSeconds).toBe(5400);
    expect(card.entries.map((e) => e.id)).toEqual([entry.id]);
  });

  it("is at most 24 hours, at least a minute, minutes 0-59, whole numbers", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const tryIt = async (hours: unknown, minutes: unknown) =>
      call(manualRoute.POST, { params: { id: w.task.id }, body: { date: daysAgo(3), hours, minutes } });
    expect((await tryIt(24, 0)).status).toBe(201);
    const over = await tryIt(24, 1);
    expect(over.status).toBe(422);
    expect(JSON.stringify(over.json)).toContain("tt.e.too_long");
    for (const [h, m] of [[0, 0], [1, 60], [-1, 30], [1.5, 0], [1, 0.5]] as const) {
      const res = await tryIt(h, m);
      expect(res.status, `${h}:${m}`).toBe(422);
      expect(JSON.stringify(res.json)).toContain("tt.e.bad_duration");
    }
    expect((await tryIt("1", "30")).status).toBe(422);
    expect(await db.timeEntry.count({ where: { userId: w.member.id } })).toBe(1);
  });

  it("refuses a day that has not come, an impossible date, and (for a member) a day older than 14 days", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const add = (date: string) => addManualEntry(w.task.id, { date, hours: 1, minutes: 0 }, NOW).then(() => "ok", (e: { issues?: { message: string }[] }) => e.issues?.[0]?.message ?? "error");
    expect(await add("2031-03-10")).toBe("ok"); // today in the company's zone
    expect(await add("2031-03-11")).toBe("tt.e.future_date");
    expect(await add("2031-02-30")).toBe("tt.e.bad_date");
    expect(await add("10/03/2031")).toBe("tt.e.bad_date");
    expect(await add("2031-02-24")).toBe("ok"); // 14 days back
    expect(await add("2031-02-23")).toBe("tt.e.too_old");
    // the space's ADMIN may back-date
    await loginAs(w.admin.id);
    await expect(addManualEntry(w.task.id, { date: "2030-12-01", hours: 1, minutes: 0 }, NOW)).resolves.toBeTruthy();
  });

  it("a note is at most 500 characters", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await expect(addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0, note: "ي".repeat(500) }, NOW)).resolves.toBeTruthy();
    await expect(addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0, note: "ي".repeat(501) }, NOW)).rejects.toMatchObject({ issues: [{ message: "tt.e.note_long" }] });
  });

  it("a person logs at most 24 hours on one day, whatever the entries (manual and timer), and another day is untouched", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await addManualEntry(w.task.id, { date: "2031-03-09", hours: 20, minutes: 0 }, NOW);
    await expect(addManualEntry(w.other.id, { date: "2031-03-09", hours: 4, minutes: 1 }, NOW)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    await expect(addManualEntry(w.other.id, { date: "2031-03-09", hours: 4, minutes: 0 }, NOW)).resolves.toBeTruthy();
    await expect(addManualEntry(w.other.id, { date: "2031-03-09", hours: 0, minutes: 1 }, NOW)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    await expect(addManualEntry(w.other.id, { date: "2031-03-08", hours: 24, minutes: 0 }, NOW)).resolves.toBeTruthy();
    // somebody else's day is their own
    await loginAs(w.mate.id);
    await expect(addManualEntry(w.task.id, { date: "2031-03-09", hours: 24, minutes: 0 }, NOW)).resolves.toBeTruthy();
  });

  it("two parallel entries that together pass the cap: one lands and one is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const results = await Promise.allSettled([
      addManualEntry(w.task.id, { date: "2031-03-09", hours: 15, minutes: 0 }, NOW),
      addManualEntry(w.other.id, { date: "2031-03-09", hours: 15, minutes: 0 }, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const sum = await db.timeEntry.aggregate({ _sum: { seconds: true }, where: { userId: w.member.id } });
    expect(sum._sum.seconds).toBe(15 * 3600);
  });

  it("the day is the COMPANY's: in New York an entry at 23:30 local belongs to that day, not to the next UTC day", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "America/New_York" } });
    await loginAs(w.member.id);
    const now = new Date("2026-11-05T15:00:00.000Z");
    // 2026-11-02T04:30Z is 23:30 EST on Nov 1: it counts against NOV 1
    await seed(w, w.member.id, w.task.id, { startedAt: new Date("2026-11-02T04:30:00.000Z"), stoppedAt: new Date("2026-11-02T05:00:00.000Z"), seconds: 20 * 3600 });
    await expect(addManualEntry(w.task.id, { date: "2026-11-01", hours: 5, minutes: 0 }, now)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    await expect(addManualEntry(w.task.id, { date: "2026-11-02", hours: 5, minutes: 0 }, now)).resolves.toBeTruthy();
    // 2026-11-03T05:00Z is 00:00 EST on Nov 3, the very first instant of that company day: it must not count against Nov 2
    await seed(w, w.member.id, w.task.id, { startedAt: new Date("2026-11-03T05:00:00.000Z"), stoppedAt: new Date("2026-11-03T06:00:00.000Z"), seconds: 24 * 3600 });
    await expect(addManualEntry(w.task.id, { date: "2026-11-02", hours: 0, minutes: 1 }, now)).resolves.toBeTruthy();
    await expect(addManualEntry(w.task.id, { date: "2026-11-03", hours: 0, minutes: 1 }, now)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
  });

  it("the day the clocks fall back lasts 25 hours and the cap is still 24; the day they spring forward lasts 23 and the cap is still 24", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "America/New_York" } });
    await loginAs(w.member.id);
    const now = new Date("2026-11-10T15:00:00.000Z");
    await addManualEntry(w.task.id, { date: "2026-11-01", hours: 24, minutes: 0 }, now);
    await expect(addManualEntry(w.other.id, { date: "2026-11-01", hours: 0, minutes: 1 }, now)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    // the next day starts clean even though the 25-hour day's entry ran past local midnight (noon + 24h)
    await expect(addManualEntry(w.other.id, { date: "2026-11-02", hours: 24, minutes: 0 }, now)).resolves.toBeTruthy();
    // the 23-hour day (spring forward) still holds a full 24 logged hours and no more
    const springNow = new Date("2026-03-20T15:00:00.000Z");
    await addManualEntry(w.task.id, { date: "2026-03-08", hours: 24, minutes: 0 }, springNow);
    await expect(addManualEntry(w.other.id, { date: "2026-03-08", hours: 0, minutes: 1 }, springNow)).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
  });
});

describe("changing and deleting an entry", () => {
  // These run on the real clock: an entry's `createdAt` is the real one, and the 14-day window is measured from it.
  const add = (taskId: string, hours: number, minutes: number, date = daysAgo(1), note?: string) => addManualEntry(taskId, { date, hours, minutes, ...(note !== undefined ? { note } : {}) });

  it("the owner edits within 14 days (the duration, the day of a manual one, the note) and every change keeps what it was", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const entry = await add(w.task.id, 1, 0, daysAgo(1), "قبل");
    const edited = await updateEntry(entry.id, { hours: 2, minutes: 15, note: "بعد", date: daysAgo(2) });
    expect(edited).toMatchObject({ seconds: 8100, note: "بعد", day: daysAgo(2) });
    const audit = await auditOf("time.entry_edited", entry.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: w.member.id, orgId: w.org.id, workspaceId: w.ws.id });
    expect(audit[0]!.meta).toMatchObject({
      before: { seconds: 3600, note: "قبل", userId: w.member.id, taskTitle: "المهمة" },
      after: { seconds: 8100, note: "بعد" },
      byManager: false,
    });
    // a second edit adds a second row; nothing is overwritten in the trail
    await updateEntry(entry.id, { note: "ثالث" });
    expect(await auditOf("time.entry_edited", entry.id)).toHaveLength(2);
    // an edit that changes nothing writes nothing
    await updateEntry(entry.id, { note: "ثالث" });
    expect(await auditOf("time.entry_edited", entry.id)).toHaveLength(2);
  });

  it("after 14 days the owner cannot change or delete it; the space's ADMIN and the OWNER always can, with the trail", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const entry = await add(w.task.id, 1, 0);
    const later = live(15 * 24 * HOUR);
    await expect(updateEntry(entry.id, { note: "متأخر" }, later)).rejects.toMatchObject({ message: "tt.e.window_closed" });
    await expect(deleteEntry(entry.id, later)).rejects.toMatchObject({ message: "tt.e.window_closed" });
    const viaRoute = await call(entryRoute.PATCH, { params: { id: entry.id }, body: { note: "x" } });
    expect(viaRoute.status).toBe(200); // the route runs with the real clock, inside the window
    // just inside the edge is still open
    await expect(updateEntry(entry.id, { note: "حافة" }, live(14 * 24 * HOUR - 60_000))).resolves.toBeTruthy();

    await loginAs(w.admin.id);
    const byAdmin = await updateEntry(entry.id, { hours: 3, minutes: 0 }, later);
    expect(byAdmin.seconds).toBe(10800);
    expect(byAdmin.userId).toBe(w.member.id); // still the member's entry
    const trail = await auditOf("time.entry_edited", entry.id);
    const last = trail[trail.length - 1]!;
    expect(last).toMatchObject({ actorId: w.admin.id });
    expect(last.meta).toMatchObject({ byManager: true, before: { seconds: 3600 }, after: { seconds: 10800 } });

    await loginAs(w.owner.id);
    await expect(updateEntry(entry.id, { note: "من المالك" }, later)).resolves.toBeTruthy();
    await expect(deleteEntry(entry.id, later)).resolves.toBeUndefined();
    const gone = await auditOf("time.entry_deleted", entry.id);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ actorId: w.owner.id });
    expect(gone[0]!.meta).toMatchObject({ byManager: true, before: { seconds: 10800, userId: w.member.id, taskTitle: "المهمة", note: "من المالك" } });
    expect(await db.timeEntry.count({ where: { id: entry.id } })).toBe(0);
  });

  it("a delete by the owner is audited with the whole entry as it was", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const entry = await add(w.task.id, 2, 5, daysAgo(1), "حذف");
    const res = await call(entryRoute.DELETE, { params: { id: entry.id } });
    expect(res.status).toBe(200);
    const trail = await auditOf("time.entry_deleted", entry.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.meta).toMatchObject({ byManager: false, before: { seconds: 7500, note: "حذف", source: "MANUAL" } });
  });

  it("somebody else's entry is «not found» for a plain member, never «forbidden»", async () => {
    const w = await world();
    await loginAs(w.mate.id);
    const theirs = await add(w.task.id, 1, 0);
    await loginAs(w.member.id);
    const patch = await call(entryRoute.PATCH, { params: { id: theirs.id }, body: { note: "اختراق" } });
    expect(patch.status).toBe(404);
    const del = await call(entryRoute.DELETE, { params: { id: theirs.id } });
    expect(del.status).toBe(404);
    expect(await call(entryRoute.PATCH, { params: { id: "no-such-id" }, body: { note: "x" } }).then((r) => r.status)).toBe(404);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: theirs.id } })).note).toBe("");
    expect(await db.auditLog.count({ where: { target: theirs.id, action: { startsWith: "time.entry_" } } })).toBe(0);
  });

  it("a running timer keeps its time: only the note changes until it is stopped, and a timer entry keeps its day", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const { entry } = await startTimer(w.task.id, live());
    await expect(updateEntry(entry.id, { hours: 1, minutes: 0 }, live(1000))).rejects.toMatchObject({ issues: [{ message: "tt.e.running_locked" }] });
    await expect(updateEntry(entry.id, { note: "شغّال" }, live(1000))).resolves.toMatchObject({ note: "شغّال", running: true });
    await stopTimer(live(3600_000));
    await expect(updateEntry(entry.id, { date: daysAgo(1) }, live(3600_000))).rejects.toMatchObject({ issues: [{ message: "tt.e.date_timer_locked" }] });
    const fixed = await updateEntry(entry.id, { hours: 0, minutes: 45 }, live(3600_000));
    expect(fixed.seconds).toBe(2700);
    // a running timer can be deleted (cancelled), and the slot is free again
    const second = await startTimer(w.other.id, live(7200_000));
    await expect(deleteEntry(second.entry.id, live(7300_000))).resolves.toBeUndefined();
    await expect(startTimer(w.task.id, live(7400_000))).resolves.toBeTruthy();
  });

  it("an edit cannot push a day past 24 hours; a note edit never fails on a full day", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await add(w.task.id, 20, 0, daysAgo(2));
    const b = await add(w.other.id, 4, 0, daysAgo(2));
    await expect(updateEntry(b.id, { hours: 4, minutes: 1 })).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    await expect(updateEntry(a.id, { note: "يوم ممتلئ" })).resolves.toBeTruthy();
    // moving an entry onto an empty day is allowed, and back onto the full one it left (it fits exactly)
    await expect(updateEntry(b.id, { date: daysAgo(3) })).resolves.toMatchObject({ day: daysAgo(3) });
    await expect(updateEntry(b.id, { date: daysAgo(2) })).resolves.toMatchObject({ day: daysAgo(2) });
    // ...but a day with one more minute on it is not
    const c = await add(w.other.id, 0, 1, daysAgo(3));
    await expect(updateEntry(c.id, { date: daysAgo(2) })).rejects.toMatchObject({ issues: [{ message: "tt.e.day_full" }] });
    // and never to a day that has not come
    const later = new Date(Date.now() + 2 * 24 * HOUR).toISOString().slice(0, 10);
    await expect(updateEntry(b.id, { date: later })).rejects.toMatchObject({ issues: [{ message: "tt.e.future_date" }] });
  });
});

describe("people and spaces are separate", () => {
  it("a member reads only their own entries of a task; the space's ADMIN and the OWNER read everybody's", async () => {
    const w = await world();
    const NOW = new Date("2031-03-10T10:00:00.000Z");
    await loginAs(w.member.id);
    const mine = await addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0 }, NOW);
    await loginAs(w.mate.id);
    const theirs = await addManualEntry(w.task.id, { date: "2031-03-09", hours: 2, minutes: 0 }, NOW);

    const asMate = await taskTimeCard(w.task.id, NOW);
    expect(asMate.entries.map((e) => e.id)).toEqual([theirs.id]);
    expect(asMate.totalSeconds).toBe(7200);
    expect(asMate.manager).toBe(false);

    await loginAs(w.admin.id);
    const asAdmin = await taskTimeCard(w.task.id, NOW);
    expect(asAdmin.entries.map((e) => e.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(asAdmin.totalSeconds).toBe(10800);
    expect(asAdmin.manager).toBe(true);
    expect(asAdmin.entries.every((e) => e.canEdit)).toBe(true);

    await loginAs(w.owner.id);
    expect((await taskTimeCard(w.task.id, NOW)).entries).toHaveLength(2);
  });

  it("a person cannot track on a task of a space they are not in, and the space's ADMIN reads only THEIR space", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(startRoute.POST, { params: { id: w.task2.id } });
    expect(res.status).toBe(403);
    expect((await call(manualRoute.POST, { params: { id: w.task2.id }, body: { date: "2031-03-09", hours: 1, minutes: 0 } })).status).toBe(403);
    expect((await call(taskTimeRoute.GET, { params: { id: w.task2.id } })).status).toBe(403);
    expect(await db.timeEntry.count({ where: { taskId: w.task2.id } })).toBe(0);

    // an entry in the second space, by the mate; the ADMIN of space ONE only (here: the member is not admin anywhere) cannot touch it
    await loginAs(w.mate.id);
    const inTwo = await addManualEntry(w.task2.id, { date: "2031-03-09", hours: 1, minutes: 0 }, new Date("2031-03-10T10:00:00.000Z"));
    await loginAs(w.member.id);
    expect((await call(entryRoute.PATCH, { params: { id: inTwo.id }, body: { note: "عبور" } })).status).toBe(404);
    expect((await call(entryRoute.DELETE, { params: { id: inTwo.id } })).status).toBe(404);
  });

  it("another company's entry is «not found» even for its own ADMIN-ranked stranger", async () => {
    const a = await world();
    const b = await world();
    await loginAs(a.mate.id);
    const entry = await addManualEntry(a.task.id, { date: "2031-03-09", hours: 1, minutes: 0 }, new Date("2031-03-10T10:00:00.000Z"));
    await loginAs(b.admin.id);
    expect((await call(entryRoute.DELETE, { params: { id: entry.id } })).status).toBe(404);
    expect(await db.timeEntry.count({ where: { id: entry.id } })).toBe(1);
  });
});

describe("who may track", () => {
  it("a guest never tracks, reads, stops or sees today's line (403)", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const results = [
      await call(startRoute.POST, { params: { id: w.task.id } }),
      await call(manualRoute.POST, { params: { id: w.task.id }, body: { date: "2031-03-09", hours: 1, minutes: 0 } }),
      await call(taskTimeRoute.GET, { params: { id: w.task.id } }),
      await call(stopRoute.POST, { body: {} }),
      await call(meRoute.GET),
    ];
    for (const res of results) expect(res.status).toBe(403);
    expect(results[3]!.json?.["message"]).toBe("tt.e.guest_denied");
    expect(results[4]!.json?.["message"]).toBe("tt.e.guest_denied");
    expect(await db.timeEntry.count()).toBe(0);
  });

  it("a member whose row in the space says GUEST never tracks either", async () => {
    const w = await world();
    const partner = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "ضيف المساحة" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: partner.id, role: "GUEST" } });
    await loginAs(partner.id);
    expect((await call(startRoute.POST, { params: { id: w.task.id } })).status).toBe(403);
    expect((await call(taskTimeRoute.GET, { params: { id: w.task.id } })).status).toBe(403);
  });

  it("the owner reading a space he is not in never starts a timer or adds time (403) but reads the card; once he joins, he tracks", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const start = await call(startRoute.POST, { params: { id: w.task.id } });
    expect(start.status).toBe(403);
    expect(start.json?.["message"]).toBe("tt.e.oversight_readonly");
    const manual = await call(manualRoute.POST, { params: { id: w.task.id }, body: { date: "2031-03-09", hours: 1, minutes: 0 } });
    expect(manual.status).toBe(403);
    expect(manual.json?.["message"]).toBe("tt.e.oversight_readonly");
    expect(await db.timeEntry.count()).toBe(0);
    const read = await call(taskTimeRoute.GET, { params: { id: w.task.id } });
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ canTrack: false, manager: true });
    // reading silently leaves no trace: no membership row, nothing written
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.owner.id } })).toBe(0);

    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "MEMBER" } });
    expect((await call(startRoute.POST, { params: { id: w.task.id } })).status).toBe(201);
  });

  it("an archived task keeps its entries and refuses a new timer (a manual entry is still allowed); a deleted task leaves them with their title", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const NOW = new Date("2031-03-10T10:00:00.000Z");
    const keep = await addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0 }, NOW);
    await db.task.update({ where: { id: w.task.id }, data: { archived: true } });
    expect(await db.timeEntry.count({ where: { id: keep.id } })).toBe(1);
    const start = await call(startRoute.POST, { params: { id: w.task.id } });
    expect(start.status).toBe(422);
    expect(JSON.stringify(start.json)).toContain("tt.e.task_archived");
    await expect(addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0 }, NOW)).resolves.toBeTruthy();
    const card = await taskTimeCard(w.task.id, NOW);
    expect(card.canTrack).toBe(false);
    expect(card.entries).toHaveLength(2);

    // hard delete: the entries stay, the task link becomes null, the title is the snapshot
    await db.task.delete({ where: { id: w.task.id } });
    const rows = await db.timeEntry.findMany({ where: { userId: w.member.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.taskId === null && r.taskTitle === "المهمة")).toBe(true);
    // a timer running on a task that is then deleted can still be stopped
    const { entry } = await startTimer(w.other.id, T0);
    await db.task.delete({ where: { id: w.other.id } });
    await expect(stopTimer(at(60_000))).resolves.toMatchObject({ id: entry.id, taskId: null, taskTitle: "مهمة تانية", seconds: 60 });
  });
});

describe("the company's switch", () => {
  it("off: every door answers «not found», the runner leaves the timers, nothing is lost; on again: everything is back", async () => {
    const w = await world();
    const NOW = new Date("2031-03-10T10:00:00.000Z");
    await loginAs(w.member.id);
    const entry = await addManualEntry(w.task.id, { date: "2031-03-09", hours: 1, minutes: 0 }, NOW);
    const running = (await startTimer(w.other.id, T0)).entry;
    await setSwitch(w.org.id, false);

    const calls = [
      await call(startRoute.POST, { params: { id: w.task.id } }),
      await call(manualRoute.POST, { params: { id: w.task.id }, body: { date: "2031-03-09", hours: 1, minutes: 0 } }),
      await call(taskTimeRoute.GET, { params: { id: w.task.id } }),
      await call(stopRoute.POST, { body: {} }),
      await call(meRoute.GET),
      await call(entryRoute.PATCH, { params: { id: entry.id }, body: { note: "x" } }),
      await call(entryRoute.DELETE, { params: { id: entry.id } }),
    ];
    for (const res of calls) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    expect((await runDueJobs(at(20 * HOUR))).timeEntries).toEqual({ stopped: 0 });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: running.id } })).stoppedAt).toBeNull();
    expect(await db.timeEntry.count({ where: { userId: w.member.id } })).toBe(2);

    await setSwitch(w.org.id, true);
    expect((await call(taskTimeRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
    expect((await runDueJobs(at(20 * HOUR))).timeEntries).toEqual({ stopped: 1 });
  });
});
