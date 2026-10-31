# Narrow bridge deck sources

Branch: `art/366-bridges-narrow`, based on `origin/develop` at `f691330d`.
Related bridge-width work: #366. Built-in imagegen was used, one guide edit per direction.

## Outcome

Stone x has been repainted with built-in imagegen from a centred guide. Attempt 3 is selected
as the closest available new width: **0.612227 tile**, replacing the earlier 0.84-tile source.
The original painting remains byte-for-byte in raw/stone-deck-x-narrow-attempt-1.png; its checked
SHA256 is 3385551284f598ac2c7b8cf8b9b1b8ca0ed2dc5129b46bfc97aca2a64b8aa500.
All earlier paintings, four original guides, and the other three decks are unchanged.
Attempt 3 returned 1254x1254 despite the requested 1024x1024. It is saved exactly as returned,
with no resizing, cropping, padding, fitting, warping or retouching.

**Partial: overlap and joints fail.** The retry call (attempt 4) returned HTTP 429
usage_limit_reached and no image. No further paint calls were made. The selected source's
IoU is 0.890403, below 0.90, and courses show visible steps across repeated-tile joints.
The source is useful narrow material, but is not fully accepted as a snapping kit piece.
Surface alpha 251–253 is accepted by this brief because the later narrow fitting promotes
alpha >=128 to 255; the background corners are alpha 0. Earlier strict-opacity conclusions
below describe the previous task's checks only.

## Geometry and review

make-guides.mjs keeps HALF_WIDTH = 0.30 and the four original guides unchanged. It adds
guides/stone-deck-x-narrow-centred.png at scale 15, centre (512,512), with the exact slab and
parapet geometry in geometry.json's stoneDeckXCentred entry. Existing geometry entries are
unchanged. The entry includes the scale 8/15 mapping to the kit's centre (512,360).

Run node assets/source/bridges-narrow-2026-10-11/check-extent.mjs <PNG> to report dimensions,
alpha >128 box, lowest-row corner mean, width ratio, and IoU against the scaled centred guide.
The checker writes no files. Non-square and opaque-background returns are rejected unmeasured.
Attempt 3 measured box x=165–1088, y=310–992: 923x682 px, centre (626.5,651),
24.005 px from the expected centre. Box test passes (5% size and 38*s centre tolerance).
Lowest-row mean x=737.5: side span 572.5, cut span 350.5, ratio 0.612227; width test passes.
Guide overlap 0.890403 fails. Every call and measurement is in prompts.json.

review-repaint.mjs produces review-only composites. review/stone-x-repaint-three-tiles.png
lays three unchanged paintings with exact (480,240)*s offsets, later copies over earlier ones.
Cuts are flat vertical cuts, but coping and flag courses show visible joint steps; joints fail.
review/stone-x-repaint-game-scale.png compares selected stone x, unchanged stone y, and full-width
stone x at approximately one 64px tile. The selected canvas is about 68px wide; it reads as narrow
as stone y and distinctly narrower than the full-width deck. No source painting was altered.

Previous review/ overlays and measurements are historical and describe earlier paintings.
No rails, sleepers, ballast, near railing, supports, pads or renderer files were changed.

## Current repaint checks

- Typecheck, lint, production Vite build and Art scope check: passed.
- Repository format check: failed on 374 existing files outside this source folder.
- Changed source scripts and JSON: checked with Prettier; git diff --check passed.
- Whole test run: incomplete, stopped after unrelated asset-pipeline fixture failures;
  no suite pass is claimed. Logs remain under review/repaint-check-2.log.
- Extent checker: box and width pass; IoU and visual joints fail as recorded above.
- Preservation: all original geometry entries match; four original guides, other decks, and
  both earlier stone x paintings retain their committed bytes.

## Previous task checks

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
