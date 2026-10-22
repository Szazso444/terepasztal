# ironworks textured painting report

STOP after r1: all three attempts of r0 and r1 belowIoU0.80; six calls, zero accepted, closest refused r0 attempt3 and r1 attempt2. Brick/metal/roof repaint is coherent and crisp, but the tool repeatedly copies the original large composition and alters hall proportions or fittings. Render geometry wins over prompt descriptions: actual corrected JSON holes0/2/0/1 are counted despite body text saying none, and solid brick clerestory backs remain solid rather than adding windows.

| View/attempt | Size      | IoU s0   | f,dx,dy                        | Best IoU | p95 picture/render    | max        | Part height vs bare | Overall vs bare   | Base,k               | white,amber | Kept  |
| ------------ | --------- | -------- | ------------------------------ | -------- | --------------------- | ---------- | ------------------- | ----------------- | -------------------- | ----------- | ----- |
| r0/1         | 1536x1024 | 0.352626 | 0.850000,76.650000,158.075000  | 0.492537 | 227.104537/167.806941 | 241.176471 | 0.192371/0.189112   | 0.740679/0.749642 | 1206.000000,0.603383 | 3520,6      | false |
| r0/2         | 1536x1024 | 0.352528 | 0.850000,106.300000,175.625000 | 0.494505 | 197.829048/151.600458 | 218.028283 | 0.187813/0.189112   | 0.750626/0.749642 | 1198.000000,0.607412 | 5196,3      | false |
| r0/3         | 1536x1024 | 0.435545 | 0.850000,89.150000,128.000000  | 0.602824 | 127.461236/107.116985 | 147.340906 | 0.166979/0.189112   | 0.767573/0.749642 | 1066.000000,0.682627 | 3159,2      | false |
| r1/1         | 1536x1024 | 0.437842 | 0.850000,64.300000,134.050000  | 0.612784 | 120.489199/105.816973 | 143.341246 | 0.230352/0.283133   | 1.303112/1.330661 | 738.000000,0.986016  | 832,0       | false |
| r1/2         | 1536x1024 | 0.556958 | 0.850000,91.600000,145.050000  | 0.791162 | 52.097858/47.058824   | 59.641373  | 0.259939/0.283133   | 1.311450/1.330661 | 654.000000,1.112661  | 330,0       | false |
| r1/3         | 1536x1024 | 0.533379 | 0.850000,101.975000,152.200000 | 0.760823 | 65.850833/57.550940   | 78.224236  | 0.251135/0.283133   | 1.333837/1.330661 | 661.000000,1.100877  | 818,0       | false |

- r0 attempt1: Silhouette enlarged beyond fit IoU0.4925,p95227.10/167.81,max241.18.
- r0 attempt2: Still enlarged, IoU0.4945,p95197.83/151.60,max218.03.
- r0 attempt3: Closest refused r0 attempt3: IoU0.6028,p95127.46/107.12,max147.34; hall wall proportion too short and roof/bay geometry drifts.
- r1 attempt1: Enlarged outline IoU0.6128,p95120.49/105.82,max143.34; hall wall proportion below render.
- r1 attempt2: IoU0.7912,p9552.10/47.06,max59.64; newly opens clerestory windows on solid brick back in render; geometry wins over text.
- r1 attempt3: IoU0.7608,p9565.85/57.55,max78.22; wall proportion low, hoist chain moved outside frame toward front fence. STOP: allr0/r1 attempts belowIoU0.80.

Outcomes: {"r0":{"closestRefused":3,"kept":false},"r1":{"closestRefused":2,"kept":false}}. Full prompts, ordered references, raw hashes, eye coordinates and decisions are in prompts.json. Raw bytes are untouched; accepted files are exact byte copies. Highlight counts, base/k and wall light samples are reports only.
