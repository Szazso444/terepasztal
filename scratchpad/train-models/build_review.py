"""Builds a review page (review[-N]/index.html + img/*.jpg) from the in-game captures.

python build_review.py <pipeline out root> [pilot]
Reads renders/ (capture.mjs, hills.mjs), review[-N]/colour.json (colour_match.py) and the pipeline's
meta JSON; writes JPEG copies (the raw PNG captures stay out of git) and the page with its data
embedded. Pilot 2 also shows pilot 1's pictures (review/img) beside the new ones.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1])
PILOT = int(sys.argv[2]) if len(sys.argv) > 2 else 1
R = HERE / "renders"
V = HERE / ("review" if PILOT == 1 else f"review-{PILOT}")
IMG = V / "img"
IMG.mkdir(parents=True, exist_ok=True)
PREV = HERE / "review" / "img"  # pilot 1


def jpg(src: Path, name: str, width=None):
    im = Image.open(src).convert("RGB")
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(IMG / name, quality=86, optimize=True)
    return f"img/{name}"


PREV_OF = {}  # subject -> (the earlier review's image folder, its label)


def previous(name, sid=None):
    """The earlier pilot's picture, copied in beside this pilot's, when there is one."""
    folder, _ = PREV_OF.get(sid, (PREV, "Pilot 1"))
    src = folder / name
    if PILOT == 1 or not src.exists():
        return None
    (IMG / f"prev-{name}").write_bytes(src.read_bytes())
    return f"img/prev-{name}"


def roof_vs_rails(meta, part):
    """Worst angle between a body's roof edge and the rails over the facings with a clean roof line."""
    rd = next(r for r in meta["renders"] if r["part"] == part)
    worst, n = 0.0, 0
    for d in rd["dirs"]:
        hx, hy = d["screen_heading"]
        if abs(math.degrees(math.atan(hy / hx))) > 35 if abs(hx) > 1e-6 else True:
            continue  # towards end-on the silhouette's top is the nose, not the roof
        a = np.asarray(Image.open(d["file"]).convert("RGBA"))[..., 3] > 128
        xs = np.where(a.any(0))[0]
        cols = range(int(xs.min() + 0.3 * (xs.max() - xs.min())), int(xs.min() + 0.7 * (xs.max() - xs.min())))
        top = np.array([(x, np.argmax(a[:, x])) for x in cols], float)
        roof = math.degrees(math.atan(np.polyfit(top[:, 0], top[:, 1], 1)[0]))
        worst = max(worst, abs(roof - math.degrees(math.atan(hy / hx))))
        n += 1
    return round(worst, 2), n


SCENARIOS = [("01-straight", "Straight"), ("02-switch-enter", "Switch in"), ("03-switch-middle", "Switch middle"),
             ("04-switch-leave", "Switch out"), ("05-curve", "Curve 1"), ("06-curve", "Curve 2"),
             ("07-curve", "Curve 3"), ("08-reversed", "Reversed"), ("09-reversed-running", "Reversed, running")]
if PILOT == 1:
    SUBJECTS = [
        ("rocket", "Stephenson's Rocket", "wooden_coach", "Small, rigid, 1 tile: its own wheels are built round, on the rails.", None),
        ("flying_scotsman", "Flying Scotsman", "steel_coach", "Medium, engine + tender: bodies over parametric leading, Pacific and tender bogies.", None),
        ("sd40", "EMD SD40-2", "boxcar", "Medium, rigid: body over two parametric HT-C trucks.", None),
        ("f7", "EMD F7 (extra)", "steel_coach", "Not in the pilot order; rendered so the Blomberg trucks can be judged under a real body.", None),
    ]
    BOGIES = [(s, "bogies") for s in ("blomberg", "htc", "leading", "pacific", "uk_tender_pair")]
elif PILOT == 5:
    P4 = HERE / "review-4" / "img"
    PREV_OF = {k: (P4, "Pilot 4") for k in ("flying_scotsman", "black_five", "nine_f", "f7", "sd40")}
    SUBJECTS = [
        ("f7", "EMD F7", "steel_coach",
         "Rear end painted from its rear view: the door, gangway and coupler instead of a filled-in wall. Trucks "
         "reconstructed from their own image, with the pilot, snowplow, coupler and steps turning with them.", "body"),
        ("sd40", "EMD SD40-2", "steel_coach",
         "The long-hood end painted from its rear view. Trucks unchanged (its truck image was rejected).", "body"),
        ("flying_scotsman", "Flying Scotsman", "steel_coach",
         "The tender's back painted from the rear view. Sim unchanged from pilot 4.", None),
        ("black_five", "LMS Black Five", "steel_coach",
         "The tender's back painted from the rear view. Sim unchanged from pilot 4.", None),
        ("nine_f", "BR 9F", "steel_coach",
         "The tender's back painted from the rear view. Sim unchanged from pilot 4.", None),
    ]
    BOGIES = [(s_, "bogies5") for s_ in ("f7_front", "f7_rear")]
elif PILOT == 4:
    P2, P3 = HERE / "review-2" / "img", HERE / "review-3" / "img"
    PREV_OF = {"flying_scotsman": (P3, "Pilot 3"), "f7": (P2, "Pilot 2"), "sd40": (P3, "Pilot 3")}
    SUBJECTS = [
        ("flying_scotsman", "Flying Scotsman", "steel_coach",
         "The frame stands on its three coupled axles, on the rail where they are and along it, as a real or a "
         "model locomotive's does; the pivots are the leading bogie and the trailing axle, which swivel and slide "
         "under it. The coupled wheels, rods, splashers and frames are drawn with the body.", None),
        ("black_five", "LMS Black Five", "steel_coach",
         "New: a 4-6-0 with the same rule. The frame stands on its three coupled axles; the leading bogie swivels "
         "under the smokebox. No trailing axle, so the rear pivot draws nothing. Its tender's three axles are drawn "
         "with the tender.", None),
        ("nine_f", "BR 9F", "steel_coach",
         "New: a 2-10-0, the longest coupled wheelbase in the roster (five axles, rigid). The frame stands on them; "
         "the pony truck in front swings under the cylinders.", None),
        ("f7", "EMD F7", "steel_coach",
         "Trucks where the image has them (as in pilot 2), now as the game's pivots, so the body rests on them. "
         "Pilot, snowplow, coupler and steps turn with the trucks. The hidden side is the seen side mirrored; the "
         "rear end takes the body's colours.", "body"),
        ("sd40", "EMD SD40-2", "steel_coach",
         "Trucks where the image has them, pilots, ploughs and end steps on the trucks. Three-tile body, "
         "high-speed track only.", "body"),
    ]
    BOGIES = [(s_, "bogies4") for s_ in ("flying_scotsman_leading", "flying_scotsman_trailing", "black_five_leading",
                                         "nine_f_pony", "f7_front", "f7_rear", "sd40_front", "sd40_rear")]
elif PILOT == 3:
    P2 = HERE / "review-2" / "img"
    PREV_OF = {"flying_scotsman": (P2, "Pilot 2"), "f7": (P2, "Pilot 2"), "sd40": (PREV, "Pilot 1")}
    SUBJECTS = [
        ("flying_scotsman", "Flying Scotsman", "steel_coach",
         "The coupled wheels are a bogie again, drawn on the rail where the image has them (your blue line): they "
         "take the rear pivot's slot and follow the track there. The leading bogie hangs at its pivot; the trailing "
         "axle, splashers, frames and buffer beam stay with the body, as on the prototype.", None),
        ("f7", "EMD F7", "steel_coach",
         "Trucks back on the game's pivots, so the body rests on them through switches and curves, and squared up "
         "with the body. The pilot, coupler and steps stay on the body, where the prototype has them; the tab "
         "'Gear on trucks' shows your variant at the same poses.", "body"),
        ("sd40", "EMD SD40-2", "steel_coach",
         "Now a three-tile body with two HT-C trucks (src/data: large, two bogies), so it runs on high-speed track "
         "only; filmed on a high-speed loop. Its own trucks sit at the large-body pivots, nearer the middle; pilots, "
         "steps and fuel tank stay on the body.", "body"),
    ]
    BOGIES = [(s, "bogies3") for s in ("flying_scotsman_leading", "flying_scotsman_drivers", "f7_front", "f7_rear",
                                       "sd40_front", "sd40_rear")]
else:
    SUBJECTS = [
        ("rocket", "Stephenson's Rocket", "wooden_coach", "Approved in pilot 1 and unchanged: the same frames.", None),
        ("flying_scotsman", "Flying Scotsman", "steel_coach",
         "Coupled wheels, rods, splashers and frames are drawn with the engine body, rigid like the real frame, so "
         "they stay under the boiler on every curve. The leading bogie and the trailing axle are its own bogie "
         "sprites; the tender's three rigid axles are drawn with the tender.", None),
        ("f7", "EMD F7", "steel_coach",
         "The medium diesel for this pilot (the SD40-2 moves to three tiles). Its trucks are its own: cut from the "
         "model with their source colours, drawn where the image has them. The pilot and snowplow stay on the body. "
         "Narrower, level and parallel to the rails.", "body"),
    ]
    BOGIES = [(s, "bogies2") for s in ("flying_scotsman_leading", "flying_scotsman_trailing", "f7_front", "f7_rear")]

colour = json.loads((V / "colour.json").read_text(encoding="utf-8"))
subjects = []
for sid, name, wagon, blurb, roof_part in SUBJECTS:
    meta = json.loads((OUT / "meta" / f"{sid}.json").read_text(encoding="utf-8"))
    rep = json.loads((R / sid / "report.json").read_text(encoding="utf-8"))
    parts = [{"part": r["part"], "final_dims_m": r["final_dims_m"], "compression": r["compression"],
              "gear": r.get("gear")} for r in meta["renders"]]
    scen = [{"id": k, "label": lab, "current": jpg(R / sid / f"{k}-current.png", f"{sid}-{k}-current.jpg"),
             "new": jpg(R / sid / f"{k}-new.png", f"{sid}-{k}-new.jpg"), "p1": previous(f"{sid}-{k}-new.jpg", sid),
             "variant": (jpg(R / f"{sid}b" / f"{k}-new.png", f"{sid}b-{k}-new.jpg")
                         if PILOT == 3 and (R / f"{sid}b" / f"{k}-new.png").exists() else None)}
            for k, lab in SCENARIOS]
    head = {w: jpg(R / sid / f"headings-{sid}-{w}.png", f"{sid}-headings-{w}.jpg", width=1800)
            for w in ("current", "new")}
    head["p1"] = previous(f"{sid}-headings-new.jpg", sid)
    hills = []
    for z in (2, 4) if (R / "hills" / f"{sid}-z2-new.png").exists() else ():
        hl = {"zoom": z, **{w: jpg(R / "hills" / f"{sid}-z{z}-{w}.png", f"{sid}-hill-z{z}-{w}.jpg")
                            for w in ("current", "new")}}
        hl["p1"] = previous(f"{sid}-hill-z{z}-new.jpg", sid)
        hills.append(hl)
    roof = roof_vs_rails(meta, roof_part) if roof_part and PILOT > 1 else None
    subjects.append({
        "id": sid, "name": name, "wagon": wagon, "blurb": blurb, "plan": meta["plan"], "tiles": meta["tiles"],
        "scale_ref": meta["scale_ref"], "real_dims_m": meta["real_dims_m"], "width_fix": meta.get("width_fix"),
        "parts": parts, "warnings": meta["warnings"], "source": meta.get("source"), "align": meta.get("align"),
        "roof_vs_rails": roof, "prev_label": PREV_OF.get(sid, (None, "Pilot 1"))[1],
        "colour": colour[sid], "colour_img": f"img/colour-{sid}.jpg",
        "reversal_error": rep.get("reversalError"), "facings_covered": len(rep.get("facingsCovered") or []),
        "errors": len(rep.get("errors") or []), "scenarios": scen, "headings": head, "hills": hills,
    })

bogie_spec = json.loads((HERE.parents[1] / "tools/asset-pipeline/bogies.json").read_text(encoding="utf-8"))
landmarks = json.loads((HERE.parents[1] / "tools/asset-pipeline/landmarks.json").read_text(encoding="utf-8"))
own = {b["style"]: (vid, b) for vid, v in landmarks.items() if isinstance(v, dict) for b in v.get("bogies", [])}
bogies = []
for style, folder in BOGIES:
    if style in own:
        vid, b = own[style]
        how = ("cut from the model's own truck, source-coloured" if b.get("mesh")
               else f"{len(b['spec']['axles'])} axle(s) built round from the measured wheels")
        info = {"rides_under": f"{vid} {b['part']}, bogie {b['index'] + 1} from the front", "note": how,
                "axles": len(b["spec"]["axles"]) if b.get("spec") else 2}
    else:
        s = bogie_spec[style]
        info = {"rides_under": s["rides_under"], "note": s["note"], "axles": len(s["axles"])}
    bogies.append({"style": style, **info,
                   **{w: jpg(R / folder / f"bogie-{style}-{w}.png", f"bogie-{style}-{w}.jpg", width=1600)
                      for w in ("current", "new")}})

data = {"pilot": PILOT, "subjects": subjects, "bogies": bogies}
page = (V / "template.html").read_text(encoding="utf-8").replace("/*DATA*/null", json.dumps(data))
(V / "index.html").write_text(page, encoding="utf-8")
total = sum(f.stat().st_size for f in IMG.iterdir())
print(f"{V.name}/index.html, {len(list(IMG.iterdir()))} images, {total / 1e6:.1f} MB")
