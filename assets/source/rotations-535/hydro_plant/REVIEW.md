# Hydro plant: review 2, stopped at r0

Issue #535. Branch `art/535-rotations`. Built-in imagegen edits of the r0 guide,
with the style board and old Hydro plant attached in that order. The old picture's
SHA-256 matched `9b404cd2224f3728befa6fa7272ee01f06f92c881e384ff21ef2cdb1e422a778`.
All four extracted guides were 1024 × 1024 and all four plans named `hydro_plant`.
The guides remain outside the repository, at `G:/DEV/Terepasztal/guides-535`
(absolute references are in prompts.json).

| View | Attempt | Returned    | Base width                     | Allowed width    | Result              |
| ---- | ------- | ----------- | ------------------------------ | ---------------- | ------------------- |
| r0   | 1       | 1254 × 1254 | 923 px                         | 458.00–506.99 px | Width FAIL          |
| r0   | 2       | 1254 × 1254 | 882 px outer; automatic 828 px | 458.00–506.99 px | Width FAIL          |
| r0   | 3       | 1254 × 1254 | 749 px                         | 458.00–506.99 px | Width FAIL; closest |

Target width: 482.50 px. The automatic left corner of attempt 2 fell inside a
quoin step. The outer corners were read by eye and checked against the alpha
boundary: w=(249,932), e=(1131,1071). Both readings are recorded in prompts.json.
Intake structures touching the ground count in every width above.

Every attempt failed the first gate. In accordance with the brief, foot ratios,
slopes, camera errors, wall heights, and highlight counts were **not tested**.
No view passed every test. Attempt 3 is copied byte for byte to hydro_plant-r0.png
only as the closest attempt; its record says `kept: false` and
`selectedAsClosest: true`. All raw files were verified byte for byte against
the tool's originals. The kept copy was likewise verified against raw attempt 3.
No generated image was resized, cropped, moved, rotated, or otherwise altered.

The explicit stop condition was reached: all three attempts of r0 were refused
for width. No r1, r3, or r2 was painted, and the failed r0 was not used as a
reference. Exact prompts, reference order, returned sizes, and width measurements
are in prompts.json.

The requested building-sheets --picture command was run, but this checkout's
parser rejects the requested filename hydro_plant-r0.png because it expects an
age suffix. Its exported drawLook function was then called directly with t1/r0,
writing the uncommitted preview to assets/source/buildings-v2/.look/hydro_plant-r0.png.
That grass preview was inspected; only this preview was fitted by the sheet tool.
There are no other views for a side-by-side review.

Repository validation: `npm run typecheck`, `npm run lint`, and `npm run build`
passed. `npm run format:check` failed with warnings in 509 files outside this art
change. These files were not reformatted. Command outputs are retained in the
adjacent check-*.log files.

`npm test` was stopped after more than 15 minutes without a final summary. It had
reported failures in route worker jobs, pipeline data, and building ground data
(the latter suite reported 5 failures out of 69 tests). Its overall result is
INCOMPLETE, with failures observed; it is not a passing test run. No unrelated
test or source files were changed to address these failures. The Art scope check
passed, and all three raw PNGs and the closest copy passed byte-integrity checks.

## Second queue run, 21 October 2026 — stage 1 stopped

The author's width decision now makes width a measurement. Three new guide edits,
attempts 4–6, used only the r0 guide, style board, and unchanged old Hydro plant.
All returned 1254 × 1254. Old-art hash matched; the guide is 1024 square and its
plan names hydro_plant. No turned views were painted.

| Attempt | Whole base width | k (held 482.496 px) | Foot ratio | Whole-base eye slopes | checkFile camera error | Overshoot (guide px) | Height/base | White / amber |
| ------- | ---------------- | ------------------- | ---------- | --------------------- | ---------------------- | -------------------- | ----------- | ------------- |
| 4       | 970              | .497419             | 1.38329    | .53108 / .13022       | 2.6°                   | 44.269               | .39794      | 3526 / 4      |
| 5       | 940              | .513294             | 1.35589    | .52126 / .25313       | 1.7°                   | 31.001               | .41170      | 1799 / 4      |
| 6       | 1047             | .460837             | 1.39041    | .55008 / .17808       | 3.5°                   | 37.438               | .52531      | 3225 / 1      |

The intake projects beyond the hall's straight end-wall foot. Automatic fitting
intersects the two apparent base runs below the actual painted near corner; those
readings are retained in prompts.json alongside by-eye readings. Automatic slopes
were .55216/.46135, .52226/.52839, and .59653/.51151 respectively. Attempt 5's
automatic camera passed, but its actual ground outline is not a plain rectangle.
All three miss the height target .82 (allowed .697–.943) and footprint allowance
16 guide px when placed using the actual near corner. Whole-base ratios pass;
this does not excuse the projecting intake or nonstraight right foot. Camera was
not more than 3° off in all three automatic readings. Highlights are reports only;
old art counted 4019 white and 0 amber by the same method.

Attempt 5 is copied byte-for-byte to hydro_plant-r0.png as the closest by camera
and footprint, explicitly kept:false. All returned raw images and exact prompts
are preserved. **fallback: blockout scaffold**. Core must provide the clean Blender
hydro blockout; no additional free attempt or stage 2 was made. The r0 grass preview
was viewed through exported drawLook after the CLI refused its non-age filename;
preview is uncommitted. Beside the pump, the hall is distinct (three arches, lantern,
penstock, tailrace, no flywheel/chimney), but geometry tests still refuse it.

New measuring script syntax, scoped formatting, raw-byte/kept-copy integrity and
staged-diff checks passed. Earlier repository baseline failures were not rerun or
changed for these raster/record additions.
