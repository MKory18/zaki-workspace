import { describe, expect, it } from "vitest";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as boardsRoute from "@/app/api/boards/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as workspaceRoute from "@/app/api/workspaces/[id]/route";
import * as membersRoute from "@/app/api/workspaces/[id]/members/route";
import { requireWorkspace } from "@/server/auth";
import { getMyWork } from "@/server/services/my-work";
import { resolveWorkspaceView } from "@/server/services/views";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeMember } from "./guest-helpers";

/**
 * One org, one workspace. `member` is a normal workspace member. `guest` is an org GUEST who
 * sits in the workspace as a workspace MEMBER - exactly what the members route used to store.
 */
async function workspaceWorld() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "MEMBER" }]);
  const { project, board, todo, done } = await makeProject(ws.id);
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: project.id,
    boardId: board.id,
    columnId: todo.id,
    creatorId: team.owner.id,
    assigneeId: team.guest.id,
    title: "Assigned to the guest",
  });
  return { ...team, ws, project, board, todo, done, task };
}

type World = Awaited<ReturnType<typeof workspaceWorld>>;

const wsRow = (w: World, userId: string) =>
  db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId } } });

/** Every write a workspace member can make, as one list of [label, response]. */
async function tryWrites(w: World) {
  return [
    ["create a task", await call(tasksRoute.POST, { body: { workspaceId: w.ws.id, projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title: "Planted task" } })],
    ["edit a task", await call(taskRoute.PATCH, { method: "PATCH", params: { id: w.task.id }, body: { title: "Changed by the guest" } })],
    ["move a task", await call(moveRoute.POST, { params: { id: w.task.id }, body: { columnId: w.done.id } })],
    ["complete a task", await call(completeRoute.POST, { params: { id: w.task.id }, body: { complete: true } })],
    ["create a project", await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "Planted project" } })],
    ["create a board", await call(boardsRoute.POST, { body: { projectId: w.project.id, name: "Planted board" } })],
  ] as const;
}

async function expectNothingChanged(w: World) {
  const task = await db.task.findUniqueOrThrow({ where: { id: w.task.id } });
  expect(task.title).toBe("Assigned to the guest");
  expect(task.columnId).toBe(w.todo.id);
  expect(task.completedAt).toBeNull();
  expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(1);
  expect(await db.project.count({ where: { workspaceId: w.ws.id } })).toBe(1);
  expect(await db.board.count({ where: { projectId: w.project.id } })).toBe(1);
}

describe("workspaces: an org GUEST is read-only whatever their workspace row says", () => {
  it("stored as a workspace MEMBER, they still cannot create or change tasks, projects or boards", async () => {
    const w = await workspaceWorld();
    await loginAs(w.guest.id);
    for (const [label, res] of await tryWrites(w)) {
      expect(res.status, label).toBe(403);
      expect(res.json?.["message"], label).toBe("insufficient_role");
    }
    await expectNothingChanged(w);
  });

  it("stored as a workspace ADMIN, they cannot delete a task, rename the workspace or manage its members", async () => {
    const w = await workspaceWorld();
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.guest.id } },
      data: { role: "ADMIN" },
    });
    const outsider = await makeMember(w.org.id, "Outsider");
    await loginAs(w.guest.id);

    expect((await call(taskRoute.DELETE, { method: "DELETE", params: { id: w.task.id } })).status).toBe(403);
    const rename = await call(workspaceRoute.PATCH, { method: "PATCH", params: { id: w.ws.id }, body: { name: "Hijacked workspace" } });
    expect(rename.status).toBe(403);
    const add = await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [outsider.id] } });
    expect(add.status).toBe(403);

    expect(await db.task.findUnique({ where: { id: w.task.id } })).not.toBeNull();
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).name).toBe(w.ws.name);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: outsider.id } })).toBe(0);
    for (const [label, res] of await tryWrites(w)) expect(res.status, label).toBe(403);
  });

  it("can still read everything in the workspace", async () => {
    const w = await workspaceWorld();
    await loginAs(w.guest.id);
    expect((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` })).status).toBe(200);
    expect((await call(taskRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
    expect((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.ws.id}` })).status).toBe(200);
    expect((await call(boardRoute.GET, { params: { id: w.board.id } })).status).toBe(200);
    const members = await call(membersRoute.GET, { params: { id: w.ws.id } });
    expect(members.status).toBe(200);
    expect(members.text).not.toContain("@");
  });

  it("an org GUEST with no workspace row is still refused, even to read", async () => {
    const w = await workspaceWorld();
    const stranger = await makeUser({ orgId: w.org.id, role: "GUEST", name: "Stranger guest" });
    await loginAs(stranger.id);
    const res = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("not_workspace_member");
  });
});

describe("workspaces: nobody else loses anything", () => {
  it("a MEMBER still creates and changes everything", async () => {
    const w = await workspaceWorld();
    await loginAs(w.member.id);
    const writes = await tryWrites(w);
    expect(Object.fromEntries(writes.map(([label, res]) => [label, res.status]))).toEqual({
      "create a task": 201,
      "edit a task": 200,
      "move a task": 200,
      "complete a task": 200,
      "create a project": 201,
      "create a board": 201,
    });
  });

  it("a workspace ADMIN who is an org MEMBER still deletes tasks, renames and manages members", async () => {
    const w = await workspaceWorld();
    const lead = await makeMember(w.org.id, "Workspace lead");
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: lead.id, role: "ADMIN" } });
    const newcomer = await makeMember(w.org.id, "Newcomer");
    await loginAs(lead.id);
    expect((await call(workspaceRoute.PATCH, { method: "PATCH", params: { id: w.ws.id }, body: { name: "Renamed by lead" } })).status).toBe(200);
    expect((await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [newcomer.id] } })).status).toBe(200);
    expect((await call(taskRoute.DELETE, { method: "DELETE", params: { id: w.task.id } })).status).toBe(200);
  });

  it("the org OWNER and ADMIN still do everything without a workspace row", async () => {
    for (const role of ["owner", "admin"] as const) {
      const w = await workspaceWorld();
      await loginAs(w[role].id);
      for (const [label, res] of await tryWrites(w)) expect(res.status, `${role}: ${label}`).toBeLessThan(300);
    }
  });

  it("known leniency, untouched here: a non-guest org member with no workspace row still passes the guard (Phase 1 closes it)", async () => {
    const w = await workspaceWorld();
    const roamer = await makeMember(w.org.id, "Roamer");
    await loginAs(roamer.id);
    await expect(requireWorkspace(w.ws.id, ["ADMIN", "MEMBER"])).resolves.toMatchObject({ orgRole: "MEMBER" });
    await expect(requireWorkspace(w.ws.id)).resolves.toMatchObject({ orgRole: "MEMBER" });
  });

  it("an org MEMBER who is a workspace GUEST stays read-only, and still reads", async () => {
    const w = await workspaceWorld();
    const watcher = await makeMember(w.org.id, "Watcher");
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: watcher.id, role: "GUEST" } });
    await loginAs(watcher.id);
    for (const [label, res] of await tryWrites(w)) expect(res.status, label).toBe(403);
    expect((await call(taskRoute.GET, { params: { id: w.task.id } })).status).toBe(200);
  });
});

describe("workspace members: an org GUEST is only ever added, and kept, as a workspace GUEST", () => {
  it("adds an org GUEST as a workspace GUEST and a normal member as a MEMBER", async () => {
    const w = await workspaceWorld();
    const otherGuest = await makeUser({ orgId: w.org.id, role: "GUEST", name: "Second guest" });
    const newcomer = await makeMember(w.org.id, "Newcomer");
    await loginAs(w.admin.id);
    const res = await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [otherGuest.id, newcomer.id] } });
    expect(res.status).toBe(200);
    expect((await wsRow(w, otherGuest.id)).role).toBe("GUEST");
    expect((await wsRow(w, newcomer.id)).role).toBe("MEMBER");
  });

  it("adding a guest again repairs a row that was stored as MEMBER", async () => {
    const w = await workspaceWorld();
    expect((await wsRow(w, w.guest.id)).role).toBe("MEMBER");
    await loginAs(w.admin.id);
    expect((await call(membersRoute.POST, { params: { id: w.ws.id }, body: { addUserIds: [w.guest.id] } })).status).toBe(200);
    expect((await wsRow(w, w.guest.id)).role).toBe("GUEST");
  });

  it("refuses to promote an org GUEST - and changes nothing else in that request", async () => {
    const w = await workspaceWorld();
    await loginAs(w.admin.id);
    const alone = await call(membersRoute.POST, { params: { id: w.ws.id }, body: { promoteUserIds: [w.guest.id] } });
    expect(alone.status).toBe(403);
    expect(alone.json?.["message"]).toBe("guest.readonly");
    expect((await wsRow(w, w.guest.id)).role).toBe("MEMBER");

    const mixed = await call(membersRoute.POST, { params: { id: w.ws.id }, body: { promoteUserIds: [w.member.id, w.guest.id] } });
    expect(mixed.status).toBe(403);
    expect((await wsRow(w, w.member.id)).role).toBe("MEMBER");
  });

  it("still promotes and demotes normal members", async () => {
    const w = await workspaceWorld();
    await loginAs(w.admin.id);
    expect((await call(membersRoute.POST, { params: { id: w.ws.id }, body: { promoteUserIds: [w.member.id] } })).status).toBe(200);
    expect((await wsRow(w, w.member.id)).role).toBe("ADMIN");
    expect((await call(membersRoute.POST, { params: { id: w.ws.id }, body: { demoteUserIds: [w.member.id] } })).status).toBe(200);
    expect((await wsRow(w, w.member.id)).role).toBe("MEMBER");
  });

  it("demoting a guest who was stored as a workspace ADMIN lands on GUEST, not MEMBER", async () => {
    const w = await workspaceWorld();
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.guest.id } },
      data: { role: "ADMIN" },
    });
    await loginAs(w.admin.id);
    expect((await call(membersRoute.POST, { params: { id: w.ws.id }, body: { demoteUserIds: [w.guest.id] } })).status).toBe(200);
    expect((await wsRow(w, w.guest.id)).role).toBe("GUEST");
  });

  it("the member list shows an org GUEST as a GUEST even when the row says MEMBER", async () => {
    const w = await workspaceWorld();
    await loginAs(w.member.id);
    const res = await call(membersRoute.GET, { params: { id: w.ws.id } });
    const members = res.json?.["members"] as { name: string; role: string }[];
    expect(members.find((m) => m.name === "Guest")?.role).toBe("GUEST");
    expect(members.find((m) => m.name === "Member")?.role).toBe("MEMBER");
  });
});

describe("List, Calendar and My Work agree with the server on who can write", () => {
  // [org role, workspace row (null = none)] -> can write? (what requireWorkspace(["ADMIN","MEMBER"]) says)
  // Left out: an org MEMBER / GUEST with no row. They cannot open the workspace in the pages, and the
  // API's leniency for a MEMBER without a row is the known gap that comes with the account-status work.
  const cases: [string, string | null, boolean][] = [
    ["OWNER", null, true],
    ["OWNER", "GUEST", true],
    ["ADMIN", null, true],
    ["ADMIN", "MEMBER", true],
    ["ADMIN", "GUEST", true],
    ["MEMBER", "ADMIN", true],
    ["MEMBER", "MEMBER", true],
    ["MEMBER", "GUEST", false],
    ["GUEST", "ADMIN", false],
    ["GUEST", "MEMBER", false],
    ["GUEST", "GUEST", false],
  ];

  it.each(cases)("%s with workspace row %s -> can write: %s (the same answer everywhere)", async (orgRole, row, expected) => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, []);
    const { project, board, todo } = await makeProject(ws.id);
    const user = await makeUser({ orgId: team.org.id, role: orgRole as "OWNER" | "ADMIN" | "MEMBER" | "GUEST" });
    if (row) await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: row as "ADMIN" | "MEMBER" | "GUEST" } });
    await makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: team.owner.id,
      assigneeId: user.id,
    });
    await loginAs(user.id);

    // the server
    const serverAllows = await requireWorkspace(ws.id, ["ADMIN", "MEMBER"]).then(
      () => true,
      () => false,
    );
    expect(serverAllows).toBe(expected);
    // the shared rule the pages use
    const { canWriteInWorkspace } = await import("@/server/workspace-role");
    expect(canWriteInWorkspace(orgRole, row)).toBe(expected);
    // List and Calendar
    const view = await resolveWorkspaceView(ws.id);
    if (!("ctx" in view)) throw new Error(`expected a ctx, got ${JSON.stringify(view)}`);
    expect(view.ctx.editable).toBe(expected);
    if (orgRole === "GUEST") expect(view.ctx.role).toBe("GUEST");
    // My Work
    const rows = (await getMyWork(user.id)).mine;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.editable).toBe(expected);
  });
});
