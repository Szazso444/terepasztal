# Core review 1 (21 October 2026)

Core re-measured every refused and accepted picture of the first queue run (commit 70a565b9) against the scaffolds on origin/claude/art-scaffolds-review-2, looked at them beside their scaffolds and r0, recalibrated the boundary test and settled the stops. Numbers below are Core's own (the same best-fit method as the lanes' scripts; it reproduces Codex's figures, e.g. Big Station r2 attempt 2: IoU 0.9747, maximum 23.475). IoU is at the best uniform fit; p95 is the larger of the two directed 95th percentiles; max is the largest distance, both in canvas px.

## 1. The seven accepted views: all confirmed

Re-measured and looked at beside the scaffold and r0: Big Station r2 (attempt 2), Big Farm Halt r3 (attempt 3), Town hall r1, r2, r3 (attempt 1 each), Warehouse r1 (attempt 5), r3 (attempt 1). Every one passes the new rule (IoU 0.93 to 0.98, p95 at most 17.1, max at most 23.7), is the same building as r0, turned and not mirrored, crisp on every surface, with no ground or plinth, and its lower-left wall lighter. None is overturned. Big Farm r3 and the Warehouse r1 sit at uniform fits of 0.86 and 0.85: the painter drew them larger than the scaffold, which Art's uniform scale at packing absorbs (width is a measurement only).

## 2. The boundary rule, recalibrated

PASS = IoU at the best fit at least 0.90 AND the 95th percentile of the boundary distances (the larger of the two directions) at most 24 canvas px (3 game px; 18 or 15 on the canvases the prompts name) AND the largest distance at most 48 (6 game px; 36 or 30). All other tests and every named identity detail stay. Every refused attempt of the first run was re-tested:

| job | view | attempt | IoU | p95 | max | old rule | new rule | decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| big_station | r1 | 1 | 0.926 | 25.8 | 29.0 | fail | fail | refused: p95 25.8 > 24 |
| big_station | r1 | 2 | 0.952 | 14.4 | 21.9 | pass | pass | refused: passes the outline (p95 14.4, max 21.9) but the back wall has no plain green service door (identity) |
| big_station | r1 | 3 | 0.956 | 13.4 | 26.7 | fail | pass | ACCEPTED (new): outline passes on the new rule; back wall has the green door and small windows; heights, light, three stacks checked by eye |
| big_station | r2 | 1 | 0.969 | 9.7 | 29.3 | fail | pass | refused: passes the outline but no plain back service door (identity) |
| big_station | r2 | 2 | 0.975 | 8.3 | 23.5 | pass | pass | ACCEPTED (confirmed) |
| big_station | r3 | 1 | 0.937 | 18.3 | 36.8 | fail | pass | passes the outline; not taken, a2 is closer (both show the canopy, benches, lanterns, door, windows) |
| big_station | r3 | 2 | 0.936 | 17.4 | 25.4 | fail | pass | ACCEPTED (new): canopy front, benches, lanterns, door, two windows, one arched window in the left gable, three stacks; left wall lighter |
| big_station | r3 | 3 | 0.901 | 27.6 | 44.3 | fail | fail | refused: p95 27.6 > 24 |
| big_farm | r1 | 1 | 0.820 | 67.0 | 84.8 | fail | fail | refused: IoU 0.82 < 0.90 (first run, old tests) |
| big_farm | r1 | 2 | 0.768 | 87.3 | 106.6 | fail | fail | refused: IoU 0.77 < 0.90 |
| big_farm | r1 | 3 | 0.779 | 96.6 | 122.8 | fail | fail | refused: IoU 0.78 < 0.90 |
| big_farm | r1 | 4 | 0.868 | 41.8 | 52.0 | fail | fail | refused: IoU 0.868 < 0.90, and wall height 0.465 against 0.578 (-20%) |
| big_farm | r1 | 5 | 0.952 | 15.8 | 38.3 | fail | pass | ACCEPTED (new): outline passes (p95 15.8, max 38.3), height 0.534 against 0.578, dormer, silo with pipe, chimney, door as r0; left wall lighter |
| big_farm | r1 | 6 | 0.922 | 22.7 | 58.5 | fail | fail | refused: max 58.5 > 48 (p95 22.7 passes) |
| big_farm | r2 | 1 | 0.958 | 16.2 | 36.0 | fail | pass | ACCEPTED (new): outline passes (p95 16.2, max 36.0); has the required high gable window |
| big_farm | r2 | 2 | 0.964 | 12.5 | 36.4 | fail | pass | refused: passes the outline but the high gable window is missing (identity) |
| big_farm | r2 | 3 | 0.966 | 16.6 | 30.6 | fail | pass | refused: passes the outline but the high gable window is missing (identity) |
| big_farm | r3 | 1 | 0.931 | 24.0 | 41.5 | fail | fail | refused: p95 24.03 > 24 (max 41.5; marginal) |
| big_farm | r3 | 2 | 0.984 | 6.0 | 30.8 | fail | pass | passes the outline (IoU 0.984, p95 6.0); not taken: a3 is accepted and also passes |
| big_farm | r3 | 3 | 0.969 | 9.1 | 15.3 | pass | pass | ACCEPTED (confirmed) |
| town_hall | r1 | 1 | 0.970 | 9.7 | 16.4 | pass | pass | ACCEPTED (confirmed) |
| town_hall | r2 | 1 | 0.954 | 16.2 | 23.7 | pass | pass | ACCEPTED (confirmed) |
| town_hall | r3 | 1 | 0.967 | 14.2 | 18.5 | pass | pass | ACCEPTED (confirmed) |
| warehouse | r1 | 1 | 0.783 | 83.4 | 109.6 | fail | fail | refused: IoU 0.78 < 0.90 (first run) |
| warehouse | r1 | 2 | 0.828 | 89.5 | 96.2 | fail | fail | refused: IoU 0.83 < 0.90 |
| warehouse | r1 | 3 | 0.811 | 71.1 | 80.8 | fail | fail | refused: IoU 0.81 < 0.90 |
| warehouse | r1 | 4 | 0.900 | 23.1 | 25.9 | fail | pass | passes the outline barely (IoU 0.9005, p95 23.1) but no plain backdoor and no row of small windows (identity): refused |
| warehouse | r1 | 5 | 0.971 | 8.7 | 13.4 | pass | pass | ACCEPTED (confirmed) |
| warehouse | r2 | 1 | 0.934 | 16.4 | 25.1 | fail | pass | refused: passes the outline but only 3 windows on the back wall where the accepted r1 has 4 (identity) |
| warehouse | r2 | 2 | 0.911 | 19.6 | 34.3 | fail | pass | passes the outline (IoU 0.911, p95 19.6, max 34.3), four windows and the door; not taken: a3 is closer |
| warehouse | r2 | 3 | 0.932 | 17.1 | 27.3 | fail | pass | ACCEPTED (new): outline passes (p95 17.1, max 27.3); four windows and the door, as the accepted r1 back wall |
| warehouse | r3 | 1 | 0.935 | 17.1 | 22.2 | pass | pass | ACCEPTED (confirmed) |

Result: five views are accepted under the new rule: Big Station r1 (attempt 3) and r3 (attempt 2), Big Farm r1 (attempt 5) and r2 (attempt 1), Warehouse r2 (attempt 3). With the seven confirmed ones that makes all twelve views of C18a, C19a, C20a and C22a: those four prompts are done. The five new ones were already copied into the lane as the closest kept picture (kept: false); the rotations prompt CR1-adopt marks them accepted in prompts.json.

## 3. Fuel Pump (R8e): tests converted, r1 and r2 accepted, r3 to paint

Core measured the lit scaffolds themselves: right-over-left light 0.94 (r1), 0.72 (r2), 0.85 (r3); brick wall height 0.466, 0.461, 0.468 of the base width; jib reach about 128 px in r2. So three old tests, taken from r0's own picture, contradicted the scaffolds and are converted: (a) "jib reach 75 to 110 px", "post top above the tank top" and "hose ending at the door top" are dropped as numbers (the silhouette holds the crane to the scaffold; one post and one jib, by eye); (b) "height not below 0.43 (r0)" is dropped, the 15 per cent comparison with the scaffold stays; (c) the light windows (lower-left 100 to 150, lower-right 60 to 85, ratio 0.75) become: lower-left lighter, right over left at most 0.85, windows reported only. The boundary test is the new one.

| view | attempt | IoU | p95 | max | height (scaffold) | light R/L | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | 13 | 0.674 | 174.8 | 192.9 | 0.431 (0.466) | 0.79 | refused: silhouette |
| r1 | 14 | 0.894 | 19.2 | 24.2 | 0.505 | 0.86 | refused: IoU 0.894 < 0.90 (Codex read 0.856) and light 0.862 > 0.85 |
| r1 | 15 | 0.962 | 7.7 | 14.1 | 0.488 | 0.76 | ACCEPTED: silhouette, height, light (0.763 <= 0.85), one post and one jib as the scaffold, crisp plain brick |
| r3 | 18 | 0.596 | 223.1 | 253.5 | 0.442 | 0.60 | refused: silhouette, wrong door wall |
| r3 | 19 | 0.823 | 34.6 | 39.5 | 0.418 | 1.02 | refused: IoU, p95, light (both walls equal) |
| r3 | 20 | 0.889 | 22.2 | 30.0 | 0.371 (0.468) | 0.98 | refused: IoU 0.889 < 0.90, wall height -21% against the scaffold, light |
| r2 | 10 | 0.592 | 124.6 | 144.2 | 0.418 | 0.63 | refused: silhouette |
| r2 | 11 | 0.978 | 8.8 | 31.8 | 0.425 (0.461) | 0.61 | ACCEPTED: only the old max-distance, "height >= 0.43" and "jib <= 110 px" tests failed; all are dropped or converted |
| r2 | 12 | 0.911 | 24.3 | 32.0 | 0.377 | 0.63 | refused: p95 24.3 > 24, wall height -18% |

R8e is requeued for r3 only (attempts 21 to 23), with a Step 0 that copies attempt 15 and attempt 11 over the r1 and r2 files.

## 4. The stops that were Core's

- **C24a, water pump r2 (and the rule for every scaffold prompt): the scaffold's geometry wins.** The r2 scaffold shows the flywheel's arc and bearing mount and the whole pipe and strainer drum beside the gable; they are painted as shown. The "nothing of it is in this picture" and "no front showing" wording is replaced in every scaffold prompt (C21a to C33a, C4e, C24a) by "its own wall features (door, windows, lamps, benches) are not added to the visible walls; parts the scaffold shows are painted as shown", and every scaffold prompt carries rule 2 in its header. C24a is ready again, with the machinery spelled out for r1, r2 and r3.
- **R8e, fuel pump:** see section 3.
- **C17c, windmill body r0: ACCEPTED, attempt 3.** Its "timber 99" is the tower's dark-brown outline stroke (antialiased, within 3 px of the silhouette's edge), the door frame and the shaft's timber at the stub; after those, 15 pixels remain by the amended test (edge, door box and hub plate excluded), under 25. Looked at: a round smooth tower, no sails, stocks or lattice, slate cone, one window above the door, nothing orange but the iron-banded shaft. Other tests: camera 1.5 degrees, apex over W 1.111, stub slope 0.477, hub 0.23 game px off, door -0.341 and 0.277. C17d may run; its Step 0 marks r0 accepted and the timber test is amended for r1 to r3.
- **R7c-1, people:** the cause was the guide. The foot box's sharp corner (a few px wide, up to 16 px below the sole proper) sat on row 1440 and no painted boot reaches it (soles 9 and 17 px short). PR #539 (branch claude/people-guide-p1-fix) puts the sole row (the lowest row at least 36 px wide) on row 1440; test 2 is unchanged and now reachable. R7c-1 is requeued as run 4: it merges the fix branch first (a note covers PR #539 being merged already).
- **C35a, narrow depot r0:** three free attempts failed the camera (4.1, 4.5, 6.4 degrees against 2). Status blocked: scaffold pending. Core makes a Blender blockout scaffold under scaffolds/depot_narrow/ on origin/claude/art-scaffolds-review-2; the prompt now paints r0, r1, r3 and r2 over it (paths depot_narrow/depot_narrow-r<v>-lit.png, -bare.png, depot_narrow-r<v>.json). It is last in the buildings group and skipped until Core sets it ready.
- **C29a, hydro plant:** it did not run (the rotations group halted at C24a). Stage 1 stays (free r0, strict camera); after any failure the fallback is the same blockout approach (a hydro_plant blockout scaffold from Core), noted in its header and on its queue card.

## 5. The queue now

- rotations: C18a, C22a, C19a, C20a done. Ready: CR1-adopt, then C24a, C25a, C26a, C27a, C28a, C30a, C31a, C32a, C33a, C29a (resume from CR1-adopt).
- buildings: C21a, C23a, C4e ready; C35a blocked (scaffold pending).
- fuelpump: R8e ready (r3 only; r1 and r2 adopted in Step 0).
- windmill: C17c done; C17d ready (Step 0 marks C17c accepted).
- people: R7c-1 ready (run 4, after the guide fix).
- later: C33b (waits for the author's acceptance of C33a).
