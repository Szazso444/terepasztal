"""Metre grid over a vehicle's parts_front debug view, for measuring cut heights and positions.
python debug_grid.py <out_root> <asset id>  ->  debug/<id>_parts_grid.png"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out, aid = Path(sys.argv[1]), sys.argv[2]
meta = json.loads((out / "meta" / f"{aid}.json").read_text(encoding="utf-8"))
cam = meta["debug_cams"]["parts_front"]
im = Image.open(meta["debug"]["parts_front"]).convert("RGBA")
k = cam["res"] / cam["size"]  # px per metre
cx, cz = cam["center"][0], cam["center"][2]
d = ImageDraw.Draw(im)
to_px = lambda x, z: (cam["res"] / 2 + (x - cx) * k, cam["res"] / 2 - (z - cz) * k)
x_lo, x_hi = cx - cam["size"] / 2, cx + cam["size"] / 2
z_lo, z_hi = cz - cam["size"] / 2, cz + cam["size"] / 2
for i in range(int(z_lo * 4) - 1, int(z_hi * 4) + 2):
    z = i / 4
    y = to_px(0, z)[1]
    d.line([(0, y), (im.width, y)], fill=(255, 0, 255, 200) if i % 4 == 0 else (90, 90, 150, 120))
    if i % 4 == 0:
        d.text((2, y - 11), f"{z:.0f} m", fill=(255, 255, 0, 255))
for i in range(int(x_lo) - 1, int(x_hi) + 2):
    x = to_px(i, 0)[0]
    d.line([(x, 0), (x, im.height)], fill=(90, 150, 90, 120))
im.save(out / "debug" / f"{aid}_parts_grid.png")
print(out / "debug" / f"{aid}_parts_grid.png")
