# Core review 2 (21 October 2026)

After queue run 3 (summary: `SUMMARY.md`). Three prompts were stopped or refused for causes that were Core's to fix: R7c-1 (people), C35a (narrow depot) and C29a (hydro plant). All three are `ready` again in `queue.json`. Core's measuring code for the depot retest is the same best-fit method as Core review 1 (the lanes' numbers are reproduced to within a few px: r0 attempt 6 gives IoU 0.9448, p95 58.6 / 14.3, max 118.5 against the lane's 0.9451, 62.1 / 14.5, 118.0).

## 1. R7c-1 (people): the manifest field is added, run 5

**Cause.** The Core-review-1 header of the prompt asks for `manifest.json` to carry a `soleRow` of 1440 for `back-shoulder-p1.png` ("manifest.json gains soleRow per guide"). The guide fix (PR #539, branch `claude/people-guide-p1-fix`, f7172d02) had moved the sole to row 1440 and written the file-level `soleRow`, but not the per-guide field. Run 4 and run 4's recheck read `entry.soleRow`, found it missing and, correctly, stopped.

**Fix, pushed to PR #539 (a4e36c70).** `manifestOf()` in `tools/people-guides.mjs` now writes `soleRow` into every guide entry (`soleRowOf(png)`, the lowest row at least 36 px wide), between `bottom` and `headTop`; a new test (`records the sole row of every guide in the manifest`) checks the field on all 32 guides, that it equals the guide's measured sole row, that it is within 1 px of 1440, and that `back-shoulder-p1.png` has exactly 1440. The 32 guide PNGs are byte-identical (the committed-picture test still passes); only `manifest.json` gains the field, plus the tool, its test and one README line. `vitest tools/people-guides.test.mjs`: 14 of 14 pass; eslint clean on both files.

**The rest of the prompt's preflight, checked against the branch.** (a) the entry's `soleRow` is 1440: yes now; (b) the guide's lowest opaque row is 1451, inside 1440 to 1456: yes; (c) the swing calibration (right f 0.1106, -0.0068, -0.0403; left 0.0769, 0.0148; slides 0.1173, 0.0335, 0.0621; overlaps 0.2208, 0.5043) does not depend on the sole shift and run 4 reproduced it; (d) `origin/develop` is an ancestor of `art/331-people`: yes; (e) merging the new PR head into d8f29c5f is clean (`git merge-tree`, no conflicts: the lane already holds f7172d02 via 1fe810b5, so the merge brings the manifest field, the tool and the test only). The lane's `v3/run-4/` folder already holds the preflight record of the stopped run 4, which the prompt's "put everything in run-4/" would have overwritten, so the prompt now says RUN 5, in `v3/run-5/`, with run-4 left untouched. No other check of the prompt needs the guide to change.

## 2. C35a (narrow depot): the cause was the prompt, the blockout now reads solid

**What the numbers say.** All twelve attempts of run 3 had an IoU of 0.93 to 0.96, a scaffold-to-picture 95th percentile of 13 to 19 and a maximum of 16 to 26 outside one place. The picture-to-scaffold 95th percentile was 48 to 87 and the maximum 108 to 144: every picture had a hole in its outline at the portal. The blockout's outline (a filled external contour) is solid at the doorway; the C35a prompt told the painter to leave the ground inside each doorway "and the ground before it" transparent "so that the game's rails show there". All twelve did, so the portal notch (7,000 to 14,000 px of the canvas, about 100 px from the blockout's outline) is a hole against a solid scaffold. It is not a camera or a drawing error: with the notch's boundary excluded every attempt would have passed (IoU 0.93 to 0.95, 95th percentiles 11 to 17, maximum 17 to 26; a diagnostic only).

**Fix 1, the blockout (pushed to `claude/art-scaffolds-review-2`, 394cbfe8, same paths).** `build_nd.py` now adds an explicit opaque dark hall floor (a slab the length of the hall) and a dark sill that fills each portal from the ground line up to just above the hall floor (before, the doorway held a thin cream footing sliver across the sill and a dark interior that was hard to read as a floor). Lit, bare and json re-rendered for r0 to r3 with `build_nd.py` and `post_nd.py`; the outline moves by under 1 px (r0 area 345,824 to 345,877 px); the json carries `portal_floor` so a lane can tell the revised files from the old ones. Scripts are kept in `scaffolds/_scripts/` as well.

**Fix 2, the prompt.** C35a now says to PAINT the doorway: the hall's inner wall in shadow and an opaque dark floor and sill out to the foot line, no transparent notch (the "unpainted and transparent so that the game's rails show" sentence is reversed in THE SHED, in the paint-over paragraph and in the by-eye test). A CORE REVIEW 2 header explains it, sets the attempt numbers (r0 from 7, r1, r3 and r2 from 4), puts all four views back to pending, and keeps three new attempts a view (twelve calls) and the unchanged boundary rule (IoU 0.90, p95 24, max 48).

**Re-test of the twelve refused attempts against the corrected blockout** (same rule: IoU at least 0.90, both 95th percentiles at most 24, maximum at most 48; p95 values picture-to-scaffold / scaffold-to-picture, canvas px):

| view | attempt | IoU | p95 | max | result |
| --- | --- | --- | --- | --- | --- |
| r0 | 4 | 0.936 | 68.9 / 14.0 | 130.6 | fail (notch) |
| r0 | 5 | 0.946 | 59.0 / 16.1 | 120.3 | fail (notch) |
| r0 | 6 | 0.945 | 58.6 / 14.3 | 118.5 | fail (notch) |
| r1 | 1 | 0.942 | 48.3 / 13.0 | 108.7 | fail (notch) |
| r1 | 2 | 0.943 | 51.9 / 15.2 | 112.3 | fail (notch) |
| r1 | 3 | 0.943 | 51.4 / 15.0 | 110.0 | fail (notch) |
| r3 | 1 | 0.932 | 86.5 / 13.0 | 144.0 | fail (notch) |
| r3 | 2 | 0.936 | 64.4 / 17.9 | 123.9 | fail (notch) |
| r3 | 3 | 0.937 | 66.2 / 15.0 | 126.1 | fail (notch) |
| r2 | 1 | 0.955 | 51.4 / 15.3 | 110.0 | fail (notch) |
| r2 | 2 | 0.948 | 57.2 / 19.2 | 116.7 | fail (notch) |
| r2 | 3 | 0.942 | 60.4 / 14.0 | 120.3 | fail (notch) |

**Decision: no C35a view is accepted.** The corrected blockout is as solid at the doorway as the old one was, so a picture that leaves the notch open still fails the same test; the attempts followed the prompt, and the prompt was the fault, but accepting them would put a transparent notch into a sprite whose doorway the author wants solid (the decision of this review). They stay in `raw/` (closest refused: r0 6, r1 1, r3 3, r2 2), are never attached, and cost nothing: the budget of the new prompt is three new attempts a view. All four views are still needed, so C35a is requeued for r0, r1, r3 and r2.

## 3. C29a (hydro plant): a clean blockout and a new prompt

**Blockout (pushed to `claude/art-scaffolds-review-2`, f44a8b9e), `scaffolds/hydro_plant-blockout/hydro_plant-r<v>-lit.png`, `-bare.png`, `.json`, v = 0 to 3.** Modelled directly in Blender (`renders/scaffold-hydro/build_hydro.py`, `post_hydro.py`; copies in `scaffolds/_scripts/`) on the review-2 plan of `hydro_plant`: canvas 1024 x 1024, anchor (512, 832), 8 canvas px to a game px, footprint 1 x 1 tile, base 0.9 x 0.6254 tiles (corners match the plan to 0.01 px in all four views), eaves 40 game px, nothing outside the plinth (overshoot 0 to 0.5 px). The design, clearly apart from the Water pump (a small square cottage with a chimney, a flywheel and a strainer): a brick turbine house on a rusticated stone base with cream quoins; a slate gable roof at 33 degrees with a small vented ridge lantern, no chimney; one tall round-arched window with a cream surround and sill and a small green door in the long front wall; a cream-arched tailrace opening low in the front base, with an opaque dark tunnel, floor and sill (no notch); on the uphill back-right corner a small cream-stone intake chamber on a stone footing with a stone top slab, a green sluice housing and a copper handwheel; from it one riveted forest-green penstock with copper flanges runs diagonally down the right end wall and enters it above the stone base; round gable vents. Flat colours of the art-direction palette (brick, stone, cream, slate, forest green, copper), the same sun as the other scaffolds. No water is modelled.

**Prompt.** `C29a.md` is rewritten: paint r0, r1, r3 and r2 over the blockout, lit render first, then the style board, the old hydro-plant picture (pipe, flanges, sluice, green iron) and the power plant (brick, quoins, arched windows), then the accepted earlier views; scaffold geometry wins; opaque tailrace doorway; tests IoU at least 0.92, both 95th percentiles at most 16 canvas px, maximum at most 32, both heights within 8 per cent, plus identity (the design in this view, not the pump), light and no extras by eye; three attempts a view (twelve calls; r0 attempt numbers go on from 7, the others from 1); r0 IoU under 0.80 three times stops after r0. The stage-1 limits and the old fallback sentence are void.

## 4. Accepted views of this review

C35a: none. C29a: none yet (not painted). R7c-1: none yet (not run). The eight textured-pilot views of run 3 (`art/textured-pilot`) are not decided here.

## 5. Left open

- The author's review of the two blockouts (the hydro plant's brick house, tall window, intake and penstock; the narrow depot's solid doorways) before the runs, if wanted: contact sheets are in the Core session's scratchpad.
- R7c-1 run 5 will need the same merge of #539 as run 4; if #539 is merged into develop first the merge brings nothing and the prompt's checks still hold.
- The HOLD on the reconstructed-scaffold jobs (C21a, C23a, C4e, CR1-adopt, C24a to C28a, C30a to C33a, R8e), the windmill C17d budget, the textured pilot's power plant and the decision of how to carry the notch lesson to the other blockout jobs are untouched by this review.
