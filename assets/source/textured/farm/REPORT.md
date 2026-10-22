# farm textured-route report

All three turned views accepted; existing r0 untouched. Timber/slate/stone and curved silo fittings form one coherent painting. Initial outputs enlarged the small render; corrections restored its shape and empty margins.

Notes: Accepted r1#2,r2#2,r3#2; three refused attempts raw. Farm silhouette fills enclosed holes as its prompt specifies; strict outline/height thresholds unchanged.

| View / attempt | Returned  | IoU s0 / best       | f; dx; dy                        | p95 picture / render; max           | Wall ratio / render | Overall / render    | Base; k       | White / amber | Kept  |
| -------------- | --------- | ------------------- | -------------------------------- | ----------------------------------- | ------------------- | ------------------- | ------------- | ------------- | ----- |
| r1 #1          | 1254x1254 | 0.437181 / 0.692676 | 0.850000; 46.050000; 237.925000  | 79.057298 / 78.776621; 82.619383    | 0.393419 / 0.371134 | 1.047361 / 1.056075 | 699; 0.782629 | 2736 / 5      | false |
| r1 #2          | 1254x1254 | 0.896296 / 0.982878 | 1.011000; -4.885000; 8.385000    | 4.846213 / 4.846213; 5.653915       | 0.387841 / 0.371134 | 1.054054 / 1.056075 | 477; 1.146871 | 789 / 1       | true  |
| r2 #1          | 1254x1254 | 0.656605 / 0.911820 | 0.850000; 82.275000; 160.950000  | 18.253119 / 18.253119; 22.283050    | 0.260057 / 0.282895 | 0.876389 / 0.882353 | 696; 0.786002 | 1416 / 6      | false |
| r2 #2          | 1254x1254 | 0.718399 / 0.977821 | 1.045000; -38.350000; -96.475000 | 5.469960 / 7.032806; 16.558054      | 0.265683 / 0.282895 | 0.874776 / 0.882353 | 542; 1.009331 | 822 / 2       | true  |
| r3 #1          | 1254x1254 | 0.341347 / 0.502677 | 0.850000; 16.875000; 256.175000  | 157.883864 / 148.944210; 174.094507 | 0.297500 / 0.311856 | 1.146789 / 1.128505 | 800; 0.683822 | 2155 / 244    | false |
| r3 #2          | 1254x1254 | 0.726865 / 0.969643 | 0.929000; 32.680000; 115.315000  | 7.086689 / 7.861976; 14.173378      | 0.314453 / 0.311856 | 1.163375 / 1.128505 | 512; 1.068472 | 1222 / 3      | true  |

- r1 attempt1: Refused oversized silhouette: f.85 minimum,IoU.692676<.92,p9579.057/78.777>16,max82.619>32. Both height ratios pass; painting/identity/light pass.
- r1 attempt2: All strict silhouette/height/eye tests pass. Exact small render camera/position held; no added openings; one dormer/chimney,near-corner round silo/pipe/spout, plain plank walls retained with crisp coherent painting.
- r2 attempt1: Refused oversize f.85minimum,IoU.911820<.92,p95both18.253>16; max22.283 passes. Wall ratio.260057 versus.282895 is -8.073% outside8%; overall passes.
- r2 attempt2: All strict silhouette/height/eye tests pass. Small camera held; plain walls no openings, far dormer/chimney, left silo with pipe and spout retained. Continuous planks/stone/slates and crisp curved fittings.
- r3 attempt1: Refused huge enlargement f.85minimum,IoU.502677<.92,p95157.884/148.944>16,max174.095>32. Heights/eye pass; reported amber244 not a refusal rule.
- r3 attempt2: All strict silhouette/height/eye tests pass. Gable hatch, far silo/finial/dormer and one chimney stay in render layout; no new openings. Coherent crisp timber/stone/slate.

Exact numbers, height readings, light patch ratios, eye verdicts, prompts and hashes are in prompts.json. Accepted images match raw bytes; no returned picture was transformed.
