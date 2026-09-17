"""Palm: the frames `props/palm_0..1`.

Reference: art-src/ref/props_palm_0.png, art-src/ref/props_palm_1.png. The art direction asks for
"a small fan of readable fronds on a bent trunk", a sparse desert and oasis accent. The board draws
a ringed trunk leaning off vertical with eight or nine long fronds arching out and down, and a
tuft of grass on sand at the foot. Frond count is what makes it read as a palm rather than a
feather duster, so they stay few and wide.
"""

import math

from kit import Rng

# variant -> (trunk height, lean, fronds, frond reach)
VARIANTS = [
    (0.52, 0.16, 8, 0.30),
    (0.58, -0.13, 9, 0.28),
]


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.78, 1.1)


def SHADOW_R(v):
    return VARIANTS[v][3] * 0.75


def build(k, v=0):
    th, lean, fronds, reach = VARIANTS[v]
    rng = Rng(80 + v)

    # a little sand and a grass tuft at the foot, as the board draws it
    k.blob("sand", (0.0, 0.0, 0.0), 0.22, "sand", seg=12, rings=4, squash=0.10, rough=0.22, seed=81 + v)
    for i in range(5):
        a = rng.r(0.0, 2 * math.pi)
        d = rng.r(0.06, 0.15)
        k.box(f"tuft{i}", (0.02, 0.02, rng.r(0.05, 0.09)), (d * math.cos(a), d * math.sin(a), 0.0), "grass")

    # the trunk leans and tapers; the rings are leaf scars and are most of its character
    lx, ly = lean * 0.8, -lean * 0.5
    k.taper("trunk", (0.0, 0.0, 0.0), 0.055, 0.035, th, "bark", seg=9, lean=(lx, ly))
    for i in range(6):
        f = (i + 0.6) / 6.5
        k.cylinder(f"ring{i}", lx * f, ly * f, 0.048 - 0.012 * f, th * f, 0.022, "bark_dark", seg=9)

    # the crown: fronds arching out from the trunk head, each three segments falling as it goes out
    hx, hy, hz = lx, ly, th
    k.blob("head", (hx, hy, hz + 0.02), 0.06, "bark_dark", seg=10, rings=5, squash=0.8, seed=85 + v)
    for i in range(fronds):
        a = 2 * math.pi * i / fronds + rng.r(-0.14, 0.14)
        ca, sa = math.cos(a), math.sin(a)
        r = reach * rng.r(0.82, 1.0)
        # three segments: out and slightly up, then out and level, then out and down
        pts = [
            (hx, hy, hz),
            (hx + ca * r * 0.36, hy + sa * r * 0.36, hz + 0.07),
            (hx + ca * r * 0.74, hy + sa * r * 0.74, hz + 0.04),
            (hx + ca * r, hy + sa * r, hz - 0.09),
        ]
        for j in range(3):
            p0, p1 = pts[j], pts[j + 1]
            mid = tuple((p0[c] + p1[c]) / 2 for c in range(3))
            half = tuple((p1[c] - p0[c]) / 2 for c in range(3))
            wide = (-sa * 0.036, ca * 0.036, 0.0)
            k.panel(f"frond{i}_{j}", mid, half, wide, "leaf" if j else "leaf_pale")
