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


## 2026-10-07 batch4 COMPLETE — STOPPED for owner review after TEN
Latest owner instruction fulfilled: pipeline derives geometry from workbook pictures/guidelines, not in-game models. Ten review candidates installed and QA complete: Muki, MÁV490, Mk45, Mk48, Rezet, MÁV375, Class08, SW1, DRG01, M62. Exact bundle paths/keys in batch4/installed-batch.json and root installed.json. No further locomotive started. GMAM reference still unresolved; skip until clarified. This is a review batch, not owner approval of these ten.
Gallery: http://localhost:5182/scratchpad/models/handover-review/page/batch4.html (mirrored to G:/DEV/Terepasztal/renders/engine-models/batch4.html). Ten workbook references, before/current game images, ten reviewed curve animations, reversed orientation and night. All60 image URLs validated HTTP200. Source/game galleries contain assets; do not embed media in chat.
C50 slightly lighter9b2895c365ef3420 installed and internally QAed; geometry unchanged. Default C50 manifest now chooses lighter-v2. Prior Rocket/General/BM50/ICE1 approvals recorded and their installed models retained.
Reference pipeline: reference.py builds allowlisted fresh jobs from locked workbook/images/raw reconstruction, manual reference dimensions and wheel layout. prepare_reference.py replaces disabled legacy prepare_existing command. Root old run.py rejects vehicle blender/post/game even if cached; comfy-only raw generation remains. Rendering requires picture + prepared model hashes. Missing/changed references, legacy job input and deformation settings rejected. Supplementary rear colour images hash-locked; workbook remains shape authority. No models_raw changes.
Fresh image source match and rear colour comparison saved in batch4. Reconstructed M62 had patchy surfaces: replaced with a clean handbuilt reference interpretation; DRG01 tender rebuilt from the picture. Clean reference-authored bogies for DRG01/Mk45/Mk48/SW1. Mk48 lower blue colour spill neutralized; whole model turned to short-hood front. The one-time orient-mk48.py migrated the old prepared output; do NOT rerun it after a fresh prepare_reference run, which already honors explicit yaw over old nose annotations.
QA: all10 complete96-heading/8-phase runtime presence, stopped freeze, straight/32curveframes/reversed/night inspected, no browser capture errors. Geometry audit matches all10 reference axle counts. Muki and M62 representative fresh-process sample renders pixel-identical. Pipeline8 Python boundary tests and197 Vitest tests pass; playtest329 tests, typecheck,lint,build and changed-file Prettier checks pass. Build has only existing large-chunk advisory.
Runtime fix: atlas loader's16page ceiling caused missing frames after fleet crossed17. Playtest atlas.ts now supports128, regression test verifies17th page; installer checks target capacity before writing. Runtime calibration is derived from new prepared geometry, not reused game fit. Backups batch4/runtime-before plus generic installation scratchpad backups. All other fits preserved by per-id writes.
All render/capture workers finished; no batch4 Python/Blender workers left running. Main checkout untouched. No commit/push/merge. Next action: await owner review of these TEN, then use reference-first workflow for remaining fleet. Do not blindly resume old fleet renderer or calibration scripts.
