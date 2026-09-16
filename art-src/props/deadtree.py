"""Dead tree: the frames `props/deadtree_0..1`.

A bare branching silhouette. The art direction is explicit that this must not be the living tree
with its foliage tinted grey, so there is no canopy at all here: the shape is trunk and limbs,
and the limbs fork once so the outline reads as branches rather than spikes. Variant 1 is the
board's broken stump, short and leaning hard.
"""

import math

from kit import Rng

# variant -> (trunk height, limbs, lean)
VARIANTS = [
    (0.70, 5, 0.05),
    (0.60, 4, 0.16),
]


def SHADOW_R(v):
    return 0.13 if v == 0 else 0.16


def build(k, v=0):
    th, limbs, tilt = VARIANTS[v]
    rng = Rng(100 + v)

    lean = (tilt * rng.r(0.6, 1.0), -tilt * rng.r(0.6, 1.0))
    k.taper("trunk", (0.0, 0.0, 0.0), 0.055, 0.022, th, "bark_dark", seg=8, lean=lean)
    tx, ty = lean

    for i in range(limbs):
        a = 2 * math.pi * i / limbs + rng.r(-0.4, 0.4)
        f = rng.r(0.45, 0.95)
        base = (tx * f, ty * f, th * f)
        reach = rng.r(0.10, 0.19)
        rise = rng.r(0.07, 0.15)
        dx, dy = reach * math.cos(a), reach * math.sin(a)
        k.taper(
            "limb%d" % i,
            base,
            0.021,
            0.010,
            rise,
            "bark_dark",
            seg=5,
            lean=(dx, dy),
        )
        # one fork per limb: two thin twigs off the tip, which is what makes it read as dead wood
        tip = (base[0] + dx, base[1] + dy, base[2] + rise)
        for j in (-1, 1):
            b = a + j * rng.r(0.5, 0.9)
            k.taper(
                "twig%d_%d" % (i, j),
                tip,
                0.011,
                0.005,
                rng.r(0.05, 0.10),
                "bark_dark",
                seg=4,
                lean=(0.09 * math.cos(b), 0.09 * math.sin(b)),
            )
