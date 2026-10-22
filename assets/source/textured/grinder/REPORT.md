# Grinder textured painting report

Accepted r0 attempt2 only. Closest refused: r1 attempt2, r2 attempt2, r3 attempt3; all remain raw only. Eleven calls, no per-building stop fired.

| View/attempt | Size      | IoU s0   | f,dx,dy                       | Best IoU | p95 picture/render    | max        | Wall vs bare      | Overall vs bare   | Base,k               | white,amber | Kept  |
| ------------ | --------- | -------- | ----------------------------- | -------- | --------------------- | ---------- | ----------------- | ----------------- | -------------------- | ----------- | ----- |
| r0/1         | 1254x1254 | 0.268040 | 0.850000,50.975000,270.600000 | 0.384544 | 205.798651/194.809462 | 226.105402 | 0.316336/0.394397 | 0.936792/0.920430 | 1059.000000,0.550623 | 6587,0      | false |
| r0/2         | 1254x1254 | 0.785953 | 0.989000,5.315000,47.785000   | 0.980416 | 4.814438/4.814438     | 18.183480  | 0.419130/0.394397 | 0.918403/0.920430 | 575.000000,1.014104  | 2783,1      | true  |
| r1/1         | 1254x1254 | 0.630108 | 0.850000,48.850000,173.050000 | 0.887274 | 54.759358/44.087216   | 59.848782  | 0.428094/0.518414 | 1.118531/1.271709 | 598.000000,0.975100  | 1728,0      | false |
| r1/2         | 1254x1254 | 0.628057 | 0.850000,34.650000,178.575000 | 0.942816 | 23.056572/22.916043   | 34.969662  | 0.448718/0.518414 | 1.193784/1.271709 | 546.000000,1.067967  | 1711,0      | false |
| r1/3         | 1254x1254 | 0.387244 | 0.850000,19.775000,265.250000 | 0.672000 | 93.073012/86.291186   | 101.642689 | 0.482866/0.518414 | 1.219285/1.271709 | 642.000000,0.908271  | 714,0       | false |
| r2/1         | 1254x1254 | 0.400620 | 0.850000,23.975000,259.375000 | 0.618802 | 116.786146/93.201833  | 124.593817 | 0.393728/0.384120 | 0.935035/0.926882 | 861.000000,0.677247  | 2442,0      | false |
| r2/2         | 1254x1254 | 0.580339 | 0.958000,19.660000,119.580000 | 0.980539 | 5.114323/5.114323     | 8.086455   | 0.362729/0.384120 | 0.903654/0.926882 | 601.000000,0.970233  | 882,0       | false |
| r2/3         | 1254x1254 | 0.608601 | 0.850000,64.675000,185.750000 | 0.859780 | 30.742096/30.742096   | 36.518877  | 0.372253/0.384120 | 0.920439/0.926882 | 728.000000,0.800975  | 2447,0      | false |
| r3/1         | 1254x1254 | 0.482747 | 0.850000,43.450000,223.600000 | 0.722177 | 62.452272/58.436522   | 73.973168  | 0.400598/0.513966 | 1.216418/1.397759 | 669.000000,0.871614  | 2773,0      | false |
| r3/2         | 1254x1254 | 0.322227 | 0.850000,24.450000,248.025000 | 0.458265 | 176.767051/175.816860 | 191.235331 | 0.384168/0.513966 | 1.146512/1.397759 | 859.000000,0.678824  | 5881,0      | false |
| r3/3         | 1254x1254 | 0.549531 | 0.850000,54.225000,204.450000 | 0.785216 | 40.349001/40.349001   | 49.594338  | 0.487521/0.513966 | 1.333887/1.397759 | 601.000000,0.970233  | 2698,0      | false |

- r0 attempt1: Refused gross enlargement: best IoU .384544, p95 205.799/194.809, maximum226.105; wall proportion differs, though overall ratio passes.
- r0 attempt2: Accepted: outline and both height proportions pass; crisp courses/roof, hopper and two millstones retained, no seams/glow/extras.
- r1 attempt1: Refused enlargement/width: IoU .88727; p95 54.759/44.087,max59.849; overall height ratio -12.05% and wall ratio low.
- r1 attempt2: Refused p95 23.057/22.916 and max34.970; hopper and millstone front pulled into lower-left wall instead of hidden behind roof; gable window lost.
- r1 attempt3: Refused enlarged outline IoU .6720,p95 93.073/86.291,max101.643; corrected gable window/layout but still outside fit.
- r2 attempt1: Refused enlarged silhouette IoU.61880,p95 116.786/93.202,max124.594; added a full front arch/millstone assembly onto visible plain gable instead of the partial hidden parts in render.
- r2 attempt2: Outline and heights pass, but added a full green door on the visible back of the lean-to shed: render has plain red brick there.
- r2 attempt3: Refused outline IoU.85978,p95 30.742/30.742,max36.519; door corrected but added full arch and millstones on visible gable instead of partial hidden mounts.
- r3 attempt1: Refused enlarged/widened silhouette IoU.72218,p95 62.452/58.437,max73.973; overall ratio12.97% low; added window to plain left gable.
- r3 attempt2: Severely enlarged: silhouette and overall/wall height fail.
- r3 attempt3: Outline fails despite overall and wall proportions within8%; closest refused r3 attempt3.

The retained r0 reads as one coherent stone-and-slate painting, with crisp hopper fittings and the render light preserved. Later views often repaint materials convincingly, but the tool enlarges the building, alters its proportions, or invents a shed door/front machinery; none is silently accepted. Wall heights use exposed matching house corners where machinery occludes the nearest corner, with coordinates and uncertainty recorded in prompts.json; highlight counts, base scale and light samples are reports only.

Raw files are untouched tool bytes; accepted r0 is a byte copy. Full prompts, ordered references, hashes, measurements and eye decisions are in prompts.json; the original reference has2337 near-white and0 amber pixels.
