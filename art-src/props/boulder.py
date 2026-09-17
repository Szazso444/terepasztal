"""Boulder: the frames `props/boulder_0..2`.

Reference: art-src/ref/props_boulder_0.png. The larger half of the rock/boulder pair, and on the
board it is never one stone: it is three or four angular blocks of different sizes leaning
together, with smaller chips at their feet and moss catching on the upper faces. The stepped
outline that gives is the whole distinction from `rock`, which is a single small stone.
"""

import math

from kit import Rng

# variant -> (main radius, blocks, chips, moss tufts)
VARIANTS = [
    (0.135, 3, 4, 2),
    (0.150, 4, 5, 3),
    (0.145, 3, 5, 2),
]

FIT = (0.95, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][0] * 1.25


def build(k, v=0):
    r, blocks, chips, tufts = VARIANTS[v]
    rng = Rng(130 + v)

    k.ground("base", r * 1.1, seed=132 + v, tufts=5, stones=0)

    peaks = []
    for i in range(blocks):
        # the blocks lean together rather than sitting in a ring, so the outline steps
        a = 2 * math.pi * i / blocks + rng.r(-0.5, 0.5)
        d = r * rng.r(0.55, 0.95) if i else 0.0
        br = r * (1.0 if i == 0 else rng.r(0.46, 0.78))
        c = (d * math.cos(a), d * math.sin(a), br * 0.52)
        k.blob("block%d" % i, c, br, "rock", seg=6, rings=4, squash=0.95, rough=0.26,
               seed=135 + v * 8 + i)
        peaks.append((c[0], c[1], c[2] + br * 0.74))

    for i in range(chips):
        a = rng.r(0.0, 2 * math.pi)
        d = r * rng.r(0.9, 1.35)
        cr = r * rng.r(0.16, 0.30)
        k.blob("chip%d" % i, (d * math.cos(a), d * math.sin(a), cr * 0.45), cr, "rock",
               seg=6, rings=3, squash=0.62, rough=0.34, seed=142 + v * 8 + i)

    # moss on the upper faces only: it must not tint the whole stone
    for i in range(tufts):
        px, py, pz = peaks[i % len(peaks)]
        k.blob("moss%d" % i,
               (px + rng.r(-r * 0.25, r * 0.25), py + rng.r(-r * 0.25, r * 0.25), pz * 0.95),
               r * rng.r(0.18, 0.28), "grass", seg=6, rings=3, squash=0.3, rough=0.34,
               seed=150 + v * 8 + i)
