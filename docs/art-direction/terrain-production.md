# Illustrated terrain: production integration

Implements the approved v4 direction plus the user's subsequent refinements:
mixed light/balanced/rich patches, painted stones, slightly softer interlocks and
foundation features following the actual model silhouette.

## Runtime

- `terrainMaterials.ts` samples the approved source art in irregular world-space
  patches. Each patch interior shows one unblended, bilinear source sample at full
  contrast; only a warped seam of .16 patch cells blends neighbouring patches. The old
  four-offset average and the pull toward a base colour are gone.
- Light, balanced and rich areas come from texture selection: each patch has six
  seeded source offsets, and the slow `grassDetail` field picks the calmest, median
  or busiest of them (block contrast of the packed art). Grass strokes also follow
  that field. Nothing resets on tile borders or changes when the camera moves.
- The illustrated tiles are pixel art at about four source pixels per art pixel. The packer
  now rounds them into smooth painted contours (`tools/pixel-art.mjs`, radius 3), the
  approved "both smooth" style; see the art-direction README.
  `SURFACE_RATE` shows one art pixel per world pixel, the density of the placed
  sprites; the previous scale showed about 2.2, which read as blocks once sharp.
- Material ownership uses the approved irregular interlock. Only a .06-tile strip
  at the displaced boundary blends colours. Coast displacement is narrower.
- Small stones are baked into the ground image. Grass strokes are cached vector
  geometry within each terrain chunk so they remain legible at high zoom without
  multiplying the size of every terrain texture. Neither creates simulation props.
- `Landscape` paints 8×8 chunks in a pool of workers (one per core less one, at
  most six), caches them and culls them. The chunks in the camera's view paint
  first, nearest the centre first, and each chunk shows as soon as it is painted;
  the native tiles cover only the chunks still waiting. Paints are deterministic,
  so the pool produces the same pixels as one worker. Changes invalidate nearby
  chunks; seasonal changes repaint revealed chunks. Stale worker results are
  discarded. City paving is painted onto the same relief surface.
- The painter's ray march skips heights above each cell's highest point
  (`terraceCaps`), and lands on exactly the height the full march finds.
  `scratchpad/perf/` times a 128 × 128 world (`run.mjs`, in the browser) and hashes
  every painted chunk (`paint.mjs`, under Node), so a painter change can be shown
  to keep its pixels.
- Close views (above 1.4 screen pixels per world pixel, device pixel ratio included)
  add double-resolution copies of the 48 chunks nearest the view centre, about
  2.5 MB each. The base cache stays underneath and is shown again on zooming out.
  After an edit, a chunk shown sharp is repainted sharp first, so it never drops
  back to the base cache. Base chunks read a half-size copy of the sheet so they
  stay filtered; both copies select identical patches.
- Native tiles remain a fallback while loading, for newly revealed chunks, and if
  the worker or texture asset cannot load. Workers/textures/geometry are disposed
  with the scene. No new runtime dependency was added.
- `SurfaceAssets.groundContour` reads the actual bottom alpha silhouette. Broken
  soil, grass and tiny stone marks stay within roughly three world pixels of that
  contour. This replaces the two generic anchor-centred scuffs. The existing subtle
  base-pixel fade remains; it does not blur the walls or roof.

## Connected hills

`terrainRelief.ts` derives a shared corner lattice from existing hill/mountain tiles.
Discrete levels use 10 world pixels; hill interiors can reach two levels, mountain
interiors four. Neighbours share corner values and edge interpolation exactly.
Bilinear corner interpolation with bounded rounded crowns produces slopes,
shoulders, saddles, ridges and plateaus without internal triangle-fan creases.
Lighting samples a wider neighbourhood to soften tile-edge changes in slope.
Sparse small centre peaks and illustrated summit caps break the repeated hill stamp.
The original mountain artwork supplies the caps, with a softened lower contour.
Rocky surfaces are predominantly grass, with irregular world-space islands of the
existing rock material and grass tufts between them. Islands are fully rock inside
with a narrow irregular edge. Rock is mapped screen-aligned like the illustrated
tiles, at about six source pixels per screen pixel, so its painted boulder faces keep
the upper-left light of the mountain art instead of reading as rotated paving.
It is still ground texture: the concept's standing outcrops with vertical cliff
faces and silhouettes need separate outcrop sprites, not a surface texture.

This is a render-derived elevation system, not new gameplay gradients. Existing
hill cost/buildability rules apply. Rail and structure excavation constrains all
four corners and the centre to zero. The entire track footprint stays flat. Prop,
structure, person and effect anchors sample the same surface. Terrain mouse picking
uses its inverse projection. Mountain silhouette caps are decorative on unbuildable
terrain. Steep rail grades, tunnels and bridges across height bands are not introduced.

Terrain/biome/variant planes, generation hashes and save version are unchanged.
Shared heights are reconstructed deterministically on load from terrain and the
existing excavated footprints. World-space sampling preserves texture placement
when a saved map expands around its origin.

## Assets and regeneration

`npm run art:terrain` packages ten source surfaces into
`public/assets/terrain-surfaces.png` with a provenance manifest. Illustrated tiles
keep only the opaque centre window the sampler reads (`WINDOW`, matching
`SURFACE_WINDOW`) at native detail, area-reduced or linearly enlarged into
512×512 cells; rock keeps the whole image. Original grass,
forest, desert, taiga, swamp, sand, water and road art comes from `base-v1`.
`assets/source/terrain-production/rock-surface.png` was generated with built-in
ImageGen using the approved hill and mountain as style references. Exact request:
`assets/source/terrain-production/rock-prompt.json`. The user-provided red foundation
markup is retained as `foundation-reference.png`. The generated concept board in
`terrain-v4` remains reference material, not a production atlas.

## Verification and delivery

- 168 unit tests pass in this checkout, including rounded-crown continuity, edge
  continuity, whole-footprint excavation, projection stability/picking, shared source
  coordinates, detail variation, narrow blend invariants and sampling that never
  leaves the opaque painted tile. Existing generation golden hashes still pass.
- Typecheck, ESLint, production build and formatting checks pass. The existing
  large-bundle warning remains.
- `scratchpad/terrain-production/verify.mjs`: 256 chunks, no repaint during panning,
  a nine-chunk local edit, actual Builder track placement/removal, flat rail contact,
  stale-worker rejection, season tint preserving water, and disposal.
- `production.mjs`: normal production entry point (160×160 starting-region expansion),
  active painter and native fallback when the surface PNG is unavailable. No browser
  errors in either path.
- `capture.mjs`: ten actual generated 128×128 world renders, with 114 connected rail
  pieces and 20 structures, unchanged map planes and common human scale checks.
- Four controlled detail views, one cropped foundation close-up and the normal
  playable build are also in `scratchpad/terrain-production/gallery.html`.
- `sharpness/`: before/after pairs of the sharpness pass from the same captures.
- Delivery: `G:/DEV/Terepasztal/renders/terrain-production/` (copied by `publish.mjs`
  when that drive exists).

The full-map software-browser cache measured about eight seconds during QA; the
sharpness pass keeps base paint cost level (23 s against 26 s before, on a slower
Linux container). A double-resolution chunk costs about four base chunks. The
game continues using fallback tiles while it loads. Camera movement reuses the
cache. Exact timings depend on hardware and the number of revealed regions.

## Hills, rails on slopes and scatter (approved 2026-09-26)

- **Level height 1/4 of a tile side** (9.8 world px), chosen from the 1/10, 1/5, 1/4 and 1/3
  comparison. A tile edge rises one or two levels (seeded per edge); mountains reach four.
  Every tile is lit by its own slope, and rock shows on steep faces instead of random islands.
  `DEFAULT_RELIEF` in `terrainRelief.ts`; the earlier style stays expressible for comparison.
- **Rails no longer cut hills.** Built tiles keep the hill's corner heights and only lose the
  small crown. Straight track may climb one level across a tile; curves, switches, crossings,
  stations, buildings and placed decor need a level tile at any height (`groundAllows`,
  enforced through `Builder.groundCheck`). Track sprites pitch along their own axis; every
  train part and bogie stands on the surface under it, pitched along its own heading.
  Saves are unchanged: heights still derive from terrain.
- **Scatter** (`scatter.ts`): visual-only nature placed where it belongs — reeds on shores,
  bushes and young trees at forest edges, flower patches in meadows, boulders at steep faces
  and mountain feet, sparse desert and taiga accents. Seeded by world position; nothing on
  generated props, track, stations, buildings, decor or town paving. No map generation change.
- Evidence: `scratchpad/hill-levels/renders/` (level heights, `rails-climb-z*.jpg`).

## Locked hill style: terraces at 1/4 levels with rock banks (approved 2026-09-27)

`DEFAULT_RELIEF` = `{ step: TILE_SIDE_PX / 4, maxRise: 1, faces: true, shape: 'terraces',
bank: 0.5, rims: true }`. Every hill tile is a level plateau at its own level (9.8 world px per
level); neighbouring tiles differ by at most one level; the change is a rounded bank half a tile
wide, centred on the shared edge; banks show rock; rim light on slope tops, soft shade at feet.
Chosen from the comparison in `scratchpad/hill-levels/renders/shape-*.jpg`
("terraces-quarter"). The corner-slope style remains selectable for comparison only.

### Follow-ups on the locked style (2026-09-27)

- Rock only on stacked banks: a single one-level bank stays grass with an occasional noise
  outcrop; banks that stack two levels within about a tile, and every mountain bank, are rock.
  Boulders scatter along stacked banks. `everyBankRock` in the relief style restores the old rule
  for comparison.
- Summit sprites fade into the rock over a band twice as tall. Plateau tops stay grass, as in
  the locked version (`everyBankRock` keeps the locked bank rule selectable).
- Tile levels live in `src/world/elevation.ts` (hills 2, mountains 4, neighbours within one
  level). The tooltip shows the tile's elevation as a level; sea level is 0. No metres.
- Rails follow the incline rules in `docs/rail-inclines.md`: each straight line has one
  continuous height profile, track pieces bend with it as meshes, and bridges carry a level
  across dips. Curves, switches, stations, decor and buildings need a tile that no bank reaches
  into. Trains run at half speed on a climbing tile and 1.2x descending.
- Shipped (approved in review round 2): shaded slope grass (`bankGrass: dark`), levels 6% lighter
  each above ground (`heightLight: 0.06`), and snow by the tile's own biome: patches on the snow
  line level, full snow a level above (4/5 by default, taiga 3/4, desert 5/6).
- Shipped (round 3): `biomeTops`, mountain and rock ground between stones in the biome's own
  ground (desert sand, taiga moss).
- Shipped (round 4): `summitMatch: 1`, the summit sprites recoloured to the terrain rock and snow
  and lit with the height light of the level they stand on.
- Preview-only style flags: `shadows`; `paintedPeaks` (summits rise as ridged rock cones painted with the
  terrain's rock and snow instead of the illustrated sprites). Soil skirts were dropped. Renders and the train climb at 1/4
  vs 1/8 levels: `scratchpad/hill-levels/renders/look-*.jpg`, `train-*.jpg`
  (`climb.mjs`), review page `scratchpad/hill-levels/review.html`.
