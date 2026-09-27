"""Builds the review page (review/index.html + review/img/*.jpg) from the in-game captures.

python build_review.py <pipeline out root>
Reads renders/ (capture.mjs, hills.mjs), review/colour.json (colour_match.py) and the pipeline's meta JSON;
writes JPEG copies (the raw PNG captures stay out of git) and the page with its data embedded.
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1])
R, V = HERE / "renders", HERE / "review"
IMG = V / "img"
IMG.mkdir(parents=True, exist_ok=True)


def jpg(src: Path, name: str, width=None, crop=None):
    im = Image.open(src).convert("RGB")
    if crop:
        im = im.crop(crop)
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(IMG / name, quality=86, optimize=True)
    return f"img/{name}"


SCENARIOS = [("01-straight", "Straight"), ("02-switch-enter", "Switch in"), ("03-switch-middle", "Switch middle"),
             ("04-switch-leave", "Switch out"), ("05-curve", "Curve 1"), ("06-curve", "Curve 2"),
             ("07-curve", "Curve 3"), ("08-reversed", "Reversed"), ("09-reversed-running", "Reversed, running")]
SUBJECTS = [
    ("rocket", "Stephenson's Rocket", "wooden_coach", "Small, rigid, 1 tile: its own wheels are built round, on the rails."),
    ("flying_scotsman", "Flying Scotsman", "steel_coach", "Medium, engine + tender: bodies over parametric leading, Pacific and tender bogies."),
    ("sd40", "EMD SD40-2", "boxcar", "Medium, rigid: body over two parametric HT-C trucks."),
    ("f7", "EMD F7 (extra)", "steel_coach", "Not in the pilot order; rendered so the Blomberg trucks can be judged under a real body."),
]
colour = json.loads((V / "colour.json").read_text(encoding="utf-8"))
subjects = []
for sid, name, wagon, blurb in SUBJECTS:
    meta = json.loads((OUT / "meta" / f"{sid}.json").read_text(encoding="utf-8"))
    rep = json.loads((R / sid / "report.json").read_text(encoding="utf-8"))
    parts = [{"part": r["part"], "final_dims_m": r["final_dims_m"], "compression": r["compression"],
              "gear": r.get("gear")} for r in meta["renders"]]
    scen = [{"id": k, "label": lab, "current": jpg(R / sid / f"{k}-current.png", f"{sid}-{k}-current.jpg"),
             "new": jpg(R / sid / f"{k}-new.png", f"{sid}-{k}-new.jpg")} for k, lab in SCENARIOS]
    head = {w: jpg(R / sid / f"headings-{sid}-{w}.png", f"{sid}-headings-{w}.jpg", width=1800)
            for w in ("current", "new")}
    hills = [{"zoom": z, **{w: jpg(R / "hills" / f"{sid}-z{z}-{w}.png", f"{sid}-hill-z{z}-{w}.jpg") for w in ("current", "new")}}
             for z in (2, 4)]
    subjects.append({
        "id": sid, "name": name, "wagon": wagon, "blurb": blurb, "plan": meta["plan"], "tiles": meta["tiles"],
        "scale_ref": meta["scale_ref"], "real_dims_m": meta["real_dims_m"], "width_fix": meta.get("width_fix"),
        "parts": parts, "warnings": meta["warnings"], "source": meta.get("source"),
        "colour": colour[sid], "colour_img": f"img/colour-{sid}.jpg",
        "reversal_error": rep.get("reversalError"), "facings_covered": len(rep.get("facingsCovered") or []),
        "errors": len(rep.get("errors") or []), "scenarios": scen, "headings": head, "hills": hills,
    })

bogie_spec = json.loads((HERE.parents[1] / "tools/asset-pipeline/bogies.json").read_text(encoding="utf-8"))
bogies = []
for style in ("blomberg", "htc", "leading", "pacific", "uk_tender_pair"):
    s = bogie_spec[style]
    bogies.append({"style": style, "rides_under": s["rides_under"], "note": s["note"],
                   "axles": len(s["axles"]),
                   **{w: jpg(R / "bogies" / f"bogie-{style}-{w}.png", f"bogie-{style}-{w}.jpg", width=1600)
                      for w in ("current", "new")}})

data = {"subjects": subjects, "bogies": bogies}
page = (V / "template.html").read_text(encoding="utf-8").replace("/*DATA*/null", json.dumps(data))
(V / "index.html").write_text(page, encoding="utf-8")
total = sum(f.stat().st_size for f in IMG.iterdir())
print(f"review/index.html, {len(list(IMG.iterdir()))} images, {total / 1e6:.1f} MB")
