import { describe, expect, it } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectBoardsRoute from "@/app/api/projects/[id]/boards/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as taskCompleteRoute from "@/app/api/tasks/[id]/complete/route";
import * as taskCommentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import { loadAnalytics } from "@/server/services/analytics";
import { getMyWork } from "@/server/services/my-work";
import { queryTasksForView } from "@/server/services/views";
import { canSeeProject, loadWorkScope, projectVisibleWhere, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { call, db, loginAs } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * TEAMS INSIDE A SPACE (the owner's decision, 2026-10-25): inside a space with teams a member sees the space's own
 * work and their teams', a manager of the space and the OWNER see all of it, and a space with no team reads exactly
 * as before. Somebody outside a team gets "not found" for its work, everywhere.
 */

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

describe("the scope: who sees which project", () => {
  it("a member sees the space's own projects and their team's — not the other team's", async () => {
    const w = await makeTeamsWorld();
    const scope = await loadWorkScope(w.alice.id);
    const seen = await db.project.findMany({ where: { AND: [projectVisibleWhere(scope)], workspaceId: w.s.id }, select: { id: true } });
    expect(ids(seen)).toEqual([w.p0.project.id, w.px.project.id].sort());
    // (the project rows as stored: makeProject returned them before they were put in their teams)
    expect(canSeeProject(scope, { workspaceId: w.s.id, teamId: w.y.id })).toBe(false);
    expect(canSeeProject(scope, { workspaceId: w.s.id, teamId: w.x.id })).toBe(true);
    expect(canSeeProject(scope, { workspaceId: w.s.id, teamId: null })).toBe(true);
  });

  it("somebody in no team sees only the space's own projects", async () => {
    const w = await makeTeamsWorld();
    const scope = await loadWorkScope(w.carol.id);
    const seen = await db.project.findMany({ where: { AND: [projectVisibleWhere(scope)], workspaceId: w.s.id }, select: { id: true } });
    expect(ids(seen)).toEqual([w.p0.project.id]);
  });

  it("the space's ADMIN, an org ADMIN who is in the space, and the OWNER see every team", async () => {
    const w = await makeTeamsWorld();
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: w.admin.id, role: "MEMBER" } });
    for (const who of [w.spaceAdmin, w.admin, w.owner]) {
      const scope = await loadWorkScope(who.id);
      const seen = await db.project.findMany({ where: { AND: [projectVisibleWhere(scope)], workspaceId: w.s.id }, select: { id: true } });
      expect(ids(seen), who.name).toEqual([w.p0.project.id, w.px.project.id, w.py.project.id].sort());
    }
  });

  it("a space with no team reads exactly as before: everybody in it sees all of it", async () => {
    const w = await makeTeamsWorld();
    for (const who of [w.alice, w.carol]) {
      const scope = await loadWorkScope(who.id);
      expect(scope.full.has(w.plain.id), who.name).toBe(true);
      expect(canSeeProject(scope, w.pu.project)).toBe(true);
    }
  });

  it("nobody sees a space they are not in, teams or not", async () => {
    const w = await makeTeamsWorld();
    expect(scopeSpaceIds(await loadWorkScope(w.alice.id))).not.toContain(w.other.id);
  });
});

describe("the routes answer «not found» for another team's work", () => {
  it("a task, its completion and its comments", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    expect((await call(taskRoute.GET, { params: { id: w.ty.id } })).status).toBe(404);
    expect((await call(taskRoute.PATCH, { method: "PATCH", params: { id: w.ty.id }, body: { title: "x" } })).status).toBe(404);
    expect((await call(taskCompleteRoute.POST, { params: { id: w.ty.id }, body: { complete: true } })).status).toBe(404);
    expect((await call(taskCommentsRoute.GET, { params: { id: w.ty.id } })).status).toBe(404);
    // the control: her own team's task opens
    expect((await call(taskRoute.GET, { params: { id: w.tx.id } })).status).toBe(200);
    expect((await call(taskRoute.GET, { params: { id: w.t0.id } })).status).toBe(200);
  });

  it("a board and a project's boards", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    expect((await call(boardRoute.GET, { params: { id: w.py.board.id } })).status).toBe(404);
    expect((await call(projectBoardsRoute.GET, { params: { id: w.py.project.id } })).status).toBe(404);
    expect((await call(boardRoute.GET, { params: { id: w.px.board.id } })).status).toBe(200);
  });

  it("the space's ADMIN opens every team's work", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.spaceAdmin.id);
    expect((await call(taskRoute.GET, { params: { id: w.ty.id } })).status).toBe(200);
    expect((await call(boardRoute.GET, { params: { id: w.py.board.id } })).status).toBe(200);
  });
});

describe("the lists leave the other team's work out", () => {
  it("GET /api/projects of the space", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const res = await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.s.id}` });
    expect(ids(res.json?.["projects"] as Array<{ id: string }>)).toEqual([w.p0.project.id, w.px.project.id].sort());
  });

  it("GET /api/tasks lists only THAT space (it used to list the whole company's) and only the caller's teams", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const res = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.s.id}` });
    const got = ids(res.json?.["tasks"] as Array<{ id: string }>);
    expect(got).toEqual([w.t0.id, w.tx.id].sort());
    expect(got).not.toContain(w.tt.id); // another space's task (alice is not in it)
    expect(got).not.toContain(w.tu.id); // another space of hers: not the one asked for
  });

  it("search finds the space's and her team's work, never the other team's", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const hunt = async (q: string) => (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` })).json;
    expect((await hunt(w.ty.title))?.["tasks"]).toEqual([]);
    expect((await hunt(w.py.project.name))?.["projects"]).toEqual([]);
    expect(ids((await hunt(w.tx.title))?.["tasks"] as Array<{ id: string }>)).toEqual([w.tx.id]);
  });

  it("the list and calendar query, my work and the reports", async () => {
    const w = await makeTeamsWorld();
    const scope = await loadWorkScope(w.alice.id);
    const view = await queryTasksForView({ orgId: w.org.id, workspaceId: w.s.id, visible: taskVisibleWhere(scope) });
    expect(view.map((t) => t.id).sort()).toEqual([w.t0.id, w.tx.id].sort());
    // bob's own work: his team's task is his; alice's my-work never shows it
    const mine = await getMyWork(w.alice.id);
    expect(Object.values(mine).flat().map((r) => r.task.id)).not.toContain(w.ty.id);
    // the reports count only what she may see (3 = T0, TX in S + TU in U)
    const report = await loadAnalytics(w.org.id, scopeSpaceIds(scope), undefined, scope);
    expect(report.total).toBe(3);
    expect(report.projects).toBe(3);
  });
});

describe("writing respects the teams", () => {
  it("a team's task is not given to somebody outside the team (403); to a team member or the space's ADMIN it is", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const refused = await call(taskRoute.PATCH, { method: "PATCH", params: { id: w.tx.id }, body: { assigneeId: w.bob.id } });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("assignee.not_in_team");
    expect((await call(taskRoute.PATCH, { method: "PATCH", params: { id: w.tx.id }, body: { assigneeId: w.spaceAdmin.id } })).status).toBe(200);
  });

  it("a task is not opened in another team's project, nor handed at creation to someone outside the team", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const base = { workspaceId: w.s.id, title: "new", priority: "NORMAL", type: "TASK" };
    expect((await call(tasksRoute.POST, { body: { ...base, projectId: w.py.project.id, boardId: w.py.board.id, columnId: w.py.todo.id } })).status).toBe(404);
    const toOutsider = await call(tasksRoute.POST, { body: { ...base, projectId: w.px.project.id, boardId: w.px.board.id, columnId: w.px.todo.id, assigneeId: w.carol.id } });
    expect(toOutsider.status).toBe(403);
    expect(toOutsider.json?.["message"]).toBe("assignee.not_in_team");
    expect((await call(tasksRoute.POST, { body: { ...base, projectId: w.px.project.id, boardId: w.px.board.id, columnId: w.px.todo.id } })).status).toBe(201);
  });

  it("a project is opened in a team only by its members or a manager; moved between teams only by a manager", async () => {
    const w = await makeTeamsWorld();
    await loginAs(w.alice.id);
    const intoY = await call(projectsRoute.POST, { body: { workspaceId: w.s.id, name: "into Y", teamId: w.y.id } });
    expect(intoY.status).toBe(403);
    expect(intoY.json?.["message"]).toBe("teams.not_member");
    const intoX = await call(projectsRoute.POST, { body: { workspaceId: w.s.id, name: "into X", teamId: w.x.id } });
    expect(intoX.status).toBe(201);
    const made = await db.project.findUniqueOrThrow({ where: { id: (intoX.json?.["project"] as { id: string }).id }, select: { teamId: true } });
    expect(made.teamId).toBe(w.x.id);

    const { PATCH } = await import("@/app/api/projects/[id]/route");
    expect((await call(PATCH, { method: "PATCH", params: { id: w.px.project.id }, body: { teamId: null } })).status).toBe(403);
    await loginAs(w.spaceAdmin.id);
    expect((await call(PATCH, { method: "PATCH", params: { id: w.px.project.id }, body: { teamId: w.y.id } })).status).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: w.px.project.id }, select: { teamId: true } })).teamId).toBe(w.y.id);
  });
});
