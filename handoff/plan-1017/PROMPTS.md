# Codex prompts page v9: content plan (Core, 2026-10-17 evening)

Builds on the v8 page (`codex-prompts-v8/`: `src/*.txt` one file per prompt, `build.py`, `check.py`). v9 keeps that builder and
that layout: a status table, then one block per prompt with a Copy button. It carries **only what Codex still has to paint**:
four entries, in paste order below. The "Delivered and reviewed" and "Done or no longer needed" sections of v8 go (listed under
Dropped). Every path under "Inputs" is a path on `origin/develop` **after** Art's guides issue (A1 in ISSUES.md) has merged; until
then the entry says "waits for A1" and is not shown as pasteable.

Rules every entry repeats, in its first paragraph, because the earlier rounds taught them:

- Work on the named branch (`git fetch`, `git switch`, `git pull --ff-only`), then `git merge origin/develop` once, so the guides arrive as
  new files in their own folder (no conflicts: Art's folders are new). Touch nothing outside the entry's folder. Never push to main or
  develop. Commit subjects `Art: <outcome>`.
- Keep every picture the image tool returns, byte for byte, as `raw/...-attempt-<k>.png` and record each call in `prompts.json`.
- Edit the guide, do not generate fresh; ask for the guide's size; **attach no painting whose legs or shaft already have the wrong
  pose** (R7b: Codex copies the legs of an attached painting whatever the words say; C4c: the same for the stage's height).
- A picture is accepted only when its measured numbers pass; after a failed attempt keep the prompt whole and add a paragraph
  beginning "Correction:" that names the number it missed. At most the stated attempts. If none passes, keep the closest, record the
  failed test, say so in the final message; Core then decides (never silently accept).
- Highlight cap: nothing at or above cursor white `#ECE4D0`, nothing as strong as selection amber `#E8AA48`; real RGBA, alpha 0 background;
  no ground, shadow, text, border, glow, extra objects.

Paste order (lanes run in parallel; inside a lane one at a time, each after the previous one is pushed):

| Order | Id | Lane | Pasteable when | Pictures | Calls |
| --- | --- | --- | --- | --- | --- |
| 1 | R8c Fuel Pump views | buildings | **now** (nothing blocks it; keeps the lane busy while guides are made) | 3 | at most 9 |
| 2 | C17c Windmill | buildings | A1 part B merged | 1 body (sails: only if Core says so) | at most 6 (body 3, sails 3) |
| 3 | C4d Coaling stage r1, r3, r2 | buildings | #325 block-out merged and Core has written the text with the new numbers | 3 | at most 9 |
| 1 (people lane) | R7c-1 People trial | people | A1 part A merged | 4 (one strip) | at most 12 |
| after the trial | R7c-2 to R7c-6 | people | the trial reviewed and passed | 88 (104 with the variant fronts) | per person |

---

## R8c · Fuel Pump r3 relit, r1 and r2 repainted on r0's plan (still owed)

**Still owed?** Yes. Checked: the night-log of 15:25 UTC says "R8c NOT done (fuel-pump still f3ac1a3)"; no delivery on
`art/325-fuel-pump` since R8b (head `f3ac1a30`, 10-16); neither the 10-16 nor the 10-17 review closed it; the v8 page had it first. The 10-17 review
(SUMMARY.md) does not list it as dropped. It is the only entry that needs no guide, so it is first.

- **Branch, folder, issue:** `art/325-fuel-pump`, `assets/source/fuel-2026-10-11/`, #325. Head `f3ac1a30` or later.
- **Asks:** the text of `codex-prompts-v8/src/R8c.txt`, unchanged except the head check (fetch, expect `f3ac1a30`, say so if not):
  r3 first (attempt 7 kept r0's light: front brick luma 121 against the side's 119 where r0 has 112 and 67; its crane is a two-post
  portal; the hose reaches the wall's foot; camera 2.2 degrees), then r1 (attempt 8: camera 4.6 degrees high, walls 0.35 of the house width
  where r0's are 0.45, the crane post in the wrong place), then r2 (still the old square building). Each the committed r0 turned, on
  the existing narrow block-outs made by `make-guides.mjs`.
- **Inputs:** `fuel_pump-a1-r0.png` (hash `c2ef828e...` unchanged), `make-guides.mjs` and the three block-outs in the folder; the light check
  calibrated on raw r3 attempt 7. (These are on the art branch, not on develop; no A1 dependency.)
- **Checks (from the 10-16 review):** plan 2.0 to 2.8 (corners read by eye); camera at most 2 degrees by `checkFile(file, 't1', rot)` and
  `cameraOff` (3 degrees for a near keeper; `building-check.mjs` refuses the name); same-building height (near-corner wall height over
  house width) 0.45 within 10%; light (lower-left over lower-right brick luma) near 112/67; no cursor white, no amber beyond the packer's
  cap pass (Art caps at packing, F4 in the 10-16 report); crane one post as r0; hose clear of the wall foot.
- **Waits for:** nothing. Art packs the Fuel Pump views afterwards (task 13 of the 10-16 report) and #298 needs its placeholder.
- **Risk to note on the page:** the same "painted low" fault hit the coaling stage (C4c). R8c's height check (0.35 against 0.45) is
  in its text; if r1 comes back low again, stop after attempt 2 and say so rather than spending the 9 calls.

---

## C17c · The windmill: a new body without sails, drawn in the game's camera (the sail cross is reused)

- **Branch, folder, issue:** `art/461-windmill-sails` (head `beed486` or later; it holds C17's and C17b's files), a **new** folder
  `assets/source/windmill-2026-10-17/` (nothing in `windmill-2026-10-16/` is edited), #461.
- **Why again (the number the Correction paragraph carries):** the accepted body came back from a camera 19.2 degrees down where the
  game's is 30 (the foot ellipse 0.31 minor over major, the game's 0.50), and its door, window and windshaft face 25 to 29 degrees left
  of the view axis, not 45 (demo-v91/result.json, `fix.windmillAngle`). The first guide was the old picture masked; the new one is drawn
  by the game's own `project()`.
- **Asks (body, required):** repaint the grey block-out as a finished stone tower mill **without sails**, as an edit of the guide.
  Keep the guide's camera and facing exactly: a round tower, a slate cone cap, **a windshaft stub pointing along the lower-left face (tile
  +y; on screen down-left at slope 0.5), ending at an iron hub plate with nothing on it**, the door on that same lower-left side at ground
  level, true to a 2.1 m door on an 8 m tower (the first one was drawn 2.5 m). Same stone, slate and palette as the master
  (`assets/source/base-v1/windmill.png`), light from the upper left, lower-left wall mid, lower-right dark. No sail, no timber lattice, no
  grain sacks hiding the foot. Ask for 1024 x 1024. At most 3 attempts.
- **Asks (sails, only if Core decides after the body review; recommendation: do not paint):** C17b's accepted cross (reach 0.461,
  quarter-turn 0.997, 0 white, 0 amber; folder `windmill-2026-10-16/`, `windmill-sails-front.png` after Art's scale step) is already seen
  face on, looking straight along the windshaft, with the hub at the picture's centre; the game and the demo put it into the camera with an
  exact affine, so it needs no repaint. If the new body's stone or the timber colour clashes, the second step is one arm over
  `windmill-sails-face.png` (3 attempts), composed by the script as in C17b.
- **Inputs (develop, after A1 part B):** `assets/source/buildings-v2/guides/windmill-r0.png` (the block-out, the picture to edit),
  `assets/source/buildings-v2/guides/windmill-r0-hub.json` (hub, shaft direction, door centre, the exact affine), and
  `assets/source/buildings-v2/guides/windmill-sails-face.png` (sails step only); references `assets/source/base-v1/windmill.png`
  (stone, slate and timber to match; its sails are **not** to be copied), `docs/art-direction/images/03-theme-town-growth.png` (style board);
  GUIDE.md sections 5 to 8. At most five images per call, the edited one included.
- **Checks (Codex runs them, Core re-runs):**
  - camera: `tools/building-check.mjs` on the body with the windmill flagged round: at most 2 degrees off (3 as a near keeper; **STOP at 3
    degrees: record, do not repaint again**); foot ellipse minor over major 0.50 +-0.04;
  - stub: its axis, from the cap's centre to the hub plate, projects to the lower left at slope 0.5 +-0.08 (measure two points on the stub's
    top edge); the hub plate's centre within 8 px of `hub` in the JSON (the old picture missed by 15);
  - door: centre column on the lower-left face's centre within 4% of the face's width, height 0.27 +-0.04 of the tower's height to the cap;
  - clean: no timber-coloured pixel (hue 8 to 48 degrees, saturation 0.3 or more) outside the door and hub (the old body had 4);
  - caps: 0 amber, cursor white 0 (the old body had 6,499 white px and Art caps the rest at packing);
  - registration: the body's own box recorded in `hub.json` format (box, hub, hubFromAnchorWorld) by `register-body` for Art's packing.
- **Waits for:** A1 part B (the windmill block-out and hub JSON). Then Art packs the body by its hub box and the cross as a square
  (`structures/windmill` and `_lv2`..`_lv4`; `structures/windmill_sails`), Rendering turns it (W10 in ISSUES.md).
- **Decision (author, 2026-10-18):** all four views are painted, not only rotation 0 (Q5 is answered). C17c paints r0; C17d, written
  and on the Codex prompts page after C17c in the buildings lane, paints r3, r1 and r2 on their own guides, so r1 to r3 no longer keep today's
  static pictures. The sails step (see above) is still open.

---

## C4d · Coaling stage r1, r3 and r2 on the taller block-out

- **Branch, folder, issue:** `art/325-buildings-v2` (head `c25368a` or later), `assets/source/buildings-v2/`, #325.
- **Why again:** after C4c with its r3 addendum, all nine attempts failed the height test (turned views stood 68 to 75% of r0's: `box.top` 445,
  420, 458 against 340 or less); cause: the t1 block-out's head is 40 game px and the painter fills it, so a turned view is as tall as the grey
  block, not as tall as the stage. The fix is Art's, not Codex's: a per-family block height (`fuel_stop` about 62 game px) and the
  stage's own guides `fuel_stop-r0..r3` (the in-flight #325 block-out change). r3 came back correctly turned (not mirrored) in C4c and stays a
  requirement; the kept attempts r1, r2 (3.9 degrees) and r3 (3.4 degrees) are the camera fallback for the STOP rule.
- **Asks:** the text of `codex-prompts-v8/src/C4c.txt` and `C4c-r3.txt` merged into one prompt (r1, r3, r2 order; `redo fuel_stop-a0-r1`
  and `-r3` with the queue tool), with these changes: (1) the references list and the printed prompt come from the queue as before, but the
  block-out is the new taller one; (2) the Correction paragraphs keep their words and add the measured number the last round missed
  ("your last kept views stood at 445, 420 and 458 against r0's 284.8"); (3) "box.top at most 340" is replaced by the number Art's change
  produces (Core fills it: 90% of r0's box.top once the guide's height is applied); (4) r3: the chute, winch drum and chain on the lower-right wall at its
  near (bottom) end, "this view is the front view turned on a turntable, not flipped".
- **Inputs (develop, after the block-out change merges):** `assets/source/buildings-v2/guides/fuel_stop-r0.png` to `-r3.png` (names to be
  confirmed from the merged change), `families.json` (`blockHeight`), the master `assets/source/buildings-v2/fuel_stop/fuel_stop-a0-r0.png`
  (sha256 `49f701ce...6c6ce4`; stop if it differs), `tools/building-queue.mjs`, `building-fit.mjs`, `building-check.mjs`, `building-sheets.mjs`.
- **Checks:** unchanged from C4c except the height: plan ratio r1 and r3 1.16 to 1.57, r2 0.62 to 0.84; `box.top` within 10% of r0's (the new
  height test added to `building-check` by Art, task 15 of the 10-16 report); camera accepted by `set` (STOP at 3 degrees); no chute, winch or
  chain on the hidden walls; six piers, three along the long side; lower-left wall lighter than lower-right. At most three attempts per view.
- **Waits for:** the #325 block-out change merged (wf_d14e3ed4-ad8) and Core writing the final text with its numbers. Not before.

---

## R7c · People: whole figures on three-quarter pose guides

**Method change (decided with the author, 10-17):** the whole figure is repainted, not only the legs (the straight-away back strips are the
wrong view for a game that walks on the iso diagonals), on guides Art makes (A1 part A). R7b's correction is **not** reused: it attached
a painting and Codex copied its legs; here the only pose authority is a grey mannequin and the only identity input is an upper body with the
legs cut off ("composite-input method"; board card codex-limping-walks, "Art and Codex try this on one strip first").

- **Branch, folder, issue:** `art/331-people` (head `8005c80` or later, after R7b), new subfolder `assets/source/people-2026-10-11/v3/`
  (`raw/`, `poses/`, `strips/`, `prompts.json`), #331. Everything already in the folder (accepted strips, `finish-report.json`,
  `redo-state.json`, `guides/`, `refs/`, `review/`, `game-scale/`, `inputs/`) stays untouched; do not run `export-*.cjs`, `build-review.cjs`,
  `verify-exports.cjs`.
- **Inputs (develop, after A1 part A):** `assets/source/people-v3-guides/` : `back-<arm>-p1.png` to `-p4.png` and `front-<arm>-p1.png` to
  `-p4.png` for arm = swing, shoulder, block, yoke (1024 x 1536; the figure 960 px tall, soles on row 1440, centre column 512);
  `manifest.json` (every joint in canvas px); `identity/<strip>-upper.png` (the person above the hips, legs removed); `README.md`. Style
  authority `assets/source/people-2026-10-11/reference-passenger.png` (on the branch). Nothing else attached: **no painting with legs.**
- **The pose, per frame:** k = 0..3 is P1..P4 in time order (contact, right foot leads; passing, right foot planted; contact, left foot leads;
  passing, left foot planted); the demo and the game play 0, 1, 2, 3. Back view: walking toward the upper right (tile -y), turned 45 degrees,
  we see the back and the right side in three quarters; the up-left walk is the mirror, so paint only the up-right one. Front view: walking
  toward the lower right (tile +x), the face and the front-right side in three quarters; the lower-left walk is its mirror. The legs, boots and
  arms follow the guide exactly; the clothes, load, hair, skin and size come from the identity crop.
- **Asks per painting:** an image **edit** of the guide for that pose, one painting per call, 1024 x 1536; the person from the identity crop;
  the load and tool of the strip (log, sheaf, yoke with two buckets and teal water, dressed stone) held as the guide's arms hold them.
- **Checks (Codex measures, `check-poses.mjs` extended; Core re-runs):**
  - height 960 px +-5% and soles on the guide's sole row +-2%; head bob across the four frames at most 2% (3.5% carrying);
  - bounding box of the painting within 5% of the guide's width and height;
  - **repeat test:** lowest 40% of each figure, alpha above 128: intersection over union of P1 with P3 below 0.45 and of P2 with P4 below 0.45 (the
    guides measure about 0.39; the failed R7b attempts 0.53 to 0.62; accepted back strips 0.31 to 0.47);
  - **planted foot:** each sole's lowest-point position along the walking axis within 4% of the figure height of the guide's, and the
    slide of the stance foot between consecutive poses 0.123 of the height +-0.03 (the demo's gait: 4 texels at zoom 4 per pose);
  - facing: back view shows no face; near shoulder to far shoulder width ratio within 15% of the guide's;
  - same person in the four frames: the dominant colours of cap, shirt and trousers within a small distance of the identity crop's;
  - no outline round the whole figure (outline score under 0.15, as the accepted back strips 0.00 to 0.12);
  - caps and alpha as above; teal water `#477B82`, never cyan;
  - by eye: the 50% overlay of P1 and P3 shows the thighs crossing in an X; the 9 px and 36 px strips (`assemble-strips.mjs`) show the
    leading leg changing and P2, P4 lifting opposite feet.
- **Trial (R7c-1):** one strip, **lumberjack-back-walk**, 4 paintings, at most 3 attempts each. Pass means all four frames pass and the strip
  reads as a walk at 9 px. If it fails twice on the same test, stop and report; Core adjusts the guide, not the prompt.
- **After a passed trial (R7c-2 to R7c-6, same template, written by Core):** one prompt per person, each its strips:
  - R7c-2 lumberjack: back-carry (log on shoulder), front-walk, front-carry;
  - R7c-3 stone-mason: back-walk, back-carry (block), front-walk, front-carry;
  - R7c-4 farmer: back-walk, back-carry (sheaf), front-walk, front-carry;
  - R7c-5 pump-hand: back-walk, back-carry (yoke), front-walk, front-carry (the strip R7b could not fix; plays f1, f3 until then);
  - R7c-6 the others: passenger-back-walk, railway-worker back-walk and front-walk, passenger-variant-01..04 back-walk (the 4 variant fronts only if Q6
    says so).
  That is 14 back strips (56 paintings) and 9 limping fronts (lumberjack, stone-mason, farmer, railway-worker, pump-hand walk; lumberjack,
  stone-mason, farmer carry; pump-hand carry) = 36 more, 92 in all (108 with the variant fronts).
- **Waits for:** A1 part A merged (guides, manifest, identity crops); for the variant fronts, Q6. Then Art packs the people atlas
  (#331, #304: resolution 4, keys `people/<profession>_<front|back>_<walk|carry>_f0..f3`, one scale per strip) and Rendering does P1 (#323).
- **Do not use:** `demo-v91/fix2/legDefects.json`'s texel positions. They were derived for straight-away bodies and are superseded by the
  guide; only its order convention (frame k = P(k+1)) survives.

---

## Dropped from the page, and why

| v8 entry | Why it goes |
| --- | --- |
| C4c and its r3 addendum (v8 "Paste next", "Addendum: r3 turned") | delivered 10-17 (`c25368a`), reviewed: r0 packs, r1 to r3 fail height; replaced by **C4d** on the taller block-out. The author's answer on the r3 mirror ("repaint r3") is folded into C4d |
| R7b pump hand front carry f2 | delivered 10-17 (`8005c80`), reviewed: all three attempts rejected (overlap 0.464, 0.456, 0.498 against 0.45); Core's fallback (play f1, f3; overlap 0.324) stands; no more Codex tries by that method. The strip is in R7c-5 by the new method |
| C17b windmill sail cross | delivered 10-17 (`beed486`), reviewed: Core's scale step makes it pass every check; **kept and reused** by C17c |
| C17 (original) windmill body and sails | delivered, its body replaced by C17c; the sail attempts dropped |
| "Delivered and reviewed" section (R8b, C16, C17, R7 resumed, C4b) | history, not paste items. Their verdicts live in codex-review-1016/REPORT.md |
| "Done or no longer needed" section (R1 to R6, R9, R10, R8, C4, R8b, C16, C17, earlier rounds) | history |
| "Held: C17b" paragraph and the R7c "comes later, not written yet" note | resolved: both are entries now |
| "Trees lane: nothing", "water, mountain, loading, bridges lanes need nothing more" | not needed once the page lists only what to paste. Road-bridge art (B5 in ISSUES.md) is a Core/Art texture task, not Codex, unless the author asks for painted road decks |

## Open items that change the page

- Q5 (rotations 1 to 3 of the windmill) and Q6 (passenger variants) in ISSUES.md.
- The sails step of C17c: Core's call after the body review.
- If the author wants the demo's True-to-people choice (v9.2) to alter the windmill door, nothing changes here: the body is drawn with a true 2.1 m door.
- Build and check: copy `codex-prompts-v8/` to `codex-prompts-v9/`, replace `src/*.txt` with `R8c.txt` (v8's, head check added), `C17c.txt`, `C4d.txt` and `R7c-1.txt` (R7c-2 to -6 follow the trial), run `build.py` and `check.py`,
  read the page whole before publishing, as for v8.
