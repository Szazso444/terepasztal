# Big station textured-route report

Three accepted views; r3 refused after three attempts. Raw output bytes are untouched. All returned canvases are 1254 × 1254. Silhouette gaps count; outer boundaries use strict p95 ≤16 and maximum ≤32 canvas px.

| View / attempt | IoU s0 / best       | f; dx; dy                    | p95 picture / render; max        | Wall ratio / render | Overall / render    | Base; k       | White / amber | Kept  |
| -------------- | ------------------- | ---------------------------- | -------------------------------- | ------------------- | ------------------- | ------------- | ------------- | ----- |
| r0 #1          | 0.940154 / 0.949765 | 0.992000; 3.705000; 2.900000 | 16.214614 / 16.566023; 32.397870 | 0.207612 / 0.203463 | 0.717773 / 0.719952 | 909; 0.955330 | 21444 / 19    | false |

<!-- r0 #1: Refused strict silhouette p95 16.215/16.566 >16 and max32.398>32; enlarged bench/foot at left canopy corner. Both heights pass; identity, complete repaint and sun ordering pass. -->

|r0 #2|0.968457 / 0.973466|0.993000; 4.000000; 5.000000|5.930002 / 12.525560; 25.965743|0.202999 / 0.203463|0.708984 / 0.719952|906; 0.958493|21995 / 0|true|

<!-- r0 #2: All strict tests pass. Continuous limestone courses, crisp slate and canopy, six pots/three stacks, two benches and all openings retained; upper-left light, no glow/ground. -->

|r1 #1|0.598371 / 0.906050|0.850000; 13.525000; 214.350000|21.928168 / 26.899334; 55.959706|0.229851 / 0.197428|0.812069 / 0.787261|1005; 0.864075|25956 / 19|false|

<!-- r1 #1: Gross whole-building enlargement despite correct turn; IoU .90605<.92, p95 21.93/26.90>16,max55.96>32; wall ratio also too high by eye. -->

|r1 #2|0.848067 / 0.973060|0.975000; -0.700000; 52.520000|7.537725 / 9.020421; 23.718378|0.217287 / 0.213090|0.808445 / 0.787261|833; 1.042491|22981 / 0|true|

<!-- r1 #2: All strict tests pass. Three stacks/six pots, same gable openings and annex, plain back with texture-inherited small marks, no new front features; coherent courses/slates and clean canopy, left gable lighter, no glow/ground. -->

|r2 #1|0.770383 / 0.968651|0.961000; 26.500000; 83.080000|10.232059 / 9.688370; 25.491787|0.185430 / 0.179272|0.731028 / 0.705529|906; 0.958493|20394 / 3|true|

<!-- r2 #1: All strict tests pass; both plain visible walls have continuous limestone courses, no added doors/windows, same three stacks/canopy far edge/annex, all surfaces repainted with upper-left sun, no extras. -->

|r3 #1|0.762373 / 0.935815|0.900000; 80.700000; 123.100000|17.872108 / 18.704856; 28.009565|0.232143 / 0.203240|0.786870 / 0.768153|896; 0.969191|19546 / 44|false|

<!-- r3 #1: Refused p95 17.872/18.705>16; wall proportion too tall (~14.2%); small upper-gable texture opening expanded into framed attic window about twice render size. All raw retained. -->

|r3 #2|0.828482 / 0.933939|0.962000; 28.350000; 68.425000|15.582685 / 18.847372; 25.436978|0.207346 / 0.203240|0.781377 / 0.768153|844; 1.028904|22654 / 5|false|

<!-- r3 #2: Refused directed p95 15.583/18.847>16; far canopy post and bench layout deviate (max25.437 passes32). Heights, corrected tiny gable mark and all eye tests pass. -->

|r3 #3|0.719258 / 0.940149|0.976000; 5.530000; 83.190000|15.083228 / 13.095909; 32.198092|0.215311 / 0.203240|0.781443 / 0.768153|836; 1.038750|21124 / 24|false|

<!-- r3 #3: Closest refused r3: maximum32.198>32 (p95 15.083/13.096 and IoU.940149 pass). Plain gable tiny texture mark has become a framed green attic window; identity also refused. Heights pass. Raw only; no accepted r3. -->

Cream limestone, slate and canopy surfaces read as one painting without cloned texture patches or seams. Roofs and hidden walls retain the same hand. The canopy posts, benches and small gable mark drift in r3; no r3 is accepted.

The closest r3 is attempt3, raw only: maximum32.19809161275935 exceeds32 and its small gable mark grew into a framed window. Attempt2 has better identity but render-to-picture p95 18.84737223 exceeds16. Full exact measurements, height readings, light patch comparisons, reference correction and prompts are in prompts.json. The r1 wall-span reference was corrected to the actual opaque base (657px rather than nominal model width709.12); the historical first reading remains recorded.
