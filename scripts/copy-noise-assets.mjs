// Copies the call noise filter (RNNoise as WebAssembly, and the audio worklet that runs it) into public/noise/, so the
// browser loads it from this app, never from a public CDN (src/components/calls/noise-filter.ts). Run by `npm run
// build` and `npm run dev`; the folder is not tracked (.gitignore).
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "node_modules", "@sapphi-red", "web-noise-suppressor", "dist");
const to = path.join(root, "public", "noise");
const FILES = [
  ["rnnoise.wasm", "rnnoise.wasm"],
  ["rnnoise_simd.wasm", "rnnoise_simd.wasm"],
  [path.join("rnnoise", "workletProcessor.js"), "rnnoise-worklet.js"],
];

if (!existsSync(from)) {
  console.error(`copy-noise-assets: ${from} is missing (run npm ci first)`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const [src, dest] of FILES) copyFileSync(path.join(from, src), path.join(to, dest));
console.log("copy-noise-assets: the noise filter copied to public/noise");
