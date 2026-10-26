import { describe, expect, it } from "vitest";
import * as orderRoute from "@/app/api/workspaces/order/route";
import * as archiveRoute from "@/app/api/workspaces/[id]/archive/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { requireActor } from "@/server/policy/actor";
import { resolveCurrentSpace, spacesOf } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * MANAGING THE SPACES FROM «كل المساحات» (the owner's asks, 2026-10-26): the order he drags them into is the order of
 * every list (the switcher too), «الشركة» always first; an archived space leaves every list with everything in it kept,
 * and comes back; never «الشركة»; the OWNER and the ADMINs only.
 */

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const hq = await ensureHqSpace(orgId, "الشركة");
  const a = await makeWorkspace(orgId, [], `Alpha ${uid()}`);
  const b = await makeWorkspace(orgId, [], `Beta ${uid()}`);
  const c = await makeWorkspace(orgId, [], `Gamma ${uid()}`);
  return { ...team, orgId, hq, a, b, c };
}

const ids = async () => (await spacesOf(await requireActor())).map((s) => s.id);

describe("putting the spaces in order", () => {
  it("the dragged order is the order of every list, «الشركة» first", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await call(orderRoute.PUT, { method: "PUT", body: { ids: [w.c.id, w.a.id, w.b.id] } })).status).toBe(200);
    expect(await ids()).toEqual([w.hq, w.c.id, w.a.id, w.b.id]);

    // the switcher's list follows it
    const res = (await call(workspacesRoute.GET)).json as { organizations: Array<{ workspaces: Array<{ id: string }> }> };
    expect(res.organizations[0]!.workspaces.map((s) => s.id)).toEqual([w.hq, w.c.id, w.a.id, w.b.id]);
  });
});

describe("archiving a space", () => {
  it("off every list with its things kept; the person in it lands in «الشركة»; it comes back", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.b.id, userId: w.member.id, role: "MEMBER" } });
    const project = await db.project.create({ data: { workspaceId: w.b.id, name: `Kept ${uid()}` } });

    await loginAs(w.owner.id);
    expect((await call(archiveRoute.POST, { params: { id: w.b.id }, body: { archived: true } })).status).toBe(200);
    expect(await ids()).not.toContain(w.b.id);
    expect(await db.project.findUnique({ where: { id: project.id } })).not.toBeNull();

    // the member who was in it is in «الشركة» now, not in a space that is gone from the lists
    await loginAs(w.member.id);
    expect((await resolveCurrentSpace(await requireActor(), w.b.id))?.id).not.toBe(w.b.id);

    await loginAs(w.owner.id);
    expect((await call(archiveRoute.POST, { params: { id: w.b.id }, body: { archived: false } })).status).toBe(200);
    expect(await ids()).toContain(w.b.id);
  });

  it("never «الشركة» (409); a member manages nothing here (403)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const hq = await call(archiveRoute.POST, { params: { id: w.hq }, body: { archived: true } });
    expect(hq.status).toBe(409);
    expect(hq.json?.["message"]).toBe("spaces.archive_hq");

    const someone = await makeUser({ orgId: w.orgId, role: "MEMBER", name: `M ${uid()}` });
    await loginAs(someone.id);
    expect((await call(archiveRoute.POST, { params: { id: w.a.id }, body: { archived: true } })).status).toBe(403);
    expect((await call(orderRoute.PUT, { method: "PUT", body: { ids: [w.a.id] } })).status).toBe(403);
  });
});
