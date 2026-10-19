# Hydro plant: review 2, stopped at r0

Issue #535. Branch `art/535-rotations`. Built-in imagegen edits of the r0 guide,
with the style board and old Hydro plant attached in that order. The old picture's
SHA-256 matched `9b404cd2224f3728befa6fa7272ee01f06f92c881e384ff21ef2cdb1e422a778`.
All four extracted guides were 1024 × 1024 and all four plans named `hydro_plant`.
The guides remain outside the repository, at `G:/DEV/Terepasztal/guides-535`
(absolute references are in prompts.json).

| View | Attempt | Returned | Base width | Allowed width | Result |
| --- | --- | --- | --- | --- | --- |
| r0 | 1 | 1254 × 1254 | 923 px | 458.00–506.99 px | Width FAIL |
| r0 | 2 | 1254 × 1254 | 882 px outer; automatic 828 px | 458.00–506.99 px | Width FAIL |
| r0 | 3 | 1254 × 1254 | 749 px | 458.00–506.99 px | Width FAIL; closest |

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
