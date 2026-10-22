import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import * as notificationsRoute from "@/app/api/notifications/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import {
  accountsApi,
  failWritesWhere,
  grantCapabilities,
  makeRankTeam,
  memberRow,
  reason,
  userRow,
  username,
} from "./accounts-helpers";

/** POST /api/organizations/[id]/members — the owner (or an admin below him) creates an account. */

describe("creating an account: username, temporary password, onboarding", () => {
  it("without a password the server makes a temporary one, returns it once, and the account must change it", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "Sami Khalil", username: "Sami.K" + org.id.slice(-6), role: "MEMBER" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = res.json as { userId: string; username: string; temporaryPassword?: string };
    expect(Object.keys(body).sort()).toEqual(["temporaryPassword", "userId", "username"]);
    expect(body.username).toBe(("sami.k" + org.id.slice(-6)).toLowerCase());
    expect(body.temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/);

    const user = await userRow(body.userId);
    expect(user.username).toBe(body.username);
    expect(user.email).toBeNull();
    expect(user.mustChangePassword).toBe(true);
    expect(user.transparencyVersion).toBeNull();
    expect(await bcrypt.compare(body.temporaryPassword as string, user.passwordHash)).toBe(true);
    // the answer never carries the hash, the session version or the word itself
    expect(res.text).not.toContain(user.passwordHash);
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("tokenVersion");

    const member = await memberRow(org.id, body.userId);
    expect(member.role).toBe("MEMBER");
    expect(member.status).toBe("ACTIVE");

    // audited with role and username, never with the password
    const audits = await db.auditLog.findMany({ where: { action: "org.member_added", target: body.userId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toEqual({ role: "MEMBER", username: body.username });
    expect(JSON.stringify(audits)).not.toContain(body.temporaryPassword as string);

    // the welcome notification is in Arabic and names the company
    const welcome = await db.notification.findFirstOrThrow({ where: { userId: body.userId, type: "welcome" } });
    expect(welcome.title).toContain(org.name);
    expect(welcome.title).toMatch(/[؀-ۿ]/);
    expect(welcome.body ?? "").toMatch(/[؀-ۿ]/);

    // the new person signs in, but the app waits for a password change first
    await loginAs(body.userId);
    const blocked = await call(notificationsRoute.GET);
    expect(blocked.status).toBe(403);
    expect(blocked.json?.["message"]).toBe("auth.onboarding_required");
  });

  it("a password chosen by the owner is the temporary password: it is used, never echoed back, and must be changed", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "Rana", username: username("rana"), password: "Start-2026x" });
    expect(res.status).toBe(201);
    expect(res.json).not.toHaveProperty("temporaryPassword");
    const user = await userRow((res.json as { userId: string }).userId);
    expect(await bcrypt.compare("Start-2026x", user.passwordHash)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(res.text).not.toContain("Start-2026x");
  });

  it("a weak chosen password is refused with the policy's own key", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const short = await accountsApi.create(org.id, { name: "Rana", username: username(), password: "ab1" });
    expect(short.status).toBe(422);
    expect(reason(short)).toBe("accounts.password_min8");
    const noDigit = await accountsApi.create(org.id, { name: "Rana", username: username(), password: "abcdefghij" });
    expect(reason(noDigit)).toBe("accounts.password_digit");
  });

  it("usernames are unique across every organization, whatever the letter case", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    const name = username("nour");
    await loginAs(a.owner.id);
    expect((await accountsApi.create(a.org.id, { name: "Nour", username: name })).status).toBe(201);
    await loginAs(b.owner.id);
    const clash = await accountsApi.create(b.org.id, { name: "Nour 2", username: name.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(reason(clash)).toBe("accounts.username_taken");

    // an older row stored with capitals still counts
    const legacy = `Legacy.${a.org.id.slice(-8)}`;
    await makeUser({ username: legacy });
    const again = await accountsApi.create(b.org.id, { name: "Legacy", username: legacy.toLowerCase() });
    expect(again.status).toBe(409);
    expect(reason(again)).toBe("accounts.username_taken");
  });

  it("a malformed username is refused", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    for (const bad of ["ab", ".dot", "with space", "أحمد", "a@b.co"]) {
      const res = await accountsApi.create(org.id, { name: "Bad", username: bad });
      expect(res.status, bad).toBe(422);
      expect(reason(res), bad).toMatch(/^accounts\.username_/);
    }
    expect(reason(await accountsApi.create(org.id, { name: "No username" }))).toMatch(/^accounts\.username_/);
  });

  it("e-mail is optional, stored lower-case and unique", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const mail = `Sami.${org.id.slice(-8)}@Example.COM`;
    const res = await accountsApi.create(org.id, { name: "Sami", username: username(), email: mail });
    expect(res.status).toBe(201);
    expect((await userRow((res.json as { userId: string }).userId)).email).toBe(mail.toLowerCase());

    const clash = await accountsApi.create(org.id, { name: "Sami 2", username: username(), email: mail.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(reason(clash)).toBe("email.taken");

    const bad = await accountsApi.create(org.id, { name: "Sami 3", username: username(), email: "not-an-address" });
    expect(bad.status).toBe(422);
    expect(reason(bad)).toBe("accounts.email_invalid");

    // an empty field from a form means "no e-mail"
    const blank = await accountsApi.create(org.id, { name: "Sami 4", username: username(), email: "" });
    expect(blank.status).toBe(201);
  });

  it("the role defaults to MEMBER, the name and job title are checked, and an OWNER is never created", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "  Huda  ", username: username(), jobTitle: "محاسبة" });
    expect(res.status).toBe(201);
    const id = (res.json as { userId: string }).userId;
    expect((await memberRow(org.id, id)).role).toBe("MEMBER");
    const user = await userRow(id);
    expect(user.name).toBe("Huda");
    expect(user.jobTitle).toBe("محاسبة");

    const ownerRole = await accountsApi.create(org.id, { name: "Second owner", username: username(), role: "OWNER" });
    expect(ownerRole.status).toBe(422);
    expect(reason(ownerRole)).toBe("accounts.role_invalid");
    expect(reason(await accountsApi.create(org.id, { name: "X", username: username() }))).toBe("accounts.name_too_short");
    expect(reason(await accountsApi.create(org.id, { name: "Long title", username: username(), jobTitle: "x".repeat(81) }))).toBe(
      "accounts.job_title_too_long",
    );
  });
});

describe("creating an account: who may create which rank", () => {
  it("an ADMIN creates LEAD, MEMBER and GUEST accounts but never an ADMIN", async () => {
    const { org, admin } = await makeTeam();
    await loginAs(admin.id);
    const name = username("admin2");
    const res = await accountsApi.create(org.id, { name: "Second admin", username: name, role: "ADMIN" });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("orgm.role_denied");
    expect(await db.user.findFirst({ where: { username: name } })).toBeNull();
    for (const role of ["LEAD", "MEMBER", "GUEST"]) {
      expect((await accountsApi.create(org.id, { name: `New ${role}`, username: username(), role })).status, role).toBe(201);
    }
  });

  it("only the OWNER creates an ADMIN", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "New admin", username: username(), role: "ADMIN" });
    expect(res.status).toBe(201);
    expect((await memberRow(org.id, (res.json as { userId: string }).userId)).role).toBe("ADMIN");
  });

  it("a MEMBER holding users.manage creates GUEST accounts only (nothing at or above their own rank); a plain MEMBER is refused", async () => {
    const { org, member } = await makeTeam();
    await loginAs(member.id);
    const plain = await accountsApi.create(org.id, { name: "Nope", username: username(), role: "GUEST" });
    expect(plain.status).toBe(403);
    expect(reason(plain)).toBe("insufficient_role");

    await grantCapabilities(org.id, member.id, ["users.manage"]);
    expect((await accountsApi.create(org.id, { name: "Partner", username: username(), role: "GUEST" })).status).toBe(201);
    for (const role of ["MEMBER", "LEAD", "ADMIN"]) {
      const res = await accountsApi.create(org.id, { name: `No ${role}`, username: username(), role });
      expect(res.status, role).toBe(403);
      expect(reason(res), role).toBe("orgm.role_denied");
    }
  });

  it("a guest, and a caller from another organization, cannot create anybody here", async () => {
    const { org, guest } = await makeTeam();
    const other = await makeTeam();
    await loginAs(guest.id);
    expect((await accountsApi.create(org.id, { name: "Nope", username: username() })).status).toBe(403);
    await loginAs(other.owner.id);
    const cross = await accountsApi.create(org.id, { name: "Nope", username: username() });
    expect(cross.status).toBe(403);
    expect(reason(cross)).toBe("not_org_member");
  });
});

describe("creating an account: capabilities", () => {
  it("the OWNER switches on any capability except archive.view", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "Cashier", username: username(), capabilities: ["cash.view", "announce.send"] });
    expect(res.status).toBe(201);
    expect((await memberRow(org.id, (res.json as { userId: string }).userId)).capabilities).toEqual(["announce.send", "cash.view"]);

    const archive = await accountsApi.create(org.id, { name: "Archivist", username: username(), capabilities: ["archive.view"] });
    expect(archive.status).toBe(403);
    expect(reason(archive)).toBe("accounts.cap_owner_only");
  });

  it("nobody grants a capability they do not hold themselves", async () => {
    const { org, admin } = await makeTeam();
    await loginAs(admin.id);
    const name = username("cash");
    const res = await accountsApi.create(org.id, { name: "Cashier", username: name, capabilities: ["cash.view"] });
    expect(res.status).toBe(403);
    expect(reason(res)).toBe("accounts.cap_not_held");
    expect(await db.user.findFirst({ where: { username: name } })).toBeNull();
    // what the admin does hold is fine
    expect((await accountsApi.create(org.id, { name: "Announcer", username: username(), capabilities: ["announce.send"] })).status).toBe(201);
  });

  it("a guest account is given no capability at all, and an unknown name is refused", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const guest = await accountsApi.create(org.id, { name: "Partner", username: username(), role: "GUEST", capabilities: ["crm.view"] });
    expect(guest.status).toBe(403);
    expect(reason(guest)).toBe("accounts.cap_not_for_guests");
    const unknown = await accountsApi.create(org.id, { name: "Who", username: username(), capabilities: ["root.everything"] });
    expect(unknown.status).toBe(422);
    expect(reason(unknown)).toBe("accounts.cap_unknown");
  });
});

describe("creating an account: spaces and manager", () => {
  it("the OWNER puts the new person into any space of the company: MEMBER rows, GUEST rows for a guest", async () => {
    const { org, owner } = await makeTeam();
    const ws1 = await makeWorkspace(org.id);
    const ws2 = await makeWorkspace(org.id);
    await loginAs(owner.id);
    const res = await accountsApi.create(org.id, { name: "Designer", username: username(), workspaceIds: [ws1.id, ws2.id, ws1.id] });
    expect(res.status).toBe(201);
    const rows = await db.workspaceMember.findMany({ where: { userId: (res.json as { userId: string }).userId } });
    expect(rows.map((r) => [r.workspaceId, r.role]).sort()).toEqual([[ws1.id, "MEMBER"], [ws2.id, "MEMBER"]].sort());

    const partner = await accountsApi.create(org.id, { name: "Partner", username: username(), role: "GUEST", workspaceIds: [ws1.id] });
    const guestRows = await db.workspaceMember.findMany({ where: { userId: (partner.json as { userId: string }).userId } });
    expect(guestRows.map((r) => r.role)).toEqual(["GUEST"]);
  });

  it("anybody else may only use their own spaces, and a space of another company is refused", async () => {
    const { org, admin } = await makeTeam();
    const mine = await makeWorkspace(org.id, [{ userId: admin.id }]);
    const notMine = await makeWorkspace(org.id);
    const foreign = await makeWorkspace((await makeTeam()).org.id);
    await loginAs(admin.id);

    const denied = await accountsApi.create(org.id, { name: "Dev", username: username(), workspaceIds: [mine.id, notMine.id] });
    expect(denied.status).toBe(403);
    expect(reason(denied)).toBe("accounts.workspace_denied");
    const invalid = await accountsApi.create(org.id, { name: "Dev", username: username(), workspaceIds: [foreign.id] });
    expect(invalid.status).toBe(422);
    expect(reason(invalid)).toBe("accounts.workspace_invalid");
    expect((await accountsApi.create(org.id, { name: "Dev", username: username(), workspaceIds: [mine.id] })).status).toBe(201);
  });

  it("the manager must be an ACTIVE, non-guest member of the same company; a guest has none", async () => {
    const { org, owner, admin, member, guest } = await makeTeam();
    const outsider = (await makeTeam()).member;
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { status: "SUSPENDED" },
    });
    await loginAs(owner.id);
    const ok = await accountsApi.create(org.id, { name: "Junior", username: username(), managerId: admin.id });
    expect(ok.status).toBe(201);
    expect((await memberRow(org.id, (ok.json as { userId: string }).userId)).managerId).toBe(admin.id);

    for (const managerId of [guest.id, member.id, outsider.id, "no-such-user"]) {
      const res = await accountsApi.create(org.id, { name: "Junior", username: username(), managerId });
      expect(res.status, managerId).toBe(422);
      expect(reason(res), managerId).toBe("accounts.manager_invalid");
    }
    const guestWithManager = await accountsApi.create(org.id, { name: "Partner", username: username(), role: "GUEST", managerId: admin.id });
    expect(guestWithManager.status).toBe(422);
    expect(reason(guestWithManager)).toBe("accounts.guest_no_manager");
  });

  it("the account, its membership and its space rows are written in ONE transaction", async () => {
    const { org, owner } = await makeRankTeam();
    const ws = await makeWorkspace(org.id);
    const restore = await failWritesWhere("WorkspaceMember", "workspaceId", ws.id);
    try {
      await loginAs(owner.id);
      const name = username("atomic");
      const res = await accountsApi.create(org.id, { name: "Atomic", username: name, workspaceIds: [ws.id] });
      expect(res.status).toBeGreaterThanOrEqual(400);
      // the space row failed last: no user, no membership was left behind
      expect(await db.user.findFirst({ where: { username: name } })).toBeNull();
      expect(await db.auditLog.count({ where: { action: "org.member_added", meta: { path: ["username"], equals: name } } })).toBe(0);
    } finally {
      await restore();
    }
  });
});
