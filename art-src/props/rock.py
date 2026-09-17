"""Small rock: the frames `props/rock_0..2`.

Low exposed stone, deliberately small: the art direction's pairing is "small low stones versus
larger angular masses", rock against boulder. Low segment counts and flat shading give the
faceted look; the lighting comes from the kit, so rock and boulder agree without being tuned
against each other.
"""

import math

from kit import Rng

# variant -> (main radius, extra stones)
VARIANTS = [
    (0.100, 0),
    (0.135, 1),
    (0.145, 2),
]


def SHADOW_R(v):
    return VARIANTS[v][0] * 1.15


def build(k, v=0):
    r, extra = VARIANTS[v]
    rng = Rng(30 + v)

    k.ground("base", r * 1.15, seed=32 + v, tufts=4, stones=0)

    k.blob(
        "rock",
        (0.0, 0.0, r * 0.42),
        r,
        "rock",
        seg=7,
        rings=4,
        squash=0.86,
        rough=0.30,
        seed=35 + v,
    )
    for i in range(extra):
        a = rng.r(0.0, 2 * math.pi)
        d = r * rng.r(0.85, 1.25)
        sr = r * rng.r(0.38, 0.58)
        k.blob(
            "chip%d" % i,
            (d * math.cos(a), d * math.sin(a), sr * 0.40),
            sr,
            "rock",
            seg=6,
            rings=3,
            squash=0.78,
            rough=0.34,
            seed=38 + v * 4 + i,
        )
