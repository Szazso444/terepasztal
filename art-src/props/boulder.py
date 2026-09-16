"""Boulder: the frames `props/boulder_0..2`.

The larger angular masses of the rock/boulder pair, stacked so the silhouette steps rather than
domes -- the board draws boulders as two or three blocks leaning together. They share the rock's
stone material and the kit's light, which is what "consistent stone lighting" means here: it is
not judged, it is the same code.

The board also shows moss catching on the upper faces, so a couple of small tufts sit on top.
"""

import math

from kit import Rng

# variant -> (main radius, companions, moss tufts)
VARIANTS = [
    (0.140, 1, 2),
    (0.155, 2, 3),
    (0.150, 2, 2),
]


def SHADOW_R(v):
    return VARIANTS[v][0] * 1.2


def build(k, v=0):
    r, companions, tufts = VARIANTS[v]
    rng = Rng(130 + v)

    peaks = [(0.0, 0.0, r)]
    k.blob(
        "mass",
        (0.0, 0.0, r * 0.55),
        r,
        "rock",
        seg=6,
        rings=4,
        squash=0.82,
        rough=0.26,
        seed=135 + v,
    )
    for i in range(companions):
        a = rng.r(0.0, 2 * math.pi)
        d = r * rng.r(0.75, 1.05)
        cr = r * rng.r(0.55, 0.78)
        c = (d * math.cos(a), d * math.sin(a), cr * 0.52)
        k.blob(
            "block%d" % i,
            c,
            cr,
            "rock",
            seg=6,
            rings=3,
            squash=0.78,
            rough=0.28,
            seed=140 + v * 4 + i,
        )
        peaks.append((c[0], c[1], c[2] + cr * 0.72))

    # moss on the upper faces, in small tufts and only there: it must not tint the whole stone
    for i in range(tufts):
        px, py, pz = peaks[i % len(peaks)]
        k.blob(
            "moss%d" % i,
            (px + rng.r(-r * 0.3, r * 0.3), py + rng.r(-r * 0.3, r * 0.3), pz * 0.96),
            r * rng.r(0.20, 0.30),
            "grass",
            seg=6,
            rings=3,
            squash=0.34,
            rough=0.34,
            seed=150 + v * 4 + i,
        )
