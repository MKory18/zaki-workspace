import { describe, expect, it } from "vitest";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as checklistRoute from "@/app/api/production/route";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * GOALS, DAILY ROUTINES AND CUSTOMERS BELONG TO A SPACE (the owner's decision, 2026-10-25: each space is like a
 * separate site). They are added in the space the person is in and read there; the ones from before spaces had their
 * own are read in «الشركة»; one of a space the person is not in is «not found».
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

/** «الشركة», space A (the admin) and space B (another admin), both admins able to manage goals and routines. */
async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const otherAdmin = await makeUser({ orgId, role: "ADMIN", name: `Admin B ${uid()}` });
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.createMany({ data: [team.admin, otherAdmin].map((p) => ({ workspaceId: hq, userId: p.id, role: "ADMIN" as const })), skipDuplicates: true });
  const a = await makeWorkspace(orgId, [{ userId: team.admin.id, role: "ADMIN" }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: otherAdmin.id, role: "ADMIN" }], `B ${uid()}`);
  return { ...team, otherAdmin, hq, a, b };
}

describe("goals", () => {
  it("are set in the space one is in, read there only, and «not found» from another space", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    enter(w.a.id);
    const made = await call(goalsRoute.POST, { body: { title: `Goal A ${uid()}`, period: "WEEKLY", anchorDate: "2026-10-25" } });
    expect(made.status).toBe(201);
    const id = (made.json?.["goal"] as { id: string }).id;
    expect((await db.goal.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } })).workspaceId).toBe(w.a.id);
    expect(((await call(goalsRoute.GET)).json?.["goals"] as unknown[]).length).toBe(1);

    await loginAs(w.otherAdmin.id);
    enter(w.b.id);
    expect((await call(goalsRoute.GET)).json?.["goals"]).toEqual([]);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { progress: 50 } })).status).toBe(404);
  });

  it("the goals from before spaces had their own are read in «الشركة»", async () => {
    const w = await world();
    const start = new Date();
    await db.goal.create({ data: { orgId: w.org.id, creatorId: w.owner.id, title: "Old goal", period: "WEEKLY", periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86_400_000) } });
    await loginAs(w.otherAdmin.id);
    enter(w.b.id);
    expect((await call(goalsRoute.GET)).json?.["goals"]).toEqual([]);
    enter(w.hq);
    expect(((await call(goalsRoute.GET)).json?.["goals"] as Array<{ title: string }>).map((g) => g.title)).toEqual(["Old goal"]);
  });
});

describe("daily routines", () => {
  it("are added in the space one is in; the day's checklist is that space's", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    enter(w.a.id);
    expect((await call(routinesRoute.POST, { body: { title: `Routine A ${uid()}` } })).status).toBe(201);
    expect(((await call(routinesRoute.GET)).json?.["routines"] as unknown[]).length).toBe(1);
    expect(((await call(checklistRoute.GET, { url: "http://localhost/api/production" })).json?.["items"] as unknown[]).length).toBe(1);

    await loginAs(w.otherAdmin.id);
    enter(w.b.id);
    expect((await call(routinesRoute.GET)).json?.["routines"]).toEqual([]);
    expect((await call(checklistRoute.GET, { url: "http://localhost/api/production" })).json?.["items"]).toEqual([]);
  });
});

describe("customers and opportunities", () => {
  it("a customer is added in the space one is in; its opportunity lives with it; another space neither lists nor opens them", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    enter(w.a.id);
    const customer = await call(customersRoute.POST, { body: { name: `Customer A ${uid()}` } });
    expect(customer.status).toBe(201);
    const customerId = (customer.json?.["customer"] as { id: string }).id;
    const opp = await call(opportunitiesRoute.POST, { body: { customerId, title: "Deal", value: 100, stage: "LEAD" } });
    expect(opp.status).toBe(201);
    expect((await db.opportunity.findFirstOrThrow({ where: { customerId }, select: { workspaceId: true } })).workspaceId).toBe(w.a.id);

    await loginAs(w.otherAdmin.id);
    enter(w.b.id);
    expect((await call(customersRoute.GET)).json?.["customers"]).toEqual([]);
    expect((await call(opportunitiesRoute.GET)).json?.["opportunities"]).toEqual([]);
    expect((await call(customerRoute.GET, { params: { id: customerId } })).status).toBe(404);
    // and no opportunity is hung on a customer of another space
    expect((await call(opportunitiesRoute.POST, { body: { customerId, title: "Steal", value: 1, stage: "LEAD" } })).status).toBe(404);
  });
});
