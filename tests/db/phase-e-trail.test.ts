import { describe, expect, it } from "vitest";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as commentRoute from "@/app/api/tasks/[id]/comments/[commentId]/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * Phase E: a change that leaves no trace is a change nobody can ask about later.
 *
 * The code map (§7 and §9) named the two route handlers that wrote to the database themselves with
 * no trail: `/api/boards/[id]` (a board renamed, archived or its columns reordered) and
 * `/api/tasks/[id]/comments/[commentId]` (a comment edited or deleted). Every other write of the
 * same kind already leaves an `AuditLog` row or a `TaskActivity` row; these two did not.
 */

async function world() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  return { ...team, ws, made };
}

describe("a board change is written down", () => {
  it("renaming a board leaves an audit row naming the old and the new", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const before = await db.auditLog.count({ where: { action: "board.updated", target: w.made.board.id } });
    const res = await call(boardRoute.PATCH, { params: { id: w.made.board.id }, body: { name: "لوحة جديدة" } });
    expect(res.status).toBe(200);
    const after = await db.auditLog.findFirstOrThrow({
      where: { action: "board.updated", target: w.made.board.id },
      orderBy: { createdAt: "desc" },
    });
    expect(await db.auditLog.count({ where: { action: "board.updated", target: w.made.board.id } })).toBe(before + 1);
    expect(after.orgId).toBe(w.org.id);
    expect(after.actorId).toBe(w.member.id);
  });

  it("a column reorder leaves an audit row with the order that was saved", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const order = [w.made.done.id, w.made.todo.id];
    const res = await call(boardRoute.POST, { params: { id: w.made.board.id }, body: { order } });
    expect(res.status).toBe(200);
    const row = await db.auditLog.findFirstOrThrow({
      where: { action: "board.columns_reordered", target: w.made.board.id },
    });
    expect(row.actorId).toBe(w.member.id);
    expect((row.meta as { order: string[] }).order).toEqual(order);
  });
});

describe("editing or deleting a comment is in the task's story", () => {
  it("an edited comment writes task.comment_edited, a deleted one task.comment_deleted", async () => {
    const w = await world();
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
      assigneeId: w.member.id,
    });
    await loginAs(w.member.id);
    const posted = await call(commentsRoute.POST, { params: { id: task.id }, body: { body: "أول صياغة" } });
    expect(posted.status).toBe(201);
    const commentId = (posted.json as { comment: { id: string } }).comment.id;

    const edited = await call(commentRoute.PATCH, { params: { id: task.id, commentId }, body: { body: "صياغة تانية" } });
    expect(edited.status).toBe(200);
    expect(await db.taskActivity.count({ where: { taskId: task.id, event: "task.comment_edited" } })).toBe(1);

    const removed = await call(commentRoute.DELETE, { params: { id: task.id, commentId } });
    expect(removed.status).toBe(200);
    expect(await db.taskActivity.count({ where: { taskId: task.id, event: "task.comment_deleted" } })).toBe(1);
    // the comment itself is gone, and its author is on both rows
    expect(await db.taskComment.count({ where: { id: commentId } })).toBe(0);
    const rows = await db.taskActivity.findMany({
      where: { taskId: task.id, event: { in: ["task.comment_edited", "task.comment_deleted"] } },
      select: { actorId: true },
    });
    expect(rows.every((r) => r.actorId === w.member.id)).toBe(true);
  });

  it("somebody else's comment is still refused, and writes nothing", async () => {
    const w = await world();
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
      assigneeId: w.member.id,
    });
    await loginAs(w.owner.id);
    const posted = await call(commentsRoute.POST, { params: { id: task.id }, body: { body: "من المالك" } });
    const commentId = (posted.json as { comment: { id: string } }).comment.id;
    await loginAs(w.member.id);
    const refused = await call(commentRoute.PATCH, { params: { id: task.id, commentId }, body: { body: "تعديل غيري" } });
    expect(refused.status).toBe(403);
    expect(await db.taskActivity.count({ where: { taskId: task.id, event: "task.comment_edited" } })).toBe(0);
  });
});
