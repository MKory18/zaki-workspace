import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { currentUser } from "@/server/auth";
import { db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeDepartment, makeRoutine, makeTicket } from "./guest-helpers";
import {
  accountsApi,
  cookieWorks,
  failWritesWhere,
  makeRankTeam,
  memberRow,
  reason,
  sessionCookie,
  userRow,
} from "./accounts-helpers";

/**
 * POST [userId]/status (suspend, reactivate, offboard), POST [userId]/password, POST
 * [userId]/logout, and the legacy DELETE [userId], which now offboards instead of deleting.
 */

/** A leaver with open and finished work in two spaces, a ticket desk and the daily routines. */
async function leaverWithWork() {
  const team = await makeRankTeam();
  const { org, owner, member: leaver, lead: heir } = team;
  const wsA = await makeWorkspace(org.id, [{ userId: leaver.id }]);
  const wsB = await makeWorkspace(org.id, [{ userId: leaver.id }, { userId: heir.id }]);
  const pa = await makeProject(wsA.id);
  const pb = await makeProject(wsB.id);
  const base = { orgId: org.id, creatorId: owner.id, assigneeId: leaver.id };
  const openA = await makeTask({ ...base, workspaceId: wsA.id, projectId: pa.project.id, boardId: pa.board.id, columnId: pa.todo.id });
  const openB = await makeTask({ ...base, workspaceId: wsB.id, projectId: pb.project.id, boardId: pb.board.id, columnId: pb.todo.id });
  const doneA = await makeTask({
    ...base,
    workspaceId: wsA.id,
    projectId: pa.project.id,
    boardId: pa.board.id,
    columnId: pa.done.id,
    completedAt: new Date(),
  });
  const dept = await makeDepartment(org.id, { memberIds: [leaver.id] });
  const openTicket = await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: owner.id, assigneeId: leaver.id, status: "IN_PROGRESS" });
  const closedTicket = await makeTicket({ orgId: org.id, departmentId: dept.id, creatorId: owner.id, assigneeId: leaver.id, status: "CLOSED" });
  const routine = await makeRoutine({ orgId: org.id, assigneeId: leaver.id });
  const pausedRoutine = await db.routine.create({ data: { orgId: org.id, title: "Paused", assigneeId: leaver.id, active: false } });
  return { ...team, leaver, heir, wsA, wsB, openA, openB, doneA, dept, openTicket, closedTicket, routine, pausedRoutine };
}

describe("suspending and reactivating", () => {
  it("suspend ends every session at once, keeps the spaces, and is audited", async () => {
    const { org, owner, member } = await makeTeam();
    const ws = await makeWorkspace(org.id, [{ userId: member.id }]);
    await loginAs(member.id);
    const old = sessionCookie();
    expect(await cookieWorks(old)).toBe(true);

    await loginAs(owner.id);
    const res = await accountsApi.status(org.id, member.id, { action: "suspend" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    const row = await memberRow(org.id, member.id);
    expect(row.status).toBe("SUSPENDED");
    expect(row.statusChangedById).toBe(owner.id);
    expect(row.statusChangedAt).toBeInstanceOf(Date);
    expect((await userRow(member.id)).tokenVersion).toBe(1);
    expect(await db.workspaceMember.count({ where: { workspaceId: ws.id, userId: member.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "org.member_suspended", target: member.id } })).toBe(1);

    // the old cookie is dead, and even a freshly minted one finds no ACTIVE membership
    expect(await cookieWorks(old)).toBe(false);
    await loginAs(member.id);
    expect(await currentUser()).toBeNull();

    await loginAs(owner.id);
    const again = await accountsApi.status(org.id, member.id, { action: "suspend" });
    expect(again.status).toBe(409);
    expect(reason(again)).toBe("accounts.bad_transition");
  });

  it("reactivate returns a working temporary password once, which must be changed", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    await accountsApi.status(org.id, member.id, { action: "suspend" });
    const res = await accountsApi.status(org.id, member.id, { action: "reactivate" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json ?? {}).sort()).toEqual(["ok", "temporaryPassword"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const temporaryPassword = (res.json as { temporaryPassword?: string }).temporaryPassword as string;
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    const user = await userRow(member.id);
    expect(await bcrypt.compare(temporaryPassword, user.passwordHash)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(user.tokenVersion).toBe(2);
    expect((await memberRow(org.id, member.id)).status).toBe("ACTIVE");
    const audits = await db.auditLog.findMany({ where: { action: "org.member_reactivated", target: member.id } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(temporaryPassword);

    // signed in again, the person is in but owes a password change
    await loginAs(member.id);
    expect(await currentUser()).toMatchObject({ id: member.id, mustChangePassword: true });

    await loginAs(owner.id);
    const twice = await accountsApi.status(org.id, member.id, { action: "reactivate" });
    expect(twice.status).toBe(409);
    expect(reason(twice)).toBe("accounts.bad_transition");
  });

  it("an unknown action is refused", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.status(org.id, member.id, { action: "delete" });
    expect(res.status).toBe(422);
    expect(reason(res)).toBe("accounts.action_invalid");
  });
});

describe("offboarding", () => {
  it("with open work and nobody to receive it, nothing happens (400)", async () => {
    const { org, owner, leaver, openA } = await leaverWithWork();
    await loginAs(owner.id);
    const res = await accountsApi.status(org.id, leaver.id, { action: "offboard" });
    expect(res.status).toBe(400);
    expect(reason(res)).toBe("accounts.transfer_required");
    expect((await memberRow(org.id, leaver.id)).status).toBe("ACTIVE");
    expect((await db.task.findUniqueOrThrow({ where: { id: openA.id } })).assigneeId).toBe(leaver.id);
    expect((await userRow(leaver.id)).tokenVersion).toBe(0);
  });

  it("moves the open work, gives the receiver the spaces it needs, removes the leaver from every space, deletes nothing else", async () => {
    const w = await leaverWithWork();
    const { org, owner, leaver, heir } = w;
    const otherOrgSpace = await makeWorkspace((await makeTeam()).org.id, [{ userId: leaver.id }]);
    const message = await db.conversation.create({
      data: { orgId: org.id, kind: "DM", members: { create: [{ userId: leaver.id }, { userId: owner.id }] } },
    });
    await db.chatMessage.create({ data: { orgId: org.id, conversationId: message.id, authorId: leaver.id, body: "handover notes" } });
    await loginAs(leaver.id);
    const old = sessionCookie();

    await loginAs(owner.id);
    const res = await accountsApi.status(org.id, leaver.id, { action: "offboard", transferToUserId: heir.id });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });

    // open work moved; finished work stays where it was
    expect((await db.task.findUniqueOrThrow({ where: { id: w.openA.id } })).assigneeId).toBe(heir.id);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.openB.id } })).assigneeId).toBe(heir.id);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.doneA.id } })).assigneeId).toBe(leaver.id);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: w.openTicket.id } })).assigneeId).toBe(heir.id);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: w.closedTicket.id } })).assigneeId).toBe(leaver.id);
    expect((await db.routine.findUniqueOrThrow({ where: { id: w.routine.id } })).assigneeId).toBe(heir.id);
    expect((await db.routine.findUniqueOrThrow({ where: { id: w.pausedRoutine.id } })).assigneeId).toBe(leaver.id);
    // the moves are in each task's history
    expect(await db.taskActivity.count({ where: { taskId: w.openA.id, actorId: owner.id } })).toBe(1);

    // the receiver can open what it received: added to space A (it was already in B)
    const heirSpaces = await db.workspaceMember.findMany({ where: { userId: heir.id }, select: { workspaceId: true, role: true } });
    expect(heirSpaces.map((s) => s.workspaceId).sort()).toEqual([w.wsA.id, w.wsB.id].sort());
    expect(heirSpaces.every((s) => s.role === "MEMBER")).toBe(true);

    // the leaver is out of every space of THIS company only
    expect(await db.workspaceMember.count({ where: { userId: leaver.id, workspace: { organizationId: org.id } } })).toBe(0);
    expect(await db.workspaceMember.count({ where: { userId: leaver.id, workspaceId: otherOrgSpace.id } })).toBe(1);

    // the account and its history stay; the membership says OFFBOARDED; every session ended
    const row = await memberRow(org.id, leaver.id);
    expect(row.status).toBe("OFFBOARDED");
    expect(row.statusChangedById).toBe(owner.id);
    expect(await db.user.count({ where: { id: leaver.id } })).toBe(1);
    expect(await db.chatMessage.count({ where: { authorId: leaver.id } })).toBe(1);
    // out of the department roster too (review B, L3); the DM with the owner stays for the other side's history
    expect(await db.departmentMember.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await db.conversationMember.count({ where: { conversationId: message.id, userId: leaver.id } })).toBe(1);
    expect(await cookieWorks(old)).toBe(false);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "org.member_offboarded", target: leaver.id } });
    expect(audit.meta).toMatchObject({ from: "ACTIVE", transferTo: heir.id, tasks: 2, tickets: 1, routines: 1 });
    const note = await db.notification.findFirstOrThrow({ where: { userId: heir.id, type: "work_transferred" } });
    expect(note.title).toContain(leaver.name);
  });

  it("the people the leaver managed now report to the leaver's own manager (or nobody)", async () => {
    const { org, owner, admin, member: leaver, lead } = await makeRankTeam();
    const report = await makeUser({ orgId: org.id, role: "MEMBER" });
    await loginAs(owner.id);
    await accountsApi.update(org.id, leaver.id, { managerId: admin.id });
    await accountsApi.update(org.id, report.id, { managerId: leaver.id });
    await accountsApi.update(org.id, lead.id, { managerId: leaver.id });
    expect((await accountsApi.status(org.id, leaver.id, { action: "offboard" })).status).toBe(200);
    expect((await memberRow(org.id, report.id)).managerId).toBe(admin.id);
    expect((await memberRow(org.id, lead.id)).managerId).toBe(admin.id);

    // a leaver without a manager leaves their people reporting to nobody (escalations go to the owner)
    const second = await makeUser({ orgId: org.id, role: "MEMBER" });
    const secondReport = await makeUser({ orgId: org.id, role: "MEMBER" });
    await accountsApi.update(org.id, secondReport.id, { managerId: second.id });
    expect((await accountsApi.status(org.id, second.id, { action: "offboard" })).status).toBe(200);
    expect((await memberRow(org.id, secondReport.id)).managerId).toBeNull();
  });

  it("without open work no receiver is needed; a suspended person can be offboarded; twice is a 409", async () => {
    const { org, owner, member, guest } = await makeTeam();
    await loginAs(owner.id);
    expect((await accountsApi.status(org.id, guest.id, { action: "offboard" })).status).toBe(200);
    await accountsApi.status(org.id, member.id, { action: "suspend" });
    expect((await accountsApi.status(org.id, member.id, { action: "offboard" })).status).toBe(200);
    const twice = await accountsApi.status(org.id, member.id, { action: "offboard" });
    expect(twice.status).toBe(409);
    expect(reason(twice)).toBe("accounts.bad_transition");
    // and reactivating an offboarded person works (their spaces are not given back)
    const back = await accountsApi.status(org.id, member.id, { action: "reactivate" });
    expect(back.status).toBe(200);
    expect((await memberRow(org.id, member.id)).status).toBe("ACTIVE");
  });

  it("the receiver must be an ACTIVE, non-guest member of the same company, other than the leaver", async () => {
    const w = await leaverWithWork();
    const { org, owner, guest, leaver } = w;
    const outsider = (await makeTeam()).member;
    const suspended = await makeUser({ orgId: org.id, role: "MEMBER" });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: suspended.id } },
      data: { status: "SUSPENDED" },
    });
    await loginAs(owner.id);
    for (const transferToUserId of [guest.id, leaver.id, outsider.id, suspended.id, "nobody"]) {
      const res = await accountsApi.status(org.id, leaver.id, { action: "offboard", transferToUserId });
      expect(res.status, transferToUserId).toBe(422);
      expect(reason(res), transferToUserId).toBe("accounts.transferee_invalid");
    }
    expect((await memberRow(org.id, leaver.id)).status).toBe("ACTIVE");
    // the OWNER may receive the work (and needs no space rows: the owner sees every space)
    expect((await accountsApi.status(org.id, leaver.id, { action: "offboard", transferToUserId: owner.id })).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.openA.id } })).assigneeId).toBe(owner.id);
    expect(await db.workspaceMember.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("is ONE transaction: a failure in the last move leaves the account exactly as it was", async () => {
    const w = await leaverWithWork();
    const { org, owner, leaver, heir } = w;
    const restore = await failWritesWhere("Routine", "assigneeId", heir.id);
    try {
      await loginAs(owner.id);
      const res = await accountsApi.status(org.id, leaver.id, { action: "offboard", transferToUserId: heir.id });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await restore();
    }
    expect((await memberRow(org.id, leaver.id)).status).toBe("ACTIVE");
    expect((await userRow(leaver.id)).tokenVersion).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.openA.id } })).assigneeId).toBe(leaver.id);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: w.openTicket.id } })).assigneeId).toBe(leaver.id);
    expect(await db.workspaceMember.count({ where: { userId: leaver.id, workspace: { organizationId: org.id } } })).toBe(2);
    expect(await db.workspaceMember.count({ where: { userId: heir.id, workspaceId: w.wsA.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "org.member_offboarded", target: leaver.id } })).toBe(0);
  });
});

describe("the legacy DELETE offboards instead of deleting", () => {
  it("reads the receiver from the body or from ?transferTo=, and keeps the account", async () => {
    const w = await leaverWithWork();
    const { org, owner, leaver, heir } = w;
    await loginAs(owner.id);
    const refused = await accountsApi.remove(org.id, leaver.id);
    expect(refused.status).toBe(400);
    expect(reason(refused)).toBe("accounts.transfer_required");

    const res = await accountsApi.remove(org.id, leaver.id, { body: { transferToUserId: heir.id } });
    expect(res.status).toBe(200);
    expect((await memberRow(org.id, leaver.id)).status).toBe("OFFBOARDED");
    expect(await db.user.count({ where: { id: leaver.id } })).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.openA.id } })).assigneeId).toBe(heir.id);

    const second = await leaverWithWork();
    await loginAs(second.owner.id);
    const viaQuery = await accountsApi.remove(second.org.id, second.leaver.id, {
      url: `http://localhost/api/organizations/${second.org.id}/members/${second.leaver.id}?transferTo=${second.heir.id}`,
    });
    expect(viaQuery.status).toBe(200);
    expect((await memberRow(second.org.id, second.leaver.id)).status).toBe("OFFBOARDED");
  });

  it("follows the rank rules: an ADMIN cannot offboard another ADMIN or the OWNER", async () => {
    const { org, owner, admin } = await makeTeam();
    const otherAdmin = await makeUser({ orgId: org.id, role: "ADMIN" });
    await loginAs(admin.id);
    expect(reason(await accountsApi.remove(org.id, otherAdmin.id))).toBe("orgm.role_denied");
    expect(reason(await accountsApi.remove(org.id, owner.id))).toBe("orgm.role_denied");
    expect((await memberRow(org.id, otherAdmin.id)).status).toBe("ACTIVE");
  });
});

describe("password reset and log-out-everywhere", () => {
  it("POST password: a new temporary password once, must be changed, every old session ends", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(member.id);
    const old = sessionCookie();
    await loginAs(owner.id);
    const res = await accountsApi.password(org.id, member.id);
    expect(res.status).toBe(200);
    // exactly this, and never cached on the way: it carries a password
    expect(Object.keys(res.json ?? {}).sort()).toEqual(["ok", "temporaryPassword"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const temporaryPassword = (res.json as { ok: boolean; temporaryPassword: string }).temporaryPassword;
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    const user = await userRow(member.id);
    expect(await bcrypt.compare(temporaryPassword, user.passwordHash)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(user.tokenVersion).toBe(1);
    expect(await cookieWorks(old)).toBe(false);
    const audits = await db.auditLog.findMany({ where: { action: "org.member_password_reset", target: member.id } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(temporaryPassword);
  });

  it("an ADMIN cannot reset the OWNER's password nor another ADMIN's", async () => {
    const { org, owner, admin } = await makeTeam();
    const otherAdmin = await makeUser({ orgId: org.id, role: "ADMIN" });
    const before = (await userRow(owner.id)).passwordHash;
    await loginAs(admin.id);
    const onOwner = await accountsApi.password(org.id, owner.id);
    expect(onOwner.status).toBe(403);
    expect(reason(onOwner)).toBe("orgm.role_denied");
    expect((await userRow(owner.id)).passwordHash).toBe(before);
    expect((await accountsApi.password(org.id, otherAdmin.id)).status).toBe(403);
  });

  it("POST logout ends every session and changes nothing else", async () => {
    const { org, owner, member } = await makeTeam();
    const before = await userRow(member.id);
    await loginAs(member.id);
    const old = sessionCookie();
    await loginAs(owner.id);
    const res = await accountsApi.logout(org.id, member.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    const after = await userRow(member.id);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(false);
    expect(await cookieWorks(old)).toBe(false);
    // signing in again works normally
    await loginAs(member.id);
    expect(await currentUser()).toMatchObject({ id: member.id, mustChangePassword: false });
    expect(await db.auditLog.count({ where: { action: "org.member_logged_out", target: member.id } })).toBe(1);
  });
});

describe("nobody acts on their own account through these routes", () => {
  it("PATCH, status, password, logout and DELETE on oneself are 403 accounts.self_denied", async () => {
    const { org, owner, admin } = await makeTeam();
    for (const actor of [owner, admin]) {
      await loginAs(actor.id);
      const answers = [
        await accountsApi.update(org.id, actor.id, { name: "Me" }),
        await accountsApi.status(org.id, actor.id, { action: "suspend" }),
        await accountsApi.password(org.id, actor.id),
        await accountsApi.logout(org.id, actor.id),
        await accountsApi.remove(org.id, actor.id),
      ];
      for (const res of answers) {
        expect(res.status).toBe(403);
        expect(reason(res)).toBe("accounts.self_denied");
      }
      expect((await memberRow(org.id, actor.id)).status).toBe("ACTIVE");
      expect((await userRow(actor.id)).tokenVersion).toBe(0);
    }
  });
});
