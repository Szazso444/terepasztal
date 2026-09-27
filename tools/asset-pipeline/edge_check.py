"""How parallel a rendered body sits to its rails: the angle of the roof's far edge in each facing's
sprite against the screen direction of the track at that facing (they should match).

python edge_check.py <out_root> <asset id> [part]   (the body's long, straight roof only; steam bodies
with a cab and chimney have no single roof line)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

out, aid = Path(sys.argv[1]), sys.argv[2]
part = sys.argv[3] if len(sys.argv) > 3 else None
meta = json.loads((out / "meta" / f"{aid}.json").read_text(encoding="utf-8"))
rd = next(r for r in meta["renders"] if r["part"] == part or (part is None and r["part"] in (None, "body")))
worst = 0.0
for d in rd["dirs"]:
    a = np.asarray(Image.open(d["file"]).convert("RGBA"))[..., 3] > 128
    hx, hy = d["screen_heading"]
    rail = math.degrees(math.atan(hy / hx)) if abs(hx) > 0.2 else None  # steep views have no clean roof line
    if rail is None:
        continue
    xs = np.where(a.any(0))[0]
    x0, x1 = xs.min(), xs.max()
    cols = range(int(x0 + 0.3 * (x1 - x0)), int(x0 + 0.7 * (x1 - x0)))
    top = np.array([(x, np.argmax(a[:, x])) for x in cols], float)
    roof = math.degrees(math.atan(np.polyfit(top[:, 0], top[:, 1], 1)[0]))
    worst = max(worst, abs(roof - rail))
    print(f"facing {d['facing']:2d}: roof edge {roof:6.2f} deg, rails {rail:6.2f} deg, off {roof - rail:+.2f}")
print(f"worst {worst:.2f} deg")
