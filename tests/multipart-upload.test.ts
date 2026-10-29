import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMultipartUpload } from "@/server/files/multipart";
import { UploadStreamError } from "@/server/files/upload-stream";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function requestWith(file: Uint8Array, maxBytes = 100, name = "payload.bin"): Promise<Request> {
  const form = new FormData();
  form.set("kind", "FILE");
  form.set("durationMs", "1200");
  form.set("file", new Blob([new Uint8Array(file)]), name);
  return new Request("http://localhost/upload", { method: "POST", body: form });
}

describe("parseMultipartUpload", () => {
  it("streams the file to disk and returns fields plus a bounded prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaki-multipart-"));
    tempDirs.push(dir);
    const received = await parseMultipartUpload(await requestWith(new TextEncoder().encode("0123456789")), {
      fieldName: "file",
      maxBytes: 100,
      tempDir: dir,
    });

    expect(received.fields).toEqual({ kind: "FILE", durationMs: "1200" });
    expect(received.upload.name).toBe("payload.bin");
    expect(received.upload.size).toBe(10);
    expect(new TextDecoder().decode(received.upload.prefix)).toBe("0123456789");
    await expect(readFile(received.upload.path, "utf8")).resolves.toBe("0123456789");
    await received.upload.cleanup();
  });

  it("decodes UTF-8 filenames and accepts a file exactly at the limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaki-multipart-"));
    tempDirs.push(dir);
    const received = await parseMultipartUpload(
      await requestWith(new TextEncoder().encode("12345"), 5, "تقرير.pdf"),
      { fieldName: "file", maxBytes: 5, tempDir: dir },
    );

    expect(received.upload.name).toBe("تقرير.pdf");
    expect(received.upload.size).toBe(5);
    await received.upload.cleanup();
  });

  it("rejects an oversized multipart file and removes the temporary part", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zaki-multipart-"));
    tempDirs.push(dir);
    await expect(
      parseMultipartUpload(await requestWith(new TextEncoder().encode("0123456789")), {
        fieldName: "file",
        maxBytes: 5,
        tempDir: dir,
      }),
    ).rejects.toMatchObject({ kind: "too_large" });
    await expect(readdir(dir)).resolves.toEqual([]);
  });
});
