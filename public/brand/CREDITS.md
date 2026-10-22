# Brand and decoration assets — origin and licences

Everything in `public/brand/` and `public/fonts/` is listed here. A file that is not listed does not
belong in the repository (the repository is public).

| File | What it is | Origin / licence |
|---|---|---|
| `brand/decor/islamic-calm.{rosette,corner,skyline}.webp` | Geometric ornament masks for the "إسلامي هادي" theme (white on transparent, tinted by the theme colour in CSS) | The owner's own artwork, made for the OMS and copied from `MKory18/Zaki-ai-CRM` (`public/brand/decor`). Geometry and architecture only: no calligraphy, no text, no people. No third-party material. |
| `brand/decor/islamic-epic.{rosette,corner,skyline}.webp` | The same for the "إسلامي ملحمي" theme | Same as above. |
| `brand/decor/neon-coast.{door,door-tall,strip}.webp` | Opaque backgrounds for the "ساحل النيون" theme: a night coast road with neon light (wide, tall and a thin strip) | The owner's own image generations for the OMS (copied from the same place). Original work: not taken from any game or film, no logo, no text. |
| `brand/decor/day.webp` | A very faint ornament mask for the "نهاري" theme | Same as the Islamic masks. |
| `fonts/reem-kufi-var.woff2` | Reem Kufi (variable, Arabic subset) for the Islamic themes' headings | SIL Open Font License 1.1, text in `fonts/reem-kufi-OFL.txt`. The Reserved Font Name is "Josefin Sans": keep the name "Reem Kufi" and do not rename the font. |

IBM Plex Sans Arabic (the body font) is loaded through `next/font/google` at build time and is
also SIL OFL 1.1.

Rules for new files: say who made it and under what licence, keep photos and masks under 150 KB,
and never add anything that reproduces a third party's game, film, brand or character.
