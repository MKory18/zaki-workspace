import { describe, expect, it } from "vitest";
import * as stepsRoute from "@/app/api/tasks/[id]/steps/route";
import * as stepRoute from "@/app/api/tasks/[id]/steps/[stepId]/route";
import { withFeature } from "@/lib/features";
import { stepProgressFor } from "@/server/services/task-steps";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «الخطوات» — the short checklist inside a task (the owner's backlog, 2026-10-30).
 *
 * What this pins:
 *  - add, rename, tick and untick (WHO ticked and WHEN are stored), reorder by a fractional position (a move writes one
 *    row; the list is renumbered only when two neighbours get too close), delete, and the progress «3 من 5»;
 *  - who may write: whoever may edit the task. A guest of the space reads and never writes; somebody outside the
 *    space gets nothing; the OWNER reading a space he is not in reads and ticks nothing (silent oversight), while the
 *    owner who has joined the space ticks like anybody;
 *  - a step belongs to its task (another task's step is «not found»), a title is 1 to 200 characters, a task carries at
 *    most 100 steps;
 *  - a step dies with its task, and the company's `taskSteps` switch closes every door while keeping every row.
 */

async function world() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  const mk = (title: string) =>
    makeTask({ orgId: team.org.id, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title });
  const task = await mk("المهمة");
  const other = await mk("مهمة تانية");
  return { ...team, ws, made, task, other };
}

type Step = { id: string; title: string; done: boolean; doneAt: string | null };
const add = async (taskId: string, title: string) => {
  const res = await call(stepsRoute.POST, { params: { id: taskId }, body: { title } });
  return { res, step: (res.json as { step: Step } | null)?.step };
};
const list = async (taskId: string) => (await call(stepsRoute.GET, { params: { id: taskId } })).json as { steps: Step[]; progress: { done: number; total: number } };
const titles = async (taskId: string) => (await list(taskId)).steps.map((s) => s.title);

describe("«الخطوات»: the checklist of a task", () => {
  it("adds in order, renames, ticks and unticks, and tells the progress", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = (await add(w.task.id, "  الأولى  ")).step!;
    const b = (await add(w.task.id, "الثانية")).step!;
    await add(w.task.id, "الثالثة");
    expect(a.title).toBe("الأولى"); // trimmed
    expect(await titles(w.task.id)).toEqual(["الأولى", "الثانية", "الثالثة"]);

    const renamed = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: b.id }, body: { title: "الثانية معدّلة" } });
    expect(renamed.status).toBe(200);

    const ticked = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: a.id }, body: { done: true } });
    expect(ticked.status).toBe(200);
    const row = await db.taskStep.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.done).toBe(true);
    expect(row.doneById).toBe(w.member.id);
    expect(row.doneAt).toBeInstanceOf(Date);
    expect(row.orgId).toBe(w.org.id);

    expect((await list(w.task.id)).progress).toEqual({ done: 1, total: 3 });
    // ticking again keeps who ticked first and when
    const firstAt = row.doneAt!.getTime();
    await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: a.id }, body: { done: true } });
    expect((await db.taskStep.findUniqueOrThrow({ where: { id: a.id } })).doneAt!.getTime()).toBe(firstAt);

    await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: a.id }, body: { done: false } });
    const unticked = await db.taskStep.findUniqueOrThrow({ where: { id: a.id } });
    expect(unticked.done).toBe(false);
    expect(unticked.doneById).toBeNull();
    expect(unticked.doneAt).toBeNull();
    expect((await list(w.task.id)).progress).toEqual({ done: 0, total: 3 });
  });

  it("reorders by position: after a step, or first, writing one row", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const s1 = (await add(w.task.id, "1")).step!;
    const s2 = (await add(w.task.id, "2")).step!;
    const s3 = (await add(w.task.id, "3")).step!;
    const before = new Map((await db.taskStep.findMany({ where: { taskId: w.task.id } })).map((r) => [r.id, r.position.toString()]));

    // 3 goes first
    expect((await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: s3.id }, body: { afterId: null } })).status).toBe(200);
    expect(await titles(w.task.id)).toEqual(["3", "1", "2"]);
    // 1 goes after 2
    await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: s1.id }, body: { afterId: s2.id } });
    expect(await titles(w.task.id)).toEqual(["3", "2", "1"]);
    // only the moved rows changed their position (the third step was never touched by the second move)
    const now = new Map((await db.taskStep.findMany({ where: { taskId: w.task.id } })).map((r) => [r.id, r.position.toString()]));
    expect(now.get(s2.id)).toBe(before.get(s2.id));
    // a step cannot be placed after itself or after a step of another task
    const self = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: s1.id }, body: { afterId: s1.id } });
    expect(self.status).toBe(404);
    const foreign = (await add(w.other.id, "غريبة")).step!;
    const wrong = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: s1.id }, body: { afterId: foreign.id } });
    expect(wrong.status).toBe(404);
    expect(await titles(w.task.id)).toEqual(["3", "2", "1"]);
  });

  it("keeps the order right through many moves to the top (the list is renumbered when neighbours get too close)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const made: Step[] = [];
    for (const t of ["a", "b", "c"]) made.push((await add(w.task.id, t)).step!);
    let expected = ["a", "b", "c"];
    // moving the last one to the top again and again halves the first position each time: 45 moves cross the limit
    for (let i = 0; i < 45; i++) {
      const last = expected[expected.length - 1]!;
      const id = made.find((s) => s.title === last)!.id;
      const res = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: id }, body: { afterId: null } });
      expect(res.status).toBe(200);
      expected = [last, ...expected.slice(0, -1)];
      if (i % 9 === 0 || i === 44) expect(await titles(w.task.id), `after ${i + 1} moves`).toEqual(expected);
    }
    const positions = (await db.taskStep.findMany({ where: { taskId: w.task.id } })).map((r) => Number(r.position.toString()));
    expect(new Set(positions).size).toBe(3);
    expect(Math.min(...positions)).toBeGreaterThan(0);
  });

  it("deletes one step, and a step dies with its task", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = (await add(w.task.id, "تنحذف")).step!;
    await add(w.task.id, "تبقى");
    const del = await call(stepRoute.DELETE, { params: { id: w.task.id, stepId: a.id } });
    expect(del.status).toBe(200);
    expect(await titles(w.task.id)).toEqual(["تبقى"]);
    await db.task.delete({ where: { id: w.task.id } });
    expect(await db.taskStep.count({ where: { taskId: w.task.id } })).toBe(0);
  });

  it("counts the progress of a page of tasks in one read (a task without steps is absent)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = (await add(w.task.id, "1")).step!;
    await add(w.task.id, "2");
    await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: a.id }, body: { done: true } });
    const map = await stepProgressFor([w.task.id, w.other.id]);
    expect(map.get(w.task.id)).toEqual({ done: 1, total: 2 });
    expect(map.has(w.other.id)).toBe(false);
    expect((await stepProgressFor([])).size).toBe(0);
  });
});

describe("«الخطوات»: what the server refuses", () => {
  it("a step belongs to its task: another task's step is «not found»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = (await add(w.task.id, "x")).step!;
    const res = await call(stepRoute.PATCH, { params: { id: w.other.id, stepId: mine.id }, body: { done: true } });
    expect(res.status).toBe(404);
    const gone = await call(stepRoute.DELETE, { params: { id: w.other.id, stepId: mine.id } });
    expect(gone.status).toBe(404);
    expect(await db.taskStep.count({ where: { id: mine.id } })).toBe(1);
  });

  it("a title is 1 to 200 characters; a task carries at most 100 steps", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await add(w.task.id, "   ")).res.status).toBe(422);
    expect((await add(w.task.id, "ي".repeat(201))).res.status).toBe(422);
    expect((await add(w.task.id, "ي".repeat(200))).res.status).toBe(201);
    await db.taskStep.createMany({ data: Array.from({ length: 99 }, (_, i) => ({ orgId: w.org.id, taskId: w.task.id, title: `s${i}`, position: 2000 + i })) });
    const over = await add(w.task.id, "المئة وواحدة");
    expect(over.res.status).toBe(403);
    expect(over.res.json?.["message"]).toBe("step.too_many");
  });

  it("a guest of the space reads the steps and never writes one", async () => {
    const w = await world();
    const mine = await db.taskStep.create({ data: { orgId: w.org.id, taskId: w.task.id, title: "خطوة", position: 1000 } });
    await loginAs(w.guest.id);
    expect((await call(stepsRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
    expect((await add(w.task.id, "ممنوع")).res.status).toBe(403);
    expect((await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: mine.id }, body: { done: true } })).status).toBe(403);
    expect((await call(stepRoute.DELETE, { params: { id: w.task.id, stepId: mine.id } })).status).toBe(403);
    expect(await db.taskStep.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ done: false, title: "خطوة" });
  });

  it("somebody outside the space, and somebody of another company, get nothing", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "من برّا" });
    await loginAs(outsider.id);
    expect((await call(stepsRoute.GET, { params: { id: w.task.id } })).status).toBe(403);
    expect((await add(w.task.id, "x")).res.status).toBe(403);
    const elsewhere = await makeTeam();
    await loginAs(elsewhere.owner.id);
    expect((await call(stepsRoute.GET, { params: { id: w.task.id } })).status).toBe(403);
    expect((await add(w.task.id, "x")).res.status).toBe(403);
    expect(await db.taskStep.count({ where: { taskId: w.task.id } })).toBe(0);
  });

  it("the owner reading a space he is not in reads, and ticks nothing; once he has joined, he ticks like anybody", async () => {
    const w = await world();
    const step = await db.taskStep.create({ data: { orgId: w.org.id, taskId: w.task.id, title: "خطوة", position: 1000 } });
    await loginAs(w.owner.id);
    expect((await call(stepsRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
    const tick = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: step.id }, body: { done: true } });
    expect(tick.status).toBe(403);
    expect(tick.json?.["message"]).toBe("step.oversight_readonly");
    expect((await add(w.task.id, "جديدة")).res.status).toBe(403);
    expect(await db.taskStep.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ done: false, doneById: null });

    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "ADMIN" } });
    const joined = await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: step.id }, body: { done: true } });
    expect(joined.status).toBe(200);
    expect((await db.taskStep.findUniqueOrThrow({ where: { id: step.id } })).doneById).toBe(w.owner.id);
  });
});

describe("«خطوات المهمة»: the switch", () => {
  it("off: every door answers 404 and the rows stay; on again, everything is back", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = (await add(w.task.id, "تبقى")).step!;
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "taskSteps", false) as Prisma.InputJsonValue } });

    for (const res of [
      await call(stepsRoute.GET, { params: { id: w.task.id } }),
      await call(stepsRoute.POST, { params: { id: w.task.id }, body: { title: "x" } }),
      await call(stepRoute.PATCH, { params: { id: w.task.id, stepId: a.id }, body: { done: true } }),
      await call(stepRoute.DELETE, { params: { id: w.task.id, stepId: a.id } }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    expect(await db.taskStep.count({ where: { taskId: w.task.id } })).toBe(1);

    await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "taskSteps", true) as Prisma.InputJsonValue } });
    expect(await titles(w.task.id)).toEqual(["تبقى"]);
  });
});
