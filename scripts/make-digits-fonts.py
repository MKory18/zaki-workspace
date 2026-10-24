"""
Builds public/fonts/zaki-digits-{400,500,600,700}.woff2 — «الأرقام: ١٢٣» without touching a single number.

Each file is a few hundred bytes: the ten Arabic-Indic digits (U+0660-0669) of IBM Plex Sans Arabic at one
weight, ALSO mapped to the Western digits 0-9 (U+0030-0039), under a family of its own, "Zaki Digits".
globals.css puts that family FIRST in every text stack when <html data-digits="arabic">, with
`unicode-range: U+0030-0039`, so a browser draws 0-9 in the Arabic shapes and nothing else changes: the text
in the page, a copy, a search, a field, the server's HTML are all still 0-9 (and a field keeps its own font).

Source: the IBM Plex Sans Arabic woff2 files next/font downloads at build (`.next/static/media`, the
"arabic" subset of each weight). IBM Plex is SIL OFL 1.1 with the Reserved Font Name "Plex", so the derived
font carries another name and the licence travels with it (public/fonts/zaki-digits-OFL.txt).

    python scripts/make-digits-fonts.py <dir with the four Plex Arabic woff2 files>

The files are committed; the build never runs this. tests/digits-setting.test.ts reads them back.
"""
import glob
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ARABIC_INDIC = list(range(0x0660, 0x066A))
WESTERN = list(range(0x0030, 0x003A))
FAMILY = "Zaki Digits"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "fonts")


def find_sources(folder):
    """weight -> the Plex Arabic file of that weight that holds the ten Arabic-Indic digits."""
    found = {}
    for path in sorted(glob.glob(os.path.join(folder, "*.woff2"))):
        font = TTFont(path)
        family = font["name"].getDebugName(1) or ""
        cmap = font.getBestCmap()
        if "IBM Plex Sans Arabic" in family and all(cp in cmap for cp in ARABIC_INDIC):
            found[font["OS/2"].usWeightClass] = path
    return found


def build(source, weight):
    font = TTFont(source)
    options = subset.Options()
    options.layout_features = []  # no shaping is needed for ten digits
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "DSIG"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=ARABIC_INDIC)
    subsetter.subset(font)

    # 0-9 draw the same glyphs as ٠-٩
    for table in font["cmap"].tables:
        if table.isUnicode():
            for western, arabic in zip(WESTERN, ARABIC_INDIC):
                if arabic in table.cmap:
                    table.cmap[western] = table.cmap[arabic]

    # a name of its own (the OFL's Reserved Font Name "Plex" must not be used by a modified version)
    style = "Regular"
    name = font["name"]
    name.names = [n for n in name.names if n.nameID not in (1, 2, 3, 4, 6, 16, 17)]
    for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(FAMILY, 1, platform, encoding, language)
        name.setName(style, 2, platform, encoding, language)
        name.setName(f"{FAMILY} {weight}", 3, platform, encoding, language)
        name.setName(f"{FAMILY} {weight}", 4, platform, encoding, language)
        name.setName(f"ZakiDigits-{weight}", 6, platform, encoding, language)
    font["OS/2"].usWeightClass = weight

    font.flavor = "woff2"
    out = os.path.join(OUT, f"zaki-digits-{weight}.woff2")
    font.save(out)
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sources = find_sources(sys.argv[1])
    missing = [w for w in (400, 500, 600, 700) if w not in sources]
    if missing:
        sys.exit(f"no IBM Plex Sans Arabic file with the Arabic-Indic digits for weight(s) {missing}")
    for weight in (400, 500, 600, 700):
        out = build(sources[weight], weight)
        print(os.path.relpath(out), os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
