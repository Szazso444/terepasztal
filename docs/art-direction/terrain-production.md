# Illustrated terrain: production integration

Implements the approved v4 direction plus the user's subsequent refinements:
mixed light/balanced/rich patches, painted stones, slightly softer interlocks and
foundation features following the actual model silhouette.

## Runtime

- `terrainMaterials.ts` samples the approved source art in overlapping world-space
  patches. Grass detail varies continuously from .48 through .78 to 1.0 in irregular
  areas, without resetting on tile borders or changing when the camera moves.
- Material ownership uses the approved irregular interlock. Only a .06-tile strip
  at the displaced boundary blends colours. Coast displacement is narrower.
- Small stones are baked into the ground image. Grass strokes are cached vector
  geometry within each terrain chunk so they remain legible at high zoom without
  multiplying the size of every terrain texture. Neither creates simulation props.
- `Landscape` paints 8×8 chunks in a worker, caches them and culls them. Changes
  invalidate nearby chunks; seasonal changes repaint revealed chunks. Stale worker
  results are discarded. City paving is painted onto the same relief surface.
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
existing rock material and grass tufts between them. This replaces the continuous
stone carpet; it does not yet reproduce the concept's individually drawn cliff faces.

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
`public/assets/terrain-surfaces.png` with a provenance manifest. Original grass,
forest, desert, taiga, swamp, sand, water and road art comes from `base-v1`.
`assets/source/terrain-production/rock-surface.png` was generated with built-in
ImageGen using the approved hill and mountain as style references. Exact request:
`assets/source/terrain-production/rock-prompt.json`. The user-provided red foundation
markup is retained as `foundation-reference.png`. The generated concept board in
`terrain-v4` remains reference material, not a production atlas.

## Verification and delivery

- 173 unit tests pass, including rounded-crown continuity, edge continuity, whole-footprint excavation,
  projection stability/picking, shared source coordinates, detail variation and
  narrow blend invariants. Existing generation golden hashes still pass.
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
- Delivery: `G:/DEV/Terepasztal/renders/terrain-production/`.

The full-map software-browser cache measured about eight seconds during QA; the
game continues using fallback tiles while it loads. Camera movement reuses the
cache. Exact timings depend on hardware and the number of revealed regions.
