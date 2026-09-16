"""Station, level 1: the frame `structures/station_1`.

The building only, centred on the tile ground origin (0, 0, 0) so the render's origin projects to
the same anchor the procedural sprite uses. No ground, no ballast, no rails: those are drawn by
the terrain and track layers underneath. Compare src/art/structures.ts `stationL1`.

`build(k)` populates a Kit-owned scene. The driver adds the camera, the light and the render.
"""

# footprint stays inside about one tile so the sprite matches station scale
HALL_L, HALL_W, HALL_H = 0.86, 0.44, 0.36
GABLE_H = 0.56


def build(k):
    # platform: a low limestone slab with a pale coping along the track (+y) edge
    k.box("platform", (1.0, 0.5, 0.09), (0.0, 0.06, 0.0), "limestone")
    k.box("coping", (1.0, 0.05, 0.1), (0.0, 0.29, 0.0), "trim")

    # the hall: limestone walls, a plinth and a string course under the eaves, a slate roof
    hx, hy = -0.08, -0.14
    k.box("hall", (HALL_L, HALL_W, HALL_H), (hx, hy, 0.09), "limestone")
    k.box("plinth", (HALL_L + 0.04, HALL_W + 0.04, 0.04), (hx, hy, 0.09), "trim")
    k.box("course", (HALL_L + 0.02, HALL_W + 0.02, 0.025), (hx, hy, 0.09 + HALL_H - 0.03), "trim")
    k.roof("hall_roof", HALL_L + 0.1, HALL_W + 0.12, 0.09 + HALL_H, 0.16, (hx, hy, 0), "slate")

    # clock gable at the west end, capped just below the hall ridge so the hall keeps the silhouette
    gx = hx - 0.42
    k.box("gable", (0.26, 0.3, GABLE_H), (gx, hy, 0.09), "limestone")
    k.roof("gable_roof", 0.32, 0.36, 0.09 + GABLE_H, 0.13, (gx, hy, 0), "slate")
    k.box("clock", (0.02, 0.11, 0.11), (gx - 0.135, hy, 0.42), "white")

    # chimney with a pale cap
    cx = hx + 0.3
    k.box("chimney", (0.075, 0.075, 0.22), (cx, hy - 0.1, 0.42), "limestone")
    k.box("chimney_cap", (0.095, 0.095, 0.03), (cx, hy - 0.1, 0.64), "trim")

    # windows and a door on the platform (+y) face; the amber panes carry a faint glow
    fy = hy + HALL_W / 2
    for i, wx in enumerate((-0.3, -0.1, 0.1, 0.3)):
        k.box(f"win_frame{i}", (0.115, 0.015, 0.165), (hx + wx, fy, 0.09 + HALL_H * 0.33), "trim")
        k.box(f"win{i}", (0.085, 0.02, 0.13), (hx + wx, fy + 0.006, 0.09 + HALL_H * 0.38), "amber")
    k.box("door_frame", (0.13, 0.015, 0.25), (hx + 0.46, fy, 0.09), "trim")
    k.box("door", (0.1, 0.02, 0.22), (hx + 0.46, fy + 0.006, 0.09), "timber")

    # canopy over the platform edge on slim iron posts
    cz = 0.44
    k.box("canopy", (1.05, 0.42, 0.025), (0.0, 0.12, cz), "slate")
    k.box("canopy_edge", (1.05, 0.03, 0.05), (0.0, 0.32, cz - 0.04), "trim")
    for i, px in enumerate((-0.46, -0.15, 0.16, 0.47)):
        k.box(f"post{i}", (0.026, 0.026, cz - 0.09), (px, 0.3, 0.09), "iron")

    # a bench, a lamp and a nameboard on the platform
    k.box("bench", (0.22, 0.07, 0.025), (0.4, 0.0, 0.15), "timber")
    k.box("bench_back", (0.22, 0.02, 0.075), (0.4, -0.03, 0.175), "timber")
    k.box("lamp", (0.022, 0.022, 0.22), (-0.42, 0.26, 0.09), "iron")
    k.box("lamp_head", (0.055, 0.055, 0.05), (-0.42, 0.26, 0.31), "amber")
    k.box("board", (0.24, 0.016, 0.075), (0.08, 0.25, 0.22), "white")
    k.box("board_post", (0.016, 0.016, 0.13), (0.08, 0.25, 0.09), "timber")
