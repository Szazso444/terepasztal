"""Dead tree: the frames `props/deadtree_0..1`.

Reference: art-src/ref/props_deadtree_0.png (standing) and _1 (the broken stump). The art
direction is explicit that this must not be the living tree with grey foliage, so there is none.
What the board actually shows is finer than a few limbs: a trunk that divides into several
branches, each forking twice, thinning as it goes -- the silhouette is almost all twig, and
getting that density is what makes it read as dead wood rather than a bare post.
"""

import math

from kit import Rng

# variant -> (trunk height, primary branches, lean)
VARIANTS = [
    (0.46, 5, 0.05),
    (0.30, 4, 0.17),
]

FIT = (0.95, 1.0)


def SHADOW_R(v):
    return 0.12 if v == 0 else 0.15


def _branch(k, name, base, direction, length, r0, depth, rng):
    """One limb, forking into two thinner ones at its tip, twice over."""
    dx, dy, dz = direction
    tip = (base[0] + dx * length, base[1] + dy * length, base[2] + dz * length)
    k.taper(name, base, r0, r0 * 0.55, dz * length, "bark_dark", seg=5,
            lean=(dx * length, dy * length))
    if depth <= 0:
        return
    for s in (-1, 1):
        a = math.atan2(dy, dx) + s * rng.r(0.5, 0.95)
        spread = math.hypot(dx, dy) * rng.r(0.8, 1.15)
        _branch(
            k,
            "%s_%d" % (name, s + 1),
            tip,
            (math.cos(a) * spread, math.sin(a) * spread, dz * rng.r(0.85, 1.2)),
            length * rng.r(0.58, 0.74),
            r0 * 0.55,
            depth - 1,
            rng,
        )


def build(k, v=0):
    th, branches, tilt = VARIANTS[v]
    rng = Rng(100 + v)

    k.ground("base", 0.14, seed=102 + v, tufts=5, stones=3)

    lean = (tilt * rng.r(0.6, 1.0), -tilt * rng.r(0.6, 1.0))
    k.taper("roots", (0.0, 0.0, 0.0), 0.070, 0.048, th * 0.18, "bark_dark", seg=9)
    k.taper("trunk", (0.0, 0.0, th * 0.16), 0.046, 0.022, th * 0.86, "bark_dark", seg=8, lean=lean)
    for i in range(branches):
        a = 2 * math.pi * i / branches + rng.r(-0.3, 0.3)
        f = rng.r(0.62, 1.0)
        base = (lean[0] * f, lean[1] * f, th * f)
        reach = rng.r(0.55, 0.95)
        _branch(
            k,
            "limb%d" % i,
            base,
            (math.cos(a) * reach, math.sin(a) * reach, rng.r(0.75, 1.15)),
            rng.r(0.13, 0.19),
            0.024,
            2,
            rng,
        )
