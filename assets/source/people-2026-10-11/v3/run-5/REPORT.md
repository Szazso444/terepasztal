# R7c-1 run 5

Result: stopped at P3, 6 calls used of12. P1 attempt2 and P2 attempt2 accepted. P3 none accepted; closest attempt2 remains in raw with kept:false. P4 not generated.

Stop: "If the same test fails on the same pose twice, stop there and report; the guide is then to be changed, not the prompt." P3 test3 right planted-foot slide failed twice: .0617770367 vs .0335235756 (difference .0282534611), then .0482145978 vs .0335235756 (difference .0146910222), allowed .01.

| Pose | Attempt | Test1 height | Test2 sole | Test3 slide actual/target | Test4 P1/P3 overlap | Test5 turned | Test6 white/amber/haze (report) | Test7 | Kept |
|---|---|---|---|---|---|---|---|---|---|
| P1 | 1 | 1007/969 3.922% FAIL | 1448 (8) PASS | pair pending | pair pending | machine L521/R452 ratio-0.0718750; visual PASS | 98/9/10518 | type6/corners0 PASS | false |
| P1 | 2 | 966/969 -0.310% PASS | 1436 (-4) PASS | pair pending | pair pending | machine L553/R488 ratio-0.0677083; visual PASS | 45/142/11804 | type6/corners0 PASS | true |
| P2 | 1 | 1034/1022 1.174% PASS | 1450 (10) FAIL | 0.138672552 / 0.117342516; diff 0.021330036 FAIL | pair pending | machine L495/R424 ratio-0.0739583; visual PASS | 65/627/11226 | type6/corners0 PASS | false |
| P2 | 2 | 1013/1022 -0.881% PASS | 1443 (3) PASS | 0.123172058 / 0.117342516; diff 0.005829542 PASS | pair pending | machine L514/R450 ratio-0.0666667; visual PASS | 19/2822/9308 | type6/corners0 PASS | true |
| P3 | 1 | 1062/1018 4.322% FAIL | 1457 (17) FAIL | 0.061777037 / 0.033523576; diff 0.028253461 FAIL | 0.261572189 PASS | machine L482/R416 ratio-0.0687500; visual PASS | 0/10/9974 | type6/corners0 PASS | false |
| P3 | 2 | 1024/1018 0.589% PASS | 1440 (0) PASS | 0.048214598 / 0.033523576; diff 0.014691022 FAIL | 0.227083642 PASS | machine L504/R451 ratio-0.0552083; visual PASS | 0/808/8207 | type6/corners0 PASS | false |

Every return is1024x1536 RGBA. All raw bytes retained unchanged; accepted pose files are byte copies, not edited. Full exact prompts/references/sha256/measurements are in prompts.json. Per-attempt checks and zoomed shoulder comparisons are in checks/. Original measurement tools remain unchanged; check-run.mjs imports them and applies amended test5 visual review plus test6 report/haze.

By eye all six returns show the same lumberjack in cap, shirt, trousers and boots, with back of head/right side and no front face. The axe head and diagonal shaft obscure both shoulder-to-neck junctions; numeric shoulder tops could not be read confidently, so the explicitly permitted visual turn judgment was used, with machine readings reported. The P3 contact pose visibly changes the leading leg from P1, consistent with contact overlap below.45, but its planted-foot slide is outside tolerance. Visible haze surrounds returns; alpha1..15 counts are reported under test6 and were not used as a refusal.

No strip,9px/36px strip sheets or P1/P3 overlay was assembled because all four poses must pass first. Accepted copies: poses/lumberjack-back-walk-f0.png and poses/lumberjack-back-walk-f1.png. Raw: raw/lumberjack-back-walk-f{0,1,2}-attempt-{1,2}.png.

Fixed guide metadata passed after clean requested guide-fix merge13ee29f76291aa93e86b73728531fa2f95e90248: entry.soleRow1440 and guide bottom1451. Swing calibration matches .117342516/.033523576/.062072046 slides and .220782167/.504265932 overlaps; new shoulder targets are in checks/guide-measurements.json. All authored files are run5 only; run4 and earlier untouched. G: TEMP/TMP/npm cache used; image tool automatically saved original returns on C:, copied byte-for-byte to G: and left originals per README. No manual C: writes, application code changes or application tests.
