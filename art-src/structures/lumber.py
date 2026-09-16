"""Lumber yard, level 1: the frame `structures/lumber_1`.

Section 4 of the art direction: "log stacks, saw shed, handling frame". The log stacks are the
identifying feature and carry the yard, so they read first: a stacked course with visible cut
ends, not a pile of brown boxes. The shed is small and open toward the yard, and the handling
frame is one gantry rather than a cage -- at this size more frame is less legible, not more.
"""

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.83, 1.2)
# the ground shadow's footprint, in the program's own units, carried by FIT
SHADOW_R = 0.39

LOG_R = 0.052
LOG_L = 0.46


def _log(k, name, y, z):
    """One log lying along +x, with a paler cut end toward the viewer so it reads as sawn."""
    k.box(name, (LOG_L, LOG_R * 2, LOG_R * 2), (0.24, y, z), "bark")
    k.box(name + "_end", (0.02, LOG_R * 1.8, LOG_R * 1.8), (0.24 + LOG_L / 2, y, z + 0.003), "timber")


def build(k, v=0):
    # the saw shed: back and side walls with a slate lean-to, open toward the yard (+y)
    sx, sy, sh = -0.34, -0.10, 0.34
    k.box("shed_plinth", (0.50, 0.42, 0.035), (sx, sy, 0.0), "limestone")
    k.box("shed_back", (0.46, 0.05, sh), (sx, sy - 0.19, 0.035), "timber")
    k.box("shed_side_l", (0.05, 0.38, sh), (sx - 0.21, sy, 0.035), "timber")
    k.box("shed_side_r", (0.05, 0.38, sh * 0.72), (sx + 0.21, sy, 0.035), "timber")
    k.roof("shed_roof", 0.56, 0.48, 0.035 + sh, 0.12, (sx, sy, 0.0), "slate")

    # the saw under the roof: a bench and a bright blade, the working face of the shed
    k.box("bench", (0.26, 0.14, 0.09), (sx, sy + 0.06, 0.035), "timber_dark")
    k.cylinder("blade", sx + 0.05, sy + 0.06, 0.07, 0.125, 0.012, "rail", seg=16)

    # the handling frame: one gantry over the stack, with a block hanging from the beam
    for i, py in enumerate((-0.24, 0.24)):
        k.box(f"gantry_post{i}", (0.05, 0.05, 0.46), (0.30, py, 0.0), "timber_dark")
    k.box("gantry_beam", (0.06, 0.56, 0.06), (0.30, 0.0, 0.46), "timber_dark")
    k.box("gantry_hook", (0.035, 0.035, 0.12), (0.30, 0.02, 0.33), "iron")

    # the stack: three logs, then two nested on top, cut ends toward the viewer
    for i in range(3):
        _log(k, f"log_a{i}", -0.16 + i * 0.108, 0.0)
    for i in range(2):
        _log(k, f"log_b{i}", -0.10 + i * 0.108, LOG_R * 1.8)

    # sawn boards beside the shed: the yard's output, and a second material against the round logs
    k.box("boards", (0.28, 0.20, 0.05), (-0.34, 0.30, 0.0), "timber")
    k.box("boards2", (0.26, 0.18, 0.045), (-0.34, 0.30, 0.05), "trim")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
