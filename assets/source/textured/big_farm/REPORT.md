# big_farm textured-route report

All four views accepted. Timber, slate and stone form one coherent painting, with crisp round silo/pipe and no cloned seams. The dock/ramp initially drifted at r3; its final attempt restored the shape and sacks.

Notes: Render back-wall window retained despite prose plain-back: render geometry wins. Accepted r0#1,r1#2,r2#1,r3#3; three refused attempts kept raw.

| View / attempt | Returned  | IoU s0 / best       | f; dx; dy                       | p95 picture / render; max        | Wall ratio / render | Overall / render    | Base; k        | White / amber | Kept  |
| -------------- | --------- | ------------------- | ------------------------------- | -------------------------------- | ------------------- | ------------------- | -------------- | ------------- | ----- |
| r0 #1          | 1254x1254 | 0.713141 / 0.975615 | 0.863000; 89.830000; 157.170000 | 8.463239 / 10.408408; 27.440348  | 0.272640 / 0.289009 | 0.810858 / 0.801242 | 1038; 0.815462 | 1945 / 0      | true  |
| r1 #1          | 1254x1254 | 0.510422 / 0.837029 | 0.850000; 72.000000; 269.550000 | 45.162672 / 43.824759; 54.140684 | 0.307774 / 0.339172 | 0.983947 / 0.914530 | 939; 0.901438  | 3460 / 0      | false |
| r1 #2          | 1254x1254 | 0.832490 / 0.986187 | 0.992000; 2.775000; 47.495000   | 4.432919 / 4.432919; 11.196354   | 0.315653 / 0.339172 | 0.917824 / 0.914530 | 773; 1.095019  | 2074 / 0      | true  |
| r2 #1          | 1254x1254 | 0.843039 / 0.982876 | 0.933000; 8.750000; 79.800000   | 6.126590 / 6.371750; 22.141690   | 0.281628 / 0.300287 | 0.745489 / 0.741615 | 909; 0.931188  | 3173 / 0      | true  |
| r3 #1          | 1254x1254 | 0.752638 / 0.955958 | 0.945000; 27.100000; 101.810000 | 17.021055 / 15.863009; 24.744435 | 0.303269 / 0.297218 | 0.987925 / 0.962963 | 887; 0.954284  | 4872 / 0      | false |
| r3 #2          | 1254x1254 | 0.785393 / 0.962886 | 0.922000; 40.180000; 107.080000 | 18.172411 / 15.843331; 33.608780 | 0.306416 / 0.297218 | 0.988172 / 0.962963 | 904; 0.936338  | 1430 / 0      | false |
| r3 #3          | 1254x1254 | 0.586778 / 0.973963 | 0.850000; 73.625000; 215.050000 | 9.890914 / 9.890914; 16.584089   | 0.299595 / 0.297218 | 0.969307 / 0.962963 | 988; 0.856731  | 2294 / 0      | true  |

- r0 attempt1: All strict silhouette, both height proportions and eye tests pass; one dormer/chimney, round silo/hoops/pipe, dock/ramp/crates/sacks and long-wall openings retained; coherent plank/stone/slate surfaces.
- r1 attempt1: Refused silhouette IoU.837029<.92, p95 45.163/43.825>16,max54.141>32; oversized output requires f below allowed range. Wall .307774 versus.339172 is -9.25%, outside8%; overall+7.59% passes.
- r1 attempt2: All strict silhouette/height/eye tests pass. Silo stays near corner with downpipe/spout; plain rear gable and partially occluded long-wall door, dormer and chimney retain render layout; crisp continuous timber/stone/slate.
- r2 attempt1: All strict silhouette/height/eye tests pass. Render back-wall window and braces retained despite prose plain-back description; render geometry wins. Far dock and dormer, silo, one chimney stay in place; surfaces continuously repainted.
- r3 attempt1: Refused picture-to-render p95 17.021>16; IoU.955958,p95reverse15.863,max24.744 and heights/eye pass. Dock platform/ramp/feet protrude from render outline.
- r3 attempt2: Refused picture-to-render p95 18.172>16 and maximum33.609>32; IoU.962886/reversep9515.843 pass; dock/ramp feet protrude. Sacks under dock canopy lost among crates; identity fails. Heights pass.
- r3 attempt3: All strict silhouette/height/eye tests pass at allowed f.85. Dock/ramp and feet fit, sacks/crates restored, far silo/dormer and one chimney retained. Back-wall window follows textured render despite prose plain-back; geometry wins.

Exact numbers, height readings, light patch ratios, eye verdicts, prompts and hashes are in prompts.json. Accepted images match raw bytes; no returned picture was transformed.
