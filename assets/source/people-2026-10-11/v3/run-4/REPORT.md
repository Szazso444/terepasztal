# R7c-1 run 4

Result: stopped during required preflight, before any image calls (0/12). No pose accepted or refused, no raw returns. No P1-P4 paintings, strips, sheets or overlays produced.

The required merges succeeded: origin/develop was already an ancestor; origin/claude/people-guide-p1-fix merged cleanly as 1fe810b5a768f529db7d0e221995923f4fb1e852. No rebase replay was performed.

CORE REVIEW 1 header requires: check that assets/source/people-v3-guides/manifest.json has a soleRow of 1440 for back-shoulder-p1.png and guide lowest opaque row1440..1456. The back-shoulder-p1 entry has no soleRow field at all. It has top483, bottom1451, headTop483 and groundPoint[512,1443].

The PNG itself passes: measured lowest opaque row1451; independently computed lowest row with at least36 opaque pixels is1440. This computed value was not substituted for the missing required manifest field. No local guide/manifest repair or image call was made. Parent confirmed to honour preflight stop. Core must provide metadata consistent with the prompt or revise the explicit check before another run.

Swing calibration reproduces supplied figures: right f .1105911,-.0067514,-.0402749; left P3/P4 .0768918,.0148198; slides .1173425,.0335236,.0620720; overlaps .2207822,.5042659. Full new shoulder targets and every measured guide number are in checks/guide-measurements.json; full missing-field evidence is checks/preflight.json. Reproduce with node assets/source/people-2026-10-11/v3/run-4/measure-preflight.mjs (read-only on guides; writes run4 checks).

Only run-4 evidence was authored. Earlier runs and original measurement tools unchanged. Guide changes came exclusively from the requested upstream merge. No manual C: writes, no image tool calls, no application code authored or application tests run.
