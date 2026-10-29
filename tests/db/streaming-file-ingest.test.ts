import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-streaming-${process.pid}`;
});

import { MAX_FILE_BYTES } from "@/server/files/sniff";
import { ingest, fileLibrary } from "@/server/services/files";
import { db, makeTeam } from "./helpers";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file-backed ingest", () => {
  it("copies a temporary upload in chunks without requiring a byte array", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "zaki-stream-source-"));
    scratch.push(sourceDir);
    const source = join(sourceDir, "upload.part");
    await writeFile(source, PNG);
    const { org, member } = await makeTeam();

    const made = await ingest(
      { orgId: org.id, orgRole: "MEMBER", userId: member.id },
      { name: "photo.png", path: source, size: PNG.length, prefix: PNG.subarray(0, 8) },
    );

    const row = await db.storedFile.findUniqueOrThrow({ where: { id: made.id }, select: { path: true, size: true, mimeType: true } });
    await expect(readFile(join(fileLibrary, row.path))).resolves.toEqual(Buffer.from(PNG));
    expect(row).toMatchObject({ size: PNG.length, mimeType: "image/png" });
  });

  it("rejects an oversized file-backed input before creating a row", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "zaki-stream-source-"));
    scratch.push(sourceDir);
    const source = join(sourceDir, "too-large.part");
    await writeFile(source, PNG);
    const { org, member } = await makeTeam();

    await expect(
      ingest(
        { orgId: org.id, orgRole: "MEMBER", userId: member.id },
        { name: "photo.png", path: source, size: MAX_FILE_BYTES + 1, prefix: PNG.subarray(0, 8) },
      ),
    ).rejects.toMatchObject({ message: "files.too_large" });
    expect(await db.storedFile.count({ where: { orgId: org.id } })).toBe(0);
  });
});
