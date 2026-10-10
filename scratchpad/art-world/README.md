# Illustrated world preview

## Approved B yard rollout

The village and industrial scenes now use `landscape.js`: continuous world-coordinate
grass, stone, dirt and gravel, with soft irregular yard masks and blended sand/water
shoreline. Stone repeats in one orientation; it is never mirrored. Gravel derives
the source dirt grain with a limestone tint. Terrain-palette mode remains the earlier
atlas comparison, not the continuous-field demonstration.

`lots.js` records candidate material choices, lot allocations and scale estimates.
Door-bearing buildings target a 2.1m door at 6 logical pixels per metre; schematic
adults are 1.75m. Door measurements are preliminary, not certified physical dimensions.
Industrial assets without a useful door still have explicit estimated scale factors.
These settings affect the composed preview only. Simulation footprints, train sizing,
save formats and production world placement are unchanged pending visual direction.
The gallery below the scene still displays atlas-native sizing for source comparison.

Use the yard, human-reference and grid toggles to review the result. The approved B
station close-up is retained in `../yard-study/`.

Open http://127.0.0.1:5173/scratchpad/art-world/index.html with Vite running.

The approved station adjustment is applied in tools/illustrated-sprites.mjs:
after the existing source cleanup/projection/size conversion, multiply width by
1.2 and horizontal anchor by the same ratio; preserve height and vertical anchor.
It is baked into the atlas so the game and this preview use the same dimensions.
This is the approved screen-space widening, not a new physical camera calibration.
No regeneration is used. Rebuilding starts from original source files, so the
adjustment does not accumulate across runs. Icons and flat tile surfaces are excluded.

Terrain directly samples the painted diamond top face, inset slightly to avoid
the illustrated slab rim. The former cosine-folded sampling is removed. Colors
are sampled unchanged, retaining the original material details and lighting.
Repeated motifs and tile lighting seams can remain: these are illustrated source
tiles, not newly painted seamless terrain. Original sources are untouched.

37 static building/prop sources and 12 terrain sources are available in the gallery.
All variants use the source listed in public/assets/illustrated-report.json; level
variants do not yet have unique upgrade art. That report also lists deferred sources:
vehicles, directional depots, signals, bridge layers, connection pieces, people,
effects and semantic overlays cannot safely be replaced with single-view studies.

The preview is a deterministic composition using Pixi and the real atlas registry.
It does not simulate placement rules or modify saves. Original procedural rails
are used here to preserve the earlier station comparison. The ordinary game's
existing track generator is not changed by this work.

Rebuild: node tools/illustrated-sprites.mjs
Verify and save three screenshots: node scratchpad/verify-art-world.mjs
Screenshots: village.png, industry.png, terrain.png in this directory.
