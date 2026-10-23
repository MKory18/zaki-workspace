import { describe, expect, it } from "vitest";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import { call, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * A task shows WHO it is assigned to (id + name). The assignee's e-mail address
 * is never needed by the UI and must not ride along in task payloads — the
 * external partner (GUEST) in a shared workspace would otherwise collect the
 * company's staff addresses from the boards.
 */
describe("task payloads do not carry the assignee's e-mail", () => {
  async function setup() {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [
      { userId: team.admin.id, role: "ADMIN" },
      { userId: team.member.id, role: "MEMBER" },
      { userId: team.guest.id, role: "GUEST" },
    ]);
    const { project, board, todo } = await makeProject(ws.id);
    const task = await makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: team.admin.id,
      assigneeId: team.admin.id,
      title: "Ship samples",
    });
    return { team, ws, project, board, task };
  }

  it("GET /api/tasks/:id", async () => {
    const { team, task } = await setup();
    for (const viewer of [team.member, team.guest]) {
      await loginAs(viewer.id);
      const res = await call(taskRoute.GET, { params: { id: task.id } });
      expect(res.status).toBe(200);
      expect(res.text).toContain("Ship samples");
      expect(res.text).not.toContain(team.admin.email);
    }
  });

  it("GET /api/boards/:id (every card on the board)", async () => {
    const { team, board } = await setup();
    for (const viewer of [team.member, team.guest]) {
      await loginAs(viewer.id);
      const res = await call(boardRoute.GET, { params: { id: board.id } });
      expect(res.status).toBe(200);
      expect(res.text).toContain("Ship samples");
      expect(res.text).not.toContain(team.admin.email);
    }
  });

  it("GET /api/tasks?workspaceId= (task list)", async () => {
    const { team, ws } = await setup();
    await loginAs(team.guest.id);
    const res = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${ws.id}` });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Ship samples");
    expect(res.text).not.toContain(team.admin.email);
  });
});
