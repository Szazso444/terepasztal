# townhouse textured-route report

Only r2 attempt3 accepted; r0,r1,r3 refused after three attempts each. Limestone/slate surfaces are coherent and crisp, including hidden plain walls. Most calls copy the larger reference size and cannot fit within f0.85..1.15; exact small shape holds only at r2.

Notes: Closest refused: r0 raw/townhouse-r0-attempt-2.png, r1 raw/townhouse-r1-attempt-3.png, r3 raw/townhouse-r3-attempt-2.png; no accepted copies for these views.12calls1accepted11refused. Preliminary r0#1 glow claim corrected by alpha-composited preview: RGB underalpha0 only, original note retained plus auditCorrection. Townhouse fills enclosed silhouette holes per its prompt. No building stop fired.

| View / attempt | Returned  | IoU s0 / best       | f; dx; dy                        | p95 picture / render; max           | Wall ratio / render | Overall / render    | Base; k       | White / amber | Kept  |
| -------------- | --------- | ------------------- | -------------------------------- | ----------------------------------- | ------------------- | ------------------- | ------------- | ------------- | ----- |
| r0 #1          | 1024x1536 | 0.209146 / 0.318884 | 0.850000; 30.950000; 325.825000  | 256.141181 / 223.727466; 275.849114 | 0.268638 / 0.261905 | 0.951479 / 0.925121 | 778; 0.481928 | 6514 / 3      | false |
| r0 #2          | 1024x1536 | 0.596864 / 0.829448 | 0.850000; 60.000000; 225.800000  | 37.647059 / 37.647059; 38.303107    | 0.275720 / 0.261905 | 0.924670 / 0.925121 | 486; 0.771481 | 3137 / 1      | false |
| r0 #3          | 1024x1536 | 0.369694 / 0.646621 | 0.850000; 36.825000; 253.125000  | 99.674210 / 97.249367; 105.941160   | 0.285455 / 0.261905 | 0.923077 / 0.925121 | 550; 0.681709 | 2379 / 0      | false |
| r1 #1          | 1024x1536 | 0.409852 / 0.742457 | 0.850000; 35.225000; 269.975000  | 54.728016 / 52.875777; 62.452750    | 0.281188 / 0.261905 | 0.960289 / 0.927361 | 505; 0.742455 | 3126 / 0      | false |
| r1 #2          | 1024x1536 | 0.442693 / 0.612566 | 0.850000; 25.825000; 172.500000  | 95.032320 / 90.588235; 106.598883   | 0.252159 / 0.261905 | 0.899682 / 0.927361 | 579; 0.647565 | 2341 / 0      | false |
| r1 #3          | 1024x1536 | 0.523848 / 0.794347 | 0.850000; 65.450000; 234.850000  | 41.892927 / 40.481531; 48.592650    | 0.262834 / 0.261905 | 0.940631 / 0.927361 | 487; 0.769897 | 3170 / 0      | false |
| r2 #1          | 1024x1536 | 0.257580 / 0.366877 | 0.850000; 24.300000; 302.450000  | 248.736600 / 195.294118; 268.237874 | 0.285130 / 0.261905 | 1.099133 / 1.092010 | 733; 0.511514 | 6287 / 0      | false |
| r2 #2          | 1024x1536 | 0.363653 / 0.503201 | 0.850000; 92.375000; 217.875000  | 151.905999 / 122.352941; 174.284499 | 0.250755 / 0.261905 | 1.030641 / 1.092010 | 662; 0.566375 | 3499 / 0      | false |
| r2 #3          | 1024x1536 | 0.784680 / 0.977054 | 0.980000; 9.190000; 52.650000    | 5.495066 / 6.122449; 11.270777      | 0.267717 / 0.261905 | 1.095238 / 1.092010 | 381; 0.984094 | 374 / 0       | true  |
| r3 #1          | 1024x1536 | 0.161353 / 0.309468 | 0.850000; -23.450000; 406.500000 | 247.366755 / 207.972583; 280.200126 | 0.288413 / 0.261905 | 1.108671 / 1.091787 | 794; 0.472217 | 5378 / 0      | false |
| r3 #2          | 1024x1536 | 0.497121 / 0.700087 | 0.850000; 7.200000; 206.725000   | 71.764706 / 71.764706; 75.165331    | 0.287619 / 0.261905 | 1.088388 / 1.091787 | 525; 0.714171 | 3707 / 0      | false |
| r3 #3          | 1024x1536 | 0.469572 / 0.672991 | 0.850000; 3.425000; 185.475000   | 96.470588 / 95.301380; 100.110665   | 0.270758 / 0.261905 | 1.023256 / 1.091787 | 554; 0.676787 | 2861 / 0      | false |

- r0 attempt1: Refused massive reference-size enlargement IoU.318884,p95256.141/223.727,max275.849; copied reference glow/shadow violates noextras. Both heights pass, style/identity otherwise pass.
- r0 attempt2: Refused enlargement atminimumf.85:IoU.829448<.92,p95both37.647>16,max38.303>32. Heights/identity/painting pass; apparent RGB glow is ignored where alpha0.
- r0 attempt3: Refused enlargement:f.85minimum,IoU.646621<.92,p9599.674/97.249>16,max105.941>32. Wall.285455 versus.261905 is+8.992% outside8%; overall/identity/painting pass. Closest refused r0 is attempt2 raw only. Apparent native glow isRGBunderzeroalpha, not an added visible glow.
- r1 attempt1: Refused enlargement:f.85minimum,IoU.742457<.92,p9554.728/52.876>16,max62.453>32. Both heights/eye pass; native-only background RGB ignored under alpha0.
- r1 attempt2: Refused enlargement:f.85minimum,IoU.612566<.92,p9595.032/90.588>16,max106.599>32. Both heights/eye pass; apparent glow only native RGB under alpha0.
- r1 attempt3: Closest refused r1 attempt3 raw only: f.85minimum,IoU.794347<.92,p9541.893/40.482>16,max48.593>32. Heights/identity/painting pass. All3r1IoUs below.80; r0 had.829448, so two-consecutive-views stop has NOT fired.
- r2 attempt1: Refused massive enlargement:f.85minimum,IoU.366877<.92,p95248.737/195.294>16,max268.238>32. Wall.285130 versus.261905 is+8.867% outside8%; overall/identity/painting pass.
- r2 attempt2: Refused enlargement:f.85minimum,IoU.503201<.92,p95151.906/122.353>16,max174.284>32. Both heights/eye pass.
- r2 attempt3: All strict silhouette/height/eye tests pass. Small shape held, plain walls/no new openings, one chimney2pots, corbelled gable and coherent stone/slate painting. Alpha-composited crop confirms no visible glow: native halo is invisibleRGB underalpha0.
- r3 attempt1: Refused massive enlargement:f.85minimum,IoU.309468<.92,p95247.367/207.973>16,max280.200>32. Wall.288413 versus.261905 is+10.121% outside8%; overall/identity/style pass.
- r3 attempt2: Refused enlargement:f.85minimum,IoU.700087<.92,p95both71.765>16,max75.165>32. Wall.287619 versus.261905 is+9.818% outside8%; overall/identity/style pass.
- r3 attempt3: Refused enlargement:f.85minimum,IoU.672991<.92,p9596.471/95.301>16,max100.111>32. Both heights/eye pass. Closest refused r3 is attempt2 raw only. No two-consecutive-views lowIoU stop: r2#3 passed .977054 before r3.

Exact numbers, height readings, light patch ratios, eye verdicts, prompts and hashes are in prompts.json. Accepted images match raw bytes; no returned picture was transformed.
