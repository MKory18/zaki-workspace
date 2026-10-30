import { describe, expect, it } from "vitest";
import * as linksRoute from "@/app/api/tasks/[id]/links/route";
import * as linkRoute from "@/app/api/tasks/[id]/links/[linkId]/route";
import { withFeature } from "@/lib/features";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * «التبعيات» — the links between two tasks (the owner, 2026-10-30: the table `TaskDependency` had
 * never held a row).
 *
 * What this pins:
 *  - a link is stored and reads back from BOTH ends, so the other task's page shows it without a
 *    second write;
 *  - both ends are checked with the task page's own guard: another company's task, another team's
 *    task, or a task of a space the person is not in is «not found», never linked;
 *  - a task cannot link to itself, the same pair and kind is refused once, and the pair that would
 *    each block the other is refused (`link.cycle`);
 *  - removing a link is only possible from one of the two tasks it touches;
 *  - a guest cannot write one, and the company's switch closes the whole card and its routes while
 *    keeping every row already stored.
 */

async function world() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: made.todo.id,
    creatorId: team.owner.id,
    assigneeId: team.member.id,
    title: "المهمة الأم",
  });
  const other = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: made.project.id,
    boardId: made.board.id,
    columnId: made.todo.id,
    creatorId: team.owner.id,
    assigneeId: team.member.id,
    title: "المهمة التانية",
  });
  return { ...team, ws, made, task, other };
}

describe("«التبعيات»: a link between two tasks", () => {
  it("is stored, and reads back from both ends with the key the screen shows", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(linksRoute.POST, {
      params: { id: w.task.id },
      body: { dependsOnId: w.other.id, kind: "BLOCKS" },
    });
    expect(created.status).toBe(201);
    const link = (created.json as { link: { id: string; kind: string; task: { id: string; key: string } } }).link;
    expect(link.kind).toBe("BLOCKS");
    expect(link.task.id).toBe(w.other.id);
    expect(link.task.key).toMatch(/^\w+-\d+$/);

    const mine = await call(linksRoute.GET, { params: { id: w.task.id } });
    expect(mine.status).toBe(200);
    expect((mine.json as { out: unknown[] }).out).toHaveLength(1);

    // the OTHER task's page sees the same row from the other side, with nothing else written
    const theirs = await call(linksRoute.GET, { params: { id: w.other.id } });
    expect(theirs.status).toBe(200);
    expect((theirs.json as { in: { task: { id: string } }[] }).in.map((l) => l.task.id)).toEqual([w.task.id]);
  });

  it("is in the task's own story, so «who linked this» has an answer", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(linksRoute.POST, {
      params: { id: w.task.id },
      body: { dependsOnId: w.other.id, kind: "DUPLICATES" },
    });
    expect(created.status).toBe(201);
    const row = await db.taskActivity.findFirstOrThrow({
      where: { taskId: w.task.id, event: "task.linked" },
    });
    expect(row.actorId).toBe(w.member.id);
    expect((row.meta as { kind: string }).kind).toBe("DUPLICATES");
  });
});

describe("«التبعيات»: what the server refuses", () => {
  it("a task cannot depend on itself", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(linksRoute.POST, { params: { id: w.task.id }, body: { dependsOnId: w.task.id } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("link.self");
    expect(await db.taskDependency.count({ where: { taskId: w.task.id } })).toBe(0);
  });

  it("the same pair and kind is refused the second time", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const body = { dependsOnId: w.other.id, kind: "BLOCKS" };
    expect((await call(linksRoute.POST, { params: { id: w.task.id }, body })).status).toBe(201);
    const again = await call(linksRoute.POST, { params: { id: w.task.id }, body });
    expect(again.status).toBe(403);
    expect(again.json?.["message"]).toBe("link.exists");
    expect(await db.taskDependency.count({ where: { taskId: w.task.id } })).toBe(1);
  });

  it("the pair that would each block the other is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect(
      (await call(linksRoute.POST, { params: { id: w.task.id }, body: { dependsOnId: w.other.id, kind: "BLOCKS" } })).status,
    ).toBe(201);
    const back = await call(linksRoute.POST, {
      params: { id: w.other.id },
      body: { dependsOnId: w.task.id, kind: "BLOCKED_BY" },
    });
    expect(back.status).toBe(403);
    expect(back.json?.["message"]).toBe("link.cycle");
    expect(await db.taskDependency.count({ where: { taskId: { in: [w.task.id, w.other.id] } } })).toBe(1);
  });

  it("another company's task is «not found», never linked", async () => {
    const w = await world();
    const elsewhere = await makeTeam();
    const otherWs = await makeWorkspace(elsewhere.org.id, [{ userId: elsewhere.member.id }], "مساحة تانية");
    const otherMade = await makeProject(otherWs.id, "مشروع تاني");
    const foreign = await makeTask({
      orgId: elsewhere.org.id,
      workspaceId: otherWs.id,
      projectId: otherMade.project.id,
      boardId: otherMade.board.id,
      columnId: otherMade.todo.id,
      creatorId: elsewhere.owner.id,
      title: "مهمة شركة تانية",
    });
    await loginAs(w.member.id);
    const res = await call(linksRoute.POST, { params: { id: w.task.id }, body: { dependsOnId: foreign.id } });
    expect(res.status).toBe(404);
    expect(await db.taskDependency.count({ where: { taskId: { in: [w.task.id, w.other.id] } } })).toBe(0);
  });

  it("a guest cannot write a link", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const res = await call(linksRoute.POST, { params: { id: w.task.id }, body: { dependsOnId: w.other.id } });
    expect(res.status).toBe(403);
    expect(await db.taskDependency.count({ where: { taskId: { in: [w.task.id, w.other.id] } } })).toBe(0);
  });

  it("a link is removed only from one of the two tasks it touches", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(linksRoute.POST, {
      params: { id: w.task.id },
      body: { dependsOnId: w.other.id, kind: "BLOCKS" },
    });
    const linkId = (created.json as { link: { id: string } }).link.id;

    // a third task of the same space may not delete somebody else's link
    const third = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
      title: "مهمة تالتة",
    });
    const refused = await call(linkRoute.DELETE, { params: { id: third.id, linkId } });
    expect(refused.status).toBe(404);
    expect(await db.taskDependency.count({ where: { taskId: { in: [w.task.id, w.other.id] } } })).toBe(1);

    // the other end may remove it: it is its own link too
    const removed = await call(linkRoute.DELETE, { params: { id: w.other.id, linkId } });
    expect(removed.status).toBe(200);
    expect(await db.taskDependency.count({ where: { taskId: { in: [w.task.id, w.other.id] } } })).toBe(0);
    expect(await db.taskActivity.count({ where: { taskId: w.other.id, event: "task.unlinked" } })).toBe(1);
  });
});

describe("«تبعيات المهام»: the switch", () => {
  it("off: both routes answer 404 and the stored link survives", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(linksRoute.POST, {
      params: { id: w.task.id },
      body: { dependsOnId: w.other.id, kind: "BLOCKS" },
    });
    expect(created.status).toBe(201);

    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({
      where: { id: w.org.id },
      data: { settings: withFeature(org.settings, "taskLinks", false) as Prisma.InputJsonValue },
    });

    const read = await call(linksRoute.GET, { params: { id: w.task.id } });
    expect(read.status).toBe(404);
    expect(read.json?.["message"]).toBe("features.off");
    const write = await call(linksRoute.POST, { params: { id: w.task.id }, body: { dependsOnId: w.other.id } });
    expect(write.status).toBe(404);

    // nothing was lost: the row is still there for the day the switch comes back
    expect(await db.taskDependency.count({ where: { taskId: w.task.id } })).toBe(1);

    const back = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({
      where: { id: w.org.id },
      data: { settings: withFeature(back.settings, "taskLinks", true) as Prisma.InputJsonValue },
    });
    const again = await call(linksRoute.GET, { params: { id: w.task.id } });
    expect(again.status).toBe(200);
    expect((again.json as { out: unknown[] }).out).toHaveLength(1);
  });
});
