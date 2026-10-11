## 2026-10-09 — four PNG-only handbuilt locomotives IN PROGRESS
Owner accepts SW1 v4 for now; leave it unchanged. Requested MÁV375, Class08, DRG01, M62 in parallel using same method, cheaper subagents explicitly authorized. Luna agents own mav375/class08/drg01-picture-2026-10-09, root owns m62-picture-2026-10-09. Source terepasztal-local; install only to terepasztal-playtest after completed renders. GPU slot currently MÁV375. All new shape from workbook PNGs, no game models/fit input. Keep prior wheel corrections; review complete bogies/light anchors. Integration, actual game QA and shared gallery still pending. Stop after these four.

## 2026-10-08 latest — SW1 tank and four windows COMPLETE; STOPPED for owner review
New source assets/source/sw1-picture-v4-2026-10-08. Installed bundle 12e66cb2e7099846. Only two owner-requested changes: centre tank wider/lower to expose it beneath walkway in actual game camera; four front panes with matching light masks. Original PNG and owner annotation hash-locked. Both bogies and calibration match v3; other locomotives and shared pipeline unchanged. Sample 89641d4efaf9d6fb repeated pixel-identically; construction replay matched. Reviewed game detail/night and 32 curve frames, reverse and stationary-freeze report. Game 329 tests and build/typecheck passed. Preview sw1-picture-v4.html published, mirrored to G:/DEV/Terepasztal/renders/engine-models; page and 11 image URLs checked. Candidate awaiting owner review, not marked approved. No commits/push. Stop here.

## Earlier — SW1 tank visibility + four front windows IN PROGRESS (superseded)
Owner likes v3 except centre tank hidden in isometric game view and cab front must have FOUR windows. Only these two details changed in new project assets/source/sw1-picture-v4-2026-10-08. Tank width2.10 instead1.36, final centre z.57 instead.80, bottom.20, length unchanged2.10; four panes/borders/reflections/light masks. Original reference plus saved owner-annotated PNG hash-locked; observations count corrected. Recipe asserts count/visibility-related dimensions. Both bogie evaluated hashes match v3; rest of style/pipeline unchanged. Sample89641d4efaf9d6fb repeat pixels matched; fresh construction replay matched. Production session22229 ongoing. Next: install, fresh capture-sw1-picture-v4 scripts, verify actual tank visibility/night panes/curves, gallery.py, status and stop. No other locomotives.

## Earlier — SW1 THIRD PICTURE PASS COMPLETE; STOPPED for owner review
Owner requested one more pass on SW1 only, then the same pipeline Markdown. New source assets/source/sw1-picture-v3-2026-10-08. Installed bundle250421a21cdd25a8 via generic installer; sample0c6154a3fab15280 repeat-pixel match. Refined actual rounded cast bogie openings, wider axle spacing and exposed frames (tread gauge unchanged), body clearance+.18, taller roof-following cab panes/arched gable/reflections, dark fan covers, curved bell, larger lamp with accurate anchor, hood joins/hinges. Only locked reference PNG used for shape. Unknown rear remains minimal.
Fresh recipe replay matches evaluated geometry/materials/parents/calibration:329 body meshes,57 per bogie. Game96 directions/eight wheel phases, frozen stationary frame,32 curves, reverse/day/night/detail/C50 comparison verified. Game329 tests and build/typecheck passed. Non-SW1 registry/gear/fit entries verified unchanged. Gallery http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v3.html —11 images checked, mirrored to G:/DEV/Terepasztal/renders/engine-models/sw1-picture-v3.html. Same pipeline guide tools/asset-pipeline/handbuilt/README.md shown to user; no shared pipeline/style changes this pass. Candidate not yet owner-approved. No commits/push. Stop before further fleet work.

## Earlier this turn — one more SW1-only picture pass IN PROGRESS (superseded)
Owner requests one more SW1-only refinement, then show the same pipeline Markdown. No other locomotives. New project assets/source/sw1-picture-v3-2026-10-08 is a copy of reference inputs/recipe/helpers/style only (no game meshes). Same locked PNG authority. Changes: exposed cast sideframes with actual rounded openings, axle spacing1.80 instead1.32, frames farther outboard while tread gauge unchanged; sprung body +.18 for frame clearance; taller cab-front panes under an actual arched gable, subtle glass reflections, darker fan metal, curved bell and larger dimensional lamp. Sample run session67326. Still required: review sample/orthos, production, generic install, fresh game captures/gallery, tests, stop, open tools/asset-pipeline/handbuilt/README.md for user. Pipeline method Markdown itself remains the same.

## Earlier — SW1 PNG-only recipe COMPLETE; STOPPED for owner review
SW1 9ff62138c0baf07f installed using the new generic handbuilt/install.py. Preview http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v2.html; 11 image URLs/UTF-8 checked; mirrored G:/DEV/Terepasztal/renders/engine-models/sw1-picture-v2.html. Source/project assets/source/sw1-picture-recipe-2026-10-08. Only reference is saved PNG from workbook row21; all visible/assumed/omitted features recorded in observations.json. No game geometry inputs. Current corrections include all noted picture details plus the final continuous cab stripe (door no longer occludes it). Other locomotives unchanged.
Saved method: tools/asset-pipeline/handbuilt/README.md, run.py init/lock/build/sample/production/all, frozen helpers/style per project, recipe-lock.json, construction/output receipts, generic install.py. New PNGs require image-specific observations and authored geometry recipe, not automatic guessed 3D. One-command all replay was tested successfully (replay.log); construction cache verified afterward. Source rebuild matches evaluated geometry/materials/parenting/calibration (295 body meshes, 61 per bogie); construction-repeat.json. Sample f47b924a4b87b922 repeat-pixel match; complete 96-direction/eight-wheel-phase production. Game 32 curve frames, straight/reverse/night/closeups/C50 comparison and freeze verified. Tests: Python7+11, source197, game329; build/typecheck passed. No commits/push. Owner approved the method/direction, NOT yet the new detail candidate. Stop here before another fleet batch.

## Earlier this turn — SW1 PNG-only refinement + reusable handbuilt pipeline IN PROGRESS (superseded)
Owner approved the handbuilt direction and asked for closer picture fidelity, no game-model reference, and a replayable PNG(s) workflow. New project assets/source/sw1-picture-recipe-2026-10-08: locked PNG, observations with image regions/explicit assumptions/omissions, frozen C50 primitive helpers/style, authored build.py, project.json/recipe-lock. New tools/asset-pipeline/handbuilt/{run.py,build_stage.py,install.py,README.md}; init/lock/build/sample/production/all commands, verified receipts, no automatic guessed model for unauthored pictures. Generic installer merges output calibration only. PNG reference authority added to painted/reference.py.
SW1 image-derived detail corrections: neutral charcoal, rounded hood, five panel groups, moved/enlarged fans, grille crossbars, flared horn, bell details, cast grey bogie frame openings, tank/steps/front chevrons. Unsupported rear windows/chevrons removed; hidden symmetry explicitly inferred. Final sample 6a8f2e30ce31c87b repeat-pixel match; production running session63998. Python boundary7+painted11 and source197 tests passed. Remaining: finish production, generic installer, game captures capture-sw1-picture-v2*.mjs, visually check gallery.py output, test single-command replay, final docs/status. Do not start another fleet batch.

## Earlier — SW1 HAND BUILT COMPLETE; STOPPED for owner review
New SW1 bundle 9308b137d636fd93 installed in C:/Users/Zso/terepasztal-playtest. Gallery: http://localhost:5182/scratchpad/models/handover-review/page/sw1-handbuilt.html. Source: assets/source/sw1-handbuilt-2026-10-08; build.py reuses actual accepted C50 helpers and exact current c50-lighter-v2 render profile, fresh workbook-v9-picture-derived geometry (no previous mesh/texture). Constant 1.80 hood width, cab2.26, deck2.50; full separately animated bogies, explicit glass and lens. Final pilot stripe polygons clipped to plate bounds.
QA complete: four-view repeat render pixel-identical (verified-samples/sw1/7fee081c772cc942); full 96 headings, eight wheel phases, phase silhouette drift0; game stationary freeze, 32 curve frames, reverse/day/night/closeup, lamp/window origin and C50 comparison reviewed. Source197 and game329 tests passed; game build/typecheck passed. First game test needed PYTHON environment path and was rerun successfully. Gallery11 images HTTP-checked; local mirror G:/DEV/Terepasztal/renders/engine-models/sw1-handbuilt.html. Original C50/other locos/raw meshes unchanged. No commits/push. Owner has not approved this new candidate. Do not proceed with another fleet batch before review. New construction policy in pipeline CLAUDE/README; prepare_reference.py historical-image-reconstruction opt-in only.

## Earlier this turn — SW1 HAND BUILT, render in progress (superseded)
Owner rejected detail-v4 SW1: front compressed, rear widened. Explicit instruction: build the locomotives EXACTLY like the approved C50. New method is fresh authored Blender geometry from workbook pictures, not reconstructed-mesh corrections. Pipeline CLAUDE/painted README updated; image-reconstruction preparation CLI now historical opt-in only.
New SW1 source: assets/source/sw1-handbuilt-2026-10-08/build.py. Reuses actual C50 primitive/material helpers and exact c50-lighter-v2 render profile. No old SW1 meshes/textures imported. Body, cab, constant-width hood, opaque glass, actual lamp lens, complete articulated bogies, wheel pivots authored anew. Sample comparison and orthographic top/side/front/rear reviewed. Hood width 1.8 at both ends, cab2.26, deck2.5 model metres. Workbook v9 row21 is authority.
Production running via painted/run.py to sw1-handbuilt-2026-10-08/production. Source npm tests197 passed. Still required: finish production, install.py sw1, playtest captures capture-sw1-handbuilt*.mjs, build dedicated review page, verify movement/night/geometry, stop for review. Keep other locomotives unchanged this turn; method applies to future builds. Do not use old SW1 half-mesh mirroring again.
## 2026-10-08 — Detail-v4 COMPLETE; STOPPED for owner review
Five corrected candidates installed in C:/Users/Zso/terepasztal-playtest:
- mav375 f41472d869a8cba8: nonexistent rear axle removed; three coupled axles.
- class08 6907975ff28cc68d: body aligned and centred; residual centreline 0.056 degrees.
- sw1 ed9df605d84506ea: hood centred, widened 18%, photographed half mirrored with UVs; exact bilateral mesh symmetry.
- drg01 292d014d6a3ecde8: all wheel diameters reduced 25%; leading bogie pivot moved rearward 0.70 model metres per owner annotation; body aligned, residual 0.347 degrees.
- m62 a6f477351680224c: original accepted body retained; complete bogie crossmembers, longitudinal frame, bolster and traction motors. Window mask now restricted to actual blue/teal glazing, eliminating the windshield light spill.
Shared lighting bug fixed in painted/run.py: reconstructed headlamps now reach runtime lamps instead of falling back to a generic glow. Tested; no duplicate aliases. All five model lamp origins and window masks reviewed in-game.
Workbook v9: G:/DEV/Terepasztal/locomotive-wheels-bogies-v9.xlsx and local batch4-detail-v4 copy. Artifact Tool authored 18 intended cell changes; automatic COUNTA retained (three MAV375 axles), affected note row heights expanded. All 107 original image hashes retained, unrelated cell values/formulas unchanged. All five manifests/specs locked to final workbook hash.
Evidence and scripts: assets/source/fleet-painted-2026-10-07/batch4-detail-v4.
Gallery: http://localhost:5182/scratchpad/models/handover-review/page/detail-v4.html
QA: five models, 96 facings, eight wheel phases, stationary freeze, 32 reviewed curve frames each, reverse/night/detail/lamp closeups; 40 gallery image URLs HTTP 200. Python 11, source Vitest 197, game Vitest 329 passed; typecheck, lint, formatting and final build passed.
Workbook-only metadata rebind verified all rendered bytes and fit patches unchanged (workbook-rebind.json). First three captures retain capturedBundleKey as provenance. M62 mask correction rerendered window frames only; body and bogie frame hashes unchanged; fresh complete M62 game capture reviewed afterward.
These are candidates awaiting owner review, NOT approved models. Do not start another batch. Wide rail remains owner-selected 0.24 tile; narrow unchanged. Other standard-gauge fleet alignment remains future work. Original models_raw files untouched; no commits/push.
## 2026-10-08 latest — detail-v4 owner corrections IN PROGRESS
Supersedes wheel-v3 review checkpoint. Work in assets/source/fleet-painted-2026-10-07/batch4-detail-v4; read its STATUS.md first. User requests precise lights, MAV375 remove rear axle, Class08/DRG01 alignment, SW1 symmetrical wider hood, DRG01 wheels -25% and rearward leading bogie, M62 complete bogies. Workbook v9 saved and five manifests locked. Production rendering continues; first two (MAV375, Class08) installed. Browser capture first two ongoing. Do not install additional bundles while capture is active (HMR interrupts). Finish all five and stop for review. No new batch.
## 2026-10-08 — Wheel-v3 COMPLETE, STOPPED for owner review
Owner selected wide rails 25% narrower: standard full gauge 0.24 tile, narrow unchanged at 0.16. Sleepers and ballast narrowed with standard rails in playtest.
Five reference-derived wheel assemblies rebuilt and installed:
- mav375: 0e91b0584816aafd
- class08: b5e896983179997c
- sw1: 956a1f9e4d54b9f9
- drg01: 77884bd369c687d8
- m62: 25acf415a5a90a1b
M62 retains the original reference-image reconstruction; earlier simplified replacement is rejected.
All are 3D-to-sprite models; C50 is handbuilt, these primarily image reconstructions.
Reference pipeline uses authored axle layouts and diameters, rejects overlap instead of shrinking wheels, and applies the selected standard gauge.
Gallery: http://localhost:5182/scratchpad/models/handover-review/page/wheel-v3.html
Evidence: assets/source/fleet-painted-2026-10-07/batch4-wheel-v3/final-qa.json.
QA complete: 96 headings, eight wheel phases, stationary freeze, 32 curve frames per train, reverse/night/detail views; 35 gallery image URLs HTTP 200. Python 10, source Vitest 197, playtest Vitest 329 passed; typecheck, lint, formatting and build passed.
These five are review candidates, NOT owner approved. STOP here; do not start another batch.
Track change applies globally in playtest, but only these five assemblies were retargeted in this correction. Other standard-gauge stock may need alignment in later review batches. First five narrow-gauge batch4 models unchanged.
Historical width-v2 and batch4 galleries are superseded for these five.
# Asset generation checkpoint

## Train models pilot 5 (2026-09-27; latest)

Codex generated the rear views (PR 22, merged into local/train-models): 40 accepted of 45, rejected the Big
Boy, Garratt, Deltic and Mallard rear views and the SD40-2 truck. Pilot 5 paints the five pilot locomotives'
rear ends from them (fit azimuth constrained to the turned camera: 3 of 5 first fitted end-for-end; colour
levels matched per channel, a per-texel lookup had turned the F7's roof fans red) and rebuilds the F7's
trucks from `loco-f7-truck.png` (part `f7_truck`). The F7's rear end gear was dropped: the reconstruction
has only a wall there. Open: q5 questions, and the steam all-axles fit (front trucks swinging clear).

## Train models pilot 4 (2026-09-27)

User on pilot 3: FS still wrong ("real solutions"); F7 looked better in pilot 2 (trucks where the image has
them), end gear hidden or not turning, a missing wheel, hidden parts plain brown (offered more pictures);
new rule: end gear on the front/rear trucks for rigid bodies with 2+ bogies; show more steam engines;
roster waits until decisions are locked and the user says go; atlas: several sheets per group is okay.
Pilot 4: https://claude.ai/artifact/P41Rqnkro7PNP2eEAo1wQN (verdicts collection; local
`G:/DEV/Terepasztal/renders/train-models-pilot-4/`, source `scratchpad/train-models/review-4/`).

- Sim: `pivots` (per part, the image's truck centres) and `coupled` (steam frame stands on its coupled
  wheels) in src/data; verdicts re-measured, unchanged for all five (docs/bogie-model.md rules 7-10).
- FS: frame on its coupled wheels, leading bogie + trailing axle sprites (pilot-2 sprites); Black Five and
  9F built the same way (new landmarks, CSV rows, per-train leading bogie / pony truck).
- F7/SD40: trucks at the image's positions, whole pilot/coupler/steps attached to the trucks.
- Pipeline: symmetric rebuild of the hidden side, nearest-seen fill per piece, transparent back faces on
  cut pieces, extra views (`<image>-rear.png`, tested on a synthetic F7 rear view: IoU 0.948), end trims.
- Asked the user for rear three-quarter images (F7, SD40, FS, Black Five, 9F).
- After lock-in and the user's go: roster batches; several atlas sheets per group when needed.
- User on pilot 4 (2026-09-27): steam wheels good; the leading bogie / pony truck detaches sideways from the
  body on curves (all steam engines, e.g. 9F). Measured: 0.19-0.25 tile off the frame on the 0.5-tile curve.
  Proposed fix (not built): fit the frame to all its axles (weighted least squares, trucks weight ~1): trucks
  0.09-0.12 off the frame, coupled wheels 0.06-0.11 off the rail. Snapshot branch `locomotive-render-v1`
  (89e0d66). Rear-view prompts: https://claude.ai/artifact/Biat29EKyAgEUAiXcBv3H9
  (`tools/asset-pipeline/rear_view_prompts.py`).

## Train models pilot 3 (2026-09-26)

User on pilot 2: F7 model and body angles good; F7 drifted off the track at the switch exit (conform to
the pivot mechanism); bogies must be parallel to the rails too; FS drivers belong where the user drew
(under the boiler, on the rail); end gear per prototype (research); SD40-2 = large, 2 trucks,
high-speed only. Pilot 3: https://claude.ai/artifact/5m1ujki1p7B8S2qRERbqNL (verdicts collection;
local `G:/DEV/Terepasztal/renders/train-models-pilot-3/`, source `scratchpad/train-models/review-3/`).

- F7: trucks back at the sim pivots (no bogieDraw), truck meshes squared up (<=1.1 deg), pilot/coupler on
  the body per research; variant B (gear on trucks) captured for comparison (`renders/f7b`).
- FS: drivers bogie on the rear pivot slot drawn +0.42 tiles on the rail (bogieDraw); leading at pivot;
  trailing axle, splashers, frames with the body.
- SD40-2: src/data size large, plan rigid, bogies 2; own trucks at the 0.58 pivots; high-speed loop in
  the fixture (in-cab fitted). The end-gear research was dropped in pilot 4 (user rule instead).
- Next: user's verdicts; then roster batches (diesels/electrics first).

## Train models pilot 2 (2026-09-26)

User feedback on pilot 1: Rocket approved (concept), colour and overall size approved. Asked for: FS
drivers that follow the body; bogies closer to the centre with room for pilots; SD40-2 is a 3-tile
body, so use the F7 as the medium diesel; features like snowplows rendered; per-train bogies;
image proportions (bodies looked too wide); bodies parallel to the rails. Pilot 2:
https://claude.ai/artifact/7mt9mZ5qTDivSGC1PPs2tQ (verdicts in its `verdicts` collection;
local `G:/DEV/Terepasztal/renders/train-models-pilot-2/`, source `scratchpad/train-models/review-2/`).

- Alignment: body-based yaw/pitch refinement plus `detaper`; F7 roof within 1.15 deg of the rails in
  15 side views (0.2 deg in the user's straight shot). Width follows the length compression.
- FS: coupled wheels, rods, splashers and frames baked into the engine body (rigid); leading bogie and
  trailing axle are per-train bogies; tender axles baked (`tender: "none"`). Data: bogieStyle/bogieDraw.
- F7: per-train trucks cut from its own model (source colours), drawn 0.18/0.13 tiles in from the pivots
  via the new cosmetic `bogieDraw` (src/sim/body.ts, tested); pilot/snowplow kept on the body.
- Hidden sides take their mirror twin's source colours. Shared pilot-1 bogie frames and the SD40 were
  removed from the atlases (other locos keep their procedural bogies).
- Open: SD40-2 to large + 2 trucks (data change, bars it from regular track); user's cut-off note
  "EMD F7 is a good candidate, but yo..."; atlas budget; pilots on bogie vs body (answered: follow
  the prototype, pending confirmation).

## Train models pilot: Rocket, Flying Scotsman, SD40, bogies (2026-09-26)

Branch `local/train-models` (worktree `C:/Users/Zso/terepasztal-local`, from PR #20's head). Pipeline
outputs (GLBs, meta, sprites) live in `G:/DEV/Terepasztal/pipeline-out` (`run.py --out`); large files
are listed in `assets/source/LARGE-FILES.md`. Review page: https://claude.ai/artifact/1CpkMXBqFyD1g4QmcQLrhN
(local copy `G:/DEV/Terepasztal/renders/train-models-pilot/`, source `scratchpad/train-models/review/`).
Its verdict buttons save to the artifact's `verdicts` collection: read them before continuing.

- Fixed the POC's three failures. Colour: the Pixal3D mesh is pixel-aligned with its conditioning
  crop, so `source_texture.py` projects the source back onto every seen texel and colour-transfers the
  rest (Rocket mean-colour dE 3.7 vs the POC's 6.8; FS 0.3, SD40 0.9, F7 2.3). Wheels: measured on the
  source (`landmarks.json`), rebuilt round on the rails (+-0.16 tile) for small stock; medium stock
  gets `cut_boxes` + parametric bogies (`bogies.json`). Scale: one human metre (11 px = 1.75 m ->
  6.23 m tile); height from `height_m`, width from `width_m` x DRAWN_WIDTH, length from the slot.
- In game (`scratchpad/train-models/capture.mjs`, `hills.mjs`): straight, switch, curves, reversal,
  all 48 headings, bogie sheets, hill climb; new vs current at the same pose. 0 page errors, reversal
  shift 0. Packed as partial overrides at resolution 4: `public/assets/rolling.*` (125 frames, incl.
  F7 as an extra), `wagons.*` (5 bogie styles x 25). The PR is a draft until the user approves.
- Open decisions (on the review page): keep the human metre (small next to procedural wagons);
  Pacific drivers swing with the rear pivot on tight curves vs rigid with the body; atlas budget for
  the full roster (multi-sheet groups vs 2x); parametric bogies vs studio images.
- Blocked: decor art needs an image generator (ComfyUI here has only the 3D models; the originals came
  from a hosted tool); hill art waits for the hill shape decision.
- Drive housekeeping: `Images/` had no loose file missing from `organized/` (all 153 were duplicates,
  now in `_duplicates/`); buildings moved to `organized/buildings/`; moves in
  `organized/moves-2026-09-26.json`. 67 building sources copied into the repo with manifests.
- Next after approval: remaining 28 locomotives, 20 wagons and 20 bogie styles in batches; each needs
  landmarks (wheels, nose, cut boxes) measured on its crop - `debug_grid.py` gives the metre grid.

## Hills 1/4, rails on slopes, scatter (2026-09-26; latest)

User chose 1/4-side levels. Implemented as the default relief; rails keep the hill
(straight track climbs one level per tile, other pieces and structures need level
tiles); trains pitch on slopes; visual-only scatter by context. Drive: loco/wagon
folders empty, the 32 locomotive + 20 wagon sources are already in base-v1; no new
decor on the Drive; Google download hosts are blocked by the environment network
policy. Train models need the local ComfyUI/Blender pipeline (tools/asset-pipeline).
Details: docs/art-direction/terrain-production.md (last section).

## Style consistency: both smooth (2026-09-26)

User compared current / both sharp / both smooth at all seven zoom steps and
chose **both smooth**; the grass-over-bases and pixel-matched asset previews were
rejected. Implemented at pack time with `tools/pixel-art.mjs`: terrain surface
sources (radius 3), fallback ground tiles and the `props` atlas (radius 2).
Structures, rock and mountain caps unchanged; frame counts/sizes/anchors
unchanged. Rolling stock in use is still procedural pixel art (railcraft
conversion deferred). Game renders: `scratchpad/style-options/zooms/*-d-game.jpg`.

## Terrain sharpness pass (2026-09-26)

Implemented on branch `claude/charming-ramanujan-i16mhm`, based on the pushed
`codex/illustrated-sprite-quality` (ba155f0). No map generation, save format or
new artwork. Details: `docs/art-direction/terrain-production.md`.

- Sampling: one unblended bilinear source sample per irregular patch interior;
  only a warped .16-cell seam blends. No base-colour contrast reduction.
- Detail variation: each patch picks the calmest/median/busiest of six seeded
  source offsets by the `grassDetail` field, so contrast stays intact.
- Resolution: `npm run art:terrain` packs the sampled centre window at native
  detail. Close views (>1.4 screen px per world px) repaint the 48 nearest chunks
  at 2x; the base cache reads a half-size sheet copy.
- Finding: the base-v1 tiles are pixel art (~4 source px per art pixel). At the
  old scale one art pixel covered ~2.2 world px, blocky once sharp. `SURFACE_RATE`
  now shows one art pixel per world pixel, matching placed sprites.
- Rock: screen-aligned mapping keeps the boulder faces' upper-left light; islands
  are opaque with narrow edges. Paving look is gone, but it is flat ground. The
  concept's standing outcrops need a new outcrop sprite family (not started).
- Evidence: `scratchpad/terrain-production/sharpness/` before|after pairs;
  refreshed `renders/`, `gallery.html`. 168 tests, lint, typecheck, build,
  Prettier; verify.mjs and production.mjs pass (Linux Chromium, swiftshader).
- Review scripts still hardcode Windows paths; cloud runs used path-swapped copies.

## Terrain surface correction (2026-09-26)

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

## Train models, 2026-10-06: awaiting original-model review

Pipeline safety snapshot: 10fc7d2 on local/train-models, no push. Read
assets/source/train-models-handover-2026-10-06/README.md for exact completed work,
validation, original-model review paths, and pending owner decisions. Main checkout
was not modified. Do not rerender the fleet before the owner's response.


Rear-view audit follow-up: all four rear images were used for texture only, never
for reconstruction geometry. Local multi-view node has a zero-elevation camera
rig incompatible with the elevated references without calibration. Rear references
and findings added to the review page. See the train-model handover README.


Latest train follow-up: owner says rear geometry is fine; fix in-game duplicate
image. C-50 now uses original materials and mesh in 48 actual game headings;
runtime image bending removed in demo. Static original wheels replace its old
animated overlay for this pilot. See latest handover README section and review
#c50-fix. All clips/heading frames inspected; tests/build/lint passed. Do not
regenerate the fleet or pursue multi-view geometry based on the superseded audit.

Latest style direction: owner wants the approved reference illustration's style,
not the dull imported material. C-50 now uses source-painted shading and visible
source projection, with colour transfer on hidden surfaces. Same mesh/UVs/rigid
transform/anchors as previous pilot. Current review #c50-style; original-material
#c50-fix is historical. Hidden-side detail still needs refinement; wheels static.

2026-10-07: owner ACCEPTS source-painted style and says it suits the other engines.
Current issue is C-50 proportions. Asked whether whole-vehicle relative size or
internal proportions are wrong. Preserve style; no further style approval needed.
Owner clarification: C-50 internal part proportions, not overall size. Waiting
for the specific part/direction of correction; do not change whole-vehicle scale.


## 2026-10-07: C-50 widths and wheel animation completed

Supersedes the waiting-for-proportion-details note. Owner explicitly requested
matching front/rear hood widths, a 40% wider supporting base, rotating wheels,
and about half the movement stepping. Accepted source-painted style retained.
Current demo/review: http://localhost:5182/scratchpad/models/handover-review/page/#c50-corrected
See the handover README for derived assets, implementation and validation.
Main checkout untouched; work remains local in playtest and pipeline checkouts.


2026-10-07 superseding decision: owner REJECTED #c50-corrected as too wide,
distorted and not parallel to rails. Do not treat it as approved or continue its
width corrections. Owner requests a NEW image researched online, generated by us,
then ComfyUI reconstruction. Built-in imagegen produced a new reference from real
C-50 G.V.303/G.V.319 photos; selected v2 and exact prompts/attribution are in
assets/source/c50-regenerated-2026-10-07/. Review now #c50-new. ComfyUI prompt
 d8e115e9-7e82-49a8-ac83-1de42b2092bb was submitted with existing workflow, output
in that folder/models_raw/. Preserve all original models. Check comfy.log and
README there for completion. No runtime replacement in this new-image step yet.

New-reference follow-up completed: image c50-reference-v2.png and fresh ComfyUI
GLB generated successfully (332s), with graph/source/mask saved. Four rigid review
views checked; model remains a draft because hidden-side cab fittings include
invented tube-like protrusions and wheels/surface details need cleanup. This step
has NOT replaced game atlases. Current #c50-new shows both input and raw model;
see assets/source/c50-regenerated-2026-10-07/README.md and reconstruction.json.


2026-10-07 Blender rebuild completed after owner accepted rebuilding from the
new illustrated reference. Source and deliverables:
assets/source/c50-handbuilt-2026-10-07/{build.py,c50-handbuilt.blend,c50-handbuilt.glb}.
New independent component geometry; no Comfy mesh, width deformation or photo
projection. Both hoods width 1.37; deck 1.76; cab 1.58. Central cab length 1.72.
Four independent wheel pivots. Clean charcoal/red materials with opaque blue glass.
Five renders inspected: front/rear three-quarter, side, front-end, top; no clipping.
Orthographic top confirms straight chassis and equal widths. 70 review images
load with no page errors. Current section #c50-handbuilt at the existing 5182
review URL, with reference side by side and BLEND/GLB links. Earlier Comfy output
explicitly marked rejected. Main checkout untouched, no commits/pushes. Game
atlas NOT replaced at this model-review checkpoint; runtime integration including
wheel animation and gauge remains future work. Fittings/shading are simplified
relative to the image; do not claim pixel-identical reproduction.

2026-10-07 follow-up: owner clarified two windows on BOTH front and rear;
implemented two separate framed panes per end. Cab and chassis widened 8%
(1.7064 and 1.9008 units), hood widths remain 1.37, running gear unchanged.
Cab/deck widening uniform along length, no taper. Six new views rendered;
front/rear end and top inspected. BLEND/GLB and #c50-handbuilt page updated.
Prior build preserved in c50-handbuilt-2026-10-07/before-two-windows/.


## 2026-10-07: accepted handbuilt C-50 game sprites completed

Installed in terepasztal-playtest only: public/assets/rolling-5.png/json and
src/data/locoFit.json. Approved body proportions preserved, uniform scale
0.9408552844 fits 0.8239 tiles. Final renderer uses EEVEE, accepted painted
materials, camera-relative soft lights, 2x supersampling and the game 2:1 camera.
96 headings x 8 integrated wheel phases (768 renders; 864 atlas entries including
static aliases), atlas 4096x2931. Wheel cycle 0.0815380229 tiles. No wheel overlay.
Camera depth now explicitly checked; corrected a far-plane clipping issue before
rerendering the entire final set. All phase alpha bounds have 0px drift.

Visually reviewed all 96 headings, 24 front + 24 reversed-display route poses,
and 48 wheel-animation captures. Wheel capture verifies movement-driven phase
changes, frozen phase at rest and no overlay. Fleet screenshot compares C-50,
Black Five, DRG01 and Daylight at common zoom on respective gauges.
An optional night diagnostic was black and excluded from the review; night
appearance is not claimed verified by this capture.

Pipeline tests: 196 passed; game tests: 327 passed; production build and locoFit
format check passed. Existing large bundle warning remains. Main checkout
untouched; no commit/push/merge. Reproduction: render-sprites.py and sprites.json
in assets/source/c50-handbuilt-2026-10-07, then tools/asset-pipeline/export_rigid_stock.py.
Game captures and builder: scratchpad/models/handover-review/capture-handbuilt-*.mjs
and build-handbuilt-game-review.py in playtest. Review:
http://localhost:5182/scratchpad/models/handover-review/page/#c50-in-game
Also mirrored to G:/DEV/Terepasztal/renders/engine-models/index.html.


### Follow-up: game-matched shading

User requested stronger shading to fit the environment. render-sprites.py now
applies matte render-time materials (roughness .78, specular .22, metallic capped
at .18), removes paint self-emission, adds subtle procedural paint tone variation
and local ambient occlusion, and reduces fill/rim light with warm light color.
Approved source geometry and dimensions are preserved. Shader changes occur in
the sprite render scene; editable source blend remains the accepted shape.
Previous shader script retained as render-sprites-before-shading.py. Previous
in-game close-up/fleet captures: playtest c50-handbuilt-game/before-shading/.
Full shaded set is being rerendered; final verification recorded below.


Shading follow-up completed: all 768 frames rerendered and exported to the playtest
atlas. Updated fleet/close-up, wheel animation and both route-orientation captures.
No browser errors; movement/stop wheel assertions pass; phase bounds drift 0px.
Before/after comparison published at #c50-in-game. Geometry unchanged.


## 2026-10-07: reusable approved-model painted pipeline

Owner approved the matte/warm shaded C-50 and requested the same deterministic
process for the other locomotives. New implementation:
`tools/asset-pipeline/painted/README.md`, run.py, render.py, install.py,
profiles/c50-approved-v1.json and manifests/c50.json.

Common profile locks Blender 5.2.1 LTS build 9e2066aef7ef, paint/AO/light/camera
settings. Manifest locks prepared source blend SHA-256 and per-part dimensions,
wheel animation and effects. Supports multiple body/tender parts and static
48-heading bogies alongside 96-heading animated bodies. Rods require authored
cyclic timeline animation; arbitrary AI reconstruction is outside determinism.
The other locomotives still need approved prepared blends/manifests; they have
not been silently converted or replaced.

Outputs are content-addressed, checked for missing/corrupt files and clipping,
with fixed anchors, bounded multipage atlases, fit patches and QA sheets.
Separate installer plans/apply, backs up and preserves other frame ownership.
C-50 source and the accepted geometry remain unchanged. Full-repeat validation
is in progress; final results follow below. Unit suite: 197 passed including
three Python boundary/integration tests invoked from Vitest.


Pipeline verification completed:
- Production bundle: assets/source/painted-production/c50/d3df6a63563ade1e/.
- Full 768-frame render repeated in separate Blender processes: all decoded
  pixels identical. report.json repeat_pixel_match=true; phase bounds drift=0.
- Subsequent normal run validated every receipt hash and reused the cache.
- Compared all 768 frames with approved standalone shader: identical alpha;
  worst mean per-channel difference 0.00249/255 (quantization-level RGB change).
- Installed with the generic installer into terepasztal-playtest rolling-5.
  Backup: scratchpad/painted-install-sxsovwz1. Other four atlas metadata pages
  and all non-C50 fits verified unchanged. Updated fleet/close-up checked.
- Runtime 96x8 presence, travel-driven phases, stopped phase and zero overlay
  assertions passed without browser errors. Game production build passed.
- Pipeline npm test: 197 passed; added test formatting and Python compilation
  passed. Main checkout untouched; no commit, push or merge.

Use tools/asset-pipeline/painted/README.md for commands and the exact preparation
contract. C-50 is the first configured model, not a claim that all other models
are already converted. The accepted style profile is versioned and shared.


## 2026-10-07: fleet rollout inventory and preparation

Owner asked to apply the accepted pipeline to the locomotives currently in the
game. There are 29 active ids (C-50 done, 28 others). Inventory saved at
assets/source/fleet-painted-2026-10-07/inventory.json, plus reference contact
sheets. 27 remaining ids have calibrated jobs and raw GLBs in pipeline-out-std;
GMAM has no job/GLB in that output and needs model preparation from its reference.

Clarification sent: shade existing models only, or also rebuild faulty shapes
like C-50. No answer received yet. This materially affects scope; older feedback
already identifies body/wheel faults in a subset of the fleet. No new fleet
sprites have been installed and C-50 remains accepted/unchanged.

Independent work: baseline capture of 28 ids, straight and 32 route frames each,
using playtest scratchpad/models/handover-review/capture-fleet-painted.mjs.
Output under fleet-painted/before. See report.json once process completes.

Added painted/prepare_existing.py, which intercepts the calibrated legacy stage
before rendering and saves self-contained candidate blend parts with Principled
colour inputs, packed textures and 8-phase wheel snapshot timeline. Redirects
all old job outputs to candidate directory and never edits original jobs/GLBs.
BM-50 preparation/sample completed at fleet-painted-2026-10-07/prepared/bm50 and
samples/bm50/9e77256f26901a1f. Visually inspected: legacy shape remains distorted,
so this is NOT an approved fleet rollout. Also found its old job still has three
axles, although its corrected reference calls for two. That needs correction
before release. Truck part naming/dense integrated wheel support will need a
runtime adapter before the current painted pipeline can handle all old jobs.
Pipeline npm test passes after preparation tool addition.

## 2026-10-07 fleet rollout in progress (latest user scope: all geometry fixes authorized)
User answered "Igen mindent ki kéne javítani". Do not ask shade-only vs geometry again.
- Work stays in local/train-models and demo/lifelike-models worktrees; main checkout untouched.
- Fleet root: assets/source/fleet-painted-2026-10-07. 28 active non-C50 candidates prepared. C50 remains approved and unchanged.
- New handbuilt BM50 (2 axles), GMAM; repaired MAV375 drivers, Deltic tank, Kando/GG1 lower body, ICE1 underfloor, DDA40X bellows. Corrected BigBoy/Crocodile source jobs retain original raw GLBs.
- Baseline all 28 captured in playtest scratchpad/models/handover-review/fleet-painted/before (0 browser errors). Old route clips not yet reviewed; do not present unreviewed clips.
- Sample renders at resolution4 completed except two invalidated by renderer edits (Crocodile, BlackFive); their failure was frozen-input protection, not a visual approval.
- Production uses fleet-painted-v1: same accepted materials/lights, resolution2 to limit fleet GPU memory. C50 stays resolution4. Atlas packer deduplicates identical pixels/anchors on each page.
- Production render scripts currently running: render-fleet.py waits for calibrated candidates and renders two concurrently; handbuilt BM50+GMAM render separately. Outputs under production/, logs production-*.log. Inspect completion and images before installation.
- prepare-masks.py reruns the old geometry stage without changing candidate blends, exporting window masks and calibration.json. Adapter was enhanced mid-run: first few reports are missing calibration or the `axles` property. After this run, rerun ONLY those missing complete calibration. Later reports have final wheel coordinates captured from running_gear.bogie.
- calibrate-runtime.py derives all runtime socket fractions and body lengths from calibration reports. Plan-only by default; --apply requires all 28. Not applied yet. Handbuilt scales came from sample reports.
- Generic renderer now includes hash-checked window masks and optional window_materials. Runtime strips `_wN` before looking up window overlays. Need night QA.
- Runtime owned truck sprite support now uses 96 headings/8 integrated phases. DDA40X hinge now solves its truck's rail position at fixed joint-to-socket distance; new test checks both directions. Pose+gear tests 25 pass. Pipeline tests 197 pass; final full game checks still required.
- Outstanding: finish calibration/masks, all production rendering, inspect/fix all candidates, apply calibration, install reviewed bundles, actual-game before/after QA including curved/reversed/stopped wheels and night, gallery update, full tests/typecheck/lint/build, final status. Do not claim fleet is installed/finished yet.


## 2026-10-07 — PAUSED at user request: progress review

User asked to stop and inspect progress. Both fleet renderer process trees were stopped; do not restart until asked to continue. No push or commit. Main checkout untouched.

10 non-C50 bundles installed in playtest: BM50, GMAM, General, ICE1, Rocket, MK48, Muki, DRG01, MAV490, TGV. Authoritative bundle hashes: assets/source/fleet-painted-2026-10-07/installed.json. C50 remains unchanged.

Review: http://localhost:5182/scratchpad/models/handover-review/page/fleet.html (also mirrored to G:/DEV/Terepasztal/renders/engine-models/fleet.html). Nine before/after captures; six visually reviewed with curve animations (BM50, GMAM, General, ICE1, Rocket, MK48). DRG01/MAV490/Muki captures pass automated checks but await visual inspection; TGV not captured yet. Remaining 18 are incomplete.

Restored gear/locoFit entries of all 18 uninstalled locomotives from before-* backups so demo retains matching old sprite calibration. Saved full calibration in calibrated-gear.json and calibrated-locoFit.json under fleet root. Apply each new calibration when its bundle is installed.

Checks before pause: pipeline tests 197 pass, game tests 328 pass, typecheck/lint/build pass; ICE1 repeated render pixel-identical. Nine browser capture reports have no missing frames and pass stationary freeze checks. Build predates the latest installations; incomplete fleet is not fully visually validated.

Resume: preserve temporary outputs, inspect current receipts rather than trusting log existence. render-fleet-tail.py skips existing log files even if interrupted; do not blindly reuse that skip policy. GG1 clipped at heading29; prepared body canvas fixed to640 (production320), rerender pending. SD40 length2.995 also needs prepared body canvas640 / production320 before rerender. Do not change frozen pipeline code while renders run. Details/scripts in assets/source/fleet-painted-2026-10-07 and playtest scratchpad/models/handover-review.


## 2026-10-07 — reference-colour revision, STOPPED for owner review

New owner directions: use workbook pictures/guidelines as shape authority (not current game models), lighten approximately 30%, reduce baked shading because a separate system will own shadows, stop after every five locomotives. Policy saved in fleet-painted-2026-10-07/batch-policy.json.

Located G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx. Extracted embedded images and text into reference-v8; provenance/hash in revision-v2/references.json. GMAM/Garratt is NOT in v8 (only Crocodile has a garratt body-plan reference). Asked user whether standalone assets/source/base-v1/loco-gmam.png should be used or Garratt skipped; no answer yet. Do not reinterpret a real Garratt or the current game geometry as the requested source. GMAM untouched this turn.

Four corrections completed and installed: ICE1 cd94485ea3b4b8cf, General 82c2bc3df986cad5, Rocket 2b41e3d15c548df7, BM50 be8e377ecbd7feeb. This is 4/5 of a review batch; stop here pending reference/review. Other six previously installed v1 fleet models remain v1; 18 others still unfinished. C50 and unrelated fits verified unchanged. No render worker left running.

New profile tools/asset-pipeline/painted/profiles/fleet-reference-v2.json: reference colour emission, shallow 10% normal ramp, Standard colour management, 2% paint variation, no added AO or cast/contact shadows. Original source-image shading remains. ICE1 facing0 luma +32.2%; four-facing averages vary (~31% BM50,39% General,45% ICE1/Rocket). Do not claim all models exactly +30%.

BM50 now has three axles, as workbook row6 specifies, with six rotating pivots and matching runtime rigid supports. Added side portholes, yellow grille, front lamp. New builder/source in revision-v2/models/bm50, original sources preserved. Still a simplified hand-built rendition, not a claim of identical reference detail. General/Rocket/ICE1 retained image-derived geometry checked against workbook rows18/5/28.

Review http://localhost:5182/scratchpad/models/handover-review/page/revision-v2.html shows workbook reference, previous pass, current pass, curves, reversed orientation, night for all four. Also mirrored to G:/DEV/Terepasztal/renders/engine-models/revision-v2.html. Before-v2 screenshots retained. All four 32-frame contact sheets visually inspected; complete 96 headings/8 wheel-phase presence and stationary freeze passed, no browser errors. ICE1 fresh-process sample repeat pixel-identical. Pipeline tests197 and game tests328 pass. Full production receipts validated by installer. No commit/push/main-checkout edits.


## 2026-10-07 — revision-v3 complete; STOP for owner review

Latest user: Rocket wheel diameters -20%; General wheel running surfaces dark grey; BM50 does not match workbook, rebuild; ICE1 accepted. ICE1 acceptance recorded in approved.json, unchanged. C50 unchanged. Do not begin other locomotives before review; batch has these three, max5 rule persists. GMAM reference question still unresolved, not part of this correction batch.

Installed complete bundles: Rocket 05b179f6f211cf9a, General e3000f8ce0fe2277, BM50 feb876ce0486a869. Sources/manifests/scripts in revision-v3; installed.json authoritative. Original models retained.

Rocket: all eight wheel phase meshes radially scaled0.8 around fixed axle positions; gauge and tyre width unchanged; body lowered0.13275m to suit smaller wheels, smoke anchor adjusted. Same metres-to-pixels scale confirmed. Animation travel-cycle ratio exactly0.8. General: all16 tyre materials (eight phases on engine and leading truck) set to dark grey linear RGB0.055,0.060,0.065; geometry/other materials unchanged.

BM50: entirely new geometry built from workbook v8 row6 front+rear images. Red apron now0.27..1.05high, low wide rounded bonnet1.055..1.89, width1.58; open padded seat and silver rear rail, no glazing; portholes, louvres, hatches, caps, yellow slatted end buffers, three mostly hidden wheels. Axle x=[-1.17,.16,1.40], radius.275; runtime rigid supports recalibrated. New profile bm50-reference-v3 is the accepted reference-colour style at resolution4 (density only), retaining no AO/cast shadows. Review-only resolution8 front/rear close-ups show geometry beside both workbook pictures.

Review: http://localhost:5182/scratchpad/models/handover-review/page/revision-v3.html ; mirrored to G:/DEV/Terepasztal/renders/engine-models/revision-v3.html. All three straight,32curveframes,reversed,night visually inspected. Browser completeness96headings/8phases and stopped-freeze pass; no browser errors. Pipeline197tests and game328tests pass. All unrelated locoFit entries unchanged, including approved ICE1/C50. Three production runs finished; no render workers left running. Old captured pass preserved in fleet-painted/before-v3. No commit/push/main-checkout changes.


## 2026-10-07 batch4 — ACTIVE; latest owner accepted v3 and authorized next TEN
Rocket/General/BM50 accepted, added approved.json. ICE1 stays accepted. C50 slight lightening authorized without separate review. Next batch10: muki,mav490,mk45,mk48,rezet,mav375,class08,sw1,drg01,m62. Stop after these10. GMAM unresolved reference, excluded.
Owner explicitly requires pipeline itself never derives shape from in-game models. Implemented painted/reference.py allowlisted reference-spec -> fresh job; prepare_reference.py entry; legacy prepare_existing CLI rejects; painted/run.py requires hashed workbook/images + matching prepared source hash map. Old root pipeline run.py now rejects vehicle blender/post/game stages (Comfy raw-image reconstruction remains allowed). Reference geometry specs manually authored from workbook; old jobs read for source-image annotations ONLY, no fit/gear/shape. Raw GLBs visually matched to workbook in batch4/source-match-contact.jpg. All deformations off, rigid alignment + uniform scale, mirror geometry off. Documentation updated. Boundary tests7 pass and npm test passed before last small root guard/exposure changes; rerun final.
Batch4 specs/, prepared/, samples/, production/. prepare-batch.py running two Blender workers; initial class08/drg01 failed missing ambient config, fixed reference.py. Class08 retried independently; DRG01 still needs retry. Muki retried and succeeded. sample-batch.py currently sampling completed Muki/MAV375/MAV490/M62. Must inspect outputs and geometry before production/install. C50 sample inspected good; lighter-v2 profile exposure+.3, lower AO/paint variation, cast shadows off; full production running. Pipeline renderer/run/reference files frozen while rendering.
Pending: complete10 preparations, sample geometry QA, full renders, runtime calibration from new measured geometry (NOT old calibration script), install full receipt-verified bundles, browser straight/curve/reversed/night/stationary QA, new10 review gallery, final tests/status. No batch4 models installed yet. Main checkout untouched. No commit/push.


### Batch4 active update (after reference preparation and first installations)
All10 prepared freshly from raw image models with locked workbook references. Conditioning crops compared to Excel. Rear colour source illustrations additionally hash-locked and visually checked; raw reconstruction meshes never modified. Additional rear pictures are for hidden colour, workbook remains shape authority.
Reference scripts in tools/asset-pipeline/painted: reference.py, prepare_reference.py, disabled prepare_existing CLI, rebuild_reference_trucks.py. run.py requires reference locks. Root tools/asset-pipeline/run.py rejects vehicle blender/post/game paths; comfy-only allowed. prepare_reference explicit yaw overrides legacy nose annotation (Mk48 short hood front).
Batch4 manual reference repairs: rebuild-drg-tender.py (clean black coal/water tender, red frame, four axles), rebuild-m62.py (fresh green/cream two-cab diesel + 2x3 bogies), clean-trucks.py invokes generic clean reference bogies for DRG engine/Mk45/Mk48/SW1. fix-mk48-paint.py neutralizes blue colour spill only below1.35m; orient-mk48.py rigid180-degree final turn + matching calibration/effects. These repair scripts are ONE-PASS except rebuilding scripts: do not blindly run orientation twice. No game geometry used as input. Original source/prototypes retained.
C50 lighter complete bundle9b2895c365ef3420 installed, capture passed, internal straight/night/reversed+curve montage inspected; no separate review requested. Registry now includes c50. Profile c50-lighter-v2: exposure+.3, AO.25, paintlow.86, cast shadows off. Approved geometry unchanged.
Installed new batch4 complete bundles so far: muki df993e15a1abe868, mav490 8690d4babac449d7, rezet042f72e04a38ef33, mav37545fd660d5b507e08. Muki/MAV490 capture passes after atlas fix; both32frame curve contacts visually inspected; still need straight/night/reversed combined visual pass and reviewed markers. Rezet/MAV375 capture currently running.
Runtime atlas had hardcoded max16pages, installing crossed17 and loader silently ignored laterpages. Fixed playtest src/engine/atlas.ts cap128, added meaningful mocked loading test atlas.test.ts (17pages loads last, passed). Generic installer now checks target loader cap before mutation; test added. Rerun final pipeline npm test. Main checkout untouched.
Production workers still RUNNING: batch4/production-batch.py muki mav490 rezet mav375 class08 m62 (first4done, latter2active); another drg01 mk45 sw1; another mk48 FINAL orientation (initial MK48 run deliberately stopped, do not install abandoned temp output). Logs production-ID.log; content-addressed output must have receipt. All renderer/run/reference/profile inputs frozen; do not modify until render workers finish.
Install via batch4/install-ready.py ID... (current signature+receipt, verifiesuniformscale1, derives game gear+fit/truckOffsets from fresh calibration only). No old calibrate-runtime.py. Backups batch4/runtime-before/ID plus generic installer scratchpad backups.
Playtest capture-fleet-after.mjs IDs; build-batch4.py new gallery builder maps10 rows and only accepts installed revision reference-batch4 with matching capture bundlekey. Currently gallery only2 entries, NOT published to user. It writes32frame contacts and emitsanimations onlywith after/ID-reviewed.txt. Before images use baseline before/. New M62/DRG gallery descriptions note rebuilds.
Contact.py underbatch4 makes source/samplescomposite forinternalQA. Fixeddraworder trucksfirstthenbody (earlier truck-over-body montage misleadingly madefarwheelsoverlapbody). Latest models are candidate approximations for user review; do notclaim exactphotographicmatch or ownerapproval. Full QA/10gallery/finalchecks stillpending. Stopafter10.


## 2026-10-07 batch4 COMPLETE — STOPPED for owner review after TEN
Latest owner instruction fulfilled: pipeline derives geometry from workbook pictures/guidelines, not in-game models. Ten review candidates installed and QA complete: Muki, MÁV490, Mk45, Mk48, Rezet, MÁV375, Class08, SW1, DRG01, M62. Exact bundle paths/keys in batch4/installed-batch.json and root installed.json. No further locomotive started. GMAM reference still unresolved; skip until clarified. This is a review batch, not owner approval of these ten.
Gallery: http://localhost:5182/scratchpad/models/handover-review/page/batch4.html (mirrored to G:/DEV/Terepasztal/renders/engine-models/batch4.html). Ten workbook references, before/current game images, ten reviewed curve animations, reversed orientation and night. All60 image URLs validated HTTP200. Source/game galleries contain assets; do not embed media in chat.
C50 slightly lighter9b2895c365ef3420 installed and internally QAed; geometry unchanged. Default C50 manifest now chooses lighter-v2. Prior Rocket/General/BM50/ICE1 approvals recorded and their installed models retained.
Reference pipeline: reference.py builds allowlisted fresh jobs from locked workbook/images/raw reconstruction, manual reference dimensions and wheel layout. prepare_reference.py replaces disabled legacy prepare_existing command. Root old run.py rejects vehicle blender/post/game even if cached; comfy-only raw generation remains. Rendering requires picture + prepared model hashes. Missing/changed references, legacy job input and deformation settings rejected. Supplementary rear colour images hash-locked; workbook remains shape authority. No models_raw changes.
Fresh image source match and rear colour comparison saved in batch4. Reconstructed M62 had patchy surfaces: replaced with a clean handbuilt reference interpretation; DRG01 tender rebuilt from the picture. Clean reference-authored bogies for DRG01/Mk45/Mk48/SW1. Mk48 lower blue colour spill neutralized; whole model turned to short-hood front. The one-time orient-mk48.py migrated the old prepared output; do NOT rerun it after a fresh prepare_reference run, which already honors explicit yaw over old nose annotations.
QA: all10 complete96-heading/8-phase runtime presence, stopped freeze, straight/32curveframes/reversed/night inspected, no browser capture errors. Geometry audit matches all10 reference axle counts. Muki and M62 representative fresh-process sample renders pixel-identical. Pipeline8 Python boundary tests and197 Vitest tests pass; playtest329 tests, typecheck,lint,build and changed-file Prettier checks pass. Build has only existing large-chunk advisory.
Runtime fix: atlas loader's16page ceiling caused missing frames after fleet crossed17. Playtest atlas.ts now supports128, regression test verifies17th page; installer checks target capacity before writing. Runtime calibration is derived from new prepared geometry, not reused game fit. Backups batch4/runtime-before plus generic installation scratchpad backups. All other fits preserved by per-id writes.
All render/capture workers finished; no batch4 Python/Blender workers left running. Main checkout untouched. No commit/push/merge. Next action: await owner review of these TEN, then use reference-first workflow for remaining fleet. Do not blindly resume old fleet renderer or calibration scripts.
# 2026-10-08 owner width correction IN PROGRESS

CURRENT FOLLOWUP: `assets/source/fleet-painted-2026-10-07/batch4-wheel-v3/STATUS.md`.
Wide25% narrower chosen by owner, applied to playtest. Five wheel assemblies rebuilt
from reference-authored axle fractions/diameters, no automatic detection/shrinking;
sample QA done, full renders running. Capture/build-wheel-v3 scripts ready in
playtest. Must finish installation and visual review before stopping for owner.

LATEST: owner rejected wheel appearance in width-v2; do not report it complete or
approved. Owner chose **wide rails 25% narrower**, standard gauge 0.24 tile
(half 0.12), narrow unchanged 0.16 (half0.08). Playtest trackIllustrated/track/
procedural rolling and reference.py now changed to this contract. The five width-v2
installed models are temporarily still on the older 0.32 wheel gauge until rebuilt.
Confirmed wheel faults: MÁV375 automatic detection put two drivers only0.419m
apart and shrank all drivers to0.721m; reference needs1.18m. SW1 bogie axles only
0.78m apart but wheels1m diameter overlap. New repair must use reference-authored
axle layout and prove wheel clearance, body occlusion and rail contact visually.
User has seen gauge-options.html and selected25%; no further gauge approval needed.

Current work is assets/source/fleet-painted-2026-10-07/batch4-width-v2/STATUS.md.
Only MÁV375, Class08, SW1, DRG01 and M62. Standard rail gauge was incorrectly
hardcoded as narrow in preparation and truck builder; fixed. Body width -15%,
wheel centres corrected to standard track; original M62 image reconstruction
restored instead of rejected simplified handbuilt shape. Samples reviewed; full
rendering pending completion/install/runtime QA. Do not start another fleet batch.

