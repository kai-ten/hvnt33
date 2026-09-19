# A companion font that draws "u" and "U" with the "v" and "V" glyphs, for the
# brand's Roman V in headings (the display face only; body text keeps its u).
# The page text keeps its real letters (for screen readers, search and
# copy-paste); only the drawing changes.
#   python3 scripts/v-for-u.py      (fontTools and brotli; outputs are committed)
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

root = Path(__file__).resolve().parent.parent
src, out = root / "assets/fonts/src", root / "public/fonts"
out.mkdir(parents=True, exist_ok=True)

for name in ["CastoroTitling-Regular"]:
    font = TTFont(src / f"{name}.ttf")
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[0x75] = table.cmap[0x76]  # u draws as v
            table.cmap[0x55] = table.cmap[0x56]  # U draws as V
    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = []
    opts.name_IDs = ["*"]
    sub = Subsetter(opts)
    sub.populate(unicodes=[0x55, 0x75])
    sub.subset(font)
    font.flavor = "woff2"
    font.save(out / f"vu-{name}.woff2")
    print("wrote", out / f"vu-{name}.woff2", (out / f"vu-{name}.woff2").stat().st_size, "bytes")
