import { describe, expect, it } from "vitest";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import * as opportunityRoute from "@/app/api/crm/opportunities/[id]/route";
import { getProfileForViewer, memberDirectory } from "@/server/services/users";
import { getDepartment, listDepartments } from "@/server/services/departments";
import { getN8nStatus } from "@/server/services/n8n";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";
import { makeCustomer, makeDepartment, makeOpportunity, seedN8n, N8N_HOOK } from "./guest-helpers";
import { ctxOf, setCapabilities } from "./active-helpers";

/**
 * "The permission switches really switch things": the owner turns a single capability off (or on)
 * for one person and the server follows - the rank only supplies the starting point.
 */

const PRICE = 424242;

async function crmWorld() {
  const team = await makeTeam();
  const customer = await makeCustomer({ orgId: team.org.id, creatorId: team.owner.id, name: "Zeta Trading" });
  const opportunity = await makeOpportunity({
    orgId: team.org.id,
    customerId: customer.id,
    ownerId: team.owner.id,
    value: PRICE,
    title: "Big contract",
  });
  return { ...team, customer, opportunity };
}

/** Every write the CRM offers, as one call each: customers and opportunities, create/edit/delete. */
async function everyCrmWrite(w: Awaited<ReturnType<typeof crmWorld>>) {
  return [
    await call(customersRoute.POST, { body: { name: "Planted customer" } }),
    await call(customerRoute.PATCH, { method: "PATCH", params: { id: w.customer.id }, body: { name: "Renamed" } }),
    await call(customerRoute.DELETE, { method: "DELETE", params: { id: w.customer.id } }),
    await call(opportunitiesRoute.POST, { body: { customerId: w.customer.id, title: "Planted deal", value: 1 } }),
    await call(opportunityRoute.PATCH, { method: "PATCH", params: { id: w.opportunity.id }, body: { stage: "WON" } }),
    await call(opportunityRoute.DELETE, { method: "DELETE", params: { id: w.opportunity.id } }),
  ];
}

/** Every read the CRM offers. */
async function everyCrmRead(w: Awaited<ReturnType<typeof crmWorld>>) {
  return [
    await call(customersRoute.GET),
    await call(customerRoute.GET, { params: { id: w.customer.id } }),
    await call(opportunitiesRoute.GET),
    await call(opportunityRoute.GET, { params: { id: w.opportunity.id } }),
  ];
}

async function expectCrmUntouched(w: Awaited<ReturnType<typeof crmWorld>>) {
  expect(await db.customer.count({ where: { orgId: w.org.id } })).toBe(1);
  expect((await db.customer.findUniqueOrThrow({ where: { id: w.customer.id } })).name).toBe("Zeta Trading");
  expect(await db.opportunity.count({ where: { orgId: w.org.id } })).toBe(1);
  const deal = await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } });
  expect(deal.value).toBe(PRICE);
  expect(deal.stage).toBe("LEAD");
}

describe("CRM: crm.edit switches writing, crm.view switches reading", () => {
  it("a MEMBER whose crm.edit was taken away can still read everything but change nothing (403 insufficient_role)", async () => {
    const w = await crmWorld();
    await setCapabilities(w.org.id, w.member.id, { revokedCapabilities: ["crm.edit"] });
    await loginAs(w.member.id);

    for (const res of await everyCrmRead(w)) expect(res.status).toBe(200);
    for (const res of await everyCrmWrite(w)) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
    }
    await expectCrmUntouched(w);
  });

  it("an ADMIN whose crm.edit was taken away is held to the same", async () => {
    const w = await crmWorld();
    await setCapabilities(w.org.id, w.admin.id, { revokedCapabilities: ["crm.edit"] });
    await loginAs(w.admin.id);
    for (const res of await everyCrmWrite(w)) expect(res.status).toBe(403);
    expect((await call(opportunitiesRoute.GET)).status).toBe(200);
    await expectCrmUntouched(w);
  });

  it("a MEMBER whose crm.view was taken away reads nothing: no customers, no deals, no prices", async () => {
    const w = await crmWorld();
    await setCapabilities(w.org.id, w.member.id, { revokedCapabilities: ["crm.view"] });
    await loginAs(w.member.id);

    for (const res of await everyCrmRead(w)) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
      expect(res.text).not.toContain(String(PRICE));
      expect(res.text).not.toContain("Big contract");
      expect(res.text).not.toContain("Zeta Trading");
    }
  });

  it("the default ranks keep what they had: a LEAD and a MEMBER read and write, a GUEST is shut out as before", async () => {
    const w = await crmWorld();
    const lead = await makeUser({ orgId: w.org.id, role: "LEAD", name: "Team lead" });
    for (const person of [lead, w.member]) {
      await loginAs(person.id);
      for (const res of await everyCrmRead(w)) expect(res.status).toBe(200);
      const created = await call(customersRoute.POST, { body: { name: `Customer of ${person.name}` } });
      expect(created.status).toBe(201);
    }

    await loginAs(w.guest.id);
    for (const res of [...(await everyCrmRead(w)), ...(await everyCrmWrite(w))]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("guest.no_access");
    }
  });

  it("switching crm.edit on for somebody who already has it changes nothing; a GUEST never gets it, whatever is stored", async () => {
    const w = await crmWorld();
    await setCapabilities(w.org.id, w.member.id, { capabilities: ["crm.edit"] });
    await loginAs(w.member.id);
    expect((await call(customersRoute.POST, { body: { name: "Fresh customer" } })).status).toBe(201);

    await setCapabilities(w.org.id, w.guest.id, { capabilities: ["crm.view", "crm.edit"] });
    await loginAs(w.guest.id);
    expect((await call(customersRoute.GET)).status).toBe(403);
    expect((await call(customersRoute.POST, { body: { name: "Planted customer" } })).status).toBe(403);
  });
});

describe("the staff directory: directory.view switches it, users.manage switches the manager's extras", () => {
  async function directoryWorld() {
    const team = await makeTeam();
    const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Colleague" });
    await db.user.update({ where: { id: colleague.id }, data: { jobTitle: "Accountant" } });
    return { ...team, colleague };
  }

  it("a MEMBER whose directory.view was taken away gets a 403 instead of the directory", async () => {
    const w = await directoryWorld();
    await setCapabilities(w.org.id, w.member.id, { revokedCapabilities: ["directory.view"] });
    await expect(memberDirectory(w.member.id)).rejects.toMatchObject({ name: "ForbiddenError", message: "insufficient_role" });
  });

  it("...and cannot read a colleague's profile by id either (their own stays open)", async () => {
    const w = await directoryWorld();
    await setCapabilities(w.org.id, w.member.id, { revokedCapabilities: ["directory.view"] });
    await expect(getProfileForViewer(w.member.id, w.colleague.id)).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "insufficient_role",
    });
    const own = await getProfileForViewer(w.member.id, w.member.id);
    expect(own.kind).toBe("full");
  });

  it("an ADMIN whose directory.view was taken away is refused too", async () => {
    const w = await directoryWorld();
    await setCapabilities(w.org.id, w.admin.id, { revokedCapabilities: ["directory.view"] });
    await expect(memberDirectory(w.admin.id)).rejects.toMatchObject({ name: "ForbiddenError", message: "insufficient_role" });
  });

  it("a team lead sees the directory by default", async () => {
    const w = await directoryWorld();
    const lead = await makeUser({ orgId: w.org.id, role: "LEAD", name: "Team lead" });
    const org = (await memberDirectory(lead.id))[0]!;
    expect(org.members.map((m) => m.name)).toContain("Colleague");
    expect(org.canManage).toBe(false);
    expect(org.members.every((m) => m.email === null)).toBe(true);
  });

  it("a guest keeps the names-only view and never gets the capability, whatever is stored", async () => {
    const w = await directoryWorld();
    await setCapabilities(w.org.id, w.guest.id, { capabilities: ["directory.view", "users.manage"] });
    const org = (await memberDirectory(w.guest.id))[0]!;
    expect(org.restricted).toBe(true);
    expect(org.canManage).toBe(false);
    expect(org.members.every((m) => m.email === null && m.jobTitle === null)).toBe(true);
  });

  it("e-mail addresses and the manager's panel follow users.manage, not the rank", async () => {
    const w = await directoryWorld();
    // a MEMBER the owner made a people manager
    await setCapabilities(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    const asManager = (await memberDirectory(w.member.id))[0]!;
    expect(asManager.canManage).toBe(true);
    expect(asManager.members.find((m) => m.name === "Colleague")?.email).toBe(w.colleague.email);

    // an ADMIN who may no longer manage people
    await setCapabilities(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    const asPlainAdmin = (await memberDirectory(w.admin.id))[0]!;
    expect(asPlainAdmin.canManage).toBe(false);
    expect(asPlainAdmin.members.every((m) => m.email === null)).toBe(true);
  });
});

describe("the departments area is part of the staff directory, so directory.view switches it too", () => {
  async function departmentWorld() {
    const team = await makeTeam();
    const dept = await makeDepartment(team.org.id, { memberIds: [team.member.id], name: "IT desk" });
    return { ...team, dept };
  }
  const asMember = (w: Awaited<ReturnType<typeof departmentWorld>>) => ctxOf(w.org.id, w.member.id);

  it("a MEMBER whose directory.view was taken away gets 403 insufficient_role for the list and for one department", async () => {
    const w = await departmentWorld();
    await setCapabilities(w.org.id, w.member.id, { revokedCapabilities: ["directory.view"] });
    await expect(listDepartments(asMember(w))).rejects.toMatchObject({ name: "ForbiddenError", message: "insufficient_role" });
    await expect(getDepartment(asMember(w), w.dept.id)).rejects.toMatchObject({ name: "ForbiddenError", message: "insufficient_role" });
  });

  it("a team lead and a member keep reading them, and a guest keeps the message they always got", async () => {
    const w = await departmentWorld();
    const lead = await makeUser({ orgId: w.org.id, role: "LEAD", name: "Team lead" });
    for (const ctx of [asMember(w), ctxOf(w.org.id, lead.id, "LEAD")]) {
      expect((await listDepartments(ctx)).map((d) => d.name)).toEqual(["IT desk"]);
      expect((await getDepartment(ctx, w.dept.id)).name).toBe("IT desk");
    }
    await expect(listDepartments(ctxOf(w.org.id, w.guest.id, "GUEST"))).rejects.toMatchObject({ message: "guest.no_access" });
    await expect(getDepartment(ctxOf(w.org.id, w.guest.id, "GUEST"), w.dept.id)).rejects.toMatchObject({ message: "guest.no_access" });
  });
});

describe("n8n status: the webhook address is shown to whoever holds integrations.manage", () => {
  it("a role on its own gives the rank's default (OWNER and ADMIN yes, everybody else no)", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    expect((await getN8nStatus(t.org.id, "OWNER")).webhookUrl).toBe(N8N_HOOK);
    expect((await getN8nStatus(t.org.id, "ADMIN")).webhookUrl).toBe(N8N_HOOK);
    for (const role of ["LEAD", "MEMBER", "GUEST"]) {
      const status = await getN8nStatus(t.org.id, role);
      expect(status.webhookUrl, role).toBeNull();
      expect(status.events, role).toEqual([]);
    }
    // no viewer given: the caller already knows it is a manager
    expect((await getN8nStatus(t.org.id)).webhookUrl).toBe(N8N_HOOK);
  });

  it("a person is judged by their own switches: a MEMBER granted the capability sees it, an ADMIN who lost it does not", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    await setCapabilities(t.org.id, t.member.id, { capabilities: ["integrations.manage"] });
    await setCapabilities(t.org.id, t.admin.id, { revokedCapabilities: ["integrations.manage"] });

    expect((await getN8nStatus(t.org.id, { userId: t.member.id })).webhookUrl).toBe(N8N_HOOK);
    expect((await getN8nStatus(t.org.id, { userId: t.owner.id })).webhookUrl).toBe(N8N_HOOK);
    expect((await getN8nStatus(t.org.id, { userId: t.admin.id })).webhookUrl).toBeNull();
    expect((await getN8nStatus(t.org.id, { userId: t.guest.id })).webhookUrl).toBeNull();
  });

  it("a suspended person is not a manager, whatever they were granted", async () => {
    const t = await makeTeam();
    await seedN8n(t.org.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.admin.id } },
      data: { status: "SUSPENDED" },
    });
    expect((await getN8nStatus(t.org.id, { userId: t.admin.id })).webhookUrl).toBeNull();
  });
});
