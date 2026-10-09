"""What the pipeline must know about the game, in one place. Stdlib only.

Mirrors src/sim/body.ts (facings, sizes, body plans) and src/art/index.ts (atlas groups);
game_rules.test.mjs holds this file to body.ts, so a change there fails the test here.
"""

import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "src" / "data"
FACINGS = 48  # body.ts FACINGS, 7.5 degrees apart
DRAWN_WIDTH = 1.3  # body.ts DRAWN_WIDTH: sprites are this much wider across than their length scale
SIZE_TILES = {0.5: "tiny", 1: "small", 2: "medium", 3: "large"}  # body.ts SIZE_LEN
# plans the game honours per size (body.ts vehicleSpec overrides any other to rigid)
PLANS = {0.5: ("rigid",), 1: ("rigid",), 2: ("rigid", "tender"), 3: ("rigid", "garratt", "meyer")}
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


def grid_metre(g):
    """tile_m from the game's human scale when [grid] metre = "human": a person of human_m metres
    stands human_px logical pixels tall (src/render/assetScale.ts), and at elevation e a vertical
    metre spans cos(e) * tile_px / (tile_m * sqrt 2) pixels."""
    if g.get("metre") == "human":
        g["tile_m"] = (g["tile_px"] * math.cos(math.radians(g["elevation_deg"])) * g["human_m"]
                       / (g["human_px"] * math.sqrt(2)))
    return g["tile_m"]


def pivots(plan, size_tiles, pivot_ratio=None, bogies=None, explicit=None):
    """body.ts vehicleSpec pivots: {part: [bogie positions in tiles from the part's centre, front
    first]} for the first segment of each part (a Garratt's rear engine is its front one reversed).
    `explicit` is the definition's own `pivots` (per part), which wins where it gives every bogie."""
    out = _pivots(plan, size_tiles, pivot_ratio, bogies)
    for part, xs in (explicit or {}).items():
        if part in out and len(xs) == len(out[part]):
            out[part] = list(xs)
    return out


def _pivots(plan, size_tiles, pivot_ratio=None, bogies=None):
    L = size_tiles
    pr = pivot_ratio if pivot_ratio is not None else (0.58 if L == 3 else 0.7)

    def spread(W, nb):
        return [W / 2 - W / (nb - 1) * i for i in range(nb)]

    if plan == "tender":
        le = 1.25
        return {"engine": spread(pr * le, 2), "tender": spread(0.66 * (L - le), 2)}
    if plan == "garratt":
        le = 0.8
        lc = L - 2 * le
        return {"engine": spread(pr * le, 2), "cradle": spread(max(pr, 0.94) * lc, 2)}
    if plan == "meyer":
        ratio = max(0.5, min(0.75, pivot_ratio if pivot_ratio is not None else 0.6))
        return {"frame": spread(ratio * L, 2)}
    return {"body": spread(pr * L, bogies or (3 if L == 3 else 2))}


def prototype(game_frame):
    """The src/data definition a game_frame names (rolling/loco_<id>_... or rolling/wagon_<id>_...), or None."""
    import re
    m = re.fullmatch(r"rolling/(loco|wagon)_([a-z0-9_]+?)_(?:\{part\}_)?f\{f\}", game_frame or "")
    if not m:
        return None
    file = "locomotives.json" if m.group(1) == "loco" else "wagons.json"
    rows = json.loads((DATA / file).read_text(encoding="utf-8"))
    rows = rows if isinstance(rows, list) else next(iter(rows.values()))
    return next((d for d in rows if d["id"] == m.group(2)), None)
