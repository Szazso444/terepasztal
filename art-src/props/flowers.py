"""Flowers: the frames `props/flowers_0..3`.

Reference: art-src/ref/props_flowers_0.png (white), _1 (yellow and pink), _3 (blue). The art
direction asks for "four restrained colour variants, concentrated in tiny clusters" -- restraint
being the point, since these are the smallest props in the game and a bright scatter across a
meadow would fight every status indicator on the map. So the foliage carries the clump and the
blooms are a handful of points on top of it.
"""

import math

from kit import Rng

# variant -> (bloom material, blooms), in the board's order: white, yellow, pink, blue
VARIANTS = [("white", 7), ("amber", 6), ("red", 6), ("cyan", 7)]


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (1.4, 0.62)


def SHADOW_R(v):
    return 0.075


def build(k, v=0):
    bloom, count = VARIANTS[v]
    rng = Rng(110 + v)

    # low foliage: a few leaning blades, so the clump has a base and is not floating colour
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.r(-0.35, 0.35)
        d = rng.r(0.0, 0.055)
        bx, by = d * math.cos(a), d * math.sin(a)
        k.taper(f"leaf{i}", (bx, by, 0.0), 0.010, 0.004, rng.r(0.05, 0.09), "grass", seg=4,
                lean=(bx * 1.3 + rng.r(-0.02, 0.02), by * 1.3 + rng.r(-0.02, 0.02)))

    for i in range(count):
        a = 2 * math.pi * i / count + rng.r(-0.3, 0.3)
        d = rng.r(0.015, 0.065)
        bx, by = d * math.cos(a), d * math.sin(a)
        z = rng.r(0.055, 0.105)
        k.taper(f"stem{i}", (bx * 0.5, by * 0.5, 0.0), 0.006, 0.004, z, "grass", seg=4,
                lean=(bx * 0.5, by * 0.5))
        k.blob(f"bloom{i}", (bx, by, z + 0.012), rng.r(0.016, 0.023), bloom, seg=8, rings=4,
               squash=0.55, rough=0.18, seed=112 + v * 8 + i)
