"""Pine: the frames `props/pine_0..2`.

An open tiered canopy with the trunk visible between the groups -- the cue that separates pine
from spruce in the art direction, where spruce is the denser tapered cone. The tiers get a gap
each, and the trunk runs the full height behind them.
"""

from kit import Rng

# variant -> (total height, base radius, tiers)
VARIANTS = [
    (0.86, 0.190, 3),
    (0.99, 0.205, 3),
    (1.12, 0.220, 4),
]


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.8


def build(k, v=0):
    h, br, tiers = VARIANTS[v]
    rng = Rng(20 + v)

    # the trunk runs the whole height: on a pine it shows between the tiers, and that is the point
    k.taper("trunk", (0.0, 0.0, 0.0), 0.034, 0.016, h, "bark", seg=8)

    # tiers from a third of the way up, each narrower and shorter than the one below it
    z0 = h * 0.34
    span = h - z0
    for i in range(tiers):
        f = i / max(1, tiers - 1)
        z = z0 + span * (i / tiers) * 1.02
        r = br * (1.0 - 0.52 * f) * rng.r(0.94, 1.06)
        th = span / tiers * rng.r(1.15, 1.35)
        # the lowest tier sits in its own shade, which is how a conifer's underside reads
        k.cone("tier%d" % i, 0.0, 0.0, z, r, th, "conifer" if i else "conifer_dark", seg=12)

    # a short leader above the top tier, so the silhouette ends in a point rather than a stump
    k.cone("leader", 0.0, 0.0, h - span * 0.12, br * 0.20, span * 0.24, "conifer", seg=10)
