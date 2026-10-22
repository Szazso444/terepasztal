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
