import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import {
  accountsApi,
  cookieWorks,
  grantCapabilities,
  makeRankTeam,
  memberRow,
  reason,
  sessionCookie,
  userRow,
} from "./accounts-helpers";

/** PATCH /api/organizations/[id]/members/[userId] — editing an existing account. */

describe("editing an account: who may", () => {
  it("nobody edits the OWNER or themselves here", async () => {
    const { org, owner, admin } = await makeTeam();
    await loginAs(owner.id);
    const self = await accountsApi.update(org.id, owner.id, { name: "Boss" });
    expect(self.status).toBe(403);
    expect(reason(self)).toBe("accounts.self_denied");

    await loginAs(admin.id);
    const onOwner = await accountsApi.update(org.id, owner.id, { name: "Not the boss" });
    expect(onOwner.status).toBe(403);
    expect(reason(onOwner)).toBe("orgm.role_denied");
    expect(reason(await accountsApi.update(org.id, admin.id, { jobTitle: "Chief" }))).toBe("accounts.self_denied");
    expect((await userRow(owner.id)).name).toBe("Owner");
  });

  it("an ADMIN cannot touch another ADMIN, a person of another company is not found", async () => {
    const { org, admin } = await makeTeam();
    const otherAdmin = await makeUser({ orgId: org.id, role: "ADMIN", name: "Other admin" });
    const outsider = (await makeTeam()).member;
    await loginAs(admin.id);
    const res = await accountsApi.update(org.id, otherAdmin.id, { name: "Renamed" });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("orgm.role_denied");
    const cross = await accountsApi.update(org.id, outsider.id, { name: "Renamed" });
    expect(cross.status).toBe(404);
    expect(reason(cross)).toBe("orgm.not_member");
  });

  it("an offboarded account is frozen: no edit, no password reset (reactivate first); signing it out stays harmless", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    expect((await accountsApi.status(org.id, member.id, { action: "offboard" })).status).toBe(200);
    for (const body of [{ role: "LEAD" }, { name: "Renamed" }, { capabilities: ["announce.send"] }, { password: "Reset-2026a" }]) {
      const res = await accountsApi.update(org.id, member.id, body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(reason(res), JSON.stringify(body)).toBe("accounts.offboarded_frozen");
    }
    const reset = await accountsApi.password(org.id, member.id);
    expect(reset.status).toBe(409);
    expect(reason(reset)).toBe("accounts.offboarded_frozen");
    expect((await accountsApi.logout(org.id, member.id)).status).toBe(200);
    expect(await memberRow(org.id, member.id)).toMatchObject({ role: "MEMBER", status: "OFFBOARDED", capabilities: [] });

    // a suspended account can still be edited (the owner may fix things before letting them back)
    const other = await makeUser({ orgId: org.id, role: "MEMBER" });
    await accountsApi.status(org.id, other.id, { action: "suspend" });
    expect((await accountsApi.update(org.id, other.id, { role: "LEAD" })).status).toBe(200);
  });

  it("an empty edit is refused", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.update(org.id, member.id, {});
    expect(res.status).toBe(422);
    expect(reason(res)).toBe("orgm.no_change");
  });
});

describe("editing an account: fields", () => {
  it("name, job title (cleared with null) and manager", async () => {
    const { org, owner, admin, member } = await makeTeam();
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, member.id, { name: "Sami K", jobTitle: "مصمم", managerId: admin.id })).status).toBe(200);
    expect((await userRow(member.id)).name).toBe("Sami K");
    expect((await userRow(member.id)).jobTitle).toBe("مصمم");
    expect((await memberRow(org.id, member.id)).managerId).toBe(admin.id);

    expect((await accountsApi.update(org.id, member.id, { jobTitle: null, managerId: null })).status).toBe(200);
    expect((await userRow(member.id)).jobTitle).toBeNull();
    expect((await memberRow(org.id, member.id)).managerId).toBeNull();
  });

  it("a mistyped username or e-mail can be corrected: stored lower-case, still unique, e-mail cleared with null", async () => {
    const { org, owner, admin, member } = await makeTeam();
    await db.user.update({ where: { id: admin.id }, data: { username: `taken.${org.id.slice(-8)}` } });
    await loginAs(owner.id);
    const fixedName = `Sami.Fixed${org.id.slice(-6)}`;
    expect((await accountsApi.update(org.id, member.id, { username: fixedName, email: `Sami.${org.id.slice(-6)}@Example.com` })).status).toBe(200);
    expect(await userRow(member.id)).toMatchObject({
      username: fixedName.toLowerCase(),
      email: `sami.${org.id.slice(-6)}@example.com`,
    });
    // sending the person's own current name back is not a clash
    expect((await accountsApi.update(org.id, member.id, { username: fixedName.toUpperCase(), name: "Sami" })).status).toBe(200);

    const taken = await accountsApi.update(org.id, member.id, { username: `TAKEN.${org.id.slice(-8)}` });
    expect(taken.status).toBe(409);
    expect(reason(taken)).toBe("accounts.username_taken");
    const takenMail = await accountsApi.update(org.id, member.id, { email: admin.email.toUpperCase() });
    expect(takenMail.status).toBe(409);
    expect(reason(takenMail)).toBe("email.taken");
    expect(reason(await accountsApi.update(org.id, member.id, { username: "x" }))).toBe("accounts.username_too_short");

    expect((await accountsApi.update(org.id, member.id, { email: null })).status).toBe(200);
    expect((await userRow(member.id)).email).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "org.member_updated", target: member.id }, orderBy: { createdAt: "asc" } });
    expect(audit.meta).toMatchObject({ fields: expect.arrayContaining(["username", "email"]) });
  });

  it("a manager loop is refused, and so is an inactive or guest manager", async () => {
    const { org, owner, admin, member, guest, lead } = await makeRankTeam();
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, member.id, { managerId: lead.id })).status).toBe(200);
    expect((await accountsApi.update(org.id, lead.id, { managerId: admin.id })).status).toBe(200);
    // admin -> member would make: member -> lead -> admin -> member
    const loop = await accountsApi.update(org.id, admin.id, { managerId: member.id });
    expect(loop.status).toBe(422);
    expect(reason(loop)).toBe("accounts.manager_cycle");
    expect(reason(await accountsApi.update(org.id, member.id, { managerId: member.id }))).toBe("accounts.manager_cycle");
    expect(reason(await accountsApi.update(org.id, member.id, { managerId: guest.id }))).toBe("accounts.manager_invalid");
    expect(reason(await accountsApi.update(org.id, guest.id, { managerId: admin.id }))).toBe("accounts.guest_no_manager");
  });
});

describe("editing an account: rank", () => {
  it("a role change is audited and notified in Arabic", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, member.id, { role: "LEAD" })).status).toBe(200);
    expect((await memberRow(org.id, member.id)).role).toBe("LEAD");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "org.member_role_changed", target: member.id } });
    expect(audit.meta).toEqual({ from: "MEMBER", to: "LEAD" });
    const note = await db.notification.findFirstOrThrow({ where: { userId: member.id, type: "org_role_changed" } });
    expect(`${note.title} ${note.body}`).toMatch(/[؀-ۿ]/);
    expect(note.body).toContain("قائد فريق");
  });

  it("an ADMIN cannot make anybody an ADMIN, nor change an ADMIN", async () => {
    const { org, admin, member } = await makeTeam();
    const otherAdmin = await makeUser({ orgId: org.id, role: "ADMIN" });
    await loginAs(admin.id);
    expect(reason(await accountsApi.update(org.id, member.id, { role: "ADMIN" }))).toBe("orgm.role_denied");
    expect(reason(await accountsApi.update(org.id, otherAdmin.id, { role: "MEMBER" }))).toBe("orgm.role_denied");
    expect(reason(await accountsApi.update(org.id, member.id, { role: "OWNER" }))).toBe("accounts.role_invalid");
    expect((await accountsApi.update(org.id, member.id, { role: "LEAD" })).status).toBe(200);
  });

  it("becoming a GUEST clears capabilities, revoked capabilities and manager, and makes every space row GUEST", async () => {
    const { org, owner, admin, member } = await makeTeam();
    const ws = await makeWorkspace(org.id, [{ userId: member.id, role: "ADMIN" }]);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { capabilities: ["announce.send"], revokedCapabilities: ["crm.edit"], managerId: admin.id },
    });
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, member.id, { role: "GUEST" })).status).toBe(200);
    const row = await memberRow(org.id, member.id);
    expect(row).toMatchObject({ role: "GUEST", capabilities: [], revokedCapabilities: [], managerId: null });
    expect((await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: member.id } })).role).toBe("GUEST");
  });

  it("a GUEST promoted to staff becomes a normal member of the spaces they were already in", async () => {
    const { org, owner, guest } = await makeTeam();
    const ws = await makeWorkspace(org.id, [{ userId: guest.id, role: "GUEST" }]);
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, guest.id, { role: "MEMBER" })).status).toBe(200);
    expect((await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: guest.id } })).role).toBe("MEMBER");
  });
});

describe("editing an account: capabilities", () => {
  it("are replace-lists, kept in catalogue order", async () => {
    const { org, owner, lead } = await makeRankTeam();
    await loginAs(owner.id);
    expect((await accountsApi.update(org.id, lead.id, { capabilities: ["cash.view", "announce.send"], revokedCapabilities: ["crm.edit"] })).status).toBe(200);
    expect(await memberRow(org.id, lead.id)).toMatchObject({ capabilities: ["announce.send", "cash.view"], revokedCapabilities: ["crm.edit"] });
    expect((await accountsApi.update(org.id, lead.id, { capabilities: [] })).status).toBe(200);
    expect(await memberRow(org.id, lead.id)).toMatchObject({ capabilities: [], revokedCapabilities: ["crm.edit"] });
  });

  it("the same capability in both lists is refused, also against the stored other list", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    const both = await accountsApi.update(org.id, member.id, { capabilities: ["cash.view"], revokedCapabilities: ["cash.view"] });
    expect(both.status).toBe(422);
    expect(reason(both)).toBe("accounts.cap_both_lists");
    await accountsApi.update(org.id, member.id, { capabilities: ["cash.view"] });
    const later = await accountsApi.update(org.id, member.id, { revokedCapabilities: ["cash.view"] });
    expect(later.status).toBe(422);
    expect(reason(later)).toBe("accounts.cap_both_lists");
  });

  it("nobody grants or takes away a capability they do not hold; an owner's grant survives an admin's edit", async () => {
    const { org, owner, admin, member } = await makeTeam();
    await loginAs(owner.id);
    await accountsApi.update(org.id, member.id, { capabilities: ["cash.view"] });

    await loginAs(admin.id);
    const grant = await accountsApi.update(org.id, member.id, { capabilities: ["cash.view", "penalties.view"] });
    expect(grant.status).toBe(403);
    expect(reason(grant)).toBe("accounts.cap_not_held");
    const takeAway = await accountsApi.update(org.id, member.id, { capabilities: [] });
    expect(takeAway.status).toBe(403);
    expect(reason(takeAway)).toBe("accounts.cap_not_held");
    // adding something the admin holds, sending the owner's grant back unchanged, is fine
    expect((await accountsApi.update(org.id, member.id, { capabilities: ["cash.view", "announce.send"] })).status).toBe(200);
    expect((await memberRow(org.id, member.id)).capabilities).toEqual(["announce.send", "cash.view"]);
  });

  it("a guest is given no capability, and archive.view is never granted", async () => {
    const { org, owner, guest, member } = await makeTeam();
    await loginAs(owner.id);
    const toGuest = await accountsApi.update(org.id, guest.id, { capabilities: ["crm.view"] });
    expect(toGuest.status).toBe(403);
    expect(reason(toGuest)).toBe("accounts.cap_not_for_guests");
    const archive = await accountsApi.update(org.id, member.id, { capabilities: ["archive.view"] });
    expect(archive.status).toBe(403);
    expect(reason(archive)).toBe("accounts.cap_owner_only");
    const revokeArchive = await accountsApi.update(org.id, member.id, { revokedCapabilities: ["archive.view"] });
    expect(revokeArchive.status).toBe(403);
    expect((await memberRow(org.id, member.id)).capabilities).toEqual([]);
  });

  it("an extra users.manage lets a LEAD manage the capabilities of the people below them that they hold, nothing more", async () => {
    const { org, member, lead } = await makeRankTeam();
    const peer = await makeUser({ orgId: org.id, role: "LEAD" });
    await grantCapabilities(org.id, lead.id, ["users.manage"]);
    await loginAs(lead.id);
    expect((await accountsApi.update(org.id, member.id, { capabilities: ["users.manage", "prices.view"] })).status).toBe(200);
    expect(reason(await accountsApi.update(org.id, member.id, { capabilities: ["users.manage", "prices.view", "cash.view"] }))).toBe(
      "accounts.cap_not_held",
    );
    // a peer LEAD is not below them
    expect(reason(await accountsApi.update(org.id, peer.id, { capabilities: ["users.manage"] }))).toBe("orgm.role_denied");
  });
});

describe("editing an account: password", () => {
  it("resets to the given temporary password: must change it, every old session ends, audited without the password", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(member.id);
    const old = sessionCookie();
    await loginAs(owner.id);
    const res = await accountsApi.update(org.id, member.id, { password: "Reset-2026a" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    const user = await userRow(member.id);
    expect(await bcrypt.compare("Reset-2026a", user.passwordHash)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(user.tokenVersion).toBe(1);
    expect(await cookieWorks(old)).toBe(false);
    const audits = await db.auditLog.findMany({ where: { action: "org.member_password_reset", target: member.id } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("Reset-2026a");
  });

  it("a weak password is refused and nothing changes", async () => {
    const { org, owner, member } = await makeTeam();
    const before = (await userRow(member.id)).passwordHash;
    await loginAs(owner.id);
    const res = await accountsApi.update(org.id, member.id, { password: "short1" });
    expect(res.status).toBe(422);
    expect(reason(res)).toBe("accounts.password_min8");
    expect((await userRow(member.id)).passwordHash).toBe(before);
  });
});
