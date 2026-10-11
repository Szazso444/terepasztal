# Narrow bridge deck sources

Branch: `art/366-bridges-narrow`, based on `origin/develop` at `f691330d`.
Related bridge-width work: #366. Built-in imagegen was used, one guide edit per direction.

## Outcome

Four source paintings and exact 0.6-tile-wide guides are present. All five image-tool returns
(including the rejected opacity retry) are preserved byte-for-byte. Every return is 1254x1254
despite requesting 1024x1024; no source was resized, cropped, padded, fitted or retouched.

**Partial: strict opacity acceptance is unmet.** The background is predominantly alpha 0, but
most material pixels are alpha 253 (about 99.2% opaque), rather than 255. Wood x also has one
corner at alpha 1. The explicit alpha-255 retry reproduced the same limitation. Do not treat
these as fully accepted opaque production sprites. Full histograms are in `prompts.json`.

## Geometry and review

`make-guides.mjs` follows `tools/bridge-kit-guides.mjs` with one `HALF_WIDTH = 0.30`.
It writes four guides and `geometry.json`, including projected slab/parapet corners and faces.
Deck thickness is 5 game px, wall thickness 0.12 tile, and far wall heights are 5 stone / 7 wood.

`verify-paintings.mjs` records dimensions, alpha, and distances for each face edge and both cut
ends. For each edge it samples 21 points and measures shortest Euclidean distance to the
alpha>=128 silhouette boundary, in returned-canvas pixels. Outer edges are classified against
the guide; internal face joins are separately labelled and their silhouette distances do not
measure material-joint placement. The review does no fitting. Mean distances on outer edges
range roughly 13–119 px for stone x, 41–124 for stone y, 37–116 for wood x and 44–128 for wood y.
These substantial framing/scale offsets are recorded for the later fitting step.

`review/*-overlay-50.png` places each painting at 50% opacity over its guide at returned size.
`review/*-128.png` is a review-only downsample; source PNGs remain unchanged.
`review/native-scale-comparison.png` columns are guide, new painting, full-width reference;
rows are stone x, stone y, wood x, wood y. At this scale the new decks read narrower than the
full-width references, particularly stone y and both timber directions. Stone x is less
pronounced. Different generated framing means these previews are visual checks, not proof of
world-space width; the fitting step must enforce the guide.

No rails, sleepers, ballast, near railing, piers, arches, pads or renderer files were changed.
The new timber far sides are solid kerb beams, without the reference railing's posts or openings.

## Checks

- Typecheck: passed.
- Lint: passed.
- Production Vite build: passed (review/build is excluded from Git).
- Repository format check: failed on 374 existing files outside this asset folder.
- Whole repository tests: incomplete; the first run encountered ENOSPC on C:, and the retry
  using G: for temporary files stalled with existing fixture failures. The task's test processes
  were stopped; logs are retained under review/. No suite pass is claimed.
- Asset verification: measurements and transparent-background checks completed for all five;
  strict surface-opacity acceptance failed as above.
- Scope: only this source folder is committed.

C: had 0 GB free during checks; G: had approximately 3414 GB free. No pre-existing files were
deleted. Build output and test scratch files are ignored locally in this folder.
