"""Oak: the frames `props/oak_0..2`.

Reference: art-src/ref/props_oak_0.png. Wider and heavier than the round tree, with a low
spreading crown and limbs that show through it -- and, in the board, a heavy bole that divides
low and flares hard into roots. The crown is broad and shallow rather than tall, which with the
low division is what separates an oak from a big round tree at sprite size.
"""

import math

from kit import Rng

# variant -> (bole height, crown radius, crown height, limbs, clusters)
VARIANTS = [
    (0.20, 0.27, 0.15, 3, 26),
    (0.21, 0.30, 0.16, 4, 30),
    (0.22, 0.33, 0.17, 4, 34),
]

FIT = (0.92, 1.05)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.85


def build(k, v=0):
    bh, cr, ch, limbs, clusters = VARIANTS[v]
    rng = Rng(70 + v)

    k.ground("base", cr * 0.75, seed=72 + v, tufts=7, stones=3)

    # a heavy bole, flared into roots and dividing low
    k.taper("roots", (0.0, 0.0, 0.0), 0.105, 0.068, bh * 0.3, "bark", seg=10)
    k.taper("bole", (0.0, 0.0, bh * 0.28), 0.066, 0.05, bh * 0.75, "bark", seg=9)

    # limbs out of the division, reaching into the crown so they show through its gaps
    for i in range(limbs):
        a = 2 * math.pi * i / limbs + rng.r(-0.35, 0.35)
        reach = cr * rng.r(0.5, 0.72)
        k.taper(
            "limb%d" % i,
            (0.0, 0.0, bh * 0.9),
            0.030,
            0.016,
            rng.r(0.09, 0.15),
            "bark_dark",
            seg=6,
            lean=(reach * math.cos(a), reach * math.sin(a)),
        )

    k.crown(
        "leaf",
        (0.0, 0.0, bh + ch * 0.62),
        cr,
        ch,
        blobs=clusters,
        seed=80 + v,
        lump=0.24,
    )
