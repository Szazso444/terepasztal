# Lumberjack back walk: repeated guide-edit trial

Branch: art/331-people. Starting head: 26b459845d3f1754ce1014645a5be37bccb61165.
Fetch, switch, fast-forward pull and the single develop merge completed; merge reported already up to date.

Stopped at P1 after test 6 failed twice. Two new calls of twelve were used. No accepted or kept pose; attempt 1 is the closest unaccepted result. P2–P4 were not painted.

| Test                                 | P1 attempt 1                        | P1 attempt 2                        |
| ------------------------------------ | ----------------------------------- | ----------------------------------- |
| 1 Height, target 969 ±3%             | 992, +2.374%, pass                  | 986, +1.754%, pass                  |
| 2 Sole, target 1440 ±8               | 1445, pass                          | 1427, fail                          |
| 3 Right foot f                       | 0.124628854; slide pending          | 0.133372953; slide pending          |
| 4 Contact overlap                    | Pending P3                          | Pending P3                          |
| 5 Raw L / R / (R−L)/960              | 533 / 467 / −0.068750; inconclusive | 539 / 484 / −0.057292; inconclusive |
| 6 Cursor-white / strong-amber pixels | 0 / 1616, fail                      | 10 / 0, fail                        |
| 7 Shape / PNG type / corner alpha    | 1024×1536 / 6 / all 0, pass         | 1024×1536 / 6 / all 0, pass         |
| Result / kept                        | Failed / no                         | Failed / no                         |

Calibration reproduces supplied back-swing figures: right f P1–P3 0.110591149, −0.006751367, −0.040274943; left f P3–P4 0.076891823, 0.014819777. Slides 0.117342516, 0.033523576, 0.062072046. P1/P3 overlap 0.220782167; P2/P4 overlap 0.504265932. Turn 0.069791667 in every swing guide. Foot windows round the bottom joint y to the nearest row before applying offsets; x bounds round outward, inclusive.

Back-shoulder targets have identical feet and slides. Heights P1–P4: 969, 1022, 1018, 968; sole rows all 1440. Raw column turns all 0.003125 because the bar intersects the right columns. Overlaps 0.211568579 and 0.504395526. Full measurements of all eight guides, joints and ground points are in prompts.json and checks/guide-measurements.json.

By eye, both attempts show the back of the head and the right side, with the intended green cap, orange/green checked shirt, charcoal cuffed trousers, brown boots and shoulder axe. The legs and upper-body geometry drift from the guide; the left arm hangs instead of matching the forward swing. Both have apparent coloured haze. A four-frame walk or identity review cannot be performed. Neither raw image was cleaned, recoloured, resized or composited.

Limitation: the axe head and cap intersect the shoulder-test columns. The specified shoulder-under-axe substitution was not isolated. Test 5 is inconclusive; raw column values are recorded without claiming a shoulder-only pass or fail. Test 6 alone requires stopping. Tests 3 and 4 require later poses and remain pending.

Current image paths, relative to this folder:

- raw/lumberjack-back-walk-f0-attempt-1.png
- raw/lumberjack-back-walk-f0-attempt-2.png

Both raw files were SHA-256 checked byte for byte against the built-in image tool outputs. Complete prompts, correction paragraph, two reference paths per call, numbers, digests and stop reason are in prompts.json. checks/trial-results.json contains the per-attempt numeric report. No strip, 9 px sheet, 9 px at 6x sheet, 36 px sheet, or P1/P3 overlay was produced. strips/ and poses/ contain no new output.

The starting branch already contained a prior trial in v3. This was noticed after the new calls. All eleven previously committed files were recovered directly from Git and preserved byte for byte under prior-26b45984/, including its raw attempts, prompts, report, tool and failed selection. These are separate from the two new calls reported above.

Validation: measurement-module syntax, guide calibration, raw byte equality, formatting and changed-path scope checked. No game runtime code changed; global build/test suites were not rerun for this stopped source-art trial.

Measure guides: node assets/source/people-2026-10-11/v3/measure-v3.mjs

Measure an attempt: node assets/source/people-2026-10-11/v3/measure-v3.mjs 1 assets/source/people-2026-10-11/v3/raw/lumberjack-back-walk-f0-attempt-1.png
