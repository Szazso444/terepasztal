# R7c-1 lumberjack back walk trial

Branch: art/331-people. Stopped on P1 after test 6 failed twice, using 2 of 12 calls. P2 to P4 were not painted. No accepted pose or assembled strip, small sheets, or overlay exists. Attempt 2 is retained only as the closer failed result.

| P1 attempt | 1 Height (target 969, ±3%) | 2 Sole (1440 ±8) | 3 Foot f / slide         | 4 Repeat | 5 Raw L / R / turn                 | 6 White / amber | 7 PNG / corners      | Result       |
| ---------- | -------------------------- | ---------------- | ------------------------ | -------- | ---------------------------------- | --------------- | -------------------- | ------------ |
| 1          | 1012, +4.44%, fail         | 1439, pass       | right 0.1223843; no pair | no P3    | 528 / 441 / -0.090625; unresolved  | 3 / 0, fail     | type 6 / all 0, pass | failed       |
| 2          | 977, +0.83%, pass          | 1447, pass       | right 0.1267044; no pair | no P3    | 544 / 492 / -0.0541667; unresolved | 49 / 137, fail  | type 6 / all 0, pass | failed, kept |

Calibration: swing slides 0.11734252, 0.03352358, 0.06207205; overlaps P1/P3 0.22078217 and P2/P4 0.50426593; turned 0.06979167 in all four. Shoulder slides are identical; shoulder overlaps are 0.21156858 and 0.50439553. Guide heights P1 to P4: 969, 1022, 1018, 968; soles 1440. Full per-picture numbers and foot windows are in prompts.json and checks/measurements.json. Integer windows use floor left, ceil right, floor top and bottom, inclusive; these reproduce the supplied rounded values.

Visual review: Both images show the back of the head and right side, with consistent moss cap, checked shirt, charcoal trousers and brown boots. Both have visible haze. The left arm hangs down instead of the guide P1 forward arm. Neither image is accepted; a four-frame identity or walking-cycle review is unavailable.

Files, relative to this report:

- raw/lumberjack-back-walk-f0-attempt-1.png
- raw/lumberjack-back-walk-f0-attempt-2.png
- poses/lumberjack-back-walk-f0-failed.png (byte-identical copy of attempt 2)
- prompts.json (complete prompts, references, results and SHA-256 digests)
- measure-v3.mjs, pose-png.mjs, contact-overlap.mjs
- checks/calibration.json and checks/measurements.json

Limitations:

- Test 5 raw column tops are reported, but do not measure the shoulder: the guide bar covers the right shoulder, and the painted axe/cap also intersects the test columns. No under-axe segmentation rule was invented and test 5 is unresolved.
- No slide or repeat pair can be evaluated after stopping at P1.
- No accepted pose, assembled strip, overlay or small sheets were produced.
- The image tool returned coloured translucent haze despite both prompts asking for alpha-0 background. Raw files were not altered.

The built-in image tool was used, attaching exactly the pose guide and the upper-body crop on each call. No painting with legs was attached. The originals are preserved byte for byte. The second prompt repeats the complete first prompt and adds one Correction paragraph. No colour-cap pass or image cleanup was applied. The generated previews were inspected for QA; this report embeds no images. The requested merge from origin/develop is the only source change outside v3. Repository build verification can write ignored build output outside v3.

Verification: guide calibration passed; trial-file Prettier passed; typecheck, lint, production build and Art scope check passed. Repository-wide format check failed on 509 files. The full repository test run reported out-of-scope failures in ownLength, building-guides, roadPaint and blender_runner; its complete summary is recorded in checks/gates.json when the run ends. No tests were added for this stopped art trial.

Full test result: 15 failed / 177 passed test files; 24 failed / 4127 passed / 11 skipped / 1 todo tests (4163 total), 392.29 seconds. Failures are outside v3. No out-of-scope fixes were made.
