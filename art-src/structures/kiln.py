"""Charcoal kiln: the frame `structures/kiln`.

Section 5 of the art direction: "low rounded/domed kiln, stacked wood, controlled dark opening".
The dome is the whole silhouette and the stacked cordwood beside it is what names the process, so
the opening stays small and dark rather than becoming a glowing mouth.
"""

DOME_R = 0.30

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.93, 1.1)
# the ground shadow's footprint, in the program's own units, carried by FIT. The procedural
# structures shadow their base with a rect and an ellipse; this is the ellipse.
SHADOW_R = 0.29


def build(k, v=0):
    # a limestone ring foot, then the dome in two courses so it is not one smooth ball
    k.cylinder("foot", 0.0, 0.0, DOME_R + 0.03, 0.0, 0.05, "limestone", seg=20)
    k.cylinder("drum", 0.0, 0.0, DOME_R, 0.05, 0.34, "brick", seg=20)
    k.blob("dome", (0.0, 0.0, 0.39), DOME_R, "brick", seg=20, rings=8, squash=0.78, rough=0.04, seed=3)
    # a limestone collar where the dome meets the drum, the joint the guide asks to read
    k.cylinder("collar", 0.0, 0.0, DOME_R + 0.015, 0.37, 0.03, "limestone", seg=20)

    k.cylinder("drum_band", 0.0, 0.0, DOME_R + 0.012, 0.20, 0.025, "limestone", seg=20)

    # the controlled opening: a small dark mouth on the +y face under a limestone lintel
    k.box("mouth", (0.13, 0.04, 0.13), (0.0, DOME_R - 0.03, 0.05), "coal")
    k.box("lintel", (0.17, 0.05, 0.035), (0.0, DOME_R - 0.02, 0.20), "limestone")

    # a short flue off the crown, capped, so smoke has somewhere to come from
    k.cylinder("flue", 0.10, -0.08, 0.05, 0.56, 0.20, "iron", seg=10)
    k.cylinder("flue_cap", 0.10, -0.08, 0.07, 0.76, 0.025, "iron", seg=10)

    # stacked cordwood, clear of the dome so it reads: a course lying one way, a course across
    for i in range(4):
        k.box(f"log_a{i}", (0.34, 0.062, 0.062), (-0.52, -0.20 + i * 0.07, 0.0), "bark")
        k.box(f"log_a{i}_end", (0.02, 0.05, 0.05), (-0.35, -0.20 + i * 0.07, 0.003), "timber")
    for i in range(4):
        k.box(f"log_b{i}", (0.062, 0.30, 0.062), (-0.62 + i * 0.07, -0.16, 0.062), "timber")
    for i in range(3):
        k.box(f"log_c{i}", (0.34, 0.062, 0.062), (-0.52, -0.16 + i * 0.07, 0.124), "bark")
        k.box(f"log_c{i}_end", (0.02, 0.05, 0.05), (-0.35, -0.16 + i * 0.07, 0.127), "timber")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
