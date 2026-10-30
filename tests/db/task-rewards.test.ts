import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// The webhook door of the company: recorded, never sent (every payload of a task event is read below).
const dispatched: { orgId: string; event: string; payload: unknown }[] = [];
vi.mock("@/server/services/n8n", async (orig) => ({
  ...(await orig<typeof import("@/server/services/n8n")>()),
  dispatchEvent: vi.fn(async (orgId: string, event: string, payload: unknown) => {
    dispatched.push({ orgId, event, payload });
  }),
}));

import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as stepsRoute from "@/app/api/tasks/[id]/steps/route";
import * as stepRoute from "@/app/api/tasks/[id]/steps/[stepId]/route";
import * as rewardRoute from "@/app/api/tasks/[id]/reward/route";
import * as awardRoute from "@/app/api/tasks/[id]/reward/award/route";
import * as cancelRoute from "@/app/api/tasks/[id]/reward/cancel/route";
import * as pinRoute from "@/app/api/tasks/[id]/pin/route";
import * as totalsRoute from "@/app/api/rewards/totals/route";
import * as instantTaskRoute from "@/app/api/instant/task/route";
import * as instantRoute from "@/app/api/instant/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import * as featuresRoute from "@/app/api/settings/features/route";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { flushPushesForTests } from "@/server/notify";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { openRewardTotals } from "@/server/services/rewards";
import { queryTasksForView } from "@/server/services/views";
import { REWARD_FIELDS } from "@/server/policy/reward";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «مهمة بمكافأة» and «تثبيت» (the owner, 2026-10-30): a task with a reward, a due date and an amount; only the OWNER rank
 * (the co-owners with him) sets, edits, cancels or deletes it; the finished task is awarded to ONE of its people, once;
 * a partner (GUEST) is never shown a reward field; and a pin sorts first. Everything runs through the real routes and a real
 * database, so the rank is the one the database says.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const DAY = 86_400_000;
const future = () => new Date(Date.now() + 3 * DAY);

const sent: PushMessage[] = [];
beforeEach(() => {
  dispatched.length = 0;
  sent.length = 0;
  setPushSenderForTests(async (_sub, payload) => {
    sent.push(JSON.parse(payload) as PushMessage);
    return { statusCode: 201 };
  });
});
afterAll(() => setPushSenderForTests(null));

async function world() {
  const t = await makeTeam();
  const coOwner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "CoOwner" });
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Lead" });
  const member2 = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Member2" });
  const ws = await makeWorkspace(
    t.org.id,
    [
      { userId: t.admin.id, role: "ADMIN" },
      { userId: lead.id },
      { userId: t.member.id },
      { userId: member2.id },
      { userId: t.guest.id, role: "GUEST" },
    ],
    "مساحة",
  );
  const made = await makeProject(ws.id, "مشروع");
  const plain = (title: string, extra: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId: t.org.id, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: t.owner.id, assigneeId: t.member.id, title, ...extra });
  /** A reward task written straight to the table (the fixture never depends on the code under test). */
  const reward = async (title = "مهمة بمكافأة", over: Prisma.TaskUpdateInput = {}, extra: Partial<Parameters<typeof makeTask>[0]> = {}) => {
    const task = await plain(title, { dueDate: future(), ...extra });
    return db.task.update({
      where: { id: task.id },
      data: { rewardStatus: "OPEN", rewardAmountMinor: 15000, rewardCurrency: "JOD", rewardNote: "ملاحظة", ...over },
    });
  };
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, coOwner, lead, member2, ws, made, plain, reward };
}
type World = Awaited<ReturnType<typeof world>>;

const patch = (id: string, body: unknown) => call(taskRoute.PATCH, { method: "PATCH", params: { id }, body });
const del = (id: string) => call(taskRoute.DELETE, { method: "DELETE", params: { id } });
const setRewardOn = (id: string, body: unknown) => call(rewardRoute.POST, { params: { id }, body });
const award = (id: string, userId: string) => call(awardRoute.POST, { params: { id }, body: { userId } });
const cancel = (id: string, reason: string) => call(cancelRoute.POST, { params: { id }, body: { reason } });
const pin = (id: string, pinned: boolean) => call(pinRoute.POST, { params: { id }, body: { pinned } });
const flip = (key: string, on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key, on } });
const fresh = (id: string) => db.task.findUniqueOrThrow({ where: { id } });
const dueDay = () => future().toISOString().slice(0, 10);
const createBody = (w: World, extra: Record<string, unknown> = {}) => ({
  workspaceId: w.ws.id,
  projectId: w.made.project.id,
  boardId: w.made.board.id,
  title: "مهمة جديدة",
  dueDate: dueDay(),
  reward: { amount: "12.5", currency: "USD", note: "شكرًا" },
  ...extra,
});
const messageOf = (res: { json: Record<string, unknown> | null }) => res.json?.["message"];
const detailKey = (res: { json: Record<string, unknown> | null }) => (res.json?.["details"] as { message: string }[] | undefined)?.[0]?.message;

describe("creating a reward task: the owner only, with a day and an amount", () => {
  it("the owner and a co-owner create it; the amount is stored in exact minor units and the creation is audited", async () => {
    const w = await world();
    for (const who of [w.owner, w.coOwner]) {
      await loginAs(who.id);
      const res = await call(tasksRoute.POST, { body: createBody(w) });
      expect(res.status, who.name).toBe(201);
      const id = (res.json?.["task"] as { id: string }).id;
      const row = await fresh(id);
      expect(row).toMatchObject({ rewardStatus: "OPEN", rewardAmountMinor: 1250, rewardCurrency: "USD", rewardNote: "شكرًا" });
      expect(row.dueDate).not.toBeNull();
      const logged = await db.auditLog.findMany({ where: { action: "task.reward_set", target: id } });
      expect(logged).toHaveLength(1);
      expect(logged[0]!.actorId).toBe(who.id);
    }
  });

  it("an admin, a lead and a member are refused with reward.owner_only, and nothing is created", async () => {
    const w = await world();
    for (const who of [w.admin, w.lead, w.member]) {
      await loginAs(who.id);
      const res = await call(tasksRoute.POST, { body: createBody(w, { title: `by ${who.name}` }) });
      expect(res.status, who.name).toBe(403);
      expect(messageOf(res), who.name).toBe("reward.owner_only");
    }
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    // the same person still makes a plain task
    await loginAs(w.member.id);
    const plain = createBody(w);
    delete (plain as Record<string, unknown>)["reward"];
    expect((await call(tasksRoute.POST, { body: plain })).status).toBe(201);
  });

  it("a reward without a due date, or with 0, a negative, a huge or a garbled amount, is refused (422) and writes nothing", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const noDay = createBody(w);
    delete (noDay as Record<string, unknown>)["dueDate"];
    const res = await call(tasksRoute.POST, { body: noDay });
    expect(res.status).toBe(422);
    expect(detailKey(res)).toBe("reward.due_required");
    for (const [amount, key] of [
      ["0", "reward.amount_invalid"],
      ["-5", "reward.amount_invalid"],
      ["abc", "reward.amount_invalid"],
      ["1.234", "reward.amount_invalid"],
      ["1000000.01", "reward.amount_too_big"],
    ] as const) {
      const r = await call(tasksRoute.POST, { body: createBody(w, { reward: { amount, currency: "USD" } }) });
      expect(r.status, amount).toBe(422);
      expect(detailKey(r), amount).toBe(key);
    }
    // exactly at the cap is fine; a currency outside the picker is not
    expect((await call(tasksRoute.POST, { body: createBody(w, { reward: { amount: "1000000", currency: "USD" } }) })).status).toBe(201);
    const odd = await call(tasksRoute.POST, { body: createBody(w, { reward: { amount: "5", currency: "XXX" } }) });
    expect(detailKey(odd)).toBe("reward.currency_invalid");
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(1);
  });

  it("the currency comes from the company's default when it has one, and is required when it has not", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const noCurrency = await call(tasksRoute.POST, { body: createBody(w, { reward: { amount: "5" } }) });
    expect(noCurrency.status).toBe(422);
    expect(detailKey(noCurrency)).toBe("reward.currency_required");
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { defaultCurrency: "JOD" } } });
    const ok = await call(tasksRoute.POST, { body: createBody(w, { reward: { amount: "5" } }) });
    expect(ok.status).toBe(201);
    expect(await fresh((ok.json?.["task"] as { id: string }).id)).toMatchObject({ rewardCurrency: "JOD", rewardAmountMinor: 500 });
  });

  it("the instant dialog's route follows the same rule: owner yes (and the dialog is offered), member 403", async () => {
    const w = await world();
    const body = { title: "فوري", assigneeId: w.member.id, priority: "HIGH", dueDate: dueDay(), reward: { amount: "20", currency: "EUR" } };
    await loginAs(w.member.id);
    const no = await call(instantTaskRoute.POST, { body });
    expect(no.status).toBe(403);
    expect(messageOf(no)).toBe("reward.owner_only");
    expect((await call(instantRoute.GET)).json?.["reward"]).toBeNull();

    await loginAs(w.owner.id);
    expect((await call(instantRoute.GET)).json?.["reward"]).toEqual({ defaultCurrency: null });
    const yes = await call(instantTaskRoute.POST, { body });
    expect(yes.status).toBe(201);
    expect(await fresh((yes.json?.["task"] as { id: string }).id)).toMatchObject({ rewardStatus: "OPEN", rewardAmountMinor: 2000, rewardCurrency: "EUR" });
    // without a day: refused
    const noDay = await call(instantTaskRoute.POST, { body: { ...body, dueDate: undefined } });
    expect(noDay.status).toBe(422);
  });
});

describe("a reward task is the owner's: every writer refuses everybody else", () => {
  it("title, description, day, priority, archive, a reward edit, cancel and delete: 403 for an admin, a lead and a member", async () => {
    const w = await world();
    const task = await w.reward();
    const before = await fresh(task.id);
    const writers: [string, () => Promise<{ status: number; json: Record<string, unknown> | null }>][] = [
      ["title", () => patch(task.id, { title: "غيّرتها" })],
      ["description", () => patch(task.id, { description: "x" })],
      ["due date", () => patch(task.id, { dueDate: "2031-01-01" })],
      ["clear due date", () => patch(task.id, { dueDate: null })],
      ["priority", () => patch(task.id, { priority: "LOW" })],
      ["archive", () => patch(task.id, { archived: true })],
      ["a reward inside the generic patch", () => patch(task.id, { reward: { amount: "1", currency: "USD" } })],
      ["edit the reward", () => setRewardOn(task.id, { amount: "1", currency: "USD" })],
      ["cancel", () => cancel(task.id, "سبب")],
      ["award", () => award(task.id, w.member.id)],
      ["delete", () => del(task.id)],
    ];
    for (const who of [w.admin, w.lead, w.member]) {
      await loginAs(who.id);
      for (const [name, run] of writers) {
        const res = await run();
        expect(res.status, `${who.name}: ${name}`).toBe(403);
        // deleting any task already needs the space's ADMIN: a lead and a member are stopped one door earlier
        const early = name === "delete" && who !== w.admin;
        expect(messageOf(res), `${who.name}: ${name}`).toBe(early ? "insufficient_role" : "reward.owner_only");
      }
    }
    expect(await fresh(task.id)).toEqual(before);
  });

  it("the owner and a co-owner may edit it, change its reward and delete it", async () => {
    const w = await world();
    const task = await w.reward();
    for (const who of [w.owner, w.coOwner]) {
      await loginAs(who.id);
      expect((await patch(task.id, { title: `by ${who.name}` })).status, who.name).toBe(200);
      expect((await patch(task.id, { description: "تفصيل" })).status).toBe(200);
      const edit = await setRewardOn(task.id, { amount: "30", currency: "USD", note: "جديدة" });
      expect(edit.status, who.name).toBe(200);
    }
    expect(await fresh(task.id)).toMatchObject({ title: "by CoOwner", rewardAmountMinor: 3000, rewardCurrency: "USD", rewardNote: "جديدة", rewardStatus: "OPEN" });
    // a day can never be taken off an open reward
    const clear = await patch(task.id, { dueDate: null });
    expect(clear.status).toBe(422);
    expect(detailKey(clear)).toBe("reward.due_required");
    expect((await del(task.id)).status).toBe(200);
    expect(await db.task.count({ where: { id: task.id } })).toBe(0);
  });

  it("a plain task is untouched by all this: a member still edits and its admin still deletes it", async () => {
    const w = await world();
    const task = await w.plain("عادية");
    await loginAs(w.member.id);
    expect((await patch(task.id, { title: "عدّلتها" })).status).toBe(200);
    await loginAs(w.admin.id);
    expect((await del(task.id)).status).toBe(200);
  });

  it("the assignee may finish it, reopen it, comment and tick its steps — and nothing else", async () => {
    const w = await world();
    const task = await w.reward("بمكافأة", {}, { assigneeId: w.member.id });
    const step = await db.taskStep.create({ data: { orgId: w.org.id, taskId: task.id, title: "خطوة", position: 1000 } });
    await loginAs(w.member.id);
    expect((await call(completeRoute.POST, { params: { id: task.id }, body: { complete: true } })).status).toBe(200);
    expect((await fresh(task.id)).completedAt).not.toBeNull();
    expect((await call(completeRoute.POST, { params: { id: task.id }, body: { complete: false } })).status).toBe(200);
    expect((await call(moveRoute.POST, { params: { id: task.id }, body: { columnId: w.made.done.id } })).status).toBe(200);
    expect((await call(commentsRoute.POST, { params: { id: task.id }, body: { body: "تمّت" } })).status).toBeLessThan(300);
    const tick = await call(stepRoute.PATCH, { method: "PATCH", params: { id: task.id, stepId: step.id }, body: { done: true } });
    expect(tick.status).toBe(200);
    expect((await call(stepsRoute.POST, { params: { id: task.id }, body: { title: "ثانية" } })).status).toBe(201);
    // …but not the title, the day or the task itself
    expect((await patch(task.id, { title: "x" })).status).toBe(403);
    expect((await patch(task.id, { dueDate: "2031-01-01" })).status).toBe(403);
    expect((await del(task.id)).status).toBe(403);
  });

  it("the owner assigns anybody directly, and a plain assignment is not blocked by the lock", async () => {
    const w = await world();
    const task = await w.reward();
    await loginAs(w.owner.id);
    const res = await patch(task.id, { assigneeIds: [w.member.id, w.member2.id] });
    expect(res.status).toBe(200);
    expect(await db.taskCoAssignee.count({ where: { taskId: task.id, userId: w.member2.id } })).toBe(1);
    // a lead hands the task to a member: only people are changed, no locked field is touched
    await loginAs(w.lead.id);
    expect((await patch(task.id, { assigneeIds: [w.member2.id] })).status).toBe(200);
  });

  it("the generic routes carry no reward through a webhook: the payloads hold the id, number and title only", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const made = await call(tasksRoute.POST, { body: createBody(w) });
    const id = (made.json?.["task"] as { id: string }).id;
    await call(moveRoute.POST, { params: { id }, body: { columnId: w.made.done.id } });
    await call(completeRoute.POST, { params: { id }, body: { complete: true } });
    expect(dispatched.map((d) => d.event)).toEqual(["task.created", "task.moved", "task.completed"]);
    const wire = JSON.stringify(dispatched);
    expect(wire).not.toMatch(/reward/i);
    expect(wire).not.toContain("1250");
    expect(wire).not.toContain("USD");
  });
});

describe("the award: once, to one of the people, after the work is done", () => {
  it("refuses before the task is finished, then awards to an assignee or a co-assignee in one go, with the audit and the bell", async () => {
    const w = await world();
    const task = await w.reward("بمكافأة", {}, { assigneeId: w.member.id });
    await db.taskCoAssignee.create({ data: { taskId: task.id, userId: w.member2.id } });
    await loginAs(w.owner.id);
    const early = await award(task.id, w.member.id);
    expect(early.status).toBe(403);
    expect(messageOf(early)).toBe("reward.not_completed");

    await db.task.update({ where: { id: task.id }, data: { completedAt: new Date(), columnId: w.made.done.id } });
    const stranger = await award(task.id, w.lead.id);
    expect(messageOf(stranger)).toBe("reward.not_assignee");

    const ok = await award(task.id, w.member2.id);
    expect(ok.status).toBe(200);
    const row = await fresh(task.id);
    expect(row).toMatchObject({ rewardStatus: "AWARDED", rewardAwardedToId: w.member2.id, rewardApprovedById: w.owner.id });
    expect(row.rewardAwardedAt).not.toBeNull();
    const logged = await db.auditLog.findMany({ where: { action: "task.reward_awarded", target: task.id } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: w.owner.id, orgId: w.org.id });
    expect(logged[0]!.meta).toMatchObject({ awardedToId: w.member2.id, amountMinor: 15000, currency: "JOD" });

    // a second award is an error, to the same person or another
    expect(messageOf(await award(task.id, w.member2.id))).toBe("reward.already_awarded");
    expect(messageOf(await award(task.id, w.member.id))).toBe("reward.already_awarded");
    // and a paid-out reward is neither edited nor called off
    expect(messageOf(await setRewardOn(task.id, { amount: "1", currency: "USD" }))).toBe("reward.awarded_locked");
    expect(messageOf(await cancel(task.id, "سبب"))).toBe("reward.already_awarded");
    expect(await db.auditLog.count({ where: { action: "task.reward_awarded", target: task.id } })).toBe(1);
  });

  it("two owners pressing at the same moment award once: one 200, one refusal, one audit row, one bell", async () => {
    const w = await world();
    const task = await w.reward("سباق", {}, { assigneeId: w.member.id, completedAt: new Date(), columnId: w.made.done.id });
    // both calls ask as themselves: log each in turn, then fire the two together
    const run = async (who: { id: string }) => {
      await loginAs(who.id);
      return award(task.id, w.member.id);
    };
    const results = await Promise.all([run(w.owner), run(w.coOwner)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.status === 403) && messageOf(results.find((r) => r.status === 403)!)).toBe("reward.already_awarded");
    expect(await db.auditLog.count({ where: { action: "task.reward_awarded", target: task.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.member.id, type: "reward_awarded" } })).toBe(1);
  });

  it("the person is told in the bell (with the amount) and on the phone (without it)", async () => {
    const w = await world();
    const task = await w.reward("تصميم الشعار", { rewardAmountMinor: 15050, rewardCurrency: "JOD" }, { assigneeId: w.member.id, completedAt: new Date(), columnId: w.made.done.id });
    await db.pushSubscription.create({ data: { userId: w.member.id, endpoint: `https://push.test.local/${task.id}`, p256dh: "k", auth: "a" } });
    await loginAs(w.owner.id);
    expect((await award(task.id, w.member.id)).status).toBe(200);
    await flushPushesForTests();

    const bell = await db.notification.findFirstOrThrow({ where: { userId: w.member.id, type: "reward_awarded" } });
    expect(bell.title).toBe("اعتُمدت مكافأتك على مهمة");
    expect(bell.body).toContain("150.50");
    expect(bell.taskId).toBe(task.id);

    // the Web Push payload that was built: the generic title and the task's name, never the amount or the currency
    expect(sent).toHaveLength(1);
    const wire = JSON.stringify(sent[0]);
    expect(sent[0]!.title).toBe("اعتُمدت مكافأتك على مهمة");
    expect(wire).toContain("تصميم الشعار");
    expect(wire).not.toContain("150");
    expect(wire).not.toContain("دينار");
  });

  it("the owner calls an open reward off with a reason (required, audited); it can then neither be awarded nor cancelled again", async () => {
    const w = await world();
    const task = await w.reward("ستُلغى", {}, { assigneeId: w.member.id, completedAt: new Date(), columnId: w.made.done.id });
    await loginAs(w.owner.id);
    const blank = await cancel(task.id, "   ");
    expect(blank.status).toBe(422);
    expect(detailKey(blank)).toBe("reward.reason_required");
    expect(detailKey(await cancel(task.id, "x".repeat(301)))).toBe("reward.reason_long");
    expect((await cancel(task.id, "  تغيّرت الخطة  ")).status).toBe(200);
    expect(await fresh(task.id)).toMatchObject({ rewardStatus: "CANCELLED", rewardCancelReason: "تغيّرت الخطة" });
    const logged = await db.auditLog.findMany({ where: { action: "task.reward_cancelled", target: task.id } });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.meta).toMatchObject({ reason: "تغيّرت الخطة" });
    expect(messageOf(await award(task.id, w.member.id))).toBe("reward.cancelled");
    expect(messageOf(await cancel(task.id, "مرة ثانية"))).toBe("reward.cancelled");
    // setting a reward again opens it afresh (the owner's call)
    expect((await setRewardOn(task.id, { amount: "5", currency: "USD" })).status).toBe(200);
    expect(await fresh(task.id)).toMatchObject({ rewardStatus: "OPEN", rewardCancelReason: null });
  });

  it("a person no longer ACTIVE in the company cannot be awarded", async () => {
    const w = await world();
    const task = await w.reward("مغادر", {}, { assigneeId: w.member.id, completedAt: new Date(), columnId: w.made.done.id });
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.member.id }, data: { status: "SUSPENDED" } });
    await loginAs(w.owner.id);
    expect(messageOf(await award(task.id, w.member.id))).toBe("reward.not_assignee");
    expect((await fresh(task.id)).rewardStatus).toBe("OPEN");
  });
});

describe("a partner never receives a reward", () => {
  it("the guest's JSON of the task list, the task, the board and the search carries no reward field; a member's does", async () => {
    const w = await world();
    const task = await w.reward("شغل الشريك", { rewardNote: "سرّي-٧٧٧" });
    await db.task.update({ where: { id: task.id }, data: { pinnedAt: new Date() } });
    const listUrl = `http://localhost/api/tasks?workspaceId=${w.ws.id}`;

    await loginAs(w.guest.id);
    const list = await call(tasksRoute.GET, { url: listUrl });
    expect(list.status).toBe(200);
    expect((list.json?.["tasks"] as { id: string }[]).map((t) => t.id)).toContain(task.id);
    const one = await call(taskRoute.GET, { params: { id: task.id } });
    expect(one.status).toBe(200);
    const board = await call(boardRoute.GET, { params: { id: w.made.board.id } });
    const found = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("شغل الشريك")}` });
    for (const [name, res] of [["list", list], ["task", one], ["board", board], ["search", found]] as const) {
      expect(res.text, name).not.toMatch(/reward/i);
      expect(res.text, name).not.toContain("15000");
      expect(res.text, name).not.toContain("سرّي");
      for (const field of REWARD_FIELDS) expect(res.text, `${name}: ${field}`).not.toContain(field);
    }
    // the views read by the pages carry none either, unless the page asks for them
    const view = await queryTasksForView({ orgId: w.org.id, workspaceId: w.ws.id });
    expect(JSON.stringify(view)).not.toMatch(/reward/i);

    await loginAs(w.member.id);
    // a search result is a preview line (key, title, project): never a reward, not even for a member
    const memberFound = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("شغل الشريك")}` });
    expect((memberFound.json?.["tasks"] as unknown[]).length).toBe(1);
    expect(memberFound.text).not.toMatch(/reward|سرّي/i);
    const mine = await call(tasksRoute.GET, { url: listUrl });
    expect((mine.json?.["tasks"] as { rewardAmountMinor: number }[])[0]!.rewardAmountMinor).toBe(15000);
    expect(((await call(taskRoute.GET, { params: { id: task.id } })).json?.["task"] as { rewardStatus: string }).rewardStatus).toBe("OPEN");
  });

  it("a person whose row in the space says GUEST is a partner there too; the owner always sees it", async () => {
    const w = await world();
    const task = await w.reward();
    const half = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Half" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: half.id, role: "GUEST" } });
    await loginAs(half.id);
    expect((await call(taskRoute.GET, { params: { id: task.id } })).text).not.toMatch(/reward/i);
    await loginAs(w.owner.id);
    expect((await call(taskRoute.GET, { params: { id: task.id } })).text).toContain("rewardAmountMinor");
  });

  it("a partner never gets a reward by writing either: reading is all a guest does", async () => {
    const w = await world();
    const task = await w.reward();
    await loginAs(w.guest.id);
    for (const res of [await patch(task.id, { title: "x" }), await del(task.id), await setRewardOn(task.id, { amount: "1", currency: "USD" }), await award(task.id, w.member.id), await pin(task.id, true)]) {
      expect([403, 404]).toContain(res.status);
    }
    expect(await call(totalsRoute.GET)).toMatchObject({ status: 200, json: { totals: [] } });
  });
});

describe("«تثبيت»: the owner and the space's admin pin, nobody else", () => {
  it("the owner and the space's ADMIN pin and unpin, each audited; a lead, a member and a guest are refused", async () => {
    const w = await world();
    const task = await w.plain("للتثبيت");
    for (const who of [w.lead, w.member, w.guest]) {
      await loginAs(who.id);
      const res = await pin(task.id, true);
      expect([403, 404], who.name).toContain(res.status);
    }
    expect((await fresh(task.id)).pinnedAt).toBeNull();

    await loginAs(w.admin.id);
    expect((await pin(task.id, true)).status).toBe(200);
    expect(await fresh(task.id)).toMatchObject({ pinnedById: w.admin.id });
    expect((await fresh(task.id)).pinnedAt).not.toBeNull();
    // pinning twice changes nothing and logs nothing more
    expect((await pin(task.id, true)).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "task.pinned", target: task.id } })).toBe(1);

    await loginAs(w.owner.id);
    expect((await pin(task.id, false)).status).toBe(200);
    expect(await fresh(task.id)).toMatchObject({ pinnedAt: null, pinnedById: null });
    expect(await db.auditLog.count({ where: { action: "task.unpinned", target: task.id } })).toBe(1);
    expect((await pin(task.id, true)).status).toBe(200);
    expect((await fresh(task.id)).pinnedById).toBe(w.owner.id);
  });

  it("a pin never changes who may open the task", async () => {
    const w = await world();
    const task = await w.plain("مثبّتة للمدير");
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outsider" });
    await loginAs(w.owner.id);
    await pin(task.id, true);
    await loginAs(outsider.id);
    expect((await call(taskRoute.GET, { params: { id: task.id } })).status).toBeGreaterThanOrEqual(400);
  });

  it("pinned tasks come first in the lists, whatever the other order says; and nothing pinned: the order is untouched", async () => {
    const w = await world();
    const early = await w.plain("مبكرة", { dueDate: new Date(Date.now() + DAY) });
    const late = await w.plain("متأخرة", { dueDate: new Date(Date.now() + 9 * DAY) });
    const none = await w.plain("بلا موعد");
    const idsOf = async () => (await queryTasksForView({ orgId: w.org.id, workspaceId: w.ws.id, pinnedFirst: true })).map((t) => t.id);
    expect(await idsOf()).toEqual([early.id, late.id, none.id]);
    await db.task.update({ where: { id: none.id }, data: { pinnedAt: new Date(Date.now() - 1000) } });
    await db.task.update({ where: { id: late.id }, data: { pinnedAt: new Date() } });
    // the newest pin first, then the other pin, then the usual order
    expect(await idsOf()).toEqual([late.id, none.id, early.id]);
    // not asked for: the view keeps its own order
    expect((await queryTasksForView({ orgId: w.org.id, workspaceId: w.ws.id })).map((t) => t.id)).toEqual([early.id, late.id, none.id]);
  });
});

describe("«مهام بمكافأة وتثبيت» switch", () => {
  it("off: the routes answer «not found», the lock is lifted, nothing is shown and nothing is lost; on again: all back", async () => {
    const w = await world();
    const task = await w.reward("بمفتاح");
    await loginAs(w.owner.id);
    expect((await flip("taskRewards", false)).status).toBe(200);

    for (const res of [await setRewardOn(task.id, { amount: "1", currency: "USD" }), await award(task.id, w.member.id), await cancel(task.id, "x"), await pin(task.id, true)]) {
      expect(res.status).toBe(404);
      expect(messageOf(res)).toBe("features.off");
    }
    const create = await call(tasksRoute.POST, { body: createBody(w) });
    expect(create.status).toBe(404);
    expect((await call(instantRoute.GET)).json?.["reward"]).toBeNull();
    expect(await openRewardTotals({ orgId: w.org.id, userId: w.owner.id })).toEqual([]);
    // the task works as a plain task again, for the member too; the reward stays in the data, unseen
    await loginAs(w.member.id);
    expect((await patch(task.id, { title: "عدّلها العضو" })).status).toBe(200);
    expect((await call(taskRoute.GET, { params: { id: task.id } })).text).not.toMatch(/reward/i);
    expect(await fresh(task.id)).toMatchObject({ title: "عدّلها العضو", rewardStatus: "OPEN", rewardAmountMinor: 15000 });

    await loginAs(w.owner.id);
    await flip("taskRewards", true);
    await loginAs(w.member.id);
    expect(messageOf(await patch(task.id, { title: "ثانية" }))).toBe("reward.owner_only");
    expect(((await call(taskRoute.GET, { params: { id: task.id } })).json?.["task"] as { rewardAmountMinor: number }).rewardAmountMinor).toBe(15000);
  });
});

describe("«مجموع المكافآت المفتوحة»: exact, per currency, the owner's", () => {
  it("adds the open rewards in SQL from integer minor units, one row per currency; called-off, awarded, archived and others' are left out", async () => {
    const w = await world();
    await w.reward("a", { rewardAmountMinor: 10, rewardCurrency: "USD" });
    await w.reward("b", { rewardAmountMinor: 20, rewardCurrency: "USD" }); // 0.10 + 0.20 is exactly 0.30
    await w.reward("c", { rewardAmountMinor: 50000, rewardCurrency: "JOD" });
    await w.reward("d", { rewardAmountMinor: 99999, rewardCurrency: "EUR", rewardStatus: "CANCELLED" });
    await w.reward("e", { rewardAmountMinor: 99999, rewardCurrency: "EUR", rewardStatus: "AWARDED" });
    const archived = await w.reward("f", { rewardAmountMinor: 99999, rewardCurrency: "EUR" });
    await db.task.update({ where: { id: archived.id }, data: { archived: true } });
    const other = await world();
    await other.reward("g", { rewardAmountMinor: 77700, rewardCurrency: "USD" });

    await loginAs(w.owner.id);
    const res = await call(totalsRoute.GET);
    expect(res.json?.["totals"]).toEqual([
      { currency: "JOD", minor: 50000, count: 1 },
      { currency: "USD", minor: 30, count: 2 },
    ]);
    // narrowed to a space; for a member: nothing, not an error
    expect((await call(totalsRoute.GET, { url: `http://localhost/api/rewards/totals?workspaceId=${w.ws.id}` })).json?.["totals"]).toHaveLength(2);
    jar().set(SPACE_COOKIE, w.ws.id);
    await loginAs(w.member.id);
    expect((await call(totalsRoute.GET)).json).toEqual({ totals: [] });
  });
});
