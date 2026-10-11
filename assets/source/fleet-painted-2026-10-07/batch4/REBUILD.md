# Rebuilding this reference batch

**Historical batch, superseded for MÁV375/Class08/SW1/DRG01/M62 on 2026-10-08.**
For those five use `../batch4-width-v2/STATUS.md`. The owner rejected the simplified
M62 from `rebuild-m62.py`; do not apply that replacement in future work. The recipe
below documents reproduction of the old review only, not the accepted direction.

The frozen prepared blends and manifests reproduce the reviewed sprite rendering.
`painted/run.py` validates all hashes and the locked Blender build. Do not silently
replace source hashes when rebuilding geometry: a changed model needs visual QA.

For fresh geometry, run `painted/prepare_reference.py` in Blender on each specs/ID.json.
Then run the explicit reference repairs: rebuild-m62.py for M62; rebuild-drg-tender.py
for DRG01; painted/rebuild_reference_trucks.py for DRG01, Mk45, Mk48 and SW1;
fix-mk48-paint.py for Mk48. The historical orient-mk48.py is a ONE-TIME migration of
an earlier output and is NOT a fresh-build step: prepare_reference.py already gives
explicit workbook front direction precedence over the old source nose annotation.

sample-batch.py renders 4 headings and 2 phases for comparison with workbook images.
Only after checking the candidates, production-batch.py renders full bundles.
install-ready.py checks receipts and calibrates runtime sockets from model measurements.
Run playtest capture-fleet-after.mjs and inspect before marking review images ready.
No input stage reads in-game geometry. Input image reconstruction/manual modelling is
not claimed pixel-deterministic; the frozen prepared-source renderer is.
