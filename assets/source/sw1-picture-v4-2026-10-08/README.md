# SW1 — visible centre tank and four front windows

The SW1 version the owner accepted (`fleet-painted-2026-10-07/approved.json` on the
author's PC: sw1, bundle `12e66cb2e7099846`), as a hand-built project:
`project.json`, the locked pictures in `references/`, `observations.json`, the
recipe `build.py` with the frozen C-50 helpers `c50_primitives.py`, the render
style `style.json`, `recipe-lock.json`, and the model built on the author's PC in
`model/` (three `.blend` parts, `candidate.json`, `calibration.json`,
`validation.json`). `tools/asset-pipeline/handbuilt/README.md` is the method.

## On develop

Commands from the repository root; on the author's PC add `--blender <blender.exe>`
(`tools/asset-pipeline/AGENTS.md` has both setups):

```sh
~/.cache/terepasztal/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py build  assets/source/sw1-picture-v4-2026-10-08/project.json
~/.cache/terepasztal/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py verify assets/source/sw1-picture-v4-2026-10-08/project.json
~/.cache/terepasztal/bpy-env/bin/python tools/asset-pipeline/handbuilt/run.py sample assets/source/sw1-picture-v4-2026-10-08/project.json
```

No build receipt is committed, so the first `build` rebuilds `model/` in place
(same geometry, different `.blend` bytes). `sample/`, `production/` and
`.verification/` are outputs and stay out of git.

Changes made on the way to develop, geometry untouched:
- `project.json` names `references/01.png` with a forward slash (it had a Windows
  backslash), and `build.py` writes paths relative to `model/` and hashes the
  observations and helpers with CRLF read as LF. `model/candidate.json` and
  `model/validation.json` are rewritten the same way; the `.blend` hashes in them
  are the author's.
- `recipe-lock.json` is relocked for these files and the develop pipeline.
- `construction-repeat.json` is the replay made in the cloud on 2026-10-11 against
  the author's `model/`: 326 body meshes and 57 per bogie, the same names,
  topology and materials, every coordinate within 1.2e-7 (float rounding between
  the PC's and the cloud's builds of Blender 5.2.1), calibration identical.
  The author's own replay matched its build exactly.

Built from develop in the cloud on 2026-10-11 (bpy 5.2.1): `calibration.json` and
`validation.json` byte-identical to `model/`. `run.py sample` on a fresh copy then
rendered sample `4c4fba7c2dfb591a` twice with identical pixels (24 frames, phase
drift 0; EEVEE on Mesa's software OpenGL). `tools/asset-pipeline/test_blender_builds.py`
repeats the build, the replay and the two-run sample check.

Left on the backup branch `backup/c-users-zso-terepasztal-local-wip`: the
`sample/` and `production/` renders (85 MB), `.verification/`, the review views
and the scripts that made them (`orthographic.py`, `review.py`, `gallery.py`),
the playtest install record and runtime backups (`installed.json`,
`runtime-before/`, `fleet-registry-before.json`) and the build receipt.

## History (from the author's PC)

Owner correction: the tank was visible in the orthographic side view but hidden
in game, and the cab front must have four windows, not five. Otherwise preserve v3.

The tank was too narrow/high behind the near chassis beam at the game camera
angle. Its width is now2.10 model units instead1.36; final centre height0.57
instead0.80; bottom0.20. Length stays2.10. This exposes the side below the walkway
without changing the model's length or wheel gauge. Four front panes replace the
five-pane row, with updated borders/reflections and generated window-light masks.

Original picture is references/01.png. The owner's annotated correction is saved
as references/02-owner-correction.png and hash-locked in project.json. The blue
circle is an annotation, not a livery input. Window count in observations.json
has been corrected. Recipe assertions guard the four-pane count and tank placement.

Both bogies' evaluated geometry/material hashes match v3 exactly. Shared pipeline,
style and all other locomotives are unchanged. Sample89641d4efaf9d6fb rendered
twice with identical pixels; fresh construction replay also matches.

Status: complete; stopped for owner review. Installed production bundle `12e66cb2e7099846`.

Verified actual game tank visibility, four front panes and night lighting, 32 curve
frames, reverse view and stationary freeze. Game tests: 329 passed; build/typecheck
passed. Other locomotives, both bogies and calibration remain unchanged.

Preview: http://localhost:5182/scratchpad/models/handover-review/page/sw1-picture-v4.html
