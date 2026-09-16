"""Coaling stage: the frame `structures/fuel_stop`.

Section 6 of the art direction: "coal bunker and chute/handling arm", and explicitly distinct
from the water tank beside it and from the colliery that produces the coal. The chute reaching out
over the track is what separates a coaling stage from a heap of coal in a bin.
"""

BUNKER_L, BUNKER_W, BUNKER_H = 0.52, 0.42, 0.34
STAGE_Z = 0.30

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.85, 1.0)
# the ground shadow's footprint, in the program's own units, carried by FIT. The procedural
# structures shadow their base with a rect and an ellipse; this is the ellipse.
SHADOW_R = 0.33


def build(k, v=0):
    # the stage: a limestone base with a timber deck, raising the bunker above a tender
    k.box("base", (0.62, 0.52, STAGE_Z), (-0.12, -0.06, 0.0), "limestone")
    k.box("deck", (0.66, 0.56, 0.04), (-0.12, -0.06, STAGE_Z), "timber_dark")

    # the bunker: a timber box that tapers in, so it reads as something that empties downward
    bz = STAGE_Z + 0.04
    k.box("bunker", (BUNKER_L, BUNKER_W, BUNKER_H), (-0.12, -0.06, bz), "timber")
    for i, z in enumerate((0.10, 0.26)):
        k.box(f"hoop{i}", (BUNKER_L + 0.02, BUNKER_W + 0.02, 0.025), (-0.12, -0.06, bz + z), "iron")

    # coal heaped proud of the bunker's open top: the identifying material, not a painted lid
    k.box("coal_load", (BUNKER_L - 0.08, BUNKER_W - 0.08, 0.06), (-0.12, -0.06, bz + BUNKER_H), "coal")
    k.box("coal_heap", (BUNKER_L - 0.22, BUNKER_W - 0.20, 0.05), (-0.16, -0.08, bz + BUNKER_H + 0.06), "coal")

    # the chute: a timber trough angled down over the track side (+y), on an iron hanger
    cx, cy = 0.06, 0.30
    k.box("chute", (0.18, 0.30, 0.07), (cx, cy, bz + 0.06), "timber_dark")
    k.box("chute_lip", (0.20, 0.07, 0.05), (cx, cy + 0.17, bz + 0.02), "iron")
    k.box("hanger", (0.03, 0.03, 0.22), (cx, cy + 0.15, bz + 0.13), "iron")
    k.box("hanger_arm", (0.03, 0.26, 0.03), (cx, cy + 0.02, bz + 0.34), "iron")

    # a short stair up the back of the stage, so the deck is reachable
    for i in range(4):
        k.box(f"step{i}", (0.20, 0.07, 0.035), (-0.44, -0.30 + i * 0.05, i * 0.075), "limestone")

    # a coal pile spilled on the ground beside the stage, tying it to the tile
    k.box("spill", (0.20, 0.16, 0.07), (0.30, -0.28, 0.0), "coal")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
