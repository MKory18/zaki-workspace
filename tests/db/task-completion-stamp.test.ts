import { describe, expect, it } from "vitest";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as createRoute from "@/app/api/tasks/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * "In the done column" and "has a completion stamp" are ONE fact (Phase B of the owner's review).
 *
 * `completedAt` is what every counter reads: «أُنجز اليوم» on Today, `completed` and `completed30` in
 * analytics, the open count on a board. So the stamp is written on the transition only:
 *  - open → done: stamped once, now
 *  - a reorder INSIDE the done column: untouched (the task was finished then, not now)
 *  - done → open: cleared
 *  - a task born in a done column: stamped, or it would never count as done anywhere
 *
 * Before the fix `moveTask` wrote `column.done ? new Date() : null` on every move: dragging a finished
 * card aside moved its completion to today, and a board's «done» column and the Today page disagreed.
 */

async function boardWorld() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  return { ...team, ws, made };
}

/** A task finished two days ago, sitting in the done column. */
const finished = (w: Awaited<ReturnType<typeof boardWorld>>, at: Date) =>
  makeTask({
    orgId: w.org.id,
    workspaceId: w.ws.id,
    projectId: w.made.project.id,
    boardId: w.made.board.id,
    columnId: w.made.done.id,
    creatorId: w.owner.id,
    completedAt: at,
  });

describe("the completion stamp follows the done column, once", () => {
  it("a reorder inside the done column keeps the day the task was actually finished", async () => {
    const w = await boardWorld();
    const finishedAt = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const task = await finished(w, finishedAt);
    // what a drag inside «تم» is: the same column, another position
    await loginAs(w.member.id);
    const res = await call(moveRoute.POST, { params: { id: task.id }, body: { columnId: w.made.done.id, index: 0 } });
    expect(res.status).toBe(200);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { completedAt: true, columnId: true } });
    expect(after.columnId).toBe(w.made.done.id);
    expect(after.completedAt?.toISOString()).toBe(finishedAt.toISOString());
  });

  it("moving an open task into the done column stamps it now", async () => {
    const w = await boardWorld();
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
    });
    await loginAs(w.member.id);
    const before = Date.now();
    const res = await call(moveRoute.POST, { params: { id: task.id }, body: { columnId: w.made.done.id } });
    expect(res.status).toBe(200);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { completedAt: true } });
    expect(after.completedAt).not.toBeNull();
    expect(after.completedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("moving a finished task back out of the done column clears the stamp", async () => {
    const w = await boardWorld();
    const task = await finished(w, new Date(Date.now() - 24 * 3600 * 1000));
    await loginAs(w.member.id);
    const res = await call(moveRoute.POST, { params: { id: task.id }, body: { columnId: w.made.todo.id } });
    expect(res.status).toBe(200);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { completedAt: true } });
    expect(after.completedAt).toBeNull();
  });

  it("a task created straight into a done column is stamped, or no counter would ever see it", async () => {
    const w = await boardWorld();
    const lead = await makeUser({ orgId: w.org.id, role: "LEAD", name: "Lead" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: lead.id, role: "ADMIN" } });
    await loginAs(lead.id);
    const res = await call(createRoute.POST, {
      body: {
        workspaceId: w.ws.id,
        projectId: w.made.project.id,
        boardId: w.made.board.id,
        columnId: w.made.done.id,
        title: "مهمة وُلدت منجزة",
      },
    });
    expect(res.status).toBe(201);
    const created = (res.json as { task: { id: string; columnId: string; completedAt: string | null } }).task;
    expect(created.columnId).toBe(w.made.done.id);
    expect(created.completedAt).not.toBeNull();
  });
});
