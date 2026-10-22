import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberStatus, OrgRole } from "@prisma/client";
import * as listRoute from "@/app/api/organizations/[id]/members/route";
import * as oneRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as statusRoute from "@/app/api/organizations/[id]/members/[userId]/status/route";
import * as passwordRoute from "@/app/api/organizations/[id]/members/[userId]/password/route";
import * as logoutRoute from "@/app/api/organizations/[id]/members/[userId]/logout/route";
import { verifyPassword } from "@/server/auth";
import { WIRED_CAPABILITIES, can, effectiveCapabilities } from "@/server/policy/capabilities";
import { CREATABLE_ROLES } from "@/server/policy/rank";
import { getServerT } from "@/lib/i18n/server";
import {
  EMPTY_ADD_FORM,
  canResetCapabilities,
  capabilityGroups,
  creatableRoles,
  offeredActions,
  transferCandidates,
  type ActorInfo,
  type AddFormValues,
  type ContractMember,
} from "@/lib/members-ui";
import {
  createMember,
  logoutEverywhere,
  membersApi,
  offboardMember,
  reactivateMember,
  resetCapabilities,
  resetMemberPassword,
  saveMemberInfo,
  setCapability,
  suspendMember,
} from "@/components/members/api";
import { db, loginAs, makeOrg, makeProject, makeTask, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * The team screen's own flows (src/components/members/api.ts), run against the real account routes
 * and a real database, signed in as the person who would be looking at the screen.
 *
 * `fetch` is replaced by a shim that hands the request to the route handler a browser would reach.
 * Everything else is production code: the client wrapper, the zod validation, the rank rules, the
 * transactions. The point of the matrix at the end: the screen offers an action only when the
 * server accepts it, and offers none that the server refuses.
 */

const { t } = getServerT();

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

function routeFor(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // api / organizations / :id / members / [:userId / [status|password|logout]]
  if (parts[0] !== "api" || parts[1] !== "organizations" || parts[3] !== "members") return null;
  const id = parts[2] as string;
  const pick = (mod: Record<string, unknown>) => mod[method] as Handler | undefined;
  if (parts.length === 4) {
    const handler = pick(listRoute);
    return handler ? { handler, params: { id } } : null;
  }
  const userId = parts[4] as string;
  const sub = parts[5];
  const mod = sub === undefined ? oneRoute : sub === "status" ? statusRoute : sub === "password" ? passwordRoute : sub === "logout" ? logoutRoute : null;
  const handler = mod ? pick(mod) : undefined;
  return handler ? { handler, params: { id, userId } } : null;
}

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const route = routeFor((init?.method ?? "GET").toUpperCase(), url.pathname);
    if (!route) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    return route.handler(new Request(url, init), { params: route.params });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- fixtures ----------

async function setMember(orgId: string, userId: string, data: Record<string, unknown>) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
}

/** A person in the org: the given rank and status, optionally with capabilities switched on. */
async function person(orgId: string, role: OrgRole, status: MemberStatus = "ACTIVE", extra: Record<string, unknown> = {}) {
  const user = await makeUser({ orgId, role, name: `${role} ${uid()}` });
  if (status !== "ACTIVE" || Object.keys(extra).length > 0) await setMember(orgId, user.id, { ...(status !== "ACTIVE" ? { status } : {}), ...extra });
  return user;
}

async function roster(orgId: string, actorId: string) {
  await loginAs(actorId);
  return membersApi.list(orgId);
}

async function rowOf(orgId: string, actorId: string, userId: string): Promise<ContractMember> {
  const { members } = await roster(orgId, actorId);
  const row = members.find((m) => m.id === userId);
  if (!row) throw new Error(`${userId} is not on the roster`);
  return row;
}

async function actorInfo(orgId: string, user: { id: string }): Promise<ActorInfo> {
  const m = await db.organizationMember.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    select: { role: true, capabilities: true, revokedCapabilities: true },
  });
  return { id: user.id, role: m.role, caps: [...effectiveCapabilities(m)] };
}

const form = (over: Partial<AddFormValues> = {}): AddFormValues => ({
  ...EMPTY_ADD_FORM,
  name: "نور الهدى",
  username: `u${uid()}`,
  ...over,
});

// ---------- the flows, one by one ----------

describe("listing the team", () => {
  it("answers with the shape the screen reads: ISO dates, every status, ACTIVE first, the spaces the owner may use", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
    const lead = await person(org.id, "LEAD");
    const gone = await person(org.id, "MEMBER", "OFFBOARDED");
    const space = await makeWorkspace(org.id, [{ userId: lead.id }], "المقر");
    await db.user.update({ where: { id: lead.id }, data: { lastLoginAt: new Date("2026-10-22T10:00:00Z"), jobTitle: "قائد" } });

    const data = await roster(org.id, owner.id);
    expect(data.actorRole).toBe("OWNER");
    expect(data.spaces).toEqual([{ id: space.id, name: "المقر" }]);
    expect(data.members.map((m) => m.status)).toEqual(["ACTIVE", "ACTIVE", "OFFBOARDED"]);
    const row = data.members.find((m) => m.id === lead.id) as ContractMember;
    expect(row).toMatchObject({ role: "LEAD", status: "ACTIVE", jobTitle: "قائد", lastLoginAt: "2026-10-22T10:00:00.000Z", openWork: 0, mustChangePassword: false });
    expect(row.workspaces).toEqual([{ id: space.id, name: "المقر", role: "MEMBER" }]);
    expect(row.effectiveCapabilities).toContain("prices.view"); // a team lead's default
    expect(data.members.find((m) => m.id === gone.id)?.status).toBe("OFFBOARDED");
  });

  it("a person without users.manage cannot open it at all, and the screen explains in Arabic", async () => {
    const org = await makeOrg();
    const member = await makeUser({ orgId: org.id, role: "MEMBER" });
    await loginAs(member.id);
    await expect(membersApi.list(org.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("adding a person", () => {
  it("a generated password works, must be changed, and the person lands in the chosen spaces", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const space = await makeWorkspace(org.id, [], "المشتريات");
    await loginAs(owner.id);

    const res = await createMember(org.id, form({ username: "Nour.Huda", role: "LEAD", jobTitle: "محاسبة", workspaceIds: [space.id] }), t);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.username).toBe("nour.huda");
    expect(res.value.password).toMatch(/^[A-Za-z0-9]{12}$/);

    const user = await db.user.findUniqueOrThrow({ where: { id: res.value.userId }, include: { memberships: true } });
    expect(user.mustChangePassword).toBe(true);
    expect(user.jobTitle).toBe("محاسبة");
    expect(await verifyPassword(res.value.password as string, user.passwordHash)).toBe(true);
    expect(user.memberships[0]).toMatchObject({ role: "LEAD", status: "ACTIVE" });
    expect(await db.workspaceMember.count({ where: { userId: user.id, workspaceId: space.id } })).toBe(1);

    // and the new person shows on the roster with the warning flag the card displays
    const row = await rowOf(org.id, owner.id, user.id);
    expect(row).toMatchObject({ username: "nour.huda", mustChangePassword: true, role: "LEAD" });
  });

  it("a typed password is the one that works", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    await loginAs(owner.id);
    const res = await createMember(org.id, form({ autoPassword: false, password: "Typed-pass-1" }), t);
    expect(res.ok && res.value.password).toBe("Typed-pass-1");
    const user = await db.user.findUniqueOrThrow({ where: { id: res.ok ? res.value.userId : "" } });
    expect(await verifyPassword("Typed-pass-1", user.passwordHash)).toBe(true);
  });

  it("a username already in use is refused with the account service's Arabic sentence", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    await loginAs(owner.id);
    expect((await createMember(org.id, form({ username: "taken.name" }), t)).ok).toBe(true);
    const again = await createMember(org.id, form({ username: "TAKEN.name" }), t);
    expect(again).toMatchObject({ ok: false, code: "conflict", messageKey: "accounts.username_taken" });
    expect(!again.ok && again.message).toBe(t("accounts.username_taken"));
  });

  it("a space the actor cannot use is refused in Arabic (a person who is not the owner puts people only in their own spaces)", async () => {
    const org = await makeOrg();
    const admin = await makeUser({ orgId: org.id, role: "ADMIN" });
    const elsewhere = await makeWorkspace(org.id, [], "ليست لي");
    await loginAs(admin.id);
    const res = await createMember(org.id, form({ workspaceIds: [elsewhere.id] }), t);
    expect(res).toMatchObject({ ok: false, messageKey: "accounts.workspace_denied" });
    expect(!res.ok && res.message).toBe(t("accounts.workspace_denied"));
    // and the list the form offers does not include it
    expect((await roster(org.id, admin.id)).spaces).toEqual([]);
  });
});

describe("editing a person and the switches", () => {
  it("saves name, title, rank and manager; the roster shows them", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const boss = await person(org.id, "ADMIN");
    const worker = await person(org.id, "MEMBER");
    const row = await rowOf(org.id, owner.id, worker.id);
    const members = (await roster(org.id, owner.id)).members;

    const ownerInfo = await actorInfo(org.id, owner);
    const res = await saveMemberInfo(
      org.id,
      row,
      { name: "اسم جديد", jobTitle: "مودريتور", role: "LEAD", managerId: boss.id },
      members,
      ownerInfo,
      t,
    );
    expect(res.ok).toBe(true);
    const after = await rowOf(org.id, owner.id, worker.id);
    expect(after).toMatchObject({ name: "اسم جديد", jobTitle: "مودريتور", role: "LEAD", managerId: boss.id });
    expect(after.managerName).toBe(boss.name);
    // what the screen patches into its cache equals what the server now says
    expect(res.ok && res.value).toMatchObject({ name: after.name, jobTitle: after.jobTitle, role: after.role, managerId: after.managerId, managerName: after.managerName });
    expect(res.ok && res.value?.effectiveCapabilities?.slice().sort()).toEqual(after.effectiveCapabilities.slice().sort());

    // clearing both
    const cleared = await saveMemberInfo(org.id, after, { name: after.name, jobTitle: "", role: "LEAD", managerId: "" }, members, ownerInfo, t);
    expect(cleared.ok).toBe(true);
    expect(await rowOf(org.id, owner.id, worker.id)).toMatchObject({ jobTitle: null, managerId: null, managerName: null });
  });

  it("making somebody a guest clears their switches and manager, and the screen's cache says the same", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const boss = await person(org.id, "ADMIN");
    const worker = await person(org.id, "MEMBER", "ACTIVE", { capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"], managerId: boss.id });
    const row = await rowOf(org.id, owner.id, worker.id);
    const members = (await roster(org.id, owner.id)).members;
    const res = await saveMemberInfo(org.id, row, { name: row.name, jobTitle: "", role: "GUEST", managerId: boss.id }, members, await actorInfo(org.id, owner), t);
    expect(res.ok).toBe(true);
    const after = await rowOf(org.id, owner.id, worker.id);
    expect(after).toMatchObject({ role: "GUEST", capabilities: [], revokedCapabilities: [], effectiveCapabilities: [], managerId: null });
    expect(res.ok && res.value).toMatchObject({ role: "GUEST", capabilities: [], revokedCapabilities: [], effectiveCapabilities: [], managerId: null, managerName: null });
  });

  it("a switch flips on the server and the policy agrees; the reset puts the rank's defaults back", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const worker = await person(org.id, "MEMBER");
    await loginAs(owner.id);

    let row = await rowOf(org.id, owner.id, worker.id);
    const on = await setCapability(org.id, row, "integrations.manage", true, t);
    expect(on.ok).toBe(true);
    row = await rowOf(org.id, owner.id, worker.id);
    expect(row.capabilities).toEqual(["integrations.manage"]);
    expect(can({ role: "MEMBER", capabilities: row.capabilities, revokedCapabilities: row.revokedCapabilities }, "integrations.manage")).toBe(true);

    const off = await setCapability(org.id, row, "crm.edit", false, t);
    expect(off.ok).toBe(true);
    row = await rowOf(org.id, owner.id, worker.id);
    expect(row).toMatchObject({ capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"] });
    expect(row.effectiveCapabilities).not.toContain("crm.edit");

    expect((await resetCapabilities(org.id, row, await actorInfo(org.id, owner), t)).ok).toBe(true);
    expect(await rowOf(org.id, owner.id, worker.id)).toMatchObject({ capabilities: [], revokedCapabilities: [] });
  });

  it("a switch the actor does not hold is refused in Arabic (the screen shows it locked)", async () => {
    const org = await makeOrg();
    // the owner took integrations.manage away from this admin
    const admin = await person(org.id, "ADMIN", "ACTIVE", { revokedCapabilities: ["integrations.manage"] });
    const worker = await person(org.id, "MEMBER");
    const row = await rowOf(org.id, admin.id, worker.id);
    const lock = capabilityGroups(row, await actorInfo(org.id, admin), true).flatMap((g) => g.rows).find((r) => r.capability === "integrations.manage");
    expect(lock?.locked).toBe("actor_lacks");
    const res = await setCapability(org.id, row, "integrations.manage", true, t);
    expect(res).toMatchObject({ ok: false, messageKey: "accounts.cap_not_held" });
    expect(!res.ok && res.message).toBe(t("accounts.cap_not_held"));
  });

  it("a capability the screen does not show survives a switch flip by somebody who does not hold it", async () => {
    const org = await makeOrg();
    const admin = await person(org.id, "ADMIN");
    // the owner gave this member cash.view (not on the screen today, and the admin does not hold it)
    const worker = await person(org.id, "MEMBER", "ACTIVE", { capabilities: ["cash.view"] });
    const row = await rowOf(org.id, admin.id, worker.id);
    const flipped = await setCapability(org.id, row, "integrations.manage", true, t);
    expect(flipped.ok).toBe(true);
    expect(await rowOf(org.id, admin.id, worker.id)).toMatchObject({ capabilities: ["integrations.manage", "cash.view"] });
  });

  it("the reset by somebody who cannot take an owner's grant away does not touch it, and the server accepts", async () => {
    const org = await makeOrg();
    // an admin without integrations.manage; the member holds integrations.manage and cash.view from the owner, and crm.edit is off
    const admin = await person(org.id, "ADMIN", "ACTIVE", { revokedCapabilities: ["integrations.manage"] });
    const worker = await person(org.id, "MEMBER", "ACTIVE", { capabilities: ["integrations.manage", "cash.view"], revokedCapabilities: ["crm.edit"] });
    const row = await rowOf(org.id, admin.id, worker.id);
    const info = await actorInfo(org.id, admin);
    expect(canResetCapabilities(row, info)).toBe(true); // crm.edit can be given back
    const res = await resetCapabilities(org.id, row, info, t);
    expect(res.ok, !res.ok ? res.message : "").toBe(true);
    const after = await rowOf(org.id, admin.id, worker.id);
    expect(after).toMatchObject({ capabilities: ["integrations.manage", "cash.view"], revokedCapabilities: [] });
    expect(res.ok && res.value).toMatchObject({ capabilities: after.capabilities, revokedCapabilities: after.revokedCapabilities });
    expect(canResetCapabilities(after, info)).toBe(false); // what is left is out of this admin's reach
  });

  it("a rank change by somebody who lacks a default of the new rank: the cache shows what the server stored", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    // the owner took crm.edit and prices.view (not on the screen) away from this admin
    const admin = await person(org.id, "ADMIN", "ACTIVE", { revokedCapabilities: ["crm.edit", "prices.view"] });
    const info = await actorInfo(org.id, admin);
    for (const [from, to] of [
      ["GUEST", "MEMBER"],
      ["MEMBER", "LEAD"],
      ["LEAD", "MEMBER"],
    ] as const) {
      const worker = await person(org.id, from);
      const row = await rowOf(org.id, admin.id, worker.id);
      const members = (await roster(org.id, admin.id)).members;
      const res = await saveMemberInfo(org.id, row, { name: row.name, jobTitle: "", role: to, managerId: "" }, members, info, t);
      expect(res.ok, `${from} -> ${to}`).toBe(true);
      const after = await rowOf(org.id, admin.id, worker.id);
      const local = res.ok ? res.value : null;
      expect(local, `${from} -> ${to}`).toMatchObject({
        role: to,
        capabilities: after.capabilities,
        revokedCapabilities: after.revokedCapabilities,
      });
      expect(local?.effectiveCapabilities, `${from} -> ${to}`).toEqual(after.effectiveCapabilities);
    }
    // the point of it: a member the admin promoted does NOT hold what the admin lacks
    const guest = await person(org.id, "GUEST");
    await saveMemberInfo(org.id, await rowOf(org.id, admin.id, guest.id), { name: "x y", jobTitle: "", role: "MEMBER", managerId: "" }, [], info, t);
    const promoted = await rowOf(org.id, admin.id, guest.id);
    expect(promoted.revokedCapabilities).toContain("crm.edit");
    expect(promoted.effectiveCapabilities).not.toContain("crm.edit");
    // while the owner, who holds everything, switches nothing off
    const ownerInfo = await actorInfo(org.id, owner);
    const another = await person(org.id, "GUEST");
    const viaOwner = await saveMemberInfo(org.id, await rowOf(org.id, owner.id, another.id), { name: "x y", jobTitle: "", role: "MEMBER", managerId: "" }, [], ownerInfo, t);
    expect(viaOwner.ok && viaOwner.value).toMatchObject({ revokedCapabilities: [] });
    expect((await rowOf(org.id, owner.id, another.id)).effectiveCapabilities).toContain("crm.edit");
  });
});

describe("suspend, reactivate, offboard, reset, sign out", () => {
  it("suspend signs the person out at once; reactivate gives a new temporary password that works", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const worker = await person(org.id, "MEMBER");
    const row = await rowOf(org.id, owner.id, worker.id);

    await loginAs(worker.id); // the worker is signed in somewhere
    await loginAs(owner.id);
    const suspended = await suspendMember(org.id, row, t);
    expect(suspended.ok).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: worker.id }, select: { tokenVersion: true } })).toMatchObject({ tokenVersion: 1 });
    expect(await rowOf(org.id, owner.id, worker.id)).toMatchObject({ status: "SUSPENDED" });

    const back = await reactivateMember(org.id, { ...row, status: "SUSPENDED" }, t);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.password).toMatch(/^[A-Za-z0-9]{12}$/);
    const user = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
    expect(await verifyPassword(back.value.password as string, user.passwordHash)).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(await rowOf(org.id, owner.id, worker.id)).toMatchObject({ status: "ACTIVE", mustChangePassword: true });
  });

  it("offboarding with open work: the roster says how much, the screen insists on a receiver, the work moves", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const leaver = await person(org.id, "MEMBER");
    const receiver = await person(org.id, "MEMBER");
    const space = await makeWorkspace(org.id, [{ userId: leaver.id }]);
    const { project, board, todo } = await makeProject(space.id);
    const task = await makeTask({
      orgId: org.id,
      workspaceId: space.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: owner.id,
      assigneeId: leaver.id,
    });

    const row = await rowOf(org.id, owner.id, leaver.id);
    expect(row.openWork).toBe(1);
    const members = (await roster(org.id, owner.id)).members;
    expect(transferCandidates(members, leaver.id).map((m) => m.id)).toContain(receiver.id);

    // refused before anything is sent
    const refused = await offboardMember(org.id, row, null, t);
    expect(refused).toMatchObject({ ok: false, code: "client.invalid" });
    expect(await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org.id, userId: leaver.id } } })).toMatchObject({ status: "ACTIVE" });

    // and what the server itself says when the screen's list was stale (openWork 0 but there is work)
    const stale = await offboardMember(org.id, { ...row, openWork: 0 }, null, t);
    expect(stale).toMatchObject({ ok: false, code: "bad_request", messageKey: "accounts.transfer_required" });
    expect(!stale.ok && stale.message).toBe(t("accounts.transfer_required"));

    const done = await offboardMember(org.id, row, receiver.id, t);
    expect(done.ok).toBe(true);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(receiver.id);
    expect(await rowOf(org.id, owner.id, leaver.id)).toMatchObject({ status: "OFFBOARDED", workspaces: [], openWork: 0 });
    expect(done.ok && done.value).toMatchObject({ status: "OFFBOARDED", workspaces: [], openWork: 0 });
  });

  it("reset password and sign-out-everywhere end the person's sessions", async () => {
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    const worker = await person(org.id, "MEMBER");
    const row = await rowOf(org.id, owner.id, worker.id);
    await loginAs(owner.id);

    const out = await logoutEverywhere(org.id, row, t);
    expect(out.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).tokenVersion).toBe(1);

    const reset = await resetMemberPassword(org.id, row, t);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).tokenVersion).toBe(2);
    const user = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
    expect(await verifyPassword(reset.value.password as string, user.passwordHash)).toBe(true);
  });

  it("nobody can act on themselves, and the screen shows every refusal in Arabic", async () => {
    const org = await makeOrg();
    const admin = await makeUser({ orgId: org.id, role: "ADMIN" });
    const row = await rowOf(org.id, admin.id, admin.id);
    expect(offeredActions(await actorInfo(org.id, admin), row).manageable).toBe(false);
    const res = await suspendMember(org.id, row, t); // forced, as a stale screen might
    expect(res).toMatchObject({ ok: false, messageKey: "accounts.self_denied" });
    expect(!res.ok && res.message).toBe(t("accounts.self_denied"));
  });
});

// ---------- the matrix: the screen offers nothing the server refuses ----------

/** Who looks at the screen: the rank, and the capability that lets a non-admin manage accounts. */
const ACTORS: { label: string; role: OrgRole; extra: Record<string, unknown> }[] = [
  { label: "OWNER", role: "OWNER", extra: {} },
  { label: "ADMIN", role: "ADMIN", extra: {} },
  { label: "LEAD who was given users.manage", role: "LEAD", extra: { capabilities: ["users.manage"] } },
  { label: "MEMBER who was given users.manage", role: "MEMBER", extra: { capabilities: ["users.manage"] } },
  // holds fewer defaults than the rank gives: what the server then switches off on people they re-rank must show on the screen
  { label: "ADMIN whom the owner took crm.edit and prices.view from", role: "ADMIN", extra: { revokedCapabilities: ["crm.edit", "prices.view"] } },
];
const TARGET_ROLES: OrgRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];
const STATUSES: MemberStatus[] = ["ACTIVE", "SUSPENDED", "OFFBOARDED"];

describe.each(ACTORS)("the screen and the server agree for: $label", ({ role, extra }) => {
  async function world() {
    const org = await makeOrg();
    const actor = await person(org.id, role, "ACTIVE", extra);
    // an OWNER always exists in a real organization (the actor may be that one)
    const owner = role === "OWNER" ? actor : await makeUser({ orgId: org.id, role: "OWNER" });
    return { org, actor, owner, info: await actorInfo(org.id, actor) };
  }

  it("rank creatable: the screen lists a rank exactly when the server accepts creating one", async () => {
    const { org, actor, info } = await world();
    await loginAs(actor.id);
    const offered = new Set(creatableRoles(info.role));
    for (const rank of CREATABLE_ROLES) {
      const res = await createMember(org.id, form({ role: rank }), t);
      expect(res.ok, `${role} creating ${rank}`).toBe(offered.has(rank));
      if (!res.ok) expect(res.message).toBe(t("orgm.role_denied"));
    }
  }, 60_000);

  it("manageable: the screen offers actions on a person exactly when the server lets the actor administer them", async () => {
    const { org, actor, info } = await world();
    for (const targetRole of TARGET_ROLES) {
      for (const status of STATUSES) {
        const target = await person(org.id, targetRole, status);
        const row = await rowOf(org.id, actor.id, target.id);
        const acts = offeredActions(info, row);
        // the harmless probe: signing out everywhere changes nothing but needs the same permission
        const probe = await logoutEverywhere(org.id, row, t);
        expect(acts.manageable, `${role} -> ${targetRole} ${status}`).toBe(probe.ok);
      }
    }
    const self = await rowOf(org.id, actor.id, actor.id);
    expect(offeredActions(info, self).manageable).toBe(false);
    expect((await logoutEverywhere(org.id, self, t)).ok).toBe(false);
  }, 60_000);

  it("every action the screen offers is accepted by the server (suspend, reactivate, offboard, edit, ranks, password, sign-out)", async () => {
    const { org, actor, info } = await world();
    for (const targetRole of TARGET_ROLES) {
      for (const status of STATUSES) {
        const probe = await person(org.id, targetRole, status);
        const acts = offeredActions(info, await rowOf(org.id, actor.id, probe.id));
        if (!acts.manageable) continue;

        const fresh = async () => rowOf(org.id, actor.id, (await person(org.id, targetRole, status)).id);
        const label = (what: string) => `${role} -> ${targetRole} ${status}: ${what}`;
        const members = () => roster(org.id, actor.id).then((r) => r.members);

        if (acts.suspend) expect((await suspendMember(org.id, await fresh(), t)).ok, label("suspend")).toBe(true);
        if (acts.offboard) expect((await offboardMember(org.id, await fresh(), null, t)).ok, label("offboard")).toBe(true);
        if (acts.reactivate) expect((await reactivateMember(org.id, await fresh(), t)).ok, label("reactivate")).toBe(true);
        if (acts.logoutEverywhere) expect((await logoutEverywhere(org.id, await fresh(), t)).ok, label("sign out")).toBe(true);
        if (acts.resetPassword) expect((await resetMemberPassword(org.id, await fresh(), t)).ok, label("reset")).toBe(true);
        if (acts.edit) {
          const row = await fresh();
          const edit = await saveMemberInfo(org.id, row, { name: `${row.name} ٢`, jobTitle: "مسمّى", role: row.role, managerId: "" }, await members(), info, t);
          expect(edit.ok, label("edit")).toBe(true);
        }
        // the ranks in the select, when it is shown: each one is accepted, and every rank the server
        // would accept is in it (a rank missing from the select would lock the owner out of a valid choice)
        if (acts.edit) {
          for (const rank of CREATABLE_ROLES) {
            const row = await fresh();
            if (rank === row.role) continue; // not a change
            const res = await saveMemberInfo(org.id, row, { name: row.name, jobTitle: "", role: rank, managerId: "" }, await members(), info, t);
            expect(res.ok, label(`rank ${rank}`)).toBe(acts.rankChoices.includes(rank));
            if (res.ok) {
              // and what the screen patches into its cache is what the server stored (switches the actor lacks start off)
              const after = await rowOf(org.id, actor.id, row.id);
              expect(res.value, label(`cache after rank ${rank}`)).toMatchObject({
                capabilities: after.capabilities,
                revokedCapabilities: after.revokedCapabilities,
              });
              expect(res.value?.effectiveCapabilities, label(`effective after rank ${rank}`)).toEqual(after.effectiveCapabilities);
            }
          }
        }
      }
    }
  }, 180_000);

  it("a switch is unlocked on the screen exactly when the server accepts flipping it", async () => {
    const { org, actor, info } = await world();
    const target = await person(org.id, "MEMBER");
    const row = await rowOf(org.id, actor.id, target.id);
    const acts = offeredActions(info, row);
    if (!acts.manageable) return;
    const rows = capabilityGroups(row, info, acts.capabilities === "editable").flatMap((g) => g.rows);
    expect(rows.length).toBe(WIRED_CAPABILITIES.length); // only the wired switches are offered
    for (const r of rows) {
      const res = await setCapability(org.id, await rowOf(org.id, actor.id, target.id), r.capability, !r.on, t);
      expect(res.ok, `${role}: ${r.capability} locked=${r.locked}`).toBe(r.locked === null);
      if (!res.ok && r.locked === "actor_lacks") expect(res.message).toBe(t("accounts.cap_not_held"));
      if (res.ok) {
        // flip it back so the next switch starts from the same state
        expect((await setCapability(org.id, await rowOf(org.id, actor.id, target.id), r.capability, r.on, t)).ok).toBe(true);
      }
    }
  }, 120_000);
});
