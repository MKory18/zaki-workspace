#!/usr/bin/env node
/**
 * Draws the app icons: the dolphin mark of `src/app/icon.svg` on the default theme's surface colour.
 *
 *   node scripts/make-icons.mjs
 *
 * It needs `sharp` (a dev dependency) and writes four files, which are COMMITTED: the build does not run
 * this script, so nothing is drawn on the production server.
 *
 *   public/icons/icon-192.png           192x192  purpose "any"        a rounded tile, transparent corners
 *   public/icons/icon-512.png           512x512  purpose "any"        the same, bigger
 *   public/icons/icon-maskable-512.png  512x512  purpose "maskable"   full-bleed square; the system cuts the shape
 *   src/app/apple-icon.png              180x180  the iPhone home screen: opaque, full-bleed (iOS rounds it)
 *
 * The favicon (icon.svg) draws the mark on a dark rounded tile; the app icons bring their own background
 * instead, so that tile (the first <rect> of the SVG) is dropped and the mark alone is placed.
 *
 * "Maskable": Android may cut an icon to a circle, a squircle or a rounded square. Everything that matters
 * must lie inside the SAFE ZONE, a circle of 80% of the icon's width in the middle (radius 40% of the size).
 * The mark is therefore scaled until its farthest pixel is 38% of the size from the centre, and the
 * background runs to the edges. The same placement is used for the Apple icon (iOS rounds the corners).
 *
 * If you change `src/app/icon.svg` or the default theme's surface colour (src/lib/themes/palettes.ts), run
 * this again and commit the PNGs: tests/pwa-icons.test.ts draws them afresh and fails when the committed
 * files differ, and tests/pwa-manifest.test.ts checks the colour is the one the manifest and the theme use.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SVG = join(ROOT, "src/app/icon.svg");

/** The default theme's surface colour («ليل»: src/lib/themes/palettes.ts, `night`.surface). */
export const BACKGROUND = "#050F1F";

/** The maskable safe zone: a circle of this radius, as a fraction of the icon size, around the centre. */
export const SAFE_ZONE = 0.4;

/** How far from the centre the mark's farthest pixel may be, as a fraction of the icon size, per kind. */
const MARK_RADIUS = { any: 0.42, maskable: SAFE_ZONE - 0.02, apple: SAFE_ZONE - 0.02 };

/** The icons, where they go and what shape each is. */
export const OUTPUTS = [
  { file: "public/icons/icon-192.png", size: 192, kind: "any" },
  { file: "public/icons/icon-512.png", size: 512, kind: "any" },
  { file: "public/icons/icon-maskable-512.png", size: 512, kind: "maskable" },
  { file: "src/app/apple-icon.png", size: 180, kind: "apple" },
];

/** The mark is drawn once, large, and scaled down: downscaling keeps its edges crisp. */
const MARK_PIXELS = 1024;
/** A pixel counts as part of the mark from this opacity (0..255): the faint edge of the antialiasing does not. */
const VISIBLE = 16;

/** The mark alone (no background tile), as raw RGBA at MARK_PIXELS, with the box it occupies and its reach. */
async function loadMark() {
  const svg = readFileSync(ICON_SVG, "utf8");
  const markOnly = svg.replace(/<rect\b[^>]*\/>\s*/, "");
  if (markOnly === svg) throw new Error("src/app/icon.svg no longer starts with the background <rect>: update scripts/make-icons.mjs");
  const png = await sharp(Buffer.from(markOnly), { density: (72 * MARK_PIXELS) / 100 })
    .resize(MARK_PIXELS, MARK_PIXELS)
    .png()
    .toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) < VISIBLE) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error("the mark of src/app/icon.svg drew nothing");

  const centreX = (left + right + 1) / 2;
  const centreY = (top + bottom + 1) / 2;
  let reach = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) < VISIBLE) continue;
      reach = Math.max(reach, Math.hypot(x + 0.5 - centreX, y + 0.5 - centreY));
    }
  }
  return { png, left, top, width: right - left + 1, height: bottom - top + 1, reach };
}

/** A rounded square in the background colour, transparent in the corners (the tile of the "any" icons). */
function tile(size) {
  const radius = Math.round(size * 0.22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BACKGROUND}"/></svg>`;
  return sharp(Buffer.from(svg)).png();
}

/** One icon, as PNG bytes. */
export async function renderIcon({ size, kind }) {
  const mark = await loadMark();
  const scale = (MARK_RADIUS[kind] * size) / mark.reach;
  const width = Math.max(1, Math.round(mark.width * scale));
  const height = Math.max(1, Math.round(mark.height * scale));
  const cropped = await sharp(mark.png)
    .extract({ left: mark.left, top: mark.top, width: mark.width, height: mark.height })
    .resize(width, height, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  const place = { input: cropped, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) };

  if (kind === "any") {
    return tile(size).composite([place]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  }
  // maskable and apple: opaque, background to the edges
  return sharp({ create: { width: size, height: size, channels: 3, background: BACKGROUND } })
    .composite([place])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function main() {
  for (const spec of OUTPUTS) {
    const bytes = await renderIcon(spec);
    const target = join(ROOT, spec.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log(`${spec.file}  ${spec.size}x${spec.size}  ${spec.kind}  ${(bytes.length / 1024).toFixed(1)} KB`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
