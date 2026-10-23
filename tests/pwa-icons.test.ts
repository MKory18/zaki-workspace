import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IconSpec } from "../scripts/make-icons.mjs";

/**
 * `sharp` (a dev dependency: Apache-2.0, its libvips binaries LGPL-3.0-or-later - public/brand/CREDITS.md, "Tooling")
 * draws and reads the icons through a native binary.
 * ⚠️ Where that binary cannot be loaded (an install without the optional platform package, node_modules copied from
 *    another operating system) importing sharp throws, and this whole file failed with it.
 * 🔧 The icon checks are skipped there instead - and only there: on CI the first test below fails when sharp does
 *    not load, so a broken install cannot quietly switch them off. scripts/make-icons.mjs imports sharp itself, so
 *    it is loaded only once sharp has loaded (and a mistake in the script still fails the file).
 */
const sharp = await import("sharp").then(
  (module) => module.default,
  () => null,
);
const script = sharp ? await import("../scripts/make-icons.mjs") : null;
const OUTPUTS: readonly IconSpec[] = script?.OUTPUTS ?? [];

const ROOT = path.resolve(__dirname, "..");
const file = (spec: IconSpec) => path.join(ROOT, spec.file);
const spec = (name: string): IconSpec => {
  const found = OUTPUTS.find((o) => o.file.endsWith(name));
  if (!found) throw new Error(`no icon ${name} in scripts/make-icons.mjs`);
  return found;
};

interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

/** RGBA pixels, whatever the file had (an opaque PNG gets an alpha of 255). */
async function raster(input: string | Buffer): Promise<Raster> {
  const { data, info } = await sharp!(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const channel = (img: Raster, x: number, y: number, c: number): number => img.data[(y * img.width + x) * 4 + c] ?? 0;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The background colour as [r, g, b]: the script's BACKGROUND ([0, 0, 0] only where the checks are skipped). */
const [BG_R, BG_G, BG_B]: [number, number, number] = script ? rgb(script.BACKGROUND) : [0, 0, 0];

/** How far (0..255) a pixel is from the background colour. */
const distanceFromBackground = (img: Raster, x: number, y: number): number =>
  Math.max(Math.abs(channel(img, x, y, 0) - BG_R), Math.abs(channel(img, x, y, 1) - BG_G), Math.abs(channel(img, x, y, 2) - BG_B));

/** The pixels that are part of the drawing (not background, not transparent), with their distance from the centre. */
function drawing(img: Raster): { count: number; farthest: number } {
  const cx = (img.width - 1) / 2;
  const cy = (img.height - 1) / 2;
  let count = 0;
  let farthest = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (channel(img, x, y, 3) < 200) continue;
      if (distanceFromBackground(img, x, y) <= 24) continue;
      count++;
      farthest = Math.max(farthest, Math.hypot(x - cx, y - cy));
    }
  }
  return { count, farthest };
}

it.runIf(process.env["CI"])("on CI sharp loads, so the icon checks below really run", () => {
  expect(sharp, "sharp could not be loaded: the icon checks would be skipped").not.toBeNull();
});

describe.skipIf(!sharp)("the app icons (scripts/make-icons.mjs renders src/app/icon.svg onto the default theme's surface colour)", () => {
  it("the script knows the four files the manifest and the Apple touch icon need", () => {
    expect(OUTPUTS.map((o) => `${o.file}:${o.size}:${o.kind}`).sort()).toEqual([
      "public/icons/icon-192.png:192:any",
      "public/icons/icon-512.png:512:any",
      "public/icons/icon-maskable-512.png:512:maskable",
      "src/app/apple-icon.png:180:apple",
    ]);
    expect(script!.BACKGROUND).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it.each(OUTPUTS.map((o) => [o.file, o] as const))("%s is a PNG of exactly the declared size", async (_name, o) => {
    const meta = await sharp!(file(o)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(o.size);
    expect(meta.height).toBe(o.size);
  });

  it.each(OUTPUTS.map((o) => [o.file, o] as const))("%s is small enough to ship in the repository (under 60 KB)", async (_name, o) => {
    const { size } = await import("node:fs").then((fs) => fs.statSync(file(o)));
    expect(size).toBeGreaterThan(1000);
    expect(size).toBeLessThan(60 * 1024);
  });

  it("the maskable icon is full-bleed and opaque (the system supplies the shape)", async () => {
    const img = await raster(file(spec("icon-maskable-512.png")));
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [256, 3], [3, 256]] as const) {
      expect(channel(img, x, y, 3), `alpha at ${x},${y}`).toBe(255);
      expect(distanceFromBackground(img, x, y), `colour at ${x},${y}`).toBeLessThanOrEqual(2);
    }
    let transparent = 0;
    for (let i = 3; i < img.data.length; i += 4) if ((img.data[i] ?? 255) < 255) transparent++;
    expect(transparent).toBe(0);
  });

  it("the maskable icon keeps the whole drawing inside the safe zone (a circle of 80% of the icon) and fills most of it", async () => {
    const o = spec("icon-maskable-512.png");
    const img = await raster(file(o));
    const { count, farthest } = drawing(img);
    expect(count).toBeGreaterThan(o.size * o.size * 0.06); // the mark is really there
    expect(farthest).toBeLessThanOrEqual(script!.SAFE_ZONE * o.size); // nothing a round mask would cut off
    expect(farthest).toBeGreaterThanOrEqual(script!.SAFE_ZONE * o.size * 0.8); // and it is not a speck in the middle
  });

  it("the Apple touch icon is opaque (iOS paints transparency black) with the mark clear of the rounded corners", async () => {
    const o = spec("apple-icon.png");
    const img = await raster(file(o));
    let transparent = 0;
    for (let i = 3; i < img.data.length; i += 4) if ((img.data[i] ?? 255) < 255) transparent++;
    expect(transparent).toBe(0);
    expect(distanceFromBackground(img, 0, 0)).toBeLessThanOrEqual(2);
    const { count, farthest } = drawing(img);
    expect(count).toBeGreaterThan(o.size * o.size * 0.06);
    expect(farthest).toBeLessThanOrEqual(script!.SAFE_ZONE * o.size);
  });

  it.each(["icon-192.png", "icon-512.png"])("%s (for any use) is a rounded tile: transparent corners, the surface colour inside, the mark in the middle", async (name) => {
    const o = spec(name);
    const img = await raster(file(o));
    const middle = Math.floor(o.size / 2);
    const last = o.size - 1;
    // the corners are cut away...
    for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]] as const) expect(channel(img, x, y, 3), `corner ${x},${y}`).toBe(0);
    // ...the middle of each edge is not
    for (const [x, y] of [[middle, 0], [0, middle], [last, middle], [middle, last]] as const) expect(channel(img, x, y, 3), `edge ${x},${y}`).toBe(255);
    // the tile is the surface colour, the drawing sits in the middle of it
    expect(distanceFromBackground(img, middle, 2)).toBeLessThanOrEqual(2);
    const { count, farthest } = drawing(img);
    expect(count).toBeGreaterThan(o.size * o.size * 0.08);
    expect(farthest).toBeLessThanOrEqual(0.46 * o.size);
  });

  it.each(OUTPUTS.map((o) => [o.file, o] as const))("%s is exactly what the script produces now (nobody changed icon.svg or the colour without running it)", async (_name, o) => {
    const committed = await raster(file(o));
    const fresh = await raster(await script!.renderIcon(o));
    expect(fresh.width).toBe(committed.width);
    expect(fresh.height).toBe(committed.height);
    let total = 0;
    for (let i = 0; i < committed.data.length; i++) total += Math.abs((committed.data[i] ?? 0) - (fresh.data[i] ?? 0));
    const meanDifference = total / committed.data.length;
    // a tolerance, not equality: anti-aliasing may differ by a hair between platforms
    expect(meanDifference).toBeLessThan(1.5);
  });
});
