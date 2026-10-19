# Depot a0 r3 repaint, issues #325 and #536

Outcome: rejected after all three permitted built-in imagegen calls. None passed every test. No replacement r3 accepted and no fit, camera check, or geometric distortion was applied to the refused paintings because width failed first.

All returned PNGs are preserved byte for byte at raw/depot-a0-r3-attempt-{1,2,3}.png. All returned 1536 x 1024 RGBA. Guide verified 1536 x 1024. Exact prompts and reference order are in returns.json and depot-a0-r3-prompts.json.

Approximate measurements read by eye on the saved crops, in returned-image pixels. Door leaves obscure some wall-foot corners; these estimates are adequate to reject the widths, each decisively above 758. Feet below are visual estimates, not results from building-fit.

| Attempt | Base width, limit 686–758 | Left/right feet | Ratio | Wall height/base width | Camera error | White/amber opaque pixels |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ~848 | ~442 / 406 | 1.089 | ~238/848 = 0.281 | not measured: width failed | 0 / 0 |
| 2 | ~1083 | ~521 / 562 | 0.927 | ~227/1083 = 0.210 | not measured: width failed | 0 / 0 |
| 3 | ~895 | ~470 / 425 | 1.106 | ~207/895 = 0.231 | not measured: width failed | 0 / 0 |

Fitted r0 visual wall-height reference ~187/735 = 0.254, acceptable range ~0.216–0.293. Fitted r0 highlight counts 0/0. No painting retained as generated. Attempt 1 is the closest on width and preserved in raw; its roof/vent direction also does not agree with the required turned hall. Attempts 2 and 3 show the portal wall on lower left and front on lower right, but remain too wide.

Recovery: requested branch c2b648e2 had none of the four depot PNGs and all four queue entries pending. After the user authorized continuation, copied existing a0 r0–r3 from G:/DEV/Terepasztal/terepasztal/assets/source/buildings-v2/depot. r0–r2 are byte-identical copies, with prior generated status and attempt counts restored using the queue module API. Original r3 retained as raw/depot-a0-r3-original.png. No other pictures repainted or put back.

Queue redo dry-run named one dependent; used set r3 pending without --yes. r2 stayed generated. Final set r3 rejected with 3 attempts. Family check: r0 and r1 pass; existing r2 fails camera at 3.0 degrees and remains untouched. Review sheet: review/depot.png, viewed; r3 is blank because rejected. Existing unrelated concurrent fuel_stop edits excluded from this commit.
