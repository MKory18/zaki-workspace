import { describe, expect, it } from "vitest";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as ideaRoute from "@/app/api/ideas/[id]/route";
import * as productionRoute from "@/app/api/production/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as routineRoute from "@/app/api/production/routines/[id]/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeRoutine } from "./guest-helpers";

/**
 * The per-person section grid (the owner's decision, 2026-10-26): «يشوف / يضيف ويعدّل / يحذف» per section, enforced by
 * the server, with each rank's template giving exactly what it could do before the grid.
 */
async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: lists,
  });
}

const goal = { title: "Ship the catalogue", period: "WEEKLY", anchorDate: "2026-11-02" };

describe("section grid: the templates keep today's behaviour", () => {
  it("a member reads goals but does not manage them; an admin does", async () => {
    const w = await makeTeam();
    await loginAs(w.member.id);
    expect((await call(goalsRoute.GET)).status).toBe(200);
    const refused = await call(goalsRoute.POST, { body: goal });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("goals.role_denied");

    await loginAs(w.admin.id);
    expect((await call(goalsRoute.POST, { body: goal })).status).toBe(201);
  });
});

describe("section grid: a box the owner ticks or unticks is the server's answer", () => {
  it("a member given goals «يضيف ويعدّل» creates and edits a goal, but without «يحذف» can not delete it", async () => {
    const w = await makeTeam();
    await setBoxes(w.org.id, w.member.id, { capabilities: ["goals.edit"] });
    await loginAs(w.member.id);

    const created = await call(goalsRoute.POST, { body: goal });
    expect(created.status).toBe(201);
    const id = (created.json?.["goal"] as { id: string }).id;
    const edit = await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { progress: 40 } });
    expect(edit.status).toBe(200);

    const del = await call(goalRoute.DELETE, { method: "DELETE", params: { id } });
    expect(del.status).toBe(403);
    expect(await db.goal.count({ where: { id } })).toBe(1);
  });

  it("ideas switched off for a member: the list, a new idea and an existing one are all closed", async () => {
    const w = await makeTeam();
    await loginAs(w.member.id);
    const created = await call(ideasRoute.POST, { body: { title: "Night shift bonus" } });
    expect(created.status).toBe(201);
    const id = (created.json?.["idea"] as { id: string }).id;

    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["ideas.view"] });
    const list = await call(ideasRoute.GET, { url: "http://localhost/api/ideas" });
    expect(list.status).toBe(403);
    expect(list.json?.["message"]).toBe("section.view_denied");
    expect(list.text).not.toContain("Night shift bonus");
    expect((await call(ideasRoute.POST, { body: { title: "Another one" } })).status).toBe(403);
    // add/edit and delete fall with «يشوف», even on the person's own idea
    const del = await call(ideaRoute.DELETE, { method: "DELETE", params: { id } });
    expect(del.status).toBe(403);
    expect(await db.idea.count({ where: { id } })).toBe(1);
  });

  it("ideas «يحذف» taken away: the member still adds and edits, but can not delete even their own idea", async () => {
    const w = await makeTeam();
    await setBoxes(w.org.id, w.member.id, { revokedCapabilities: ["ideas.delete"] });
    await loginAs(w.member.id);
    const created = await call(ideasRoute.POST, { body: { title: "Packaging idea" } });
    expect(created.status).toBe(201);
    const id = (created.json?.["idea"] as { id: string }).id;
    expect((await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "Better packaging" } })).status).toBe(200);
    const del = await call(ideaRoute.DELETE, { method: "DELETE", params: { id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("section.delete_denied");
  });

  it("an admin without production «يحذف» edits a routine but can not delete it; without «يشوف» reads nothing", async () => {
    const w = await makeTeam();
    const routine = await makeRoutine({ orgId: w.org.id, title: "Cut the fabric" });
    await setBoxes(w.org.id, w.admin.id, { revokedCapabilities: ["production.delete"] });
    await loginAs(w.admin.id);

    const edit = await call(routineRoute.PATCH, { method: "PATCH", params: { id: routine.id }, body: { title: "Cut and fold" } });
    expect(edit.status).toBe(200);
    const del = await call(routineRoute.DELETE, { method: "DELETE", params: { id: routine.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("production.routines_role_denied");
    expect(await db.routine.count({ where: { id: routine.id } })).toBe(1);

    await setBoxes(w.org.id, w.admin.id, { revokedCapabilities: ["production.view"] });
    const day = await call(productionRoute.GET, { url: "http://localhost/api/production?day=2026-11-02" });
    expect(day.status).toBe(403);
    expect(day.json?.["message"]).toBe("section.view_denied");
    expect((await call(routinesRoute.GET)).status).toBe(403);
    // and with «يشوف» gone, «يضيف ويعدّل» goes too
    const blind = await call(routineRoute.PATCH, { method: "PATCH", params: { id: routine.id }, body: { title: "Renamed" } });
    expect(blind.status).toBe(403);
  });

  it("a partner (an OWNER who is not primary) loses a box the primary owner takes away", async () => {
    const w = await makeTeam();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } },
      data: { role: "OWNER", primaryOwner: false, revokedCapabilities: ["goals.edit"] },
    });
    await loginAs(w.admin.id);
    expect((await call(goalsRoute.GET)).status).toBe(200);
    expect((await call(goalsRoute.POST, { body: goal })).status).toBe(403);

    await loginAs(w.owner.id);
    expect((await call(goalsRoute.POST, { body: goal })).status).toBe(201);
  });
});
