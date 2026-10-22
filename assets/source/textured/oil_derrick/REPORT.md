# oil_derrick textured painting report

Accepted r0 attempt3 and r3 attempt1, ten calls total. Steel lattice, curved horse head, tank, flywheel and pipes repaint crisply and coherently in the original hand, with the render light and see-through gaps preserved in the kept views. r1 adds fittings despite close geometry; r2 repeatedly misses the strict0.88 outline or32px maximum and sometimes raises the post pivot; these remain refused without rounding thresholds. Height coordinates identify matched bare support top-plate/pivot and near foot, separately from painted bearing motifs on the beam.

| View/attempt | Size      | IoU s0   | f,dx,dy                       | Best IoU | p95 picture/render  | max       | Part height vs bare | Overall vs bare   | Base,k              | white,amber | Kept  |
| ------------ | --------- | -------- | ----------------------------- | -------- | ------------------- | --------- | ------------------- | ----------------- | ------------------- | ----------- | ----- |
| r0/1         | 1254x1254 | 0.464580 | 0.875000,32.360000,150.300000 | 0.919484 | 12.451004/12.520758 | 32.650142 | 0.623444/0.605187   | 1.077710/1.077574 | 964.000000,0.959362 | 537,1       | false |
| r0/2         | 1254x1254 | 0.483678 | 0.870000,14.600000,123.410000 | 0.868152 | 18.488387/18.889074 | 41.818016 | 0.625652/0.605187   | 1.074566/1.077574 | 959.000000,0.964364 | 756,129     | false |
| r0/3         | 1254x1254 | 0.544226 | 0.899000,46.000000,126.800000 | 0.938651 | 5.449968/5.449968   | 8.225260  | 0.607555/0.605187   | 1.063852/1.077574 | 953.000000,0.970435 | 740,54      | true  |
| r1/1         | 1254x1254 | 0.620295 | 0.949000,28.925000,85.300000  | 0.919829 | 8.117667/9.267556   | 23.232715 | 0.610932/0.600275   | 1.043897/1.041152 | 933.000000,0.991238 | 531,69      | false |
| r1/2         | 1254x1254 | 0.542837 | 0.888000,42.915000,154.255000 | 0.900789 | 15.304859/14.969676 | 45.978993 | 0.639029/0.600275   | 1.070707/1.041152 | 989.000000,0.935111 | 240,21      | false |
| r1/3         | 1254x1254 | 0.706236 | 0.996000,-11.905000,36.755000 | 0.927025 | 10.658263/9.906483  | 14.318351 | 0.620922/0.600275   | 1.043820/1.041152 | 889.000000,1.040298 | 274,43      | false |
| r2/1         | 1254x1254 | 0.853629 | 0.997000,7.670000,6.255000    | 0.879114 | 9.896547/10.647573  | 28.771655 | 0.710843/0.621234   | 1.378596/1.351199 | 830.000000,1.114247 | 494,54      | false |
| r2/2         | 1254x1254 | 0.819299 | 0.977000,10.090000,9.100000   | 0.853038 | 13.477040/15.968138 | 42.757245 | 0.612717/0.621234   | 1.350000/1.351199 | 865.000000,1.069162 | 832,37      | false |
| r2/3         | 1254x1254 | 0.811364 | 0.960000,27.400000,29.260000  | 0.879210 | 10.826515/11.090615 | 34.035086 | 0.711472/0.621234   | 1.345898/1.351199 | 863.000000,1.071640 | 537,151     | false |
| r3/1         | 1254x1254 | 0.865072 | 0.993000,-4.500000,18.500000  | 0.944423 | 6.262780/6.629944   | 14.361609 | 0.448161/0.460165   | 1.299555/1.296296 | 897.000000,1.031020 | 410,24      | true  |

- r0 attempt1: IoU0.91948 and p9512.45/12.52 pass, but max32.65014 exceeds32canvaspx at wellhead/base right edge.
- r0 attempt2: IoU0.86815 below0.88, p9518.49/18.89 above16,max41.82 above32 at wellhead/base.
- r0 attempt3: Accepted all tests: thin crisp repainted steel/copper, exact machinery and open gaps as render; IoU0.93865,p955.45/5.45,max8.23.
- r1 attempt1: Machine tests pass but adds a loose spanner-shaped rod on front skid beside Samson foot and vent slots in beam end absent from render.
- r1 attempt2: IoU0.90079,p9515.30/14.97 pass; maximum45.98 exceeds32 near rear tank footprint.
- r1 attempt3: Machine shape/height pass but reintroduces engraved vent slots at beam end and loose foot rod absent in first render. Closest refused r1 attempt3.
- r2 attempt1: IoU0.879114 below0.88 despite p959.90/10.65,max28.77 pass; post height/base0.71084 vs0.62123 too high.
- r2 attempt2: Post and overall heights pass; IoU0.85304 below0.88,max42.76 above32 at rear tank edge.
- r2 attempt3: Closest refused r2 attempt3: IoU0.879210<0.88,max34.04>32; post pivot raised too high relative base, height proportion fails.
- r3 attempt1: Accepted all tests: IoU0.94442,p956.26/6.63,max14.36; support proportion0.44816 vs0.46016, coherent back faces/beam/lattice and same machinery/light.

Outcomes: {"r0":{"accepted":3},"r1":{"closestRefused":3,"kept":false},"r2":{"closestRefused":3,"kept":false},"r3":{"accepted":1}}. Full prompts, ordered references, raw hashes, eye coordinates and decisions are in prompts.json. Raw bytes are untouched; accepted files are exact byte copies. Highlight counts, base/k and wall light samples are reports only.
