import { describe, expect, it } from "vitest";
import * as filesRoute from "@/app/api/files/route";
import * as fileRoute from "@/app/api/files/[id]/route";
import * as versionsRoute from "@/app/api/files/[id]/versions/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * EACH SPACE HAS ITS OWN LIBRARY (the owner's decision, 2026-10-25: a space is like a separate site). A file is
 * uploaded into the space the person is in and read there; a new version stays in its file's space; the files from
 * before spaces had libraries are read in «الشركة»; a file of a space one is not in is «not found».
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);

async function upload(name: string, route: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response> = filesRoute.POST as never, params: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([PNG], name, { type: "image/png" }));
  const res = await route(new Request("http://localhost/api/files", { method: "POST", body: form }), { params });
  return { status: res.status, json: (await res.json()) as { id: string } };
}
const names = async () => ((await call(filesRoute.GET)).json as { files: Array<{ name: string }> }).files.map((f) => f.name).sort();

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const alice = await makeUser({ orgId, role: "MEMBER", name: `Alice ${uid()}` });
  const bob = await makeUser({ orgId, role: "MEMBER", name: `Bob ${uid()}` });
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.createMany({ data: [alice, bob].map((p) => ({ workspaceId: hq, userId: p.id, role: "MEMBER" as const })) });
  const a = await makeWorkspace(orgId, [{ userId: alice.id }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: bob.id }], `B ${uid()}`);
  return { ...team, alice, bob, hq, a, b };
}

describe("a file lives in the space it was uploaded in", () => {
  it("an upload over the file ceiling is refused before the bytes are buffered", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    const form = new FormData();
    // 27 MB: over the 25 MB a library file may be (plus the multipart envelope), and nowhere near ingest
    form.set("file", new File([new Uint8Array(27 * 1024 * 1024)], "huge.png", { type: "image/png" }));
    const res = await filesRoute.POST(new Request("http://localhost/api/files", { method: "POST", body: form }));
    expect(res.status).toBe(413);
    expect((await res.json()) as { message: string }).toMatchObject({ message: "files.too_large" });
    expect(await names()).toEqual([]);
  });

  it("A's file is listed in A only; B neither lists nor opens it", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    const up = await upload("plan-a.png");
    expect(up.status).toBe(201);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: up.json.id }, select: { workspaceId: true } })).workspaceId).toBe(w.a.id);
    expect(await names()).toEqual(["plan-a.png"]);

    await loginAs(w.bob.id);
    enter(w.b.id);
    expect(await names()).toEqual([]);
    expect((await call(fileRoute.GET, { params: { id: up.json.id } })).status).toBe(404);
  });

  it("a new version stays in its file's space, whatever space it is sent from", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    enter(w.a.id);
    const first = await upload("report.png");
    enter(w.hq);
    const second = await upload("report.png", versionsRoute.POST as never, { id: first.json.id });
    expect(second.status).toBe(201);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: second.json.id }, select: { workspaceId: true } })).workspaceId).toBe(w.a.id);
    // and somebody of another space cannot add a version to it
    await loginAs(w.bob.id);
    enter(w.b.id);
    expect((await upload("report.png", versionsRoute.POST as never, { id: first.json.id })).status).toBe(404);
  });

  it("the files from before spaces had libraries are read in «الشركة»", async () => {
    const w = await world();
    const id = uid();
    await db.storedFile.create({
      data: { id, orgId: w.org.id, uploaderId: w.owner.id, familyId: id, name: "old.png", mimeType: "image/png", size: 4, path: id, purpose: "LIBRARY" },
    });
    await loginAs(w.bob.id);
    enter(w.b.id);
    expect(await names()).toEqual([]);
    enter(w.hq);
    expect(await names()).toEqual(["old.png"]);
  });
});
