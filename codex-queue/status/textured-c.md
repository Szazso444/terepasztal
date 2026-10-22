# textured-c

## TB2-substation (2026-10-22T16:21:54.530Z)
- Result: done
- Lane commit: 40a01ca14b10f97953bd36c58f06df96be21a123 (origin/art/textured-c)
- Views accepted: r0: assets/source/textured/substation/substation-r0.png (attempt3; IoU .95446; p95 6.04230/6.04230; max16.11279; tank .33758 vs .33551; overall1.18283 vs1.17412).
- Refused attempts: r0#2; r1#1/#2/#3; r2#1/#2/#3; r3#1/#2/#3, with numbers and reasons below. Closest refused r1#2, r2#2, r3#1 retained raw only.
- Stop reason: none; no adjacent views had every attempt below .80 IoU.
- Notes: 12 calls; 1 selected accepted view, 1 qualifying but unselected attempt r0#1, 10 refused attempts. Alpha audit corrected the original RGB-only glow assessment of r0#1: transparent RGB is invisible. r0#3 selected for near-native placement. Geometry won over prose feature placement; lighting follows render including nearly equal/reversed r1 ordering. Typecheck, lint, build and format check passed; npm test ongoing with unrelated handbuilt Python tests failing, final count to follow. All raw/canonical SHA hashes in prompts.json; accepted copy identical. Scoped helper calibration on render IoU .99093, p95 1.001, max1.4156.

# substation textured route audit

All PNGs remain byte-for-byte tool returns. All previews and input extraction stayed on G. Alpha-aware previews composite RGB by alpha; invisible RGB at alpha zero is not a visible glow.

| View / attempt | Size      | IoU s0  | f / dx / dy                     | Best IoU | p95 picture/render  | Max       | Tank or wall / render | Overall / render  | Base / k            | White / amber | Selected                |
| -------------- | --------- | ------- | ------------------------------- | -------- | ------------------- | --------- | --------------------- | ----------------- | ------------------- | ------------- | ----------------------- |
| r0 #1          | 1536x1024 | 0.68662 | 0.91500 / 59.57000 / 75.66500   | 0.95134  | 6.91208 / 7.33137   | 14.20765  | 0.33676 / 0.33551     | 1.18302 / 1.17412 | 680.00000 / 0.92047 | 3476 / 0      | qualifies, not selected |
| r0 #2          | 1536x1024 | 0.52169 | 0.85000 / 99.00000 / 126.95000  | 0.83900  | 30.52029 / 29.05668 | 34.44066  | 0.33887 / 0.33551     | 1.16561 / 1.17412 | 782.00000 / 0.80041 | 3244 / 0      | refused                 |
| r0 #3          | 1536x1024 | 0.94998 | 0.99300 / 3.69000 / 2.48500     | 0.95446  | 6.04230 / 6.04230   | 16.11279  | 0.33758 / 0.33551     | 1.18283 / 1.17412 | 628.00000 / 0.99669 | 2209 / 0      | YES                     |
| r1 #1          | 1536x1024 | 0.45325 | 0.85000 / 110.65000 / 162.95000 | 0.65803  | 70.50976 / 67.37798 | 94.44795  | 0.25132 / 0.33551     | 0.97050 / 0.90972 | 947.00000 / 0.66095 | 4769 / 0      | refused                 |
| r1 #2          | 1536x1024 | 0.62101 | 0.88300 / 101.00000 / 111.58000 | 0.87452  | 26.84772 / 23.31966 | 42.44998  | 0.28360 / 0.33551     | 0.97171 / 0.90972 | 811.00000 / 0.77179 | 1116 / 0      | refused                 |
| r1 #3          | 1536x1024 | 0.52907 | 0.85000 / 125.35000 / 137.50000 | 0.81608  | 29.48227 / 28.28427 | 49.94114  | 0.26606 / 0.33551     | 0.97029 / 0.90972 | 872.00000 / 0.71780 | 3313 / 0      | refused                 |
| r2 #1          | 1536x1024 | 0.49972 | 0.85000 / 113.42500 / 185.82500 | 0.72505  | 81.17647 / 81.03995 | 100.10375 | 0.32704 / 0.33551     | 1.09882 / 1.08147 | 847.00000 / 0.73898 | 3742 / 0      | refused                 |
| r2 #2          | 1536x1024 | 0.51809 | 0.85300 / 79.20000 / 184.45000  | 0.91658  | 16.66198 / 17.30929 | 29.88874  | 0.33014 / 0.33551     | 1.10368 / 1.08147 | 730.00000 / 0.85742 | 2274 / 0      | refused                 |
| r2 #3          | 1536x1024 | 0.45661 | 0.85000 / 72.35000 / 163.47500  | 0.73058  | 83.38845 / 72.97912 | 93.68282  | 0.32024 / 0.33551     | 1.09846 / 1.08147 | 840.00000 / 0.74514 | 3901 / 0      | refused                 |
| r3 #1          | 1536x1024 | 0.55491 | 0.85000 / 91.92500 / 135.57500  | 0.86274  | 20.54618 / 20.00000 | 26.43789  | 0.33471 / 0.33551     | 1.02619 / 0.97083 | 729.00000 / 0.85860 | 3308 / 0      | refused                 |
| r3 #2          | 1536x1024 | 0.51608 | 0.85000 / 78.40000 / 147.32500  | 0.84859  | 24.22501 / 23.82171 | 31.96018  | 0.34737 / 0.33551     | 1.00344 / 0.97083 | 760.00000 / 0.82358 | 3498 / 0      | refused                 |
| r3 #3          | 1536x1024 | 0.48140 | 0.85000 / 79.55000 / 142.00000  | 0.77440  | 41.57788 / 40.56692 | 46.01790  | 0.33206 / 0.33551     | 0.98888 / 0.97083 | 786.00000 / 0.79634 | 3724 / 0      | refused                 |

- r0 attempt 1: QUALIFIES after alpha-aware review, not selected: apparent glow is RGB under alpha0; initial RGB-preview no-extras reading was wrong. Attempt3 selected for closer placement and outline. Raw: assets/source/textured/substation/raw/substation-r0-attempt-1.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r0 attempt 2: Refused silhouette: IoU .8390 p95 30.52/29.06 max34.44. Alpha-aware audit: no visible glow; apparent glow was invisible RGB under alpha0. Added pad divisions and plate on fins remain extras. Not selected. Raw: assets/source/textured/substation/raw/substation-r0-attempt-2.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":false}.
- r0 attempt 3: Accepted. Apparent glow in RGB-only native preview is entirely alpha0 and absent in RGBA composite; no visible glow. Whole unit at original small placement, holes retained. Brighter left cabinet face and shaded right side agree with render. Raw: assets/source/textured/substation/raw/substation-r0-attempt-3.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r1 attempt 1: Refused: best IoU .6580 and p95 70.51/67.38 max94.45; copied enlarged layout, added fins/control sign to hidden rear, subdivided slab. No visible alpha glow. Raw: assets/source/textured/substation/raw/substation-r1-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r1 attempt 2: Refused: silhouette IoU .8745 p95 26.85/23.32 maximum42.45; enlarged, added rear fins and yellow sign on junction box, slab subdivided. Raw: assets/source/textured/substation/raw/substation-r1-attempt-2.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r1 attempt 3: Refused: IoU .8161, p95 29.48/28.28 max49.94; added large rear fins, enlarged. Closest refused r1 is attempt2 by IoU .8745, kept raw only. Raw: assets/source/textured/substation/raw/substation-r1-attempt-3.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r2 attempt 1: Refused silhouette IoU .7250 p95 81.18/81.04 max100.10, enlarged and subdivided pad with added fittings. Raw: assets/source/textured/substation/raw/substation-r2-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r2 attempt 2: Refused IoU .9166 below .92 and p95 16.66/17.31 above16; repeated cloned rear-wall blotches, added sign and slab divisions. Raw: assets/source/textured/substation/raw/substation-r2-attempt-2.png. Eye: {"sameBuilding":false,"coherentPainting":false,"light":true,"noExtras":false}.
- r2 attempt 3: Refused IoU .7306 p95 83.39/72.98 max93.68; enlarged, extra fins and warning sign. Closest refused r2 attempt2 IoU .9166, raw only. Raw: assets/source/textured/substation/raw/substation-r2-attempt-3.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r3 attempt 1: Refused IoU .8627 and p95 20.55/20 above16; enlarged and added slab divisions/plate to fins. Raw: assets/source/textured/substation/raw/substation-r3-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r3 attempt 2: Refused IoU .8486 p95 24.23/23.82; enlarged, added fin plate and slab divisions. Raw: assets/source/textured/substation/raw/substation-r3-attempt-2.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r3 attempt 3: Refused IoU .7744 p95 41.58/40.57 max46.02; enlarged and added fin plate and pad divisions. Closest refused r3 attempt1 IoU .8627 kept raw only. Raw: assets/source/textured/substation/raw/substation-r3-attempt-3.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.

Render reference, manual coordinate readings and uncertainty, wall sample coordinates, full prompts and ordered references, hashes and detailed machine measurements are in prompts.json. Highlights are reported only.

One selected view r0; r1/r2/r3 closest refusals stay raw. Repainted metal, ceramic and stone usually read as one coherent hand, but repeated rear patches survived in r2#2 and the hidden walls gained fins/plates. Exact small render layout was unreliable despite coordinate corrections. Render geometry won over prose placement; r1 wall lighting follows render, not a universal left-brighter rule.

## TB2-power_plant (2026-10-22T16:31:42.961Z)
- Result: stopped
- Lane commit: 8263c8c1a82f69d7536b0240df7fa4ddcadba780 (origin/art/textured-c)
- Views accepted: none
- Refused attempts: r0#1/#2/#3, r1#1/#2/#3; numbers below. Closest r0#3 andr1#2 retained raw only.
- Stop reason: if all three attempts of a view have a silhouette IoU under 0.80 and the same happened to the view before it, stop THIS building after that view. r0 IoUs .36989/.38004/.73287 and r1 .38238/.51464/.45833; r2/r3 never attempted.
- Notes: 6calls,6refused,0selected orqualifying. ONLY target render and six-crop sheet attached; no original fetched/opened/attached. All7specified hashes matched. Sheet1064x744, no resampling, grey#808080,32px gaps. Material-only edit still enlarged exactrender. Full test final:184files passed/8failed,4204tests passed/15failed/11skipped/1todo; unrelated missing python ENOENT and Windows-invalid quote filename. Typecheck/lint/build/format passed. Substation earlier pending-test note now resolved. No unrelated fixes.

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

## TB2-fuel_stop (2026-10-22T16:43:49.462Z)
- Result: done
- Lane commit: 807cc17eeb5dd65090088f1b7b5c19dae44ea943 (origin/art/textured-c)
- Views accepted: r1 assets/source/textured/fuel_stop/fuel_stop-r1.png (attempt2); r3 assets/source/textured/fuel_stop/fuel_stop-r3.png (attempt2), decidingnumbers below. r0 untouched.
- Refused attempts: r1#1, r2#1/#2/#3, r3#1; allfailed boundary owingclosed lowerlegspaces. Closest r2#3 byIoU stays rawonly.
- Stop reason: none
- Notes:7calls,2selectedaccepted,5refused. Originalhashmatched;9renderfilesvalidated. Geometrywins: horizontalplanks andvisible far-sidewinch/chute followrender despiteprose. Actualjson carrieshole_polygons_px despiteolderprompt sayingnone; holesincluded perqueuerules. Helpercalibration onr1 .99408,p951.003,max2.006. Alpha-awareinspection; eachreturn1254square retainedexactly. r3#1groundbasewidthaudited toexcludechute, oldreadingpreserved; stillrefusedsilhouette. Previousbaselinechecks asreported; syntax/format/diff andacceptedbyteidentitypass.

Acceptedr1 #2: IoU0.9645952637092645, p95 5.254982423385858/5.254982423385858, max8.449524548075857, bin/leg 0.833063209076175vs0.8403865778258, overall1.3826979472140764vs1.397459165154265.
Acceptedr3 #2: IoU0.951912277863795, p95 10.110479055330506/9.74985901003023, max18.042923584921805, bin/leg 0.8127035830618893vs0.8403865778258, overall1.3835820895522388vs1.3847549909255898.

# fuel_stop textured route audit

All PNGs remain byte-for-byte tool returns. All previews and input extraction stayed on G. Alpha-aware previews composite RGB by alpha; invisible RGB at alpha zero is not a visible glow.

| View / attempt | Size      | IoU s0  | f / dx / dy                    | Best IoU | p95 picture/render  | Max       | Tank or wall / render | Overall / render  | Base / k            | White / amber | Selected |
| -------------- | --------- | ------- | ------------------------------ | -------- | ------------------- | --------- | --------------------- | ----------------- | ------------------- | ------------- | -------- |
| r1 #1          | 1254x1254 | 0.81236 | 1.01800 / -22.11000 / 30.36000 | 0.95141  | 8.82363 / 81.96056  | 112.64401 | 0.82421 / 0.84039     | 1.40663 / 1.39746 | 603.00000 / 1.01496 | 1682 / 189    | refused  |
| r1 #2          | 1254x1254 | 0.82599 | 0.99500 / 1.95500 / 43.10000   | 0.96460  | 5.25498 / 5.25498   | 8.44952   | 0.83306 / 0.84039     | 1.38270 / 1.39746 | 617.00000 / 0.99193 | 2701 / 6      | YES      |
| r2 #1          | 1254x1254 | 0.88210 | 0.97100 / 18.15500 / 39.94500  | 0.95315  | 8.40975 / 84.47511  | 120.30649 | 0.80190 / 0.84439     | 1.48328 / 1.48444 | 631.00000 / 0.96993 | 2544 / 437    | refused  |
| r2 #2          | 1254x1254 | 0.80646 | 0.98600 / 11.10000 / 58.37000  | 0.94413  | 13.70884 / 82.80572 | 115.26311 | 0.81180 / 0.84439     | 1.51638 / 1.48444 | 627.00000 / 0.97611 | 1892 / 79     | refused  |
| r2 #3          | 1254x1254 | 0.77659 | 0.94700 / 32.62500 / 84.77500  | 0.95520  | 7.94990 / 88.22350  | 124.61482 | 0.82827 / 0.84439     | 1.48065 / 1.48444 | 658.00000 / 0.93013 | 2829 / 177    | refused  |
| r3 #1          | 1254x1254 | 0.77178 | 1.03200 / -24.34500 / 40.22500 | 0.94664  | 13.81887 / 79.00786 | 112.59918 | 0.79739 / 0.84039     | 1.35736 / 1.38475 | 612.00000 / 1.00004 | 2459 / 243    | refused  |
| r3 #2          | 1254x1254 | 0.85701 | 1.01200 / -10.07500 / 23.82500 | 0.95191  | 10.11048 / 9.74986  | 18.04292  | 0.81270 / 0.84039     | 1.38358 / 1.38475 | 614.00000 / 0.99678 | 2074 / 809    | YES      |

- r1 attempt 1: Refused despite IoU .9514: render-to-picture p95 81.96 and maximum112.64 at lower leggap; opaque timber backing fills gap the render exposes. Otherp95 8.82. Returned1254square, unchangedbytes. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r1-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r1 attempt 2: Accepted r1#2: IoU .96460 p95 5.255/5.255 max8.450; bothheight ratios within8%. Correct existing chute, sixleg/pier layout and open gaps; varied coal and crisp timber/iron/stone coherent with reference. Geometrywins overprose: bin planks horizontal asrender. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r1-attempt-2.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.
- r2 attempt 1: Refused despite IoU .9531: p95 8.41/84.48 max120.31 at lower leggap, newly opaque backing. Winch visible perrender takesauthority overhiddenprose. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r2-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r2 attempt 2: Refused IoU .9441 p95 13.71/82.81 max115.26: rear stone/wood backing still closes lowerleggap, changed coal profile and rim. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r2-attempt-2.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r2 attempt 3: Refused IoU .9552 p95 7.95/88.22 max124.61, lower leg opening closed by opaque rearstone/wood; closest byIoU r2#3 rawonly. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r2-attempt-3.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r3 attempt 1: Refused IoU .9466 p95 13.82/79.01 max112.60: lowerleggap closed. Base audit excludes chute aboveground: width612, height .7974vs.8404 passes; initial665 counted chute, preserved ininitialAssessment. Stillsilhouetterefused. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r3-attempt-1.png. Eye: {"sameBuilding":false,"coherentPainting":true,"light":true,"noExtras":false}.
- r3 attempt 2: Accepted r3#2: IoU .95191 p95 10.110/9.750 max18.043; bin+leg andoverall heights pass. Open lowergaps andpiers preserved; crisp timber, coal, rope,iron coherent withacceptedr1. Base width excludes overhangingchute. Raw: assets/source/textured/fuel_stop/raw/fuel_stop-r3-attempt-2.png. Eye: {"sameBuilding":true,"coherentPainting":true,"light":true,"noExtras":true}.

Render reference, manual coordinate readings and uncertainty, wall sample coordinates, full prompts and ordered references, hashes and detailed machine measurements are in prompts.json. Highlights are reported only.

Accepted r1#2 andr3#2; r2#3 is closest refused byIoU, rawonly. Timber, coal, iron, rope andstone read asone coherenthand, correcting projectionseams andblockyhidden faces. r2 repeatedly closedlowerleg spaces despite matching overalloutline; exactopenings needCore review. Geometrywins: horizontalplanks andvisible far-side winch/chute followrender despiteprose.
