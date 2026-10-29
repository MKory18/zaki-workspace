import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";

/**
 * The ceiling itself (security review D2): a body is refused while it is being read, not after it is
 * all in memory. The n8n inbound webhook answers without a session, so this is the only thing between
 * an anonymous caller and the container's memory.
 */

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", { method: "POST", body, headers });

describe("readTextLimited", () => {
  it("returns exactly the text `req.text()` would have returned, Arabic included", async () => {
    const text = JSON.stringify({ title: "مهمة جديدة", note: "سطر\nآخر" });
    expect(await readTextLimited(post(text), 1024 * 1024)).toBe(text);
    expect(await readTextLimited(post(""), 10)).toBe("");
    expect(await readTextLimited(new Request("http://localhost/x"), 10)).toBe("");
  });

  it("refuses a body bigger than the ceiling instead of holding it", async () => {
    const big = "x".repeat(64 * 1024);
    await expect(readTextLimited(post(big), 32 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readTextLimited(post(big), 32 * 1024)).rejects.toMatchObject({ maxBytes: 32 * 1024 });
  });

  it("accepts a body exactly at the ceiling", async () => {
    const exact = "y".repeat(4096);
    expect(await readTextLimited(post(exact), 4096)).toBe(exact);
  });

  it("believes a declared length that is already too big, without reading the body", async () => {
    // a caller can send the header and then a small body: the answer is still «too big», and nothing is read
    const req = post("small", { "content-length": String(10 * 1024 * 1024) });
    await expect(readTextLimited(req, 1024 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("does not trust a missing or nonsense length: the stream is counted", async () => {
    const req = post("x".repeat(2048), { "content-length": "not-a-number" });
    await expect(readTextLimited(req, 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
