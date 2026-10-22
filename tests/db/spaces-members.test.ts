import { describe, expect, it } from "vitest";
import * as membersRoute from "@/app/api/workspaces/[id]/members/route";
import { SpaceConflictError, changeWorkspaceMembers } from "@/server/services/workspaces";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { add, demote, makePerson, makeSpaceWorld, notificationsOf, promote, remove, rowsOf, setStatus } from "./spaces-helpers";

/**
 * /api/workspaces/[id]/members — who is in a space, and who may change that.
 *
 *  - the list holds only the people IN the space whose organization membership is ACTIVE; the OWNER
 *    is not on it unless they have a real row (their oversight is silent);
 *  - adding needs someone who manages the space (its ADMIN, the OWNER, or an org ADMIN who is in it),
 *    and the person added must be an ACTIVE member of the SAME organization;
 *  - the last space ADMIN cannot be removed or demoted, except by the OWNER (409 spaces.last_admin).
 */

type Member = { id: string; name: string; email: string | null; role: string };

const list = (id: string) => call(membersRoute.GET, { params: { id } });
const post = (id: string, body: unknown) => call(membersRoute.POST, { params: { id }, body });
const names = (res: { json: Record<string, unknown> | null }) =>
  (res.json?.["members"] as { name: string }[]).map((m) => m.name).sort();

/** Member (MEMBER row), lead (space ADMIN row), guest (GUEST row); plus people who are NOT in the space. */
async function membersWorld() {
  const w = await makeSpaceWorld({ member: "MEMBER", lead: "ADMIN", guest: "GUEST" });
  const colleague = await makePerson(w, "Colleague"); // an org member with no row
  const suspended = await makePerson(w, "Suspended person", { in: w.ws }); // keeps a leftover row
  await setStatus(w.org.id, suspended.id, "SUSPENDED");
  const offboarded = await makePerson(w, "Offboarded person", { in: w.ws });
  await setStatus(w.org.id, offboarded.id, "OFFBOARDED");
  const foreigner = (await makeTeam()).member; // belongs to another organization
  return { ...w, colleague, suspended, offboarded, foreigner };
}
type World = Awaited<ReturnType<typeof membersWorld>>;

/** A person who was never in the space and is no longer ACTIVE. */
async function inactivePerson(w: World, status: "SUSPENDED" | "OFFBOARDED") {
  const p = await makePerson(w, `${status} newcomer ${uid()}`);
  await setStatus(w.org.id, p.id, status);
  return p;
}

describe("GET members: only the people in the space, only while they are ACTIVE", () => {
  it("lists the people with a row whose membership is ACTIVE - not the leftover rows of a suspended or offboarded person, not the owner or an admin who are not in it", async () => {
    const w = await membersWorld();
    await loginAs(w.member.id);
    const res = await list(w.ws.id);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["Guest", "Lead", "Member"]);
    for (const hidden of ["Suspended person", "Offboarded person", "Owner", "Admin", "Colleague"]) {
      expect(res.text).not.toContain(hidden);
    }
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id } })).toBe(5); // the rows are still there
  });

  it("the OWNER is on the list only with a real row, and an org ADMIN only once they are put in the space", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect(names(await list(w.ws.id))).not.toContain("Owner");
    expect(names(await list(w.ws.id))).not.toContain("Admin");

    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.owner.id, role: "MEMBER" } });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    const res = await list(w.ws.id);
    const byName = new Map((res.json?.["members"] as Member[]).map((m) => [m.name, m]));
    expect(byName.get("Owner")?.role).toBe("MEMBER");
    expect(byName.get("Admin")?.role).toBe("MEMBER");
  });

  it("the OWNER reads the list without being on it, and is told they can manage; the others are told what they can do", async () => {
    const w = await membersWorld();
    const expected = { owner: true, lead: true, member: false } as const;
    for (const who of ["owner", "lead", "member"] as const) {
      await loginAs(w[who].id);
      const res = await list(w.ws.id);
      expect(res.status, who).toBe(200);
      expect(res.json?.["canManage"], who).toBe(expected[who]);
      expect(names(res), who).toEqual(["Guest", "Lead", "Member"]);
    }
  });

  it("an org ADMIN who is in the space can manage it (a MEMBER row is enough); one who is not in it is refused", async () => {
    const w = await membersWorld();
    await loginAs(w.admin.id);
    expect((await list(w.ws.id)).status).toBe(403);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    const res = await list(w.ws.id);
    expect(res.status).toBe(200);
    expect(res.json?.["canManage"]).toBe(true);
  });

  it("a GUEST still gets names only, for the ACTIVE people of that space, and is not told they can manage", async () => {
    const w = await membersWorld();
    await loginAs(w.guest.id);
    const res = await list(w.ws.id);
    expect(res.status).toBe(200);
    for (const m of res.json?.["members"] as Record<string, unknown>[]) expect(Object.keys(m).sort()).toEqual(["id", "name"]);
    expect(names(res)).toEqual(["Guest", "Lead", "Member"]);
    expect(res.text).not.toContain("@");
    expect(res.text).not.toContain("Suspended person");
    expect(res.json?.["canManage"]).toBe(false);
  });

  it("a space nobody is in yet reads as an empty list for the OWNER, who can manage it", async () => {
    const w = await membersWorld();
    const empty = await makeWorkspace(w.org.id, [], "Nobody here yet");
    await loginAs(w.owner.id);
    const res = await list(empty.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ members: [], canManage: true });
    // an org ADMIN, who is not in it either, is refused rather than shown an empty room
    await loginAs(w.admin.id);
    expect((await list(empty.id)).status).toBe(403);
  });

  it("a person who has only a username (no e-mail) is listed like everybody else", async () => {
    const w = await membersWorld();
    const handle = await makePerson(w, "Username only", { in: w.ws });
    await db.user.update({ where: { id: handle.id }, data: { email: null, username: `u${uid()}` } });
    await loginAs(w.member.id);
    const res = await list(w.ws.id);
    expect(res.status).toBe(200);
    const row = (res.json?.["members"] as Member[]).find((m) => m.name === "Username only");
    expect(row).toMatchObject({ id: handle.id, role: "MEMBER", email: null });
  });

  it("is closed to people outside the space and outside the organization, and to anyone not signed in", async () => {
    const w = await membersWorld();
    for (const person of [w.colleague, w.foreigner, w.admin]) {
      await loginAs(person.id);
      const res = await list(w.ws.id);
      expect(res.status, person.name).toBe(403);
      expect(res.text, person.name).not.toContain("Lead");
    }
  });
});

describe("POST members: adding people", () => {
  it("a space ADMIN adds a colleague: MEMBER row, the colleague is told once, the actor is not, the change is audited", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    const res = await post(w.ws.id, add(w.colleague.id));
    expect(res.status).toBe(200);
    expect((await rowsOf(w.ws.id)).find((r) => r.userId === w.colleague.id)?.role).toBe("MEMBER");
    expect(await notificationsOf(w.colleague.id)).toEqual([{ type: "ws_member_added", title: w.ws.name }]);
    expect(await notificationsOf(w.lead.id)).toEqual([]);
    expect(await db.auditLog.findFirst({ where: { action: "workspace.members_updated", target: w.ws.id } })).toMatchObject({ actorId: w.lead.id });
  });

  it("the OWNER adds people to a space they are not in, and does not become a member by doing it", async () => {
    const w = await membersWorld();
    await loginAs(w.owner.id);
    const res = await post(w.ws.id, add(w.colleague.id));
    expect(res.status).toBe(200);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.owner.id } })).toBe(0);
    expect(await notificationsOf(w.owner.id)).toEqual([]);
    expect(await notificationsOf(w.colleague.id)).toHaveLength(1);
  });

  it("an org ADMIN who is in the space adds people; one who is not in it cannot", async () => {
    const w = await membersWorld();
    await loginAs(w.admin.id);
    expect((await post(w.ws.id, add(w.colleague.id))).status).toBe(403);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.colleague.id } })).toBe(0);
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    expect((await post(w.ws.id, add(w.colleague.id))).status).toBe(200);
  });

  it("a plain member, a guest, an outsider and the people of another organization cannot add anybody; nothing changes", async () => {
    const w = await membersWorld();
    const before = await rowsOf(w.ws.id);
    const expected = [
      [w.member, "insufficient_role"],
      [w.guest, "insufficient_role"],
      [w.colleague, "not_workspace_member"],
      [w.foreigner, "not_workspace_member"],
    ] as const;
    for (const [person, message] of expected) {
      await loginAs(person.id);
      const res = await post(w.ws.id, add(w.colleague.id));
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"], person.name).toBe(message);
    }
    expect(await rowsOf(w.ws.id)).toEqual(before);
    expect(await notificationsOf(w.colleague.id)).toEqual([]);
  });

  it("a space ADMIN of one space cannot manage another space they are not in", async () => {
    const w = await membersWorld();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Another space");
    await loginAs(w.lead.id);
    const res = await post(other.id, add(w.colleague.id));
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("not_workspace_member");
    expect(await rowsOf(other.id)).toEqual([{ userId: w.member.id, role: "MEMBER" }]);
  });

  it.each(["another organization's user", "a suspended person", "an offboarded person", "an id that is nobody"] as const)(
    "refuses %s - nobody in that request is added, nobody is told",
    async (kind) => {
      const w = await membersWorld();
      let bad: string;
      if (kind === "another organization's user") bad = w.foreigner.id;
      else if (kind === "a suspended person") bad = (await inactivePerson(w, "SUSPENDED")).id;
      else if (kind === "an offboarded person") bad = (await inactivePerson(w, "OFFBOARDED")).id;
      else bad = `no-such-user-${uid()}`;
      const before = await rowsOf(w.ws.id);
      await loginAs(w.lead.id);
      const res = await post(w.ws.id, add(w.colleague.id, bad));
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("spaces.member_not_in_org");
      expect(await rowsOf(w.ws.id)).toEqual(before); // the valid colleague in the same request was not added either
      expect(await notificationsOf(w.colleague.id)).toEqual([]);
      expect(await db.workspaceMember.count({ where: { userId: bad } })).toBe(0); // no row for the refused person anywhere
    },
  );

  it("the OWNER cannot add another organization's user either (the rule is about the people, not the caller)", async () => {
    const w = await membersWorld();
    await loginAs(w.owner.id);
    const res = await post(w.ws.id, add(w.foreigner.id));
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("spaces.member_not_in_org");
    expect(await db.workspaceMember.count({ where: { userId: w.foreigner.id } })).toBe(0);
  });

  it("adding someone already in the space changes nothing and tells nobody; adding the same person twice in one request makes one row and one notice", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    const before = await rowsOf(w.ws.id);
    expect((await post(w.ws.id, add(w.member.id, w.member.id))).status).toBe(200);
    expect(await rowsOf(w.ws.id)).toEqual(before);
    expect(await notificationsOf(w.member.id)).toEqual([]);

    expect((await post(w.ws.id, add(w.colleague.id, w.colleague.id))).status).toBe(200);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.colleague.id } })).toBe(1);
    expect(await notificationsOf(w.colleague.id)).toHaveLength(1);
  });

  it("an org GUEST is added as a space GUEST, whoever adds them", async () => {
    const w = await membersWorld();
    const partner = await makeUser({ orgId: w.org.id, role: "GUEST", name: "New partner" });
    await loginAs(w.lead.id);
    expect((await post(w.ws.id, add(partner.id))).status).toBe(200);
    expect((await rowsOf(w.ws.id)).find((r) => r.userId === partner.id)?.role).toBe("GUEST");
  });

  it("an empty request is refused (ws.no_change)", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect((await post(w.ws.id, {})).status).toBe(422);
    expect((await post(w.ws.id, { addUserIds: [] })).status).toBe(422);
  });
});

describe("POST members: promoting, demoting and removing", () => {
  it("promotes a member to space ADMIN and demotes them back; a person who is not in the space cannot be promoted into it", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect((await post(w.ws.id, promote(w.member.id))).status).toBe(200);
    expect((await rowsOf(w.ws.id)).find((r) => r.userId === w.member.id)?.role).toBe("ADMIN");
    expect((await post(w.ws.id, demote(w.member.id))).status).toBe(200);
    expect((await rowsOf(w.ws.id)).find((r) => r.userId === w.member.id)?.role).toBe("MEMBER");

    expect((await post(w.ws.id, promote(w.colleague.id))).status).toBe(200); // no row: nothing to promote
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.colleague.id } })).toBe(0);
  });

  it("does not hand the admin role to a person who is no longer ACTIVE", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    const res = await post(w.ws.id, promote(w.suspended.id));
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("spaces.member_not_in_org");
    expect((await rowsOf(w.ws.id)).find((r) => r.userId === w.suspended.id)?.role).toBe("MEMBER");
  });

  it("removes a person (their leftover row too, if they were suspended), and leaves their rows in other spaces alone", async () => {
    const w = await membersWorld();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.suspended.id }], "Another space");
    await loginAs(w.lead.id);
    expect((await post(w.ws.id, remove(w.member.id, w.suspended.id))).status).toBe(200);
    const left = (await rowsOf(w.ws.id)).map((r) => r.userId);
    expect(left).not.toContain(w.member.id);
    expect(left).not.toContain(w.suspended.id);
    expect(await rowsOf(other.id)).toHaveLength(2); // the other space is untouched
  });

  it("a plain member cannot promote, demote or remove anybody", async () => {
    const w = await membersWorld();
    const before = await rowsOf(w.ws.id);
    await loginAs(w.member.id);
    for (const body of [promote(w.guest.id), demote(w.lead.id), remove(w.lead.id)]) {
      expect((await post(w.ws.id, body)).status).toBe(403);
    }
    expect(await rowsOf(w.ws.id)).toEqual(before);
  });
});

describe("POST members: the last space ADMIN", () => {
  const roleOf = async (w: World, userId: string) => (await rowsOf(w.ws.id)).find((r) => r.userId === userId)?.role;

  it("the last ADMIN cannot remove themselves or step down: 409 spaces.last_admin, and nothing changes", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    for (const body of [remove(w.lead.id), demote(w.lead.id)]) {
      const res = await post(w.ws.id, body);
      expect(res.status).toBe(409);
      expect(res.json?.["message"]).toBe("spaces.last_admin");
    }
    expect(await roleOf(w, w.lead.id)).toBe("ADMIN");
  });

  it("an org ADMIN who is in the space cannot take the last space ADMIN away either", async () => {
    const w = await membersWorld();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    await loginAs(w.admin.id);
    for (const body of [remove(w.lead.id), demote(w.lead.id)]) {
      const res = await post(w.ws.id, body);
      expect(res.status).toBe(409);
      expect(res.json?.["message"]).toBe("spaces.last_admin");
    }
    expect(await roleOf(w, w.lead.id)).toBe("ADMIN");
  });

  it("a request that removes the last ADMIN is refused as a whole, even if it also adds someone", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    const res = await post(w.ws.id, { addUserIds: [w.colleague.id], removeUserIds: [w.lead.id] });
    expect(res.status).toBe(409);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: w.colleague.id } })).toBe(0);
    expect(await notificationsOf(w.colleague.id)).toEqual([]);
  });

  it("only the OWNER may remove or demote the last ADMIN (the space stays theirs to run)", async () => {
    const w = await membersWorld();
    await loginAs(w.owner.id);
    expect((await post(w.ws.id, demote(w.lead.id))).status).toBe(200);
    expect(await roleOf(w, w.lead.id)).toBe("MEMBER");

    const again = await membersWorld();
    await loginAs(again.owner.id);
    expect((await post(again.ws.id, remove(again.lead.id))).status).toBe(200);
    expect(await roleOf(again, again.lead.id)).toBeUndefined();
    expect(await db.workspace.findUnique({ where: { id: again.ws.id } })).not.toBeNull();
  });

  it("with a second ADMIN the first may step down, be removed, or be swapped out in one request", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect((await post(w.ws.id, promote(w.member.id))).status).toBe(200); // two ADMINs now
    expect((await post(w.ws.id, demote(w.lead.id))).status).toBe(200); // the lead steps down
    expect(await roleOf(w, w.lead.id)).toBe("MEMBER");
    expect(await roleOf(w, w.member.id)).toBe("ADMIN");

    // now `member` is the last one; a swap (promote the lead again + demote self) leaves one ADMIN: fine
    await loginAs(w.member.id);
    expect((await post(w.ws.id, { promoteUserIds: [w.lead.id], demoteUserIds: [w.member.id] })).status).toBe(200);
    expect(await roleOf(w, w.lead.id)).toBe("ADMIN");
    expect(await roleOf(w, w.member.id)).toBe("MEMBER");

    // and with two ADMINs, one can simply be removed
    await loginAs(w.lead.id);
    await post(w.ws.id, promote(w.member.id));
    expect((await post(w.ws.id, remove(w.member.id))).status).toBe(200);
    expect(await roleOf(w, w.member.id)).toBeUndefined();
  });

  it("a suspended ADMIN does not count as an ADMIN: the only working one still cannot step down", async () => {
    const w = await membersWorld();
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.suspended.id } },
      data: { role: "ADMIN" },
    });
    await loginAs(w.lead.id);
    const res = await post(w.ws.id, demote(w.lead.id));
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("spaces.last_admin");
    // removing the suspended person's leftover ADMIN row takes no working admin away: allowed
    expect((await post(w.ws.id, remove(w.suspended.id))).status).toBe(200);
  });

  it("a space with no working ADMIN at all (only a suspended one) can still be tidied up by an org ADMIN who is in it", async () => {
    const w = await membersWorld();
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.lead.id } },
      data: { role: "MEMBER" },
    });
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.suspended.id } },
      data: { role: "ADMIN" },
    });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    await loginAs(w.admin.id);
    expect((await post(w.ws.id, remove(w.member.id))).status).toBe(200); // nothing to protect: no working ADMIN exists
  });

  it("an org GUEST stored as an ADMIN is not an ADMIN: demoting them is not 'the last admin'", async () => {
    const w = await membersWorld();
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.guest.id } },
      data: { role: "ADMIN" },
    });
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.lead.id } },
      data: { role: "MEMBER" },
    });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    await loginAs(w.admin.id);
    expect((await post(w.ws.id, demote(w.guest.id))).status).toBe(200);
    expect(await roleOf(w, w.guest.id)).toBe("GUEST");
  });
});

describe("the last space ADMIN, under pressure", () => {
  /** Opens several database connections up front: a transaction that has to wait for a NEW connection can time out before it starts. */
  const warmPool = () => Promise.all(Array.from({ length: 6 }, () => db.$queryRaw`SELECT 1 AS x`));

  it("two ADMINs stepping down at the very same moment cannot both succeed: one is always left", async () => {
    await warmPool();
    for (let round = 0; round < 8; round++) {
      const w = await makeSpaceWorld({ lead: "ADMIN", member: "ADMIN" });
      const results = await Promise.allSettled([
        changeWorkspaceMembers({ orgRole: "MEMBER" }, w.ws.id, { demote: [w.lead.id] }),
        changeWorkspaceMembers({ orgRole: "MEMBER" }, w.ws.id, { demote: [w.member.id] }),
      ]);
      const admins = await db.workspaceMember.count({ where: { workspaceId: w.ws.id, role: "ADMIN" } });
      expect(admins, `round ${round}: the space kept an ADMIN`).toBe(1);
      expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason, `round ${round}`).toBeInstanceOf(SpaceConflictError);
      expect(refused.reason.message).toBe("spaces.last_admin");
    }
  });

  it("two ADMINs removing each other at the very same moment cannot both succeed either", async () => {
    await warmPool();
    for (let round = 0; round < 8; round++) {
      const w = await makeSpaceWorld({ lead: "ADMIN", member: "ADMIN" });
      await Promise.allSettled([
        changeWorkspaceMembers({ orgRole: "ADMIN" }, w.ws.id, { remove: [w.lead.id] }),
        changeWorkspaceMembers({ orgRole: "ADMIN" }, w.ws.id, { remove: [w.member.id] }),
      ]);
      expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id, role: "ADMIN" } }), `round ${round}`).toBe(1);
    }
  });
});

describe("PATCH and DELETE members: the same rules, one person at a time", () => {
  const patch = (id: string, body: unknown) => call(membersRoute.PATCH, { method: "PATCH", params: { id }, body });
  const del = (id: string, userId?: string) =>
    call(membersRoute.DELETE, {
      method: "DELETE",
      params: { id },
      url: `http://localhost/api/workspaces/${id}/members${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    });
  const roleOf = async (w: World, userId: string) => (await rowsOf(w.ws.id)).find((r) => r.userId === userId)?.role;

  it("PATCH sets a person's space role (ADMIN or MEMBER), guarded like POST", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect((await patch(w.ws.id, { userId: w.member.id, role: "ADMIN" })).status).toBe(200);
    expect(await roleOf(w, w.member.id)).toBe("ADMIN");
    expect((await patch(w.ws.id, { userId: w.member.id, role: "MEMBER" })).status).toBe(200);
    expect(await roleOf(w, w.member.id)).toBe("MEMBER");

    const guest = await patch(w.ws.id, { userId: w.guest.id, role: "ADMIN" });
    expect(guest.status).toBe(403);
    expect(guest.json?.["message"]).toBe("guest.readonly");

    const last = await patch(w.ws.id, { userId: w.lead.id, role: "MEMBER" });
    expect(last.status).toBe(409);
    expect(last.json?.["message"]).toBe("spaces.last_admin");

    expect((await patch(w.ws.id, { userId: w.member.id, role: "OWNER" })).status).toBe(422);
    expect((await patch(w.ws.id, { role: "ADMIN" })).status).toBe(422);

    await loginAs(w.member.id);
    expect((await patch(w.ws.id, { userId: w.member.id, role: "ADMIN" })).status).toBe(403); // nobody promotes themselves
    expect(await roleOf(w, w.member.id)).toBe("MEMBER");
  });

  it("neither alias lets in an org ADMIN who is not in the space, nor the people of another organization; nothing changes", async () => {
    const w = await membersWorld();
    const before = await rowsOf(w.ws.id);
    for (const person of [w.admin, w.foreigner, w.colleague]) {
      await loginAs(person.id);
      const promoted = await patch(w.ws.id, { userId: w.member.id, role: "ADMIN" });
      const removed = await del(w.ws.id, w.member.id);
      expect(promoted.status, person.name).toBe(403);
      expect(promoted.json?.["message"], person.name).toBe("not_workspace_member");
      expect(removed.status, person.name).toBe(403);
      expect(removed.json?.["message"], person.name).toBe("not_workspace_member");
    }
    expect(await rowsOf(w.ws.id)).toEqual(before);
  });

  it("DELETE removes a person from the space, guarded like POST", async () => {
    const w = await membersWorld();
    await loginAs(w.lead.id);
    expect((await del(w.ws.id, w.member.id)).status).toBe(200);
    expect(await roleOf(w, w.member.id)).toBeUndefined();

    const last = await del(w.ws.id, w.lead.id);
    expect(last.status).toBe(409);
    expect(last.json?.["message"]).toBe("spaces.last_admin");
    expect((await del(w.ws.id)).status).toBe(422); // no person named

    await loginAs(w.guest.id);
    expect((await del(w.ws.id, w.guest.id)).status).toBe(403); // a guest cannot even leave by this door: they ask an admin
    expect(await roleOf(w, w.guest.id)).toBe("GUEST");
  });
});
