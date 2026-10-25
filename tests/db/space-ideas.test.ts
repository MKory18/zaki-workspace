import { describe, expect, it } from "vitest";
import * as ideasRoute from "@/app/api/ideas/route";
import * as ideaRoute from "@/app/api/ideas/[id]/route";
import * as shareRoute from "@/app/api/ideas/[id]/share/route";
import * as convertRoute from "@/app/api/ideas/[id]/convert/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * EACH SPACE HAS ITS OWN IDEAS (the owner's decision, 2026-10-25), and «شارك مع الشركة» shows one in «الشركة» too.
 * The road: فكرة → مراجعة → تخطيط → انطلقت, or مرفوضة; the managers of the idea's space move it along.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
type Ideas = { ideas: Array<{ id: string; title: string; shared: boolean; workspaceId: string | null }> };
const titles = async () => ((await call(ideasRoute.GET)).json as Ideas).ideas.map((i) => i.title).sort();

/** «الشركة», space A (alice, A's admin) and space B (bob). */
async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const alice = await makeUser({ orgId, role: "MEMBER", name: `Alice ${uid()}` });
  const bob = await makeUser({ orgId, role: "MEMBER", name: `Bob ${uid()}` });
  const lead = await makeUser({ orgId, role: "MEMBER", name: `A admin ${uid()}` });
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.createMany({ data: [alice, bob, lead].map((p) => ({ workspaceId: hq, userId: p.id, role: "MEMBER" as const })) });
  const a = await makeWorkspace(orgId, [{ userId: alice.id }, { userId: lead.id, role: "ADMIN" }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: bob.id }], `B ${uid()}`);
  return { ...team, alice, bob, lead, hq, a, b };
}

async function newIdea(spaceId: string, title: string) {
  enter(spaceId);
  const res = await call(ideasRoute.POST, { body: { title } });
  expect(res.status).toBe(201);
  return (res.json as { idea: { id: string } }).idea.id;
}

describe("an idea is born in its space and read there", () => {
  it("A's idea is A's; B never sees it; «الشركة» reads the old ideas (no space)", async () => {
    const w = await world();
    await db.idea.create({ data: { orgId: w.org.id, creatorId: w.owner.id, title: "old one" } });
    await loginAs(w.alice.id);
    const id = await newIdea(w.a.id, "faster packing");
    expect((await db.idea.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } })).workspaceId).toBe(w.a.id);
    expect(await titles()).toEqual(["faster packing"]);

    await loginAs(w.bob.id);
    enter(w.b.id);
    expect(await titles()).toEqual([]);
    enter(w.hq);
    expect(await titles()).toEqual(["old one"]);
    // and B's people cannot reach it by its id either
    expect((await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "mine now" } })).status).toBe(404);
  });

  it("«شارك مع الشركة» shows it in «الشركة» too (and taking it back hides it there)", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    const id = await newIdea(w.a.id, "share me");
    expect((await call(shareRoute.POST, { params: { id }, body: { shared: true } })).status).toBe(200);

    await loginAs(w.bob.id);
    enter(w.hq);
    expect(await titles()).toEqual(["share me"]);
    enter(w.b.id);
    expect(await titles()).toEqual([]); // shared with the company, not with another space

    await loginAs(w.alice.id);
    expect((await call(shareRoute.POST, { params: { id }, body: { shared: false } })).status).toBe(200);
    await loginAs(w.bob.id);
    enter(w.hq);
    expect(await titles()).toEqual([]);
  });

  it("only its author or the managers of its space share it", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    const id = await newIdea(w.a.id, "not yours");
    const other = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `Other ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.a.id, userId: other.id, role: "MEMBER" } });
    await loginAs(other.id);
    expect((await call(shareRoute.POST, { params: { id }, body: { shared: true } })).status).toBe(403);
    await loginAs(w.lead.id);
    expect((await call(shareRoute.POST, { params: { id }, body: { shared: true } })).status).toBe(200);
  });
});

describe("the road of an idea", () => {
  it("the space's admin moves it: review → planning → launched; a member does not", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    const id = await newIdea(w.a.id, "the road");
    expect((await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { status: "UNDER_REVIEW" } })).status).toBe(403);

    await loginAs(w.lead.id);
    for (const status of ["UNDER_REVIEW", "PLANNING", "LAUNCHED"]) {
      const res = await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { status } });
      expect(res.status, status).toBe(200);
    }
    // launched is the end
    expect((await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { status: "PLANNING" } })).status).toBe(403);
    // the company's admin is not a manager of A (an org ADMIN who is not in it)
    await loginAs(w.admin.id);
    expect((await call(ideaRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "taken over" } })).status).toBe(404);
  });

  it("turned into a task, the idea is being planned", async () => {
    const w = await world();
    const work = await makeProject(w.a.id, `PA ${uid()}`);
    await loginAs(w.alice.id);
    const id = await newIdea(w.a.id, "make it real");
    const res = await call(convertRoute.POST, { params: { id }, body: { workspaceId: w.a.id, projectId: work.project.id, boardId: work.board.id } });
    expect(res.status).toBe(200);
    expect((await db.idea.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("PLANNING");
  });
});
