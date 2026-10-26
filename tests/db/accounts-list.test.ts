import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/server/policy/capabilities";
import { db, loginAs, logout, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeDepartment, makeRoutine, makeTicket } from "./guest-helpers";
import { accountsApi, makeRankTeam, reason } from "./accounts-helpers";

/** GET /api/organizations/[id]/members — the roster the members page is built from. */

interface Row {
  id: string;
  name: string;
  role: string;
  status: string;
  managerName: string | null;
  effectiveCapabilities: string[];
  openWork: number;
  workspaces: { id: string; name: string; role: string }[];
}
type Roster = { members: Row[]; actorRole: string; spaces: { id: string; name: string }[] };

const FIELDS = [
  "capabilities",
  "effectiveCapabilities",
  "email",
  "id",
  "jobTitle",
  "lastLoginAt",
  "managerId",
  "managerName",
  "mustChangePassword",
  "name",
  "openWork",
  "primaryOwner",
  "revokedCapabilities",
  "role",
  "status",
  "username",
  "workspaces",
];

describe("the roster", () => {
  it("has exactly the contract fields for every person, and never a password hash or session version", async () => {
    const { org, owner, admin, member, guest } = await makeRankTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
      data: { revokedCapabilities: ["integrations.manage"] },
    });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { managerId: admin.id, capabilities: ["cash.view"] },
    });
    await loginAs(owner.id);
    const res = await accountsApi.list(org.id);
    expect(res.status).toBe(200);
    const roster = res.json as unknown as Roster;
    expect(Object.keys(roster).sort()).toEqual(["actorPrimaryOwner", "actorRole", "members", "sectionGrid", "spaces"]);
    expect(roster.actorRole).toBe("OWNER");
    expect(roster.members).toHaveLength(5);
    for (const m of roster.members) expect(Object.keys(m).sort()).toEqual(FIELDS);
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("tokenVersion");
    expect(res.text).not.toMatch(/\$2[aby]\$/);

    const byId = new Map(roster.members.map((m) => [m.id, m]));
    expect(byId.get(owner.id)!.effectiveCapabilities).toEqual([...CAPABILITIES]);
    expect(byId.get(guest.id)!.effectiveCapabilities).toEqual([]);
    expect(byId.get(admin.id)!.effectiveCapabilities).not.toContain("integrations.manage");
    expect(byId.get(member.id)!.effectiveCapabilities).toContain("cash.view");
    expect(byId.get(member.id)!.managerName).toBe("Admin");
  });

  it("lists ACTIVE people first, then SUSPENDED, then OFFBOARDED; inside each, the highest rank first, then by name", async () => {
    const { org, owner, admin, member, guest, lead } = await makeRankTeam();
    const aMember = await makeUser({ orgId: org.id, role: "MEMBER", name: "Aaa member" });
    const suspendedAdmin = await makeUser({ orgId: org.id, role: "ADMIN", name: "Suspended admin" });
    const offboardedLead = await makeUser({ orgId: org.id, role: "LEAD", name: "Offboarded lead" });
    const suspendedGuest = await makeUser({ orgId: org.id, role: "GUEST", name: "Suspended guest" });
    for (const [userId, status] of [
      [suspendedAdmin.id, "SUSPENDED"],
      [offboardedLead.id, "OFFBOARDED"],
      [suspendedGuest.id, "SUSPENDED"],
    ] as const) {
      await db.organizationMember.update({ where: { organizationId_userId: { organizationId: org.id, userId } }, data: { status } });
    }
    await loginAs(owner.id);
    const roster = (await accountsApi.list(org.id)).json as unknown as Roster;
    expect(roster.members.map((m) => m.id)).toEqual([
      owner.id,
      admin.id,
      lead.id,
      aMember.id, // "Aaa member" before "Member"
      member.id,
      guest.id,
      suspendedAdmin.id,
      suspendedGuest.id,
      offboardedLead.id,
    ]);
  });

  it("counts open work: open tasks, open tickets and active routines of this company only", async () => {
    const { org, owner, member, guest } = await makeTeam();
    const other = await makeTeam();
    const ws = await makeWorkspace(org.id, [{ userId: member.id }]);
    const p = await makeProject(ws.id);
    const base = { orgId: org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, creatorId: owner.id, assigneeId: member.id };
    await makeTask({ ...base, columnId: p.todo.id });
    await makeTask({ ...base, columnId: p.todo.id });
    await makeTask({ ...base, columnId: p.done.id, completedAt: new Date() });
    const archived = await makeTask({ ...base, columnId: p.todo.id });
    await db.task.update({ where: { id: archived.id }, data: { archived: true } });
    const dept = await makeDepartment(org.id);
    await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: owner.id, assigneeId: member.id, status: "OPEN" });
    await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: owner.id, assigneeId: member.id, status: "RESOLVED" });
    await makeRoutine({ orgId: org.id, assigneeId: member.id });
    await db.routine.create({ data: { orgId: org.id, title: "Paused", assigneeId: member.id, active: false } });
    // the same person's work in another company does not count here
    await makeRoutine({ orgId: other.org.id, assigneeId: member.id });

    await loginAs(owner.id);
    const roster = (await accountsApi.list(org.id)).json as unknown as Roster;
    const byId = new Map(roster.members.map((m) => [m.id, m]));
    expect(byId.get(member.id)!.openWork).toBe(4); // 2 tasks + 1 ticket + 1 routine
    expect(byId.get(guest.id)!.openWork).toBe(0);
  });

  it("shows every space to the OWNER; anybody else sees only their own spaces, in the list and in each person's spaces", async () => {
    const { org, owner, admin, member } = await makeTeam();
    const shared = await makeWorkspace(org.id, [{ userId: admin.id }, { userId: member.id, role: "ADMIN" }], "Shared");
    const secret = await makeWorkspace(org.id, [{ userId: member.id }], "Secret");
    const foreign = await makeWorkspace((await makeTeam()).org.id, [{ userId: member.id }], "Foreign");

    await loginAs(owner.id);
    const ownerView = (await accountsApi.list(org.id)).json as unknown as Roster;
    expect(ownerView.spaces.map((s) => s.id).sort()).toEqual([shared.id, secret.id].sort());
    const memberSeenByOwner = ownerView.members.find((m) => m.id === member.id)!;
    expect(memberSeenByOwner.workspaces).toEqual([
      { id: secret.id, name: "Secret", role: "MEMBER" },
      { id: shared.id, name: "Shared", role: "ADMIN" },
    ]);
    expect(JSON.stringify(ownerView)).not.toContain(foreign.id);

    await loginAs(admin.id);
    const adminView = (await accountsApi.list(org.id)).json as unknown as Roster;
    expect(adminView.actorRole).toBe("ADMIN");
    expect(adminView.spaces).toEqual([{ id: shared.id, name: "Shared" }]);
    expect(adminView.members.find((m) => m.id === member.id)!.workspaces.map((w) => w.id)).toEqual([shared.id]);
    expect(JSON.stringify(adminView)).not.toContain(secret.id);
  });
});

describe("who may read the roster", () => {
  it("not an anonymous caller, a plain member, a guest, or another company's owner", async () => {
    const { org, member, guest } = await makeTeam();
    const other = await makeTeam();
    logout();
    expect((await accountsApi.list(org.id)).status).toBe(401);
    for (const who of [member, guest]) {
      await loginAs(who.id);
      const res = await accountsApi.list(org.id);
      expect(res.status).toBe(403);
      expect(reason(res)).toBe("insufficient_role");
    }
    await loginAs(other.owner.id);
    const cross = await accountsApi.list(org.id);
    expect(cross.status).toBe(403);
    expect(reason(cross)).toBe("not_org_member");
  });

  it("a suspended ADMIN is refused at once, even with a fresh cookie", async () => {
    const { org, owner, admin } = await makeTeam();
    await loginAs(owner.id);
    expect((await accountsApi.status(org.id, admin.id, { action: "suspend" })).status).toBe(200);
    await loginAs(admin.id);
    expect((await accountsApi.list(org.id)).status).toBe(401);
  });

  it("a MEMBER holding users.manage may read it", async () => {
    const { org, member } = await makeTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { capabilities: ["users.manage"] },
    });
    await loginAs(member.id);
    const res = await accountsApi.list(org.id);
    expect(res.status).toBe(200);
    expect((res.json as unknown as Roster).actorRole).toBe("MEMBER");
  });
});
