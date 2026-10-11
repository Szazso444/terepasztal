# Continue the 2:1 building sprite regeneration

The user explicitly chose the CURRENT GAME GRID: orthographic 2:1 dimetric,
45° azimuth, 30° elevation above horizontal, screen ground slopes ±0.5
(±26.565051°). Do not use true-isometric 35.264° elevation or lower dimetric.

Regenerate and finish all 26 building types, FOUR genuine world-space facings
each (104 sprites). This includes the eight previously generated building types.
Use `manifest.json` for the complete asset list, approved one/two-tile split,
exact ordered reference paths and complete per-facing prompts. Each exact prompt
is also saved separately in `prompts/`; `MASTER-PROMPT.txt` contains common rules.

Latest footprint correction: prefer ONE tile when the original design fits at
the shared human scale. Current reviewed split is 18 compact/vertical one-tile
buildings and 8 long/multi-part two-tile buildings. The latter are passenger station,
warehouse, depot, power plant, colliery, ironworks, diesel refinery and wire mill.
This supersedes the old blanket two-tile category split. The new manifest is the
authority; don't copy footprint metadata from the old images. If the one-tile
candidate cannot retain human scale and identity, document why it needs two
instead of squashing the image or making its doors smaller.

## Instructions to paste into another session

Please continue this repository's building sprite regeneration using this folder.
Read START-HERE.md, manifest.json and progress.json (if present). The current
2:1 game camera above is mandatory for ALL assets. Generate real high-detail
illustrated raster sprites from the included original art, not geometric proxy
models. One image-generation call per facing; use the corresponding ordered
references and complete prompt in the manifest. Preserve the original palette,
identity, proportions and detailed miniature craftsmanship while correcting
projection. The old generated images are art references, NOT camera authorities.
No horizontal/vertical stretching, shearing, bent roofs or fake bitmap rotations.

Use geometry/*.png as camera and footprint guides. House/station guides also
give a representative rigid building shape. For the other buildings the wireframe
box is only an axis/footprint ruler; NEVER turn every building into that box.
Regenerate architecture from the original identity reference. Keep genuinely
sloped roof edges distinct from ground-parallel roof ridges and horizontal eaves.

Buildings occupy 1x1 or 2x1/1x2 tiles only, rotate in four directions, and use a
consistent human scale with approximately 2.1m door openings. Material-specific
yards belong beneath the building and remain clipped to its occupied footprint;
do not bake oversized scenery or ground slabs into the sprite. Real transparent
alpha, no glow/halo, no cropped structure. Preserve fixed lighting across views.

Check progress before generating: do not overwrite existing accepted files or
repeat completed work without a documented quality reason. Generated-candidate
means an image exists, NOT that its projection or rotation continuity is accepted.
Inspect foundations, wall courses, lintels, horizontal eaves and ridges against
the ±0.5 guides. Check the four facings as one rigid structure and compare doors
against a shared person-height reference. Correct failed candidates through
regeneration, never destructive warps. Do not silently shrink large buildings to
fit, duplicate front equipment on rear views, or mirror fronts to invent backs.

Save outputs using each task's output path, record exact prompt and references,
alpha/margin checks and review status. Keep original images unchanged. Maintain
assets/source/base-v1/RESUME.md in the repo. Save images and screenshots locally;
DO NOT embed media, base64, large files or complete batch JSON into the chat.
Only report paths and short progress summaries to avoid oversized chat requests.
Stop a generation loop at its first actual usage limit and record the error;
do not repeatedly submit every remaining task after a limit response.

Track geometry, terrain transitions, production gameplay, saves and vehicles are
outside this building batch. Railcraft later needs class, physical dimensions,
axles/bogies and rigid track-following behavior documented, but don't modify it
as part of these building corrections. No paid API fallback without user choice.

## Included files

- originals/: 26 full-resolution original identity/material references.
- existing-facings/: all 32 previously generated building facings, full resolution.
- geometry/: 16 camera/footprint guides plus the game's actual iso.ts.
- prompts/: 104 self-contained per-facing prompts, reference order in manifest.
- historical-prompts/: old prompts for provenance; current prompts supersede them.
- source-inventory.json: byte sizes and SHA-256 hashes for all source images.
- progress.json: current completed-candidate versus pending task list, when present.

## Availability evidence

A previous attempt returned HTTP 429 usage_limit_reached with a reported reset at
2026-09-26T16:07:22Z. A fresh call on 2026-09-23 SUCCEEDED, followed by another
successful guided call. The old limit must not be treated as a current blocker.
Use actual current tool results; record failures exactly, without assuming them.
