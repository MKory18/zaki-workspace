import { describe, expect, it } from "vitest";
import * as featuresRoute from "@/app/api/settings/features/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeCustomer } from "./guest-helpers";

/**
 * «صلاحيات الأقسام» in «الميزات» (the owner's rule, 2026-10-26: every new feature can be switched off, and off the
 * site is as before it). Off: the per-person section boxes are ignored at every door, kept in the database, and the
 * members screen is told so; on again, they count again.
 */
async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: lists });
}
const flip = (on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key: "sectionPermissions", on } });

describe("the section grid's switch", () => {
  it("off: a member whose ideas were closed and who was given goals is back on the rank's template; on: the boxes count again", async () => {
    const w = await makeTeam();
    await setBoxes(w.org.id, w.member.id, { capabilities: ["goals.edit"], revokedCapabilities: ["ideas.view"] });
    const goal = { title: "Ship the catalogue", period: "WEEKLY", anchorDate: "2026-11-02" };

    await loginAs(w.member.id);
    expect((await call(ideasRoute.GET, { url: "http://localhost/api/ideas" })).status).toBe(403);
    expect((await call(goalsRoute.POST, { body: goal })).status).toBe(201);

    await loginAs(w.owner.id);
    expect((await flip(false)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await call(ideasRoute.GET, { url: "http://localhost/api/ideas" })).status).toBe(200);
    expect((await call(goalsRoute.POST, { body: goal })).status).toBe(403);
    // nothing stored was lost
    const row = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      select: { capabilities: true, revokedCapabilities: true },
    });
    expect(row).toEqual({ capabilities: ["goals.edit"], revokedCapabilities: ["ideas.view"] });

    await loginAs(w.owner.id);
    expect((await flip(true)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await call(ideasRoute.GET, { url: "http://localhost/api/ideas" })).status).toBe(403);
  });

  it("off: deleting a customer follows editing again, as before the grid", async () => {
    const w = await makeTeam();
    const customer = await makeCustomer({ orgId: w.org.id, creatorId: w.owner.id });
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["crm.delete"] });
    await loginAs(w.owner.id);
    await flip(false);
    await loginAs(w.member.id);
    expect((await call(customerRoute.DELETE, { method: "DELETE", params: { id: customer.id } })).status).toBe(200);
  });

  it("the members screen is told whether the grid is on, and shows the template while it is off", async () => {
    const w = await makeTeam();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["ideas.view"] });
    await loginAs(w.owner.id);
    const before = await call(membersRoute.GET, { params: { id: w.org.id } });
    expect(before.json?.["sectionGrid"]).toBe(true);
    await flip(false);
    const after = await call(membersRoute.GET, { params: { id: w.org.id } });
    expect(after.json?.["sectionGrid"]).toBe(false);
    const member = (after.json?.["members"] as { id: string; effectiveCapabilities: string[] }[]).find((m) => m.id === w.member.id);
    expect(member?.effectiveCapabilities).toContain("ideas.view");
  });

  it("only the owner flips it", async () => {
    const w = await makeTeam();
    await loginAs(w.admin.id);
    expect((await flip(false)).status).toBe(403);
  });
});
