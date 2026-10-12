# C-50 Blender rebuild, 2026-10-07

Owner accepted rebuilding the selected reference with simple precise Blender
geometry after rejecting the ComfyUI result. `build.py` constructs an entirely
new editable model; it does not modify or reshape any earlier GLB.

Reference: ../c50-regenerated-2026-10-07/c50-reference-v2.png. Photo sources,
attribution and the generation prompts are retained in that folder's README.
Keep those reference credits with this interpretation (CC BY-SA 4.0).

## Deliverables

- c50-handbuilt.blend: editable, named components, materials, lights and camera.
- c50-handbuilt.glb: exported model with bevels and normals applied.
- front/rear/side/front-end/rear-end/top.png: six rendered review views.
- validation.json: equal hood widths, straight longitudinal alignment, wheel
  pivot count and component count.
- build.py: repeatable Blender construction and export.
- observations.json: what the reference picture shows and what was inferred,
  recorded on 2026-10-11 from this README and the reference folder's; the
  painted renderer's C-50 manifest locks it with the picture.

All of these came from the author's PC (backup branch
`backup/c-users-zso-terepasztal-local-wip`). Left on that branch: publish.py
(reference comparison and preview-page publication on the local review server),
render-sprites.py and render-sprites-before-shading.py (the standalone sprite
renderer, replaced by `tools/asset-pipeline/painted/`), before-two-windows/,
the preview and sprite folders, and the `.blend1` backup.

## Rebuild

`build.py` needs Blender 5.2.x and runs through the pipeline's Blender runner,
from the repository root (`tools/asset-pipeline/AGENTS.md` has the setup):

```sh
# cloud: the Python with bpy 5.2.1, CPU renders
~/bpy-env/bin/python tools/asset-pipeline/blender_runner.py assets/source/c50-handbuilt-2026-10-07/build.py
# author's PC: Blender 5.2 executable, review renders on the CUDA GPU
python tools/asset-pipeline/blender_runner.py --blender <blender.exe> assets/source/c50-handbuilt-2026-10-07/build.py --device cuda
```

Options after the script: `--out <dir>` (default: this folder, which overwrites
the committed files), `--device cpu|cuda|optix|hip|oneapi|metal` (Cycles device
for the six review renders, default `cpu`; a missing GPU stops the build),
`--resolution-percent` (default 100, 1100x900) and `--samples` (default 32).
The geometry, `.blend`, `.glb` and `validation.json` do not depend on them.

The committed `.blend` is the author's file, unchanged, so the hash locked in the
renderer's manifest still holds. Inside its compressed data it keeps two folders
of the author's PC (the output path of its first review render and a Documents
folder); no step reads them. `build.py` now saves the render path as `//`, so a
rebuilt `.blend` holds no folder of the machine that built it.

Built in the cloud on 2026-10-11 (bpy 5.2.1, CPU, 10% renders, 30 s):
`validation.json` byte-identical to the one here, the same 294 objects (286
meshes, 4 wheel pivots) and every coordinate within 1.3e-7 of this `.blend`.
`tools/asset-pipeline/test_blender_builds.py` repeats the check.

Both hoods are 1.37 units wide. Deck width is 1.9008, cab width 1.7064 (both +8% at owner request). Central cab
length 1.72, each hood length 1.35; these are modeled proportions from the image,
not a certified dimensioned prototype drawing. Wheels have radius .43 and are
grouped under four independent axle-aligned pivots. Stationary chassis is separate.

Clean charcoal/red materials, opaque blue glazing with diagonal highlights,
rounded panels, pressed louvres, radiator, lamp housings, handles, hinges, steps,
couplers and wheel details replace the reconstructed lumpy surfaces. Small
fittings and shading remain simplified relative to the illustration. No projected
texture patches or invented pipes on the far-side cab.

The accepted model is now integrated into the playtest game atlas with travel-driven wheel animation and matched game scale.

Review: http://localhost:5182/scratchpad/models/handover-review/page/#c50-handbuilt

Latest correction: two individually framed front windows AND two rear windows.
Cab, roof and chassis widened transversely by 8%, maintaining parallel edges;
hood widths and running gear unchanged. Earlier version saved in before-two-windows/.


## History (from the author's PC)

Kept as written in the author's local checkout. The playtest atlas it describes
is not part of develop; the painted renderer's `manifests/c50.json` renders this
model for the game (#278).

### Game sprite integration (completed)

render-sprites.py uses the accepted scene with uniform scale to the existing C-50
longitudinal footprint (0.8239 tiles), 2:1 game camera and 4 texels/logical pixel.
96 headings x 8 complete-vehicle wheel phases. Five wheel recesses repeat every
72 degrees; the distance cycle is calculated from the scaled .43-unit radius.
Shared ground-centre anchors and complete-vehicle renders prevent layer sliding.
The initial flat-emission trial was too flat beside the fleet; final renders keep
the accepted painted materials, use camera-relative soft studio lights and 2x
supersampling. No body proportion edits in this integration step.

The exporter installs rolling-5 in terepasztal-playtest only, preserves other
locomotive images, and records integrated wheel metadata plus measured lamp and
exhaust positions. The previous atlas is backed up at playtest
scratchpad/models/handover-review/c50-handbuilt-game/before-atlas/.


### 2026-10-07: accepted handbuilt C-50 game sprites completed

Installed in terepasztal-playtest only: public/assets/rolling-5.png/json and
src/data/locoFit.json. Approved body proportions preserved, uniform scale
0.9408552844 fits 0.8239 tiles. Final renderer uses EEVEE, accepted painted
materials, camera-relative soft lights, 2x supersampling and the game 2:1 camera.
96 headings x 8 integrated wheel phases (768 renders; 864 atlas entries including
static aliases), atlas 4096x2931. Wheel cycle 0.0815380229 tiles. No wheel overlay.
Camera depth now explicitly checked; corrected a far-plane clipping issue before
rerendering the entire final set. All phase alpha bounds have 0px drift.

Visually reviewed all 96 headings, 24 front + 24 reversed-display route poses,
and 48 wheel-animation captures. Wheel capture verifies movement-driven phase
changes, frozen phase at rest and no overlay. Fleet screenshot compares C-50,
Black Five, DRG01 and Daylight at common zoom on respective gauges.
An optional night diagnostic was black and excluded from the review; night
appearance is not claimed verified by this capture.

Pipeline tests: 196 passed; game tests: 327 passed; production build and locoFit
format check passed. Existing large bundle warning remains. Main checkout
untouched; no commit/push/merge. Reproduction: render-sprites.py and sprites.json
in assets/source/c50-handbuilt-2026-10-07, then tools/asset-pipeline/export_rigid_stock.py.
Game captures and builder: scratchpad/models/handover-review/capture-handbuilt-*.mjs
and build-handbuilt-game-review.py in playtest. Review:
http://localhost:5182/scratchpad/models/handover-review/page/#c50-in-game
Also mirrored to G:/DEV/Terepasztal/renders/engine-models/index.html.


#### Follow-up: game-matched shading

User requested stronger shading to fit the environment. render-sprites.py now
applies matte render-time materials (roughness .78, specular .22, metallic capped
at .18), removes paint self-emission, adds subtle procedural paint tone variation
and local ambient occlusion, and reduces fill/rim light with warm light color.
Approved source geometry and dimensions are preserved. Shader changes occur in
the sprite render scene; editable source blend remains the accepted shape.
Previous shader script retained as render-sprites-before-shading.py. Previous
in-game close-up/fleet captures: playtest c50-handbuilt-game/before-shading/.
Full shaded set is being rerendered; final verification recorded below.


Shading follow-up completed: all 768 frames rerendered and exported to the playtest
atlas. Updated fleet/close-up, wheel animation and both route-orientation captures.
No browser errors; movement/stop wheel assertions pass; phase bounds drift 0px.
Before/after comparison published at #c50-in-game. Geometry unchanged.
