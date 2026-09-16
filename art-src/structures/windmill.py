"""Windmill, level 1: the frame `structures/windmill`.

A stone tower with a slate cap, four crossed sails and a door, centred on the tile ground origin.
Compare src/art/civic.ts `windmill`.

The sails are the whole silhouette, so they are built in the camera's picture plane, not the world
x-z plane: an X of latticed arms that faces the iso camera head-on and reads as a windmill from the
base view. The tower carries a couple of course bands so the stone does not palette-snap to one
flat cylinder.
"""

import math

# The fixed iso rig (docs/mcp-setup.md 6.3): camera rot (X60, Z45). These are its world-space right,
# up and back (toward-viewer) axes, so geometry built from them faces the camera square-on.
RIGHT = (0.7071, 0.7071, 0.0)
UP = (-0.3536, 0.3536, 0.866)
BACK = (0.6124, -0.6124, 0.5)


def _v(s, a):
    return (s * a[0], s * a[1], s * a[2])


def _add(*vs):
    return (sum(x[0] for x in vs), sum(x[1] for x in vs), sum(x[2] for x in vs))


def build(k):
    # tapering stone tower, with two proud course bands so it does not read as one flat cylinder
    k.cylinder("tower", 0.0, 0.0, 0.26, 0.0, 0.64, "limestone", seg=20)
    k.cylinder("tower_top", 0.0, 0.0, 0.21, 0.64, 0.05, "limestone", seg=20)
    for i, z in enumerate((0.2, 0.42)):
        k.cylinder("course%d" % i, 0.0, 0.0, 0.265, z, 0.02, "trim", seg=20)

    # a domed slate cap on the tower top
    k.cylinder("cap", 0.0, 0.0, 0.22, 0.69, 0.05, "slate", seg=20)
    k.cylinder("cap_dome", 0.0, 0.0, 0.14, 0.74, 0.1, "slate", seg=20)
    k.box("cap_top", (0.05, 0.05, 0.04), (0.0, 0.0, 0.84), "iron")

    # door, lintel and a window on the +y (camera-facing) face
    k.box("door", (0.12, 0.02, 0.24), (0.0, 0.26, 0.0), "timber")
    k.box("lintel", (0.14, 0.03, 0.03), (0.0, 0.26, 0.24), "trim")
    k.box("win", (0.08, 0.02, 0.08), (0.14, 0.24, 0.34), "amber")

    # sail cross, in the camera's picture plane, mounted proud of the tower toward the viewer
    hub = _add((0.0, 0.0, 0.66), _v(0.42, BACK))
    k.box("hub", (0.08, 0.08, 0.08), (hub[0], hub[1] - 0.04, 0.62), "iron")
    r = 0.54
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        # arm direction and its perpendicular, both in the picture plane
        d = _add(_v(math.cos(a), RIGHT), _v(math.sin(a), UP))
        p = _add(_v(-math.sin(a), RIGHT), _v(math.cos(a), UP))
        mid = _add(hub, _v(r / 2, d))
        # the spar: a slim timber board running hub -> tip
        k.panel("spar%d" % i, mid, _v(r / 2, d), _v(0.02, p), "timber")
        # the sail cloth: a wide pale panel on the trailing side of the spar
        cloth = _add(mid, _v(0.07, p))
        k.panel("sail%d" % i, cloth, _v(r * 0.42, d), _v(0.05, p), "white")
        # two rungs across the sail so the lattice reads
        for t in (0.42, 0.72):
            rc = _add(hub, _v(r * t, d), _v(0.07, p))
            k.panel("rung%d_%d" % (i, int(t * 100)), rc, _v(0.012, d), _v(0.055, p), "timber")
