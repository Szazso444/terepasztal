"""Bush: the frames `props/bush_0..2`.

A low two- or three-lobed cluster, shorter than a train body -- the art direction's whole brief
for the family. No trunk: the lobes sit straight on the ground, which is what keeps a bush from
reading as a small tree.
"""

import math

from kit import Rng

# variant -> (lobe radius, lobes, flowering)
VARIANTS = [
    (0.118, 2, False),
    (0.128, 3, True),
    (0.126, 3, False),
]


def SHADOW_R(v):
    return VARIANTS[v][0] * 1.1


def build(k, v=0):
    r, lobes, flowering = VARIANTS[v]
    rng = Rng(40 + v)

    for i in range(lobes):
        a = 2 * math.pi * i / lobes + rng.r(-0.4, 0.4)
        d = r * rng.r(0.30, 0.55) if lobes > 1 else 0.0
        lr = r * rng.r(0.80, 1.0)
        # squashed hard: a bush is wider than it is tall
        k.blob(
            "lobe%d" % i,
            (d * math.cos(a), d * math.sin(a), lr * 0.62),
            lr,
            "leaf" if i % 2 == 0 else "leaf_pale",
            squash=0.70,
            rough=0.14,
            seed=45 + v * 8 + i,
        )

    # the board gives one bush small white flowers; a few points of `white`, not a scatter
    if flowering:
        for i in range(5):
            a = rng.r(0.0, 2 * math.pi)
            d = r * rng.r(0.3, 0.85)
            k.box(
                "flower%d" % i,
                (0.022, 0.022, 0.016),
                (d * math.cos(a), d * math.sin(a), r * rng.r(0.65, 0.95)),
                "white",
            )
