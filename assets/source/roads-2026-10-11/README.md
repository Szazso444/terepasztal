# Road and crossing pictures

Issue: #319. Branch: `art/319-roads`, based on `origin/develop` at `dea4267`.

Status: the 19 finished pictures at this folder's root fit the exact tile geometry and pass
`check-final.mjs`. They are source pictures only. The atlas, its frame keys and the test that
#319 asks for wait on #309, which adds the road pieces to the game, so #319 stays open.

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
(32,16). The road band is exactly 0.5 tile wide (|offset| <= 0.25) and opaque, the moss verge
ends at 0.28, and alpha is 0 beyond it and outside the diamond. The outline is antialiased over
one canvas pixel, half a texel at atlas resolution 4. A pixel belongs to the diamond by its
centre, so neighbouring tiles cover the ground without gaps; just outside the diamond and the
verge the colour continues under alpha 0, so filtering never pulls in a dark fringe.

## How the drafts were finished (`finish-roads.mjs`)

The paintings were the right material at the wrong geometry: road widths from 0.5 to 0.95 tile,
end pieces past the centre or off the axis, crossing decks across the whole diamond with grooves
off the rail lines. Prompting again does not hit exact widths, so finishing is deterministic: the
paintings are the material and `geometry.json` and `crossing-geometry.json` are the shape.

- **Two strips.** The gravel is unwrapped into a strip from `raw/road-straight-x.png` for legs
  along tile x and from `raw/road-straight-y.png` for legs along tile y, so each direction keeps
  its own painted light. The painted gravel edges, verge and ruts are found row by row, fitted
  with lines and mapped piecewise-linearly onto the band (|u| <= 0.25), the verge (to 0.28) and
  the ruts (u = +-0.1). Along the road the painting is scaled by the same factor as across, so the
  stones keep their shape: the x strip repeats once per tile (0.84 tile of painting), the
  y strip, painted 1.47 times too wide, twice per tile. The ends of each strip are cross-faded in
  the middle of the tile, and v = 0 falls on every edge midpoint, so every piece shows the same
  cross-section where it meets its neighbour.
- **Two ruts in both directions.** `road-straight-x` was painted with one central rut. Its strip
  keeps its own stones and light but takes the across profile of the y strip, two ruts at
  +-0.1, so x roads, y roads and the curves between them agree.
- **Pieces.** Straight legs run from the tile centre to the edge midpoint. End pieces stop at the
  centre with a round cap in which the ruts turn round in a U. Curves bend the strips round the
  quarter circle of radius 0.5 about the corner between their edges and blend the x strip into
  the y strip over the middle of the arc, by the tangent's angle; near the edges they use the
  true arc length, so their first texels match a straight leg's. Tees and the cross are the union
  of their legs: the through road's ruts continue (the x road on the cross), the branch's ruts
  fade into it, and the gravel-to-verge edge follows the union's outline, with the square inner
  corners of the guides.
- **Crossings.** The road crosses the track at right angles, |offset along the track| <= 0.25.
  The deck covers that band between the rails and 0.1 tile outside each rail. It is rectified
  from the crossing paintings (`raw/crossing-*-attempt-2.png`): their painted deck edges and
  grooves are fitted row by row and mapped onto the exact deck, keeping limestone setts with
  timber check planks (regular) and weathered timber planks (narrow). Each rail is drawn as a dark
  groove centred exactly on +-0.16 (regular) or +-0.08 (narrow) from the track centre line,
  0.04 tile wide like the game's 1.25 px rail line, in the colour of the painted grooves. Outside
  the deck the road is the same gravel strip as the road pieces, verge included, and runs to the
  two edges; there is no verge beside the deck. The setts painted on the approaches of narrow r1
  are not used.

The script prints what it measured: the fitted edges and ruts of both strips, their scale and
period, and each crossing's deck edges, grooves and groove colour. It is deterministic.

## Checks (`check-final.mjs`, `final-check.json`)

`check-final.mjs` reads the geometry from `geometry.json` and `crossing-geometry.json`, not from
the finishing script, and fails if anything misses. Per picture: a 1024x1024 RGBA canvas; alpha
0 outside the diamond and beyond the verge (and beside a crossing's deck); every band pixel
opaque; partial alpha only within one texel at resolution 4 of an outline; the content's bounds
within one pixel of the geometry's around the anchor (512,832); on crossings, a dark groove
centred within 0.004 tile of each rail line. Across pictures, each is reduced to resolution 4
(the diamond 256x128): every piece that meets an edge midpoint must show the same cross-section
there, and opposite edges must have the same opaque span, so neighbours join at the same width
and place.

Current result: all 19 pictures and all four edge joins pass. Straight legs, ends, tees, the
cross and the crossings match the straight piece exactly at every edge; the curves differ by up
to 4.1 of 255 levels, because their inner verge (radius 0.22) leaves the straight line inside
the first texel. The tolerance is 6 levels.

It also writes the review images:

- `review/final-network.png`: the pieces at resolution 4 on a flat grass fill: a 3x3 loop of the
  four curves, the four tees and the cross; a straight-x line between `road-end-se` and
  `road-end-nw`; a straight-y line between `road-end-sw` and `road-end-ne`; a road along x
  through `crossing-regular-r0` and `crossing-narrow-r0`; and a road along y through
  `crossing-regular-r1` and `crossing-narrow-r1`, with plain grey rails drawn at the exact offsets
  under the grooves.
- `review/final-network-1x.png`: the same at game scale.

## Rerun

```
node assets/source/roads-2026-10-11/finish-roads.mjs
node assets/source/roads-2026-10-11/check-final.mjs
```

Both use only `pngjs` from the repository's devDependencies.

## Next: the atlas (#309)

The atlas waits on #309. When the road pieces exist, the pictures are cut to the diamond and
packed at resolution 4 with anchor (32,16), and each crossing's railheads are cut out along its
grooves (0.04 tile wide, centred on the rail lines) so the game's rails show through.

## Provenance of the drafts

The author painted the drafts with Codex image generation and asked for them to be committed
with their failed checks: the roads in `9dbeb5d`, the crossings in `830ec79`. Every original is
kept byte for byte; finishing only reads them.

- `make-guides.mjs`: exact `FOOTPRINTS.t1` geometry and one grey guide per road piece;
  `guides/`: the 15 road guides that were the edit targets; `geometry.json`: coordinates, edge
  midpoints, centre, scale and piece definitions.
- `prompts.json`: every generation prompt and its references. `generations.json`: the image
  generator's output paths and the saved draft paths.
- `raw/road-*.png`: the 15 road drafts, one generated per piece, without mirroring or reuse;
  `raw/road-straight-x-attempt-1.png` is a rejected attempt. All are 1254x1254, the image
  tool's size, framed like the 1024 guide scaled by 1254/1024.
- `check-raw.mjs`, `raw-check.json`: the drafts' measured failures (canvas, alpha beyond the
  diamond, widths and alignment at the joins). `review/*-canvas-64.png`, `review/*-tile-64.png`
  and `review/raw-sheet.png`: 64-pixel previews of the drafts.
- `make-crossing-guides.mjs`, `crossing-geometry.json`, `guides/crossing-*.png`: the four exact
  crossing guides, road width, rail offsets and deck extents.
- `raw/crossing-*-attempt-1.png`: the first crossing paintings, rejected because they copied
  metallic railheads and sometimes the wrong rotation from the references.
  `raw/crossing-*-attempt-2.png`: the corrected paintings, which were at this folder's root under
  the final names until finishing took those names; moved byte for byte. Their prompts are the
  `-attempt-3` entries in `prompts.json` and those of the first paintings the `-attempt-2`
  entries: the entries without a suffix are the six-reference prompts, which painted nothing
  (the tool refused the first pair before generating because it accepts at most five
  references), so prompt numbering runs one ahead of the paintings. The optional road draft was
  left out of every crossing call for that reason.
- `crossing-generations.json`: the crossing paintings' generator output and saved paths.
  `check-crossings.mjs`, `crossing-check.json`, `review/crossings-sheet.png`: the corrected
  crossing drafts' failed canvas and alpha checks and their game-scale review.

The draft scripts need `sharp`, which is not a dependency of this repository. On the author's
machine, in PowerShell:

```powershell
$env:ROAD_TOOLING='C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
node assets/source/roads-2026-10-11/make-guides.mjs
node assets/source/roads-2026-10-11/check-raw.mjs
node assets/source/roads-2026-10-11/make-crossing-guides.mjs
node assets/source/roads-2026-10-11/check-crossings.mjs
```
