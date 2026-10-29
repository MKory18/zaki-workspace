/**
 * Search answers the section grid, not only the space: `/api/search` runs the same capability checks every
 * other view runs (`tasks.view`, `projects.view`, `files.view`). Taking a box away from one person must take
 * their rows out of the search answer too — otherwise the box is decoration and search is the back door.
 */
import { describe, expect, it } from "vitest";
import * as searchRoute from "@/app/api/search/route";
import * as filesRoute from "@/app/api/files/route";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";
import { seedWork } from "./scoping-helpers";
import { SPACE_COOKIE } from "@/server/services/current-space";

interface SearchBody {
  tasks: { id: string; title: string }[];
  projects: { id: string; name: string }[];
  files: { id: string; name: string }[];
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);

/** Enter a space (src/server/services/current-space.ts): search looks inside the space the person is in. */
const enter = (spaceId: string) =>
  (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

async function setBoxes(orgId: string, userId: string, lists: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: lists,
  });
}

async function search(q: string) {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` });
  return { status: res.status, body: res.json as unknown as SearchBody };
}

async function upload(name: string) {
  const form = new FormData();
  form.set("file", new File([PNG], name, { type: "image/png" }));
  const res = await (filesRoute.POST as unknown as (req: Request) => Promise<Response>)(
    new Request("http://localhost/api/files", { method: "POST", body: form }),
  );
  return { status: res.status, json: (await res.json()) as { id: string; name?: string } };
}

describe("search: the section grid's «يشوف» boxes hold inside search too", () => {
  it("revoking «المهام: يشوف» hides the task from search and leaves the project; revoking it as well hides both", async () => {
    const team = await makeTeam();
    const token = `sq${uid()}`;
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `S ${token}`);
    const work = await seedWork({
      orgId: team.org.id,
      workspaceId: ws.id,
      token,
      label: "visible",
      creatorId: team.owner.id,
    });
    await loginAs(team.member.id);
    enter(ws.id);

    const before = await search(token);
    expect(before.status).toBe(200);
    expect(before.body.tasks.map((t) => t.id)).toEqual([work.task.id]);
    expect(before.body.projects.map((p) => p.id)).toEqual([work.project.id]);

    // no «tasks.view»: the task is out, the project is still there
    await setBoxes(team.org.id, team.member.id, { revokedCapabilities: ["tasks.view"] });
    const noTasks = await search(token);
    expect(noTasks.status).toBe(200);
    expect(noTasks.body.tasks).toEqual([]);
    expect(noTasks.body.projects.map((p) => p.id)).toEqual([work.project.id]);
    expect(JSON.stringify(noTasks.body)).not.toContain(work.task.id);

    // no «projects.view» either: the project goes as well
    await setBoxes(team.org.id, team.member.id, { revokedCapabilities: ["tasks.view", "projects.view"] });
    const neither = await search(token);
    expect(neither.status).toBe(200);
    expect(neither.body.tasks).toEqual([]);
    expect(neither.body.projects).toEqual([]);
    expect(JSON.stringify(neither.body)).not.toContain(work.project.id);

    // the boxes back: both found again (nothing was deleted)
    await setBoxes(team.org.id, team.member.id, { revokedCapabilities: [] });
    const after = await search(token);
    expect(after.body.tasks.map((t) => t.id)).toEqual([work.task.id]);
    expect(after.body.projects.map((p) => p.id)).toEqual([work.project.id]);
  });

  it("revoking «المكتبة: يشوف» hides the file from search; giving it back returns it", async () => {
    const team = await makeTeam();
    const token = `sf${uid()}`;
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `F ${token}`);
    await loginAs(team.member.id);
    enter(ws.id);

    const up = await upload(`${token}-contract.png`);
    expect(up.status).toBe(201);

    const before = await search(token);
    expect(before.status).toBe(200);
    expect(before.body.files.map((f) => f.id)).toEqual([up.json.id]);

    await setBoxes(team.org.id, team.member.id, { revokedCapabilities: ["files.view"] });
    const hidden = await search(token);
    expect(hidden.status).toBe(200);
    expect(hidden.body.files).toEqual([]);
    expect(JSON.stringify(hidden.body)).not.toContain(up.json.id);

    await setBoxes(team.org.id, team.member.id, { revokedCapabilities: [] });
    const back = await search(token);
    expect(back.body.files.map((f) => f.id)).toEqual([up.json.id]);
  });
});
