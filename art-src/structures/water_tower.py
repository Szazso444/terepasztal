"""Water tower: the frame `structures/water_tower`.

Section 6 of the art direction: "banded timber tank, stone/wood legs, recognisable water spout",
and explicitly a service structure rather than a passenger building. The spout is the silhouette's
one asymmetry, so it reads as a water tower from any distance.
"""

TANK_R = 0.24
TANK_H = 0.44
LEG_H = 0.62

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.8, 1.07)
# the ground shadow's footprint, in the program's own units, carried by FIT. The procedural
# structures shadow their base with a rect and an ellipse; this is the ellipse.
SHADOW_R = 0.21


def build(k, v=0):
    # a limestone footing, then four timber legs cross-braced near the top
    k.box("footing", (0.44, 0.44, 0.05), (0.0, 0.0, 0.0), "limestone")
    legs = ((-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15))
    for i, (lx, ly) in enumerate(legs):
        k.box(f"leg{i}", (0.045, 0.045, LEG_H), (lx, ly, 0.05), "timber_dark")
    for i, z in enumerate((0.26, 0.50)):
        k.box(f"brace_x{i}", (0.34, 0.03, 0.022), (0.0, -0.15, z), "timber_dark")
        k.box(f"brace_y{i}", (0.03, 0.34, 0.022), (0.15, 0.0, z), "timber_dark")

    # the tank: banded timber staves, so it is a tank and not a drum
    base = 0.05 + LEG_H
    k.cylinder("tank", 0.0, 0.0, TANK_R, base, TANK_H, "timber", seg=18)
    for i, f in enumerate((0.18, 0.5, 0.82)):
        k.cylinder(f"band{i}", 0.0, 0.0, TANK_R + 0.012, base + TANK_H * f, 0.03, "iron", seg=18)

    # a shallow slate lid with a small vent
    k.cylinder("lid", 0.0, 0.0, TANK_R + 0.02, base + TANK_H, 0.035, "slate", seg=18)
    k.cylinder("vent", 0.0, 0.0, 0.05, base + TANK_H + 0.035, 0.06, "iron", seg=8)

    # the spout: an arm out over the track side (+y), hinged off the tank and angled down
    ax, ay = 0.0, TANK_R
    k.box("spout_arm", (0.05, 0.22, 0.05), (ax, ay + 0.09, base + 0.07), "iron")
    k.box("spout_drop", (0.055, 0.055, 0.14), (ax, ay + 0.19, base - 0.05), "iron")
    k.box("spout_lip", (0.08, 0.08, 0.03), (ax, ay + 0.19, base - 0.08), "copper")

    # a ladder up one leg, angled with the iso so its rungs read
    for i in range(6):
        k.box(f"rung{i}", (0.10, 0.015, 0.014), (-0.15, -0.19, 0.12 + i * 0.09), "iron")
    k.box("ladder_rail", (0.015, 0.015, LEG_H - 0.04), (-0.19, -0.19, 0.08), "iron")
    # a puddle-catch trough under the spout, grounding the structure
    k.box("trough", (0.20, 0.10, 0.04), (ax, ay + 0.19, 0.0), "limestone")

    # built with its frontage on +y, which reads better than writing every offset
    # negative; the rig sees -y, so turn it round
    k.face_camera()
