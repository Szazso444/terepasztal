# power_plant textured route audit

All PNGs remain byte-for-byte tool returns. All previews and input extraction stayed on G. Alpha-aware previews composite RGB by alpha; invisible RGB at alpha zero is not a visible glow.

| View / attempt | Size      | IoU s0  | f / dx / dy                     | Best IoU | p95 picture/render    | Max       | Tank or wall / render | Overall / render  | Base / k             | White / amber | Selected |
| -------------- | --------- | ------- | ------------------------------- | -------- | --------------------- | --------- | --------------------- | ----------------- | -------------------- | ------------- | -------- |
| r0 #1          | 1536x1024 | 0.27907 | 0.85000 / 169.55000 / 146.75000 | 0.36989  | 262.35294 / 145.92978 | 308.82073 | 0.24269 / 0.24936     | 0.79364 / 0.78750 | 1162.00000 / 0.53838 | 959 / 0       | refused  |
| r0 #2          | 1536x1024 | 0.28653 | 0.85000 / 150.42500 / 139.10000 | 0.38004  | 254.93605 / 139.30127 | 310.00391 | 0.23923 / 0.24936     | 0.80580 / 0.78750 | 1137.00000 / 0.55022 | 98 / 0        | refused  |
| r0 #3          | 1536x1024 | 0.43191 | 0.85000 / 59.60000 / 148.82500  | 0.73287  | 105.91503 / 101.23801 | 115.13194 | 0.23684 / 0.24936     | 0.78171 / 0.78750 | 874.00000 / 0.71579  | 906 / 0       | refused  |
| r1 #1          | 1536x1024 | 0.26858 | 0.85000 / 76.37500 / 257.50000  | 0.38238  | 262.09959 / 202.98806 | 279.83188 | 0.30640 / 0.24776     | 0.96122 / 0.96627 | 953.00000 / 0.65645  | 1735 / 0      | refused  |
| r1 #2          | 1536x1024 | 0.37095 | 0.85000 / 51.75000 / 151.52500  | 0.51464  | 148.09050 / 137.98852 | 164.84448 | 0.28744 / 0.24776     | 0.95296 / 0.96627 | 828.00000 / 0.75556  | 882 / 0       | refused  |
| r1 #3          | 1536x1024 | 0.30937 | 0.85000 / 90.27500 / 229.47500  | 0.45833  | 174.15341 / 159.15434 | 189.25094 | 0.29257 / 0.24776     | 0.95890 / 0.96627 | 875.00000 / 0.71497  | 823 / 0       | refused  |

- r0 attempt 1: Refused silhouette IoU .3699 p95 262.35/145.93 max308.82; enlarged from render width640 to1163 and top356 to24; extra finials. Raw: assets/source/textured/power_plant/raw/power_plant-r0-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r0 attempt 2: Refused silhouette IoU .3800 p95 254.94/139.30 max310.00: enlarged from640 to1138 wide and moved top356 to36. Raw: assets/source/textured/power_plant/raw/power_plant-r0-attempt-2.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r0 attempt 3: Refused IoU .7329 p95 105.92/101.24 max115.13, width875 vs640 top174 vs356; added round finials. Closest refused r0 attempt3, raw only. Raw: assets/source/textured/power_plant/raw/power_plant-r0-attempt-3.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r1 attempt 1: Refused IoU .3824 p95 262.10/202.99 max279.83; enlarged width954 vs504 and top62 vs411; wall .3064 vs.2478 outside8%. Raw: assets/source/textured/power_plant/raw/power_plant-r1-attempt-1.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r1 attempt 2: Refused IoU .5146 p95 148.09/137.99 max164.84; enlarged width829 vs504 top149 vs411; wall .2874 vs .2478 outside8%. Raw: assets/source/textured/power_plant/raw/power_plant-r1-attempt-2.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r1 attempt 3: Refused IoU .4583 p95 174.15/159.15 max189.25; enlarged width876 vs504 top97 vs411; wall .2926 vs .2478 outside8%. Closest refused r1 attempt2, raw only. STOP: all three attempts of consecutive r0 andr1 below .80. Raw: assets/source/textured/power_plant/raw/power_plant-r1-attempt-3.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.

Render reference, manual coordinate readings and uncertainty, wall sample coordinates, full prompts and ordered references, hashes and detailed machine measurements are in prompts.json. Highlights are reported only.

Material-only references produced coherent crisp brick, slate, green glazing and machinery, but the edit repeatedly enlarged the whole layout even after numeric corrections. r0 best .7329 and r1 best .5146; neither holds the render silhouette. Stopped afterr1; r2/r3 never attempted; closest refusals r0#3 andr1#2 stay raw, no accepted copy.
