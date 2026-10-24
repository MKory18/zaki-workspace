import { describe, expect, it } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { addOrgToHq } from "@/server/chat/hq";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * «الشركة» (the HQ space) is the whole company's announcements and talk, not a place for work: everybody is in
 * it, so a project there would be seen by everybody (the owner's decision, 2026-10-25: «اعزل كل مساحة عمل»).
 * The server refuses a new project there; the list of spaces says so, so the «مشروع جديد» form does not offer it.
 */

const createProject = (body: unknown) => call(projectsRoute.POST, { body });

async function world() {
  const team = await makeTeam();
  await addOrgToHq(team.org.id);
  const hq = await db.workspace.findFirstOrThrow({ where: { organizationId: team.org.id, kind: "HQ" }, select: { id: true } });
  const work = await makeWorkspace(team.org.id, [{ userId: team.member.id, role: "MEMBER" }, { userId: team.admin.id, role: "ADMIN" }], `Work ${uid()}`);
  return { ...team, hq, work };
}

describe("no project is opened in «الشركة»", () => {
  it.each(["owner", "admin", "member"] as const)("a %s is refused (403 projects.not_in_hq), and nothing is created", async (who) => {
    const w = await world();
    await loginAs(w[who].id);
    const name = `In HQ ${uid()}`;
    const res = await createProject({ workspaceId: w.hq.id, name });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("projects.not_in_hq");
    expect(await db.project.findFirst({ where: { name } })).toBeNull();
  });

  it("the same person opens it in a work space as before (the control)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const name = `In work ${uid()}`;
    expect((await createProject({ workspaceId: w.work.id, name })).status).toBe(201);
    expect((await db.project.findFirst({ where: { name } }))?.workspaceId).toBe(w.work.id);
  });

  it("the list of spaces marks «الشركة» as holding no project, and every other space as holding them", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(workspacesRoute.GET, {});
    const spaces = (res.json?.["organizations"] as Array<{ workspaces: Array<{ id: string; holdsProjects: boolean }> }>)[0]!.workspaces;
    expect(spaces.find((s) => s.id === w.hq.id)?.holdsProjects).toBe(false);
    expect(spaces.find((s) => s.id === w.work.id)?.holdsProjects).toBe(true);
  });

  it("the Arabic sentence says why", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    expect(AR["projects.not_in_hq"]).toMatch(/«الشركة»/);
  });
});
