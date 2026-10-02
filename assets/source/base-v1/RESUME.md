# Asset generation checkpoint

## Next task: terrain sharpness (discussed, not implemented)

The user wants every terrain material as crisp as the mountain sprites. Current
`sampleSurface()` averages four offset source samples throughout patch interiors;
the worker rasterizes at one pixel per world pixel and linear filtering stretches
that cache at close zoom. Proposed next work: preserve crisp patch interiors and
blend only irregular edges, increase close-view cache resolution, and vary detail
without washing out texture contrast. Then reassess the rock source: its paving-like
pattern still differs from the mountain's angular faces. Keep smooth relief and
gentle biome transitions. Reuse existing game capture tools and keep usage low.

## Terrain surface correction (2026-09-26; latest)

User requested a low-usage correction for stone-carpet mountain regions and visible
polygon hills. Reused existing artwork: rock/mountain materials now mix grass with
irregular exposed-stone islands, including grass tufts. Replaced triangle-fan height
interpolation with bilinear shared corners plus bounded rounded crowns, and softened
slope lighting. No image generation, map generation or save changes. Actual game
captures refreshed in `scratchpad/terrain-production/renders/`; review especially
`10-connected-hills.png` and `02-railway-region.png`. This improves surface coverage
and removes triangular shading, but does not add the concept's drawn cliff faces.
Validation: 173 tests, typecheck/build, lint and formatting pass. Browser checks
confirm flat rail footprints, surface picking, excavation restoration, local cache
invalidation and stale-worker rejection. Updated 128x128 screenshots inspected.

## Terrain production integration (2026-09-25)

User approved v4 and asked to implement it, then requested mixed light/balanced/rich
patches, painted ground stones, slightly blurred interlocks, and building-base
contact features following their red markup. All now integrated into production.

- `src/render/terrainMaterials.ts`: world-space source sampling, .48–1.0 detail
  variation, narrow .06-tile feather; stones painted into worker chunks.
- `terrainRelief.ts`: shared corner levels, four-triangle tile families, stable
  inverse picking, fully flat excavated footprints. No generator/save changes.
- `landscape.ts` / worker: cached revealed 8x8 chunks, local invalidation, stale-job
  rejection, city paving on relief, cached fine vector grass, loading/error fallback.
- `worldRenderer.ts` / `surfaceAssets.ts`: sparse original summit caps, updated
  surface anchors and foundation soil/grass/stone marks traced from model alpha.
- Generated rock material and exact built-in ImageGen prompt:
  `assets/source/terrain-production/`. User foundation markup retained there.
  `npm run art:terrain` packs `public/assets/terrain-surfaces.png` + provenance JSON.
- Review: `scratchpad/terrain-production/gallery.html`. Ten generated 128x128 world
  views, four actual-game detail scenes, foundation crop, normal production UI.
  Delivery `G:/DEV/Terepasztal/renders/terrain-production/`.
- Browser: 256 chunks; no panning repaints; 9 chunks repainted for actual rail
  excavation, full footprint zero, removal restores relief, height-aware picking,
  stale edits rejected, water unchanged by seasonal tint, scene disposal passes.
  Production entry point and failed-texture native fallback both pass with no errors.
- 172 tests, typecheck, lint, build, formatting. Full-map headless cache ~8s;
  normal play paints only revealed regions. No frame-rate claim from headless timings.
- Details and commands: `docs/art-direction/terrain-production.md`.

Earlier v3 and rollback sections below are historical; v4 alternatives have now
been integrated and extended by the user's refinements.


## Terrain v4 rollback and proposals (2026-09-25; latest)

User rejected v3 canvas-like ground and smooth hill relief. Restored production
illustrated tile atlas and original hill/mountain offsets in WorldRenderer.
Kept unrelated approved music, building contact, scale, trees, tower/kiln and effects.
The landscape prototype remains dormant. Old cozy-v3 live fixture now supports
native ground; its saved screenshots are historical v3, not current production.

Review: `scratchpad/terrain-v4/gallery.html`; delivery:
`G:/DEV/Terepasztal/renders/terrain-v4/`. Eight actual Game/Pixi stills compare light,
balanced and rich grass plus patch/fringe transitions on a controlled 48x48 fixture.
Three production screenshots confirm restored terrain on normal generated 128x128
seed 7412. Alternative material renderer is preview-only. Recommended: medium
illustrated texture and narrow interlocking material patches; contrast still needs
an authored transition-art pass. No generation/save changes.

Generated hill tile-family concept (not implemented / not a compatible atlas):
`assets/source/terrain-v4/connected-hills-concept.png`, exact built-in ImageGen request
in `prompt.json`. Uses approved grass, hill and mountain references. Proposed shared
corner elevations select slope/shoulder/saddle/ridge/plateau/rock/peak families.
Details, per-material detail budgets, limits and checks: `docs/art-direction/terrain-v4.md`.
164 tests, typecheck, lint, build and browser rollback checks passed.



## Production cozy integration v3 (2026-09-25)

User requested four-arrangement music (regular first), silhouette contact blending,
nonrepeating continuous terrain, irregular transitions, connected hill/mountain
masses, more/larger trees, taller tower piers, smaller kiln, common human scale and
cozy weather/sound/window lighting. Implemented in production source and atlases.

- New references/generated sources/prompts: `assets/source/cozy-v3/` (three tree
  variants and taller tower); packing integrated into `tools/illustrated-sprites.mjs`.
- Runtime: `src/render/landscape*`, `surfaceAssets.ts`, `assetScale.ts`, updates to
  world/train/people renderers and fx; `src/engine/musicPlaylist.ts`, `ambience.ts`,
  audio bus/settings. Three exact MP3 copies in `public/assets/audio/music/`.
- Review: `scratchpad/cozy-v3/gallery.html`; delivery
  `G:/DEV/Terepasztal/renders/cozy-v3/`. Ten 1920×1200 views of normal generated
  128×128 seed 7412, plus the normal production play screen. Real Builder: 114
  rails, 20 structures, six natural biomes, unchanged terrain/biome/variant hashes.
  NO fixture material/rail/scale/atlas overrides in these new stills.
- Scale: 11 px person, 13.2 px standard door; six families measured from packed
  doorway fractions. Other equipment stays explicitly estimated. New families
  need a registered reference/estimate; ghosts and placed buildings share scale.
  Rocket reconstruction remains QA-only and is not newly approved by this work.
- Cached worker surface paints nothing on camera movement; nearby excavation
  repaints six chunks in QA. Night masks use reviewed building windows and explicit
  train amber pixels; no roof-edge guessing outside those regions. Nature volume
  defaults to 35%; audio respects gesture, master mute and background silence.
- Evidence: renders/{report,verification,motion,production}.json. All four MP3s
  decode/play, first original, shuffled bags, no consecutive repeats, full failure
  fallback; source hashes match. 8,304 Fleet ticks cover 48 headings, curves,
  switches and reversal with zero position jump/page errors. Built worker and
  public atlases also verified under normal production startup (160×160 expansion).
- Checks: 164 tests, build/typecheck, lint, Prettier. See
  `docs/art-direction/cozy-v3.md` for architecture, calibration limits and commands.

## Generated-world blending revision v2 (2026-09-24)

The user found the v1 building aprons too large and asked for small irregular
patches immediately around bases, terrain-responsive rails, and normal generated
128x128 terrain instead of single-biome fixtures. New fixture:
`scratchpad/generated-world-v2/`; static delivery:
`G:/DEV/Terepasztal/renders/generated-world-v2/` (`gallery.html`, six PNGs).

Uses the real `generateMap(7412, {w:128,h:128})` with all other defaults; all six
biomes occur naturally. Terrain/biome/variant hashes are unchanged by construction.
Real Builder places 114 connected rails and 20 structures/decor across three areas.
Small seeded translucent scuffs replace broad yards. Ballast inherits local
terrain colour with transparent feathered shoulders; rail gauge is unchanged.
One whole-map view and five closer views all come from that same world.

Original illustrated assets, Rocket reconstruction and v1 passenger are reused.
No new generation call, production source change or save modification is involved.
Map-generation tests: 9 pass. Fixture report covers terrain identity, connected
rails, no track on water, patch bounds, correct human height and rigid train scale.
The material field is a static-review prototype; do not claim production camera
performance or resolved Rocket wheel contact from these images.

## Full-style actual-game stills (2026-09-24)

The user requested still images of the whole visual style and explicitly chose
actual game screenshots over concept renders. Seven 1920x1200 PNGs now cover a
village, station close-up, industry, countryside/shore, desert, taiga and wetlands.
Source fixture and gallery: `scratchpad/full-style-stills/`. Delivery copy:
`G:/DEV/Terepasztal/renders/full-style-v1/`, with `gallery.html` and `renders/`.

This uses real Game/WorldRenderer/TrainRenderer/PeopleRenderer, the approved
illustrated atlas and the previous Rocket candidate. Fixture-only continuous
terrain sampling removes repeated lit tile borders; door-based visual scale
profiles come from the prior art-world preview. A new isolated passenger was
generated with imagegen using the original illustrated passenger reference and
packed at 11 logical pixels high. Source, exact prompt, scripts and checks are
saved with the fixture. No animation or video was created for this request.

These are full-scene style previews, not completion of every production asset or
3D reconstruction. Production files and game saves remain untouched. Previous
Rocket wheel-fit uncertainty and the need for a physical camera/scale contract
still apply. See the fixture README and report for exact scope and reproduction.

## Superseding image-to-3D and actual-game POC (2026-09-24)

The user moved art-pipeline work to `G:/DEV/Terepasztal`; the game Git checkout is
still this C: repository. New Rocket redraws were rejected. Preserve the approved
original art and require consistent source camera, human scale and rail fit.
The original Rocket was reconstructed by the user's local ComfyUI/Pixal3D
workflow and rendered in headless Blender. POC files and research are at
`G:/DEV/Terepasztal/poc/rocket-original-v1`.

The candidate has now also been tested IN THE GAME, using the fixture in
`scratchpad/asset-qa`. It loads the candidate atlas into real Game/TrainRenderer
instances and advances a coupled consist through Fleet.tick on real track.
The final automated run covered 8,304 simulation ticks, all 48 headings,
straight/diverging switch paths, curves and reverse running. Reversal displaced
vehicle centres by zero; browser exceptions were zero. Reports, screenshots,
video and a copy of the fixture are in the POC's `runtime-qa/` directory on G:.
Live test: `http://127.0.0.1:5190/scratchpad/asset-qa/` while its server is running.

Runtime integration passes, but production acceptance is NOT granted: the
reconstruction has colour/geometry concerns, and measured wheel-tread/axle
landmarks plus a shared human/metre scale contract are still required. Do not
resume the 63-image batch or promote this atlas automatically. No production
atlas or gameplay code was changed by this test; normal game saves were isolated.

## Illustrated runtime conversion

Work on `codex/illustrated-sprite-quality`, based on the user's
`claude/nifty-bohr-vu1pko` pipeline branch, now installs 67 source studies as 207
high-resolution runtime frames in `public/assets`. The approved originals remain
unchanged. `scratchpad/illustrated-hd/index.html` compares the old pipeline with
the new game scene; its README describes the implementation and remaining work.
Rebuild with `npm run art:illustrated`.

Runtime integration status is recorded in `public/assets/illustrated-report.json`;
the older `coverage.json` and completion report below describe the base-image
generation milestone, not this newer partial runtime conversion. Eighty source
studies remain deferred, especially railcraft and track directions requiring
multi-view/layered art. Working procedural frames remain in those slots. Do not
copy one assembled vehicle picture into every facing or separate body-part slot.

## Base library complete — 2026-09-19

**147 of 147 base entries saved; zero missing or unmapped entries.** All 147 PNGs
pass the existing alpha validator. The gallery and coverage reports are current.
This continuation added 85 missing images using the built-in image generator;
existing images were preserved. Every queued image has its exact prompt recorded.
Seventeen older prompt records now also have explicit filenames. Seven pre-existing
images lack prompt records in the recovered manifest; these provenance gaps are
listed in `completion-report.json`, not filled with invented prompts.

All 52 railcraft have source images and integration specifications in `RAILCRAFT.md`
and `railcraft-specifications.json`. The user approved the existing image style and
requested documentation rather than regeneration. No railcraft image was replaced.

Remaining integration work: scale normalization, independent rigid-body and bogie
layers, anchors, facings/variants, animation and in-game track-motion verification.
There are 77 files with alpha edge warnings and six earlier terrain design flags;
the six candidate corrections remain in `corrections/` without being promoted.
Alpha validation does not certify mechanical or visual correctness. No images have
been integrated into the runtime atlas. This completes the requested base library.

Review `index.html`, `RAILCRAFT.md`, `coverage.json`, `alpha-report.json`, and
`completion-report.json` locally. Keep media and verbose reports out of chat.
The recovery sections below are historical checkpoints; their counts are superseded.

## Railcraft clarification — 2026-09-19

The user likes the existing images: **keep them unchanged**. Document mechanics
for every locomotive and wagon, including already-generated images, rather than
regenerating them. `RAILCRAFT.md` and `railcraft-specifications.json` now cover all
52 railcraft definitions, derived from the checked-in roster, body solver and
track compatibility functions. Regenerate those documents with
`node scratchpad/prepare-railcraft-assets.mjs`. They specify runtime scale, rigid
segments, fixed axles versus bogies, articulation, track classes and conversion
requirements. These are game definitions, not claims about historical prototypes.
Continue generating only missing base PNGs; use `coverage.json` for live totals.

## Recovery after request-size failure — 2026-09-19

Recovered the text-only history of **Review asset image changes**
(`01a0ba90-edf0-72e1-84f7-10ef04aed46f`) after its request exceeded
67,108,864 bytes (64 MiB). The exact source of the oversized payload is unconfirmed.
User preference: keep assets in this repository; no inline media or large content
dumps in chat. This preference is also recorded in the root AGENTS.md.

Confirmed scope: finish the generated image library using the art-direction guide
before runtime integration. Current inventory: **62 of 147 base entries present;
85 pending**. Coverage and the alpha gallery were refreshed successfully; edge
warnings remain. Six correction PNGs exist in `corrections/` but are not promoted
or marked resolved: cursor, hillcut, plains, rock, swamp, taiga. Review them before
promotion. No runtime integration has been performed.

Added `loco-rocket.png` using the built-in tool; alpha validation passed with a
1/255 bottom-edge warning. Visual review is pending. Exact prompt is saved in
`generation-prompts.json`. Next missing queue entry: `loco.adler`.
The user confirmed continuing to save all base assets. Continue with the built-in
generator and suppress image embeds in chat output. Read `coverage.json` for live
counts as each generation batch updates the gallery and reports. Continue in queue order and save each
result immediately. Keep status messages short and tool outputs bounded. Historical
counts below describe earlier checkpoints, not the current inventory.

Recovered on 2026-09-19 from the archived Codex task **Fix large locomotives on curves**
(`01a0960e-675f-7510-858f-90e0fc9d0317`). The task has been unarchived.

## Where we left off

The latest asset request in that task was: “What about 01 land and biomes (all assets)
and 02 natura and small objects”. Continue those categories using separate transparent
PNG source images in the existing pastoral railway style.

At recovery, 23 PNGs existed: oak, spruce, cottage, station, windmill, water tower,
warehouse, depot, civic townhouse, wood and stone bridges, kiln, grinder, refinery,
substation, farm, lumber, quarry, pump, power plant, hydro plant, coaling stage, signal.
All 23 passed the existing alpha validator; several have edge-touch warnings that
still need visual cleanup review.

## References and tracking

- `docs/art-direction/images/01-land-biomes.png`: terrain direction.
- `docs/art-direction/images/02-nature-objects.png`: nature direction.
- `docs/art-direction/images/03-theme-town-growth.png`: established shared style.
- `generation-prompts.json`: prompts and original generation paths.
- `coverage.json`: 147 base-family entries, including remaining variants.
- `alpha-report.json` and `index.html`: validation and preview gallery.

Generate with the built-in image tool, one asset per image. Preserve real alpha.
Save new images here, record their prompts, and add filename aliases to
`scratchpad/refresh-base-coverage.mjs` before refreshing coverage.

```sh
node scratchpad/verify-base-assets.mjs
node scratchpad/refresh-base-coverage.mjs
```

These are source images, not finished runtime sprites. Runtime integration, exact
tile geometry, anchors, rotations, levels, and animation variants remain pending.
No generated image has been integrated into `public/assets` yet. Terrain bases
must eventually fit the game's 64x32 diamond and shared tile edges.

## Resumed work

Added `terrain-grass.png` using the built-in image tool. Its prompt is recorded in
`generation-prompts.json`. The library now has 24 generated base images and 123
pending entries. The grass image passes the alpha validator, with top/left
edge-touch warnings; it still needs geometry and edge review before runtime use.
Continue with the remaining terrain and nature entries in `coverage.json`.

## Current scope and resumable queue

The user confirmed: **finish the generated image library first**, before runtime
integration. The guide matches the linked branch's commit
`d01ac5ed7dfa63430fddad5a81586a73dc4625ae`.

`generation-queue.json` now records a prompt, reference board, filename and status
for each of the 123 base entries missing when this continuation started. Use its
pending entries; do not regenerate finished images. `coverage.json` and
`alpha-report.json` carry current totals, superseding historical counts above.

Use `node scratchpad/import-generated-asset.mjs <coverage-id> <generated-png>` to
copy a built-in image result here and record its exact prompt. Existing files are
protected from overwrites. Then refresh coverage and validation as above.

## Building camera study (2026-09-23)

### Superseding decision and fresh generation attempt

The user chose the CURRENT GAME GRID: 45° azimuth, 30° camera elevation,
screen ground slopes ±0.5 (±26.565051°). A fresh imagegen attempt on September 23
SUCCEEDED, followed by another successful guided attempt. The historical 429
limit below is not evidence of a current limit; do not keep claiming it is blocked.

The user explicitly requested ALL 26 building types / 104 facings. Latest footprint
direction supersedes the old category split: make a building one tile if its
original design fits at a common human scale; don't squash it. Reviewed plan has
18 one-tile types and eight two-tile types (station, warehouse, depot, power plant,
colliery, ironworks, diesel refinery, wire mill). Per-asset reasons and references:
`assets/source/current-grid-regeneration-v2/handoff/manifest.json`.

Generation is tracked per facing in `assets/source/current-grid-regeneration-v2/generation-plan.json`.
Do not rerun the handoff builder after generation starts: it creates an initial plan.
Use completed-candidate versus pending statuses to resume. Complete prompts,
26 original sources, 32 old facings, guides and START-HERE.md are saved in `handoff/`.
New sources are saved in `generated/`; none of the old sources are overwritten.
Preview: `scratchpad/current-grid-assets/index.html`. Generated candidates need
projection, human-scale and direction-continuity review before replacing game art.

### Historical camera-study state

Current user direction: compare lower dimetric, current 2:1, and true isometric
before more asset generation. Uniform angles across all objects are required.
Preview: `scratchpad/projection-study/index.html`; assumptions in its README.
The preview uses exact projected proxy geometry, sampled asset palettes, and a
separate unmodified original-sprite audit. It is not new finished art.

Latest source batch: six completed building sets (farm, lumber, quarry, pump,
town hall, warehouse), four facings each. Plus the earlier house/station sets.
18 building sets remain pending after imagegen usage_limit_reached. Exact prompts
and resumable work are in `assets/source/building-poc-v1/remaining/resume.json`.
Do not resume these prompts blindly: first settle the projection and validate
geometry guides. Current prompts requested 45° azimuth and 2:1 ground slopes,
but generated PNGs are not projection-certified. Keep all media in the repo.

`drafts/oil-seep-rejected-pump.png` is an incorrect natural-seep attempt containing
industrial machinery, excluded from accepted coverage. Its replacement must show
only a flat natural oil puddle. The gallery preserves image proportions and offers
light, dark and checker backgrounds plus filename search.

## Locomotive width adjustment candidates (2026-09-30)

User supplied four 1536x1024 isometric narrow-gauge locomotive PNGs. Original copies and ImageGen edit candidates are kept at `assets/source/base-v1/locomotive-width-adjustments/` with a mapping and edit brief in its `README.md`. C50 body width was requested +30% across the track, excluding wheels/running gear. MÁV 490, MK45 and Rezet wheelset/axle transverse width were requested -30%, preserving body and wheel diameter/longitudinal arrangement. “Shaft” was interpreted as transverse axle span, not the longitudinal connecting rods. Candidate files preserve the magenta backdrop. These are prompt-guided raster edits, not measured CAD transforms; visually review before integrating into the game.

## Opposite-facing locomotive sprite batch (2026-09-30)

Generated eight 180-degree rear-facing isometric companions from the user's organized source sprites. Each output sits beside its source under `G:\DEV\Terepasztal\Images\organized\locomotives\`, uses the requested rear-specific end details, shows the opposite long side, and is 1536x1024. The near-magenta generated matte was corrected to exact `#FF00FF` for the connected background field. All image dimensions, corner/border colors and subject margins were checked; smallest margins are Koutetsujou 31 px left / 50 px right, MK45 93 px bottom. Outputs: `0,5/Muki (P2)/loco-muki-rear.png`, `0,5/BM-50/loco-bm50-rear.png`, `1/Narrow/C-50/loco-c50-rear.png`, `1/Narrow/MÁV 490/loco-mav490-rear.png`, `1/Narrow/MK45/loco-mk45-rear.png`, `1/Narrow/MK48/loco-mk48-rear.png`, `1/Narrow/Rezét/loco-rezet-rear.png`, and `6/loco-koutetsujou-rear.png`.

## BM-50, MK48 and Koutetsujou wheel revisions (2026-09-30)

Follow-up corrections and options are saved beside the organized source images at `G:\DEV\Terepasztal\Images\organized\locomotives\`. BM-50 now has a new two-wheelset front candidate (`0,5/BM-50/loco-bm50-front.png`) and revised rear (`0,5/BM-50/loco-bm50-rear.png`); the original front source remains unchanged. MK48 rear was revised in place (`1/Narrow/MK48/loco-mk48-rear.png`) to remove the marked extra wheel and blank the marked rear cab windows while retaining side windows. Koutetsujou has paired front/rear options A, B and C: A evenly distributed wheelsets, B two compact bogie groups, C three support groups. All three keep the source axle count/diameter and use narrower transverse treads. Files are named `loco-koutetsujou-{front|rear}-wheel-layout-{a|b|c}.png`. All nine outputs are 1536x1024; connected matte normalized to exact `#FF00FF`; canvas margins and border pixels checked. No game/runtime integration was requested.

## Koutetsujou corrected axle-gauge and heavy-wheel options (2026-09-30)

User clarified that the Koutetsujou's wheels should move closer together across the track by shortening the axle span; do not thin the individual treads or move wheelsets along the locomotive. They then requested larger, more substantial wheels for the heavy armored vehicle. Superseding the earlier wheel-layout A/B/C options, new front/rear pairs were generated at nominal 15%, 25% and 35% narrower gauge, each targeting about 30% larger wheel diameter with heavy rims and flanged treads. Candidate paths beside the source are `G:\DEV\Terepasztal\Images\organized\locomotives\6\loco-koutetsujou-{front|rear}-gauge-{15|25|35}.png`. All six are 1536x1024 with exact `#FF00FF` edge-connected matte and no non-magenta border pixels; the smallest clear margin is 31 px. These percentages are image-generation targets rather than measured geometry, so compare the paired variants visually before selecting one. The MK48 arrow-guided rear revision and BM-50 corrected front/rear candidates were also normalized to the exact magenta matte; all three remain 1536x1024 with margin.

## Koutetsujou 4x3 bogie options (2026-09-30)

User clarified the requested wheel layout as 4 bogies total with 3 axles each (12 axles). New front/rear candidates were generated from the previous heavy-wheel gauge options. The edit prompts target wheel diameter 20% smaller and wheel thickness across the axle 30% smaller than those beefy wheels, while retaining each source candidate's nominal 15%, 25% or 35% narrow gauge. Files beside the source are `G:\DEV\Terepasztal\Images\organized\locomotives\6\loco-koutetsujou-{front|rear}-4x3-gauge-{15|25|35}.png`. Each is 1536x1024 with edge-connected background corrected to exact `#FF00FF`, no non-magenta border pixels and at least 31 px canvas margin. Axle count, grouping, wheel scale and gauge are generative targets rather than measured geometry; visually confirm before integration. The revised MK48 file is already alongside its source at `G:\DEV\Terepasztal\Images\organized\locomotives\1\Narrow\MK48\loco-mk48-rear.png`.

User chose to keep using the pre-4x3 Koutetsujou version; do not use the new `loco-koutetsujou-{front|rear}-4x3-gauge-{15|25|35}.png` candidates as the active version. These candidates remain in the folder for reference. The original `loco-koutetsujou.png` and `loco-koutetsujou-rear.png` were not overwritten.
