# SW1 — third picture-based pass

Owner requested one more pass on SW1 only, then the same pipeline Markdown.
Only references/01.png determines appearance. The preceding picture-authored
recipe is refined; no game mesh or fit/gear table is a construction input.
The pipeline and C50 shading profile are unchanged.

Visible differences addressed:
- Cast sideframes now have actual rounded openings and visible spring leaves,
  farther outboard under the walkway. Axle spacing increases from1.32 to1.80
  model units; rail-contact gauge is unchanged. Sprung body clearance increases
  by0.18, while pilots, couplers and steps retain low ground positions.
- Five taller front cab panes follow the roof arch, with a filled gable behind
  them. Side panes are adjusted and receive restrained painted reflections.
- Fan housings/spokes are dark rather than bright silver. Bell skirt uses a
  curved profile. The front lamp has a larger housing/rim/lens and matching anchor.
- Hood cover joins and subdued panel hinges follow the visible panel layout.

The above dimensions fit the illustration; they are not prototype measurements.
Hidden-side symmetry and omitted rear detail remain explicitly documented in
observations.json. Previous candidates remain available for comparison.

Replay from the source repository root:

```powershell
& 'G:/DEV/Terepasztal/train-sizes/.venv/Scripts/python.exe' tools/asset-pipeline/handbuilt/run.py all assets/source/sw1-picture-v3-2026-10-08/project.json --blender 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
```

The same pipeline guide remains `tools/asset-pipeline/handbuilt/README.md`.
Status: complete candidate, installed and stopped for owner review. Verified
sample 0c6154a3fab15280; production bundle250421a21cdd25a8. A fresh construction
replay matched geometry/materials/parenting/calibration (329 body meshes and57
per bogie). Repeated sample pixels match. Game checks include all96 directions,
eight wheel phases, stationary freeze,32 reviewed curve frames, reverse, close-up,
night windows/lamp and C50 comparison. All329 game tests and build/typecheck pass.
Registry, gear and fit data for every other locomotive were verified unchanged.
The shared pipeline Markdown/code/style was not changed in this pass.

Review: http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v3.html
The11 gallery images were HTTP-checked, and a mirror is saved at
`G:/DEV/Terepasztal/renders/engine-models/sw1-picture-v3.html`.
