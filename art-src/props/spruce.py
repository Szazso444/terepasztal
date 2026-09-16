"""Spruce: the frames `props/spruce_0..2`.

A denser tapered cone with darker lower layers -- the art direction's distinction from pine,
which is open and tiered. The layers overlap rather than leaving gaps, and the two lowest take
the darker conifer green so the mass reads from the bottom up.
"""

from kit import Rng

# variant -> (total height, base radius, layers)
VARIANTS = [
    (0.97, 0.155, 5),
    (1.06, 0.165, 6),
    (1.14, 0.172, 6),
]


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.85


def build(k, v=0):
    h, br, layers = VARIANTS[v]
    rng = Rng(60 + v)

    # only a stub of trunk shows: a spruce skirts the ground
    k.taper("trunk", (0.0, 0.0, 0.0), 0.030, 0.020, h * 0.22, "bark_dark", seg=8)

    # overlapping layers, each starting below the top of the one beneath it -- that overlap is
    # what makes the cone dense where pine is open
    z0 = h * 0.08
    span = h - z0
    for i in range(layers):
        f = i / (layers - 1)
        z = z0 + span * f * 0.80
        r = br * (1.0 - 0.80 * f) * rng.r(0.96, 1.05)
        lh = span * rng.r(0.30, 0.38)
        k.cone(
            "layer%d" % i,
            0.0,
            0.0,
            z,
            r,
            lh,
            "conifer_dark" if i < 2 else "conifer",
            seg=12,
        )
