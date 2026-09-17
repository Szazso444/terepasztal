"""Spruce: the frames `props/spruce_0..2`.

Reference: art-src/ref/props_spruce_0.png. A denser tapered cone than the pine, with darker lower
layers -- the art direction's distinction between the two. The board's spruce is a near-solid
skirt of needles from the ground up, so the layers overlap heavily and there is barely any trunk,
but the rim is still ragged: a smooth cone is the one thing it must not be.
"""

VARIANTS = [
    (0.97, 0.155, 5),
    (1.06, 0.165, 6),
    (1.14, 0.172, 6),
]

FIT = (0.95, 1.0)


def SHADOW_R(v):
    return VARIANTS[v][1] * 0.85


def build(k, v=0):
    h, br, layers = VARIANTS[v]

    k.ground("base", br * 0.9, seed=62 + v, tufts=5, stones=2)

    # only a stub of trunk shows: a spruce skirts the ground
    k.taper("trunk", (0.0, 0.0, 0.0), 0.032, 0.020, h * 0.2, "bark_dark", seg=8)

    z0 = h * 0.06
    span = h - z0
    for i in range(layers):
        f = i / (layers - 1)
        z = z0 + span * f * 0.82
        r = br * (1.0 - 0.78 * f)
        lh = span * 0.34
        k.tier("layer%d" % i, 0.0, 0.0, z, r, lh,
               "conifer_dark" if i < 2 else "conifer", tips=11, seed=65 + v * 8 + i, droop=0.3)
