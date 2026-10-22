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
