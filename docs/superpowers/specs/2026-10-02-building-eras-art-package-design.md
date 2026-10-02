# Buildings by era and rotation: the art package for Codex

Status: design agreed in conversation 2026-10-02; this spec awaits review.
Branch: `buildings/art-package` from `origin/main`.

## Goal

Every building gets one model per age and four views, so that an upgrade swaps the building for
a more modern one and the player can turn it. The pictures are produced by Codex, working on its
own from one prompt, one guide and one work list. This spec covers that package. It also fixes
the conventions the game will rely on.

The whole feature is three sub-projects, each with its own spec and plan:

1. **Art package (this spec).** Conventions, guides, work list, checks, review sheets. No change
   to how the game runs.
2. **Six ages and one level per age.** Nuclear, Magnetic and Hyper join Steam, Diesel and
   Electric. For now a new age only unlocks the next building level.
3. **Rotation, front platform and art integration.** Buildings turn in four steps; a station's
   platform is the track along its front; the game loads the new pictures.

Out of scope everywhere: new locomotives, wagons or track for the new ages (a separate
implementation), old-save compatibility beyond not crashing, bridges, signals, power lines.

## 1. Conventions shared with the game

### Ages

| Index | Id         | Tag  | Look of its buildings                                             |
| ----- | ---------- | ---- | ----------------------------------------------------------------- |
| 0     | `steam`    | `a0` | timber, warm brick, cream stone, slate (today's pictures)         |
| 1     | `diesel`   | `a1` | concrete, steel frames, corrugated sheet, roller doors            |
| 2     | `electric` | `a2` | glass and steel, clean lines, insulators and gantries             |
| 3     | `nuclear`  | `a3` | white concrete, domes, cooling fins, hazard-yellow trim           |
| 4     | `magnetic` | `a4` | smooth composite shells, curved forms, teal light strips          |
| 5     | `hyper`    | `a5` | tubes and rings, cantilevered or hovering parts, dark glass, glow |

A building's first model is that of the age it unlocks in. Level `n` of a building is the model of
age `first + n - 1`. Buildings that cannot be upgraded have one model.

### Rotations

Screen directions of the game: N is up-right, E down-right, S down-left, W up-left. The camera
never moves; the two walls it sees are always the S wall (lower left) and the E wall (lower
right). A building has a front, a back and two sides (A is on the front's right for someone
standing outside and facing it, B on its left).

| Tag  | Front faces    | Lower-left wall shows | Lower-right wall shows |
| ---- | -------------- | --------------------- | ---------------------- |
| `r0` | S (down-left)  | front                 | side A                 |
| `r1` | W (up-left)    | side A                | back                   |
| `r2` | N (up-right)   | back                  | side B                 |
| `r3` | E (down-right) | side B                | front                  |

Each step turns the building a quarter turn clockwise seen from above. The front is where the
door and, for stations, the platform canopy are. Track always runs parallel to the front: in
front of it for stations, through the hall for depots, whose portals are in sides A and B.

### Frame keys and files

- Frame key the game will ask for: `structures/<family>_a<age>_r<rot>`.
- Source file: `assets/source/buildings-v2/<family>/<family>-a<age>-r<rot>.png`.
- `<family>` is the game's art name with underscores (`power_plant`); the file name uses the same.

### Canvas

All pictures are drawn in the game's own projection: orthographic, ground edges at exactly 2:1
(26.57 degrees), verticals vertical, 8 canvas px per game px (a tile is 512 x 256 canvas px).

| Footprint          | Canvas      | Footprint centre | Used by      |
| ------------------ | ----------- | ---------------- | ------------ |
| 1x1                | 1024 x 1024 | (512, 832)       | all others   |
| 1x2 (along a side) | 1024 x 1024 | (512, 800)       | narrow depot |
| 2x2                | 1536 x 1280 | (768, 960)       | depot        |

The footprint centre is a fixed pixel, so the game can place a picture without measuring it.
Background alpha 0. Light from the upper left: tops lightest, lower-left wall mid, lower-right
wall darkest. No ground, shadow, rails, people, smoke, text or loose objects. The building stands
inside its footprint; nothing may reach below or beside the footprint diamond at ground level.

## 2. Inventory

27 families, 560 pictures. First age in brackets.

- **Stations, with a front platform** (24 each unless noted): farm, lumber, quarry, pump, town,
  warehouse, station, mine, sand_pit (all a0); copper_mine (a2, 16 pictures). The three mines
  share the quarry's picture today and get their own.
- **Depots:** depot (2x2, a0), depot_narrow (1x2, a0).
- **Works, rotation for looks only:** windmill, kiln, grinder, colliery, ironworks (a0, 24 each);
  refinery, power_plant, oil_derrick, diesel_refinery (a1, 20 each); substation, hydro_plant,
  wire_mill (a2, 16 each).
- **Houses:** townhouse (a0, 24). Its three construction stages keep today's pictures.
- **Not upgradeable** (one model, 4 views each): water_tower, fuel_stop.

Footprints stay as they are in the game today.

## 3. What Codex receives

Everything lives in `assets/source/buildings-v2/`.

- **`PROMPT.md`**: the one prompt to paste into Codex. It says: read `GUIDE.md`, work through
  `queue.json` in order, and stop at every gate.
- **`GUIDE.md`**: the conventions of section 1 in plain words, the shared style block, how to make
  one picture, how to check it, how to record progress, what to do when a picture fails, and
  where to stop.
- **`queue.json`**: one entry per picture, in working order:
  `{ id, family, age, rot, file, guide, references[], prompt, status, attempts, note }`.
  `status` is `pending`, `generated`, `approved` or `rejected`. Codex edits only `status`,
  `attempts` and `note`.
- **`families.json`**: hand-written, the source of the prompts. Per family: what the building does,
  the features that must stay recognisable in every age (a windmill keeps a rotor, a depot keeps
  its portals), its front, and an optional line per age. The six age styles are written once.
- **`guides/`**: one grey block-out per footprint and rotation (12 files), drawn by code in the
  game's projection: the footprint as a low plinth, a plain massing block on it, the front marked
  by a door opening (depots: portal openings in the end walls). The picture is made as an edit of
  its guide, so camera, scale and position come out the same for every picture.

### How one picture is made

1. Edit the entry's guide image; attach the references; paste the entry's prompt.
2. References, in this order: the style board `docs/art-direction/images/03-theme-town-growth.png`;
   then the picture that fixes the building's identity:
   - age a0, `r0`: today's picture of the family from `assets/source/base-v1/`, for materials and
     details only, not for its angle;
   - any other rotation: the approved `r0` of the same age ("the same building turned on a
     turntable, the camera fixed; not a mirror image");
   - `r0` of a later age: the approved `r0` of the age before, to keep size and function readable.
3. Save under the entry's file name, run the check, record the result.

So within a family the order is a0 r0, a0 r1 to r3, a1 r0, a1 r1 to r3, and so on.

### Order and gates

1. **Pilot: depot, all 24 pictures.** Then stop: the user reviews the sheet. The guide, the
   prompts and the block-outs are corrected from what the pilot shows before anything else is made.
2. The station building, then the other stations, depot_narrow, works, houses, the two
   one-model buildings. One commit per family. A gate after every family: build its review sheet,
   then go on unless the check failed for more than a quarter of its pictures.

Codex works on its own branch, `art/buildings-v2`, and touches only `assets/source/buildings-v2/`.

## 4. Tools (written in this sub-project)

- **`tools/building-guides.mjs`**: draws the 12 block-outs. Pure geometry shared with the tests.
- **`tools/building-queue.mjs`**: builds `queue.json` from the game's data files and
  `families.json`, so the list cannot drift from the game. Run again, it keeps every entry's
  `status`, `attempts` and `note`.
- **`tools/building-check.mjs <file | --family x | --all>`**: for each picture:
  - the canvas size of its footprint, RGBA, a transparent background, nothing opaque on the edge;
  - the building stands on its footprint: its lowest opaque pixels lie on the footprint's front
    corner within 16 canvas px, and at ground level it stays inside the diamond within 24 px;
  - it is not a sliver or a blob: its box is at least half the footprint's width, and its height
    stays under the canvas limit.
    It prints one line per picture and writes `report.json`. Exit code 1 if any picture fails.
- **`tools/building-sheets.mjs`**: one review sheet per family (`review/<family>.png`: a row per
  age, a column per rotation, each picture on its footprint diamond over grass) and
  `review/index.html` listing them with the check results.

Only `pngjs`, which the repository already uses for its other art tools.

## 5. What the game will do with the pictures (sub-project 3, stated here so the art fits)

- Pictures are placed by the fixed footprint centre, without the reprojection and widening that
  today's converter applies to the older pictures.
- A missing picture falls back to the same age in another rotation, then to the age before, then
  to today's picture. The game stays playable while Codex works.
- The structures atlas is split into several files, since one 4096 px sheet cannot hold 560
  pictures.

## 6. Proof

- Unit tests: guide geometry (2:1 slopes, the footprint centre at its pixel, the front on the
  right wall for each rotation); the queue (560 entries, the counts per family of section 2, the
  order, statuses kept on a re-run); the check (hand-made pictures that pass and that fail each
  rule).
- The 12 guides and a sample review sheet rendered and shown on a review page before the package
  is handed to Codex.
- Typecheck, lint, tests, build and formatting pass before every push.
