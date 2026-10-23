import { describe, expect, it, vi } from "vitest";
import { MAX_SIDE, QUALITY, SKIP_BELOW_BYTES, compressImage } from "../src/lib/chat/compress-image";

/**
 * Pure behaviour of the client image compressor (FILES-VOICE deliverable 5).
 * `createImageBitmap`/OffscreenCanvas do not exist in Node, so everything after the
 * early-outs is exercised only in the browser; here we pin the DECISIONS.
 */
const BLOB = (type: string, size: number) => ({ size, type } as Blob);

describe("compress-image decisions", () => {
  it("skips small files", async () => {
    expect(SKIP_BELOW_BYTES).toBe(300 * 1024);
    expect(await compressImage(BLOB("image/jpeg", 1000), "small.jpg")).toBeNull();
  });

  it("skips GIFs (animation would die in a canvas)", async () => {
    expect(await compressImage(BLOB("image/gif", 400 * 1024), "anim.gif")).toBeNull();
    expect(await compressImage(BLOB("", 400 * 1024), "anim.gif")).toBeNull();
  });

  it("returns null (send as-is) when the browser cannot decode", async () => {
    expect(await compressImage(BLOB("image/heic", 400 * 1024), "photo.heic")).toBeNull();
  });

  it("reports the MIME type the canvas actually produced", async () => {
    const requested: string[] = [];
    class FakeCanvas {
      constructor(_width: number, _height: number) {}
      getContext() { return { drawImage() {} }; }
      async convertToBlob(options: { type: string }) {
        requested.push(options.type);
        // Simulate a browser that falls back when WebP encoding is unavailable.
        return new Blob(["compressed"], { type: options.type === "image/webp" ? "image/png" : options.type });
      }
    }
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3200, height: 1800, close() {} }));
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    try {
      const result = await compressImage(new Blob([new Uint8Array(400 * 1024)], { type: "image/jpeg" }), "large.jpg");
      expect(requested).toEqual(["image/webp"]);
      expect(result?.mime).toBe("image/png");
      expect(result?.blob.type).toBe(result?.mime);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("constants: longest side 1600 px, quality ~0.8", () => {
    expect(MAX_SIDE).toBe(1600);
    expect(QUALITY).toBe(0.8);
  });
});
