# Road and crossing painting checkpoint

Issue: #319. Branch: `art/319-roads`, based on `origin/develop` at `dea4267`.

## Current material-source delivery

The author's revised brief requests four uniform source paintings. Final width, position,
footprint and tile connections are assigned by a script, not by the paintings. The previous
exact-canvas draft failures below therefore do not gate these material sources.

- `materials/road-strip-x.png`: long, straight x road, two continuous parallel wheel ruts.
- `materials/road-strip-y.png`: independently painted long y road, two parallel wheel ruts.
- `materials/crossing-material-regular.png`: staggered limestone setts and two flat timber
  check-plank bands; no rails or sleepers.
- `materials/crossing-material-narrow.png`: uniform weathered timber planking.
- `materials.json`: source file manifest, roles, dimensions, alpha counts and eight interior
  colour samples along each road. Mean colour varies by less than 2.3/255 per channel along
  either road. Visual review found no conspicuous individual patch, knot, damage or object.
- `review/materials-sheet.png`: the four selected paintings composited over a solid background
  with alpha respected. The raw viewer exposed RGB stored below alpha-zero pixels as an
  apparent glow. In the composite, this colour is invisible; it is not painted ground.
- `material-generations.json` and `raw/materials/`: original imagegen sources and additional
  alpha-correction attempts. Originals were selected for their quieter palette. Each of the
  four originals was painted separately, without mirroring or reuse.
- `make-material-guides.mjs` and `guides/materials/`: loose source silhouettes; they do not
  specify final tile geometry. `review-materials.mjs` rebuilds the review and source manifest.

All four selected images are 1536x1024 RGBA. Exact source size and position are intentionally
not checked against the former 1024x1024 tile contract. Every prompt/reference, including the
additional alpha-correction attempts, is appended to `prompts.json`.

The author explicitly permits script-controlled geometry in the revised brief. The existing
fitting script was not found in this checkout or `origin/develop`; its path was requested.
Final road-piece regeneration is therefore not claimed here. These four sources are ready for
that script. No replacement fitting pipeline or game/atlas changes were made.

```powershell
$env:ROAD_TOOLING='C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
node assets/source/roads-2026-10-11/make-material-guides.mjs
node assets/source/roads-2026-10-11/review-materials.mjs
```

## Earlier tile drafts

Status: 15 independent road guide edits, plus one rejected straight-road attempt, and four
independent crossing guide edits with a corrective generation for each. These are drafts,
not accepted production assets. The user explicitly requested that the existing pictures and
files be committed despite the previously reported failed checks. The road checkpoint is
commit `9dbeb5d`. The crossings and their failed checks are preserved in the next commit.

At this earlier checkpoint, deterministic finishing had not yet been authorized. The revised
brief above now assigns geometry to a script; the earlier drafts remain preserved for history.

- `make-guides.mjs`: exact FOOTPRINTS.t1 geometry and one grey guide per piece.
- `guides/`: the 15 attached edit targets.
- `prompts.json`: every generation prompt and its four attached references.
- `generations.json`: exact imagegen output paths and saved draft paths.
- `raw/`: original imagegen outputs, copied byte-for-byte; each requested piece was generated
  separately, without mirroring or reuse.
- `geometry.json`: coordinates, edge midpoints, centre, scale and piece definitions.
- `check-raw.mjs`: transparency, canvas and edge-opening measurements plus 64-pixel previews.
- `raw-check.json`: measured failures. All returned canvases are 1254x1254, and alpha extends
  beyond the specified diamond. Widths and alignment vary at connecting edges.
- `review/`: full-canvas 64x64 previews and tile 64x32 previews; `raw-sheet.png` is an enlarged
  nearest-neighbour view of the game-scale tiles, with labels only in the review sheet.
- `make-crossing-guides.mjs` and `crossing-geometry.json`: the four exact crossing guides,
  road width, rail offsets and deck extents, using FOOTPRINTS.t1.
- `crossing-{regular,narrow}-r{0,1}.png`: corrected imagegen crossing drafts under the requested
  names, copied without image processing. Their canvases remain 1254x1254.
- `raw/crossing-*-attempt-1.png`: the rejected first crossing paintings, which copied metallic
  railheads and sometimes the wrong rotation from references.
- `crossing-generations.json`: original and corrective imagegen output provenance.
- `check-crossings.mjs`, `crossing-check.json`, `review/crossings-sheet.png`: explicit failed
  canvas/alpha checks and game-scale review. Grooves are improved but exact rail offsets have
  not passed verification. Narrow r1 still has paved approaches instead of gravel.

Every successful crossing call attached its guide plus the four mandated references. Initial
six-reference prompts are also recorded in `prompts.json`; the tool refused the first pair
before generating because it accepts at most five reference paths. The optional road draft
was therefore omitted from all successful crossing calls. There is no accepted
`road-straight-x.png` at this folder's root. High-speed crossing art was not authorized and
was not generated.

## Reproduce current guides and checks

Both scripts require the development tooling package `sharp`; no runtime dependency is added.
On this machine, use PowerShell:

```powershell
$env:ROAD_TOOLING='C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
node assets/source/roads-2026-10-11/make-guides.mjs
node assets/source/roads-2026-10-11/check-raw.mjs
node assets/source/roads-2026-10-11/make-crossing-guides.mjs
node assets/source/roads-2026-10-11/check-crossings.mjs
```

If finishing is authorized, preserve originals, fit each independent painted output to its
own guide, enforce road width 0.5 tile and verge <=0.03 tile, and write the requested 15 final
names at this folder's root. Inspect ruts, curves and junctions after fitting. Check opaque
interiors, zero alpha outside the road/verge and diamond, anchor (512,832), and matching edge
profiles after reducing the diamond to 64x32. Record finishing and final checks here. Commit
only this folder, then push only `art/319-roads`; never push main or develop.

Validation performed: all four local scripts pass `node --check`; guide generation and both
image-check scripts execute successfully, recording failures rather than calling drafts final.
The Art scope check passes. Game typecheck/lint/test/build were not run: these source images
and local scripts are not loaded by the game, and no game code or atlas was changed.
