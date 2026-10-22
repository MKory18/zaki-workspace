import { describe, expect, it } from "vitest";
import { loadAnalytics } from "@/server/services/analytics";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { db, makeOrg, makeUser } from "./helpers";
import { addTask, daysFromNow, joinOrg, joinWorkspace, makeScopedOrg, seedWork, type ScopedOrg } from "./scoping-helpers";

async function makeIdeas(orgId: string, creatorId: string, statuses: ("NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED")[]) {
  for (const status of statuses) {
    await db.idea.create({ data: { orgId, creatorId, title: `Idea ${status} ${Math.random()}`, status } });
  }
}

/** Org with a populated "in" workspace (2 open + 1 completed task) and "out" workspace (1 open) and 3 ideas. */
async function makeAnalyticsOrg(): Promise<ScopedOrg> {
  const f = await makeScopedOrg();
  await addTask(f.inside, {
    orgId: f.org.id,
    workspaceId: f.wsIn.id,
    token: f.token,
    creatorId: f.owner.id,
    assigneeId: f.member.id,
    title: "second open",
    dueDate: daysFromNow(-2),
  });
  await addTask(f.inside, {
    orgId: f.org.id,
    workspaceId: f.wsIn.id,
    token: f.token,
    creatorId: f.owner.id,
    assigneeId: f.member.id,
    title: "done one",
    completedAt: daysFromNow(-1),
  });
  await makeIdeas(f.org.id, f.owner.id, ["NEW", "NEW", "ACCEPTED"]);
  return f;
}

const statusMap = (data: Awaited<ReturnType<typeof loadAnalytics>>) =>
  Object.fromEntries(data.byStatus30.map((row) => [row.status, row._count._all]));

describe("analytics: counted from the caller's organization and accessible workspaces only", () => {
  it("a plain MEMBER's numbers cover their workspace, their org's ideas, and nothing from other orgs", async () => {
    const f = await makeAnalyticsOrg();
    // another org with its own ideas, workspaces, projects and tasks — must never leak in
    const other = await makeAnalyticsOrg();
    await makeIdeas(other.org.id, other.owner.id, ["UNDER_REVIEW", "REJECTED", "REJECTED"]);

    const wsIds = await accessibleWorkspaceIds(f.member.id);
    const data = await loadAnalytics(f.org.id, wsIds);

    expect(data.ideas).toBe(3);
    expect(statusMap(data)).toEqual({ NEW: 2, ACCEPTED: 1 });
    expect(data.workspaces).toBe(1); // wsIn only: wsOut is in the org but not open to this member
    expect(data.projects).toBe(1);
    expect(data.total).toBe(3);
    expect(data.open).toBe(2);
    expect(data.completed).toBe(1);
    expect(data.overdue).toBe(1);
  });

  it("an ADMIN's numbers cover every workspace of the org, still not other orgs'", async () => {
    const f = await makeAnalyticsOrg();
    const other = await makeAnalyticsOrg();
    expect(other.org.id).not.toBe(f.org.id);

    const wsIds = await accessibleWorkspaceIds(f.admin.id);
    const data = await loadAnalytics(f.org.id, wsIds);
    expect(data.workspaces).toBe(2);
    expect(data.projects).toBe(2);
    expect(data.total).toBe(4);
    expect(data.ideas).toBe(3);
  });

  it("someone who belongs to two orgs gets the active org's numbers only, even though their access list spans both", async () => {
    const a = await makeAnalyticsOrg();
    const b = await makeAnalyticsOrg();
    await makeIdeas(b.org.id, b.owner.id, ["REJECTED"]);
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsIn.id);
    await joinOrg(multi.id, b.org.id, "ADMIN");

    const wsIds = await accessibleWorkspaceIds(multi.id);
    expect(wsIds).toEqual(expect.arrayContaining([a.wsIn.id, b.wsIn.id, b.wsOut.id]));

    const forA = await loadAnalytics(a.org.id, wsIds);
    expect(forA.workspaces).toBe(1);
    expect(forA.projects).toBe(1);
    expect(forA.total).toBe(3);
    expect(forA.ideas).toBe(3);

    const forB = await loadAnalytics(b.org.id, wsIds);
    expect(forB.workspaces).toBe(2);
    expect(forB.projects).toBe(2);
    expect(forB.total).toBe(4);
    expect(forB.ideas).toBe(4);
    expect(statusMap(forB)).toEqual({ NEW: 2, ACCEPTED: 1, REJECTED: 1 });
  });

  it("an org with no ideas shows zero ideas — it never borrows another org's", async () => {
    await makeAnalyticsOrg(); // somebody else's ideas exist in the database
    const empty = await makeOrg();
    const wsIds: string[] = [];
    const data = await loadAnalytics(empty.id, wsIds);
    expect(data.ideas).toBe(0);
    expect(data.byStatus30).toEqual([]);
    expect(data.workspaces).toBe(0);
    expect(data.projects).toBe(0);
    expect(data.total).toBe(0);
  });

  it("with no accessible workspace the work numbers are zero (and an empty list is not 'no filter')", async () => {
    const f = await makeAnalyticsOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    const wsIds = await accessibleWorkspaceIds(loner.id);
    expect(wsIds).toEqual([]);
    const data = await loadAnalytics(f.org.id, wsIds);
    expect(data.total).toBe(0);
    expect(data.open).toBe(0);
    expect(data.workspaces).toBe(0);
    expect(data.projects).toBe(0);
    expect(data.assignees).toEqual([]);
    // ideas belong to the org itself (every member can read them), not to a workspace
    expect(data.ideas).toBe(3);
  });

  it("workload and priority only count open, non-archived tasks of accessible workspaces", async () => {
    const f = await makeAnalyticsOrg();
    // an open task assigned to the owner in the workspace the member cannot open
    await addTask(f.outside, {
      orgId: f.org.id,
      workspaceId: f.wsOut.id,
      token: f.token,
      creatorId: f.owner.id,
      assigneeId: f.owner.id,
      title: "hidden workload",
    });
    const archived = await addTask(f.inside, {
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      creatorId: f.owner.id,
      assigneeId: f.owner.id,
      title: "archived",
    });
    await db.task.update({ where: { id: archived.id }, data: { archived: true } });

    const data = await loadAnalytics(f.org.id, await accessibleWorkspaceIds(f.member.id));
    expect(data.assignees.map((a) => a.assigneeId)).toEqual([f.member.id]);
    expect(data.assignees[0]!._count._all).toBe(1); // only "second open" is open; "done one" is completed
    expect(data.nameOf.get(f.member.id)).toBe("Member");
    expect(data.byPriority.find((p) => p.priority === "NORMAL")?._count._all).toBe(2);
    expect(data.total).toBe(3); // the archived task is not counted
  });

  it("an org's numbers do not move when another org adds ideas, workspaces, projects or tasks", async () => {
    const f = await makeAnalyticsOrg();
    const before = await loadAnalytics(f.org.id, await accessibleWorkspaceIds(f.admin.id));
    const other = await makeAnalyticsOrg();
    await makeIdeas(other.org.id, other.owner.id, ["NEW", "NEW", "NEW", "UNDER_REVIEW"]);
    await seedWork({ orgId: other.org.id, workspaceId: other.wsIn.id, token: other.token, label: "extra", creatorId: other.owner.id });
    const after = await loadAnalytics(f.org.id, await accessibleWorkspaceIds(f.admin.id));
    expect(after.ideas).toBe(before.ideas);
    expect(after.workspaces).toBe(before.workspaces);
    expect(after.projects).toBe(before.projects);
    expect(after.total).toBe(before.total);
    expect(statusMap(after)).toEqual(statusMap(before));
  });
});
