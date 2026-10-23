import { describe, expect, it } from "vitest";
import * as spaceRoute from "@/app/api/workspaces/[id]/route";
import * as membersRoute from "@/app/api/workspaces/[id]/members/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { call, db, loginAs, logout, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeSpaceWorld, notificationsOf, rowsOf } from "./spaces-helpers";

/**
 * GET / PATCH / DELETE /api/workspaces/[id] — reading and changing one space.
 * Members read; the space ADMIN (or the OWNER) edits and deletes; an org ADMIN is not special unless
 * they are in the space; the OWNER needs no row, and looking or writing there leaves no trace for
 * the people of the space.
 */

/** Member (MEMBER row), lead (space ADMIN row), guest (GUEST row). The OWNER and the org ADMIN have no row. */
const world = () => makeSpaceWorld({ member: "MEMBER", lead: "ADMIN", guest: "GUEST" });

const get = (id: string) => call(spaceRoute.GET, { params: { id } });
const patch = (id: string, body: unknown) => call(spaceRoute.PATCH, { method: "PATCH", params: { id }, body });
const del = (id: string) => call(spaceRoute.DELETE, { method: "DELETE", params: { id } });

const nameOf = async (id: string) => (await db.workspace.findUnique({ where: { id }, select: { name: true } }))?.name;

describe("GET /api/workspaces/[id]: members read", () => {
  it("every person in the space reads it; the OWNER reads it without a row; only the space ADMIN and the OWNER are told they can manage it", async () => {
    const w = await world();
    const expected = { owner: true, lead: true, member: false, guest: false } as const;
    for (const who of ["owner", "lead", "member", "guest"] as const) {
      await loginAs(w[who].id);
      const res = await get(w.ws.id);
      expect(res.status, who).toBe(200);
      expect(res.json?.["workspace"], who).toMatchObject({ id: w.ws.id, name: w.ws.name, slug: w.ws.slug, organizationId: w.org.id });
      expect(res.json?.["canManage"], who).toBe(expected[who]);
      expect(res.json?.["memberCount"], who).toBe(3);
    }
  });

  it("keeps to the fields a space needs: no e-mail, no member list", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await get(w.ws.id);
    expect(Object.keys(res.json?.["workspace"] as object).sort()).toEqual(["createdAt", "description", "id", "name", "organizationId", "slug"]);
    expect(res.text).not.toContain("@");
  });

  it("an org ADMIN not in the space is refused; put in it (even as a plain member) they read it and can manage it", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const refused = await get(w.ws.id);
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("not_workspace_member");
    expect(refused.text).not.toContain(w.ws.name);

    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    const res = await get(w.ws.id);
    expect(res.status).toBe(200);
    expect(res.json?.["canManage"]).toBe(true); // an org ADMIN who is in the space outranks their MEMBER row
  });

  it("somebody who is in another space of the company but not this one, and the people of another organization, are refused", async () => {
    const w = await world();
    const elsewhere = await makeSpaceWorld({ member: "MEMBER" }); // a different organization altogether
    const roamer = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "In another space" });
    await makeWorkspace(w.org.id, [{ userId: roamer.id }], "The roamer's own space");
    for (const person of [roamer, elsewhere.owner, elsewhere.member]) {
      await loginAs(person.id);
      expect((await get(w.ws.id)).status, person.name).toBe(403);
    }
  });

  it("an anonymous caller gets 401, an id that is not a space gets 404", async () => {
    const w = await world();
    logout();
    expect((await get(w.ws.id)).status).toBe(401);
    await loginAs(w.owner.id);
    const missing = await get("no-such-space");
    expect(missing.status).toBe(404);
    expect(missing.json?.["message"]).toBe("workspace.not_found");
  });

  it("counts only the people who can actually work in it (a suspended person with a leftover row is not counted)", async () => {
    const w = await world();
    const ghost = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Ghost" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: ghost.id, role: "MEMBER" } });
    await loginAs(w.owner.id);
    expect((await get(w.ws.id)).json?.["memberCount"]).toBe(4);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: ghost.id } },
      data: { status: "SUSPENDED" },
    });
    expect((await get(w.ws.id)).json?.["memberCount"]).toBe(3);
  });
});

describe("PATCH /api/workspaces/[id]: the space ADMIN or the OWNER renames", () => {
  it.each(["owner", "lead"] as const)("a %s renames and re-describes it", async (who) => {
    const w = await world();
    await loginAs(w[who].id);
    const res = await patch(w.ws.id, { name: `Renamed by ${who}`, description: "new description" });
    expect(res.status).toBe(200);
    expect(res.json?.["workspace"]).toMatchObject({ id: w.ws.id, name: `Renamed by ${who}`, description: "new description" });
    expect(await nameOf(w.ws.id)).toBe(`Renamed by ${who}`);
    const entry = await db.auditLog.findFirst({ where: { action: "workspace.renamed", target: w.ws.id } });
    expect(entry).toMatchObject({ actorId: w[who].id, orgId: w.org.id });
  });

  it("an org ADMIN renames it only if they are in it", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const refused = await patch(w.ws.id, { name: "Renamed by rank" });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("not_workspace_member");
    expect(await nameOf(w.ws.id)).toBe(w.ws.name);

    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.admin.id, role: "MEMBER" } });
    expect((await patch(w.ws.id, { name: "Renamed by an admin in it" })).status).toBe(200);
    expect(await nameOf(w.ws.id)).toBe("Renamed by an admin in it");
  });

  it("a plain member and a guest read but cannot rename (insufficient_role); an outsider gets not_workspace_member; nothing changes", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outsider" });
    const expected = [
      [w.member, "insufficient_role"],
      [w.guest, "insufficient_role"],
      [outsider, "not_workspace_member"],
    ] as const;
    for (const [person, message] of expected) {
      await loginAs(person.id);
      const res = await patch(w.ws.id, { name: `Renamed by ${person.name}` });
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"], person.name).toBe(message);
    }
    expect(await nameOf(w.ws.id)).toBe(w.ws.name);
  });

  it("the OWNER of another organization cannot touch it", async () => {
    const w = await world();
    const stranger = await makeTeam();
    await loginAs(stranger.owner.id);
    expect((await patch(w.ws.id, { name: "Not yours" })).status).toBe(403);
    expect(await nameOf(w.ws.id)).toBe(w.ws.name);
  });

  it("keeps validating the name (2-80 characters)", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    expect((await patch(w.ws.id, { name: "x" })).status).toBe(422);
    expect((await patch(w.ws.id, { name: "x".repeat(81) })).status).toBe(422);
    expect((await patch(w.ws.id, { name: "ok name" })).status).toBe(200);
  });
});

describe("DELETE /api/workspaces/[id]: only an empty space, only by its ADMIN or the OWNER", () => {
  it.each(["owner", "lead"] as const)("a %s deletes an empty space; its rows go with it; the deletion is audited", async (who) => {
    const w = await world();
    await loginAs(w[who].id);
    const res = await del(w.ws.id);
    expect(res.status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: w.ws.id } })).toBeNull();
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    const entry = await db.auditLog.findFirst({ where: { action: "workspace.deleted", target: w.ws.id } });
    expect(entry).toMatchObject({ actorId: w[who].id, orgId: w.org.id });
    // the people are untouched: only the space is gone
    expect(await db.organizationMember.count({ where: { organizationId: w.org.id } })).toBe(5);
  });

  it("a space that still has projects is NOT deleted - not even by the owner (409 spaces.not_empty); nothing is lost", async () => {
    const w = await world();
    const { project } = await makeProject(w.ws.id);
    for (const who of ["owner", "lead"] as const) {
      await loginAs(w[who].id);
      const res = await del(w.ws.id);
      expect(res.status, who).toBe(409);
      expect(res.json?.["message"], who).toBe("spaces.not_empty");
    }
    expect(await db.workspace.findUnique({ where: { id: w.ws.id } })).not.toBeNull();
    expect(await db.project.findUnique({ where: { id: project.id } })).not.toBeNull();
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id } })).toBe(3);
  });

  it("a plain member, a guest, an org ADMIN who is not in it and an outsider cannot delete it; nothing changes", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outsider" });
    for (const person of [w.member, w.guest, w.admin, outsider]) {
      await loginAs(person.id);
      expect((await del(w.ws.id)).status, person.name).toBe(403);
    }
    expect(await db.workspace.findUnique({ where: { id: w.ws.id } })).not.toBeNull();
    expect(await db.workspaceMember.count({ where: { workspaceId: w.ws.id } })).toBe(3);
  });

  it("an id that is not a space is a 404, and an anonymous caller a 401", async () => {
    const w = await world();
    logout();
    expect((await del(w.ws.id)).status).toBe(401);
    await loginAs(w.owner.id);
    expect((await del("no-such-space")).status).toBe(404);
  });
});

describe("the OWNER's oversight is silent: no row, no 'joined' event, no notification, nobody told", () => {
  /** Everything a look could leave behind in the organization. */
  async function traces(w: Awaited<ReturnType<typeof world>>) {
    return {
      ownerRows: await db.workspaceMember.count({ where: { userId: w.owner.id } }),
      rows: await rowsOf(w.ws.id),
      notifications: await db.notification.count({ where: { user: { memberships: { some: { organizationId: w.org.id } } } } }),
      audit: await db.auditLog.count({ where: { orgId: w.org.id } }),
    };
  }

  it("the owner opens, reads the space and its people, and lists the spaces: nothing is written anywhere", async () => {
    const w = await world();
    const before = await traces(w);
    await loginAs(w.owner.id);
    expect((await get(w.ws.id)).status).toBe(200);
    expect((await call(membersRoute.GET, { params: { id: w.ws.id } })).status).toBe(200);
    expect((await call(workspacesRoute.GET)).status).toBe(200);
    expect(await traces(w)).toEqual(before);
    expect(await notificationsOf(w.owner.id)).toEqual([]);
  });

  it("the owner writes as a space admin (rename): it is audited as their act, and still no row and no notification for anyone", async () => {
    const w = await world();
    const before = await traces(w);
    await loginAs(w.owner.id);
    expect((await patch(w.ws.id, { name: "Renamed by the owner" })).status).toBe(200);
    const after = await traces(w);
    expect(after.ownerRows).toBe(0);
    expect(after.rows).toEqual(before.rows);
    expect(after.notifications).toBe(before.notifications);
    expect(after.audit).toBe(before.audit + 1); // one entry: the rename, as an act of the owner
    expect(await db.auditLog.findFirst({ where: { orgId: w.org.id, action: { contains: "join" } } })).toBeNull();
  });
});
