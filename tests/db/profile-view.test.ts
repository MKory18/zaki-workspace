import { describe, expect, it } from "vitest";
import { getProfileForViewer } from "@/server/services/users";
import { db, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * A profile counts the person's work, and a space is like a separate site: the viewer sees the numbers of the
 * spaces THEY may open, never the work of a space they are not in (the space-isolation plan: «عدّادات الملف
 * الشخصي بتنحصر بالمساحة»). The spaces both people are in are listed on the profile.
 */
async function world() {
  const t = await makeTeam();
  const target = await makeUser({ orgId: t.org.id, name: "Target" });
  const shared = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: target.id }], "Shared");
  const hidden = await makeWorkspace(t.org.id, [{ userId: target.id }], "Hidden");
  for (const ws of [shared, hidden]) {
    const p = await makeProject(ws.id);
    const base = { orgId: t.org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, creatorId: target.id, assigneeId: target.id };
    await makeTask({ ...base, columnId: p.todo.id });
    await makeTask({ ...base, columnId: p.done.id, completedAt: new Date() });
    await db.idea.create({ data: { orgId: t.org.id, creatorId: target.id, title: `idea ${ws.name}`, workspaceId: ws.id } });
  }
  return { ...t, target, shared, hidden };
}

describe("a profile shows only what the viewer may see", () => {
  it("counts the work of the viewer's own spaces, not of a space they are not in", async () => {
    const w = await world();
    const view = await getProfileForViewer(w.member.id, w.target.id);
    expect(view.kind).toBe("full");
    if (view.kind !== "full") return;
    expect(view.profile.stats.openTasksAssigned).toBe(1);
    expect(view.profile.stats.tasksCompleted).toBe(1);
    expect(view.profile.stats.ideasCreated).toBe(1);
  });

  it("the owner sees everything, as he sees every space", async () => {
    const w = await world();
    const view = await getProfileForViewer(w.owner.id, w.target.id);
    if (view.kind !== "full") throw new Error("full");
    expect(view.profile.stats.openTasksAssigned).toBe(2);
    expect(view.profile.stats.ideasCreated).toBe(2);
  });

  it("lists the spaces the two people share; a space the viewer is not in is not named", async () => {
    const w = await world();
    const view = await getProfileForViewer(w.member.id, w.target.id);
    if (view.kind !== "full") throw new Error("full");
    expect(view.profile.sharedSpaces.map((s) => s.name)).toEqual(["Shared"]);
  });

  it("for the owner it lists every space the person is in", async () => {
    const w = await world();
    const view = await getProfileForViewer(w.owner.id, w.target.id);
    if (view.kind !== "full") throw new Error("full");
    expect(view.profile.sharedSpaces.map((s) => s.name).sort()).toEqual(["Hidden", "Shared"]);
  });
});
