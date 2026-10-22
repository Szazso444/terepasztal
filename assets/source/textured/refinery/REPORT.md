# refinery textured painting report

Accepted r0 attempt2 and r2 attempt3. The repaint unifies riveted cream tanks, copper pipes and steel frames in the original hand, including the back surfaces; the accepted views retain the render light and transparent gaps. r1 exhausted with an added furnace ladder in its closest result, while r3 still missed IoU0.92 and invented a small pipe at the tank foot; neither is accepted.

| View/attempt | Size      | IoU s0   | f,dx,dy                        | Best IoU | p95 picture/render    | max        | Part height vs bare | Overall vs bare   | Base,k              | white,amber | Kept  |
| ------------ | --------- | -------- | ------------------------------ | -------- | --------------------- | ---------- | ------------------- | ----------------- | ------------------- | ----------- | ----- |
| r0/1         | 1254x1254 | 0.275511 | 0.850000,78.525000,240.925000  | 0.470365 | 135.361939/119.763085 | 150.021595 | 0.435501/0.451193   | 0.850515/0.857759 | 969.000000,0.637353 | 18868,355   | false |
| r0/2         | 1254x1254 | 0.951154 | 0.994000,3.000000,3.500000     | 0.958292 | 6.623274/4.107580     | 18.733448  | 0.433566/0.451193   | 0.849913/0.857759 | 572.000000,1.079712 | 3359,191    | true  |
| r1/1         | 1254x1254 | 0.292127 | 0.850000,23.800000,246.775000  | 0.407384 | 172.416513/109.181112 | 188.738400 | 0.561151/0.525424   | 1.797127/1.936441 | 556.000000,1.110782 | 7184,234    | false |
| r1/2         | 1254x1254 | 0.607896 | 0.910000,40.335000,145.410000  | 0.947513 | 3.589393/4.013063     | 14.934852  | 0.529595/0.525424   | 1.894410/1.936441 | 321.000000,1.923972 | 1101,192    | false |
| r1/3         | 1254x1254 | 0.280569 | 0.850000,20.175000,257.825000  | 0.415043 | 166.598801/110.717235 | 199.416763 | 0.719397/0.525424   | 1.853383/1.936441 | 531.000000,1.163079 | 3468,453    | false |
| r2/1         | 1254x1254 | 0.293933 | 0.850000,91.200000,212.075000  | 0.522762 | 106.094337/90.335562  | 133.577441 | 0.383333/0.355603   | 0.935627/0.935345 | 900.000000,0.686217 | 15892,262   | false |
| r2/2         | 1254x1254 | 0.604992 | 0.850000,86.550000,149.425000  | 0.858857 | 15.371048/15.371048   | 24.322741  | 0.378571/0.355603   | 0.931526/0.935345 | 700.000000,0.882279 | 4092,301    | false |
| r2/3         | 1254x1254 | 0.565517 | 0.850000,86.825000,176.650000  | 0.940761 | 5.173477/6.444508     | 23.236003  | 0.366617/0.355603   | 0.925595/0.935345 | 671.000000,0.920410 | 8100,98     | true  |
| r3/1         | 1254x1254 | 0.276150 | 0.850000,56.025000,260.200000  | 0.403457 | 152.171676/111.440098 | 177.361263 | 0.557223/0.648305   | 1.872659/2.080508 | 533.000000,1.158715 | 8099,197    | false |
| r3/2         | 1254x1254 | 0.440035 | 0.850000,113.175000,192.200000 | 0.646200 | 86.103812/45.152453   | 107.944169 | 0.664303/0.648305   | 2.009434/2.080508 | 423.000000,1.460035 | 3274,116    | false |
| r3/3         | 1254x1254 | 0.650553 | 0.878000,60.340000,158.900000  | 0.916369 | 11.160641/13.316339   | 29.130129  | 0.688623/0.648305   | 2.035821/2.080508 | 334.000000,1.849087 | 6149,171    | false |

- r0 attempt1: Silhouette enlarged beyond allowed fit; IoU0.4704,p95 135.36/119.76,max150.02.
- r0 attempt2: Accepted all tests: exact small layout, transparent steel gaps, coherent repainted pipes/tanks/fittings.
- r1 attempt1: Enlarged beyond allowed fit: IoU0.4074,p95172.42/109.18,max188.74.
- r1 attempt2: Machine tests pass but adds a yellow ladder down the front-right furnace platform corner, absent in textured render.
- r1 attempt3: Enlarged silhouette and swaps tank/column lateral relationship; tank height proportion fails. Closest refused r1 attempt2 has added furnace ladder.
- r2 attempt1: Enlarged silhouette: IoU0.5228,p95106.09/90.34,max133.58.
- r2 attempt2: IoU0.8589 below0.92; fit reaches minimum f0.85 while outline is still too large.
- r2 attempt3: Accepted all tests; furnace back panels and tank surfaces coherent, pipe stub and frame gaps match render.
- r3 attempt1: Enlarged outline, tank and overall proportions fail; furnace shifted right of column rather than hidden left/back.
- r3 attempt2: Outline enlarged: IoU0.6462,p9586.10/45.15,max107.94; adds small yellow peg atop tank end and vertical ground pipe not in render.
- r3 attempt3: Closest refused r3 attempt3: IoU0.91637 below0.92; new thin vertical pipe at front tank foot remains absent from render.

Outcomes: {"r0":{"accepted":2},"r1":{"closestRefused":2,"kept":false},"r2":{"accepted":3},"r3":{"closestRefused":3,"kept":false}}. Full prompts, ordered references, raw hashes, eye coordinates and decisions are in prompts.json. Raw bytes are untouched; accepted files are exact byte copies. Highlight counts, base/k and wall light samples are reports only.
