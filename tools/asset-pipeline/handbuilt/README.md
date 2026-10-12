# PNG → C-50-method locomotive → repeatable sprites

Owner method, 2026-10-08. Shape and livery come only from the supplied PNG(s).
Build clean editable primitives using the frozen C50 helper code. No game model,
game fit/gear table, image-reconstructed mesh, half-mesh mirror, or deformed old
sprite is a geometry source. The game is a downstream inspection target only.

## What is and is not automatic

The new locomotive's recipe must first be authored by inspecting its PNG(s).
This is the same handbuilt modelling process used for the accepted C50 and SW1;
it is not a claim that a single illustration determines hidden 3D geometry.
Once the picture-specific recipe is saved, one command builds and renders it.
The same command and stages apply to every locomotive; the shape recipe changes.
There is deliberately no generic guessed locomotive emitted for a new picture.

## Where it runs

Every Blender step needs Blender 5.2.x and goes through `../blender_runner.py`;
`../AGENTS.md` ("The hand-built method") has the setup for both machines and the
table of what each stage reads and writes.

- **Author's PC:** a Python 3.11+ with Pillow and numpy, and `--blender <blender.exe>`
  on every command that builds or renders.
- **Cloud:** `~/bpy-env/bin/python` (Python 3.13 with `bpy==5.2.1`, Pillow, numpy)
  and no `--blender`; each step runs in that Python through `import bpy`.

The commands below are written for the cloud. On the PC use your Python and add
`--blender "%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe"` (or the
Blender you have) to `build`, `verify`, `sample`, `production`, `all` and `install.py`.

## Start another locomotive

From the repository root:

```sh
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py init --id new_loco \
  --images <front.png> <side.png> --out assets/source/new-loco-reference
```

This copies the pictures into a self-contained project as PNGs, preserving their
original file hashes, and saves the actual C50 primitive helpers and current
`c50-lighter-v2` style. It creates `project.json`, `observations.json`, an
intentionally unfinished `build.py` and a `.gitignore` for the render outputs.
JPEG input is also accepted and converted without changing its decoded pixels.
No old locomotive geometry is copied. `init` (Pillow) and `lock` need no Blender.

1. Inspect every PNG. Record visible components, silhouette/proportions, colours,
   window counts, wheel/bogie layout and evidence regions in `observations.json`.
   Regions are normalized `[left, top, right, bottom]` image bounds.
2. Record necessary assumptions separately under `inferred`; list unsupported
   details under `omitted`. No unseen lamps, windows, badges, pipes or decorations.
   A missing rear view is not permission to invent a rear livery.
3. Author `build.py` with the frozen `c50_primitives.py` helpers. Keep body axes
   parallel, left/right widths explicit, and source dimensions independent of
   runtime tables. Use neutral minimal closures for unknown hidden structure.
   Consult the completed SW1 recipe for the file/animation contract, **not** as a
   body-shape template for another locomotive. Steam, Garratt and other layouts
   require their own image-authored component arrangements.
4. Set the known track gauge in `project.json`. Gauge is an output compatibility
   constraint; never use runtime fit tables to choose body shape.
5. Lock and render a sample. Inspect reference beside render, and top/side/end
   views, before rendering the full set. Correct the recipe then explicitly lock
   it again. A lock means reproducible inputs, not owner approval.

```sh
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py lock assets/source/new-loco-reference/project.json
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py sample assets/source/new-loco-reference/project.json
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py production assets/source/new-loco-reference/project.json
```

For an already authored/reviewed recipe, **one-command replay**:

```sh
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py all assets/source/sw1-picture-v4-2026-10-08/project.json
```

`all` builds, performs a two-run pixel-identical sample check, then renders
the full production sprites. `build` only constructs the Blender models.
Samples have four headings and two wheel phases; production has 96 headings and
eight wheel phases, explicit window masks, measured lamp anchors and full bogies.
The frozen render profile uses the accepted lighter C50 shading and no cast
shadow. Shadows remain a separate game concern. In the cloud EEVEE runs on Mesa's
software OpenGL: the SW1 sample took 42 CPU minutes (105 on the shared machine),
production would take many hours; render production on the PC.

## Recipe output contract

The recipe receives `PROJECT`, `PROJECT_ROOT`, and `OUTPUT` globals in Blender.
Write `<part>.blend`, `candidate.json` and `calibration.json` into OUTPUT.
The manifest follows `../painted/README.md`, with PNG reference authority,
hash-locked observations and pictures, and `prepared_sources` bound to each blend.
Write every path in it relative to OUTPUT with forward slashes, and hash text
files with CRLF read as LF (see the SW1 recipe's `rel` and `text_sha`), so the
model folder is the same on every machine.
Keep +X forward, Z up, ground at Z=0; complete truck groups are separate parts
with wheel pivots. Body windows use explicit glass materials and lamp coordinates
come from the actual authored lens. Do not project the illustration onto a mesh.

The complete worked example is
`assets/source/sw1-picture-v4-2026-10-08/build.py`. Its observations include
the image evidence for the SW1 refinements and every remaining hidden-side
assumption. Its `project.json` and reference PNG contain no workbook dependency.

## Reproducibility and delivery

`recipe-lock.json` locks images, observations, construction code, helpers, style
and construction runner (`run.py`, `build_stage.py`). A changed file fails until
explicitly reviewed/relocked. Text files are hashed with CRLF read as LF, so a
lock made in the cloud holds on a Windows checkout and the other way round.
Build receipts verify all output hashes; changed/missing output rebuilds. The
Blender release and build hash participate in the build key, whether Blender is
an executable or the bpy module. Blender serialization differs between machines,
so `.blend` bytes are not compared across machines; geometry is. The visual
guarantee is tested pixel equality with a frozen model, style, Blender
version/GPU environment. Cross-driver equality is not promised. The painted
renderer independently locks its source and verifies output receipts.

Construction can be replayed into a separate diagnostic directory:

```sh
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py verify assets/source/sw1-picture-v4-2026-10-08/project.json
```

This compares evaluated geometry, transforms, parenting, materials and calibration
against the built model, rejects empty scenes and writes `construction-repeat.json`.
Names, topology and materials must match exactly, coordinates within 1e-6 model
units: the cloud's build of the SW1 differs from the PC's by about 1e-7, float
rounding between the two platforms. It does not overwrite the production models.
`model_report.py` counts and measures the objects of built blends for comparisons.

Installation is deliberately separate from construction. The shared installer
applies a verified production bundle and its reference-authored calibration:

```sh
~/bpy-env/bin/python tools/asset-pipeline/handbuilt/install.py assets/source/sw1-picture-v4-2026-10-08/project.json --game <playtest checkout>
```

It needs a checkout with the playtest runtime (`src/data/gear.json`,
`src/data/locoFit.json`, dense headings and integrated wheels); develop has none
yet and is refused. It rejects samples, backs up atlas/calibration and writes
`installed.json`. It reads game tables only to merge the chosen locomotive's
output; they cannot influence construction. Format changed runtime JSON
afterwards. Review straight/curve/reverse, wheel motion, stationary freeze, night
lights and scale beside an accepted train. Stop at the owner's requested review
boundary. Save status in `assets/source/base-v1/RESUME.md`.

Boundary checks:

```sh
python -m unittest discover -s tools/asset-pipeline/handbuilt -p 'test_*.py'
npm test
~/bpy-env/bin/python -m unittest discover -s tools/asset-pipeline -p 'test_blender_*.py' -v
```

The last one is the Blender check (see `../AGENTS.md`); without Blender 5.2.x it
skips and says why.
