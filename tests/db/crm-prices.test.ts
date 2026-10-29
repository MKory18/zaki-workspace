import { describe, expect, it } from "vitest";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import * as opportunityRoute from "@/app/api/crm/opportunities/[id]/route";
import { withHq } from "./hq-helpers";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";
import { makeCustomer, makeOpportunity } from "./guest-helpers";

/**
 * `prices.view` on the customers screen (security review C2).
 *
 * An opportunity's `value` is price data, and the switch that hides it is `prices.view` — a box of
 * its own, not a rank. A member of staff can read the whole opportunity (its title, its customer,
 * its stage) and still be denied the money: the amount comes back `null` and cannot be written.
 * Before the fix the screen only hid the button: every read answered the number and every write
 * accepted one, so the box was decoration.
 */

/** The amount that must never leave the server for somebody without the box. */
const PRICE = 928374;

interface OpportunityBody {
  id: string;
  value: number | null;
  stage: string;
}

interface CustomerBody {
  id: string;
  opportunities: { id: string; value: number | null }[];
}

async function crmWorld() {
  const team = await makeTeam();
  // the company space, so the customer (no space of its own) is read by everybody in it
  await withHq(team.org.id, [team.owner.id, team.admin.id, team.member.id]);
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

function opportunityOf(json: Record<string, unknown> | null): OpportunityBody {
  return json?.["opportunity"] as OpportunityBody;
}

function firstOpportunityOf(json: Record<string, unknown> | null): OpportunityBody {
  return (json?.["opportunities"] as OpportunityBody[])[0] as OpportunityBody;
}

function customerOf(json: Record<string, unknown> | null): CustomerBody {
  return json?.["customer"] as CustomerBody;
}

describe("CRM: an opportunity's amount is `prices.view`, not the screen", () => {
  it("a member without the box reads every row but never the number", async () => {
    const w = await crmWorld();
    await loginAs(w.member.id);

    const list = await call(opportunitiesRoute.GET);
    expect(list.status).toBe(200);
    expect(firstOpportunityOf(list.json).value).toBeNull();
    expect(list.text).not.toContain(String(PRICE));

    const one = await call(opportunityRoute.GET, { params: { id: w.opportunity.id } });
    expect(one.status).toBe(200);
    expect(opportunityOf(one.json).value).toBeNull();
    expect(opportunityOf(one.json).stage).toBe("LEAD");
    expect(one.text).not.toContain(String(PRICE));

    const customer = await call(customerRoute.GET, { params: { id: w.customer.id } });
    expect(customer.status).toBe(200);
    expect(customerOf(customer.json).opportunities.map((o) => o.value)).toEqual([null]);
    expect(customer.text).not.toContain(String(PRICE));
  });

  it("the primary owner and a member holding the box get the number", async () => {
    const w = await crmWorld();

    await loginAs(w.owner.id);
    expect(opportunityOf((await call(opportunityRoute.GET, { params: { id: w.opportunity.id } })).json).value).toBe(PRICE);

    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { capabilities: ["prices.view"] },
    });
    await loginAs(w.member.id);
    const list = await call(opportunitiesRoute.GET);
    expect(firstOpportunityOf(list.json).value).toBe(PRICE);
    expect(opportunityOf((await call(opportunityRoute.GET, { params: { id: w.opportunity.id } })).json).value).toBe(PRICE);
  });

  it("an OWNER who is not the primary owner loses the number when the box is taken away", async () => {
    const w = await crmWorld();
    const partner = await makeUser({ orgId: w.org.id, name: "Partner" });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } },
      data: { role: "OWNER", primaryOwner: false, revokedCapabilities: ["prices.view", "crm.edit"] },
    });

    await loginAs(partner.id);
    const one = await call(opportunityRoute.GET, { params: { id: w.opportunity.id } });
    expect(one.status).toBe(200);
    expect(opportunityOf(one.json).value).toBeNull();
    expect(one.text).not.toContain(String(PRICE));
  });

  it("a write of the amount is refused with 403 and nothing is stored", async () => {
    const w = await crmWorld();
    await loginAs(w.member.id);

    const patch = await call(opportunityRoute.PATCH, {
      method: "PATCH",
      params: { id: w.opportunity.id },
      body: { value: 4242 },
    });
    expect(patch.status).toBe(403);
    expect(patch.json?.["message"]).toBe("crm.prices_denied");
    const stored = await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } });
    expect(stored.value).toBe(PRICE);

    const create = await call(opportunitiesRoute.POST, {
      body: { customerId: w.customer.id, title: "Hidden amount", value: 5000 },
    });
    expect(create.status).toBe(403);
    expect(create.json?.["message"]).toBe("crm.prices_denied");
    expect(await db.opportunity.count({ where: { orgId: w.org.id, title: "Hidden amount" } })).toBe(0);
  });

  it("the rest of the opportunity is still theirs: a stage change passes, and a new row starts at 0", async () => {
    const w = await crmWorld();
    await loginAs(w.member.id);

    const stage = await call(opportunityRoute.PATCH, {
      method: "PATCH",
      params: { id: w.opportunity.id },
      body: { stage: "WON" },
    });
    expect(stage.status).toBe(200);
    expect(opportunityOf(stage.json).value).toBeNull();
    expect(stage.text).not.toContain(String(PRICE));
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } })).stage).toBe("WON");

    const created = await call(opportunitiesRoute.POST, {
      body: { customerId: w.customer.id, title: "No amount yet", value: 0 },
    });
    expect(created.status).toBe(201);
    expect(opportunityOf(created.json).value).toBeNull();
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opportunityOf(created.json).id } })).value).toBe(0);
  });

  it("with the box, the amount is written and read back", async () => {
    const w = await crmWorld();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { capabilities: ["prices.view"] },
    });
    await loginAs(w.member.id);

    const patch = await call(opportunityRoute.PATCH, {
      method: "PATCH",
      params: { id: w.opportunity.id },
      body: { value: 5150 },
    });
    expect(patch.status).toBe(200);
    expect(opportunityOf(patch.json).value).toBe(5150);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } })).value).toBe(5150);
  });

  it("a customer still lists its name and titles for a reader without the money", async () => {
    const w = await crmWorld();
    await loginAs(w.member.id);

    const customer = await call(customersRoute.GET);
    expect(customer.status).toBe(200);
    expect(customer.text).toContain("Zeta Trading");
  });
});
