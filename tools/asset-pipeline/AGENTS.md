# Train game asset pipeline

This file is the pipeline's guide for every agent, of any tool: stages, file roles, conventions, the game's frame
names and the rules for edits. Read it before changing anything here. `ASTRA.md` is the brief for the input images:
rules, prompt template and the shot list, with file names that `assets.csv` expects in `input/`. `CLAUDE.md` here only
imports this file.

Where the pipeline meets the game, the game wins: `game_rules.py` mirrors `src/sim/body.ts`, and
`game_rules.test.mjs` fails when they drift. Run `npm test` from the repository root after any change here.

Two methods live here; the root `AGENTS.md` still applies to both.

- **The hand-built method** (current, the owner's method for locomotives): picture (PNG) -> observations and an
  authored Blender recipe from the C-50's primitives -> editable model -> painted 2:1 sprites and atlas pages. It made
  the accepted C-50 and SW1. Next section; `handbuilt/README.md` is the method, `painted/README.md` the renderer.
- **The ComfyUI pipeline** (earlier): photo -> ComfyUI (Pixal3D / TRELLIS.2) -> GLB -> Blender (align, real scale,
  tile fit, 2:1 renders) -> sprites + atlas -> the game's atlas groups. Every section after the next one.

## The hand-built method

### Blender: the author's PC and the cloud
Every Blender step goes through `blender_runner.py` and needs Blender **5.2.x** (the C-50 and SW1 were built with
5.2.1 LTS, build `9e2066aef7ef`, which the render profiles lock). Any other release stops with a message naming it.
- **Author's PC:** install Blender 5.2.1 LTS and a Python 3.11+ with `pip install pillow numpy`; pass
  `--blender "%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe"` (or wherever it is). Each step is a fresh
  `blender -b --factory-startup --python-exit-code 1` process.
- **Cloud:** no Blender executable; the `bpy` module from PyPI is Blender 5.2.1 as a Python 3.13 package. A fresh
  session has neither bpy nor the EGL libraries (the session hook installs only the npm dependencies, on purpose), so
  **run `bash tools/asset-pipeline/setup-cloud.sh` once per cloud session, before any Blender step.** It installs
  `libegl1` and `libegl-mesa0` when missing (EEVEE renders, `sample`, `production` and `painted/run.py`, need EGL for
  Mesa's software OpenGL; Cycles, the C-50 review renders, does not), creates a venv with `bpy==5.2.1`, Pillow and
  numpy outside the repository (`~/.cache/terepasztal/bpy-env`; an argument or `BPY_ENV` picks another path) and prints
  its Python on stdout (progress goes to stderr). A second run changes and downloads nothing. It exits 1 with the
  reason when Python 3.13 is missing (bpy 5.2 has wheels for 3.13 only; `BPY_PYTHON=<python3.13>` points it at one),
  or when the EGL packages or the venv cannot be installed.
  `blender_runner` does not look for that Python: a step runs in whichever Python you start it with, through
  `import bpy`, after a factory reset. So start every command with the printed Python and leave `--blender` out:
  `PY=$(bash tools/asset-pipeline/setup-cloud.sh)`, then `$PY tools/asset-pipeline/blender_runner.py <script>` or
  `$PY tools/asset-pipeline/handbuilt/run.py <stage> <project.json>`. A Python without bpy stops with "No Blender".
- **Render device:** EEVEE uses whatever OpenGL the process has. The C-50 build's Cycles review renders take
  `--device cpu` (default) or `cuda`/`optix`/`hip`/`oneapi`/`metal`; a missing GPU stops the build, it never falls
  back silently.
- **Speed in the cloud (4 CPU cores, no GPU):** a C-50 or SW1 build takes under a minute. EEVEE compiles shaders for
  about 2.5 minutes per process and takes about 70 s per 1024 px frame: the SW1 `sample` (24 frames, rendered twice)
  took 42 minutes of CPU, 105 minutes on the shared machine, and a `production` set (96 headings x 8 wheel phases)
  would take many hours. Render production on the PC.

### Stages, what they read and write
Paths in a project are relative with forward slashes; text inputs are hashed with CRLF read as LF (`filehash.py`), so
one lock holds on the PC's checkout and in the cloud. `handbuilt/run.py` takes `--blender <exe>` on every Blender stage.

| Command (from the repository root) | Blender | Reads | Writes |
|---|---|---|---|
| `python tools/asset-pipeline/handbuilt/run.py init --id <id> --images <png...> --out <project>` | no | the pictures | a new `<project>/`: `references/NN.png`, `project.json`, `observations.json` (empty), `build.py` (unauthored template), `c50_primitives.py`, `style.json` (`c50-lighter-v2`), `.gitignore` |
| `run.py lock <project>/project.json` | no | `project.json`, recipe, helpers, style, observations, pictures, `handbuilt/run.py`, `handbuilt/build_stage.py` | `recipe-lock.json` |
| `run.py build <project.json>` | yes | the locked inputs; stops if the lock is stale | `<project>/model/`: `<part>.blend`, `candidate.json` (the renderer's manifest), `calibration.json`, `validation.json`, `build-receipt.json`, `build.log`; skipped while the receipt still matches |
| `run.py verify <project.json>` | yes | the project and its built `model/` | replays the recipe into `.verification/construction-repeat/`, compares (topology, names, materials equal; coordinates within 1e-6) and writes `construction-repeat.json` |
| `run.py sample <project.json>` | yes | build, then `model/candidate.json` | `sample/<id>/<key>/`: 4 headings x 2 wheel phases, rendered twice and compared pixel by pixel; not installable |
| `run.py production <project.json>` | yes | build, then `model/candidate.json` | `production/<id>/<key>/`: frames for 96 headings x 8 wheel phases, `atlas/rolling-painted-N.png\|json` (`partial`, `resolution` 4), `fit-patch.json`, `report.json`, `inputs.json`, `receipt.json`, `preview-N.png` |
| `run.py all <project.json>` | yes | | build, sample, production |
| `python tools/asset-pipeline/painted/run.py <manifest...> --out <dir> [--sample] [--verify-repeat] [--force]` | yes | a manifest (`painted/manifests/c50.json`, a project's `model/candidate.json`), its `.blend` parts, profile and locked reference | `<dir>/<id>/<key>/` as `production` |
| `python tools/asset-pipeline/blender_runner.py [--blender <exe>] assets/source/c50-handbuilt-2026-10-07/build.py [--out <dir>] [--device cpu] [--resolution-percent 100] [--samples 32]` | yes | the C-50 recipe | `c50-handbuilt.blend`, `.glb`, six review PNGs and `validation.json` in `<dir>` (default: the recipe's own folder) |
| `handbuilt/install.py <project.json> --game <checkout>`, `painted/install.py <bundle> --game <checkout> [--apply]` | | a production bundle | a playtest checkout's `public/assets/rolling*.png\|json`, `src/data/gear.json`, `src/data/locoFit.json`, with backups |

Outputs under `sample/`, `production/` and `.verification/` stay out of git (the project's `.gitignore`); `model/`
is committed. The installers target a playtest checkout: develop has no `gear.json`, `locoFit.json` or dense-heading
renderer yet, so they refuse it. The atlas pages carry `rolling/loco_<id>_<part>_w<phase>_f<heading>`,
`..._f<heading>` and `..._lit_f<heading>` for 96 headings, where develop's game draws `FACINGS = 48`
(`src/sim/body.ts`); nothing here writes into `public/assets/`, and bringing these sprites into the game is #278.

### Sources on develop
- `assets/source/c50-handbuilt-2026-10-07/`: the accepted C-50 (`build.py`, `.blend`, `.glb`, review PNGs,
  `validation.json`, `observations.json`); its reference picture and the CC BY-SA 4.0 credit are in
  `assets/source/c50-regenerated-2026-10-07/`.
- `assets/source/sw1-picture-v4-2026-10-08/`: the accepted SW1 project (`project.json`, `build.py`, pictures, lock,
  committed `model/`).

### Tests
- `npm test` runs `handbuilt-method.test.mjs`: the runner, handbuilt and painted unit tests in Python (`PYTHON`, else
  `python3`/`python`; tests that need Pillow skip and say so without it) and a check that no shipped text file holds
  an absolute Windows path outside a README's History section. The same Python tests by hand:
  `python -m unittest discover -s tools/asset-pipeline -p test_blender_runner.py`,
  `... -s tools/asset-pipeline/handbuilt -p 'test_*.py'`, and `cd tools/asset-pipeline/painted && python -m unittest test_pipeline`.
- Blender checks, by hand: `$PY -m unittest discover -s tools/asset-pipeline -p 'test_blender_*.py' -v`, with `$PY` the
  Python `setup-cloud.sh` printed (or `BLENDER=<blender executable> python ...` on the PC); `-k rebuilds_to` runs the
  two rebuilds and leaves out the 42-minute sample. They rebuild the C-50 and SW1 v4 in temporary folders and
  compare with the committed `validation.json` / `calibration.json` (numbers within 1e-6, mesh and wheel pivot counts
  equal), replay the SW1 against its committed model, and render the SW1 sample twice. Without Blender 5.2.x each
  check is skipped with the reason.
- Changing `handbuilt/run.py` or `handbuilt/build_stage.py` unlocks every project: rebuild the SW1 v4, check it, then
  `run.py lock` it again; `test_recipe.py` fails until then.

## ComfyUI pipeline

### Run
- `python run.py` : all assets in `assets.csv`, stages comfy -> blender -> post -> game. Stops at the first error, exit code 1.
- `python run.py --only id1,id2 --stages blender,post,game --force` : redo selected stages.
- Finished stages are skipped on rerun (raw GLB / meta JSON exist) unless `--force`.
- Requirements: Python 3.11+, `pip install pillow numpy`, Blender 4.2+ (tested 5.0), ComfyUI Desktop running with the API
  workflow, Node (the game stage runs `tools/pack-atlas.mjs`).
- The game stage always re-exports and re-packs; it has no skip. It touches only assets with a `game_frame`.

### Files
| Path | Role |
|---|---|
| `ASTRA.md` | the brief for Astra, the image model that makes the input images: rules, prompt template, shot list |
| `pipeline.toml` | all settings: paths, ComfyUI URL, grid, render, class rules |
| `assets.csv` | one row per asset: id, image, category (vehicle/bogie/building), size_tiles, length_m, width_m, height_m, align (auto/none), yaw_offset_deg, plan, split_m, clip_below_m, anchor_offset_m, length_factor, game_frame; `game_rules.test.mjs` checks its bogie rows against the styles in `src/data` |
| `workflows/image_to_3d_api.json` | ComfyUI workflow in API format (ComfyUI: Workflow -> Export (API)). UI-format JSON is rejected. |
| `run.py` | orchestrator, CSV validation, logging, summary |
| `comfy_client.py` | ComfyUI HTTP API: upload, patch graph, queue, poll history, download GLB |
| `blender_stage.py` | runs inside Blender via `blender -b --factory-startup --python-exit-code 1 -P blender_stage.py -- job.json` |
| `postprocess.py` | premultiplied box downsample, optional hard alpha / palette, atlas + JSON, preview sheet |
| `game_rules.py` | the game's facings, sizes, body plans, `DRAWN_WIDTH` and atlas groups; `game_rules.test.mjs` holds it to `src/sim/body.ts` |
| `export_game.py` | game stage: sprites -> `art-src/<group>/` frames + anchors, then `tools/pack-atlas.mjs` -> `public/assets/<group>.png\|json` |
| `blender_runner.py` | hand-built method: runs a Blender step on a 5.2.x executable (`--blender`) or the bpy module; `test_blender_runner.py` |
| `setup-cloud.sh` | hand-built method, cloud only: installs the EGL packages and a venv with `bpy==5.2.1` outside the repository, prints its Python; run once per session before any Blender step |
| `filehash.py` | hand-built method: line-ending independent SHA-256 for locks, receipts and manifests |
| `handbuilt/` | hand-built method: `run.py` (init/lock/build/verify/sample/production/all), `build_stage.py`, `verify_construction.py`, `model_report.py`, `c50_primitives.py`, `recipe_template.py`, `install.py`, `test_recipe.py`, `README.md` |
| `painted/` | hand-built method's renderer: `run.py`, `render.py` (in Blender), `reference.py`, `install.py`, `manifests/`, `profiles/`, `test_pipeline.py`, `README.md` |
| `handbuilt-method.test.mjs`, `test_blender_builds.py` | the method's tests in `npm test`, and its Blender checks |

Outputs under `assets_out/`: `models_raw/<id>.glb`, `jobs/<id>.json`, `meta/<id>.json`, `sprites_raw/`, `sprites/<id>/<id>[_<part>]_d<i>.png`, `atlas/<id>.png|json`, `previews/<id>.png`, `debug/`, `logs/run_*.log`, `logs/<id>_blender.log`, `reports/summary.json`. The game stage writes outside it, into the repo:
`art-src/<group>/<frame>.png` + `atlas.json`, and `public/assets/<group>.png|json`.

### Inspecting state (do this after every run)
1. `reports/summary.json` : status, error, tiles, dims, compression, warnings per asset.
2. `previews/<id>.png` : read the image. Top rows, one per part: every direction on a checkerboard with the footprint (yellow)
   and anchor (red cross). Bottom row: raw_front (pose as generated), aligned_front (-Y), aligned_side (+X), aligned_top, and
   for a vehicle parts_front (the rendered parts side by side, nose on the right).
   Check: upright, long axis on X, object inside its footprint, shadow inside canvas, cuts on the joints.
3. `logs/<id>_blender.log` : full Blender output; `[blender]` lines carry align angles, scale, tiles.
4. ComfyUI live state. ComfyUI Desktop serves http://127.0.0.1:8000 (Settings -> Server-Config); a manual install uses 8188.
   - `curl -s $URL/queue` running/pending prompts
   - `curl -s $URL/history/<prompt_id>` status, outputs, `execution_error` with node id/type/message
   - `curl -s $URL/object_info/<NodeClass>` input names and allowed values for a node
   - `curl -s $URL/system_stats` versions, VRAM
   - `curl -s -X POST $URL/interrupt` stop the running prompt
   - The Logs tab of ComfyUI Desktop's bottom panel, and its log files under `%APPDATA%\ComfyUI\logs`, hold the Python
     tracebacks the API truncates.
5. Blender interactive (optional): open `models_raw/<id>.glb`, viewport shading must be Material Preview or Rendered; Solid mode shows white.

### Conventions
- Blender world: Z up, 1 unit = 1 m. Asset front: vehicle nose toward +X, building long side toward -Y. `length_m` is always the X extent.
- Raw Pixal3D meshes are in the input photo's camera frame (camera at -Y, +Z up), so they carry the photo's tilt and yaw; the Manhattan alignment removes it. TRELLIS.2 meshes are near-canonical.
- Alignment ambiguity: the long axis goes to X; the remaining 180-degree flip is guessed from the photo view. Wrong flip -> `yaw_offset_deg = 180`. Non-boxy mesh (score < `align.min_score`) -> `align = none` and set `yaw_offset_deg` by hand.
  A cut vehicle with a blank `yaw_offset_deg` also tries the other end and keeps the one whose joints fit the plan better
  (warning "turned round"); any number there, 0 included, is kept as given.
- Camera: orthographic, elevation 30, azimuth 45 (rotation 60, 0, 45). World +X projects to screen lower-right, +Y upper-right.
- Pixel density `px_per_m = tile_px / (tile_m * sqrt(2))` is identical for every asset. `tile_px = 64` is the game's
  `TILE_W` (`src/engine/iso.ts`, `64 * ART_SCALE` where a branch has it); `game_rules.test.mjs` fails when they differ.
- Buildings: direction i = heading i*360/dirs degrees counter-clockwise from +X seen from above, 4 dirs.
- Vehicles: `dirs = "game"` renders the game's 25 drawn facings (`src/sim/body.ts`: `FACINGS = 48`, `DRAWN_FACINGS`),
  facing f at yaw -7.5 f degrees, because game tile +ty is Blender -Y. Facing 0 points screen down-right. The renderer
  mirrors the other 23. `screen_heading` in the atlas JSON gives the on-screen unit vector of the nose.
- Anchor: ground center of the footprint (of a cut part: its own centre on the track), continuous pixel coords from the
  sprite's top-left.
- Vehicles: height at real scale, width x `DRAWN_WIDTH` (1.3, as the game's own sprites), length compressed into
  `size_tiles * tile_m - coupler_gap_m`; factor outside `compress_range` is an error. The game's bodies are 1, 2 or 3 tiles.
- Body plans (`plan`, default rigid) follow `src/sim/body.ts`: size 2 takes `tender` (engine 1.25 + tender 0.75 tiles),
  size 3 `garratt` (engine 0.8 + cradle 1.4 + engine 0.8) or `meyer` (one frame on engine-unit bogies). The model is cut
  across X into the plan's segments and each part compressed into its own slot. Cuts go to the lowest point of the side
  silhouette within 12% of the length of where the plan's proportions put them; `split_m` (metres from the nose, `;`
  between cuts) overrides. A Garratt's rear engine unit is cut off and not rendered: the game draws the front one reversed.
- `clip_below_m` cuts away everything below that height, the model's own running gear, for medium and large vehicles:
  the game draws their bogies as separate sprites under the body. The body keeps its height above the rail. One height,
  or one per rendered part front to back (`2.1;1.1`: an engine above its driving wheels, its tender above its bogies).
- Bogies (`category = bogie`): real length x `length_factor` (the row's, else `classes.bogie.length_factor`; use the
  compression of the vehicles it rides under), width x `DRAWN_WIDTH`, 25 facings. `anchor_offset_m` draws the group
  that far ahead of the pivot the game hangs it at: a steam driver set sits well ahead of its engine's rear pivot.
  The roster's offsets are starting values; tune them against the game.
- Buildings: height real, footprint compressed uniformly and snapped to whole tiles (`footprint_factor`, `footprint_range`, `fill`).
  With `size_tiles` the footprint is fixed at N x N (game stations 1x1, depots 2x2), allowed down to `sized_footprint_range`,
  and height is compressed by footprint factor ^ `sized_height_exponent` so a crushed footprint does not stand as a tower.

### Game frames
- `game_frame` in `assets.csv` is the frame key the asset replaces; empty = the asset stays out of the game.
  Vehicles need `{f}` (facing), locomotives `{part}` too. A prototype's own sprite, `rolling/loco_<id>_{part}_f{f}` or
  `rolling/wagon_<id>_f{f}` (ids from `src/data`), wins over the shared body sprite
  `rolling/loco_<body>_<size>_<paint>_{part}_f{f}` / `rolling/wagon_<body>_<size>_<paint>_f{f}` that the generators draw.
  A prototype frame is checked against `src/data`: `size_tiles` and `plan` must be the ones the game uses for that id.
  Bogies: `rolling/bogie_<style>_f{f}`, one sprite per style whatever the kind of bogie it stands in for. A vehicle's
  `bogieStyle` in `src/data` is one style for all its bogies, or per body part, where a list goes over that part's
  bogies from its own front: `{"engine": ["leading", "pacific"], "tender": "tender_truck"}`. `"none"` draws no bogie
  (a Garratt's cradle). Anything unstyled keeps the generic `rolling/<kind>_f<n>`. The game turns a styled bogie to
  face its vehicle's own front, reversed or mirrored.
  Buildings take `{r}` for rotation (dir 0 -> r0, dir 1 -> r1), e.g. `structures/depot_r{r}`, or no placeholder for dir 0
  alone, e.g. `structures/station_1`. Keys must match what `src/art/*.ts` emits; the game's debug panel (backtick) lists them.
- `plan` must be the plan the game uses for that body (`plan` in `src/data/locomotives.json`), or the parts are named
  for segments the game never asks for.
- Medium and large vehicles get separate bogie sprites under the body, steam included (the game's own steam bodies
  have no wheels either); without `clip_below_m` a model with its own bogies shows both.
- Group comes from the key: `rolling/loco_*` -> rolling, other `rolling/*` -> wagons, `structures/*` -> structures.
- Every group written is marked `"partial": true`: the game keeps its generator and lays these frames over it.
  `art-src/<group>/atlas.json` records which asset owns each frame; a rerun of the asset replaces its own frames only.
- Check in the game: `npm run dev`, then `game.atlas.groupOrigin` in the browser console reports the group as
  `png+procedural`, and `game.atlas.get("<frame>")` gives its size and anchor.

### Rules for edits
- Never write into `models_raw/` by hand; rerun the comfy stage.
- Keep stage boundaries: comfy produces GLB, blender produces meta + raw renders, post produces final sprites, game copies them into the repo and packs. Each stage must fail loudly (non-zero exit / exception) rather than skip.
- Change behaviour through `pipeline.toml` first; code changes second.
- Workflow input overrides go in `[comfy.set]` as `"<node_id>.<input>" = value`; verify names with `/object_info`.
