# TB1 Warehouse

All four views accepted; five raw returns preserved.

|View|Attempt|Accepted|IoU at s0|f, dx, dy|Best IoU|p95 picture/render|max|wall vs bare|overall vs bare|base width / k|white/amber|
|---|---|---|---|---|---|---|---|---|---|---|---|
|r0|1|true|0.6888519816171452|0.989,7.240000000000009,79.24000000000001|0.9666881886937022|7.385010583595903/7.385010583595903|16.38906733161258|0.24311377245508983/0.23435225618631733|0.8196371398078975/0.807843137254902|835/0.9874311377245509|6876/0|
|r1|1|true|0.4755325635961133|0.85,53.22500000000002,258.525|0.961026590958127|11.883085169244257/10.567595459236328|22.179262395628037|0.24397590361445784/0.23435225618631733|0.8421052631578947/0.8169934640522876|996/0.827816265060241|12695/0|
|r2|1|false|0.5178454686606194|0.851,53.64999999999998,227.625|0.9550525337904144|14.167757243733334/14.896401914784805|34.59748551825814|0.24849699398797595/0.23469387755102042|0.8250226654578422/0.8156862745098039|998/0.8261573146292586|1556/0|
|r2|2|true|0.6965302139078806|0.966,-0.5399999999999636,92.08000000000004|0.960154197435158|11.34126625337942/12.87565366050938|31.0823351896055|0.2425629290617849/0.23469387755102042|0.8236514522821576/0.8156862745098039|874/0.9433695652173913|2422/0|
|r3|1|true|0.8544350897734208|0.985,7.980000000000018,41.09000000000003|0.9725734214783941|5.803155789797521/5.803155789797521|9.703456722105017|0.24516908212560387/0.23469387755102042|0.8292422625400213/0.8156862745098039|828/0.9957789855072464|2388/0|

The repaint reads as one hand with the original: continuous brick courses, slate and quoin shading, newly crisp chimney backs and pots, brackets and canopy ribs. Compared with the textured renders, the cloned chips, stretched wall patches and roof seams are resolved; the near-white edge speckles remain a reported packing concern. All four views retain the three stacks, front sliding panels, one-ended canopy and back-wall window arrangement of their renders.

The four-view render/painting/original scratch comparison is G:/DEV/wt/codex-tmp/textured-pilot/warehouse-comparison.png (not committed). Machine wall samples are reported only; in r3 the selected small patches read125/138, while the complete visible left gable is lighter than the front wall with its dark door panels, as seen in the comparison. Raw images were not resized, shifted or edited; fitting is measurement only. pictureOf parses filenames instead of alpha, so pngjs reads alpha>128 and name metadata is null.
