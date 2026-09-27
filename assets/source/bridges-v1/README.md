# Bridge kit v1

18 original source sprites for modular stone and timber bridges, generated with
the built-in imagegen tool for `claude/charming-ramanujan-i16mhm`.

Open `index.html` to review the individual PNGs on a checkerboard. The small
`contact-sheet.png` is a review derivative; only the 18 filenames below are source
pieces. `brief.txt` preserves the user brief. `generation-prompts.json` contains
the exact prompts, reference paths, output provenance, and earlier attempts.
`drafts/` preserves superseded originals and is excluded from the source set.

| Material | Pieces                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stone    | `stone-deck-x.png`, `stone-deck-y.png`, `stone-rail-x.png`, `stone-rail-y.png`, `stone-pad.png`, `stone-pier.png`, `stone-arch-x.png`, `stone-arch-y.png`                                   |
| Wood     | `wood-deck-x.png`, `wood-deck-y.png`, `wood-rail-x.png`, `wood-rail-y.png`, `wood-pad.png`, `wood-post.png`, `wood-brace-x.png`, `wood-brace-y.png`, `wood-truss-x.png`, `wood-truss-y.png` |

## Source contract

- `x` runs toward screen lower right; `y` runs toward screen lower left. These
  directions were generated separately, with upper-left lighting requested for
  both. They are not mirrored copies.
- Decks contain the far parapet/railing. `rail` pieces supply the separate near
  wall. Pads omit railings; braces omit support posts; arches omit the road deck.
- Each source PNG is copied byte-for-byte from the built-in generator. No source
  has been trimmed, stretched, resampled, recolored, or alpha-thresholded here.
- Source images use real RGBA transparency. Generated files can contain a faint
  low-alpha fringe and predominantly alpha-254 solid pixels. See exact values
  and SHA-256 hashes in `alpha-report.json`. This is source art for the existing
  cleanup pipeline, not a claim of pixel-perfect opaque runtime sprites.

## Integration handoff

The requested runtime target is a 64 × 32 px tile (256 × 128 at atlas density 4),
a 4 px deck depth, and approximately 39 atlas pixels per elevation level. Apply
the existing `trimSource()` cleanup in `tools/illustrated-sprites.mjs`, then
calibrate footprints, thickness, material scale, and anchors when packing. The
source canvases have different sizes and should not be assigned identical scale
factors from their full image dimensions.

`stone-pier.png` and `wood-post.png` are straight shafts with no separate cap or
foot. Cut, stretch, or repeat them to the actual drop under each deck; do not use
their illustrated source height as a fixed game height. Pixel-exact repeating
seams and joins still need inspection at the packed scale. Match the arch and
truss side panels to their deck endpoints before showing the water spans.

The source review checks separate parts, directions, background transparency,
clipping, and gross shape. Exact 2:1 projection, seamless repetition, height
normalization, and in-game rail/deck alignment require the cloud integration and
game renders described in the brief. No runtime atlas or renderer is changed by
this delivery.

## Reproduce the review

From the repository root, run:

```sh
node assets/source/bridges-v1/review.mjs
```

This validates the 18 named RGBA files, reports clipping and alpha characteristics,
records hashes, and rebuilds the gallery and contact sheet. It never rewrites a
source PNG. Optional filename arguments create `review-selection.png` for a small
subset in manifest order.

Repository checks: typecheck, lint, production build, and all 200 tests pass.
Tests on this Windows host use the bundled Python executable via `PYTHON`.
Prettier passes with `--end-of-line auto`; the unqualified check reports the
checkout's CRLF line endings (`core.autocrlf=true`), not source formatting changes.
