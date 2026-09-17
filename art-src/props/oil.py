"""Oil seep: the frames `props/oil_0..2`.

Reference: art-src/ref/props_oil_0.png. The art direction is specific about what to avoid: "a
small dark seep with restrained sheen; no bright rainbow pool". The board draws wet dark earth
with two or three small pools in it, ringed by stones and a little grass -- flat to the ground,
which is also what keeps it from being mistaken for buildable water.
"""

import math

from kit import Rng

# variant -> (patch radius, pools, stones)
VARIANTS = [(0.19, 3, 6), (0.16, 2, 5), (0.20, 3, 7)]


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.92, 0.6)


def SHADOW_R(v):
    return 0.0  # it lies in the ground; a cast shadow under it would lift it off


def build(k, v=0):
    r, pools, stones = VARIANTS[v]
    rng = Rng(150 + v)

    # the seep is dark, and the wet earth is only a rim around it: the other way round reads as a
    # heap of spoil, which is what the first pass looked like
    k.blob("ring", (0.0, 0.0, 0.002), r, "timber_dark", seg=16, rings=4, squash=0.018, rough=0.22,
           seed=151 + v)
    k.blob("patch", (0.0, 0.0, 0.005), r * 0.82, "coal", seg=16, rings=4, squash=0.018, rough=0.20,
           seed=152 + v)
    # the seep itself: a couple of small pools, darker and flatter still. `coal` rather than a
    # black, so it sits in the palette, and `iron` for the one restrained sheen the guide allows.
    for i in range(pools):
        a = rng.r(0.0, 2 * math.pi)
        d = r * rng.r(0.0, 0.45)
        pr = r * rng.r(0.26, 0.42)
        px, py = d * math.cos(a), d * math.sin(a)
        k.blob(f"sheen{i}", (px, py, 0.008), pr * 0.5, "iron", seg=10, rings=3, squash=0.02,
               rough=0.2, seed=157 + v * 8 + i)

    # stones and a little grass around the rim, which is what stops it reading as a hole
    for i in range(stones):
        a = 2 * math.pi * i / stones + rng.r(-0.4, 0.4)
        d = r * rng.r(0.82, 1.05)
        sr = rng.r(0.018, 0.036)
        k.blob(f"stone{i}", (d * math.cos(a), d * math.sin(a), sr * 0.4), sr, "rock", seg=6,
               rings=3, squash=0.6, rough=0.3, seed=161 + v * 8 + i)
        if i % 2 == 0:
            g = rng.r(0.04, 0.07)
            k.taper(f"grass{i}", (d * math.cos(a) * 1.1, d * math.sin(a) * 1.1, 0.0), 0.009, 0.004,
                    g, "grass", seg=4, lean=(rng.r(-0.02, 0.02), rng.r(-0.02, 0.02)))
