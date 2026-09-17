"""Cactus: the frames `props/cactus_0..2`.

Reference: art-src/ref/props_cactus_0.png, art-src/ref/props_cactus_1.png. The art direction wants
a "clear ribbed column/arm silhouette, few highlights". The board's arms leave the column low and
turn up parallel to it, which is the shape that reads as a cactus at any size; the ribs are the
only surface detail, and one variant flowers.
"""

import math

from kit import Rng

# variant -> (column height, arms, flowering)
VARIANTS = [
    (0.58, 2, False),
    (0.46, 2, True),
    (0.40, 1, False),
]
R = 0.058


# fit to the sprite this replaces: (footprint, height) about the ground origin
FIT = (0.6, 0.8)


def SHADOW_R(v):
    return 0.10


def build(k, v=0):
    h, arms, flowering = VARIANTS[v]
    rng = Rng(90 + v)

    # a few stones at the foot, the board's dry-ground cue
    for i in range(3):
        a = rng.r(0.0, 2 * math.pi)
        d = rng.r(0.09, 0.15)
        k.blob(f"stone{i}", (d * math.cos(a), d * math.sin(a), 0.012), rng.r(0.022, 0.04),
               "rock", seg=6, rings=3, squash=0.6, rough=0.3, seed=91 + v * 4 + i)

    # the column: ribbed, so it is not a smooth post
    k.cylinder("column", 0.0, 0.0, R, 0.0, h, "leaf", seg=9)
    k.blob("crown", (0.0, 0.0, h), R * 0.92, "leaf", seg=10, rings=5, squash=0.55, seed=95 + v)
    _ribs(k, "col", 0.0, 0.0, R, 0.02, h - 0.02, 9)

    # arms: out from the column, then up. Built as two boxes so the elbow is a corner, not a curve
    for i in range(arms):
        side = 1 if i % 2 == 0 else -1
        ay = side * rng.r(0.10, 0.13)
        az = h * rng.r(0.34, 0.48)
        alen = rng.r(0.13, 0.19)
        k.box(f"arm_out{i}", (0.05, abs(ay) * 2, 0.05), (0.0, ay / 2, az), "leaf")
        k.cylinder(f"arm_up{i}", 0.0, ay, R * 0.78, az, alen, "leaf", seg=8)
        k.blob(f"arm_tip{i}", (0.0, ay, az + alen), R * 0.72, "leaf", seg=9, rings=4, squash=0.55,
               seed=97 + v * 4 + i)
        if flowering:
            k.blob(f"bloom{i}", (0.0, ay, az + alen + 0.02), 0.026, "red", seg=8, rings=4, squash=0.6,
                   seed=99 + i)

    if flowering:
        k.blob("bloom_top", (0.0, 0.0, h + 0.02), 0.03, "red", seg=8, rings=4, squash=0.6, seed=98)


def _ribs(k, name, cx, cy, r, z0, z1, seg):
    """Shallow vertical ridges around the column: the cactus's only surface detail."""
    for i in range(seg):
        a = 2 * math.pi * i / seg
        k.box(f"{name}_rib{i}", (0.012, 0.012, z1 - z0),
              (cx + r * 0.96 * math.cos(a), cy + r * 0.96 * math.sin(a), z0), "conifer")
