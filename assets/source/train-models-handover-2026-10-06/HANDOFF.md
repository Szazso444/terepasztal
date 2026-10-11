# Train models: where the work stands (hand-over, 2026-10-06)

Terepasztal is an isometric train game (Vite, TypeScript, PixiJS v8; 2:1 projection, tile 64 px wide,
one tile = 6.235 m). Its 37 locomotives are 3D models reconstructed from one picture each, rendered to
sprites by a Blender pipeline, and drawn in the game as a body sprite with separate trucks and layers
of turning wheels. This file says where everything is, what each step does to a model, what the owner
(Zsolt) has accepted and rejected so far, and what went wrong on the way. The owner's current list of
changes is in the prompt you were given, not here.

## Where things are

| What | Where |
|---|---|
| Game with the models (the demo build) | `C:\Users\Zso\terepasztal-playtest`, branch `demo/lifelike-models`, local only, last commit `d20cd0c` |
| Its dev server | `npm --prefix C:/Users/Zso/terepasztal-playtest run dev -- --port 5182 --strictPort --host 127.0.0.1` |
| Asset pipeline | `C:\Users\Zso\terepasztal-local\tools\asset-pipeline` (branch `local/train-models`; **all of the work is uncommitted there**, with `*.pre-*.py` backups beside the files) |
| Raw models and source pictures | `G:\DEV\Terepasztal\pipeline-out\models_raw\<id>.glb`, `<id>.source.png`, `<id>.mask.png` |
| Pipeline inputs | `G:\DEV\Terepasztal\train-sizes\`: `fit-standard.json` (made by `make-fit-standard.mjs` from `fit.json`), `gear-picture.json` (running gear as measured on each picture; shares of the length between the buffer beams), `wheels.json` (made by `make-wheels.mjs` from `wheels-research.json`), `annot\` (windows, smoke, lamps) |
| Renders | `G:\DEV\Terepasztal\pipeline-out-std` (all 37, the state the game shows); `pipeline-out-r4t` (scratch root for quick looks); `pipeline-out-g20`, `pipeline-out-g0` (gauge previews, no longer needed: the gauge stays) |
| Measuring and looking tools | `G:\DEV\Terepasztal\train-sizes\distortion\` (`layers.py`, `parts_view.py`, `sideview.py`, `isoview.py`, `dump-std.sh`, `square_test.py`, `sq_sheet.py`); every change made to the pipeline is there as a `patch_*.py` |
| Review page | `G:\DEV\Terepasztal\renders\engine-models\` (`index.html` opens locally; built by `_build\build-round4.mjs` from `_build\imgs-round4.py` and `_build\clips4.sh`) |
| The owner's sheet | `G:\DEV\Terepasztal\locomotive-wheels-bogies-v7.xlsx`, sheet "Locomotives": `#` is the ID the owner uses, `Status`, `Game id`, `Pipeline status`, `Pipeline notes`, "Owner's model review"; pictures are embedded |
| Python for the tools | `G:\DEV\Terepasztal\train-sizes\.venv\Scripts\python.exe` (`ensure-py.sh` makes it again); Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` |

Sheet ID to game id: 1 rocket, 2 bm50, 3 muki, 4 c50, 5 mav490, 6 mk45, 7 mk48, 8 rezet, 9 adler,
10 john_bull, 11 mav375, 12 j94, 13 class08, 14 general, 15 jupiter, 16 kando_v40, 17 sw1,
18 black_five, 19 crocodile, 20 deltic, 21 drg01, 22 f7, 23 flying_scotsman, 24 ice1, 25 k4s, 26 m62,
27 mallard, 28 re460, 29 taurus, 30 tgv, 31 v63, 32 daylight, 33 dda40x, 34 gg1, 35 mav424, 36 nine_f,
37 sd40, 38 big_boy, 39 koutetsujou (not in the game's data; only in scratch scenes).
An engine is taken out of the game with `"retired": true` in `src/data/locomotives.json` (as adler and
john_bull are; `src/gacha/retired.test.ts` and `src/sim/retiredSave.test.ts` cover it).

## Do not touch

- `C:\Users\Zso\terepasztal` (the main checkout). Another Codex chat paints building pictures there on
  `art/buildings-v2`. Do not write there, do not switch its branch, do not run tools that write there.
- Nothing is pushed, merged or opened as a pull request unless the owner says so.
- No image generation without asking first: the other chat lives on the image allowance, and the
  train work has needed none so far.
- In `terepasztal-local`, do not `git checkout`, `reset` or `stash` before the uncommitted work is
  committed: it exists nowhere else.

## What the pipeline does to a model today

`run.py` (stages `blender`, `post`) calls `blender_stage.py` in Blender, then `postprocess.py`. In
order, for one engine; "shape" marks every step that changes the model's shape instead of only turning
or scaling it as a whole:

1. The source picture's camera is fitted to the raw mesh and its colours are projected onto it
   (`source_texture.py`).
2. **Shape:** the camera's perspective is taken out of the mesh, `deperspective` in the fit table
   (0.65 for most, an own value for double-cab engines; 0 turns it off).
3. Rigid: the mesh is stood upright and along the track (`manhattan_align`, `refine_axes`).
4. Rigid: it is turned until the wheels found in it stand level (`wheel_find.py`, `level_on_wheels`),
   and for steam engines also turned about the vertical by the row of found wheels.
5. **Shape**, diesel and electric engines only (`box_body` in the fit table, `body_square.py`): turned
   so the body's walls, sole and roof run along the track, then widths and heights scaled along the
   length so the walls are parallel and the roof level, and the running gear slid up or down onto the
   rail (`gear_shear`).
6. One scale for all three axes, from the roof height.
7. **Shape:** the side the source picture did not show is thrown away and rebuilt as the mirror of
   the seen side (`running_gear.symmetrize`).
8. **Shape:** the running gear is pushed out to the game's rails (`gauge_warp`): the game's rails
   stand 39 % wider apart than the real gauge at this scale, and the owner has decided that stays.
9. The vehicle is cut into its parts (engine, tender, the halves of the DDA40X) where the gear table's
   parts end; a cut end gets a wall painted with the body's colours (`clip_mesh`, `cut_rows`,
   `wall_image`).
10. Each truck is cut out of the body as a piece of its own; the model's own wheels are cut away and
    round wheels are built where they were found, with rods on coupled wheels
    (`running_gear.py`). Their diameters come from `wheels.json` (the real engine's) times one
    factor per part so that neighbours do not touch (`wheel_factor`): the pictures are shorter than
    the real engines, so the built wheels come out smaller than the picture's (the Big Boy's at 0.53).
11. Every piece is rendered from the game's camera at 25 headings (the game mirrors them to 48,
    7.5 degrees apart; `FACINGS` in `game_rules.py` and in the game's `src/sim/body.ts`), wheel layers
    once per phase of their turning.

Into the game: `node train-sizes/apply-standard.mjs --write` (the game's `src/data/gear.json` from the
render metas), prettier on that file, `node pipeline-out-fit/build-game.mjs` (atlas pages
`public/assets/rolling*.png` and `src/data/locoFit.json`), `node train-sizes/access-final.mjs` (every
engine may still run on its track class).

In the game (`src/sim/body.ts`, `src/sim/gear.ts`, `src/render/trainRenderer.ts`,
`src/render/swingSprite.ts`): a body is posed as the best line through its wheel groups (`pinned`), a
hinged half hangs on its neighbour's end (`hinge`), trucks stand on the rail on their own. Between two
of the 48 rendered headings the nearest picture is bent to the exact heading by a small mesh
(`swingMesh`). Before that it was turned by half the difference, then sheared.

## Commands

- Quick look at a pipeline change (about two minutes):
  `cd G:/DEV/Terepasztal/pipeline-out-r4t && TP_FACINGS=0,6,18,30 TP_PHASES=1 ./render-std.sh <id>`,
  then `python distortion/layers.py out.png <root> <id> <facing>` (all layers, bodies, gear),
  `parts_view.py` (single sprites), `sideview.py` (facing 18 is the pure side view, with level guides).
- Full render: `cd G:/DEV/Terepasztal/pipeline-out-std && ./batch.sh <id> [<id> ...]`, 10 to 15
  minutes per large engine; more than five at once is no faster.
- The model as the pipeline stands it, as points for measuring: `distortion/dump-std.sh <id>`.
- Game checks before a commit: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (needs `python`
  on PATH for one test file), `npm run build`, `npx prettier --check --end-of-line auto src`.
- Captures from the running game: `node scratchpad/models/capture.mjs all` (line-ups by sheet ID and
  every engine on a curve, into `scratchpad/models/out`), `node scratchpad/models/film.mjs`
  (frames of an engine rolling; `_build/clips4.sh` turns them into clips).
- A save to try: `G:\DEV\Terepasztal\saves\engine-models-demo.json`, loaded by
  `http://localhost:5182/scratchpad/models/load-save.html`.

## What the owner has asked for, and what was rejected

The owner judges by looking at in-game pictures and clips at 3x, not by numbers. Every visual change
goes to him as in-game renders (and a save) before anything is locked in. He writes in Hungarian.

- Models must not be distorted and must look alike in proportion: stretching a model along one axis
  to fit a length was rejected; one scale per model, the game's length follows the model.
- Wheels turn; trucks follow the rail; a truck must not visibly part from its body; no wheel may be
  there twice (the model's own and a built one).
- Flat dark faces where a vehicle is cut were rejected ("a hole"); the painted walls that replaced
  them are, in his words, "not quite it yet".
- Turning must be smooth and must not pulse. Rejected in turn: turning the sprite by half the
  difference (steps), shearing it (the width breathes), and he still sees pulsing with the mesh.
- Nothing of a body may look split off (a nose whose lower part turns with the truck, a leading
  wheel showing beside a narrow front).
- The DDA40X is hinged in the middle (his choice, after seeing it rigid). The Big Boy went through a
  hinge ahead of the cab, a rigid engine with one swivelling unit, and two swivelling units; see his
  current note on it.
- The gauge stays as it is (he looked at 39 %, 20 % and true gauge on 2026-10-06).
- Where a picture and the real engine differ, the picture wins: this is a model railway.

## What bit

- The gear table's shares are measured between the buffer beams; a model's length includes buffers.
  Mapping one onto the other put wheels in the wrong place: the wheels are found in the model.
- A reconstruction's wheels do not run parallel to its body, and its far side is guesswork.
- `bmesh.ops.mirror` leaves the mirrored half inside out; a reconstructed mesh's normals must never
  be recalculated (the painted look shades by them).
- A wall over a cut's convex outline is wrong where the cross-section is not convex, or where the
  body has ended before the cut.
- A rigid body cannot follow the regular curve (radius 1.5 tiles): a 3-tile body's ends or middle
  are off by tenths of a tile whatever the pose. The track's geometry belongs to another piece of
  work.
- The dev server dies when `build-game.mjs` replaces an atlas it is watching: start it again.
- On this machine shell heredocs break on apostrophes and backticks: write scripts to files.
