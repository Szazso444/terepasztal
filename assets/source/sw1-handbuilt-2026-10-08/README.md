# SW1 rebuilt by the accepted C-50 method

Owner rejected the deformed reconstructed SW1 on 2026-10-08. This is a new model,
built from workbook v9 row21's picture using the C-50's actual modelling helpers.
No earlier SW1 mesh or texture is imported. The workbook picture remains the
shape/livery authority. Constant hood width 1.80 model metres at both ends,
cab width 2.26, deck width 2.50; all main axes parallel. Dimensions describe the
illustration-derived game model, not prototype engineering dimensions.

Separate manufactured panels, glazing, curved roof, radiator, fans, louvres,
handrails, lamp lens and safety stripes are real geometry. Both articulated
bogies are built from frame beams, ends, axleboxes, springs, motors and pivoted
wheels with dark treads. Rail half-gauge remains 0.12 tile.

Uses the exact current C50 profile: c50-lighter-v2.json, resolution4, no cast
shadows. Glazing uses explicit window materials; lamp coordinates come directly
from the constructed lens. Source is build.py; candidate.json is the frozen
render manifest. Original C50 and other locomotives remain unchanged.

Rebuild from the source repository root:

```powershell
$sw1Blender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
$sw1Python = 'G:/DEV/Terepasztal/train-sizes/.venv/Scripts/python.exe'
& $sw1Blender -b --factory-startup --python assets/source/sw1-handbuilt-2026-10-08/build.py
& $sw1Python tools/asset-pipeline/painted/run.py assets/source/sw1-handbuilt-2026-10-08/candidate.json --blender $sw1Blender --out assets/source/sw1-handbuilt-2026-10-08/verified-samples --sample --verify-repeat
& $sw1Python tools/asset-pipeline/painted/run.py assets/source/sw1-handbuilt-2026-10-08/candidate.json --blender $sw1Blender --out assets/source/sw1-handbuilt-2026-10-08/production
```

Review the geometry and renders before running `install.py sw1`. Installation
targets the existing playtest checkout, backs up its runtime calibration and
atlas, and records the content-addressed bundle in the fleet registry. The
production input is immutable while a render runs; a changed source invalidates
the bundle. Blender files can contain save metadata; pixel determinism is checked
from the frozen manifest/model hashes, not by assuming blend-file byte equality.

Sample verification: final corrected geometry rendered twice in fresh Blender
processes; identical pixels and metadata for all three parts, four headings,
two wheel phases. Receipt: verified-samples/sw1/7fee081c772cc942.
The pilot chevrons are clipped to the pilot face, including at both lower corners.

Status: complete candidate, installed in the playtest checkout; stopped for owner
review. Production bundle: `production/sw1/9308b137d636fd93`. All 96 headings,
eight wheel phases per bogie, zero phase silhouette drift. Actual game captures
verify stationary freeze, 32 curve frames, reverse, night/window/lamp alignment,
close-up and the accepted C50 alongside SW1. Source tests: 197 passed; game tests:
329 passed, production build/typecheck passed. The first game-test invocation
lacked Python on PATH; rerun with the configured PYTHON executable passed all.

Review: http://localhost:5182/scratchpad/models/handover-review/page/sw1-handbuilt.html
Sources and captures remain in the repositories; gallery mirrored to
`G:/DEV/Terepasztal/renders/engine-models/sw1-handbuilt.html`.
The earlier `production.log` is an intentionally superseded run rejected by
the input-lock check after the pilot-stripe correction; `production-final.log`
is the complete frozen-input render. Other locomotives were not changed.
