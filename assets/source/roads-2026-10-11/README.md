# Road painting checkpoint

Issue: #319. Branch: `art/319-roads`, based on `origin/develop` at `dea4267`.

Status: 15 independent imagegen guide edits made, plus one rejected straight-road attempt.
These are drafts, not accepted production assets. No commit or push yet: the required join
check failed. The user has been asked to authorize deterministic image finishing (resize,
exact guide geometry, opaque alpha). That answer is pending; do not infer authorization from
elapsed time.

- `make-guides.mjs`: exact FOOTPRINTS.t1 geometry and one grey guide per piece.
- `guides/`: the 15 attached edit targets.
- `prompts.json`: every generation prompt and its four attached references.
- `generations.json`: exact imagegen output paths and saved draft paths.
- `raw/`: original imagegen outputs, copied byte-for-byte; each requested piece was generated
  separately, without mirroring or reuse.
- `geometry.json`: coordinates, edge midpoints, centre, scale and piece definitions.
- `check-raw.mjs`: transparency, canvas and edge-opening measurements plus 64-pixel previews.
- `raw-check.json`: measured failures. All returned canvases are 1254x1254, and alpha extends
  beyond the specified diamond. Widths and alignment vary at connecting edges.
- `review/`: full-canvas 64x64 previews and tile 64x32 previews; `raw-sheet.png` is an enlarged
  nearest-neighbour view of the game-scale tiles, with labels only in the review sheet.

## Reproduce current guides and checks

Both scripts require the development tooling package `sharp`; no runtime dependency is added.
On this machine, use PowerShell:

```powershell
$env:ROAD_TOOLING='C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
node assets/source/roads-2026-10-11/make-guides.mjs
node assets/source/roads-2026-10-11/check-raw.mjs
```

If finishing is authorized, preserve originals, fit each independent painted output to its
own guide, enforce road width 0.5 tile and verge <=0.03 tile, and write the requested 15 final
names at this folder's root. Inspect ruts, curves and junctions after fitting. Check opaque
interiors, zero alpha outside the road/verge and diamond, anchor (512,832), and matching edge
profiles after reducing the diamond to 64x32. Record finishing and final checks here. Commit
only this folder, then push only `art/319-roads`; never push main or develop.
