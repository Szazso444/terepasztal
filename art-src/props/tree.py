"""Round broadleaf: the frames `props/tree_0..2`.

Reference: art-src/ref/props_tree_0.png. The board draws the crown as many small leaf clusters
with daylight between them, on a slim trunk that flares into roots, standing on a scrap of ground
with a few tufts and a stone. All three of those are silhouette, which is what the art direction
says to take from the boards -- so the crown is built from clusters rather than as one mass, and
the base is part of the asset rather than something the shadow is left to imply.
"""

from kit import Rng

# variant -> (trunk height, crown radius, crown height, clusters)
VARIANTS = [
    (0.26, 0.22, 0.17, 20),
    (0.28, 0.25, 0.19, 24),
    (0.31, 0.28, 0.21, 28),
]

# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.92, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.8


def build(k, v=0):
    th, cr, ch, clusters = VARIANTS[v]
    rng = Rng(10 + v)

    k.ground("base", cr * 0.8, seed=12 + v, tufts=6, stones=2)

    # a slim trunk that flares at the foot: the flare is what stops it reading as a dowel
    lean = (rng.r(-0.02, 0.02), rng.r(-0.02, 0.02))
    k.taper("root", (0.0, 0.0, 0.0), 0.062, 0.038, th * 0.22, "bark", seg=9)
    k.taper("trunk", (0.0, 0.0, th * 0.2), 0.038, 0.024, th * 0.8, "bark", seg=8, lean=lean)

    k.crown(
        "leaf",
        (lean[0], lean[1], th + ch * 0.55),
        cr,
        ch,
        blobs=clusters,
        seed=20 + v,
        lump=0.26,
    )
