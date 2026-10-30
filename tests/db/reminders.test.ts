import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import * as remindersRoute from "@/app/api/reminders/route";
import * as reminderRoute from "@/app/api/reminders/[id]/route";
import { withFeature } from "@/lib/features";
import { runDueJobs } from "@/server/jobs/run";
import { JOBS_LOCK_KEY, tickJobs } from "@/server/jobs/scheduler";
import { flushPushesForTests } from "@/server/notify";
import { directPgUrl } from "@/server/realtime/listener";
import { conversationDetail } from "@/server/chat/topics";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «ذكّرني» and the in-app job runner (the owner's backlog, 2026-10-30).
 *
 * What this pins:
 *  - a person sets a reminder for THEMSELVES, reads only their own list, and only they snooze or dismiss one; the time
 *    is read on the COMPANY's wall clock, a time in the past is refused, and a task or message the person cannot read is
 *    «not found» (the answer never says it exists);
 *  - `runDueJobs(now)` fires a due reminder ONCE: two runs at the same moment, in parallel, write one notice each
 *    reminder, and a second run later writes none; the notice is a bell row of type `reminder` linking to the task or
 *    the message (Web Push goes out through the same door);
 *  - a repeating reminder is re-armed in the same commit (daily, in the company's zone) and fires again at its time;
 *  - snooze moves it, dismiss ends it;
 *  - a person who is no longer ACTIVE, or who can no longer read the task or the message, has the reminder dismissed
 *    without a word (a notice would leak the title or the link);
 *  - the company's switch: off, the routes answer 404 and the runner leaves the rows alone; on again, they fire;
 *  - the scheduler's tick takes the advisory lock, so a process that does not hold it skips.
 */

// The runner works on EVERY company's reminders and the test database is shared by the whole file: start each test empty.
beforeEach(async () => {
  await db.reminder.deleteMany({});
});

const WHEN = "2031-03-10T09:00"; // Damascus is UTC+3 all year: 06:00Z
const DUE = new Date("2031-03-10T06:00:00.000Z");
const AFTER = new Date("2031-03-10T06:00:30.000Z");

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "زميل" });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: mate.id }, { userId: team.admin.id, role: "ADMIN" }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  const task = await makeTask({ orgId: team.org.id, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title: "مهمة التذكير" });
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: ws.id, title: "موضوع" } });
  const message = await db.chatMessage.create({ data: { orgId: team.org.id, conversationId: topic.id, authorId: team.admin.id, body: "رسالة للتذكير" } });
  return { ...team, mate, ws, made, task, topic, message };
}

type Rem = { id: string; title: string; dueAt: string; repeat: string; status: string; fired: boolean; taskId: string | null; messageId: string | null; href: string | null };
const create = async (body: Record<string, unknown>) => {
  const res = await call(remindersRoute.POST, { body });
  return { res, reminder: (res.json as { reminder: Rem } | null)?.reminder };
};
const mine = async () => (await call(remindersRoute.GET)).json as { reminders: Rem[]; timeZone: string };
const notices = (userId: string) => db.notification.findMany({ where: { userId, type: "reminder" }, orderBy: { createdAt: "asc" } });

/** A reminder row written straight to the table (for the runner's own tests, so they do not depend on the route's clock). */
const row = (w: { org: { id: string } }, userId: string, over: Partial<Prisma.ReminderUncheckedCreateInput> = {}) =>
  db.reminder.create({ data: { orgId: w.org.id, userId, title: "اتصل بالمورّد", dueAt: DUE, ...over } });

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "reminders", on) as Prisma.InputJsonValue } });
}

describe("«ذكّرني»: setting and reading my own reminders", () => {
  it("is set for myself on a task, a message, or on its own, and the time is the company's wall clock", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const onTask = await create({ title: "راجع المهمة", dueAt: WHEN, taskId: w.task.id });
    expect(onTask.res.status).toBe(201);
    expect(onTask.reminder).toMatchObject({ title: "راجع المهمة", repeat: "NONE", status: "PENDING", taskId: w.task.id, href: `/tasks/${w.task.id}` });
    expect(onTask.reminder!.dueAt).toBe(DUE.toISOString());

    const onMessage = await create({ title: "رد عليها", dueAt: WHEN, messageId: w.message.id, repeat: "WEEKLY" });
    expect(onMessage.res.status).toBe(201);
    expect(onMessage.reminder!.href).toBe(`/chat/${w.topic.id}?m=${w.message.id}`);

    const alone = await create({ title: "دفع الإيجار", dueAt: "2031-03-12T10:30:00Z", repeat: "MONTHLY" });
    expect(alone.res.status).toBe(201);
    expect(alone.reminder).toMatchObject({ taskId: null, messageId: null, href: null, dueAt: "2031-03-12T10:30:00.000Z" });

    const stored = await db.reminder.findUniqueOrThrow({ where: { id: onTask.reminder!.id } });
    expect(stored).toMatchObject({ userId: w.member.id, orgId: w.org.id, status: "PENDING" });
    expect((await mine()).reminders.map((r) => r.title)).toEqual(["راجع المهمة", "رد عليها", "دفع الإيجار"]);
  });

  it("reads the time in the company's zone, whatever it is (Berlin: 09:00 is 08:00Z in winter)", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "Europe/Berlin" } });
    await loginAs(w.member.id);
    const made = await create({ title: "برلين", dueAt: "2031-01-15T09:00" });
    expect(made.reminder!.dueAt).toBe("2031-01-15T08:00:00.000Z");
    expect((await mine()).timeZone).toBe("Europe/Berlin");
  });

  it("lists only mine; nobody else sees, snoozes or dismisses it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const made = (await create({ title: "خاص", dueAt: WHEN })).reminder!;
    await loginAs(w.mate.id);
    expect((await mine()).reminders).toEqual([]);
    const snooze = await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "HOUR" } });
    expect(snooze.status).toBe(404);
    const dismiss = await call(reminderRoute.DELETE, { params: { id: made.id } });
    expect(dismiss.status).toBe(404);
    // the owner is nobody's reader here either
    await loginAs(w.owner.id);
    expect((await mine()).reminders).toEqual([]);
    expect(await db.reminder.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ status: "PENDING", userId: w.member.id });
  });

  it("refuses a time in the past, a bad time, a bad repeat, two targets, an empty or long title", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await create({ title: "x", dueAt: "2020-01-01T09:00" })).res.status).toBe(422);
    expect((await create({ title: "x", dueAt: "غدًا" })).res.status).toBe(422);
    expect((await create({ title: "x", dueAt: WHEN, repeat: "HOURLY" })).res.status).toBe(422);
    expect((await create({ title: "x", dueAt: WHEN, taskId: w.task.id, messageId: w.message.id })).res.status).toBe(422);
    expect((await create({ title: "   ", dueAt: WHEN })).res.status).toBe(422);
    expect((await create({ title: "ي".repeat(201), dueAt: WHEN })).res.status).toBe(422);
    expect(await db.reminder.count({ where: { userId: w.member.id } })).toBe(0);
  });

  it("is «not found» on a task or a message the person cannot read", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "من برّا" });
    await loginAs(outsider.id);
    const onTask = await create({ title: "x", dueAt: WHEN, taskId: w.task.id });
    expect(onTask.res.status).toBe(404);
    expect(onTask.res.json?.["message"]).toBe("task.not_found");
    const onMessage = await create({ title: "x", dueAt: WHEN, messageId: w.message.id });
    expect(onMessage.res.status).toBe(404);
    // another company's task too
    const elsewhere = await makeTeam();
    await loginAs(elsewhere.owner.id);
    expect((await create({ title: "x", dueAt: WHEN, taskId: w.task.id })).res.status).toBe(404);
    expect(await db.reminder.count({ where: { orgId: { in: [w.org.id, elsewhere.org.id] } } })).toBe(0);
  });

  it("snoozes («بعد ساعة», «بكرا الصبح») and dismisses", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const made = (await create({ title: "أجّلني", dueAt: WHEN })).reminder!;
    const before = Date.now();
    const hour = await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "HOUR" } });
    expect(hour.status).toBe(200);
    const afterHour = await db.reminder.findUniqueOrThrow({ where: { id: made.id } });
    expect(afterHour.status).toBe("PENDING");
    expect(afterHour.dueAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(afterHour.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(afterHour.snoozedUntil?.getTime()).toBe(afterHour.dueAt.getTime());

    const morning = await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "TOMORROW_MORNING" } });
    expect(morning.status).toBe(200);
    const afterMorning = await db.reminder.findUniqueOrThrow({ where: { id: made.id } });
    // 09:00 in Damascus (UTC+3) is 06:00Z, tomorrow
    expect(afterMorning.dueAt.getUTCHours()).toBe(6);
    expect(afterMorning.dueAt.getUTCMinutes()).toBe(0);
    expect(afterMorning.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(afterMorning.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 86_400_000);

    expect((await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "NEVER" } })).status).toBe(422);
    expect((await call(reminderRoute.DELETE, { params: { id: made.id } })).status).toBe(200);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: made.id } })).status).toBe("DISMISSED");
    expect((await mine()).reminders).toEqual([]);
    // saying «تمّ» twice changes nothing; a dismissed reminder cannot be snoozed back to life
    expect((await call(reminderRoute.DELETE, { params: { id: made.id } })).status).toBe(200);
    expect((await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "HOUR" } })).status).toBe(403);
  });
});

describe("the runner: a reminder fires once", () => {
  it("writes the bell notice (type reminder, linking to the task) and marks it FIRED", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { taskId: w.task.id });
    const run = await runDueJobs(AFTER);
    await flushPushesForTests();
    expect(run).toMatchObject({ reminders: { fired: 1, dismissed: 0 }, failed: [] });
    const [note] = await notices(w.member.id);
    expect(note).toMatchObject({ type: "reminder", body: "اتصل بالمورّد", linkUrl: `/tasks/${w.task.id}`, taskId: w.task.id, workspaceId: w.ws.id, organizationId: w.org.id });
    expect(note!.title).toMatch(/[؀-ۿ]/);
    expect(await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "FIRED" });
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).firedAt?.getTime()).toBe(AFTER.getTime());
    // the person's list now shows it as «وصل وقته»
    await loginAs(w.member.id);
    expect((await mine()).reminders.map((x) => [x.id, x.fired])).toEqual([[r.id, true]]);
  });

  it("links a message reminder to the message in its conversation, and a loose one to nothing", async () => {
    const w = await world();
    await row(w, w.member.id, { messageId: w.message.id, title: "الرسالة" });
    await row(w, w.member.id, { title: "لحاله" });
    await runDueJobs(AFTER);
    const byBody = new Map((await notices(w.member.id)).map((n) => [n.body, n]));
    expect(byBody.get("الرسالة")).toMatchObject({ linkUrl: `/chat/${w.topic.id}?m=${w.message.id}`, workspaceId: w.ws.id, taskId: null });
    expect(byBody.get("لحاله")).toMatchObject({ linkUrl: null, workspaceId: null });
  });

  it("does not fire what is not due yet", async () => {
    const w = await world();
    const r = await row(w, w.member.id);
    const run = await runDueJobs(new Date(DUE.getTime() - 1));
    expect(run.reminders).toEqual({ fired: 0, dismissed: 0 });
    expect(await notices(w.member.id)).toHaveLength(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });

  it("two runs at the same moment fire each reminder once (the claim is an UPDATE ... WHERE status = PENDING)", async () => {
    const w = await world();
    for (let i = 0; i < 6; i++) await row(w, w.member.id, { title: `تذكير ${i}`, repeat: i % 2 ? "DAILY" : "NONE" });
    const [a, b, c] = await Promise.all([runDueJobs(AFTER), runDueJobs(AFTER), runDueJobs(AFTER)]);
    await flushPushesForTests();
    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(c.failed).toEqual([]);
    expect((a.reminders!.fired) + (b.reminders!.fired) + (c.reminders!.fired)).toBe(6);
    expect(await notices(w.member.id)).toHaveLength(6);
    // and one more run later in the day writes nothing: the daily ones were re-armed for tomorrow
    const again = await runDueJobs(new Date(AFTER.getTime() + 3600_000));
    expect(again.reminders).toEqual({ fired: 0, dismissed: 0 });
    expect(await notices(w.member.id)).toHaveLength(6);
  });

  it("re-arms a repeating reminder for the next occurrence in the company's zone, in the same commit, and fires it again then", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { repeat: "DAILY", taskId: w.task.id });
    await runDueJobs(AFTER);
    const armed = await db.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(armed.status).toBe("PENDING");
    expect(armed.dueAt.toISOString()).toBe("2031-03-11T06:00:00.000Z"); // 09:00 Damascus the next day
    expect(armed.firedAt?.getTime()).toBe(AFTER.getTime());
    expect(await notices(w.member.id)).toHaveLength(1);

    await runDueJobs(new Date("2031-03-11T06:00:10.000Z"));
    expect(await notices(w.member.id)).toHaveLength(2);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).dueAt.toISOString()).toBe("2031-03-12T06:00:00.000Z");
  });

  it("keeps the wall clock for a company on a zone with a change of the clocks (Berlin, weekly, over 28 March 2032)", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "Europe/Berlin" } });
    const r = await row(w, w.member.id, { repeat: "WEEKLY", dueAt: new Date("2032-03-23T08:00:00.000Z") }); // 09:00 CET
    await runDueJobs(new Date("2032-03-23T08:00:30.000Z"));
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).dueAt.toISOString()).toBe("2032-03-30T07:00:00.000Z"); // 09:00 CEST
  });

  it("a runner that was down for a week fires once and continues from the next time after now", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { repeat: "DAILY" });
    await runDueJobs(new Date("2031-03-17T12:00:00.000Z"));
    expect(await notices(w.member.id)).toHaveLength(1);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).dueAt.toISOString()).toBe("2031-03-18T06:00:00.000Z");
  });

  it("a snoozed reminder waits for its new time, then fires", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const made = (await create({ title: "أجّلني", dueAt: WHEN })).reminder!;
    await call(reminderRoute.PATCH, { params: { id: made.id }, body: { snooze: "HOUR" } });
    // the snooze is an hour from the real clock: now it is not due (the original time is far ahead as well)
    expect((await runDueJobs(new Date())).reminders!.fired).toBe(0);
    expect(await notices(w.member.id)).toHaveLength(0);
    // two hours later it is due
    expect((await runDueJobs(new Date(Date.now() + 2 * 3_600_000))).reminders!.fired).toBe(1);
    expect(await notices(w.member.id)).toHaveLength(1);
  });

  it("a dismissed reminder never fires", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await row(w, w.member.id);
    expect((await call(reminderRoute.DELETE, { params: { id: r.id } })).status).toBe(200);
    expect((await runDueJobs(AFTER)).reminders).toEqual({ fired: 0, dismissed: 0 });
    expect(await notices(w.member.id)).toHaveLength(0);
  });
});

describe("the runner: whose reminder it still is", () => {
  it("a person who is no longer ACTIVE has it dismissed, silently", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { repeat: "DAILY" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { status: "SUSPENDED" } });
    const run = await runDueJobs(AFTER);
    expect(run.reminders).toEqual({ fired: 0, dismissed: 1 });
    expect(await notices(w.member.id)).toHaveLength(0);
    expect(await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "DISMISSED" });
  });

  it("a task the person can no longer read: dismissed, with no notice (it would leak the title)", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { taskId: w.task.id });
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member.id } } });
    const run = await runDueJobs(AFTER);
    expect(run.reminders).toEqual({ fired: 0, dismissed: 1 });
    expect(await notices(w.member.id)).toHaveLength(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DISMISSED");
  });

  it("a message the person can no longer read, or that was deleted: dismissed too", async () => {
    const w = await world();
    const gone = await row(w, w.member.id, { messageId: w.message.id });
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member.id } } });
    const deleted = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.admin.id, body: "ستُحذف" } });
    const other = await row(w, w.mate.id, { messageId: deleted.id });
    await db.chatMessage.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const run = await runDueJobs(AFTER);
    expect(run.reminders).toEqual({ fired: 0, dismissed: 2 });
    expect(await notices(w.member.id)).toHaveLength(0);
    expect(await notices(w.mate.id)).toHaveLength(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe("DISMISSED");
    expect((await db.reminder.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("DISMISSED");
  });

  it("a reminder dies with its task", async () => {
    const w = await world();
    const r = await row(w, w.member.id, { taskId: w.task.id });
    await db.task.delete({ where: { id: w.task.id } });
    expect(await db.reminder.count({ where: { id: r.id } })).toBe(0);
  });

  it("one broken reminder is logged and never stops the others", async () => {
    const w = await world();
    // a row whose person does not exist cannot be notified: the transaction rolls back, the other still fires
    await db.$executeRawUnsafe(`INSERT INTO "Reminder" ("id","orgId","userId","title","dueAt") VALUES ('rem_bad','${w.org.id}','nobody','معطوب','${DUE.toISOString()}')`);
    const good = await row(w, w.member.id);
    const run = await runDueJobs(AFTER);
    expect(run.failed).toEqual([]);
    expect(run.reminders!.fired).toBe(1);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: good.id } })).status).toBe("FIRED");
  });
});

describe("«ذكّرني»: the switch", () => {
  it("off: the routes answer 404, the runner leaves the rows alone, and on again they fire", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await row(w, w.member.id);
    await setSwitch(w.org.id, false);

    for (const res of [
      await call(remindersRoute.GET),
      await call(remindersRoute.POST, { body: { title: "x", dueAt: WHEN } }),
      await call(reminderRoute.PATCH, { params: { id: r.id }, body: { snooze: "HOUR" } }),
      await call(reminderRoute.DELETE, { params: { id: r.id } }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    expect((await runDueJobs(AFTER)).reminders).toEqual({ fired: 0, dismissed: 0 });
    expect(await notices(w.member.id)).toHaveLength(0);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");

    await setSwitch(w.org.id, true);
    expect((await runDueJobs(AFTER)).reminders).toEqual({ fired: 1, dismissed: 0 });
    expect(await notices(w.member.id)).toHaveLength(1);
  });

  it("one company's switch never touches another company's reminders", async () => {
    const a = await world();
    const b = await world();
    await setSwitch(a.org.id, false);
    await row(a, a.member.id);
    await row(b, b.member.id);
    expect((await runDueJobs(AFTER)).reminders).toEqual({ fired: 1, dismissed: 0 });
    expect(await notices(a.member.id)).toHaveLength(0);
    expect(await notices(b.member.id)).toHaveLength(1);
  });
});

describe("the scheduler's tick: one process works, under an advisory lock", () => {
  it("runs what is due when it holds the lock, releases it after, and skips while another connection holds it", async () => {
    const w = await world();
    await row(w, w.member.id);
    const holder = new Client({ connectionString: directPgUrl(process.env["DATABASE_URL"]!) });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1)", [JOBS_LOCK_KEY]);
      // another process holds it: this tick does nothing
      expect(await tickJobs(AFTER)).toBeNull();
      expect(await notices(w.member.id)).toHaveLength(0);
      await holder.query("SELECT pg_advisory_unlock($1)", [JOBS_LOCK_KEY]);
      // now it is free: the tick works, and leaves the lock free again
      const done = await tickJobs(AFTER);
      expect(done?.reminders).toEqual({ fired: 1, dismissed: 0 });
      const free = await holder.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [JOBS_LOCK_KEY]);
      expect(free.rows[0]?.locked).toBe(true);
      await holder.query("SELECT pg_advisory_unlock($1)", [JOBS_LOCK_KEY]);
    } finally {
      await holder.end();
    }
    expect(await notices(w.member.id)).toHaveLength(1);
  });

  it("the lock dies with the connection: a process that died while holding it frees it", async () => {
    const dead = new Client({ connectionString: directPgUrl(process.env["DATABASE_URL"]!) });
    await dead.connect();
    await dead.query("SELECT pg_advisory_lock($1)", [JOBS_LOCK_KEY]);
    expect(await tickJobs(AFTER)).toBeNull();
    await dead.end(); // the connection closes, as it does when the process dies
    // the server notices the closed connection a moment later
    let result = null;
    for (let i = 0; i < 20 && result === null; i++) {
      result = await tickJobs(AFTER);
      if (result === null) await new Promise((r) => setTimeout(r, 100));
    }
    expect(result).not.toBeNull();
  });
});

describe("«ذكّرني» in the message menu: the server's mirror (`me.canRemind`)", () => {
  const meOf = async (w: Awaited<ReturnType<typeof world>>, userId: string, orgRole: "MEMBER" | "OWNER") =>
    (await conversationDetail({ orgId: w.org.id, userId, orgRole } as never, w.topic.id)).me.canRemind;

  it("on for a member who reads the topic, off with the switch, and never for the owner in silent oversight", async () => {
    const w = await world();
    expect(await meOf(w, w.member.id, "MEMBER")).toBe(true);
    // the owner reads this topic without being in it: no menu, no reminder
    expect(await meOf(w, w.owner.id, "OWNER")).toBe(false);
    await setSwitch(w.org.id, false);
    expect(await meOf(w, w.member.id, "MEMBER")).toBe(false);
    await setSwitch(w.org.id, true);
    expect(await meOf(w, w.member.id, "MEMBER")).toBe(true);
  });
});
