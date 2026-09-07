# terepasztal

Isometric train logistics with a gacha roster. Vite + TypeScript + PixiJS v8, no other runtime
dependencies. Retro 2:1 isometric look with procedurally generated placeholder art.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
npm run lint
```

## Versions

See `CHANGELOG.md` for what each version and pull request added; releases are tagged `vX.Y.Z`.

## Menus, tuning and editing

- **Main menu** on boot: continue, new game (seed), game tuning, content editor, settings, and
  the level list (play, edit, delete, create blank or generated, import JSON). Esc or the Menu
  button opens the pause menu in play.
- **Game tuning**: live sliders for economy, contracts, trains, time, weather and map generation;
  stored with the save.
- **Content editor**: edit or add locomotives, wagons, cargo, stations, contracts, decor, gacha
  banners and track data inside the client; applies on reload, export/import as JSON.
- **Level editor**: paint terrain, build anything for free, set the player's start, save and
  play-test levels; export/import as JSON.

## Gameplay loop

- **Resources** replace money for building: water, wheat, stone, wood, and later coal, oil, iron.
  Trains collect at producing stations and only deliveries to a Warehouse reach the stockpile
  (top bar, second row). Crews eat wheat every day; run out and production halves, trains slow.
- **Works**: Charcoal Kiln (wood → coal), Stone Grinder (stone → iron), Oil Refinery
  (coal + water → oil), Power Plant (coal or oil + wood + water → power). The Market (`M`) buys
  and sells any resource for money.
- **Fuel**: steam burns coal (or wood) and water, diesel burns oil, electrics need power and a
  live Power Line network (poles within two tiles of each other and a Power Plant). Tanks refill at
  Warehouses, Coaling Stages, Water Towers and Water Pumps.
- **Trains** run automatically: dispatch a consist and it visits every station with a platform.
  Stops, load/unload, wait for full, refuel and departure direction are edited in the train
  details. The right-hand panel lists the trains on screen (all of them in the overview) with
  tanks, use per tile, fuel type and weekly estimates; hover one to trace its path.
- **Chunks**: the map is bought chunk by chunk from the overview (M). Owning a chunk reveals all
  eight neighbours; prices grow with distance from the start. Buying at the edge grows the world
  by a ring of chunks, without end.
- **Biomes**: plains, forest, desert, taiga, swamp and ocean change production, track cost, water
  use and speed (see `src/data/biomes.json`); rivers and islands are generated.
- **People**: the population idles around its buildings by day, gathers nearby and waits at
  stations for coaches; towns produce passengers who pay a fare when they reach another town.
- **Notices and Advisor**: blockers show up in the notices panel and as markers on both maps; the
  Advisor (top right) explains what to do and can be silenced.
- **Roster**: 26 real locomotives across three gacha banners by era, with wagons in three classes
  (tankers, hoppers, flats).

## Controls

| Action   | Keys                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Pan      | WASD / arrows / middle-drag / edge scroll                                                                       |
| Zoom     | mouse wheel (0.5x-2x); zoom out past 0.5x opens the overview                                                    |
| Overview | Tab (Esc, scroll in or click a station/train to return)                                                         |
| Build    | toolbar buttons, `R` rotate (track and signals), drag to lay straights, right-click / Delete remove, Esc cancel |
| Time     | Space pause, `1` `2` `3` speed                                                                                  |
| Screens  | `F` depot, `C` contracts, `G` gacha, `V` roster, `M` market, `` ` `` debug                                      |

## Layout

- `src/engine` loop, camera, input, iso math, atlas pipeline, audio hooks, RNG
- `src/world` map generation, tiles, regions, track graph, pathfinding
- `src/sim` clock, economy, stockpile, stations, buildings, power grid, trains, fleet, contracts, build rules, save format
- `src/gacha` items, inventory, gacha
- `src/render` world, overview, trains, fx
- `src/ui` DOM overlay screens and panels
- `src/art` procedural placeholder generators (one file per atlas group)
- `src/data` all content as JSON

## Assets

Everything is generated at runtime: sprites by the procedural generators in `src/art`, sound
effects and the ambient loop by the Web Audio synthesizer in `src/engine/synth.ts`. Nothing is
taken from other games. Sprites and individual sound effects can be overridden file by file
(see below); the ambient loop is always synthesized.

## Replacing placeholder art

Each atlas group (`terrain`, `props`, `track`, `structures`, `rolling`, `fx`, `icons`, `people`) is loaded from
`public/assets/<group>.png` + `public/assets/<group>.json` when present and generated procedurally
otherwise. The JSON is `{ "frames": { "<name>": { "x", "y", "w", "h", "ax", "ay" } } }` where
`ax`/`ay` is the anchor in pixels from the frame's top-left. Frame names are listed by the
generators in `src/art`.

Drop `public/assets/audio/<event>.ogg` (event names in `src/engine/audio.ts`) to replace a
synthesized sound.

See `MILESTONES.md` for progress notes and the post-merge fix pass.
