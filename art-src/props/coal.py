"""Coal seam: the frames `props/coal_0..2`.

Reference: art-src/ref/props_coal_0.png. The art direction asks for a "dark stratified outcrop,
distinguishable from ordinary grey rock". The board answers that with bedding: the seam is a
stack of flat slabs with their courses showing, not a heap of black lumps, and loose spoil around
the foot. The strata are the whole distinction from `rock`, so they are geometry, not shading.
"""

import math

from kit import Rng

# variant -> (courses, width, loose lumps)
VARIANTS = [(4, 0.30, 5), (3, 0.26, 4), (4, 0.34, 6)]


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.64, 0.85)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.8


def build(k, v=0):
    courses, w, lumps = VARIANTS[v]
    rng = Rng(140 + v)

    k.ground("base", w * 0.95, seed=142 + v, tufts=4, stones=0)

    # the outcrop: flat courses, each stepped back and narrower, so the bedding reads from the side
    z = 0.0
    for i in range(courses):
        f = i / courses
        cw = w * (1.0 - 0.22 * f)
        cd = w * 0.62 * (1.0 - 0.22 * f)
        ch = rng.r(0.035, 0.055)
        k.box(f"course{i}", (cw, cd, ch), (-w * 0.06 * f, w * 0.05 * f, z), "coal")
        # a paler rim along the top of each course: the exposed edge of the bed
        k.box(f"edge{i}", (cw + 0.008, cd + 0.008, 0.008), (-w * 0.06 * f, w * 0.05 * f, z + ch - 0.008), "rock")
        z += ch

    # spoil at the foot, some coal and some ordinary stone, which is what sells the seam as worked
    for i in range(lumps):
        a = rng.r(0.0, 2 * math.pi)
        d = w * rng.r(0.55, 0.95)
        r = rng.r(0.022, 0.05)
        k.blob(f"lump{i}", (d * math.cos(a), d * math.sin(a), r * 0.45), r,
               "coal" if i % 3 else "rock", seg=6, rings=3, squash=0.62, rough=0.32,
               seed=145 + v * 8 + i)
