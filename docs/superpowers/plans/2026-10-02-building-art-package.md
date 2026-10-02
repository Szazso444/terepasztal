# Building Art Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Codex everything it needs to paint every building in six ages and four views on its own: conventions, block-out guides, a work list with a prompt per picture, a checker and review sheets.

**Architecture:** Small Node tools under `tools/`, sharing one module of conventions (`building-kit.mjs`). The work list is generated from the game's data files plus one hand-written file of building descriptions, so it cannot drift from the game. Nothing in `src/` changes.

**Tech Stack:** Node ES modules, `pngjs` (already a dev dependency), Vitest (`tools/**/*.test.mjs` is already included).

**Spec:** `docs/superpowers/specs/2026-10-02-building-eras-art-package-design.md`

## Global Constraints

- No new dependencies; tools use `pngjs` and Node built-ins only.
- Ages, in order: `steam`, `diesel`, `electric`, `nuclear`, `magnetic`, `hyper`; tags `a0`..`a5`.
- Rotations `r0`..`r3`: the front faces S, W, N, E. The lower-left wall is the S wall, the lower-right wall the E wall.
- Wall role for wall index `i` (S=0, W=1, N=2, E=3) at rotation `r`: `(i - r) mod 4` is 0 front, 1 side B, 2 back, 3 side A.
- Footprints: `t1` 1024x1024, 8 canvas px per game px, centre (512, 832); `t1x2` 1024x1024, 8, centre (512, 800), 2x1 tiles at even rotations and 1x2 at odd ones; `t2x2` 1536x1024, 6, centre (768, 760).
- Projection: `x' = cx + s * (x - y) * 32`, `y' = cy + s * ((x + y) * 16 - z)`, with x, y in tiles from the footprint centre and z in game px.
- Source file of a picture: `assets/source/buildings-v2/<family>/<family>-a<age>-r<rot>.png`. Frame key the game will use: `structures/<family>_a<age>_r<rot>`.
- 27 families, 560 pictures (spec section 2).
- Codex edits only `status`, `attempts` and `note` in `queue.json`; a re-run of the queue tool keeps them.
- Run typecheck, lint, tests, build and CI's prettier scope before every push; format new tool files with prettier.

## Review Focus

- A family added to the game's data without an entry in `families.json`: the queue tool must stop with the family's name, not write a list with a hole (Task 3 test `stops when a family has no description`).
- A picture whose building floats or sits beside its footprint must fail the check with a message that says which way it is off (Task 4 test `says which way the base is off`).
- A picture saved at the wrong canvas size (the generator returned 1536x1024 for a 1024x1024 guide) fails with the sizes named (Task 4 test `names the canvas it expected`).
- Re-running the queue tool after Codex marked pictures must not reset them (Task 3 test `keeps status, attempts and note on a re-run`).
- A family with missing pictures still gets a sheet, with empty cells where pictures are missing (Task 5 test `leaves a missing picture's cell empty`).

---

### Task 1: Conventions and inventory (`tools/building-kit.mjs`)

**Files:**

- Create: `tools/building-kit.mjs`, `tools/building-kit.test.mjs`

**Interfaces (Produces):**

- `AGES`: six `{ index, id, tag, name }`.
- `ROTATIONS`: four `{ index, tag, front: 'S'|'W'|'N'|'E' }`.
- `WALLS = ['S','W','N','E']`, `wallRole(wall, rot)` returns `'front'|'sideB'|'back'|'sideA'`.
- `FOOTPRINTS = { t1, t1x2, t2x2 }`, each `{ id, canvas: [w, h], scale, centre: [x, y] }`.
- `footprintTiles(fp, rot)` returns `{ w, h }` in tiles.
- `project(fp, x, y, z = 0)` returns `[px, py]`.
- `diamond(fp, rot)` returns `{ n, e, s, w }` canvas points of the footprint's corners (n is the far corner, s the near one).
- `loadInventory(root = '.')` returns an array of `{ family, id, name, kind: 'station'|'depot'|'works'|'house'|'service', footprint, firstAge, ages, upgradeable }` in working order (depot, station, the other stations, depot_narrow, works, townhouse, water_tower, fuel_stop).
- `pictureFile(family, age, rot)` returns the repo-relative source path; `frameKey(family, age, rot)`.
- `pictures(inventory)` returns every `{ family, age, rot, file }` in working order: within a family by age, r0 first.

Inventory rules: stations from `src/data/stations.json` (`defs`) and `src/data/stations_full.json`; the family is the `art` name, except the three full-chain mines, whose family is their id. Works from `src/data/buildings.json` and `src/data/buildings_full.json` without `bridge`; family = id; `firstAge` = `tier`. Houses and services from `src/data/decor.json`: `residents` makes a house; neither `onTrack` nor `power` nor `residents` makes a service (one model). Upgradeable families have `6 - firstAge` ages, services 1.

- [ ] **Step 1: Write the failing tests** in `tools/building-kit.test.mjs`:
  - `counts 27 families and 560 pictures`, with `depot` first and `fuel_stop` last.
  - `gives later buildings fewer ages`: refinery 5 from a1, substation 4 from a2, water_tower 1.
  - `names the wall roles for each rotation` against the spec's table (lower-left = S, lower-right = E).
  - `projects ground edges at exactly two across for one down` and `puts the footprint centre on its pixel`.
  - `turns the narrow depot's footprint with it` (2x1 at r0, 1x2 at r1).
  - `names files and frame keys` (`assets/source/buildings-v2/power_plant/power_plant-a3-r2.png`, `structures/power_plant_a3_r2`).
- [ ] **Step 2: Run** `npx vitest run tools/building-kit.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `tools/building-kit.mjs`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `Building kit: ages, rotations, footprints and the inventory from the game's data`.

### Task 2: Block-out guides (`tools/building-guides.mjs`)

**Files:**

- Create: `tools/building-guides.mjs`, `tools/building-guides.test.mjs`
- Create (generated): `assets/source/buildings-v2/guides/<footprint>-r<rot>.png` (12 files)

**Interfaces:**

- Consumes: `FOOTPRINTS`, `footprintTiles`, `project`, `wallRole` from Task 1.
- Produces: `GREY = { top, left, right, line, plinthTop, plinthLeft, plinthRight, opening }`, `drawGuide(fpId, rot)` returning a `PNG`, `guideFile(fpId, rot)`, raster helpers `fillPoly(png, pts, rgb)` and `strokePoly(png, pts, rgb)`, and a CLI `node tools/building-guides.mjs [outDir]`.

Guide content: transparent canvas; the footprint as a plinth 4 game px high; on it a flat-topped block inset 0.06 tile, 40 game px high for `t1`, 34 for `t1x2`, 46 for `t2x2`. `t1`: a door (0.24 tile wide, 20 px high) in the middle of the front wall. Depots: a crew door (0.16 tile, 18 px) in the middle of the front wall and portals in sides A and B: `t2x2` two per wall (0.5 tile wide, 30 px high, at -0.5 and +0.5 tile from the wall's middle), `t1x2` one (0.44 tile, 24 px). Only the S and E walls are drawn. Faces flat greys: top lightest, S wall mid, E wall darkest, dark outline.

- [ ] **Step 1: Write the failing tests**: canvas size per footprint; corners transparent; the top face's middle is `GREY.top`, the S wall's middle `GREY.left`, the E wall's middle `GREY.right` (sampled off the openings); `shows the front door only where the front can be seen` (t1: opening colour at the door's centre for r0 on the S wall and r3 on the E wall, wall colour for r1 and r2); `opens the depot's portals in its end walls` (t2x2 r0: E wall has two openings, S wall the crew door; r1: S wall has two openings, E wall none); the plinth's near corner lies on `diamond().s`.
- [ ] **Step 2: Run** `npx vitest run tools/building-guides.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS. Then `node tools/building-guides.mjs` and look at two of the files.
- [ ] **Step 5: Commit** `Building guides: grey block-outs per footprint and rotation`.

### Task 3: Descriptions and the work list (`families.json`, `tools/building-queue.mjs`)

**Files:**

- Create: `assets/source/buildings-v2/families.json`, `tools/building-queue.mjs`, `tools/building-queue.test.mjs`
- Create (generated): `assets/source/buildings-v2/queue.json`

**Interfaces:**

- Consumes: `loadInventory`, `pictures`, `AGES`, `ROTATIONS`, `guideFile`.
- Produces: `buildQueue(inventory, families, previous?)` returning `{ schema: 1, style, pilot: { family: 'depot', approved }, entries }`; `promptFor(entry, families)`; CLI `node tools/building-queue.mjs` (writes `queue.json`, keeping `status`, `attempts`, `note` and `pilot.approved` from the existing file).

`families.json`: `{ shared, style, ages: { a0..a5 }, views: { r0..r3 }, families: { <family>: { what, keep, front, base, ages: { a<n>: line } } } }`. `base` is the repo path of today's picture, or `null`. Every family has a line for each of its ages.

Entry: `{ id: '<family>-a<age>-r<rot>', family, age, rot, file, guide, references: [...], prompt, status: 'pending', attempts: 0, note: '' }`. References: the style board first; then for the family's first age at r0 its `base` (when it has one), for r1..r3 the same age's r0 file, for a later age's r0 the r0 file of the age before. `depot_narrow` has no base: its first picture refers to `depot`'s a0 r0.

Prompt: the shared block, then `Building:` (name and `what`), `Age:` (the age's style, then the family's line for it), `Keep:`, `Front:`, `View:` (the rotation's sentence), and a closing line on the reference's role.

- [ ] **Step 1: Write the failing tests**: 560 entries, ids unique, the first 24 are the depot's; `stops when a family has no description`; `stops when a description names no line for one of the family's ages`; `every base picture exists on disk`; references per the rule above (four cases); the prompt holds the shared block, the age style, the family's line, `keep`, `front` and the view sentence; `keeps status, attempts and note on a re-run`; `keeps the pilot's approval`.
- [ ] **Step 2: Run** `npx vitest run tools/building-queue.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write `families.json`** (27 families) and implement the tool.
- [ ] **Step 4: Run** tests. Expected: PASS. Then `node tools/building-queue.mjs`; expected output `560 pictures, 27 families`.
- [ ] **Step 5: Commit** `Building queue: one entry and prompt per picture, from the game's data and families.json`.

### Task 4: The checker (`tools/building-check.mjs`)

**Files:**

- Create: `tools/building-check.mjs`, `tools/building-check.test.mjs`

**Interfaces:**

- Consumes: `FOOTPRINTS`, `diamond`, `loadInventory`, `pictures`; `drawGuide`, `fillPoly` in tests.
- Produces: `checkPicture(png, fpId, rot)` returning `{ ok, problems: string[] }`; `checkFile(path, fpId, rot)`; CLI `node tools/building-check.mjs <file ...> | --family <name> | --all` printing one line per picture, writing `assets/source/buildings-v2/report.json` (`{ checked, failed, pictures: { id: { ok, problems } } }`), exit code 1 on any failure. Missing files are skipped by `--family` and `--all` and reported as `missing` (not failures).

Rules (alpha > 128 is opaque):

1. Canvas equals the footprint's canvas: `canvas 1536x1024, expected 1024x1024`.
2. Background: at least 25% of pixels have alpha <= 8 and the four 16 px corners are empty: `background is not transparent`.
3. Nothing opaque within 2 px of the edge: `touches the <top|left|right|bottom> edge`.
4. Base: the lowest opaque pixel lies between 48 px above and 12 px below the footprint's near corner: `base is N px above|below the footprint`; the opaque box's horizontal middle is within 40 px of the footprint centre's x: `base is N px left|right of the footprint`.
5. Ground: no opaque pixel lies more than 12 px below the footprint's two near edges, and none lies further than 48 px outside the footprint's left or right corner: `reaches outside the footprint at the left|right|ground`.
6. Size: the opaque box is at least half the footprint's width and its top is at least 16 px from the canvas top: `too small`, `too tall for the canvas`.
7. Solid: at least half of the non-empty pixels have alpha >= 240: `mostly translucent`.

- [ ] **Step 1: Write the failing tests** using a picture made in the test (the guide's block without its plinth): passes; `names the canvas it expected`; an opaque background fails rule 2; `says which way the base is off` (the block shifted 80 px right, then 80 px up); a tiny block fails `too small`; a block running to the edge fails rule 3; a half-transparent block fails rule 7.
- [ ] **Step 2: Run** `npx vitest run tools/building-check.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `Building check: canvas, background, footprint contact and size`.

### Task 5: Review sheets (`tools/building-sheets.mjs`)

**Files:**

- Create: `tools/building-sheets.mjs`, `tools/building-sheets.test.mjs`

**Interfaces:**

- Consumes: `loadInventory`, `pictureFile`, `FOOTPRINTS`, `diamond`, `fillPoly`.
- Produces: `drawSheet(family, load)` returning a `PNG` (`load(file)` returns a `PNG` or `null`); `sheetFile(family)` = `assets/source/buildings-v2/review/<family>.png`; `indexHtml(inventory, queue, report)`; CLI `node tools/building-sheets.mjs [--family <name>]` writing the sheets and `review/index.html`.

Sheet: one row per age of the family, one column per rotation; a cell is the canvas at a quarter size (256x256, or 384x256 for the depot) on grass green, with the footprint diamond in a darker green under the picture; pictures are averaged down with premultiplied alpha. The index lists every family with its sheet, the count of pictures done, and each failed picture with its problems.

- [ ] **Step 1: Write the failing tests**: sheet size (`t1`, 6 ages: 1024x1536; depot: 1536x1536; a service: 1024x256); a cell with a picture shows the picture's colour at the block's middle; `leaves a missing picture's cell empty` (grass and diamond only); the index names every family and a failed picture's problem.
- [ ] **Step 2: Run** `npx vitest run tools/building-sheets.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `Building sheets: one review sheet per family and an index`.

### Task 6: The guide and the prompt for Codex

**Files:**

- Create: `assets/source/buildings-v2/GUIDE.md`, `assets/source/buildings-v2/PROMPT.md`
- Modify: `package.json` (scripts `art:buildings:guides`, `art:buildings:queue`, `art:buildings:check`, `art:buildings:sheets`)
- Create: `tools/building-docs.test.mjs`

`GUIDE.md` covers, in this order: what is being made and why; the conventions (ages, rotations with the wall table, footprints and canvases, what a picture must and must not contain); the files; making one picture step by step (edit the guide, attach the references in order, paste the prompt, save, check, look at it over its guide, record); what to do when a picture fails (up to three attempts, then `rejected` with a note, and go on); the order and the gates (the pilot stops for the user; after that one commit per family with its sheet); how to resume (`queue.json` is the only state); what not to touch.

`PROMPT.md` is the short text the user pastes into Codex.

- [ ] **Step 1: Write the failing test** `tools/building-docs.test.mjs`: the guide names every tool command that exists in `package.json`, every status word, the pilot gate and the four footprint canvases as the kit has them; the prompt names `GUIDE.md` and `queue.json`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Write the two documents and the scripts.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `Building guide and prompt for Codex`.

### Task 7: Proof

- [ ] **Step 1:** Generate the guides, the queue and a sample sheet (the guides' own blocks standing in for pictures) and build a review page: the 12 guides, the sheet layout, the depot's prompts for a0 and a3, the counts per family, the text of `PROMPT.md`.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build` and `npx prettier --check --end-of-line auto "src/**/*.{ts,json,css}" index.html tools/building-*.mjs`. Expected: all pass.
- [ ] **Step 3:** Commit and push `buildings/art-package`.
