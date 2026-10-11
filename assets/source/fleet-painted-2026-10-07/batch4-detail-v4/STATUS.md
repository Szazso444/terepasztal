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
