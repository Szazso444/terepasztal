"""Warehouse, level 1: the frame `structures/warehouse_1`.

Section 4 of the art direction: "broad loading doors, stacked crates, short loading canopy", in
the same footprint as the level it replaces. The doors are the identifying feature, so they run
most of the loading face and the canopy sits just above them rather than covering the building.
"""

L, W, H = 0.82, 0.62, 0.40

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.7, 1.15)
# the ground shadow's footprint, in the program's own units, carried by FIT. The procedural
# structures shadow their base with a rect and an ellipse; this is the ellipse.
SHADOW_R = 0.4


def build(k, v=0):
    # brick shell on a limestone plinth, under a slate roof pitched along +x
    k.box("plinth", (L + 0.05, W + 0.05, 0.04), (0.0, 0.0, 0.0), "limestone")
    k.box("shell", (L, W, H), (0.0, 0.0, 0.04), "brick")
    k.box("course", (L + 0.02, W + 0.02, 0.025), (0.0, 0.0, 0.04 + H - 0.03), "limestone")
    k.roof("roof", L + 0.1, W + 0.12, 0.04 + H, 0.15, (0.0, 0.0, 0.0), "slate")

    # two broad loading doors on the +y face, with limestone jambs between them
    fy = W / 2
    for i, dx in enumerate((-0.19, 0.19)):
        k.box(f"jamb{i}", (0.30, 0.02, 0.30), (dx, fy, 0.04), "limestone")
        k.box(f"door{i}", (0.26, 0.025, 0.27), (dx, fy + 0.008, 0.04), "timber")
        # a plank line across each door so it does not read as one flat panel
        k.box(f"brace{i}", (0.26, 0.03, 0.02), (dx, fy + 0.012, 0.17), "timber_dark")

    # the loading canopy: a short slate shelf on two iron posts, clear of the door heads
    cz = 0.40
    k.box("canopy", (L + 0.04, 0.22, 0.022), (0.0, fy + 0.04, cz), "slate")
    k.box("canopy_edge", (L + 0.04, 0.03, 0.045), (0.0, fy + 0.14, cz - 0.03), "limestone")
    for i, px in enumerate((-0.36, 0.36)):
        k.box(f"post{i}", (0.025, 0.025, cz - 0.04), (px, fy + 0.13, 0.04), "iron")

    # crates stacked on the apron, the cue that this is a goods shed and not a workshop
    k.box("crate0", (0.16, 0.15, 0.15), (0.46, 0.22, 0.0), "cargo")
    k.box("crate1", (0.13, 0.12, 0.12), (0.47, 0.24, 0.15), "cargo")
    k.box("crate2", (0.14, 0.13, 0.13), (0.44, -0.10, 0.0), "cargo")

    # a small office window on the gable end, so the shell is not blank brick
    k.box("win", (0.02, 0.11, 0.11), (-L / 2 - 0.005, -0.12, 0.26), "amber")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
