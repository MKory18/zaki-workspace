import { describe, expect, it } from "vitest";
import { getDepartment, listDepartments } from "@/server/services/departments";
import { resolveWorkspaceView } from "@/server/services/views";
import { db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { makeDepartment } from "./guest-helpers";
import { ctxOf } from "./active-helpers";

/**
 * No admin inheritance in the services: a space is visible only to the people IN it and to the
 * OWNER, and everything a service shows about spaces goes through that one rule.
 */

describe("departments: projects and their numbers come only from spaces the viewer can open", () => {
  async function deptWorld() {
    const team = await makeTeam();
    const shared = await makeWorkspace(
      team.org.id,
      [{ userId: team.member.id }, { userId: team.admin.id, role: "ADMIN" }],
      "Shared space",
    );
    const closed = await makeWorkspace(team.org.id, [], "Closed space"); // nobody but the owner is in it
    const dept = await makeDepartment(team.org.id, { memberIds: [team.member.id] });
    const open = await makeProject(shared.id, "Open project");
    const secret = await makeProject(closed.id, "Secret project");
    for (const p of [open.project, secret.project]) {
      await db.project.update({ where: { id: p.id }, data: { departmentId: dept.id } });
    }
    const task = (ws: { id: string }, made: typeof open) =>
      makeTask({
        orgId: team.org.id,
        workspaceId: ws.id,
        projectId: made.project.id,
        boardId: made.board.id,
        columnId: made.todo.id,
        creatorId: team.owner.id,
      });
    await task(shared, open);
    await task(closed, secret);
    await task(closed, secret);
    return { ...team, dept };
  }

  it("a MEMBER sees the project of their own space only, and only its tasks are counted", async () => {
    const w = await deptWorld();
    const listed = (await listDepartments(ctxOf(w.org.id, w.member.id))).find((d) => d.id === w.dept.id);
    expect(listed?.projectsCount).toBe(1);
    expect(listed?.openTasks).toBe(1);

    const one = await getDepartment(ctxOf(w.org.id, w.member.id), w.dept.id);
    expect(one.projects.map((p) => p.name)).toEqual(["Open project"]);
    expect(one.projects.map((p) => p.workspace)).toEqual(["Shared space"]);
    expect(JSON.stringify(one)).not.toContain("Secret project");
    expect(JSON.stringify(one)).not.toContain("Closed space");
  });

  it("an ADMIN gets no space by rank: the same view as the member who is in the same space", async () => {
    const w = await deptWorld();
    const asAdmin = await getDepartment(ctxOf(w.org.id, w.admin.id, "ADMIN"), w.dept.id);
    expect(asAdmin.projects.map((p) => p.name)).toEqual(["Open project"]);
    const listed = (await listDepartments(ctxOf(w.org.id, w.admin.id, "ADMIN"))).find((d) => d.id === w.dept.id);
    expect(listed?.projectsCount).toBe(1);
    expect(listed?.openTasks).toBe(1);
  });

  it("the OWNER sees every space's projects and all the tasks", async () => {
    const w = await deptWorld();
    const asOwner = await getDepartment(ctxOf(w.org.id, w.owner.id, "OWNER"), w.dept.id);
    expect(asOwner.projects.map((p) => p.name).sort()).toEqual(["Open project", "Secret project"]);
    const listed = (await listDepartments(ctxOf(w.org.id, w.owner.id, "OWNER"))).find((d) => d.id === w.dept.id);
    expect(listed?.projectsCount).toBe(2);
    expect(listed?.openTasks).toBe(3);
  });
});

describe("the List and Calendar pages' workspace selector: the OWNER gets every space, an ADMIN only theirs", () => {
  it("an ADMIN who was put in one space is offered that one; one who was put in none gets nothing", async () => {
    const team = await makeTeam();
    const mine = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }], "Admin's space");
    const other = await makeWorkspace(team.org.id, [], "Not the admin's");

    await loginAs(team.admin.id);
    const res = await resolveWorkspaceView(other.id);
    if (!("ctx" in res)) throw new Error(`expected a ctx, got ${JSON.stringify(res)}`);
    expect(res.ctx.workspaces.map((w) => w.id)).toEqual([mine.id]);
    expect(res.ctx.workspaceId).toBe(mine.id);

    await loginAs(team.owner.id);
    const asOwner = await resolveWorkspaceView(other.id);
    if (!("ctx" in asOwner)) throw new Error(`expected a ctx, got ${JSON.stringify(asOwner)}`);
    expect(asOwner.ctx.workspaces.map((w) => w.id).sort()).toEqual([mine.id, other.id].sort());
    expect(asOwner.ctx.workspaceId).toBe(other.id);
    expect(asOwner.ctx.editable).toBe(true);

    const lonely = await makeTeam();
    await makeWorkspace(lonely.org.id, [], "Nobody's space");
    await loginAs(lonely.admin.id);
    expect(await resolveWorkspaceView()).toEqual({ none: true });
  });
});
