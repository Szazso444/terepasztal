# Power plant rotations — stopped after r1

Issue #535, branch `art/535-rotations`. Built-in image_gen edits of the original guide, with the exact requested A/B/C prompt and one replacement correction per retry. Guides stayed outside the repository. Master SHA-256 matched before painting and remained unchanged.

| View | Attempt | Returned    | Ground width | Allowed    | Result        |
| ---- | ------- | ----------- | ------------ | ---------- | ------------- |
| r1   | 1       | 1536 × 1024 | 1250 px      | 688–760 px | FAIL          |
| r1   | 2       | 1536 × 1024 | 872 px       | 688–760 px | FAIL; closest |
| r1   | 3       | 1536 × 1024 | 1033 px      | 688–760 px | FAIL          |

All three failed the first gate. Per the requested stop rule, r3 and r2 were not painted. Foot ratio, camera slopes/error, height comparison, highlight comparison and visual acceptance were skipped after width refusal. No view passed every test.

`power_plant-r1.png` is the byte-for-byte copy of attempt 2, explicitly `kept: false` in `prompts.json`. Every raw returned image is preserved unchanged. Automatic and manually read outer foot corners are both in the log: quoin steps and the annex caused the automatic width to exclude grounded walls. The manually read total includes all grounded walls and the annex.

The r0 reference wall-height/base-width ratio is 292/1252 = 0.2332268371. Its opaque near-white count is 1943 and near-amber count is 0. The hall's near foot is (826,986), and its eaves are at y694; the annex corrupts automatic near-corner detection.

`measure-power.mjs` uses the repository's PNG decoding, pictureOf, measureBase and checkFile with this job's footprint numbers. The existing shared measure.mjs had other concurrent jobs' footprint numbers and was left untouched. Full prompts, reference order, returned sizes, raw hashes, corrections and results are in prompts.json.

The requested building-sheets command was run against the kept filename; it refused it as “not a building picture's name”. A native-size alpha composite on grass was inspected in `.look/` instead. That preview is not committed and does not alter the returned art.

Validation: typecheck, lint and Vite build passed. Repository formatting reports 401 pre-existing files; task code and JSON were formatted. The full test run was stopped after failures in existing building guide fixtures, ownLength and gameSave tests. No application code or fixtures were changed. Art scope passed.
