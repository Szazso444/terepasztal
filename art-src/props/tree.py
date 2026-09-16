"""Round broadleaf: the frames `props/tree_0..2`.

Two or three connected canopy masses on a short trunk -- the silhouette the nature board
(docs/art-direction/images/02-nature-objects.png) sets for the round tree, and the one
`src/art/props.ts` draws by hand. Each variant changes the mass count and the crown's spread,
not only its shade, so three of them in one wood read apart.
"""

import math

from kit import Rng

# variant -> (trunk height, crown radius, canopy masses)
VARIANTS = [
    (0.25, 0.215, 2),
    (0.27, 0.245, 3),
    (0.30, 0.275, 3),
]


def SHADOW_R(v):
    """Crown radius x0.8, the footprint `roundTree` gives its shadow in src/art/props.ts."""
    return VARIANTS[v][1] * 0.8


def build(k, v=0):
    th, cr, masses = VARIANTS[v]
    rng = Rng(10 + v)

    # a short trunk that leans a little, so the crown never sits on a perfect post
    lean = (rng.r(-0.025, 0.025), rng.r(-0.025, 0.025))
    k.taper("trunk", (0.0, 0.0, 0.0), 0.042, 0.026, th, "bark", seg=8, lean=lean)
    tx, ty = lean

    # the main crown, then one or two masses leaning off it: connected, not a row of balls
    k.blob("crown", (tx, ty, th + cr * 0.62), cr, "leaf", squash=0.86, rough=0.22, seed=20 + v)
    for i in range(1, masses):
        a = rng.r(0.0, 2 * math.pi)
        d = cr * rng.r(0.42, 0.60)
        r = cr * rng.r(0.62, 0.78)
        c = (tx + d * math.cos(a), ty + d * math.sin(a), th + cr * rng.r(0.5, 0.95))
        # the upper mass catches the light, so it takes the paler leaf of the two greens
        mat = "leaf_pale" if c[2] > th + cr * 0.72 else "leaf"
        k.blob("mass%d" % i, c, r, mat, squash=0.88, rough=0.26, seed=30 + v * 4 + i)
