"""Bush: the frames `props/bush_0..2`.

Reference: art-src/ref/props_bush_0.png (plain) and _1 (flowering). A low cluster, wider than it
is tall, sitting on a tuft of ground -- and on the board it is clearly many small leaf masses, not
a lobed lump. Variant 1 carries the board's small white flowers.
"""

import math

from kit import Rng

# variant -> (radius, height, clusters, flowering)
VARIANTS = [
    (0.135, 0.085, 16, False),
    (0.145, 0.095, 19, True),
    (0.140, 0.088, 17, False),
]

FIT = (0.92, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][0] * 1.05


def build(k, v=0):
    r, h, clusters, flowering = VARIANTS[v]
    rng = Rng(40 + v)

    k.ground("base", r * 0.9, seed=42 + v, tufts=5, stones=1)
    k.crown("leaf", (0.0, 0.0, h * 0.75), r, h, blobs=clusters, seed=45 + v, lump=0.30)

    if flowering:
        for i in range(7):
            a = rng.r(0.0, 2 * math.pi)
            d = r * rng.r(0.25, 0.85)
            k.blob(
                "flower%d" % i,
                (d * math.cos(a), d * math.sin(a), h * rng.r(0.9, 1.35)),
                0.016,
                "white",
                seg=7,
                rings=3,
                squash=0.6,
                seed=48 + i,
            )
