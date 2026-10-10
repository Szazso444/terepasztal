# Buildings by era and rotation: the art package for Codex

Status: design agreed in conversation 2026-10-02. Revised 2026-10-04 after the depot pilot's first
pictures and the branch review: pictures are measured, not required to match their guide to the
pixel (section 1, Canvas; section 4), and there are two gates (section 3).
Branch: `buildings/art-package` from `origin/main`.

## Goal

Every building gets one model per age and four views, so that an upgrade swaps the building for
a more modern one and the player can turn it. The pictures are produced by Codex, working on its
own from one prompt, one guide and one work list. This spec covers that package. It also fixes
the conventions the game will rely on.

The whole feature is four sub-projects, each with its own spec and plan:

1. **Art package (this spec).** Conventions, guides, work list, checks, review sheets. No change
   to how the game runs.
2. **Track toolbar.** Track pieces grouped by type with hotkeys, regular track renamed to wide,
   and tools that upgrade wide track to high speed or downgrade it by dragging along it. Its own
   spec: `2026-10-02-track-toolbar-design.md`.
3. **Ages and upgrading.** Nuclear, Magnetic and Hyper join Steam, Diesel and Electric; for now a
   new age only unlocks the next building level. An upgrade takes game time, during which the
   building neither produces nor consumes (the depot's is instant), and ends with a halo over the
   building, like a level-up.
4. **Rotation, front platform and art integration.** Buildings turn in four steps with R, the key
   that already turns track; a station's platform is the track along its front; the game loads
   the new pictures.

Out of scope everywhere: new locomotives, wagons or track for the new ages (a separate
implementation), old-save compatibility beyond not crashing, bridges, signals, power lines.

## 1. Conventions shared with the game

### Ages

| Index | Id         | Tag  | Look of its buildings                                                          |
| ----- | ---------- | ---- | ------------------------------------------------------------------------------ |
| 0     | `steam`    | `a0` | small and rural: timber, cream limestone, warm brick, slate (today's pictures) |
| 1     | `diesel`   | `a1` | larger, industrial: brick on cream stone, riveted iron trusses, roof lights    |
| 2     | `electric` | `a2` | refined and civic: dressed cream stone, glass-and-iron canopies, insulators    |
| 3     | `nuclear`  | `a3` | broad and substantial: cream concrete, low domes, olive-green armour, fins     |
| 4     | `magnetic` | `a4` | light and elegant: cream-white walls, green bands, teal glass, planted roofs   |
| 5     | `hyper`    | `a5` | calm pastoral futurism: cream tubes and rings on stone bases, teal glass       |

The looks follow the repository's own art direction (`docs/art-direction/`, boards 04 and 05):
one landscape through every age, cream masonry and the game's palette throughout, no neon.

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

Each step turns the building a quarter turn clockwise seen from above; in the game the player
takes a step with R, as for track. The front is where the
door and, for stations, the platform canopy are. Track always runs parallel to the front: in
front of it for stations, through the hall for depots, whose portals are in sides A and B.

### Frame keys and files

- Frame key the game will ask for: `structures/<family>_a<age>_r<rot>`.
- Source file: `assets/source/buildings-v2/<family>/<family>-a<age>-r<rot>.png`.
- `<family>` is the game's art name with underscores (`power_plant`); the file name uses the same.

### Canvas

All pictures are drawn in the game's own projection: orthographic, ground edges at 2:1
(26.57 degrees), verticals vertical. Each footprint has a canvas with the footprint's centre on a
fixed pixel. The guides are drawn on it, and it is the size Codex asks the image tool for.

| Footprint                   | Canvas      | Canvas px per game px | Footprint centre | Used by      |
| --------------------------- | ----------- | --------------------- | ---------------- | ------------ |
| `t1`: 1x1                   | 1024 x 1024 | 8                     | (512, 832)       | all others   |
| `t1tall`: 1x1, room to grow | 1024 x 1536 | 8                     | (512, 1344)      | houses       |
| `t1x2`: 1x2, long way front | 1024 x 1024 | 8                     | (512, 800)       | narrow depot |
| `t2x2`: 2x2                 | 1536 x 1024 | 6                     | (768, 760)       | depot        |

A tile is 64 x 32 game px. A building's walls stand 0.06 tile inside its footprint's edge.

**A picture is measured, not prescribed.** The depot pilot showed what an image generator returns
for a guide: the guide's view, but the building half as large again, not where the block is, on a
canvas size of its own choosing (1254 x 1254 for a 1024 x 1024 guide), and with ground lines a
little off 2:1 (0.30 to 0.56 instead of 0.5). So a picture is not required to match its guide.
`tools/building-fit.mjs` finds the bases of the two visible walls in the picture and derives from
them the scale, the place and a small camera correction (a vertical stretch and shear that leave
upright edges upright) that lay the building onto its footprint. A building whose foot is not two
straight walls (a round tower, a yard of machinery) is placed by its outline, without a camera
correction. The check, the review sheets and the game's atlas all use this one measurement.

**The camera is required, not corrected into use.** The correction stretches a picture, and seen
in the game a stretched building looks wrong: of the first 84 pictures 13 needed more than 15 %.
So the correction is for small differences only. From the two wall feet the tools read where the
camera stood: how steeply it looked down (the game's looks down at 30 degrees) and how far the
building was turned from 45 degrees. A picture whose camera is more than 2 degrees off in either
is failed by the check (the user's choice, made on renders from the game; the generator's own
scatter is about 4 degrees, so most pictures need more than one attempt). Where only one wall
foot is straight, that foot must have a slope a camera within the limit can draw (0.44 to 0.57).

A picture refused for its camera alone is not made again from scratch. The tool keeps it: the
closest attempt so far is the picture's earlier self, and the next attempt is painted from that,
laid onto its footprint and straightened, with what was wrong said as a description. An
instruction ("look down more steeply") made the generator overshoot, from too low to too high
and back. After three attempts the tool makes the closest of them all the picture, corrected as
far as the tools correct, and marks it `kept` with how far off it is. A picture made before this
rule goes back in the queue (`recheck`) and is painted again the same way, so it stays the same
building and the pictures built on it stay as they are.

What keeps this from running away: the tool counts the attempts it refuses, so three stays three
across sessions; a gate family that has pictures put back is shown to the user again before the
work goes on; and a family where more than a quarter of the pictures had to be kept more than 3
degrees off stops the work like one that lost them. A picture shown to the generator as a reference is straightened all
the way, however far off it was, because the generator copies the wall feet it is shown; only
what goes into the game is limited in how far it is stretched.

Background alpha 0. Light from the upper left: tops lightest, lower-left wall mid, lower-right
wall darkest. No ground, shadow, rails, people, smoke, text or loose objects. The foot of the two
visible walls stays plain and straight, with nothing in front of it: it is what is measured.

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
- **`queue.json`**: the record of progress, one entry per picture in working order:
  `{ id, family, age, rot, file, status, attempts, note }`. `status` is `pending`, `generated`,
  `approved` or `rejected`. It holds no prompts, so it stays small enough to read and to diff.
  Two marks are added where they apply: `kept` (made, but with its camera off: the closest of
  three attempts, with the degrees it is off) and `repaint` (back in the queue to be painted again from its earlier self,
  which is kept beside it as `<name>.before.png`; the mark holds how far off that was and what
  was wrong with it, for the prompt).
- **The queue tool** (`tools/building-queue.mjs`) is how Codex works the list: `next` prints the
  next picture with its file, guide, references and prompt; `set` records a result; `status`
  shows progress and where the list and the disk disagree; `redo` puts pictures back, to be made
  afresh (`redo <id>` says what it would undo and waits for `--yes`); `recheck` puts back the
  made pictures whose camera is off, to be painted again as the same building; `set <id> pending`
  takes one recorded picture back;
  `approve-pilot` and `accept` record the user's decisions. `next` answers with its exit code: 0 a
  picture, 2 a gate, 3 nothing left, 4 a stop. A picture is recorded as made only when its file is
  there and passes the check; a rejected picture's file is set aside (`*.rejected.png`), and
  nothing is ever built on a picture that was rejected or whose file is gone.
- **`families.json`**: hand-written, the source of the prompts. The shared block, the six age
  styles, the four view sentences, and per family: what the building does, the features that must
  stay recognisable in every age (a windmill keeps its sails, a depot its portals), its front,
  today's picture, and a line for each of its ages.
- **`guides/`**: one grey block-out per footprint and rotation (16 files), drawn by code in the
  game's projection: the footprint as a low plinth, a plain massing block on it, the front marked
  by a door opening (depots: portal openings in the end walls). The picture is made as an edit of
  its guide, which fixes its view and which wall is which; its scale and position are measured.

### How one picture is made

1. Edit the entry's guide image; attach the references; paste the entry's prompt.
2. References, in this order: the style board `docs/art-direction/images/03-theme-town-growth.png`;
   then the picture that fixes the building's identity (and, for the first picture of an age, the
   mood board of the early or the later ages last):
   - age a0, `r0`: today's picture of the family from `assets/source/base-v1/`, for materials and
     details only, not for its angle;
   - any other rotation: the approved `r0` of the same age ("the same building turned on a
     turntable, the camera fixed; not a mirror image");
   - `r0` of a later age: the approved `r0` of the age before, to keep size and function readable.
3. Save under the entry's file name, run the check, record the result.

So within a family the order is a0 r0, a0 r1 to r3, a1 r0, a1 r1 to r3, and so on.

### Order and gates

1. **First gate: depot, all 24 pictures.** It is the only two-by-two building. Then stop: the user
   reviews the sheet. The guide, the prompts and the tools are corrected from what it shows.
2. **Second gate: station, all 24 pictures.** It is the first one-tile building, on another canvas
   and with a canopy on posts along its front: what the depot cannot show.
3. The other stations, depot_narrow, works, houses, the two one-model buildings. One commit per
   family. When more than a quarter of a family could not be made (rejected, or built on a
   rejected picture), the tool stops the work until the pictures are put back (`redo`) or the user
   accepts the loss (`accept`).

Codex works on its own branch, `art/buildings-v2`, and touches only `assets/source/buildings-v2/`.

## 4. Tools (written in this sub-project)

- **`tools/building-guides.mjs`**: draws the 16 block-outs. Pure geometry shared with the tests.
- **`tools/building-queue.mjs`**: builds `queue.json` from the game's data files and
  `families.json`, so the list cannot drift from the game, and hands the work out (see above).
  Run again, it keeps every entry's `status`, `attempts` and `note`.
- **`tools/building-fit.mjs`**: the measurement described in section 1. `fitPicture` returns
  how a picture goes onto its footprint's canvas; `normalisePicture` draws it there, at the
  canvas's size or a fraction of it.
- **`tools/building-check.mjs <file | --family x | --all>`** fails only what a new attempt can
  put right:
  - a short side under 768 px; a background that is not transparent; a building that touches the
    picture's edge; surfaces that are mostly translucent; a translucent shadow or glow around it;
  - a picture that is still grey (the guide come back unchanged);
  - a view that is not the game's: the foot is one level line (seen from the front), or both
    ground lines slope outside 0.25 to 0.8;
  - a camera more than 2 degrees from the game's, in height or in turn (see section 1);
  - a depot's portals in the other wall than the guide has them in;
  - too few pixels: the foot narrower than the footprint's walls at 4 px per game px.
    It notes, without failing: a picture placed by its outline, a picture kept with its camera
    off, a building taller than its canvas. It prints one line per picture and writes
    `report.json` with every picture's result and measurement. Exit code 1 if any picture fails.
- **`tools/building-sheets.mjs`**: one review sheet per family (`review/<family>.png`: a row per
  age, a column per rotation, each picture laid onto its footprint diamond over grass, as the game
  will lay it) and `review/index.html` listing them with what was made, what failed and what the
  check noted.

Only `pngjs`, which the repository already uses for its other art tools.

## 5. What the game will do with the pictures (sub-project 4, stated here so the art fits)

- The atlas tool lays each picture onto its footprint with `normalisePicture`, from the same
  measurement the review sheets show, and packs it at the atlas's density. The hand-measured
  slopes and the widening that today's converter applies to the older pictures are not needed.
  Where a measurement is wrong, a per-picture override corrects it.
- Whether every building fills its footprint, or families are also scaled to a common door
  height as today's pictures are, is decided in sub-project 4 on renders from the game.
- A missing picture falls back to the same age in another rotation, then to the age before, then
  to today's picture. The game stays playable while Codex works.
- The structures atlas is split into several files, since one 4096 px sheet cannot hold 560
  pictures.

## 6. Proof

- Unit tests: guide geometry (2:1 slopes, the footprint centre at its pixel, the front on the
  right wall for each rotation); the fit (the guide's own block, a building drawn larger and off
  centre, a camera off 2:1, open doors in front of a wall, a round tower); the queue (560 entries,
  the counts per family of section 2, the order, statuses kept on a re-run, the gates, the stop,
  nothing built on a failed picture, the commands run as Codex runs them); the check (hand-made
  pictures that pass and that fail each rule; the guide's block painted in place passes on every
  footprint).
- The depot pilot's four real pictures pass the check and stand on their footprint in the sheet.
- The 16 guides and a sample review sheet rendered and shown on a review page before the package
  is handed to Codex.
- Typecheck, lint, tests, build and formatting pass before every push.
