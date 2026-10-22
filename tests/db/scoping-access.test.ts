import { describe, expect, it } from "vitest";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { db, makeOrg, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace, makeScopedOrg } from "./scoping-helpers";

/**
 * `accessibleWorkspaceIds` is the single rule behind search, My Work, List,
 * Calendar, Analytics and idea→task. These tests pin it so none of them can
 * drift apart again.
 */
describe("accessibleWorkspaceIds", () => {
  it("OWNER and ADMIN inherit every workspace of their org; MEMBER and GUEST only the ones they were put in", async () => {
    const f = await makeScopedOrg();
    const all = [f.wsIn.id, f.wsOut.id].sort();
    expect((await accessibleWorkspaceIds(f.owner.id)).sort()).toEqual(all);
    expect((await accessibleWorkspaceIds(f.admin.id)).sort()).toEqual(all);
    expect(await accessibleWorkspaceIds(f.member.id)).toEqual([f.wsIn.id]);
    expect(await accessibleWorkspaceIds(f.guest.id)).toEqual([]);
    await joinWorkspace(f.guest.id, f.wsOut.id, "GUEST");
    expect(await accessibleWorkspaceIds(f.guest.id)).toEqual([f.wsOut.id]);
  });

  it("a workspace created later is inherited by the owner/admin at once, not by a member", async () => {
    const f = await makeScopedOrg();
    const fresh = await makeWorkspace(f.org.id, [], "Brand new");
    expect(await accessibleWorkspaceIds(f.admin.id)).toContain(fresh.id);
    expect(await accessibleWorkspaceIds(f.member.id)).not.toContain(fresh.id);
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

  it("covers several orgs, each by its own role, and never mixes them up", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsOut.id);
    await joinOrg(multi.id, b.org.id, "ADMIN");
    const ids = (await accessibleWorkspaceIds(multi.id)).sort();
    expect(ids).toEqual([a.wsOut.id, b.wsIn.id, b.wsOut.id].sort());
    expect(ids).not.toContain(a.wsIn.id);
  });

  it("is empty for someone who belongs to no organization, and for an org with no workspace", async () => {
    expect(await accessibleWorkspaceIds((await makeUser()).id)).toEqual([]);
    const org = await makeOrg();
    const owner = await makeUser({ orgId: org.id, role: "OWNER" });
    expect(await accessibleWorkspaceIds(owner.id)).toEqual([]);
  });
});
