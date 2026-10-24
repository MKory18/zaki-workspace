# Brand and decoration assets — origin and licences

Everything in `public/brand/`, `public/fonts/` and `public/icons/` is listed here (and the Apple icon in
`src/app/`). A file that is not listed does not belong in the repository (the repository is public).

| File | What it is | Origin / licence |
|---|---|---|
| `brand/decor/islamic-calm.{rosette,corner,skyline}.webp` | Geometric ornament masks for the "إسلامي هادي" theme (white on transparent, tinted by the theme colour in CSS) | The owner's own artwork, made for the OMS and copied from `MKory18/Zaki-ai-CRM` (`public/brand/decor`). Geometry and architecture only: no calligraphy, no text, no people. No third-party material. |
| `brand/decor/islamic-epic.{rosette,corner,skyline}.webp` | The same for the "إسلامي ملحمي" theme | Same as above. |
| `brand/decor/neon-coast.{door,door-tall,strip}.webp` | Opaque backgrounds for the "ساحل النيون" theme: a night coast road with neon light (wide, tall and a thin strip) | The owner's own image generations for the OMS (copied from the same place). Original work: not taken from any game or film, no logo, no text. |
| `brand/decor/day.webp` | A very faint ornament mask for the "نهاري" theme | Same as the Islamic masks. |
| `fonts/reem-kufi-var.woff2` | Reem Kufi (variable, Arabic subset) for the Islamic themes' headings | SIL Open Font License 1.1, text in `fonts/reem-kufi-OFL.txt`. The Reserved Font Name is "Josefin Sans": keep the name "Reem Kufi" and do not rename the font. |
| `icons/icon-192.png`, `icons/icon-512.png` (in `public/`) | The app icon for "any" use (the web app manifest): the dolphin mark on the default theme's paper colour, on a rounded tile with transparent corners | The project's own logo (`src/app/icon.svg`), drawn by `scripts/make-icons.mjs`. No third-party material. |
| `icons/icon-maskable-512.png` (in `public/`) | The maskable app icon: full-bleed paper colour, the mark inside the 80% safe zone so a round or squircle mask cuts nothing | Same as above. |
| `src/app/apple-icon.png` (served by Next at `/apple-icon.png`, outside `public/`) | The iPhone home-screen icon, 180x180, opaque | Same as above. |

IBM Plex Sans Arabic (the body font) is loaded through `next/font/google` at build time and is
also SIL OFL 1.1.

Rules for new files: say who made it and under what licence, keep photos and masks under 150 KB,
and never add anything that reproduces a third party's game, film, brand or character.

## Tooling

`sharp` (a dev dependency, Apache-2.0) is what draws the PNG icons above from `src/app/icon.svg`
(`node scripts/make-icons.mjs`; the PNGs are committed and the build never runs the script) and what
`tests/pwa-icons.test.ts` and `tests/pwa-manifest.test.ts` read them with. Its native image library comes as
separate binary packages (`@img/sharp-libvips-*`), licensed **LGPL-3.0-or-later**.

- ⚠️ The Docker image installs every dependency (`npm ci`) and its runner stage copies the whole
  `node_modules`, so those LGPL binaries ship inside the production image, and the app uses them: the chat
  reads an uploaded image's width and height with sharp (`src/server/chat/attachments.ts`, a runtime
  `import("sharp")`; without it the dimensions are left out and the upload still works). 🔧 Give the runner stage production dependencies only (then none of it ships), or keep the binaries
  unmodified, as npm installs them, and put the LGPL-3.0 text beside them in the image (their `package.json`
  names the licence; the package folders carry no licence file of their own).
- ⚠️ On a machine where sharp's binary cannot be loaded, the icon checks are skipped instead of failing.
  🔧 On CI they are never skipped: `tests/pwa-icons.test.ts` fails there when sharp does not load.
