# Train model checkpoint, 2026-10-06

## Rear-view audit after owner feedback

The owner asked whether the weak models result from missing rear references and
said the models need work. Verified in local code and original render logs:

- All four review engines have rear images. Each was accepted by the old Blender
  ExtraView fit and used by source_texture.reproject, which edits base colour only.
- comfy_client.run_asset uploads one image. The saved workflow has one LoadImage
  feeding Pixal3DConditioning; rear views do not constrain the reconstructed mesh.
- Untouched-model review deliberately omits all later source/rear repainting, so
  original colour quality must not be confused with geometry quality.
- ComfyUI on port 8000 exposes local Pixal3DMultiViewConditioning (not an API node).
  Source at G:/ComfyUI/ComfyUI/ComfyUI/comfy_extras/nodes_trellis2.py hardcodes
  camera elevations to zero and azimuths 0/90/180/270. Existing train references
  are elevated three-quarter views. Blindly connecting them would supply wrong
  cameras. No ComfyUI process, code, workflow or model was changed or queued.
- Added all four existing rear images and this explanation to both review pages.
  Builder: demo scratchpad/models/handover-review/rear-audit.py; rerun it after
  build-review.py, which otherwise replaces the section. Evidence JSON is in
  page/rear-reference-audit. Reviewed the rear images; no new image generation.
- Proposed first repair pilot: C-50, with consistent front/rear references and
  calibrated camera poses/framing before genuine multi-view geometry reconstruction.
  No geometry improvement is claimed yet. Fleet rerender remains out of scope
  until the original review and a successful pilot have been discussed.

Stop here for the owner's visual response. Do not render the fleet yet.

## Protected work and scope

- Main checkout `C:/Users/Zso/terepasztal` was not modified.
- Original pipeline and scratch changes were committed first, unchanged, as
  `10fc7d2` on `local/train-models`. No push, merge or PR.
- Subsequent review tooling is uncommitted. No image generation was used.
- Read `REQUEST.md` for all engine-specific follow-ups and `HANDOFF.md` for paths.

## Delivered

- Demo `C:/Users/Zso/terepasztal-playtest`: eight new retired flags in
  `src/data/locomotives.json`, plus removal of six corresponding banner entries
  in `src/data/gacha.json`. Existing saved copies still resolve.
- `G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx`: all ten retired engines
  marked out of game, latest owner notes appended before older review text,
  fleet instructions recorded. 69 cells changed. All 107 media parts and all
  other ZIP package parts except the Locomotives worksheet are byte-identical.
  Artifact Tool authored values; a narrow package transfer preserved original
  formatting, relationships, drawings and every other sheet.
- Review: `G:/DEV/Terepasztal/renders/engine-models/index.html`.
  Original page saved as `index-before-originals-2026-10-06.html`.
- Self-contained repository copy and generated evidence:
  `C:/Users/Zso/terepasztal-playtest/scratchpad/models/handover-review/page/`.
  Served at `http://localhost:5182/scratchpad/models/handover-review/page/`.

## Render scope and limitations

`tools/asset-pipeline/render_originals.py` is an isolated Blender review path.
It imports original GLBs without mesh edits, UV edits, material edits, source
projection, perspective correction, symmetry, gauge warp, cuts or new wheels.
Raw view 0 preserves the imported world pose. Additional views turn the whole
object about world Z. The game camera is orthographic at elevation 30, azimuth 45.
The rigid candidate uses one global normal-based orientation and one uniform
height scale. It is not yet a wheel-contact solution or production sprite export.
The raw GLB hashes and mesh hashes are verified unchanged after every engine.

Four engines: C-50, Black Five, DRG 01, Daylight. Four views per raw/candidate mode,
32 images total. Camera framing was corrected after a DRG 01 buffer clipped;
final alpha-bound checks pass for every image. Images are framed for inspection,
not for a shared physical scale. Original materials differ from the old pipeline's
source-repainted materials, explicitly labelled on the page.

Four baseline clips from the running game, 32 frames each, zoom 3, 8 ticks/frame
(133 ms). All 128 final frames visually inspected on numbered contact sheets.
They cover straight-to-curve-to-straight motion. Existing angle changes, narrow
front/gear separation and wheel differences remain visible; they are baseline
evidence, not fixes. Full clips retain the complete 720x480 capture; QA sheets
crop background vertically for inspection. An earlier straight-only capture was
replaced. One capture interrupted by Vite reload was rerun successfully.

Production atlas files, legacy shape transforms, symmetry/gauge settings and
the game's swingMesh renderer are UNCHANGED pending the owner's checkpoint.
Do not describe the production pipeline or pulsing as fixed.

## Validation

- Demo: 33 test files, 323 tests passed. Build (including typecheck), lint and
  full src Prettier check passed. Build retains the existing chunk-size warning.
- Pipeline checkout: 19 test files, 195 tests passed after final script edit.
- Review page: 44 images loaded, zero page errors. Demo save parsed as version 13.
- Workbook: requested values verified after save; image/package preservation
  verified; reviewed existing and edited cell renders; no formula errors found.
- Logs and repeatable builders are in the demo's handover-review directory.

## Pending owner decision and next steps

First judge the original reconstructions and whole-model alignment candidates.
Ask whether the original far side is acceptable or mirroring is needed per model.
Proposal already communicated: retain raw geometry in this inspection; make any
later symmetry explicit; inspect original wheel placement against unchanged rails
before deciding on gear widening. No decision has been inferred from silence.

After response: complete wheel-based rigid stance, choose sufficient real 3D
heading density, integrate without sprite bending, then address the individual
engines and cut/attachment faults in REQUEST.md. Preserve the current comparison
as the before baseline. Do not regenerate all engines before the owner's reply.

## 2026-10-06 follow-up: in-game double-image repair

The owner clarified that the original rear geometry is acceptable and the game
image looks like misaligned pictures. Do not pursue multi-view reconstruction.

Diagnosis: C-50's existing atlas facing 24 visibly places cabin/window details on
the long hood. This persists with runtime warping disabled. The raw GLB does not
have this painted duplicate. Original materials remove it. Runtime proxy-box
bending is a separate distortion and has now been removed from SwingSprite.

Implemented in the demo checkout:
- C-50 exported from the original GLB with the previously reviewed rigid matrix,
  one uniform scale to the existing 0.8239-tile body footprint, unchanged mesh,
  UVs and materials. Original hash and mesh hash verified unchanged.
- 48 real headings at resolution 4, in public/assets/rolling-5.png/json. Existing
  rolling.json now lists five pages. C-50's old frame keys removed from old pages;
  the four old PNGs are unchanged. Prefer an actual facing over a mirrored twin.
- Original wheels remain in the C-50 body. Removed its old animated wheel
  definition and old projected window-light frames, which no longer align.
  This is intentionally a static-wheel pilot; no new wheel geometry or gauge warp.
- All train sprites now use one intact quad, no swingMesh runtime deformation.
  Legacy atlas heading steps remain visible; other engines' textures unchanged.
- New regression test checks once-only frame coverage and fractional mirror anchor.

New pipeline entry points: render_rigid_stock.py and export_rigid_stock.py.
Config and all evidence are in the demo's scratchpad/models/handover-review:
rigid-c50.json, rigid-c50/, c50-fix/, capture-fix.mjs, build-fix-review.py,
verify-fix.mjs. The isolated exporter currently targets this C-50 pilot/page 5;
it is not a general whole-fleet export. Its post-pack resolution assignment is
required because the demo's older atlas packer drops resolution metadata.

Review page has #c50-fix at both delivery locations. Two synchronized before/after
clips (front and reversed display orientation), 24 poses each, same simulated
state verified exactly. Every before/after frame inspected on six contact sheets;
all 48 new atlas headings inspected too. Browser checks for all four review
engines and C-50 at night: no errors, 48 frames at correct resolution, no legacy
C-50 wheel/window overlay. Review: 51 images, none broken; save parses as v13.

Validation: demo 34 files / 324 tests, build and lint pass. Changed files pass
Prettier. Full src Prettier check reports 173 files outside this change; do not
reformat unrelated work. Pipeline: 19 files / 195 tests pass. Nothing pushed,
merged or committed after initial safety snapshot.

Remaining: owner judges the C-50 repair; other engines' baked texture/shape faults
need their own repair, original-wheel animation and denser true headings remain.
Do not claim the whole fleet, wheel animation or all pulsing is fixed.

## 2026-10-06 style correction: preserve the approved illustration

Owner rejected the dull original-material appearance: the sprite must match the
source illustration and game style. The target is now faithful geometry with
source-painted materials, not the untouched imported material as a final look.

render_rigid_stock.py now accepts style=source-painted. The original conditioning
image is camera-fitted (C-50 silhouette IoU 0.987) and projected only onto visible
surfaces. Hidden surfaces retain generated details with learned colour transfer
(hidden=transfer); no extra rear projection, no mirrored projection, no nearest
spatial colour smear. running_gear.repaint applies existing painted shading.
No geometry or UV edit. Mesh/source hashes, rigid matrix, anchor and resolution
are exactly the same as the previous original-material C-50 pilot.

New config: demo scratchpad/models/handover-review/painted-c50.json. Outputs in
painted-c50/raw and frames; previous atlas saved in painted-c50/previous-materials.
The current rolling-5 atlas now contains this painted result. The older original
material screenshots remain historical evidence, not the current game look.

Review #c50-style (both locations) compares previous material against painted
material in the same game poses, front and rear. 48 game screenshots plus their
48 matched previous captures inspected on six sheets; all 48 new heading renders
inspected. 55 review images load, zero browser errors, demo save parses as v13.
Pipeline 19 files / 195 tests pass; demo production build passes. Source_texture
log wording now correctly identifies the hidden-fill policy rather than always
claiming nearest-fill. No runtime code changed in this style pass.

Limitations: hidden-side fine detail is still weaker than source-visible detail;
refine that material next without reintroducing misregistered rear projection.
Wheels remain static as in the prior C-50 pilot. Other locomotives unchanged.

## 2026-10-07 owner decision

Owner: "A painted style eleg jo lesz! Csak a proportionjei nem jok a c50-nek a
 tobbire jo lesz ez a megoldas" (painted style is acceptable; C-50 proportions
are wrong; this material solution is suitable for the other engines).
Treat source-painted style as accepted. Do not spend more iterations changing
that style or request approval of it again. C-50 proportions are the current
issue. Clarification requested: whole-vehicle size relative to fleet vs internal
body proportions, or both. No answer yet at this checkpoint.

Before clarification, isolated surface diagnostic made in demo
scratchpad/models/handover-review/surface-audit.py and surface-audit/:
front/rear with existing painted light, flat emission and clay material. Same
geometry verified unchanged. Clay shows reconstruction irregularities around
windows/louvres/wheels, while rear texture lacks source-visible fine detail.
More polygons alone would not restore those details. No runtime assets changed
in this diagnostic. The currently loaded game remains the accepted painted pass.

Owner clarified: C-50's INTERNAL PART PROPORTIONS are wrong, not whole-vehicle
size relative to the fleet. Asked which part is too big/small/long/short (cab,
long front hood, short rear hood) before editing geometry. Source-painted style
remains accepted. Do not substitute a global size change for this correction.
The original blanket no-reshaping direction still warrants care: make a specific,
visible correction to the identified part, not automatic perspective/axis warps.


## 2026-10-07 completed: authorized C-50 widths, wheels and reduced stepping

The owner identified INTERNAL part widths, then explicitly authorized equal hood
widths and +40% supporting base width. This authorizes these derived geometry edits;
it does not authorize arbitrary fleet deformation. Source-painted style is accepted.
The later request also adds wheel rotation and roughly halves movement stepping.

Implementation in terepasztal-local/tools/asset-pipeline:
- c50_proportions.py and its .test.mjs: front hood 1.2723436 -> 1.5620113 m,
  matching the existing rear hood (+22.77%); supporting deck width x1.4.
  Cab, longitudinal/vertical coordinates and inner running gear remain unchanged.
- render_c50_corrected.py: original GLB preserved; derived body corrections;
  circular wheel rings at measured centres x=-.915/.535, z=.475, radius=.43 m,
  stationary axleboxes, fourfold rotating wheel markings. Uses accepted painted
  texture/material approach. 96 headings x 8 quarter-cycle wheel phases.
- export_rigid_stock.py accepts explicit authorized corrected metadata and installs
  integrated frames. First four atlas PNGs retained; rolling-5 is 4091x3073,
  resolution 4, 768 animated frames plus 96 phase-zero body aliases.

Demo is C:/Users/Zso/terepasztal-playtest, branch demo/lifelike-models.
Pipeline is C:/Users/Zso/terepasztal-local, branch local/train-models.
Original GLB SHA256: 0e8df395e397bc982ebc2196b76d119892dc1696615530a8a7c024c6f1c3f131.
Derived body SHA256: 32e52c2c0622d38eef37859b04d984130c8e4660f2a14c482fb718026cf86e4a.
Raw render metadata: scratchpad/models/handover-review/corrected-c50/raw/meta.json.
Derived scene: scratchpad/models/handover-review/corrected-c50/c50-corrected.blend.
Full config corrected-c50.json; three batch configs resume/merge the 768 renders.
Previous painted atlas backed up in corrected-c50/before-atlas/.

Runtime: spriteFacings=96 only for C-50, integrated wheel phase selected using
signed travelled distance; no duplicate wheel overlay. Eight phases span 90 degrees
because the wheel pattern has fourfold symmetry. Wheel cycle .1083296553 tiles.
No explicit vertical bob exists in this renderer. Actual stepping was reduced by
halving C-50 angular steps 7.5 -> 3.75 degrees and ALL trains' screen rounding
1/3 -> 1/6 pixel. Do not describe this as halving physical suspension amplitude.
Files: src/render/spriteFacing.ts + tests, trainRenderer.ts, data/content.ts,
data/locoFit.json. Earlier intact-quad rendering remains.

Validation:
- Game tests: full run 326 passed, one existing terrain fixture timed out during
  parallel Blender CPU load. That entire file subsequently passed 15/15 with a
  20s timeout; no test expectation/source changes. Pipeline 195 passed plus one
  same fixture timeout; its file subsequently passed 12/12. New geometry,
  heading, pixel rounding, wheel movement/stop/reverse tests passed.
- Game lint, changed-file formatting, final typecheck/build passed. Existing
  whole-src formatting failures not rewritten. No push/merge/new commit.
- Actual browser: all 96x8 frames present; >=6 moving phases, stationary phase
  remains unchanged, zero wheel overlays, no page errors.
- All 768 alpha bounds are identical across phases for each heading (0 px drift),
  exporter confirms no clipping. All 96 heading thumbnails visually inspected.
- All 24 front and 24 rear before/after clip frames visually inspected, as were
  all 48 close-up wheel frames. Rear comparison changes display orientation at
  the same route pose. The reverse phase invariant is separately unit-tested.
- Review page: 59 images, zero broken images/errors. Demo-save structure parsed;
  this check is not an actual saved-game load.

Review builder/captures live under playtest scratchpad/models/handover-review:
capture-fix.mjs corrected, capture-wheels.mjs, build-corrected-review.py.
Current page section #c50-corrected, ahead of historical #c50-style and #c50-fix.
Self-contained copies at page/ and G:/DEV/Terepasztal/renders/engine-models/.
QA sheets and PNG sources in c50-corrected/ and c50-fix/corrected/.
Source-painted hidden surfaces retain less detail than the source-facing side;
original surface roughness is not a claim of complete mesh cleanup. Wider deck
naturally occludes wheel tops. Other fleet model/style propagation is still pending.


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
