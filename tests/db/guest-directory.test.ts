import { describe, expect, it } from "vitest";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as workspaceMembersRoute from "@/app/api/workspaces/[id]/members/route";
import * as userRoute from "@/app/api/users/[id]/route";
import { memberDirectory } from "@/server/services/users";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * One org. The guest works in `shared` together with `mate` and `member`.
 * `outsider` only works in another workspace; the owner and the admin run the company.
 */
async function directoryWorld() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Workspace mate" });
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Elsewhere" });
  await db.user.update({ where: { id: mate.id }, data: { jobTitle: "Factory liaison", bio: "Talks to the partner" } });
  await db.user.update({ where: { id: outsider.id }, data: { jobTitle: "Accountant", bio: "Knows the margins" } });
  const shared = await makeWorkspace(team.org.id, [
    { userId: team.guest.id, role: "GUEST" },
    { userId: mate.id },
    { userId: team.member.id },
  ]);
  const elsewhere = await makeWorkspace(team.org.id, [{ userId: outsider.id }, { userId: team.admin.id, role: "ADMIN" }]);
  return { ...team, mate, outsider, shared, elsewhere };
}

describe("chat directory", () => {
  it("is refused to a GUEST with 403", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    const res = await call(directoryRoute.GET);
    expect(res.status).toBe(403);
    expect(res.json?.["error"]).toBe("forbidden");
    expect(res.json?.["people"]).toBeUndefined();
    expect(res.text).not.toContain("Workspace mate");
  });

  it("still lists the staff for a MEMBER (without themselves)", async () => {
    const w = await directoryWorld();
    await loginAs(w.member.id);
    const res = await call(directoryRoute.GET);
    expect(res.status).toBe(200);
    const names = (res.json?.["people"] as { user: { name: string } }[]).map((p) => p.user.name);
    expect(names).toEqual(expect.arrayContaining(["Owner", "Admin", "Workspace mate", "Elsewhere"]));
    expect(names).not.toContain("Member");
    expect(names).not.toContain("Guest");
  });
});

describe("workspace members: what a GUEST gets", () => {
  it("is names only (id + name), for the people of that workspace, with no email anywhere", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    const res = await call(workspaceMembersRoute.GET, { params: { id: w.shared.id } });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("@");
    const members = res.json?.["members"] as Record<string, unknown>[];
    for (const m of members) expect(Object.keys(m).sort()).toEqual(["id", "name"]);
    expect(members.map((m) => m["name"]).sort()).toEqual(["Guest", "Member", "Workspace mate"]);
  });

  it("is unchanged for a MEMBER: emails, roles, and the org admins who inherit the workspace", async () => {
    const w = await directoryWorld();
    await loginAs(w.member.id);
    const res = await call(workspaceMembersRoute.GET, { params: { id: w.shared.id } });
    expect(res.status).toBe(200);
    const members = res.json?.["members"] as { id: string; name: string; email: string; role: string }[];
    const byName = new Map(members.map((m) => [m.name, m]));
    expect(byName.get("Workspace mate")?.email).toBe(w.mate.email);
    expect(byName.get("Workspace mate")?.role).toBe("MEMBER");
    expect(byName.get("Guest")?.role).toBe("GUEST");
    expect(byName.get("Owner")?.role).toBe("org:OWNER");
    expect(byName.get("Admin")?.role).toBe("org:ADMIN");
  });

  it("a GUEST outside the workspace still cannot open the list at all", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    const res = await call(workspaceMembersRoute.GET, { params: { id: w.elsewhere.id } });
    expect(res.status).toBe(403);
  });
});

describe("user profiles: GET /api/users/[id]", () => {
  it("a GUEST sees only id + name of someone who shares a workspace with them", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    const res = await call(userRoute.GET, { params: { id: w.mate.id } });
    expect(res.status).toBe(200);
    expect(res.json?.["profile"]).toEqual({ id: w.mate.id, name: "Workspace mate" });
    expect(res.text).not.toContain("@");
    expect(res.text).not.toContain("Factory liaison");
    expect(res.text).not.toContain("Talks to the partner");
  });

  it("a GUEST gets 404 for anybody they share no workspace with - staff, admins and the owner included", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    for (const person of [w.outsider, w.admin, w.owner]) {
      const res = await call(userRoute.GET, { params: { id: person.id } });
      expect(res.status, person.name).toBe(404);
      expect(res.text).not.toContain("Accountant");
      expect(res.text).not.toContain("Knows the margins");
    }
    expect((await call(userRoute.GET, { params: { id: "no-such-user" } })).status).toBe(404);
  });

  it("a GUEST can look at their own entry", async () => {
    const w = await directoryWorld();
    await loginAs(w.guest.id);
    const res = await call(userRoute.GET, { params: { id: w.guest.id } });
    expect(res.status).toBe(200);
    expect(res.json?.["profile"]).toEqual({ id: w.guest.id, name: "Guest" });
  });

  it("a MEMBER still gets the full profile of any colleague", async () => {
    const w = await directoryWorld();
    await loginAs(w.member.id);
    const res = await call(userRoute.GET, { params: { id: w.outsider.id } });
    expect(res.status).toBe(200);
    const profile = res.json?.["profile"] as Record<string, unknown>;
    expect(profile).toMatchObject({
      id: w.outsider.id,
      name: "Elsewhere",
      jobTitle: "Accountant",
      bio: "Knows the margins",
      organizationId: w.org.id,
      organizationRole: "MEMBER",
    });
    expect(profile["stats"]).toBeTruthy();
    expect(typeof profile["hue"]).toBe("number");
  });

  it("someone who is a GUEST in one org and a MEMBER in another keeps full access where they are a MEMBER", async () => {
    const guestOrg = await directoryWorld();
    const memberOrg = await makeTeam();
    // oldest membership = guest of the first org, then a normal member of the second
    const dual = await makeUser({ orgId: guestOrg.org.id, role: "GUEST", name: "Dual" });
    await db.organizationMember.create({ data: { organizationId: memberOrg.org.id, userId: dual.id, role: "MEMBER" } });
    await db.user.update({ where: { id: memberOrg.member.id }, data: { jobTitle: "Buyer" } });

    await loginAs(dual.id);
    const colleague = await call(userRoute.GET, { params: { id: memberOrg.member.id } });
    expect(colleague.status).toBe(200);
    expect((colleague.json?.["profile"] as { jobTitle: string }).jobTitle).toBe("Buyer");

    // ...but in the org where they are only a guest, nothing is shared -> 404
    expect((await call(userRoute.GET, { params: { id: guestOrg.outsider.id } })).status).toBe(404);
  });
});

describe("a person who left the org but still has a workspace row", () => {
  it("is never shown to a GUEST - not in the member list, the workspace list or as a profile", async () => {
    const w = await directoryWorld();
    const ghost = await makeUser({ name: "Ghost" }); // no org membership at all
    await db.workspaceMember.create({ data: { workspaceId: w.shared.id, userId: ghost.id } });
    await loginAs(w.guest.id);

    const list = await call(workspaceMembersRoute.GET, { params: { id: w.shared.id } });
    expect(list.text).not.toContain("Ghost");
    expect((await call(userRoute.GET, { params: { id: ghost.id } })).status).toBe(404);
    const directory = await memberDirectory(w.guest.id);
    expect(JSON.stringify(directory)).not.toContain("Ghost");
  });
});

describe("member directory (the /teams page)", () => {
  it("a GUEST sees only the names of the people they work with, nothing else", async () => {
    const w = await directoryWorld();
    const result = await memberDirectory(w.guest.id);
    expect(result).toHaveLength(1);
    const org = result[0]!;
    expect(org.organizationId).toBe(w.org.id);
    expect(org.canManage).toBe(false);
    expect(org.joinCode).toBeNull();
    expect(org.members.map((m) => m.name).sort()).toEqual(["Guest", "Member", "Workspace mate"]);
    for (const m of org.members) {
      expect(m.email).toBeNull();
      expect(m.jobTitle).toBeNull();
    }
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("Factory liaison");
    expect(raw).not.toContain(w.org.joinCode);
  });

  it("a MEMBER still sees every colleague with their job title, but no emails", async () => {
    const w = await directoryWorld();
    const org = (await memberDirectory(w.member.id))[0]!;
    expect(org.members.map((m) => m.name).sort()).toEqual(
      ["Admin", "Elsewhere", "Guest", "Member", "Owner", "Workspace mate"].sort(),
    );
    expect(org.members.find((m) => m.name === "Workspace mate")?.jobTitle).toBe("Factory liaison");
    expect(org.members.every((m) => m.email === null)).toBe(true);
    expect(org.joinCode).toBeNull();
  });

  it("an ADMIN still sees emails and the join code", async () => {
    const w = await directoryWorld();
    const org = (await memberDirectory(w.admin.id))[0]!;
    expect(org.canManage).toBe(true);
    expect(org.joinCode).toBe(w.org.joinCode);
    expect(org.members.find((m) => m.name === "Workspace mate")?.email).toBe(w.mate.email);
  });
});
