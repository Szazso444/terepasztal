# Battery review-2 repaint: partial, stopped after r3

Issue #535; branch `art/535-rotations`. Built-in imagegen edits of the review-2 guides.
**No view passed every test.** r0 attempt 2, r1 attempt 3 and r3 attempt 1 are closest copies,
all explicitly `kept: false` and `selected: true` in prompts.json.
r3 failed width in all three attempts, triggering the requested stop. r2 was not painted.

All nine returns were 1536 × 1024. Base-width target 694 px, permitted 659–729 px.
Width failures were not measured further: “—” means intentionally not evaluated.

| View | Attempt | Base width px | LL/LR       | Slopes LL / LR    | Camera error | Height / width | White / amber | Selected |
| ---- | ------- | ------------- | ----------- | ----------------- | ------------ | -------------- | ------------- | -------- |
| r0   | 1       | 762 FAIL      | —           | —                 | —            | —              | —             |          |
| r0   | 2       | 706           | 1.0872      | +0.5426 / −0.5218 | 2.1°         | 0.3744 FAIL    | 2507 / 0 FAIL | closest  |
| r0   | 3       | 740 FAIL      | —           | —                 | —            | —              | —             |          |
| r1   | 1       | 753 FAIL      | —           | —                 | —            | —              | —             |          |
| r1   | 2       | 695           | 1.0976      | +0.6458 / −0.5081 | 4.9°         | 0.4006 FAIL    | 3649 / 0 FAIL |          |
| r1   | 3       | 701           | 0.7886 FAIL | +0.5287 / −0.5001 | 0.9°         | 0.3608 FAIL    | 1613 / 0      | closest  |
| r3   | 1       | 743 FAIL      | —           | —                 | —            | —              | —             | closest  |
| r3   | 2       | 753 FAIL      | —           | —                 | —            | —              | —             |          |
| r3   | 3       | 756 FAIL      | —           | —                 | —            | —              | —             |          |

Plan foot ratio is 1.0, allowed 0.85–1.15. Slopes must have magnitudes 0.50 ±0.03.
Wall height is foot to the **top** of the near parapet, divided by width:
plan 0.31, allowed 0.2635–0.3565. r0 cap top was checked in a zoomed crop at y=678,
giving 264.352 px / 706 = 0.374437. An earlier provisional y=704 reading was corrected.
r1 attempt 2 cap top y=686 gives 278.440 / 695 = 0.400632.
r1 attempt 3 cap top y=709 gives 252.921 / 701 = 0.360800.
Both later height ratios are within 15% of closest r0 (0.374437), but fail the plan.
The old picture has 1569 near-white and 0 near-amber pixels; r0 is compared against those.
r1 is compared against closest r0's 2507 / 0.

## Visual assessment and tool limitations

The selected r0 has the front door and one louvre on the lower-left wall and two arched
louvres on the lower-right wall. It retains the olive tank and fins, porthole and pipes,
three brown insulator stacks, curved cables, lattice portal and hazard cabinet.
The selected r1 has two louvres on the lower-left right side and one on the lower-right back,
no front door, and the portal/tank follows the turned diagonal. The cabinet is obscured.
The selected r3 has the front door and louvre on the lower-right wall and one louvre on the
lower-left side, but the rooftop equipment repeats r0's orientation and the cabinet is
on the wrong edge. It is the closest width, not an accepted turn.

Grass previews were inspected separately and side by side. They show opaque buildings without
a ground halo, lower-left walls lighter than lower-right, and no added people, lettering or smoke.
None of the returned PNGs was resized, stretched, sheared, cropped or recoloured.
The selected PNGs are byte-for-byte copies. integrity.json verifies every raw result against its
tool-returned source and each selected copy against its raw file.

`pictureOf` in building-check.mjs parses standard filenames rather than reading pixels;
the shared measurement script therefore decodes with pngjs and retains pictureOf's metadata.
`checkFile(file, 't2x2', view)` assumes the footprint is a depot and reports missing
rail portals for a stone switch house. Its unmodified failures are retained in prompts.json;
this is not used to excuse the independent width, ratio, camera, height or highlight failures.

The required `node tools/building-sheets.mjs --picture <kept file>` command was tried on each
selected file, but rejects the requested filenames as “not a building picture's name”.
Its exported `drawLook` function made the uncommitted battery/.look/ previews using the same
t2x2 footprint, with rectification disabled. That renderer also adds depot rails and portal marks;
those are preview overlays, not part of the sprites. No guides or previews are committed.

## Validation

- Source reference SHA-256 matched 7e46ad40092bb5b76b8c9347ecdca509375f77a972f66ec1426b331c36934783.
- All four guide PNGs and plan canvases were 1536 × 1024 and every plan named job substation.
- Guide branch head: 21329dd74df7f7427f892173ca91a10b424a8120.
- Typecheck, lint and production build passed.
- Repository format check failed on 509 existing files outside this task.
- Full test run reported failures in existing guides, station/road geometry and Python/Blender tooling;
  it was still finishing when this partial-art report was prepared. No passing full-suite claim is made.
- Art scope passed; all 15 Battery commit paths were checked explicitly. Battery text formatting passed.

Exact prompts, ordered reference paths, returned dimensions, all available measurements,
individual test results and selection reasons are in prompts.json.
