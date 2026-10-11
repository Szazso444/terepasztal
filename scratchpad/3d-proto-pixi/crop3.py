# side-by-side magnified crops: python crop3.py out.png x0 y0 w h mag a.png b.png ...
import sys
from PIL import Image, ImageDraw
out, x0, y0, w, h, mag = sys.argv[1], *map(int, sys.argv[2:7])
files = sys.argv[7:]
sheet = Image.new("RGB", (len(files) * (w * mag + 4), h * mag + 16), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").crop((x0, y0, x0 + w, y0 + h)).resize((w * mag, h * mag), Image.NEAREST)
    sheet.paste(im, (i * (w * mag + 4), 16))
    d.text((i * (w * mag + 4) + 4, 2), f, fill=(255, 255, 255))
sheet.save(out)
