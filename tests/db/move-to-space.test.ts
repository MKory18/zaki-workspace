import { describe, expect, it } from "vitest";
import * as listRoute from "@/app/api/spaces/unplaced/route";
import * as moveRoute from "@/app/api/spaces/unplaced/move/route";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «انقل لمساحة» (the plan, 2026-10-25): the company's things from before spaces had their own carry no space and are
 * read in «الشركة». The OWNER and the ADMINs list them and move them into a space they can open; a file moves with
 * all its versions, a customer with its opportunities that have no space; a space's own things never move from here.
 */

type Row = { kind: string; id: string; title: string };

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const owner = team.owner;
  const a = await makeWorkspace(orgId, [], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [], `B ${uid()}`);
  const idea = await db.idea.create({ data: { orgId, creatorId: owner.id, title: `Old idea ${uid()}` } });
  const placed = await db.idea.create({ data: { orgId, creatorId: owner.id, title: `B idea ${uid()}`, workspaceId: b.id } });
  const family = `f_${uid()}`;
  const file = (version: number, isLatest: boolean) =>
    db.storedFile.create({
      data: { orgId, uploaderId: owner.id, familyId: family, name: "plan.pdf", mimeType: "application/pdf", size: 1, path: `p_${uid()}`, purpose: "LIBRARY", version, isLatest },
    });
  const v1 = await file(1, false);
  const v2 = await file(2, true);
  const goal = await db.goal.create({ data: { orgId, creatorId: owner.id, title: `Goal ${uid()}`, period: "MONTHLY", periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") } });
  const routine = await db.routine.create({ data: { orgId, title: `Routine ${uid()}` } });
  const customer = await db.customer.create({ data: { orgId, creatorId: owner.id, name: `Customer ${uid()}` } });
  const opportunity = await db.opportunity.create({ data: { orgId, number: Math.floor(Math.random() * 1e6), customerId: customer.id, ownerId: owner.id, title: `Deal ${uid()}` } });
  return { ...team, orgId, a, b, idea, placed, v1, v2, goal, routine, customer, opportunity };
}

const move = (kind: string, ids: string[], spaceId: string) => call(moveRoute.POST, { body: { kind, ids, spaceId } });

describe("the things with no space, and moving them", () => {
  it("the OWNER lists each kind of old thing (a file once, by its latest version) — never a space's own", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(listRoute.GET);
    expect(res.status).toBe(200);
    const rows = (res.json as { rows: Row[] }).rows;
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([w.idea.id, w.v2.id, w.goal.id, w.routine.id, w.customer.id, w.opportunity.id]));
    expect(ids).not.toContain(w.v1.id);
    expect(ids).not.toContain(w.placed.id);
    expect(rows.find((r) => r.id === w.v2.id)).toMatchObject({ kind: "file", title: "plan.pdf" });
  });

  it("moves them into a space: a file with all its versions, a customer with its opportunities; a space's own thing stays", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const ideas = await move("idea", [w.idea.id, w.placed.id], w.a.id);
    expect(ideas.status).toBe(200);
    expect(ideas.json?.["moved"]).toBe(1);
    expect((await db.idea.findUniqueOrThrow({ where: { id: w.idea.id } })).workspaceId).toBe(w.a.id);
    expect((await db.idea.findUniqueOrThrow({ where: { id: w.placed.id } })).workspaceId).toBe(w.b.id);

    await move("file", [w.v2.id], w.a.id);
    expect((await db.storedFile.findMany({ where: { familyId: w.v1.familyId }, select: { workspaceId: true } })).map((f) => f.workspaceId)).toEqual([w.a.id, w.a.id]);

    await move("customer", [w.customer.id], w.b.id);
    expect((await db.customer.findUniqueOrThrow({ where: { id: w.customer.id } })).workspaceId).toBe(w.b.id);
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } })).workspaceId).toBe(w.b.id);

    for (const [kind, id] of [["goal", w.goal.id], ["routine", w.routine.id]] as const) {
      expect((await move(kind, [id], w.a.id)).json?.["moved"]).toBe(1);
    }
    const left = ((await call(listRoute.GET)).json as { rows: Row[] }).rows.map((r) => r.id);
    expect(left.filter((id) => [w.idea.id, w.v2.id, w.goal.id, w.routine.id, w.customer.id, w.opportunity.id].includes(id))).toEqual([]);
  });

  it("only the OWNER and the ADMINs (403); an ADMIN only into a space they are in", async () => {
    const w = await world();
    const member = await makeUser({ orgId: w.orgId, role: "MEMBER", name: `Member ${uid()}` });
    await loginAs(member.id);
    expect((await call(listRoute.GET)).status).toBe(403);
    expect((await move("idea", [w.idea.id], w.a.id)).status).toBe(403);

    await loginAs(w.admin.id);
    expect((await move("idea", [w.idea.id], w.a.id)).status).toBe(404);
    expect((await db.idea.findUniqueOrThrow({ where: { id: w.idea.id } })).workspaceId).toBeNull();
    await db.workspaceMember.create({ data: { workspaceId: w.a.id, userId: w.admin.id, role: "MEMBER" } });
    expect((await move("idea", [w.idea.id], w.a.id)).status).toBe(200);
  });
});
