"""Reeds: the frames `props/reeds_0..1`.

Reference: art-src/ref/props_reeds_0.png. The art direction asks for "sparse upright stems with a
grounded wet base", and warns that shallow wet ground must stay distinct from real water. The
board gives a shallow teal pool with a dozen blades leaning out of it and a few cattail heads, so
the pool is a thin disc rather than a tile of water, and the heads are what name the plant.
"""

import math

from kit import Rng

VARIANTS = [(11, 3), (13, 4)]  # (blades, cattail heads)


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.81, 1.1)


def SHADOW_R(v):
    return 0.0  # the pool is its own contact with the ground; a cast shadow under it reads as dirt


def build(k, v=0):
    blades, heads = VARIANTS[v]
    rng = Rng(120 + v)

    # a shallow wet patch, not a tile of water: thin, and narrower than the blades that stand in it
    k.blob("pool", (0.0, 0.0, 0.004), 0.155, "water", seg=14, rings=4, squash=0.05, rough=0.18,
           seed=121 + v)

    for i in range(blades):
        a = 2 * math.pi * i / blades + rng.r(-0.3, 0.3)
        d = rng.r(0.0, 0.10)
        bx, by = d * math.cos(a), d * math.sin(a)
        h = rng.r(0.20, 0.34)
        # each blade leans away from the centre, which is what keeps a stand from reading as a brush
        lean = (bx * 0.55 + rng.r(-0.02, 0.02), by * 0.55 + rng.r(-0.02, 0.02))
        k.taper(f"blade{i}", (bx, by, 0.0), 0.011, 0.004, h, "grass", seg=4, lean=lean)

    for i in range(heads):
        a = 2 * math.pi * i / heads + rng.r(-0.4, 0.4)
        d = rng.r(0.02, 0.07)
        sx, sy = d * math.cos(a), d * math.sin(a)
        h = rng.r(0.26, 0.36)
        k.taper(f"stem{i}", (sx, sy, 0.0), 0.009, 0.006, h, "grass", seg=4,
                lean=(sx * 0.4, sy * 0.4))
        k.cylinder(f"head{i}", sx + sx * 0.4, sy + sy * 0.4, 0.019, h - 0.02, 0.07, "bark", seg=8)
        k.blob(f"tip{i}", (sx + sx * 0.4, sy + sy * 0.4, h + 0.05), 0.019, "bark", seg=8, rings=4,
               squash=0.8, seed=125 + v * 4 + i)
