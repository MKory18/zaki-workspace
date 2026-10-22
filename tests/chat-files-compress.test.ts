import { describe, expect, it } from "vitest";
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

  it("constants: longest side 1600 px, quality ~0.8", () => {
    expect(MAX_SIDE).toBe(1600);
    expect(QUALITY).toBe(0.8);
  });
});
