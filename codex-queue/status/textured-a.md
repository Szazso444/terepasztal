# textured-a

## TB2-big_station (2026-10-22T16:19:03.070Z)
- Result: done
- Lane commit: bff79bbccc8063153a832799b5e203ca21a530ef (origin/art/textured-a)
- Views accepted:
  - r0: assets/source/textured/big_station/big_station-r0.png (attempt 2; IoU 0.9734663732389577; p95 5.930002049554417/12.525560358561995; max 25.9657427921114; wall 0.2029988465974625/0.20346344765342955; overall 0.708984375/0.7199519230769231).
  - r1: assets/source/textured/big_station/big_station-r1.png (attempt 2; IoU 0.9730595082528462; p95 7.537725432462276/9.02042082771968; max 23.718378133906594; wall 0.21728691476590636/0.213089802130898; overall 0.8084449021627188/0.7872611464968153).
  - r2: assets/source/textured/big_station/big_station-r2.png (attempt 1; IoU 0.9686508786843401; p95 10.232058950325294/9.688369830913748; max 25.491787362645567; wall 0.18543046357615894/0.1792717086834734; overall 0.7310278578290106/0.7055288461538461).
- Refused attempts:
  - r0 attempt 1: Refused strict silhouette p95 16.215/16.566 >16 and max32.398>32; enlarged bench/foot at left canopy corner. Both heights pass; identity, complete repaint and sun ordering pass.
  - r1 attempt 1: Gross whole-building enlargement despite correct turn; IoU .90605<.92, p95 21.93/26.90>16,max55.96>32; wall ratio also too high by eye.
  - r3 attempt 1: Refused p95 17.872/18.705>16; wall proportion too tall (~14.2%); small upper-gable texture opening expanded into framed attic window about twice render size. All raw retained.
  - r3 attempt 2: Refused directed p95 15.583/18.847>16; far canopy post and bench layout deviate (max25.437 passes32). Heights, corrected tiny gable mark and all eye tests pass.
  - r3 attempt 3: Closest refused r3: maximum32.198>32 (p95 15.083/13.096 and IoU.940149 pass). Plain gable tiny texture mark has become a framed green attic window; identity also refused. Heights pass. Raw only; no accepted r3.
- Closest refused r3: assets/source/textured/big_station/raw/big_station-r3-attempt-3.png; kept:false, no accepted r3 file.
- Stop reason: none; no pair of consecutive views had all three IoUs below0.80.
- Notes: Eight calls,1254x1254 each; three accepted/five refused. Exact prompts, references, hashes, all measurements, light patch ratios and height readings are in prompts.json; per-attempt report in REPORT.md. Raw and accepted bytes verified. Render geometry wins over prose: plain gable tiny texture mark must not inflate into a new framed window. R1 actual opaque main-wall base span657 corrected nominal709.12; old reading preserved and first refusal still fails silhouette. Coherent cream limestone/slate/canopy painting, no cloned patches/seams; r3 thin post/bench/gable details drift. Image tool saved automatically on C:; copied bytes to G raw and left originals as README permits.

## TB2-big_farm (2026-10-22T16:32:09.324Z)
- Result: done
- Lane commit: 0c7a8bcc3748228b5d4fd30a706fe5877fed4e48 (origin/art/textured-a)
- Views accepted:
  - r0: assets/source/textured/big_farm/big_farm-r0.png (attempt1; IoU0.9756147617041065; p958.463239243541537/10.408408042121525; max27.440348474684026; wall0.2726396917148362/0.28900949796472186; overall0.8108581436077058/0.8012422360248447).
  - r1: assets/source/textured/big_farm/big_farm-r1.png (attempt2; IoU0.9861874945539193; p954.432918501525547/4.432918501525547; max11.196353765486808; wall0.31565329883570503/0.339171974522293; overall0.9178240740740741/0.9145299145299145).
  - r2: assets/source/textured/big_farm/big_farm-r2.png (attempt1; IoU0.9828762691454804; p956.126589981726215/6.371749759075995; max22.141689865399098; wall0.2816281628162816/0.30028735632183906; overall0.7454890788224121/0.7416149068322981).
  - r3: assets/source/textured/big_farm/big_farm-r3.png (attempt3; IoU0.9739634332311348; p959.890914029806446/9.890914029806446; max16.584089255719334; wall0.29959514170040485/0.2972181551976574; overall0.9693069306930693/0.9629629629629629).
- Refused attempts:
  - r1 attempt1: Refused silhouette IoU.837029<.92, p95 45.163/43.825>16,max54.141>32; oversized output requires f below allowed range. Wall .307774 versus.339172 is -9.25%, outside8%; overall+7.59% passes.
  - r3 attempt1: Refused picture-to-render p95 17.021>16; IoU.955958,p95reverse15.863,max24.744 and heights/eye pass. Dock platform/ramp/feet protrude from render outline.
  - r3 attempt2: Refused picture-to-render p95 18.172>16 and maximum33.609>32; IoU.962886/reversep9515.843 pass; dock/ramp feet protrude. Sacks under dock canopy lost among crates; identity fails. Heights pass.
- Stop reason: none
- Notes: 7 calls; 4 accepted/3 refused. All four views accepted. Timber, slate and stone form one coherent painting, with crisp round silo/pipe and no cloned seams. The dock/ramp initially drifted at r3; its final attempt restored the shape and sacks. Render back-wall window retained despite prose plain-back: render geometry wins. Accepted r0#1,r1#2,r2#1,r3#3; three refused attempts kept raw. Full per-attempt exact metrics, returned sizes, prompts, references, hashes and light comparisons: assets/source/textured/big_farm/prompts.json and REPORT.md. Original hash preflight and raw/copy byte hashes verified. Built-in image auto C: saves copied to G raw and originals left as README permits.

## TB2-town (2026-10-22T16:43:41.580Z)
- Result: done
- Lane commit: b0d0666c69791e6022517ed2d70d795ec3f11de6 (origin/art/textured-a)
- Views accepted:
  - r0: assets/source/textured/town/town-r0.png (attempt1; IoU0.9770306060200271; p956.5261692055950435/6.5261692055950435; max9.924284377544907; wall0.4219858156028369/0.4316546762589928; overall1.108235294117647/1.0991379310344827).
  - r1: assets/source/textured/town/town-r1.png (attempt1; IoU0.9676362676179872; p959.256696802695568/9.041895003383763; max21.018946643387086; wall0.40919037199124725/0.43103448275862066; overall1.1278688524590164/1.0991379310344827).
  - r3: assets/source/textured/town/town-r3.png (attempt1; IoU0.961172071942393; p959.898023295152482/9.898023295152482; max25.181128063752546; wall0.42502951593860683/0.43103448275862066; overall1.1403301886792452/1.1149425287356323).
- Refused attempts:
  - r2 attempt1: Refused outline p9550.356/21.961>16,max96.262>32 despite IoU.932456. Far front-clock-gable silhouette removed and back green door added against render; identity/noextras fail. Both heights pass.
  - r2 attempt2: Refused picture-to-render p9516.690484>16; IoU.953906,reversep9515.628,max27.581 pass. Main near-corner foot too low; corrected far gable/back-no-door and heights/eye pass.
  - r2 attempt3: Refused outline p9532.813/22.540>16,max67.215>32; farclockgable peak moved down/behind cupola against render. IoU.934853 and both heights pass. Closest refused r2 is attempt2(raw only), whose p9516.6905 narrowly fails and identity passes.
- Stop reason: none
- Notes: 6 calls; 3 accepted/3 refused. Three accepted views(r0,r1,r3); r2 refused after three attempts. Brick, limestone and slate read as one coherent painting with crisp glazing and cupola. The hidden far clock-gable and near base corner still drift in r2. Closest refused r2 is raw/town-r2-attempt-2.png: identity/heights pass, p95picture16.690484273418168>16. Render back has no green door despite prose; render layout wins. Full per-attempt exact metrics, returned sizes, prompts, references, hashes and light comparisons: assets/source/textured/town/prompts.json and REPORT.md. Original hash preflight and raw/copy byte hashes verified. Built-in image auto C: saves copied to G raw and originals left as README permits.

## TB2-farm (2026-10-22T16:55:32.128Z)
- Result: done
- Lane commit: e01702a6154cf443b32e7749fcd27396005050a8 (origin/art/textured-a)
- Views accepted:
  - r1: assets/source/textured/farm/farm-r1.png (attempt2; IoU0.982878183825649; p954.846213186053886/4.846213186053886; max5.653915383729533; wall0.38784067085953877/0.3711340206185567; overall1.054054054054054/1.0560747663551402).
  - r2: assets/source/textured/farm/farm-r2.png (attempt2; IoU0.97782114556965; p955.469960242057949/7.032806025503078; max16.558054213370493; wall0.2656826568265683/0.28289473684210525; overall0.8747763864042933/0.8823529411764706).
  - r3: assets/source/textured/farm/farm-r3.png (attempt2; IoU0.969642939015879; p957.086689168832151/7.8619757450768; max14.173378337664301; wall0.314453125/0.3118556701030928; overall1.163375224416517/1.1285046728971964).
- Refused attempts:
  - r1 attempt1: Refused oversized silhouette: f.85 minimum,IoU.692676<.92,p9579.057/78.777>16,max82.619>32. Both height ratios pass; painting/identity/light pass.
  - r2 attempt1: Refused oversize f.85minimum,IoU.911820<.92,p95both18.253>16; max22.283 passes. Wall ratio.260057 versus.282895 is -8.073% outside8%; overall passes.
  - r3 attempt1: Refused huge enlargement f.85minimum,IoU.502677<.92,p95157.884/148.944>16,max174.095>32. Heights/eye pass; reported amber244 not a refusal rule.
- Stop reason: none
- Notes: 6 calls; 3 accepted/3 refused. All three turned views accepted; existing r0 untouched. Timber/slate/stone and curved silo fittings form one coherent painting. Initial outputs enlarged the small render; corrections restored its shape and empty margins. Accepted r1#2,r2#2,r3#2; three refused attempts raw. Farm silhouette fills enclosed holes as its prompt specifies; strict outline/height thresholds unchanged. Full per-attempt exact metrics, returned sizes, prompts, references, hashes and light comparisons: assets/source/textured/farm/prompts.json and REPORT.md. Original hash preflight and raw/copy byte hashes verified. Built-in image auto C: saves copied to G raw and originals left as README permits.

## TB2-quarry (2026-10-22T16:59:54.628Z)
- Result: stopped
- Lane commit: c94b2e2fe966675ad6730e799439d92eb983f789 (origin/art/textured-a)
- Views accepted: none
- Refused attempts: r1attempt1 call refused at output moderation, violence; requestID1b51de0c-afe2-9c47-ace6-b909b1f2ea04. No image returned: measurements unavailable, no raw closest image exists.
- Stop reason: a tool that refuses (README, Running the groups). Stopped immediately without retry or workaround.
- Notes: All9fixedrenderfiles/metadata and acceptedr0hash passed preflight. Exact call/ref order and refusal recorded in assets/source/textured/quarry/prompts.json and REPORT.md. R0 untouched; r2/r3 not run. Queue header says each stop halts this building only; group scope awaiting orchestrator resolution because initial delegation says toolstophaltsgroup.
