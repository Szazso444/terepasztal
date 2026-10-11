# Ground-material swatches

Five original paintings made with built-in ImageGen, each requested at 1024 x 1024
and returned at 1254 x 1254. The PNGs are fully opaque and preserved byte-for-byte.
No crop, resize, padding, mirroring, retouching or reuse was applied to the originals.

Exact requests and four references per painting are recorded in `prompts.json`.
`swatch-prompts.json` also retains this batch alone to support concurrent material
work in this folder. No attempts were rejected.

`make-swatch-guides.mjs` writes the scale card, geometry record and specified
water/sand hue crops. The scale card was never supplied to ImageGen.
`check-swatches.mjs` reads real PNG dimensions, checks opacity, records source
SHA-256 hashes and creates separate whole-image 199 px review copies.

Visual review at source size and 199 px: all five are flat, edge-to-edge material
samples with smooth painted contours, no tile silhouettes or standing objects.
Lake is darker and calmer than river; beach is dry warm sand; wet sand has cooled
damp patches and small pools; bank has clustered limestone/slate gravel and moss.
At game scale the broad clusters remain readable without per-pixel noise. Bank
carries the greatest detail. Lighting is upper left. Colour values and feature
sizes are generated approximations, not a pixel-exact palette/geometry guarantee.

Repository validation on the origin/develop base:

- Typecheck, ESLint and production build pass (existing large-bundle warning).
- Full tests: 105 files failed, 7 passed; 280 tests passed and 16 failed, with
  environment failures including missing Python. Full suite is not verified.
- Repository formatting check fails on 374 existing files outside this scope.
- C: had zero free space; several npm commands failed with ENOSPC. Checks were
  invoked directly with Node where possible. No unrelated source fixes were made.
- Asset dimensions and opacity checks pass; all five game-scale previews reviewed.
