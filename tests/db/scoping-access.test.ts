import { describe, expect, it } from "vitest";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { db, makeOrg, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace, makeScopedOrg } from "./scoping-helpers";

/**
 * `accessibleWorkspaceIds` is the single rule behind search, My Work, List,
 * Calendar, Analytics and idea→task. These tests pin it so none of them can
 * drift apart again.
 *
 * The rule: a space is visible only to the people IN it and to the OWNER. Rank gives nobody a space
 * (an ADMIN included): you are in a space when you have a row, and you are an ACTIVE member.
 */
describe("accessibleWorkspaceIds", () => {
  it("only the OWNER inherits every workspace of the org; ADMIN, LEAD, MEMBER and GUEST only the ones they were put in", async () => {
    const f = await makeScopedOrg();
    const lead = await makeUser({ orgId: f.org.id, role: "LEAD" });
    const all = [f.wsIn.id, f.wsOut.id].sort();
    expect((await accessibleWorkspaceIds(f.owner.id)).sort()).toEqual(all);
    // the ADMIN and the LEAD are in neither space: they open none of them
    expect(await accessibleWorkspaceIds(f.admin.id)).toEqual([]);
    expect(await accessibleWorkspaceIds(lead.id)).toEqual([]);
    expect(await accessibleWorkspaceIds(f.member.id)).toEqual([f.wsIn.id]);
    expect(await accessibleWorkspaceIds(f.guest.id)).toEqual([]);
    await joinWorkspace(f.guest.id, f.wsOut.id, "GUEST");
    expect(await accessibleWorkspaceIds(f.guest.id)).toEqual([f.wsOut.id]);
    // put into one space, the ADMIN opens exactly that one and nothing else
    await joinWorkspace(f.admin.id, f.wsOut.id, "MEMBER");
    expect(await accessibleWorkspaceIds(f.admin.id)).toEqual([f.wsOut.id]);
  });

  it("a workspace created later is inherited by the owner at once, not by an admin or a member", async () => {
    const f = await makeScopedOrg();
    const fresh = await makeWorkspace(f.org.id, [], "Brand new");
    expect(await accessibleWorkspaceIds(f.owner.id)).toContain(fresh.id);
    expect(await accessibleWorkspaceIds(f.admin.id)).not.toContain(fresh.id);
    expect(await accessibleWorkspaceIds(f.member.id)).not.toContain(fresh.id);
  });

  it("the owner's view of every space is silent: it never creates a row for them", async () => {
    const f = await makeScopedOrg();
    await accessibleWorkspaceIds(f.owner.id);
    expect(await db.workspaceMember.count({ where: { userId: f.owner.id } })).toBe(0);
  });

  it("a workspace row without membership in that workspace's org grants nothing", async () => {
    const f = await makeScopedOrg();
    const drifter = await makeUser(); // belongs to no org
    await joinWorkspace(drifter.id, f.wsIn.id);
    expect(await accessibleWorkspaceIds(drifter.id)).toEqual([]);

    // same after leaving the org: the stale row alone opens nothing
    const leaver = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await joinWorkspace(leaver.id, f.wsIn.id);
    expect(await accessibleWorkspaceIds(leaver.id)).toEqual([f.wsIn.id]);
    await db.organizationMember.deleteMany({ where: { organizationId: f.org.id, userId: leaver.id } });
    expect(await accessibleWorkspaceIds(leaver.id)).toEqual([]);
  });

  it("a suspended or offboarded person keeps their rows but opens nothing; reactivated, everything is back", async () => {
    const f = await makeScopedOrg();
    for (const status of ["SUSPENDED", "OFFBOARDED"] as const) {
      const person = await makeUser({ orgId: f.org.id, role: "MEMBER" });
      await joinWorkspace(person.id, f.wsIn.id);
      await joinWorkspace(person.id, f.wsOut.id);
      expect((await accessibleWorkspaceIds(person.id)).sort()).toEqual([f.wsIn.id, f.wsOut.id].sort());

      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: f.org.id, userId: person.id } },
        data: { status },
      });
      expect(await accessibleWorkspaceIds(person.id), status).toEqual([]);
      expect(await db.workspaceMember.count({ where: { userId: person.id } }), `${status}: the rows stay`).toBe(2);

      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: f.org.id, userId: person.id } },
        data: { status: "ACTIVE" },
      });
      expect((await accessibleWorkspaceIds(person.id)).sort(), `${status}, reactivated`).toEqual([f.wsIn.id, f.wsOut.id].sort());
    }
  });

  it("a suspended OWNER does not see the company's spaces either", async () => {
    const f = await makeScopedOrg();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: f.org.id, userId: f.owner.id } },
      data: { status: "SUSPENDED" },
    });
    expect(await accessibleWorkspaceIds(f.owner.id)).toEqual([]);
  });

  it("covers several orgs, each by its own role, and never mixes them up", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    // MEMBER of A inside wsOut only; OWNER of B, who inherits every space of B
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsOut.id);
    await joinOrg(multi.id, b.org.id, "OWNER");
    const ids = (await accessibleWorkspaceIds(multi.id)).sort();
    expect(ids).toEqual([a.wsOut.id, b.wsIn.id, b.wsOut.id].sort());
    expect(ids).not.toContain(a.wsIn.id);
  });

  it("an ADMIN of another org inherits nothing there: only the spaces they were put in", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsOut.id);
    await joinOrg(multi.id, b.org.id, "ADMIN");
    await joinWorkspace(multi.id, b.wsIn.id);
    const ids = (await accessibleWorkspaceIds(multi.id)).sort();
    expect(ids).toEqual([a.wsOut.id, b.wsIn.id].sort());
    expect(ids).not.toContain(b.wsOut.id);
  });

  it("is empty for someone who belongs to no organization, and for an org with no workspace", async () => {
    expect(await accessibleWorkspaceIds((await makeUser()).id)).toEqual([]);
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    expect(await accessibleWorkspaceIds(owner.id)).toEqual([]);
  });
});
