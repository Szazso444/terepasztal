"""Birch: the frames `props/birch_0..2`.

Reference: art-src/ref/props_birch_0.png. A slender pale trunk with dark breaks and an airy,
uneven canopy -- the board's birch is mostly daylight, with small yellow-green clusters hung off
thin branches rather than a crown resting on a post. So the trunk is thin, the clusters are small
and few, and they sit wide of the trunk on visible branches.
"""

import math

from kit import Rng

# variant -> (trunk height, canopy radius, canopy height, clusters)
VARIANTS = [
    (0.60, 0.17, 0.16, 16),
    (0.62, 0.19, 0.17, 19),
    (0.63, 0.20, 0.18, 21),
]

FIT = (0.95, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.65


def build(k, v=0):
    th, cr, ch, clusters = VARIANTS[v]
    rng = Rng(50 + v)

    k.ground("base", cr * 0.7, seed=52 + v, tufts=6, stones=1)

    # slender and pale: `white` is the palette's brightest, and the snap's darker steps shade it
    lean = (rng.r(-0.035, 0.035), rng.r(-0.035, 0.035))
    k.taper("trunk", (0.0, 0.0, 0.0), 0.016, 0.009, th, "white", seg=8, lean=lean)
    tx, ty = lean

    # dark bark breaks, sparingly: short bands, never a stripe pattern
    for i in range(4):
        f = rng.r(0.12, 0.8)
        k.box("break%d" % i, (0.015, 0.018, 0.010), (tx * f, ty * f - 0.010, th * f), "bark_dark")

    # thin branches lifting into the canopy, so the clusters have something to hang from
    for i in range(3):
        a = rng.r(0.0, 2 * math.pi)
        f = rng.r(0.62, 0.92)
        k.taper(
            "branch%d" % i,
            (tx * f, ty * f, th * f),
            0.008,
            0.005,
            rng.r(0.07, 0.13),
            "white",
            seg=5,
            lean=(cr * 0.62 * math.cos(a), cr * 0.62 * math.sin(a)),
        )

    # an airy canopy: fewer, smaller clusters spread wider than a round tree's, with gaps
    k.crown(
        "leaf",
        (tx, ty, th + ch * 0.35),
        cr,
        ch,
        blobs=clusters,
        seed=55 + v,
        lump=0.22,
        reach=1.12,
    )
