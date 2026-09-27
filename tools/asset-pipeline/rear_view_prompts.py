"""Prompts for a second image of each locomotive: the same studio art turned round (rear three-quarter view),
and for diesel and electric trucks on their own. Built from the prompts that made the studio images
(assets/source/base-v1/generation-prompts.json), so style, palette and camera match word for word.

python rear_view_prompts.py  ->  assets/source/base-v1/rear-view-prompts.json
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1] / "assets" / "source" / "base-v1"

VIEW_OLD = "Orthographic 2:1 isometric front/right view."
VIEW_NEW = ("Orthographic 2:1 isometric rear/left view: the SAME locomotive as the attached image, turned 180 degrees as "
            "if on a turntable while the camera stays exactly where it was.")
AXIS_OLD = "Front faces lower-right; long axis runs upper-left to lower-right."
ROCKET_VIEW = ("Orthographic 2:1 isometric front/right view, front faces lower-right, rigid long axis upper-left to "
               "lower-right.")
AXIS_NEW = ("Its rear end now faces lower-right and its front faces upper-left; the long axis still runs upper-left to "
            "lower-right, so its rear end and its left side show.")
SAME = ("Match the attached image exactly: same livery and colours, same proportions and details, same wheel count, "
        "wheel sizes and spacing, same size in the frame. Not a mirror image of it: draw the left side and the rear end "
        "as the real locomotive has them. No cast shadow.")

# per locomotive: wheel arrangement of the real one, and what its rear view must show
NOTES = {
    "rocket": ("0-2-2 with its small tender", "The tender stays coupled behind, so the tender's back faces the viewer: "
               "its water barrel and the wooden tender frame."),
    "adler": ("2-2-2 with its tender", "Keep the tender coupled as in the original; its back end faces the viewer."),
    "john_bull": ("4-2-0 with its tender", "The cowcatcher stays at the front (far end now); the tender's back faces the "
                  "viewer. Do not add a second cowcatcher."),
    "mav375": ("2-6-2T tank engine, no tender", "The rear is the cab's back wall with the coal bunker and its ladder; "
               "no tender, no second chimney."),
    "general": ("4-4-0 with its tender", "The cowcatcher and headlamp stay at the front (far end now); the wooden "
                "tender's back faces the viewer. Do not add a second cowcatcher."),
    "jupiter": ("4-4-0 with its tender", "The cowcatcher and headlamp stay at the front (far end now); the tender's "
                "back faces the viewer. Do not add a second cowcatcher."),
    "mav424": ("4-8-0 with its tender", "The tender's back faces the viewer, with buffers and lamps; the cab's back "
               "is hidden behind the tender, as it would be."),
    "k4s": ("4-6-2 with a tender on two trucks", "The tender's back faces the viewer: rear ladder, back-up light, "
            "coupler (no buffers, it is American)."),
    "drg01": ("4-6-2 (2'C1') with a tender on two bogies", "Keep the red wheels. The tender's back faces the viewer, "
              "with buffers and lamps."),
    "flying_scotsman": ("4-6-2 with a six-wheel rigid tender", "The tender's back faces the viewer, with buffers and "
                        "lamp irons; the cab's back is hidden behind the tender."),
    "daylight": ("4-8-4 streamliner with a tender on two six-wheel trucks", "The orange and red bands carry on round "
                 "the tender's back, which faces the viewer with its rear light and coupler."),
    "mallard": ("4-6-2 streamliner with an eight-wheel tender", "The streamlined nose stays at the front (far end "
                "now); the tender's back faces the viewer, a plain end with buffers. The corridor opening is only at "
                "the tender's front end, towards the cab."),
    "big_boy": ("4-8-8-4 articulated with its long tender", "Keep both engine units with their four coupled axles "
                "each; the tender's back faces the viewer."),
    "j94": ("0-6-0ST saddle tank, no tender", "The rear is the cab's back wall with its bunker and buffers; the saddle "
            "tank stays over the boiler; no tender."),
    "black_five": ("4-6-0 with a six-wheel tender", "The tender's back faces the viewer, with buffers and lamp irons; "
                   "the cab's back is hidden behind the tender."),
    "nine_f": ("2-10-0 with a six-wheel tender", "Five coupled axles, one pony axle in front. The tender's back faces "
               "the viewer, with its ladder, buffers and lamp irons."),
    "gmam": ("4-8-2+2-8-4 Garratt", "Keep all three parts: the front engine unit with the water tank (far end now), "
             "the boiler cradle, and the rear engine unit with the coal bunker, whose back now faces the viewer."),
    "sw1": ("B-B switcher", "The cab is at the rear end, so the turned view shows the cab nearest the viewer, with its "
            "rear windows, and the long hood behind it."),
    "class08": ("0-6-0 diesel shunter with coupling rods", "The cab is at the rear end, so the turned view shows the "
                "cab nearest the viewer, with its rear windows and buffers; the coupling rods show on this side too."),
    "m62": ("Co-Co with a cab at each end", "The rear view shows the second cab: windscreen and lights like the front "
            "one, as the real one has them."),
    "f7": ("B-B cab unit (A unit)", "The rear end is flat: a door, a rubber diaphragm and a coupler, no windscreen. "
           "Do not draw a second nose."),
    "sd40": ("C-C road switcher", "The rear is the long hood's end: walkway, handrails, end steps, pilot with coupler, "
             "rear headlights. The cab is at the far end now."),
    "deltic": ("Co-Co with a cab at each end", "The rear view shows the second nose and cab, like the front one."),
    "dda40x": ("D-D with one cab", "The rear is the long hood's end: walkway, handrails, end steps, pilot with "
               "coupler. The cab is at the far end now."),
    "kando_v40": ("1-D-1 rod-drive electric", "Keep the jackshaft and coupling rods on this side too; pantograph where "
                  "the original has it along the roof."),
    "v63": ("Co-Co with a cab at each end", "The rear view shows the second cab; pantographs stay where the original "
            "has them along the roof."),
    "crocodile": ("1-C+C-1 articulated with two long snouts", "Keep the centre cab and both snouts with their rods; "
                  "the second snout faces the viewer now."),
    "taurus": ("Bo-Bo with a cab at each end", "The rear view shows the second cab; pantographs stay where the "
               "original has them along the roof, not moved to the other end."),
    "re460": ("Bo-Bo with a cab at each end", "The rear view shows the second cab; pantographs stay where the original "
              "has them along the roof, not moved to the other end."),
    "gg1": ("2-C+C-2 with a centre cab", "Streamlined noses at both ends: the rear view shows the second nose."),
    "tgv": ("Bo-Bo power car", "The power car alone. Its rear end is flat with the covered connection to the trailer "
            "coach, no windscreen. Do not draw a second nose."),
    "ice1": ("Bo-Bo power car", "The power car alone. Its rear end is flat with the gangway to the trailer coach, "
             "no windscreen. Do not draw a second nose."),
}

# diesel and electric trucks worth a clean image of their own (steam wheels are built from measurements)
TRUCKS = {
    "sw1": "two-axle truck", "m62": "three-axle truck", "f7": "two-axle Blomberg truck", "sd40": "three-axle HT-C truck",
    "deltic": "three-axle bogie", "dda40x": "four-axle truck", "v63": "three-axle bogie", "taurus": "two-axle bogie",
    "re460": "two-axle bogie", "gg1": ["three-axle driving truck", "two-axle guiding truck"],
    "tgv": "two-axle motor bogie", "ice1": "two-axle motor bogie",
}

# work groups for an agent that fans the images out; the pilot's five come first
GROUPS = {
    "pilot": ["f7", "sd40", "flying_scotsman", "black_five", "nine_f"],
    "steam_tender": ["mav424", "k4s", "drg01", "daylight", "mallard", "rocket", "adler", "john_bull", "general",
                     "jupiter"],
    "steam_tank": ["mav375", "j94"],
    "articulated": ["big_boy", "gmam", "crocodile"],
    "diesel": ["sw1", "class08", "m62", "deltic", "dda40x"],
    "electric": ["kando_v40", "v63", "taurus", "re460", "gg1", "tgv", "ice1"],
}


def main():
    src = json.loads((BASE / "generation-prompts.json").read_text(encoding="utf-8"))

    def walk(x):
        if isinstance(x, dict):
            yield x
            for v in x.values():
                yield from walk(v)
        elif isinstance(x, list):
            for v in x:
                yield from walk(v)

    originals = {d["id"].removeprefix("loco."): d for d in walk(src)
                 if isinstance(d.get("id"), str) and d["id"].startswith("loco.") and "prompt" in d}
    out = []
    group_of = {i: g for g, ids in GROUPS.items() for i in ids}
    if set(group_of) != set(NOTES):
        raise SystemExit(f"groups and notes differ: {sorted(set(group_of) ^ set(NOTES))}")
    for lid in [i for ids in GROUPS.values() for i in ids]:
        wheels, note = NOTES[lid]
        o = originals.get(lid)
        if not o:
            raise SystemExit(f"{lid}: no original prompt in generation-prompts.json")
        p = o["prompt"]
        # the Rocket's prompt came first and words the camera in one sentence
        p = p.replace(ROCKET_VIEW, f"{VIEW_NEW} {AXIS_NEW}").split(" Save the generated file locally")[0]
        p = p.replace(VIEW_OLD, VIEW_NEW).replace(AXIS_OLD, AXIS_NEW)
        if VIEW_NEW not in p or AXIS_NEW not in p:
            raise SystemExit(f"{lid}: the original prompt words its camera differently")
        anchor = next(a for a in ("Show a complete rigid locomotive source study", "Entire object centered") if a in p)
        p = p.replace(anchor, f"{SAME} Wheel arrangement as in the attached image; the real one is a {wheels}. {note} "
                      + anchor, 1)
        stem = Path(o["filename"]).stem
        group = group_of[lid]
        row = {"id": lid, "group": group, "priority": 1 if group == "pilot" else 2,
               "attach": f"assets/source/base-v1/{o['filename']}",
               "save_as": f"assets/source/base-v1/{stem}-rear.png", "prompt": p, "trucks": []}
        kinds = TRUCKS.get(lid, [])
        for k, kind in enumerate([kinds] if isinstance(kinds, str) else kinds):
            style = p[:p.index("One ")]  # the shared style, palette and background rules
            row["trucks"].append({
                "save_as": f"assets/source/base-v1/{stem}-truck{'' if k == 0 else k + 1}.png",
                "prompt": style.replace(VIEW_NEW, "Orthographic 2:1 isometric front/right view.")
                + f"One {kind} of the locomotive in the attached image, on its own, as if lifted out from under "
                  "it: side frames, wheels, axle boxes, springs, brake cylinders and bolster, in the attached image's "
                  "colours. Nothing of the body, fuel tank, pilot, snowplow or coupler. Front of the truck faces "
                  "lower-right; its long axis runs upper-left to lower-right. No rails, ground, shadow, numbering or text.",
            })
        out.append(row)
    path = BASE / "rear-view-prompts.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(out)} locomotives -> {path}")


if __name__ == "__main__":
    main()
