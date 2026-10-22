# town textured-route report

Three accepted views(r0,r1,r3); r2 refused after three attempts. Brick, limestone and slate read as one coherent painting with crisp glazing and cupola. The hidden far clock-gable and near base corner still drift in r2.

Notes: Closest refused r2 is raw/town-r2-attempt-2.png: identity/heights pass, p95picture16.690484273418168>16. Render back has no green door despite prose; render layout wins.

| View / attempt | Returned  | IoU s0 / best       | f; dx; dy                       | p95 picture / render; max        | Wall ratio / render | Overall / render    | Base; k       | White / amber | Kept  |
| -------------- | --------- | ------------------- | ------------------------------- | -------------------------------- | ------------------- | ------------------- | ------------- | ------------- | ----- |
| r0 #1          | 1254x1254 | 0.976445 / 0.977031 | 1.001000; -1.500000; -1.500000  | 6.526169 / 6.526169; 9.924284    | 0.421986 / 0.431655 | 1.108235 / 1.099138 | 846; 0.976445 | 10066 / 9     | true  |
| r1 #1          | 1254x1254 | 0.821616 / 0.967636 | 0.921000; 40.120000; 102.060000 | 9.256697 / 9.041895; 21.018947   | 0.409190 / 0.431034 | 1.127869 / 1.099138 | 914; 0.903799 | 7262 / 0      | true  |
| r2 #1          | 1254x1254 | 0.887769 / 0.932456 | 0.988000; -2.175000; 31.000000  | 50.355795 / 21.960783; 96.262109 | 0.403734 / 0.431034 | 1.141026 / 1.114943 | 857; 0.963912 | 9607 / 0      | false |
| r2 #2          | 1254x1254 | 0.760316 / 0.953906 | 0.914000; 33.775000; 127.585000 | 16.690484 / 15.628487; 27.580534 | 0.433514 / 0.431034 | 1.157667 / 1.114943 | 925; 0.893051 | 5972 / 0      | false |
| r2 #3          | 1254x1254 | 0.762236 / 0.934853 | 0.871000; 70.985000; 138.015000 | 32.813481 / 22.539703; 67.214941 | 0.421053 / 0.431034 | 1.168041 / 1.114943 | 969; 0.852500 | 6903 / 6      | false |
| r3 #1          | 1254x1254 | 0.894421 / 0.961172 | 0.990000; 2.805000; 36.880000   | 9.898023 / 9.898023; 25.181128   | 0.425030 / 0.431034 | 1.140330 / 1.114943 | 847; 0.975292 | 5085 / 24     | true  |

- r0 attempt1: All strict silhouette/height/eye tests pass; cupola gaps/bell, clock/portico, two planters/lanterns,2chimney stacks and window rhythm retained; coherent crisp brick/limestone/slate repaint.
- r1 attempt1: All strict silhouette/height/eye tests pass. Back has render windows(3upper,2lower), no new door: prose plain-green-door instruction yields to render. Four end windows/attic, cupola/bell gaps and2chimneys retained; seamless brick/stone/slate.
- r2 attempt1: Refused outline p9550.356/21.961>16,max96.262>32 despite IoU.932456. Far front-clock-gable silhouette removed and back green door added against render; identity/noextras fail. Both heights pass.
- r2 attempt2: Refused picture-to-render p9516.690484>16; IoU.953906,reversep9515.628,max27.581 pass. Main near-corner foot too low; corrected far gable/back-no-door and heights/eye pass.
- r2 attempt3: Refused outline p9532.813/22.540>16,max67.215>32; farclockgable peak moved down/behind cupola against render. IoU.934853 and both heights pass. Closest refused r2 is attempt2(raw only), whose p9516.6905 narrowly fails and identity passes.
- r3 attempt1: All strict silhouette/height/eye tests pass.2planters/lanterns and clock/portico on front,4endwindows/attic,cupola/bell gaps and2chimneys retained; cohesive brick/stone/slate painting.

Exact numbers, height readings, light patch ratios, eye verdicts, prompts and hashes are in prompts.json. Accepted images match raw bytes; no returned picture was transformed.
