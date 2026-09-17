"""Pine: the frames `props/pine_0..2`.

Reference: art-src/ref/props_pine_0.png. An open tiered canopy with the trunk showing between the
groups -- the cue that separates pine from spruce, which is the denser tapered cone. The board's
tiers are ragged and droop at the tips, and the tree stands in a scrap of grass with a stone or
two, so both are here: the tier rims are broken masses rather than cone edges, and the base is
part of the asset.
"""

VARIANTS = [
    (0.86, 0.190, 3),
    (0.99, 0.205, 3),
    (1.12, 0.220, 4),
]

FIT = (0.95, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.8


def build(k, v=0):
    h, br, tiers = VARIANTS[v]

    k.ground("base", br * 0.85, seed=22 + v, tufts=6, stones=2)

    # the trunk runs the whole height: on a pine it shows between the tiers, and that is the point
    k.taper("roots", (0.0, 0.0, 0.0), 0.052, 0.036, h * 0.06, "bark", seg=9)
    k.taper("trunk", (0.0, 0.0, h * 0.05), 0.032, 0.015, h * 0.95, "bark", seg=8)

    z0 = h * 0.34
    span = h - z0
    for i in range(tiers):
        f = i / max(1, tiers - 1)
        z = z0 + span * (i / tiers) * 1.02
        r = br * (1.0 - 0.5 * f)
        th = span / tiers * 1.25
        k.tier("tier%d" % i, 0.0, 0.0, z, r, th, "conifer" if i else "conifer_dark",
               tips=10, seed=25 + v * 8 + i)

    k.tier("leader", 0.0, 0.0, h - span * 0.12, br * 0.22, span * 0.26, "conifer", tips=6,
           seed=29 + v, droop=0.1)
