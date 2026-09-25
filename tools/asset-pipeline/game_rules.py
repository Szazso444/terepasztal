"""What the pipeline must know about the game, in one place. Stdlib only.

Mirrors src/sim/body.ts (facings, sizes, body plans) and src/art/index.ts (atlas groups);
game_rules.test.mjs holds this file to body.ts, so a change there fails the test here.
"""

import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "src" / "data"
FACINGS = 48  # body.ts FACINGS, 7.5 degrees apart
DRAWN_WIDTH = 1.3  # body.ts DRAWN_WIDTH: sprites are this much wider across than their length scale
SIZE_TILES = {1: "small", 2: "medium", 3: "large"}  # body.ts SIZE_LEN
# plans the game honours per size (body.ts vehicleSpec overrides any other to rigid)
PLANS = {1: ("rigid",), 2: ("rigid", "tender"), 3: ("rigid", "garratt", "meyer")}
GROUPS = ("terrain", "props", "track", "structures", "rolling", "wagons", "fx", "icons", "people")


def drawn_facings():
    """body.ts DRAWN_FACINGS: the smaller facing of each mirror pair, f <= mirrorFacing(f)."""
    return [f for f in range(FACINGS) if f <= (FACINGS // 4 - f) % FACINGS]


def directions(dirs):
    """[(yaw_deg, game facing or None)] for a class's `dirs` setting.

    "game": the drawn facings. Tile +ty is Blender -Y, so facing f is a yaw of -7.5 f degrees
    (clockwise seen from above); facing 0 points screen down-right. An integer N gives N even
    headings counter-clockwise from +X, with no facing.
    """
    if dirs == "game":
        return [(-360.0 * f / FACINGS + 0.0, f) for f in drawn_facings()]  # + 0.0: no -0.0
    return [(360.0 * i / int(dirs), None) for i in range(int(dirs))]


def roster():
    """{"loco" | "wagon": {id: (size_tiles, plan the game uses)}} from src/data (content-editor overrides aside)."""
    tiles = {v: k for k, v in SIZE_TILES.items()}
    out = {}
    for kind, file in (("loco", "locomotives.json"), ("wagon", "wagons.json")):
        rows = json.loads((DATA / file).read_text(encoding="utf-8"))
        rows = rows if isinstance(rows, list) else next(iter(rows.values()))
        out[kind] = {}
        for d in rows:
            L = tiles[d.get("size", "small")]
            plan = d.get("plan", "rigid")
            out[kind][d["id"]] = (L, plan if plan in PLANS[L] else "rigid")  # vehicleSpec's override
    return out


def plan_parts(plan, size_tiles):
    """body.ts vehicleSpec segments, front to back: [(part, length in tiles, rendered)].

    A Garratt's rear engine unit is its front one drawn back to front, so it is cut from the
    model but not rendered.
    """
    L = size_tiles
    if plan not in PLANS.get(L, ()):
        raise ValueError(f"plan {plan!r} is not drawn at size {L}; size {L} takes {PLANS.get(L, ())}")
    if plan == "tender":
        return [("engine", 1.25, True), ("tender", L - 1.25, True)]
    if plan == "garratt":
        return [("engine", 0.8, True), ("cradle", L - 1.6, True), ("engine", 0.8, False)]
    if plan == "meyer":
        return [("frame", L, True)]
    return [("body", L, True)]
