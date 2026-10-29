import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { UploadStreamError, receiveUpload } from "@/server/files/upload-stream";

async function* chunks(parts: string[], pause = 0): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield new TextEncoder().encode(part);
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

describe("receiveUpload", () => {
  it("writes chunks to a unique temporary file without joining them in memory", async () => {
    const received = await receiveUpload(chunks(["first-", "second", "-third"]), {
      name: "report.txt",
      maxBytes: 100,
      tempDir: ".data/test-upload-stream",
    });

    await expect(fs.readFile(received.path, "utf8")).resolves.toBe("first-second-third");
    expect(received.size).toBe(18);
    expect(new TextDecoder().decode(received.prefix)).toBe("first-second-third");
    await received.cleanup();
    await expect(fs.access(received.path)).rejects.toThrow();
  });

  it("keeps only the configured prefix in memory", async () => {
    const received = await receiveUpload(chunks(["1234", "5678", "90"]), {
      name: "large.txt",
      maxBytes: 100,
      prefixBytes: 4,
      tempDir: ".data/test-upload-stream",
    });

    expect(received.size).toBe(10);
    expect(new TextDecoder().decode(received.prefix)).toBe("1234");
    await received.cleanup();
  });

  it("rejects an empty upload and removes its temporary file", async () => {
    await expect(
      receiveUpload(chunks([]), {
        name: "empty.txt",
        maxBytes: 100,
        tempDir: ".data/test-upload-stream",
      }),
    ).rejects.toMatchObject({ kind: "empty" });
  });

  it("rejects one byte over the limit and removes the partial file", async () => {
    const promise = receiveUpload(chunks(["12345", "6"]), {
      name: "too-large.txt",
      maxBytes: 5,
      tempDir: ".data/test-upload-stream",
    });

    await expect(promise).rejects.toMatchObject({ kind: "too_large" });
    await expect(promise).rejects.toBeInstanceOf(UploadStreamError);
  });

  it("gives concurrent uploads different temporary paths", async () => {
    const [one, two] = await Promise.all([
      receiveUpload(chunks(["one"]), { name: "same.txt", maxBytes: 100, tempDir: ".data/test-upload-stream" }),
      receiveUpload(chunks(["two"]), { name: "same.txt", maxBytes: 100, tempDir: ".data/test-upload-stream" }),
    ]);

    expect(one.path).not.toBe(two.path);
    await Promise.all([one.cleanup(), two.cleanup()]);
  });
});
