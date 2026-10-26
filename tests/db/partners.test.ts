import { describe, expect, it } from "vitest";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as statusRoute from "@/app/api/organizations/[id]/members/[userId]/status/route";
import * as listRoute from "@/app/api/organizations/[id]/members/route";
import { requireActor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { call, db, loginAs, makeTeam, makeUser, uid } from "./helpers";

/**
 * PARTNERS AS OWNERS (the owner's decision, 2026-10-26): the company's primary owner alone makes a person an OWNER (a
 * partner), unmakes one, and takes a permission away from one — which that partner then cannot give back to himself or
 * to anybody. Nobody administers the primary owner. A partner reads like an owner (private DMs too: the owner's choice).
 */

type Roster = { actorPrimaryOwner: boolean; members: Array<{ id: string; role: string; primaryOwner: boolean; effectiveCapabilities: string[] }> };

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const lead = await makeUser({ orgId, role: "LEAD", name: `Lead ${uid()}` });
  return { ...team, orgId, lead };
}

const patch = (orgId: string, userId: string, body: Record<string, unknown>) =>
  call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body });

describe("the primary owner makes a partner", () => {
  it("an ADMIN made OWNER is a partner with every permission, and reads like an owner", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await patch(w.orgId, w.admin.id, { role: "OWNER" })).status).toBe(200);
    const row = await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.admin.id } } });
    expect(row).toMatchObject({ role: "OWNER", primaryOwner: false });

    const roster = (await call(listRoute.GET, { params: { id: w.orgId } })).json as unknown as Roster;
    expect(roster.actorPrimaryOwner).toBe(true);
    expect(roster.members.find((m) => m.id === w.admin.id)).toMatchObject({ role: "OWNER", primaryOwner: false });
    expect(roster.members.find((m) => m.id === w.owner.id)).toMatchObject({ primaryOwner: true });

    // a private DM between two others: the partner reads it silently, like the primary owner
    const dm = await db.conversation.create({ data: { orgId: w.orgId, kind: "DM", dmKey: `${w.member.id}|${w.lead.id}`, members: { create: [{ userId: w.member.id }, { userId: w.lead.id }] } } });
    expect(await canReadConversation(w.admin.id, dm.id)).toBe(true);
  });

  it("a permission taken away from a partner: gone, and he can neither take it back nor hand it to anybody", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await patch(w.orgId, w.admin.id, { role: "OWNER" });
    expect((await patch(w.orgId, w.admin.id, { revokedCapabilities: ["crm.edit"] })).status).toBe(200);

    await loginAs(w.admin.id);
    const partner = await requireActor();
    expect(partner.role).toBe("OWNER");
    expect(partner.isPrimaryOwner).toBe(false);
    expect(partner.caps.has("crm.edit")).toBe(false);
    expect(partner.caps.has("users.manage")).toBe(true);

    // he cannot hand it to somebody else…
    const toLead = await patch(w.orgId, w.lead.id, { capabilities: ["crm.edit"] });
    expect(toLead.status).toBe(403);
    // …nor give it back to himself (nobody edits themselves), nor touch the primary owner
    expect((await patch(w.orgId, w.admin.id, { revokedCapabilities: [] })).status).toBe(403);
    expect((await patch(w.orgId, w.owner.id, { role: "ADMIN" })).status).toBe(403);
  });

  it("a partner neither makes nor unmakes an OWNER; only the primary owner unmakes a partner", async () => {
    const w = await world();
    const second = await makeUser({ orgId: w.orgId, role: "ADMIN", name: `Second ${uid()}` });
    await loginAs(w.owner.id);
    await patch(w.orgId, w.admin.id, { role: "OWNER" });
    await patch(w.orgId, second.id, { role: "OWNER" });

    await loginAs(w.admin.id);
    expect((await patch(w.orgId, w.lead.id, { role: "OWNER" })).status).toBe(403);
    expect((await patch(w.orgId, second.id, { role: "ADMIN" })).status).toBe(403);
    expect((await call(statusRoute.POST, { params: { id: w.orgId, userId: w.owner.id }, body: { action: "suspend" } })).status).toBe(403);
    // what an owner does below him still works: a partner re-ranks a lead
    expect((await patch(w.orgId, w.lead.id, { role: "MEMBER" })).status).toBe(200);

    await loginAs(w.owner.id);
    expect((await patch(w.orgId, second.id, { role: "ADMIN" })).status).toBe(200);
    expect((await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: w.orgId, userId: second.id } } })).role).toBe("ADMIN");
  });
});
