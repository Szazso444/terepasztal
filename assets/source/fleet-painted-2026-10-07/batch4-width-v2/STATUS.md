# 2026-10-08 — owner correction in progress, five locomotives only

Owner reports excessive width / wheels missing standard rails from MÁV375 down:
MÁV375, Class08, SW1, DRG01, M62. Narrow-gauge five above are unchanged.
M62 simplified handbuilt replacement rejected: original reference-image GLB is
re-prepared, not the in-game mesh. Original batch4 remains as a recoverable revision.

Root cause: reference.py and the clean truck builder hardcoded +/-0.499m, the
narrow gauge, for all stock. Standard rails are +/-0.16 tile = +/-0.99761036797m.
Pipeline now selects standard/narrow explicitly, with a regression test. Batch4
reference specs are annotated with gauge; this does not re-render the other five.

Isolated prepared copies here have body width reduced 15% by owner instruction.
Wheels/rods shift transversely onto standard rails; their diameter, length and
height are unchanged. Width audit JSON checks X/Z extents. M62 freshly prepared
with correct standard gauge; its textured body retained. No manual box replacement.

Samples checked in four headings. Full production rendering started.
Do not mark complete until installation, in-game captures and visual curve review.

Rebuild: setup.py copies original four candidates (do not rerun on corrected copies).
Prepare M62 with painted/prepare_reference.py on specs/m62.json. Then run
correct-width.py exactly ONCE per candidate in Blender. sample-batch.py, followed
by production-batch.py and install-ready.py only on the five IDs above.
Do not run batch4/rebuild-m62.py: owner explicitly rejected its simplified shape.
