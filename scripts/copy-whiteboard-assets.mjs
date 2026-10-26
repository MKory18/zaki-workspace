// Copies Excalidraw's fonts into public/excalidraw/ so the whiteboard loads them from this app, never from a public
// CDN (src/components/whiteboard/whiteboard-screen.tsx sets window.EXCALIDRAW_ASSET_PATH = "/excalidraw/"). Run by
// `npm run build` and `npm run dev`; the folder is not tracked (.gitignore). The Chinese / Japanese face «Xiaolai»
// (13 MB) is left out: such text falls back to the browser's own fonts.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const to = path.join(root, "public", "excalidraw", "fonts");
const LEFT_OUT = new Set(["Xiaolai"]);

if (!existsSync(from)) {
  console.error(`copy-whiteboard-assets: ${from} is missing (run npm ci first)`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const face of readdirSync(from)) {
  if (LEFT_OUT.has(face)) continue;
  cpSync(path.join(from, face), path.join(to, face), { recursive: true });
}
console.log(`copy-whiteboard-assets: fonts copied to public/excalidraw/fonts`);
