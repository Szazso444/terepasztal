"""Oak: the frames `props/oak_0..2`.

Wider and heavier than the round tree, with strong branching and a low spreading crown -- the
distinction the art direction draws between `tree` and `oak`. The branches are real geometry
rather than implied, because the board's oak shows its limbs through the crown.
"""

import math

from kit import Rng

# variant -> (trunk height, crown radius, limbs)
VARIANTS = [
    (0.30, 0.29, 3),
    (0.31, 0.32, 4),
    (0.31, 0.35, 4),
]


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.85


def build(k, v=0):
    th, cr, limbs = VARIANTS[v]
    rng = Rng(70 + v)

    # a stout trunk: an oak's is short and thick before it divides
    k.taper("trunk", (0.0, 0.0, 0.0), 0.075, 0.05, th, "bark", seg=9)

    # limbs spreading out and up from the crotch, each carrying a canopy mass on its end
    for i in range(limbs):
        a = 2 * math.pi * i / limbs + rng.r(-0.35, 0.35)
        reach = cr * rng.r(0.50, 0.68)
        rise = rng.r(0.12, 0.19)
        k.taper(
            "limb%d" % i,
            (0.0, 0.0, th - 0.02),
            0.032,
            0.018,
            rise,
            "bark_dark",
            seg=6,
            lean=(reach * math.cos(a), reach * math.sin(a)),
        )
        c = (reach * math.cos(a), reach * math.sin(a), th + rise + cr * 0.18)
        k.blob(
            "mass%d" % i,
            c,
            cr * rng.r(0.52, 0.66),
            "leaf",
            squash=0.80,
            rough=0.26,
            seed=80 + v * 8 + i,
        )

    # the central crown, sitting above and tying the limb masses into one low spreading canopy
    k.blob(
        "crown",
        (0.0, 0.0, th + cr * 0.62),
        cr * 0.74,
        "leaf_pale",
        squash=0.74,
        rough=0.22,
        seed=90 + v,
    )
