"""Cottage, level 1: the frame `structures/townhouse`.

A timber-and-limestone house with a pitched clay-tile roof, a chimney, a door and windows,
centred on the tile ground origin. Compare the townhouse in src/art/industry.ts.
"""


def build(k, v=0):
    L, W, H = 0.6, 0.5, 0.34
    # walls: limestone with a timber ground floor band, on a low plinth
    k.box("plinth", (L + 0.04, W + 0.04, 0.03), (0, 0, 0), "trim")
    k.box("ground_floor", (L, W, 0.16), (0, 0, 0.03), "timber")
    k.box("upper", (L, W, H - 0.16), (0, 0, 0.19), "limestone")
    k.roof("roof", L + 0.1, W + 0.12, 0.03 + H, 0.2, (0, 0, 0), "roof")

    # chimney with a pale cap
    k.box("chimney", (0.08, 0.08, 0.2), (-0.18, -0.1, 0.34), "brick")
    k.box("chimney_cap", (0.1, 0.1, 0.03), (-0.18, -0.1, 0.54), "trim")

    # door and windows on the +y face; upper-floor windows in the limestone
    fy = W / 2
    k.box("door_frame", (0.13, 0.015, 0.19), (0.12, fy, 0.03), "trim")
    k.box("door", (0.1, 0.02, 0.16), (0.12, fy + 0.006, 0.03), "timber")
    for i, wx in enumerate((-0.16, 0.16)):
        k.box(f"win_l{i}", (0.1, 0.015, 0.1), (wx, fy, 0.05), "trim")
        k.box(f"win_lg{i}", (0.075, 0.02, 0.075), (wx, fy + 0.006, 0.065), "amber")
    for i, wx in enumerate((-0.15, 0.05, 0.22)):
        k.box(f"win_u{i}", (0.09, 0.015, 0.1), (wx, fy, 0.24), "trim")
        k.box(f"win_ug{i}", (0.065, 0.02, 0.075), (wx, fy + 0.006, 0.255), "amber")
