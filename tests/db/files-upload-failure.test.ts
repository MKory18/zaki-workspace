import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, loginAs, makeTeam } from "./helpers";

/**
 * An upload that cannot be written must leave NOTHING behind.
 *
 * `ingest` creates the database row first (it needs the id for the file name) and writes the bytes
 * second. When the write failed - a root-owned bind mount makes every upload fail - the row stayed
 * for ever with `path = 'pending'`: the library listed a file that answered 404 on download.
 *
 * Each test loads a fresh copy of the service with the UPLOAD_DIR it needs (the folder is read once,
 * when the module is evaluated), and the environment is restored afterwards because the other files
 * of this suite share the process.
 */

type FilesService = typeof import("@/server/services/files");

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_V2 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9, 9]);

const savedUploadDir = process.env["UPLOAD_DIR"];
let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "zaki-upload-failure-"));
});

afterAll(() => {
  if (savedUploadDir === undefined) delete process.env["UPLOAD_DIR"];
  else process.env["UPLOAD_DIR"] = savedUploadDir;
  vi.resetModules();
  rmSync(scratch, { recursive: true, force: true });
});

/** A fresh copy of the service writing to `uploadDir`. */
async function serviceWith(uploadDir: string): Promise<FilesService> {
  process.env["UPLOAD_DIR"] = uploadDir;
  vi.resetModules();
  return import("@/server/services/files");
}

/** A folder nothing can be written to - on Windows and on Linux alike: it sits under a regular file. */
function unwritableDir(): string {
  const blocker = join(scratch, `blocker-${Math.random().toString(36).slice(2)}`);
  writeFileSync(blocker, "this is a file, not a folder");
  return join(blocker, "uploads");
}

function writableDir(): string {
  return join(scratch, `ok-${Math.random().toString(36).slice(2)}`);
}

async function team() {
  const { org, member } = await makeTeam();
  return { org, member, ctx: { orgId: org.id, orgRole: "MEMBER" as const, userId: member.id } };
}

describe("an upload that cannot be written leaves nothing behind", () => {
  it("a new file: no row, nothing listed", async () => {
    const { org, ctx } = await team();
    const svc = await serviceWith(unwritableDir());

    await expect(svc.ingest(ctx, { name: "photo.png", bytes: PNG })).rejects.toThrow();

    expect(await db.storedFile.count({ where: { orgId: org.id } })).toBe(0);
    expect(await svc.listFiles(org.id)).toEqual([]);
  });

  it("a new VERSION: the family stays exactly as it was, with its old head", async () => {
    const { org, ctx } = await team();
    const first = await (await serviceWith(writableDir())).ingest(ctx, { name: "photo.png", bytes: PNG });

    const broken = await serviceWith(unwritableDir());
    await expect(
      broken.ingest(ctx, { name: "photo.png", bytes: PNG_V2 }, { familyId: first.id, latestVersion: first.version }),
    ).rejects.toThrow();

    expect(await db.storedFile.count({ where: { familyId: first.id } })).toBe(1);
    expect(await db.storedFile.findUnique({ where: { id: first.id }, select: { isLatest: true } })).toEqual({ isLatest: true });
    const listed = await broken.listFiles(org.id);
    expect(listed.map((f) => [f.id, f.version, f.versions])).toEqual([[first.id, 1, 1]]);
  });

  it("through the API: POST /api/files fails and GET /api/files lists nothing (the reported scenario)", async () => {
    const { org, member } = await team();
    await serviceWith(unwritableDir());
    const route = await import("@/app/api/files/route");
    await loginAs(member.id);

    const form = new FormData();
    form.set("file", new File([PNG], "photo.png", { type: "image/png" }));
    const post = await route.POST(new Request("http://localhost/api/files", { method: "POST", body: form }));
    expect(post.status).toBeGreaterThanOrEqual(500);

    const list = await route.GET();
    expect(((await list.json()) as { files: unknown[] }).files).toEqual([]);
    expect(await db.storedFile.count({ where: { orgId: org.id } })).toBe(0);
  });
});

describe("rows the old behaviour left behind (path = 'pending') are invisible", () => {
  async function withGhosts() {
    const { org, member, ctx } = await team();
    const svc = await serviceWith(writableDir());
    const healthy = await svc.ingest(ctx, { name: "photo.png", bytes: PNG });
    const base = { orgId: org.id, uploaderId: member.id, mimeType: "image/png", size: 12, path: "pending" };
    // a first upload that failed: no family yet (the id was never written back)
    const ghostFile = await db.storedFile.create({ data: { ...base, familyId: "", name: "lost.png", version: 1 } });
    // a new version that failed: the old behaviour never demoted the real head, so this one is "latest" too
    const ghostVersion = await db.storedFile.create({
      data: { ...base, familyId: healthy.id, name: "photo.png", version: 2, isLatest: true },
    });
    return { org, svc, healthy, ghostFile, ghostVersion };
  }

  it("are not listed, and not counted as versions of a real file", async () => {
    const { org, svc, healthy } = await withGhosts();
    const listed = await svc.listFiles(org.id);
    expect(listed.map((f) => [f.id, f.version, f.versions])).toEqual([[healthy.id, 1, 1]]);
  });

  it("answer 'not found' for their metadata", async () => {
    const { org, svc, ghostFile, ghostVersion } = await withGhosts();
    await expect(svc.getFileMeta(org.id, ghostFile.id)).rejects.toMatchObject({ message: "files.not_found" });
    await expect(svc.getFileMeta(org.id, ghostVersion.id)).rejects.toMatchObject({ message: "files.not_found" });
  });

  it("never become the head of a real file, and are not in its version list", async () => {
    const { org, svc, healthy } = await withGhosts();
    const meta = await svc.getFileMeta(org.id, healthy.id);
    expect(meta.id).toBe(healthy.id);
    expect(meta.version).toBe(1);
    expect(meta.versions.map((v) => v.version)).toEqual([1]);
  });

  it("answer 'not found' (not 'missing storage') on download", async () => {
    const { org, svc, ghostFile } = await withGhosts();
    await expect(svc.readStored(org.id, ghostFile.id)).rejects.toMatchObject({ message: "files.not_found" });
  });
});

describe("a normal upload still works", () => {
  it("stores the bytes, lists the file, serves it back, and a new version takes over as head", async () => {
    const dir = writableDir();
    const { org, ctx } = await team();
    const svc = await serviceWith(dir);

    const first = await svc.ingest(ctx, { name: "photo.png", bytes: PNG });
    expect(first).toMatchObject({ version: 1, mimeType: "image/png" });
    expect((await svc.listFiles(org.id)).map((f) => [f.id, f.version, f.versions])).toEqual([[first.id, 1, 1]]);
    const back = await svc.readStored(org.id, first.id);
    expect(Buffer.compare(back.buffer, Buffer.from(PNG))).toBe(0);

    const second = await svc.ingest(ctx, { name: "photo.png", bytes: PNG_V2 }, { familyId: first.id, latestVersion: first.version });
    expect(second.version).toBe(2);
    expect((await svc.listFiles(org.id)).map((f) => [f.id, f.version, f.versions])).toEqual([[second.id, 2, 2]]);
    expect(await db.storedFile.findUnique({ where: { id: first.id }, select: { isLatest: true } })).toEqual({ isLatest: false });
    expect(await db.storedFile.findUnique({ where: { id: second.id }, select: { isLatest: true, path: true } })).toMatchObject({ isLatest: true });
    expect(readdirSync(join(dir, org.id))).toHaveLength(2);
  });
});
