# Station yard direction study

Two side-by-side canvas compositions use identical station pixels, scale, anchor,
human reference figures and terrain seed. Only the paving coverage changes.
The accepted contracted station receives the approved 1.2 horizontal multiplier.
The proposed 5x4 lot is illustrative; gameplay placement/save data is untouched.

Grass and paving sample the original terrain-grass.png and people-road-stone.png
illustrations. Continuous world-coordinate sampling and mirrored material patches
avoid abrupt tile-local resets. An irregular signed-distance mask blends the stone
into grass across edges and corners. This is a prototype of a continuous material
field, not proof of a complete game autotiling implementation. Mirrored motifs may
still be visible, and the tile palette beyond grass/stone is not implemented here.

Human reference figures are schematic, not final character art. The 1.75m reference
and approximately 2.1m door are visual assumptions for discussion, not a measured
architectural reconstruction. No trains or other buildings are rescaled in this study.

Direction chosen: B, the full-footprint forecourt. Stone now repeats the original
paving illustration in a consistent orientation instead of mirroring its joints.
The larger stones preserve the warm limestone palette and irregular slab sizes.
Grass blending and the station scale remain unchanged. Stone repeat boundaries
still need production seam validation; this change addresses the optical zigzag.

