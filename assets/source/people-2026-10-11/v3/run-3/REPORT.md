# R7c-1 run 3

Result: stopped at P1 after two calls of twelve. No pose accepted. P2, P3 and P4 not painted.

Stop: "If the same test fails on the same pose twice, stop there and report; the guide is then to be changed, not the prompt." P1 test2 failed twice: sole1423 (-17px), then1431 (-9px), target1440 ±8px.

| Pose | Attempt | Returned | Test1 height | Test2 sole | Test3 foot | Test4 overlap | Test5 turned | Test6 white/amber/haze (report) | Test7 | Kept |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | 1 | 1024 x 1536 | 995/969 (2.683%; PASS) | 1423 (-17; FAIL) | 0.1668079; pair pending | pair pending | raw L526/R429 ratio-0.1010417; visual PASS | 14/0/11955 | RGBA6 corners0 PASS | false |
| P1 | 2 | 1024 x 1536 | 975/969 (0.619%; PASS) | 1431 (-9; FAIL) | 0.1187035; pair pending | pair pending | raw L532/R487 ratio-0.0468750; visual PASS | 11/58/10491 | RGBA6 corners0 PASS | false |

Closest raw is attempt2, still refused. All picture bytes preserved without resizing, cropping or repainting. No strip, pose selection, 9px/36px sheets or P1/P3 overlay exists because the first pose failed.

Guide calibration matches supplied swing numbers: right f .1105911,-.0067514,-.0402749; left P3/P4 .0768918,.0148198; slides .1173425,.0335236,.0620720; overlaps .2207822/.5042659. Shoulder slide targets match; shoulder heights969,1022,1018,968; soles1440. Full numbers: checks/guide-measurements.json.

By eye both returns show back of head and right side, no front face, the same cap/shirt/trousers/boots identity. The axe head and shaft obscure both shoulder-to-neck junctions, so shoulder rows could not be read confidently; permitted visual judgment used, machine column readings retained. Both pictures contain visible haze, counted as report under test6, and no picture was accepted. Test3/4 pairs were not reached.

Original v3 tools are unchanged. check-run.mjs imports them, adds haze count, treats test6 as report, and records permitted by-eye test5. Existing module's obsolete test6 cap failure is explicitly excluded. No application code changed; npm ci installed dependencies using G: temp/cache. No application tests run for raw art evidence.

Built-in image edits used exact P1 prompt and one correction, guide plus upper-only identity in prescribed order. Tool autonomously saved original returns to C:; byte-for-byte copies on G: retained, originals left alone per queue README. No manual C: writes.

Raw: raw/lumberjack-back-walk-f0-attempt-1.png and raw/lumberjack-back-walk-f0-attempt-2.png. Full prompt+numbers: prompts.json; per-attempt checks: checks/p1-attempt-{1,2}.json.
