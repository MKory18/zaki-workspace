import { describe, expect, it } from "vitest";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import * as opportunityRoute from "@/app/api/crm/opportunities/[id]/route";
import { withHq } from "./hq-helpers";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { makeCustomer, makeOpportunity } from "./guest-helpers";

/** The distinctive "price" the guest must never see (`value` is price data). */
const PRICE = 987654;

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
  // a customer with no space is «الشركة»'s (2026-10-25): the company has it, with its staff in it (the guest is not)
  await withHq(team.org.id, [team.member.id, team.admin.id]);
  return { ...team, customer, opportunity };
}

describe("CRM: a GUEST is shut out completely", () => {
  it("refuses every read (customers, opportunities, prices) with 403", async () => {
    const w = await crmWorld();
    await loginAs(w.guest.id);

    const reads = [
      await call(customersRoute.GET),
      await call(customerRoute.GET, { params: { id: w.customer.id } }),
      await call(opportunitiesRoute.GET),
      await call(opportunityRoute.GET, { params: { id: w.opportunity.id } }),
    ];
    for (const res of reads) {
      expect(res.status).toBe(403);
      expect(res.json?.["error"]).toBe("forbidden");
      // nothing about the deal may be in the body: not the price, not the title, not the customer
      expect(res.text).not.toContain(String(PRICE));
      expect(res.text).not.toContain("Big contract");
      expect(res.text).not.toContain("Zeta Trading");
    }
  });

  it("refuses every write and changes nothing", async () => {
    const w = await crmWorld();
    await loginAs(w.guest.id);

    const createCustomer = await call(customersRoute.POST, { body: { name: "Planted customer" } });
    const patchCustomer = await call(customerRoute.PATCH, {
      method: "PATCH",
      params: { id: w.customer.id },
      body: { name: "Renamed by guest" },
    });
    const deleteCustomer = await call(customerRoute.DELETE, { method: "DELETE", params: { id: w.customer.id } });
    const createOpportunity = await call(opportunitiesRoute.POST, {
      body: { customerId: w.customer.id, title: "Planted deal", value: 1 },
    });
    const patchOpportunity = await call(opportunityRoute.PATCH, {
      method: "PATCH",
      params: { id: w.opportunity.id },
      body: { value: 1 },
    });
    const deleteOpportunity = await call(opportunityRoute.DELETE, {
      method: "DELETE",
      params: { id: w.opportunity.id },
    });

    for (const res of [createCustomer, patchCustomer, deleteCustomer, createOpportunity, patchOpportunity, deleteOpportunity]) {
      expect(res.status).toBe(403);
    }

    // the data is exactly as the owner left it
    expect(await db.customer.count({ where: { orgId: w.org.id } })).toBe(1);
    expect((await db.customer.findUniqueOrThrow({ where: { id: w.customer.id } })).name).toBe("Zeta Trading");
    expect(await db.opportunity.count({ where: { orgId: w.org.id } })).toBe(1);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } })).value).toBe(PRICE);
  });

  it("an anonymous caller still gets 401, not 403", async () => {
    const w = await crmWorld();
    logout();
    expect((await call(customersRoute.GET)).status).toBe(401);
    expect((await call(opportunityRoute.GET, { params: { id: w.opportunity.id } })).status).toBe(401);
  });
});

describe("CRM: everyone else keeps working access", () => {
  for (const role of ["member", "admin", "owner"] as const) {
    it(`${role.toUpperCase()} can read, create, edit and delete customers and opportunities`, async () => {
      const w = await crmWorld();
      // the amount is `prices.view`, a box of its own (security review C2): this test is about full
      // access, so the acting person holds it (tests/db/crm-prices.test.ts covers the member without it)
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: w.org.id, userId: w[role].id } },
        data: { capabilities: ["prices.view"] },
      });
      await loginAs(w[role].id);

      const list = await call(customersRoute.GET);
      expect(list.status).toBe(200);
      expect((list.json?.["customers"] as unknown[]).length).toBe(1);

      const created = await call(customersRoute.POST, { body: { name: "Fresh customer" } });
      expect(created.status).toBe(201);
      const newCustomerId = (created.json?.["customer"] as { id: string }).id;

      const patched = await call(customerRoute.PATCH, {
        method: "PATCH",
        params: { id: newCustomerId },
        body: { company: "Fresh Co" },
      });
      expect(patched.status).toBe(200);

      // prices are visible to staff who hold `prices.view`
      const opportunities = await call(opportunitiesRoute.GET);
      expect(opportunities.status).toBe(200);
      expect(opportunities.text).toContain(String(PRICE));
      const single = await call(opportunityRoute.GET, { params: { id: w.opportunity.id } });
      expect(single.status).toBe(200);
      expect((single.json?.["opportunity"] as { value: number }).value).toBe(PRICE);

      const deal = await call(opportunitiesRoute.POST, {
        body: { customerId: newCustomerId, title: "Staff deal", value: 500 },
      });
      expect(deal.status).toBe(201);
      const dealId = (deal.json?.["opportunity"] as { id: string }).id;
      expect(
        (await call(opportunityRoute.PATCH, { method: "PATCH", params: { id: dealId }, body: { stage: "WON" } })).status,
      ).toBe(200);
      expect((await call(opportunityRoute.DELETE, { method: "DELETE", params: { id: dealId } })).status).toBe(200);

      expect((await call(customerRoute.GET, { params: { id: newCustomerId } })).status).toBe(200);
      expect((await call(customerRoute.DELETE, { method: "DELETE", params: { id: newCustomerId } })).status).toBe(200);
    });
  }
});
