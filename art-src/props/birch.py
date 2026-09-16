"""Birch: the frames `props/birch_0..2`.

A slender pale trunk with an airy, uneven canopy, and dark bark breaks used sparingly -- the
three cues the art direction names for birch. The canopy is several small light masses with gaps
between them rather than one solid crown, which is what keeps it airy next to the round tree.
"""

import math

from kit import Rng

# variant -> (trunk height, crown radius, canopy masses)
VARIANTS = [
    (0.62, 0.17, 4),
    (0.60, 0.19, 5),
    (0.61, 0.20, 5),
]


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.7


def build(k, v=0):
    th, cr, masses = VARIANTS[v]
    rng = Rng(50 + v)

    # the pale trunk: `white` is the palette's brightest, and the snap's darker steps shade it
    lean = (rng.r(-0.04, 0.04), rng.r(-0.04, 0.04))
    k.taper("trunk", (0.0, 0.0, 0.0), 0.030, 0.017, th, "white", seg=8, lean=lean)
    tx, ty = lean

    # a few dark bark breaks, sparingly: three short bands up the trunk, never a stripe pattern
    for i in range(3):
        f = rng.r(0.15, 0.85)
        k.box(
            "break%d" % i,
            (0.026, 0.026, 0.018),
            (tx * f, ty * f - 0.012, th * f),
            "bark_dark",
        )

    # two thin branches lifting off the upper trunk, so the canopy has something to hang on
    for i in range(2):
        a = rng.r(0.0, 2 * math.pi)
        k.taper(
            "branch%d" % i,
            (tx * 0.8, ty * 0.8, th * 0.78),
            0.014,
            0.008,
            rng.r(0.09, 0.14),
            "white",
            seg=5,
            lean=(cr * 0.5 * math.cos(a), cr * 0.5 * math.sin(a)),
        )

    # the canopy: small pale masses spread wide with daylight between them
    for i in range(masses):
        a = 2 * math.pi * i / masses + rng.r(-0.5, 0.5)
        d = cr * rng.r(0.30, 0.78)
        c = (tx + d * math.cos(a), ty + d * math.sin(a), th + rng.r(-0.02, 0.16))
        k.blob(
            "leaf%d" % i,
            c,
            cr * rng.r(0.40, 0.56),
            "leaf_pale" if i % 2 == 0 else "leaf",
            squash=0.82,
            rough=0.16,
            seed=55 + v * 8 + i,
        )
