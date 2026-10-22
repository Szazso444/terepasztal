# colliery textured painting report

STOP after r3: every attempt of r2 and r3 has IoU below0.80. Accepted only r1 attempt3; r0/r2/r3 closest refused attempts3/2/3 remain raw. The material repaint produces crisp timber, iron, slate and brick with coherent hidden surfaces, but enlargement and invented windows/parts persist; r3 required engine-house wall-height comparison is unavailable because the bare corner is completely hidden, so it cannot be accepted. Alpha-composited previews verified that the apparent broad haze is invisible RGB under alpha0, and the earlier notes retain audit corrections.

| View/attempt | Size      | IoU s0   | f,dx,dy                        | Best IoU | p95 picture/render    | max        | Part height vs bare | Overall vs bare   | Base,k               | white,amber | Kept  |
| ------------ | --------- | -------- | ------------------------------ | -------- | --------------------- | ---------- | ------------------- | ----------------- | -------------------- | ----------- | ----- |
| r0/1         | 1536x1024 | 0.294149 | 0.850000,133.125000,148.325000 | 0.403885 | 188.855596/167.162354 | 198.879213 | 0.173647/0.219963   | 0.777551/0.780443 | 979.000000,0.556977  | 328,18      | false |
| r0/2         | 1536x1024 | 0.301086 | 0.850000,119.475000,169.175000 | 0.426439 | 168.875786/157.004838 | 185.871184 | 0.176656/0.219963   | 0.764706/0.780443 | 951.000000,0.573375  | 77,10       | false |
| r0/3         | 1536x1024 | 0.546769 | 0.850000,103.450000,99.825000  | 0.762596 | 41.594517/72.379240   | 95.671005  | 0.166667/0.219963   | 0.755994/0.780443 | 708.000000,0.770169  | 102,67      | false |
| r1/1         | 1536x1024 | 0.297897 | 0.850000,23.550000,187.750000  | 0.397456 | 156.116362/151.769266 | 181.592342 | 0.195090/0.168591   | 1.157419/1.191244 | 774.000000,0.704496  | 140,1       | false |
| r1/2         | 1536x1024 | 0.474758 | 0.850000,64.200000,174.425000  | 0.700487 | 69.451634/68.235294   | 73.883852  | 0.207317/0.168591   | 1.203478/1.191244 | 574.000000,0.949965  | 4,0         | false |
| r1/3         | 1536x1024 | 0.914916 | 0.996000,1.000000,2.500000     | 0.922409 | 7.028112/7.099466     | 16.619423  | 0.168203/0.168591   | 1.202299/1.191244 | 434.000000,1.256406  | 0,0         | true  |
| r2/1         | 1536x1024 | 0.242144 | 0.850000,98.675000,164.400000  | 0.360747 | 194.726318/165.510639 | 235.858148 | 0.145978/0.151571   | 0.798611/0.835793 | 1007.000000,0.541490 | 183,0       | false |
| r2/2         | 1536x1024 | 0.384433 | 0.850000,98.650000,157.700000  | 0.645987 | 62.352941/59.455429   | 76.352851  | 0.137203/0.151571   | 0.805007/0.835793 | 758.000000,0.719367  | 1,0         | false |
| r2/3         | 1536x1024 | 0.345010 | 0.850000,97.175000,162.175000  | 0.581739 | 91.794867/62.982394   | 135.232723 | 0.133758/0.151571   | 0.814249/0.835793 | 785.000000,0.694624  | 20,1        | false |
| r3/1         | 1536x1024 | 0.197597 | 0.850000,28.075000,238.475000  | 0.329811 | 232.953060/187.708823 | 300.976496 | null/null           | 0.865979/1.011521 | 969.000000,0.562724  | 0,0         | false |
| r3/2         | 1536x1024 | 0.460163 | 0.850000,111.725000,170.325000 | 0.717965 | 49.032155/46.882021   | 67.634270  | null/null           | 1.060932/1.011521 | 557.000000,0.978959  | 93,1        | false |
| r3/3         | 1536x1024 | 0.551578 | 0.850000,103.000000,134.100000 | 0.793315 | 27.058824/27.464982   | 49.467755  | null/null           | 1.033395/1.011521 | 538.000000,1.013532  | 5,2         | false |

- r0 attempt1: Enlarged outline IoU0.4039,p95188.86/167.16,max198.88; broad glow/ground haze added, house wall proportion too short. Audit correction: alpha-composited scratch preview shows the apparent broad glow is RGB beneath alpha0, invisible in actual use; no visible haze. The outline/height failures remain.
- r0 attempt2: Still enlarged IoU0.4264,p95168.88/157.00,max185.87, broad opaque haze/glow persists; wall proportion too short. Audit correction: alpha-composited scratch preview shows the apparent broad glow is RGB beneath alpha0, invisible in actual use; no visible haze. The outline/height failures remain.
- r0 attempt3: Closest refused r0 attempt3: enlarged outline IoU0.7626,p9541.59/72.38,max95.67 and house wall proportion too short.
- r1 attempt1: Enlarged silhouette IoU0.3975,p95156.12/151.77,max181.59 and wall height proportion high.
- r1 attempt2: IoU0.7005,p9569.45/68.24,max73.88; house wall ratio high and new green door on plain right gable absent in render.
- r1 attempt3: Accepted all tests: IoU0.92241,p957.03/7.10,max16.62; small original layout, plain right gable, coherent repainted surfaces and open lattice.
- r2 attempt1: Enlarged IoU0.3607,p95194.73/165.51,max235.86; reopens headhouse upper windows absent on these back faces in render.
- r2 attempt2: IoU0.6460,p9562.35/59.46,max76.35; added dark downpipe at near engine-house corner absent from render, wall proportion low.
- r2 attempt3: IoU0.5817,p9591.79/62.98,max135.23; headhouse back windows reopened and house wall ratio low. Closest refused r2 attempt2.
- r3 attempt1: IoU0.3298,p95232.95/187.71,max300.98; overall height fails, adds second chimney and exposes engine-house front absent from this render. Required wall height unavailable.
- r3 attempt2: IoU0.7180,p9549.03/46.88,max67.63; only two coal hoppers shown instead of three, headhouse back window opened, required wall height unavailable.
- r3 attempt3: Closest refused r3 attempt3: IoU0.79331,p9527.06/27.46,max49.47; opened headhouse back windows; required wall height unavailable. STOP: all three attempts of r2 and r3 belowIoU0.80.

Outcomes: {"r0":{"closestRefused":3,"kept":false},"r1":{"accepted":3},"r2":{"closestRefused":2,"kept":false},"r3":{"closestRefused":3,"kept":false}}. Full prompts, ordered references, raw hashes, eye coordinates and decisions are in prompts.json. Raw bytes are untouched; accepted files are exact byte copies. Highlight counts, base/k and wall light samples are reports only.
