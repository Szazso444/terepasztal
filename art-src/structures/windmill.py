"""Windmill, level 1: the frame `structures/windmill`.

A stone tower with a shingled cap, four crossed sails and a door, centred on the tile ground
origin. Compare src/art/civic.ts `windmill`.
"""

import math


def build(k):
    # tapering stone tower
    k.cylinder("tower", 0.0, 0.0, 0.24, 0.0, 0.62, "limestone", seg=18)
    k.cylinder("tower_top", 0.0, 0.0, 0.2, 0.62, 0.06, "limestone", seg=18)
    # a low conical cap, faked as a short slate prism ring
    k.cylinder("cap", 0.0, 0.0, 0.21, 0.68, 0.12, "slate", seg=18)
    k.box("cap_ridge", (0.06, 0.44, 0.04), (0.0, 0.0, 0.78), "slate")

    # door and a small window on the +y face
    k.box("door", (0.11, 0.02, 0.22), (0.0, 0.24, 0.0), "timber")
    k.box("win", (0.07, 0.02, 0.08), (0.12, 0.2, 0.3), "amber")

    # the sail cross: a hub on the +y face with four arms, each a lattice of pale boards
    hub_y = 0.26
    hub_z = 0.6
    k.box("hub", (0.06, 0.06, 0.06), (0.0, hub_y, hub_z), "iron")
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        dx, dz = math.cos(a), math.sin(a)
        r = 0.34
        # the arm spar
        k.box(
            "spar%d" % i,
            (0.03, 0.03, 2 * r),
            (dx * r / 2, hub_y + 0.04, hub_z + dz * r / 2 - r),
            "timber",
        )
        # sail cloth as a thin pale board offset along the arm
        cx, cz = dx * r * 0.6, dz * r * 0.6
        k.box(
            "sail%d" % i,
            (0.12 if abs(dx) > abs(dz) else 0.04, 0.02, 0.04 if abs(dx) > abs(dz) else 0.12),
            (cx - dz * 0.06, hub_y + 0.06, hub_z + cz + dx * 0.06),
            "trim",
        )
