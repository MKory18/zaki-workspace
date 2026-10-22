import { describe, expect, it } from "vitest";
import * as workspaceRoute from "@/app/api/workspaces/[id]/route";
import * as wsMembersRoute from "@/app/api/workspaces/[id]/members/route";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeCampaign, makeCustomer, makeDepartment, makeOpportunity } from "./guest-helpers";
import {
  accountsApi,
  grantCapabilities,
  makeRankTeam,
  memberRow,
  pause,
  reason,
  slowUpdatesWhere,
  userRow,
  username,
} from "./accounts-helpers";

/**
 * Findings of the independent review B (tests/db/review-b-authz.test.ts), copied here and adjusted to
 * the rules the coordinator decided: H1, M1, M2, M5, L1, L2, L3, L7.
 */

/** A space the lead and the admin are NOT in, with one open task held by the plain member. */
async function secretSpaceWorld() {
  const t = await makeRankTeam();
  const secret = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Secret space");
  const p = await makeProject(secret.id);
  const task = await makeTask({
    orgId: t.org.id,
    workspaceId: secret.id,
    projectId: p.project.id,
    boardId: p.board.id,
    columnId: p.todo.id,
    creatorId: t.owner.id,
    assigneeId: t.member.id,
    title: "Confidential work",
  });
  return { ...t, secret, task, project: p };
}

const rowIn = (workspaceId: string, userId: string) =>
  db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });

async function expectNothingChanged(w: Awaited<ReturnType<typeof secretSpaceWorld>>) {
  expect((await memberRow(w.org.id, w.member.id)).status).toBe("ACTIVE");
  expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(w.member.id);
  expect(await rowIn(w.secret.id, w.member.id)).not.toBeNull();
  expect((await userRow(w.member.id)).tokenVersion).toBe(0);
}

describe("H1: offboarding's work transfer never opens a space", () => {
  it("a LEAD with users.manage cannot enter a space by offboarding a colleague and taking their open work", async () => {
    const w = await secretSpaceWorld();
    await grantCapabilities(w.org.id, w.lead.id, ["users.manage"]);
    await loginAs(w.lead.id);
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);

    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: w.lead.id });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("accounts.transfer_needs_space_access");
    expect(await rowIn(w.secret.id, w.lead.id)).toBeNull();
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);
    await expectNothingChanged(w);
  });

  it("an ADMIN who is not in the space cannot enter it the same way - rank opens no space", async () => {
    const w = await secretSpaceWorld();
    await loginAs(w.admin.id);
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);
    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: w.admin.id });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("accounts.transfer_needs_space_access");
    expect(await rowIn(w.secret.id, w.admin.id)).toBeNull();
    expect((await call(workspaceRoute.GET, { params: { id: w.secret.id } })).status).toBe(403);
    await expectNothingChanged(w);
  });

  it("nor can they hand the work (and the space) to an accomplice who is not in it either", async () => {
    const w = await secretSpaceWorld();
    const accomplice = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Accomplice" });
    await loginAs(w.admin.id);
    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: accomplice.id });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("accounts.transfer_needs_space_access");
    expect(await rowIn(w.secret.id, accomplice.id)).toBeNull();
    await expectNothingChanged(w);
  });

  it("whoever manages the space may add the receiver to it; the OWNER may always", async () => {
    const w = await secretSpaceWorld();
    const receiver = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Receiver" });
    // an org ADMIN who is IN the space manages it
    await db.workspaceMember.create({ data: { workspaceId: w.secret.id, userId: w.admin.id, role: "MEMBER" } });
    await loginAs(w.admin.id);
    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: receiver.id });
    expect(res.status, reason(res)).toBe(200);
    expect(await rowIn(w.secret.id, receiver.id)).toMatchObject({ role: "MEMBER" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(receiver.id);

    const v = await secretSpaceWorld();
    const other = await makeUser({ orgId: v.org.id, role: "MEMBER", name: "Other receiver" });
    await loginAs(v.owner.id);
    expect((await accountsApi.status(v.org.id, v.member.id, { action: "offboard", transferToUserId: other.id })).status).toBe(200);
    expect(await rowIn(v.secret.id, other.id)).not.toBeNull();
  });

  it("a receiver already in every affected space, or the OWNER (who needs no row), always works", async () => {
    const w = await secretSpaceWorld();
    await grantCapabilities(w.org.id, w.lead.id, ["users.manage"]);
    const insider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Insider" });
    await db.workspaceMember.create({ data: { workspaceId: w.secret.id, userId: insider.id, role: "MEMBER" } });
    await loginAs(w.lead.id);
    expect((await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: insider.id })).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(insider.id);

    const v = await secretSpaceWorld();
    await loginAs(v.admin.id);
    expect((await accountsApi.status(v.org.id, v.member.id, { action: "offboard", transferToUserId: v.owner.id })).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: v.task.id } })).assigneeId).toBe(v.owner.id);
    expect(await rowIn(v.secret.id, v.owner.id)).toBeNull();
  });
});

describe("M1: administration is strictly below one's own rank", () => {
  it("a MEMBER holding users.manage cannot reset the password of (= sign in as) a peer MEMBER", async () => {
    const t = await makeRankTeam();
    const peer = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Peer with more" });
    await grantCapabilities(t.org.id, t.member.id, ["users.manage"]);
    await grantCapabilities(t.org.id, peer.id, ["integrations.manage"]); // the owner's decision
    await loginAs(t.member.id);
    const reset = await accountsApi.password(t.org.id, peer.id);
    expect(reset.status).toBe(403);
    expect(reason(reset)).toBe("orgm.role_denied");
    expect(reset.json?.["temporaryPassword"]).toBeUndefined();
  });

  it("two LEADs holding users.manage cannot suspend each other (a peer is not 'below')", async () => {
    const t = await makeRankTeam();
    const other = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Other lead" });
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    await loginAs(t.lead.id);
    const res = await accountsApi.status(t.org.id, other.id, { action: "suspend" });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("orgm.role_denied");
    expect((await memberRow(t.org.id, other.id)).status).toBe("ACTIVE");
  });

  it("nor create a peer: a LEAD creates MEMBER and GUEST accounts, a MEMBER only GUEST accounts", async () => {
    const t = await makeRankTeam();
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    await grantCapabilities(t.org.id, t.member.id, ["users.manage"]);
    await loginAs(t.lead.id);
    expect(reason(await accountsApi.create(t.org.id, { name: "Peer lead", username: username(), role: "LEAD" }))).toBe("orgm.role_denied");
    expect((await accountsApi.create(t.org.id, { name: "Member", username: username(), role: "MEMBER" })).status).toBe(201);
    await loginAs(t.member.id);
    expect(reason(await accountsApi.create(t.org.id, { name: "Peer member", username: username(), role: "MEMBER" }))).toBe("orgm.role_denied");
    expect((await accountsApi.create(t.org.id, { name: "Partner", username: username(), role: "GUEST" })).status).toBe(201);
  });
});

describe("M2: nobody produces an account holding more than they hold", () => {
  it("an ADMIN whose prices.view was switched off creates a LEAD: the new account does not hold prices.view", async () => {
    const t = await makeRankTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.admin.id } },
      data: { revokedCapabilities: ["prices.view"] },
    });
    await loginAs(t.admin.id);
    const res = await accountsApi.create(t.org.id, { name: "New lead", username: username("lead"), role: "LEAD" });
    expect(res.status, reason(res)).toBe(201);
    const created = await memberRow(t.org.id, res.json!["userId"] as string);
    expect([...effectiveCapabilities(created)]).not.toContain("prices.view");
    expect(created.revokedCapabilities).toEqual(["prices.view"]);
  });

  it("a LEAD with users.manage whose crm.edit was switched off creates a MEMBER without crm.edit", async () => {
    const t = await makeRankTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.lead.id } },
      data: { capabilities: ["users.manage"], revokedCapabilities: ["crm.edit"] },
    });
    await loginAs(t.lead.id);
    const res = await accountsApi.create(t.org.id, { name: "New member", username: username(), role: "MEMBER" });
    expect(res.status, reason(res)).toBe(201);
    expect([...effectiveCapabilities(await memberRow(t.org.id, res.json!["userId"] as string))]).not.toContain("crm.edit");
  });

  it("...nor by promoting a MEMBER to LEAD; and the same caller cannot switch it back on later", async () => {
    const t = await makeRankTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.admin.id } },
      data: { revokedCapabilities: ["prices.view"] },
    });
    await loginAs(t.admin.id);
    const res = await accountsApi.update(t.org.id, t.member.id, { role: "LEAD" });
    expect(res.status, reason(res)).toBe(200);
    const promoted = await memberRow(t.org.id, t.member.id);
    expect([...effectiveCapabilities(promoted)]).not.toContain("prices.view");

    const regrant = await accountsApi.update(t.org.id, t.member.id, { revokedCapabilities: [] });
    expect(regrant.status).toBe(403);
    expect(reason(regrant)).toBe("accounts.cap_not_held");
    expect(reason(await accountsApi.update(t.org.id, t.member.id, { capabilities: ["prices.view"] }))).toBe("accounts.cap_not_held");

    // the OWNER holds everything and can switch it on
    await loginAs(t.owner.id);
    expect((await accountsApi.update(t.org.id, t.member.id, { revokedCapabilities: [] })).status).toBe(200);
    expect([...effectiveCapabilities(await memberRow(t.org.id, t.member.id))]).toContain("prices.view");
  });

  it("the OWNER is unaffected: what he creates holds the full rank", async () => {
    const t = await makeRankTeam();
    await loginAs(t.owner.id);
    const res = await accountsApi.create(t.org.id, { name: "Lead", username: username(), role: "LEAD" });
    const created = await memberRow(t.org.id, res.json!["userId"] as string);
    expect(created.revokedCapabilities).toEqual([]);
    expect([...effectiveCapabilities(created)]).toContain("prices.view");
  });
});

describe("M5: putting a new account into a space follows the space's own rule", () => {
  it("a LEAD with users.manage who is only a plain MEMBER of a space cannot put a new account into it", async () => {
    const t = await makeRankTeam();
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    const ws = await makeWorkspace(t.org.id, [
      { userId: t.lead.id, role: "MEMBER" },
      { userId: t.member.id, role: "ADMIN" },
    ]);
    await loginAs(t.lead.id);
    const direct = await call(wsMembersRoute.POST, { params: { id: ws.id }, body: { addUserIds: [t.guest.id] } });
    expect(direct.status).toBe(403); // the space's own door
    const name = username("planted");
    const res = await accountsApi.create(t.org.id, { name: "Planted person", username: name, workspaceIds: [ws.id] });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("accounts.workspace_denied");
    expect(await db.workspaceMember.count({ where: { workspaceId: ws.id } })).toBe(2);
    expect(await db.user.findFirst({ where: { username: name } })).toBeNull();
  });

  it("as the space's admin they can", async () => {
    const t = await makeRankTeam();
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    const ws = await makeWorkspace(t.org.id, [{ userId: t.lead.id, role: "ADMIN" }]);
    await loginAs(t.lead.id);
    const res = await accountsApi.create(t.org.id, { name: "New hire", username: username(), workspaceIds: [ws.id] });
    expect(res.status, reason(res)).toBe(201);
    expect(await db.workspaceMember.count({ where: { workspaceId: ws.id } })).toBe(2);
  });
});

describe("L1: manager changes are serialized", () => {
  it("two manager changes at the very same moment cannot close a loop", async () => {
    const t = await makeRankTeam();
    const a = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "A" });
    const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
    await loginAs(t.owner.id);
    const [r1, r2] = await Promise.all([
      accountsApi.update(t.org.id, a.id, { managerId: b.id }),
      accountsApi.update(t.org.id, b.id, { managerId: a.id }),
    ]);
    const ra = await memberRow(t.org.id, a.id);
    const rb = await memberRow(t.org.id, b.id);
    expect(ra.managerId === b.id && rb.managerId === a.id, `answers ${r1.status}/${r2.status}`).toBe(false);
  });

  it("even when the first change is still being written while the second one checks", async () => {
    const t = await makeRankTeam();
    const a = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "A" });
    const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
    const restore = await slowUpdatesWhere("OrganizationMember", { userId: a.id, managerId: b.id }, 1.5);
    try {
      await loginAs(t.owner.id);
      const first = accountsApi.update(t.org.id, a.id, { managerId: b.id });
      await pause(400);
      const second = await accountsApi.update(t.org.id, b.id, { managerId: a.id });
      expect((await first).status).toBe(200);
      expect(second.status).toBe(422);
      expect(reason(second)).toBe("accounts.manager_cycle");
    } finally {
      await restore();
    }
    expect((await memberRow(t.org.id, a.id)).managerId).toBe(b.id);
    expect((await memberRow(t.org.id, b.id)).managerId).toBeNull();
  });
});

describe("L7: an offboarding in progress cannot be edited afterwards", () => {
  it("an edit that arrives while the person is being offboarded is refused once the offboarding commits", async () => {
    const t = await makeTeam();
    const restore = await slowUpdatesWhere("OrganizationMember", { userId: t.member.id, status: "OFFBOARDED" }, 1.5);
    try {
      await loginAs(t.owner.id);
      const offboard = accountsApi.status(t.org.id, t.member.id, { action: "offboard" });
      await pause(400);
      const edit = await accountsApi.update(t.org.id, t.member.id, { name: "Edited too late" });
      expect((await offboard).status).toBe(200);
      expect(edit.status).toBe(409);
      expect(reason(edit)).toBe("accounts.offboarded_frozen");
    } finally {
      await restore();
    }
    expect((await userRow(t.member.id)).name).toBe("Member");
  });
});

describe("L2: no role-change notice for somebody who is out", () => {
  it("a suspended person whose rank changes is not notified (even if active in another company); an active one is", async () => {
    const { org, owner, member, admin } = await makeTeam();
    // still ACTIVE elsewhere, so only this company's status can tell that they are out here
    await db.organizationMember.create({ data: { organizationId: (await makeTeam()).org.id, userId: member.id, role: "MEMBER" } });
    await loginAs(owner.id);
    await accountsApi.status(org.id, member.id, { action: "suspend" });
    expect((await accountsApi.update(org.id, member.id, { role: "LEAD" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: member.id, type: "org_role_changed" } })).toBe(0);
    expect((await accountsApi.update(org.id, admin.id, { role: "LEAD" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: admin.id, type: "org_role_changed" } })).toBe(1);
  });
});

describe("L3: offboarding takes the person out of everything and hands over what they led or owned", () => {
  it("a person offboarded and later reactivated is not silently back in the group chats", async () => {
    const t = await makeRankTeam();
    const conv = await db.conversation.create({
      data: {
        orgId: t.org.id,
        kind: "GROUP",
        title: "Leadership",
        members: { create: [{ userId: t.owner.id, role: "admin" }, { userId: t.member.id }] },
      },
    });
    await loginAs(t.owner.id);
    expect((await accountsApi.status(t.org.id, t.member.id, { action: "offboard" })).status).toBe(200);
    await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: conv.id, authorId: t.owner.id, body: "while they were gone" } });
    expect((await accountsApi.status(t.org.id, t.member.id, { action: "reactivate" })).status).toBe(200);
    // they finish the onboarding again (temporary password changed), then open the chat list
    await db.user.update({ where: { id: t.member.id }, data: { mustChangePassword: false } });
    await loginAs(t.member.id);
    const list = await call(conversationsRoute.GET);
    expect(list.status).toBe(200);
    expect(list.json!["conversations"]).toEqual([]);
  });

  /** A leaver who is in a group chat, a DM, a department (leading it), leads two teams and owns CRM, campaign and project work. */
  async function leaderWorld() {
    const t = await makeRankTeam();
    const { org, owner, member: leaver, lead: heir } = t;
    const shared = await makeWorkspace(org.id, [{ userId: leaver.id }, { userId: heir.id }], "Shared");
    const closed = await makeWorkspace(org.id, [{ userId: leaver.id }], "Closed");
    const group = await db.conversation.create({
      data: { orgId: org.id, kind: "GROUP", title: "Team", members: { create: [{ userId: owner.id }, { userId: leaver.id }] } },
    });
    const dm = await db.conversation.create({
      data: { orgId: org.id, kind: "DM", members: { create: [{ userId: owner.id }, { userId: leaver.id }] } },
    });
    const dept = await makeDepartment(org.id, { memberIds: [leaver.id], leadId: leaver.id });
    const teamShared = await db.team.create({ data: { workspaceId: shared.id, name: "Shared team", leadId: leaver.id } });
    const teamClosed = await db.team.create({ data: { workspaceId: closed.id, name: "Closed team", leadId: leaver.id } });
    const openCampaign = await makeCampaign({ orgId: org.id, departmentId: dept.id, ownerId: leaver.id, status: "RUNNING" });
    const doneCampaign = await makeCampaign({ orgId: org.id, departmentId: dept.id, ownerId: leaver.id, status: "DONE" });
    const customer = await makeCustomer({ orgId: org.id, creatorId: owner.id });
    const openDeal = await makeOpportunity({ orgId: org.id, customerId: customer.id, ownerId: leaver.id });
    const wonDeal = await makeOpportunity({ orgId: org.id, customerId: customer.id, ownerId: leaver.id });
    await db.opportunity.update({ where: { id: wonDeal.id }, data: { stage: "WON" } });
    const project = await makeProject(shared.id);
    await db.project.update({ where: { id: project.project.id }, data: { ownerId: leaver.id } });
    const doneProject = await makeProject(shared.id);
    await db.project.update({ where: { id: doneProject.project.id }, data: { ownerId: leaver.id, status: "COMPLETED" } });
    const milestone = await db.milestone.create({ data: { projectId: project.project.id, name: "M1", ownerId: leaver.id } });
    const closedProject = await makeProject(closed.id);
    await db.project.update({ where: { id: closedProject.project.id }, data: { ownerId: leaver.id } });
    return {
      ...t,
      leaver,
      heir,
      shared,
      closed,
      group,
      dm,
      dept,
      teamShared,
      teamClosed,
      openCampaign,
      doneCampaign,
      openDeal,
      wonDeal,
      project,
      doneProject,
      milestone,
      closedProject,
    };
  }

  it("with a receiver: leaves group chats (not DMs) and departments; open leads and ownerships go to the receiver", async () => {
    const w = await leaderWorld();
    await loginAs(w.owner.id);
    const res = await accountsApi.status(w.org.id, w.leaver.id, { action: "offboard", transferToUserId: w.heir.id });
    expect(res.status, reason(res)).toBe(200);

    expect(await db.conversationMember.count({ where: { conversationId: w.group.id, userId: w.leaver.id } })).toBe(0);
    expect(await db.conversationMember.count({ where: { conversationId: w.dm.id, userId: w.leaver.id } })).toBe(1);
    expect(await db.departmentMember.count({ where: { userId: w.leaver.id } })).toBe(0);

    expect((await db.department.findUniqueOrThrow({ where: { id: w.dept.id } })).leadId).toBe(w.heir.id);
    expect((await db.team.findUniqueOrThrow({ where: { id: w.teamShared.id } })).leadId).toBe(w.heir.id);
    // the receiver is not in that space, and leading its team must not be a way in: the seat is vacated
    expect((await db.team.findUniqueOrThrow({ where: { id: w.teamClosed.id } })).leadId).toBeNull();
    expect((await db.campaign.findUniqueOrThrow({ where: { id: w.openCampaign.id } })).ownerId).toBe(w.heir.id);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.openDeal.id } })).ownerId).toBe(w.heir.id);
    expect((await db.project.findUniqueOrThrow({ where: { id: w.project.project.id } })).ownerId).toBe(w.heir.id);
    expect((await db.milestone.findUniqueOrThrow({ where: { id: w.milestone.id } })).ownerId).toBe(w.heir.id);
    expect((await db.project.findUniqueOrThrow({ where: { id: w.closedProject.project.id } })).ownerId).toBeNull();
    // history stays with the person who did it
    expect((await db.campaign.findUniqueOrThrow({ where: { id: w.doneCampaign.id } })).ownerId).toBe(w.leaver.id);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.wonDeal.id } })).ownerId).toBe(w.leaver.id);
    expect((await db.project.findUniqueOrThrow({ where: { id: w.doneProject.project.id } })).ownerId).toBe(w.leaver.id);
    // the receiver was not let into the closed space by any of this
    expect(await rowIn(w.closed.id, w.heir.id)).toBeNull();
  });

  it("without a receiver: nullable seats are vacated, owners that cannot be empty stay, and reactivation gives none of it back", async () => {
    const w = await leaderWorld();
    await loginAs(w.owner.id);
    expect((await accountsApi.status(w.org.id, w.leaver.id, { action: "offboard" })).status).toBe(200);
    expect((await db.department.findUniqueOrThrow({ where: { id: w.dept.id } })).leadId).toBeNull();
    expect((await db.team.findUniqueOrThrow({ where: { id: w.teamShared.id } })).leadId).toBeNull();
    expect((await db.project.findUniqueOrThrow({ where: { id: w.project.project.id } })).ownerId).toBeNull();
    expect((await db.milestone.findUniqueOrThrow({ where: { id: w.milestone.id } })).ownerId).toBeNull();
    // Campaign.ownerId and Opportunity.ownerId are NOT NULL: they keep the leaver
    expect((await db.campaign.findUniqueOrThrow({ where: { id: w.openCampaign.id } })).ownerId).toBe(w.leaver.id);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.openDeal.id } })).ownerId).toBe(w.leaver.id);

    expect((await accountsApi.status(w.org.id, w.leaver.id, { action: "reactivate" })).status).toBe(200);
    expect(await db.conversationMember.count({ where: { conversationId: w.group.id, userId: w.leaver.id } })).toBe(0);
    expect(await db.departmentMember.count({ where: { userId: w.leaver.id } })).toBe(0);
    expect(await db.workspaceMember.count({ where: { userId: w.leaver.id } })).toBe(0);
    expect((await db.department.findUniqueOrThrow({ where: { id: w.dept.id } })).leadId).toBeNull();
  });

  it("a caller who may not appoint department leads (only OWNER/ADMIN may) vacates the seat instead of handing it over", async () => {
    const t = await makeRankTeam();
    await grantCapabilities(t.org.id, t.lead.id, ["users.manage"]);
    const receiver = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Receiver" });
    const dept = await makeDepartment(t.org.id, { memberIds: [t.member.id], leadId: t.member.id });
    await loginAs(t.lead.id);
    const res = await accountsApi.status(t.org.id, t.member.id, { action: "offboard", transferToUserId: receiver.id });
    expect(res.status, reason(res)).toBe(200);
    expect((await db.department.findUniqueOrThrow({ where: { id: dept.id } })).leadId).toBeNull();
  });
});
