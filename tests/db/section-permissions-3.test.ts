import { describe, expect, it } from "vitest";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as boardsRoute from "@/app/api/boards/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * The per-person section grid, batch 3 (the owner's decision, 2026-10-26): the projects («يشوف / يضيف ويعدّل») and
 * the tasks («يشوف / يضيف ويعدّل / يحذف»), all staff's by the template. An external partner keeps working in the
 * spaces shared with them by the space's own rules: the grid is not theirs.
 */
async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: lists });
}

async function workWorld() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [
    { userId: team.admin.id, role: "ADMIN" },
    { userId: team.member.id },
    { userId: team.guest.id, role: "GUEST" },
  ]);
  const { project, board, todo, done } = await makeProject(ws.id, "Launch");
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: project.id,
    boardId: board.id,
    columnId: todo.id,
    creatorId: team.member.id,
    title: "Print the flyers",
  });
  return { ...team, ws, project, board, todo, done, task };
}

const newTask = (w: Awaited<ReturnType<typeof workWorld>>, title: string) =>
  call(tasksRoute.POST, { body: { workspaceId: w.ws.id, projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title } });

describe("the tasks row", () => {
  it("by the template a member lists, adds, moves and comments", async () => {
    const w = await workWorld();
    await loginAs(w.member.id);
    expect((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` })).status).toBe(200);
    expect((await newTask(w, "Book the hall")).status).toBe(201);
    expect((await call(moveRoute.POST, { params: { id: w.task.id }, body: { columnId: w.done.id } })).status).toBe(200);
    expect((await call(commentsRoute.POST, { params: { id: w.task.id }, body: { body: "On it" } })).status).toBe(201);
  });

  it("without «يضيف ويعدّل» no new task, no move, no comment; reading stays", async () => {
    const w = await workWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["tasks.edit"] });
    await loginAs(w.member.id);
    expect((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` })).status).toBe(200);
    const created = await newTask(w, "Not allowed");
    expect(created.status).toBe(403);
    expect(created.json?.["message"]).toBe("section.edit_denied");
    expect((await call(moveRoute.POST, { params: { id: w.task.id }, body: { columnId: w.done.id } })).status).toBe(403);
    expect((await call(commentsRoute.POST, { params: { id: w.task.id }, body: { body: "Nope" } })).status).toBe(403);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).columnId).toBe(w.todo.id);
  });

  it("without «يشوف» the list and a task are closed", async () => {
    const w = await workWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["tasks.view"] });
    await loginAs(w.member.id);
    const list = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` });
    expect(list.status).toBe(403);
    expect(list.text).not.toContain("Print the flyers");
    expect((await call(taskRoute.GET, { params: { id: w.task.id } })).status).toBe(403);
  });

  it("a space admin without «يحذف» can not delete a task", async () => {
    const w = await workWorld();
    await setBoxes(w.org.id, w.admin.id, { revokedCapabilities: ["tasks.delete"] });
    await loginAs(w.admin.id);
    const del = await call(taskRoute.DELETE, { method: "DELETE", params: { id: w.task.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("section.delete_denied");
    expect(await db.task.count({ where: { id: w.task.id } })).toBe(1);
  });
});

describe("the projects row", () => {
  it("without «يضيف ويعدّل» no new project and no new board; the tasks are untouched", async () => {
    const w = await workWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["projects.edit"] });
    await loginAs(w.member.id);
    const project = await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "Not allowed" } });
    expect(project.status).toBe(403);
    expect(project.json?.["message"]).toBe("section.edit_denied");
    expect((await call(boardsRoute.POST, { body: { projectId: w.project.id, name: "Not allowed" } })).status).toBe(403);
    expect((await newTask(w, "Still allowed")).status).toBe(201);
  });

  it("without «يشوف» the projects of the space are not listed", async () => {
    const w = await workWorld();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["projects.view"] });
    await loginAs(w.member.id);
    const list = await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.ws.id}` });
    expect(list.status).toBe(403);
    expect(list.text).not.toContain("Launch");
  });
});

describe("an external partner is not on the grid", () => {
  it("a guest of the space reads its tasks as before (the space's rules decide what they may change)", async () => {
    const w = await workWorld();
    await loginAs(w.guest.id);
    expect((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` })).status).toBe(200);
  });
});
