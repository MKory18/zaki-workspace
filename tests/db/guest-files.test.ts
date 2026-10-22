import { describe, expect, it, vi } from "vitest";

// Keep uploaded test files out of the repo. vi.hoisted runs before the imports, so it must not use any.
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-${process.pid}`;
});

import * as filesRoute from "@/app/api/files/route";
import * as fileRoute from "@/app/api/files/[id]/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as versionsRoute from "@/app/api/files/[id]/versions/route";
import { ingest } from "@/server/services/files";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

/** A tiny but valid-looking MP4: 'ftyp' at offset 4 is all the sniffer needs. */
function fakeMp4(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  for (let i = 12; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

/** POSTs a multipart upload to a route handler (the shared `call()` only speaks JSON). */
async function upload(handler: unknown, url: string, params: Record<string, string> = {}, name = "clip.mp4") {
  const form = new FormData();
  form.set("file", new File([fakeMp4(300) as BlobPart], name, { type: "video/mp4" }));
  const res = await (handler as Handler)(new Request(url, { method: "POST", body: form }), { params });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function libraryWithOneFile() {
  const team = await makeTeam();
  const file = await ingest(
    { orgId: team.org.id, orgRole: "MEMBER", userId: team.member.id },
    { name: "price-list-secret.mp4", bytes: fakeMp4(500) },
  );
  return { ...team, file };
}

describe("files: closed to a GUEST", () => {
  it("refuses the library, a file's details, its bytes, its versions and deleting it", async () => {
    const w = await libraryWithOneFile();
    await loginAs(w.guest.id);

    const attempts = [
      await call(filesRoute.GET),
      await call(fileRoute.GET, { params: { id: w.file.id } }),
      await call(rawRoute.GET, { params: { id: w.file.id } }),
      await call(rawRoute.GET, { params: { id: w.file.id }, headers: { range: "bytes=0-99" } }),
      await call(rawRoute.GET, { params: { id: w.file.id }, url: `http://localhost/api/files/${w.file.id}/raw?download=1` }),
      await call(fileRoute.DELETE, { method: "DELETE", params: { id: w.file.id } }),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("guest.no_access");
      expect(res.headers.get("content-type") ?? "").not.toContain("video");
      expect(res.text).not.toContain("price-list-secret");
    }
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: w.file.id } })).deletedAt).toBeNull();
  });

  it("cannot upload a file or a new version, and nothing is stored", async () => {
    const w = await libraryWithOneFile();
    await loginAs(w.guest.id);

    const first = await upload(filesRoute.POST, "http://localhost/api/files");
    expect(first.status).toBe(403);
    expect(first.json?.["message"]).toBe("guest.no_access");
    const version = await upload(versionsRoute.POST, `http://localhost/api/files/${w.file.id}/versions`, { id: w.file.id });
    expect(version.status).toBe(403);
    expect(version.json?.["message"]).toBe("guest.no_access");

    expect(await db.storedFile.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("an anonymous caller still gets 401", async () => {
    const w = await libraryWithOneFile();
    logout();
    expect((await call(filesRoute.GET)).status).toBe(401);
    expect((await call(rawRoute.GET, { params: { id: w.file.id } })).status).toBe(401);
  });
});

describe("files: everyone else keeps what they had", () => {
  for (const role of ["member", "admin", "owner"] as const) {
    it(`${role.toUpperCase()} can list, open, download, upload, version and (if allowed) delete`, async () => {
      const w = await libraryWithOneFile();
      await loginAs(w[role].id);

      const list = await call(filesRoute.GET);
      expect(list.status).toBe(200);
      expect(list.text).toContain("price-list-secret.mp4");

      const meta = await call(fileRoute.GET, { params: { id: w.file.id } });
      expect(meta.status).toBe(200);
      expect(meta.json?.["name"]).toBe("price-list-secret.mp4");

      const raw = await call(rawRoute.GET, { params: { id: w.file.id } });
      expect(raw.status).toBe(200);
      expect(raw.headers.get("content-length")).toBe("500");

      const made = await upload(filesRoute.POST, "http://localhost/api/files", {}, `${role}-upload.mp4`);
      expect(made.status).toBe(201);

      const newVersion = await upload(versionsRoute.POST, `http://localhost/api/files/${w.file.id}/versions`, { id: w.file.id });
      expect(newVersion.status).toBe(201);
      expect(newVersion.json?.["version"]).toBe(2);

      // the uploader of `made` (this user) may delete it
      const del = await call(fileRoute.DELETE, { method: "DELETE", params: { id: made.json?.["id"] as string } });
      expect(del.status).toBe(200);
    });
  }
});
