# Approved painted locomotive pipeline

For the current complete PNG-to-authored-model workflow and one-command replay,
start with [../handbuilt/README.md](../handbuilt/README.md). This folder is the
shared deterministic rendering stage, not a source of locomotive geometry.

## Current construction method — owner correction, 2026-10-08

New locomotive geometry follows the handbuilt C-50 method, not the reconstructed
fleet meshes. Build fresh editable primitives from the workbook image, with
parallel longitudinal edges and explicit component widths; author windows, lamps,
panels and complete animated bogies. The SW1 recipe at
`assets/source/sw1-handbuilt-2026-10-08/build.py` reuses the C-50's actual modelling
helpers and `c50-lighter-v2.json` profile. Review geometry before production.
Earlier image-reconstruction preparation is historical only; a shader or a
transverse mesh deformation is not an equivalent implementation of this method.

The original C-50 shading is frozen in `profiles/c50-approved-v1.json`; the
current owner-requested lighter C-50 and handbuilt SW1 use `c50-lighter-v2.json`.
This pipeline turns **approved, prepared Blender models** into repeatable game
sprites. It does not claim that prompting ComfyUI twice produces the same mesh,
or that a shader can repair wrong proportions. Generation/model construction and
visual approval precede this pipeline. Keep their source reference/licence notes.

## Run

From the repository root, with Python + Pillow and Blender 5.2.1 LTS build
`9e2066aef7ef` (the build that produced the accepted C-50):

```powershell
$py = 'G:/DEV/Terepasztal/train-sizes/.venv/Scripts/python.exe'
$blender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $py tools/asset-pipeline/painted/run.py tools/asset-pipeline/painted/manifests/c50.json --blender $blender --out assets/source/painted-production
```

Pass several manifest paths to process a fleet in stable argument order. Failure
stops the batch. Use `--sample --verify-repeat` first: four headings, two wheel
phases, two fresh Blender processes, pixel equality required. Samples cannot be
installed. `--verify-repeat` without `--sample` verifies every production frame.
`--force` rebuilds instead of accepting a verified cache.

Output: `<out>/<id>/<input-hash>/` with final frames, bounded atlas pages, fit
patch, contact sheets, report, inputs and output checksum receipt. Failed runs
retain a temporary diagnostic folder; they cannot replace the previous bundle.
The cache checks every deliverable hash; edited/missing output is rebuilt. Model,
manifest, style, renderer and runner changes invalidate it. No raw renders are
reused just because their filename exists.

## Determinism boundary

Profile settings include camera, pixel density, colour management, all lights,
paint roughness/specular response, procedural tone variation and contact shadows.
The model hash and exact Blender version/build are locked. Render-time material
edits never overwrite the approved blend. No random seed is sampled by this
pipeline; procedural texture coordinates and wheel phases are fixed.

Pixel repeatability is verified on the tested Blender/GPU/driver environment.
Identical bytes across different graphics drivers/platforms are **not** promised;
use `--verify-repeat` when moving machines. Tiny quantization differences from the
older standalone C-50 script are possible; geometry and alpha remain identical.
Style changes must use a new profile id/file instead of silently redefining v1.

## Prepare another locomotive

Copy `manifests/c50.json`, changing the id and explicit part data:

1. Each part has a self-contained `.blend`: +X forward, Z up, track plane Z=0,
   game attachment/ground centre at origin. Put only that body/engine/tender/
   cradle/bogie's renderable geometry into the file. Preserve its authored
   proportions; the renderer only applies a uniform scale to `length_tiles`.
   Increase `canvas` for large parts; pixel density stays constant.
2. Use Principled materials and pack textures into the blend. Existing base
   colour texture connections are preserved. Make linked libraries local and
   bake simulation geometry. Already shaded illustration textures may need
   an approved material cleanup first to avoid double shading.
3. Set SHA-256 after geometry/material review (`Get-FileHash -Algorithm SHA256`).
   Record each source's provenance alongside the blend.
4. Runtime keys are `loco_<id>_<part>` (body, engine, tender, cradle, frame, etc.)
   or `bogie_<unique-style>`. Body sprites use 96 headings; separate static bogies
   use the existing 48-heading runtime convention. Shared bogie styles affect
   every user of that style, so prefer a per-locomotive style id.
5. Optional `wheel`: `mode: pivots` rotates the named local-Y axle empties.
   Set exact prefix/count, source-unit radius and rotational symmetry (5 for
   five identical holes, 1 for a full revolution). The cycle is computed from
   circumference and uniform scale; **do not copy the C-50 radius to other trains**.
   For rods/linkages use `mode: timeline`, `start`, `period_frames`, `radius`,
   `symmetry: 1` and an authored cyclic action with working constraints. All
   wheels/rods must be part of that animation. Arbitrary unequal wheel diameters
   need an authored synchronized timeline, not the single-radius pivot adapter.
   Omit `wheel` for static parts. Owned trucks use part names such as `body-t0` and the same integrated
   96-heading animation contract as bodies. Shared `bogie_*` animation remains
   unsupported; use a locomotive-owned truck for animated running gear.
6. Optional source-coordinate `effects.smoke` / `effects.lamps` hold `[x,y,z]`.
   Reconstruction manifests use `effects.headlamps`; the exporter accepts this
   alias when `lamps` is absent. Do not silently drop these anchors and allow the
   runtime's generic front-of-engine glow to replace calibrated lamp positions.
   Current smoke runtime has no lateral offset; lamps retain it. Calibrate the
   game body plan, bogie styles and attachment pivots separately; this pipeline
   does not infer them from a silhouette or alter gameplay dimensions.
7. Inspect sample sheets, run the full-frame bounds/anchor/hash gates, inspect
   production views and the in-game fleet/curve/reversal/stop checks. Mechanical part combinations and paint
   readability require visual review for each new model.

All 8 phases share one ground anchor and canvas. Clipped/empty frames fail. Phase
silhouette drift defaults to 0px; an authored rod animation may explicitly set
`max_phase_bounds_drift` after review (anchors still never move).

## Install into the demo

The build itself never changes the game. Installation preserves other sprite
keys and images, reuses available pages and backs up overwritten files:

```powershell
& $py tools/asset-pipeline/painted/install.py <completed-bundle-path> --game C:/Users/Zso/terepasztal-playtest
& $py tools/asset-pipeline/painted/install.py <completed-bundle-path> --game C:/Users/Zso/terepasztal-playtest --apply
```

First command prints a write plan, second applies it. This is a CLI staging
feature, not a requirement to ask the owner again during an authorized task.
The target must already have calibrated `locoFit.json` and dense-heading /
integrated-wheel rendering support. Manifest must include the complete set of
body parts for that locomotive; preserve separate bogie definitions in content.
Install while no other asset writer runs. Caught write failures restore backups;
an OS/process crash during the multi-file install may require restoring the saved
backup under `scratchpad/painted-install-*`. Refresh the game after installation.

## Coverage and tests

C-50 is the approved configured production asset. Other locomotives need their
own prepared model files/manifests; they are not claimed converted by adding this
pipeline. The common style and renderer are shared by every manifest.

`npm test` runs source-lock, cache-integrity, atlas-page/anchor/pixel and safe
installation tests. Actual render repeatability is an explicit Blender check,
not a mocked unit test. Blender runs and output receipts retain the evidence.


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


## Fleet rollout, 2026-10-07

`assets/source/fleet-painted-2026-10-07` contains the per-locomotive source
provenance, prepared packed Blender files, geometry repairs, runtime calibration,
locked manifests, render receipts and review reports for the 28 active engines
other than C-50. See that directory's status files for actual completion; a
prepared candidate is not an installed or visually approved asset.

`profiles/fleet-painted-v1.json` retains the accepted C-50 material, camera and
lighting settings at resolution 2. The approved C-50 remains at resolution 4.
Identical images with identical anchors share atlas pixels. This limits memory
without dropping headings or wheel phases.

`prepare_reference.py` is the only source-preparation entry point. Run in Blender:

```
blender -b --factory-startup --python-exit-code 1 --python tools/asset-pipeline/painted/prepare_reference.py -- reference-spec.json
```

The spec locks the workbook, sheet/row, embedded pictures, appearance guidelines,
original image-reconstruction GLB, conditioning image and mask. Record a visual
comparison between the conditioning image and workbook picture. Author dimensions,
part boundaries and wheel layout from the reference; do not import runtime gear,
fit tables, sprite meshes or old jobs. `batch4/specs` under the fleet source folder
contains worked examples. Image-space window/nose annotations may be reused only
when their source picture matches. Original `models_raw` files remain untouched.

`reference.py` constructs a new allowlisted job, with rigid alignment and uniform
scale, no deperspective, box reshaping, width warping or far-side mesh mirroring.
Rail gauge and camera are technical rendering contracts, not body-shape inputs.
The legacy `prepare_existing.py` command now fails instead of silently importing
old calibrated geometry; it is an internal packed-scene exporter only.

Preparation produces candidate blends, window masks, measured axle calibration,
and a manifest binding each model hash to its picture references. The renderer
rejects missing references and changed reference/model hashes. A provenance lock
is not visual approval: compare each candidate with its workbook pictures before
installation. Derive runtime sockets from the resulting model measurements.

A part may specify `window_mask: {path, sha256}` for source-UV panes, or
`window_materials: ["glazing"]` for named handbuilt glazing materials. The renderer
uses the same camera, mesh and anchor for its additive night overlay. The mask
hash is part of the frozen input contract. The game looks up this static pane
overlay independently of wheel phase.


## Reference-colour revision (owner feedback, 2026-10-07)

`profiles/fleet-reference-v2.json` uses source colour with a shallow normal ramp,
Standard colour management, no AO and no cast/contact shadows. Source illustrations
already contain modelling cues; applying the old high-contrast physical rig again
made the ICE1 nose look dirty. The new profile measured +32.2% mean display luma on
ICE1 facing 0 at matching opaque pixels. Per-model perceived brightness still needs
visual review; this is not a guarantee of precisely +30% for every paint colour.
The original C50 v1 profile remains frozen. The current C50 manifest uses c50-lighter-v2, the owner's requested mild lightening without a separate review; geometry is unchanged.

Shape authority is `G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx`: embedded
pictures and owner guidelines, not the in-game placeholders. Record workbook hash,
sheet/row and reference images for each batch. The GMAM is absent from v8 and needs
its reference resolved with the owner. Latest owner authorization: prepare the next ten locomotives as one batch, then stop for review. Revision evidence: assets/source/fleet-painted-2026-10-07/revision-v2.


## Reviewing reconstructed running gear

A source reconstruction can contain overlapping truck/frame fragments. Do not
accept these merely because preparation succeeds. `rebuild_reference_trucks.py`
builds clean rotating bogies from the reference-authored wheel specification and
measured attachment coordinates. It never imports the runtime gear table. Run it
inside Blender with `-- batch-directory locomotive-id`, then render and inspect
again. Batch4 includes reference-authored handbuilt replacements for the failed
M62 reconstruction and DRG01 tender. These are candidates for owner review, not
automatic approvals or evidence that all reconstructions are accurate.

Supplementary rear colour illustrations must be included in the hashed reference
picture list. The workbook remains shape authority; a rear colour image is not
permission to reuse game geometry. Compare both ends before production. Avoid
changing any renderer/validator/profile/source inputs while a render is running;
the final signature check deliberately rejects a mixed revision.
# Track gauge correction (2026-10-08)

Reference geometry specs use `gauge: "standard"` or `gauge: "narrow"`.
This is a technical track contract: wheel tread centres are +/-0.12 tile for
standard track and +/-0.08 tile for narrow track. Do not hardcode the narrow
0.499m half-gauge for every locomotive. The owner chose a 25% narrower standard
track on 2026-10-08, reducing full gauge from0.32 to0.24tile; narrow remains0.16.
Reference axle fractions and diameters must not be overridden by the mesh's
automatic wheel detector or shrunk to hide overlaps: authored_axles rejects
overlapping wheels. `reference.rail_half_m` is shared by
preparation and the clean truck builder. Unspecified gauge defaults to standard.
The explicit owner-requested batch4 body-width correction is recorded separately
in `assets/source/fleet-painted-2026-10-07/batch4-width-v2`; it is not a new global
deformation default. M62's handbuilt box replacement was rejected: preserve the
reference image reconstruction and fix surfaces without replacing its silhouette.

