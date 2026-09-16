"""Water pump, level 1: the frame `structures/pump_1`.

Section 4 of the art direction: "intake pipe, pump house and small tank", and explicitly distinct
from the service water tower -- so the tank here stays low and beside the house rather than being
lifted onto legs, and the intake pipe runs out to the water's edge where a tower has no reason to.
"""

HOUSE_L, HOUSE_W, HOUSE_H = 0.44, 0.38, 0.30

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.89, 1.2)
# the ground shadow's footprint, in the program's own units, carried by FIT. The procedural
# structures shadow their base with a rect and an ellipse; this is the ellipse.
SHADOW_R = 0.27


def build(k, v=0):
    # the pump house: a small limestone shed with a slate roof, on a plinth
    hx, hy = -0.10, 0.0
    k.box("plinth", (HOUSE_L + 0.05, HOUSE_W + 0.05, 0.035), (hx, hy, 0.0), "trim")
    k.box("house", (HOUSE_L, HOUSE_W, HOUSE_H), (hx, hy, 0.035), "limestone")
    k.roof("roof", HOUSE_L + 0.08, HOUSE_W + 0.10, 0.035 + HOUSE_H, 0.13, (hx, hy, 0.0), "slate")

    # door and a lit window on the +y face
    fy = hy + HOUSE_W / 2
    k.box("door_frame", (0.12, 0.015, 0.20), (hx - 0.11, fy, 0.035), "trim")
    k.box("door", (0.09, 0.02, 0.17), (hx - 0.11, fy + 0.006, 0.035), "timber")
    k.box("win_frame", (0.10, 0.015, 0.10), (hx + 0.12, fy, 0.14), "trim")
    k.box("win", (0.07, 0.02, 0.07), (hx + 0.12, fy + 0.006, 0.155), "amber")

    # the machinery, proud of the gable end so it is visible: a flywheel and its housing
    k.box("gear_house", (0.10, 0.20, 0.16), (hx - HOUSE_L / 2 - 0.04, hy, 0.035), "iron")
    k.cylinder("flywheel", hx - HOUSE_L / 2 - 0.09, hy, 0.09, 0.09, 0.03, "iron", seg=14)

    # the tank: low and beside the house, banded, clearly not on legs
    tx, ty = 0.34, -0.12
    k.cylinder("tank", tx, ty, 0.15, 0.0, 0.26, "iron", seg=16)
    k.cylinder("tank_band", tx, ty, 0.162, 0.16, 0.025, "copper", seg=16)
    k.cylinder("tank_lid", tx, ty, 0.16, 0.26, 0.025, "slate", seg=16)

    # the intake: a pipe from the house, down over the bank, ending in a strainer at ground level
    k.box("pipe_run", (0.34, 0.07, 0.07), (0.12, 0.24, 0.16), "iron")
    k.box("pipe_down", (0.07, 0.07, 0.17), (0.28, 0.24, 0.0), "iron")
    k.box("strainer", (0.11, 0.11, 0.05), (0.28, 0.32, 0.0), "copper")
    # a short pipe tying the tank into the same run, so the two objects read as one machine
    k.box("pipe_tank", (0.07, 0.24, 0.06), (tx, ty + 0.16, 0.14), "iron")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
