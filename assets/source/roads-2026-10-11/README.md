# Road and crossing pictures

Issue: #319, part 1: the finished source pictures.

Status: the 19 finished pictures at this folder's root follow the author's choices of 2026-10-11
and pass `check-final.mjs`. They are source pictures only. The atlas, its frame keys and the test
that #319 asks for wait on #309, which adds the road pieces to the game, so #319 stays open.

## The author's choices (decision board, 2026-10-11)

The author chose from composites of road variants on a real game capture, made by Core's variant
tool (a parameterised copy of `finish-roads.mjs`); the chosen set was `w0.32-B-stone`.

- **Width 0.32 tile**, the whole visible road.
- **Edge B**: no drawn verge. The gravel's edge fades into the grass over about 0.05 tile, with a
  few grass tufts across it, in the colours of the game's painted grass.
- **Level crossings**: dressed stone on regular track and packed dirt on narrow track, after the
  author's own base-v1 crossings (`assets/source/base-v1/people-crossing-stone.png` and
  `people-crossing-dirt.png`). Each deck is as long along the track as the road is wide, flush
  with it, and reaches 0.06 tile past each rail (the game's sleeper ends): 0.22 from the track's
  centre line on regular gauge, 0.14 on narrow. The rail lines stay thin slots in the rail colour,
  not black grooves: each rail is drawn as the game draws it on the track, a thin bright head with
  a thin dark side a rail's height below it on screen.
- With them: the gravel toned to the composites' colour (mean 182,162,133, luma 165, the
  brightness of the author's base-v1 stone road and dirt path), the ruts softened to 0.45 of their
  painted strength, and 2 world px of bleed past the tile edge on each joining leg, so separately
  filtered sprites overlap instead of letting the grass through at the joins.

The issue's acceptance criteria still describe the earlier geometry (decks 0.1 tile outside the
rails, pictures cut to the diamond, railheads cut out); see "Next" below.

## Finished pictures

- Roads (prompt C1): `road-straight-x.png` (NW-SE), `road-straight-y.png` (NE-SW),
  `road-curve-{ne-se,se-sw,sw-nw,nw-ne}.png`, `road-tee-closed-{ne,se,sw,nw}.png` (each joins the
  other three edges), `road-end-{ne,se,sw,nw}.png` (enters from that edge), `road-cross.png`.
- Level crossings (prompt C2): `crossing-regular-r0.png`, `crossing-regular-r1.png`,
  `crossing-narrow-r0.png`, `crossing-narrow-r1.png`. Rotation 0 has the track along tile y and
  the road from NW to SE; rotation 1 has the track along tile x and the road from NE to SW. There
  are no level crossings on high-speed track (Q36 a).

Every picture is 1024x1024 RGBA in the one-tile convention of `tools/building-kit.mjs`
(`FOOTPRINTS.t1`, scale 8): the tile is the diamond top (512,704), right (768,832), bottom
(512,960), left (256,832), and the anchor is the tile centre (512,832), which the packer maps to
(32,16). Inside the diamond the road is opaque to 0.12 tile from its centre line and fades out
round 0.16; tufts reach from about 0.08 to 0.24. Outside the diamond only the bleed shows: each
joining leg runs on 2 world px (0.056 tile along the edge's normal) as the straight road of its
direction, where that is nearly opaque. Elsewhere alpha is 0, and the colour carries on under
it, so filtering never pulls in a dark fringe.

`finish.json` records the options the pictures were made with and what the script measured.

## The material: Codex's road strips

The roads are made from `materials/road-strip-x.png` and `materials/road-strip-y.png` (Codex,
8699ec3a, the author's revised material brief), not from the first drafts
(`raw/road-straight-{x,y}.png`). At 0.32 they make the better road:

- Each strip gives a whole tile of road: one tile takes 1.6 (x) and 1.7 (y) tiles from the middle
  of a strip, so a straight road repeats once a tile. The drafts hold under a tile of road and at
  this width repeated the same stretch two (x) and three (y) times within every tile.
- Both directions have their own two straight ruts at a constant spacing. The draft x road was
  painted with one central rut and had its across profile rewritten to the y road's.
- Nothing is lost: on the finished straight roads the two materials come out alike, toned to the
  same colour, with the same rut depth, and as even along the road (the broad drift of each line
  along the gravel about 1.5 levels, its texture about 5, standard deviations).

Composed on the game capture both read alike at zoom 1; at zoom 2 the Codex ruts read the same in
both directions. What the strips needed:

- **Angle and frame.** They are 1536x1024, off the tile canvas, drawn at 29.7 (x) and -29.3 (y)
  degrees instead of 26.6, and wider than the guide's band (0.52 and 0.55 tile of gravel against
  0.5 in the guide's frame). Each strip's frame comes from its own alpha: its long sides, fitted
  column by column, give the painted direction and centre, and rows are sampled along that
  direction, so the angle is rectified.
- **Per-row fit.** The alpha edges, gravel edges and ruts are found row by row along 3.8 (x) and
  4.0 (y) tiles of strip and fitted with lines, which take up the x strip's slight taper (its
  sides 0.7 degrees apart); each row is then mapped onto the exact cross-section.
- **Tone.** Their gravel is brighter and yellower than the drafts' (about 214,188,146 after the
  ruts are softened), so it is scaled per channel to the composites' mean, 182,162,133. With
  ruts at 0.45 the ruts lie about 15 levels below the gravel beside them, as in the composites.
- **Alpha.** Inside, the strips' alpha is 251 to 253, not 255; sampling is premultiplied and the
  pictures take their alpha from the geometry, so this does not show.

Codex's crossing materials (`materials/crossing-material-{regular,narrow}.png`) are not used: the
author chose stone and dirt after the base-v1 crossings. The decks are drawn in colours sampled
from those pictures (`colours.json`), at the brightness the author saw (`--deck-scale 0.8605`),
the dirt taken 60% of the way to the gravel's hue so it reads as earth of the same road.

## How the pictures are finished (`finish-roads.mjs`)

The paintings are the material and the geometry is the shape: prompting again does not hit exact
widths, so every picture is resampled through a mapping built from `geometry.json` and
`crossing-geometry.json`.

- **Two strips.** One per direction, so each keeps its own painted light. A strip has an across
  coordinate (band |u| <= 0.16) and an along coordinate that repeats seamlessly, cross-faded in
  the middle of the tile and 0 at every edge midpoint, so every piece shows the same
  cross-section where it meets its neighbour. The ruts sit at +-0.064 (0.4 of the half-width).
  Along the road the painting is scaled as across it, so the stones keep their shape.
- **Pieces.** Straight legs run from the tile centre to the edge midpoint. End pieces stop at the
  centre with a round cap in which the ruts turn round in a U. Curves bend the strips round the
  quarter circle of radius 0.5 about the corner between their edges and blend the x strip into
  the y strip over the middle of the arc. Tees and the cross are the union of their legs: the
  through road's ruts continue (the x road on the cross) and the branch's ruts fade into it.
- **Edge.** The gravel darkens toward worn soil over its outer 0.06 tile and its alpha fades over
  0.05 round an edge that wanders gently (up to about 0.013). Grass tufts in the game's grass
  colours sit astride the edge. Wander and tufts are functions of the tile position with period
  1, and near an edge the tufts are placed by the position along it, so they are the same on both
  sides of every join.
- **Crossings.** The road crosses the track at right angles. Over the track the deck spans the
  road band (|u| <= 0.16) with a hard, flush edge and reaches 0.06 tile past each rail: dressed
  stone slabs with staggered joints on regular gauge, packed dirt with a few pebbles on narrow.
  The slabs stop short of each rail, which is drawn as the game draws it (measured on a game
  capture): a bright head 0.0095 tile screen-up of the rail line and a dark side 0.0245 (regular)
  or 0.0205 (narrow) below it, with a thin flangeway above the head. Beyond the deck the road is
  the same strip as the road pieces; its edge runs straight into the deck's corners, and no tufts
  grow on the ballast.

The script prints what it measured: each strip's painted angle, its fitted edges and ruts, its
scale, period and source window, and the tone scale. Every run writes the same bytes.

## Checks (`check-final.mjs`, `final-check.json`)

`check-final.mjs` takes the geometry from `geometry.json` and `crossing-geometry.json` and the
author's choices from its own constants, not from the finishing script, and fails if anything
misses. The rules are in `final-check.json`; in short:

- **Width and edge**: opaque within 0.12 of the centre line; the mean alpha across the edge (tufts
  left out) through one half within 0.01 of 0.16; its 90% to 10% fade between 0.02 and 0.08
  tile, so neither a hard outline nor a smear.
- **Tufts**: only across the edge (0.06 to 0.26 from the centre line); nothing beyond them.
- **Bleed**: outside the diamond only within 2 world px past a joining edge; never more opaque
  than any neighbour that joins there (so it cannot widen the road or light its edge); its colour
  within 2 levels of the neighbour's on average.
- **Joins**: at atlas resolution 4 every picture that meets an edge midpoint shows the same
  cross-section there (within 6 levels), the road there is 0.32 +- 0.02 wide and centred within
  0.015; across each edge line its width and centre step no more than they drift over the same
  distance on either side (0.002).
- **Crossings**: the deck opaque over the band to 0.06 past each rail and nothing beside it over
  the track; the deck's end within two pixels of 0.22 (regular) or 0.14 (narrow); on each rail
  the head within 0.004 of -0.0095 and the dark side within 0.004 of 0.0245 (regular) or 0.0205
  (narrow), at least 60 luma apart, the dark side at least 40 (not black).
- **Materials**: the stone deck at least 15 luma paler than the dirt deck. **Tone**: the straight
  roads' gravel within 4 levels of 182,162,133.

Result: all 19 pictures, all four joins, the materials and the tone pass.

| Picture             | Edge at half alpha | Fade 90-10% | Tufts from..to | Bleed per leg: wider / mean / max diff                 | Deck ends  | Slots: head, dark               |
| ------------------- | ------------------ | ----------- | -------------- | ------------------------------------------------------ | ---------- | ------------------------------- |
| road-straight-x     | 0.1578             | 0.0329      | 0.0889..0.2295 | nw 0/0.23/20, se 0/0.25/22                             |            |                                 |
| road-straight-y     | 0.16               | 0.0319      | 0.0967..0.2314 | ne 0/0.32/25, sw 0/0.35/22                             |            |                                 |
| road-curve-ne-se    | 0.1596             | 0.0314      | 0.0823..0.2246 | ne 0/0.32/25, se 0/0.25/22                             |            |                                 |
| road-curve-se-sw    | 0.1582             | 0.0338      | 0.0881..0.2356 | se 0/0.25/22, sw 0/0.35/22                             |            |                                 |
| road-curve-sw-nw    | 0.1576             | 0.0318      | 0.1085..0.2312 | sw 0/0.35/22, nw 0/0.23/20                             |            |                                 |
| road-curve-nw-ne    | 0.1587             | 0.033       | 0.0913..0.231  | nw 0/0.23/20, ne 0/0.32/25                             |            |                                 |
| road-tee-closed-ne  | 0.1574             | 0.0335      | 0.0889..0.2295 | se 0/0.25/22, sw 0/0.35/22, nw 0/0.23/20               |            |                                 |
| road-tee-closed-se  | 0.1584             | 0.0325      | 0.0967..0.2236 | ne 0/0.32/25, sw 0/0.35/22, nw 0/0.23/20               |            |                                 |
| road-tee-closed-sw  | 0.1583             | 0.0321      | 0.0889..0.2295 | ne 0/0.32/25, se 0/0.25/22, nw 0/0.23/20               |            |                                 |
| road-tee-closed-nw  | 0.1587             | 0.0325      | 0.0889..0.2314 | ne 0/0.32/25, se 0/0.25/22, sw 0/0.35/22               |            |                                 |
| road-end-ne         | 0.1613             | 0.031       | 0.0967..0.2314 | ne 0/0.32/25                                           |            |                                 |
| road-end-se         | 0.1597             | 0.0323      | 0.0889..0.2319 | se 0/0.25/22                                           |            |                                 |
| road-end-sw         | 0.1598             | 0.032       | 0.0967..0.2319 | sw 0/0.35/22                                           |            |                                 |
| road-end-nw         | 0.1588             | 0.0305      | 0.0967..0.2301 | nw 0/0.23/20                                           |            |                                 |
| road-cross          | 0.1578             | 0.0328      | 0.0889..0.2295 | ne 0/0.32/25, se 0/0.25/22, sw 0/0.35/22, nw 0/0.23/20 |            |                                 |
| crossing-regular-r0 | 0.1546             | 0.0293      | 0.1045..0.2295 | nw 0/0.23/20, se 0/0.25/22                             | 0.22, 0.22 | -0.009, 0.0245; -0.0095, 0.0245 |
| crossing-regular-r1 | 0.1583             | 0.0348      | 0.1045..0.2178 | ne 0/0.32/25, sw 0/0.35/22                             | 0.22, 0.22 | -0.009, 0.0245; -0.0095, 0.0245 |
| crossing-narrow-r0  | 0.1548             | 0.0302      | 0.1006..0.2295 | nw 0/0.23/20, se 0/0.25/22                             | 0.14, 0.14 | -0.009, 0.0205; -0.009, 0.0205  |
| crossing-narrow-r1  | 0.1587             | 0.0334      | 0.0967..0.2197 | ne 0/0.32/25, sw 0/0.35/22                             | 0.14, 0.14 | -0.009, 0.0205; -0.009, 0.0205  |

Every picture's core is opaque, nothing lies beyond the tufts or outside the bleed, and no bleed
pixel is more opaque than a neighbour under it. Joins: the cross-sections at each edge differ by
at most 0.68 levels across the 10 pictures that meet there; the road there is 0.300 to 0.313
wide (tufts left out) and centred within 0.0062; across the NE/SW lines width and centre step
0.0003 beyond their drift, across SE/NW 0.0009 and 0.0006. The bleed's largest single
differences (20 to 25 levels) lie over curves, whose road leaves the straight line within the
2 px. Decks: stone 159 luma (172,157,133), dirt 136 (160,131,99); the slots' dark side is
(66,67,51) on regular and (66,64,53) on narrow, 63 to 65 luma, 113 to 121 below the head. Tone:
the straight roads' gravel averages 179.7,160,130.4 (it includes the ruts).

Run on the 0.5 finish (`raw/final-w0.5-moss-verge/`) the check fails on width, edge, bleed,
decks, slots and tone; on the drafts made with the same options (`--material drafts`) it passes;
with one curve moved by two pixels it fails the joins and its neighbours' bleed.

## Review images

- `review/final-on-game-z1.png` and `review/final-on-game-z2.png` (`review-on-game.mjs`): the
  pictures on a real game capture at zoom 1 and 2, each reduced on its own and laid on its own
  tile as the game draws separate sprites, so a seam would show. The network uses every road
  piece: a 3x3 block of the four curves, the four tees and a cross, whose second cross leads a
  road south over the regular track (`crossing-regular-r1`), round a curve and east past a tee
  (its branch ends at once) over the narrow track (`crossing-narrow-r0`) to an end; and an L from
  an end round a curve over the regular track to an end. Looked at enlarged up to 6 times: no
  seams, width jumps, rut breaks or haloes at the joins, and the slots lie on the game's rails.
  The capture is `review/game-capture-z1.png` and `-z2.png`, crops described in
  `review/game-capture.json`; it has no track for the other two crossings.
- `review/final-network.png` (`check-final.mjs`): every piece at resolution 4 on a flat grass
  fill, all four crossings over plain grey rails at the exact offsets;
  `review/final-network-1x.png` the same at game scale.

## Rerun

```
node assets/source/roads-2026-10-11/finish-roads.mjs
node assets/source/roads-2026-10-11/check-final.mjs
node assets/source/roads-2026-10-11/review-on-game.mjs
```

They use only `pngjs` from the repository's devDependencies, and a rerun writes the same bytes.
`finish-roads.mjs` documents its options in its header; `--out <dir>` writes elsewhere, and
`review-on-game.mjs --pictures <dir> --out <prefix>` composes another set. The 0.5 finish of
1dcd8e3 comes back byte for byte with
`--material drafts --width 0.5 --edge crisp --crossing painted --tone 0 --ruts 1 --bleed 0`.

## Next: the atlas (#309)

The atlas waits on #309. When the road pieces exist the pictures are packed at resolution 4 with
anchor (32,16). Two points of the issue's acceptance criteria no longer fit the pictures and need
the author's word first:

- **Bleed.** The criteria say each picture is cut to the tile diamond. Cutting would drop the
  2 px bleed; the frames should keep it (at resolution 4 it reaches about 7 texels left or right
  and 4 up or down past the diamond's edges).
- **Rails.** The criteria say each crossing's rail lines are cut out at the class's offset, and
  that the deck ends 0.1 tile outside its rails. The chosen decks paint the game's rails as thin
  slots and end 0.06 past them, so nothing needs cutting out; cutting would leave a gap between
  the painted head and dark side.

## Provenance

The author's paintings and Codex's materials are kept byte for byte; finishing only reads them.

- **First drafts** (prompts C1 and C2, committed with their failed checks in `9dbeb5d` and
  `830ec79`): `raw/road-*.png`, the 15 road drafts, one per piece, without mirroring or reuse,
  and the rejected `raw/road-straight-x-attempt-1.png`, all 1254x1254, framed like the 1024
  guide scaled by 1254/1024; `raw/crossing-*-attempt-1.png`, the first crossing paintings,
  rejected because they copied metallic railheads and sometimes the wrong rotation from the
  references; `raw/crossing-*-attempt-2.png`, the corrected crossing paintings. Their prompts are
  the `-attempt-3` entries in `prompts.json` and those of the first paintings the `-attempt-2`
  entries: the entries without a suffix are the six-reference prompts, which painted nothing (the
  tool refused them before generating because it accepts at most five references), so prompt
  numbering runs one ahead of the paintings.
- **The first finish** (1dcd8e3): `raw/final-w0.5-moss-verge/`, the 19 pictures 0.5 tile wide
  with a 0.03 moss verge and decks rectified from the corrected crossing paintings with dark
  grooves 0.1 tile outside the rails.
- **Codex's materials** (8699ec3a, the author's revised material brief): `materials/` the four
  selected paintings, 1536x1024 RGBA, and `raw/materials/` byte-identical copies of them with
  the four `-alpha-correction` regenerations, which were rejected (not edits) and are not used;
  `materials.json` (manifest, alpha counts, colour samples along each road) and
  `material-generations.json` (generator output paths on the author's machine);
  `guides/materials/` loose silhouettes from `make-material-guides.mjs`;
  `review/materials-sheet.png` and `review/material-alpha-look.png` (the apparent glow is colour
  stored under alpha 0, invisible in a composite), from `review-materials.mjs`. The two scripts
  need `sharp`, which is not a dependency of this repository, and are kept as provenance only.
- **Guides and geometry**: `make-guides.mjs`, `guides/road-*.png`, `geometry.json` (the exact
  `FOOTPRINTS.t1` geometry, edge midpoints and pieces); `make-crossing-guides.mjs`,
  `guides/crossing-*.png`, `crossing-geometry.json` (rail offsets, road edges). These describe the
  prompts' 0.5 band and 0.1 deck; the finish reads only the tile geometry, rail offsets and legs
  from them.
- **Prompts**: `prompts.json`, every generation prompt and its references; the four
  `-alpha-correction` entries now name the files they produced. `generations.json` and
  `crossing-generations.json`: the generator's output paths and the saved paths.
- **Draft checks**: `check-raw.mjs`, `raw-check.json`, `check-crossings.mjs`,
  `crossing-check.json`: the drafts' measured failures; `review/*-canvas-64.png`,
  `review/*-tile-64.png`, `review/raw-sheet.png`, `review/crossings-sheet.png`: their previews.
- **Game colours**: `colours.json`, sampled by Core's variant tool on 2026-10-11 from game
  captures (grass, sleepers, ballast, rails) and from the base-v1 crossings (stone, dirt).

The draft and material scripts need `sharp`. On the author's machine, in PowerShell:

```powershell
$env:ROAD_TOOLING='C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
node assets/source/roads-2026-10-11/make-guides.mjs
node assets/source/roads-2026-10-11/check-raw.mjs
node assets/source/roads-2026-10-11/make-crossing-guides.mjs
node assets/source/roads-2026-10-11/check-crossings.mjs
node assets/source/roads-2026-10-11/make-material-guides.mjs
node assets/source/roads-2026-10-11/review-materials.mjs
```
