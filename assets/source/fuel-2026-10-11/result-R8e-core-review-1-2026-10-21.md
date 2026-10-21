# R8e Core review1 continuation — 2026-10-21

Adopted r1#15 and r2#11 byte for byte, marked selected, created unique grass sheets, committed and pushed d736b4f03e8949ce1735168b7318e06b49d744f1. No calls repainted these accepted views.

**New r3: no accepted picture.** Exactly3 calls (21–23), all raw unchanged. Closest22 passes outline/height but fails light0.935>0.85. Canonicalr3 unchanged. No early stop: not all3 IoUs below0.80.

Master SHA256 matched. r3 lit/bare1024-square and JSON job/view/canvas checks passed. All calls requested1024×1024 and returned1254×1254, using exactly five ordered references: lit scaffold, style board, fittedr0, acceptedr1, acceptedr2. Exact prompts and all measurement coordinates are in prompts.json. No refused attempt attached.

| Attempt | IoU at s0 |     f |      dx |       dy | Best IoU | p95 picture→scaffold | p95 scaffold→picture | Maximum |
| ------- | --------: | ----: | ------: | -------: | -------: | -------------------: | -------------------: | ------: |
| 21.000  |     0.488 | 1.150 |   2.640 | -152.130 |    0.645 |               69.587 |               63.531 |  77.163 |
| 22.000  |     0.711 | 1.150 | -54.822 | -138.249 |    0.941 |                9.658 |                9.941 |  13.640 |
| 23.000  |     0.537 | 1.150 | -72.751 | -137.012 |    0.710 |               84.526 |               74.774 |  96.969 |

Boundary values are canvas px after2canvaspx opening; shifts are returned px. Transform is measurement only; paintings never transformed.

| Attempt | Base width | Held width |     k | SlopesL/R    | Long/short | Height/scaffold | LightL/R        | RatioR/L | Jib canvaspx | Hose end returnedpx |
| ------- | ---------: | ---------: | ----: | ------------ | ---------: | --------------- | --------------- | -------: | -----------: | ------------------- |
| 21      |        671 |    504.539 | 0.752 | 0.577/-0.488 |      1.532 | 0.428/0.468     | 113.270/100.785 |    0.890 |           74 | 719,995             |
| 22      |        541 |    504.539 | 0.933 | 0.553/-0.513 |      1.283 | 0.455/0.468     | 112.427/105.078 |    0.935 |           70 | 716,994             |
| 23      |        651 |    504.539 | 0.775 | 0.587/-0.474 |      1.583 | 0.404/0.468     | 122.989/98.343  |    0.800 |           75 | 723,992             |

Widths/slopes/plan ratio and r0 height0.43 are report-only. All heights pass15% scaffold comparison. Every attempt has one post, one jib and brace; crane/hose painted as the scaffold. Old92px jib, post above tank and hose at door top conflict with the scaffold and were overridden per Core review1.

Refused21: silhouetteIoU0.645,p95max69.59,max77.16 and light0.890. Refused22: light0.935 (112.43/105.08), despite silhouetteIoU0.941,p95max9.94,max13.64 passing. Refused23: silhouetteIoU0.710,p95max84.53,max96.97; light0.800 passes. No r3 replacement;22 raw only.

Grass comparisons beside unchangedr0 are review/fuel_pump-a1-r3-attempt-21-core-review-1-grass.png and corresponding22/23 files. Repaint is crisp brick, quoins, steel and tank, no blurred scaffold surface; front door wall lower-right, short plain wall lower-left.

Validation: all3 raw hashes match tool originals; r0/r3 canonical blob hashes unchanged; r1/r2 byte comparison matches raw15/11. JS syntax and scoped formatting passed. Revised distribution check reproduces acceptedr1#15 pass (IoU0.960,p95max8.90,max14.33). Silhouette script changes only its final boundary distribution step; recorder/light checker implement converted Core rules. Broad baseline checks from first run were not repeated for this scoped continuation.
