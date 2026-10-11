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
