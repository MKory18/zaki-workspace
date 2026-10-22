import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

/**
 * Uploads must land on the volume. The compose file and the Dockerfile mount it
 * at /app/storage/uploads; the code used to write to <cwd>/.data/uploads, which
 * the non-root runtime user cannot even create. `UPLOAD_DIR` is the single switch.
 */

const original = process.env["UPLOAD_DIR"];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (original === undefined) delete process.env["UPLOAD_DIR"];
  else process.env["UPLOAD_DIR"] = original;
});

async function libraryPath(): Promise<string> {
  const mod = await import("../src/server/services/files");
  return mod.fileLibrary;
}

describe("fileLibrary (where uploaded files are written)", () => {
  it("is UPLOAD_DIR when it is set", async () => {
    process.env["UPLOAD_DIR"] = "/app/storage/uploads";
    expect(await libraryPath()).toBe("/app/storage/uploads");
  });

  it("falls back to <cwd>/.data/uploads when UPLOAD_DIR is not set (local development)", async () => {
    delete process.env["UPLOAD_DIR"];
    expect(await libraryPath()).toBe(join(process.cwd(), ".data", "uploads"));
  });

  it("treats an empty UPLOAD_DIR as not set (compose passes empty strings through)", async () => {
    process.env["UPLOAD_DIR"] = "";
    expect(await libraryPath()).toBe(join(process.cwd(), ".data", "uploads"));
  });
});
