# SW1 picture-only refinement and replayable recipe

Owner accepted the handbuilt method, then requested closer reference fidelity
and a saved workflow usable for subsequent locomotives. This project consumes
only `references/01.png` for appearance. It is the decoded workbook row21 image,
converted losslessly to PNG; original file hash and filename are in project.json.
No game model, screenshot, fit or gear table is read during construction.

The recipe retains the clean C50 construction method. Changes observed from the
image: neutral charcoal colours, rounded hood shoulders, five wider panel groups,
larger fan housings farther toward the nose, roof grille crossbars, flared horn,
bell rim/crown, fuller cast bogie frame with paired openings, rounded fuel tank,
narrower access steps and steeper front pilot chevrons.

Unsupported rear windows and rear chevrons were removed. Unknown rear structure
is a minimal closure; bilateral side layout and hidden mechanical structure are
explicit assumptions, not verified prototype facts. See observations.json for
per-picture evidence regions and the inferred/omitted lists.

## Replay

```powershell
& 'G:/DEV/Terepasztal/train-sizes/.venv/Scripts/python.exe' tools/asset-pipeline/handbuilt/run.py all assets/source/sw1-picture-recipe-2026-10-08/project.json --blender 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
```

This runs the locked construction recipe, verifies sample pixel equality in two
Blender processes, and produces a full 96-heading, eight-wheel-phase bundle.
The PNG, picture observations, recipe, exact C50 primitives and style are saved
together. To apply the method to another locomotive, use `handbuilt/run.py init`
with its PNG(s), then author its observations and shape recipe. The command flow
is shared; image interpretation is deliberately explicit rather than guessed.

Full method and installation: `tools/asset-pipeline/handbuilt/README.md`.

Status: complete candidate, installed and stopped for owner review.
Production bundle `production/sw1/9ff62138c0baf07f`; verified sample
`sample/sw1/f47b924a4b87b922`. The documented `all` command built the model,
verified the sample twice and completed production (`replay.log`). A subsequent
`build` command verified the construction cache. `construction-repeat.json`
confirms a fresh rebuild matches evaluated geometry/materials/parenting and
calibration: 295 body meshes and 61 per bogie. The generic installer successfully
installed this exact project; other locomotive registry entries remain unchanged.

Python boundary tests: 7; painted tests: 11; source tests: 197; game tests: 329.
Game typecheck/build passed. Actual-game checks: 96 directions, eight wheel
phases, stationary freeze, 32 reviewed curve frames, reverse, lamp/window light,
close-up and C50 comparison. The gallery's 11 images and UTF-8 text were checked.

Review: http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v2.html
Mirror: `G:/DEV/Terepasztal/renders/engine-models/sw1-picture-v2.html`.
The earlier production.log was superseded when the cab stripe/door overlap was
found; replay.log is the successful final immutable-input production run.
