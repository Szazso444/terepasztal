# terepasztal

Isometric train logistics with a crafted roster. Vite + TypeScript + PixiJS v8, no other runtime
dependencies. Retro 2:1 isometric look with procedurally generated placeholder art.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
npm test         # vitest, once
npm run lint
```

Every pull request runs typecheck, lint, tests, build and a formatting check
(`.github/workflows/ci.yml`).

## Versions

See `CHANGELOG.md` for what each version and pull request added; releases are tagged `vX.Y.Z`.

## Menus, tuning and editing

- **Main menu** on boot: continue, new game (seed and production chain: Simple or Full), game
  tuning, content editor, settings, and the level list (play, edit, delete, create blank or
  generated, import JSON). Esc or the Menu button opens the pause menu in play.
- **Game tuning**: live sliders for economy, contracts, trains, time, weather and map generation;
  stored with the save.
- **Content editor**: edit or add locomotives, wagons, cargo, stations, contracts, decor, gacha
  banners and track data inside the client; applies on reload, export/import as JSON.
- **Level editor**: paint terrain, build anything for free, set the player's start, save and
  play-test levels; export/import as JSON.

## Gameplay loop

- **Resources** replace money for building: water, wheat, stone, wood, and later coal, oil, iron.
  Trains collect at producing stations and only cargo unloaded at a **Depot** reaches the
  stockpile (top bar, second row); Warehouses hold goods locally (1000 per level) for trains to
  move on later. Crews eat wheat every day; run out and production halves, trains slow.
- **Depot**: a two-by-two engine shed with four gates. Every game starts with one; another unlocks
  per nine owned chunks. New trains roll out of the depot you pick, and each depot raises the
  stockpile cap.
- **Towns**: a Town Station (25 tiles from any other) with a Townhouse and a Warehouse within seven
  tiles founds a town; name it when placing (rename any time). Stations inside carry the town's
  name, the overview colours its reach and the left-hand panel lists population, output and use.
- **Ages**: every game starts in the **Steam Age**. The **Diesel Age** begins once you own three
  depots and the population reaches 1000; the **Electric Age** once $250,000 has been earned in
  total (goals in `src/data/ages.json`, checked every in-game hour). Each age unlocks its works,
  stations, station levels, contract templates and gacha banners; the top bar shows the current
  age and hovering it lists the goals with progress bars.
- **Works**: Charcoal Kiln (wood → coal), Stone Grinder (stone → iron), Oil Refinery
  (coal + water → oil), Power Plant (coal or oil + wood + water → power). The Market (`M`) buys
  and sells any resource for money; fuel prices (oil, diesel, crude) wander up to ±40 % on a slow
  daily walk.
- **Production chain** (picked when a new game starts, stored in the save): **Simple** is the
  above. **Full** adds a second data set (`src/data/*_full.json`, entries marked
  `supply: "full"`): Colliery on coal seams (marked on hills), Iron Mine and Ironworks (iron ore +
  coal → iron), Oil Derrick on oil seeps → Refinery (crude → diesel), Sand Pit (every train
  spreads a little sand for grip), Copper Mine → Wire Mill (wire for electrification). Diesel
  engines burn diesel instead of oil, and warehouses only refuel trains from what other trains
  brought them.
- **Fuel**: steam burns coal (or wood) and water, diesel burns oil, electrics need power and a
  live Power Line network (poles within two tiles of each other and a Power Plant). Tanks fill at
  Depots, at stations near a Coaling Stage or Water Tower, and from a town Warehouse's own store
  (topped up from the stockpile in the Simple production chain); a train never starts a leg it
  could not finish and still reach fuel from.
- **Trains**: Static **Schedule** follows your stop list (load, unload, wait full, dwell times,
  refuel, direction). Dynamic **Production** sweeps producers into warehouses, **Collection**
  empties warehouses into depots, **Transport** carries passengers between towns; all three
  re-plan at every stop and refuel on their own.
- **Traffic**: single track is handed out in whole sections, so trains never meet head-on inside
  one; waiting trains pull into sidings and loops, idle trains make room. Stuck trains raise a
  notice; the debug panel and `game.traffic.report()` give the statistics.
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
- **Track classes**: Regular and High-speed. High-speed curves and switches are 2×2 with a
  1.5-tile radius (nearly full speed through the turn), joined to regular track through a
  transition piece; three crossings cross the classes at grade. Everything derives from the class
  number `n` (footprint, radius, cost).
- **Rolling stock in three sizes**: one, two and three tiles. Bodies are rigid and never change
  length; bogies sit at fixed distances along the rails and the body centres itself on the track
  (`src/sim/body.ts`). Large stock (Garratt, Meyer, Bo-Bo-Bo) runs on high-speed track only; a
  compatibility table built at boot from reference curves decides the rest, and the depot says
  which gate a consist can leave by and why not.
- **Crafting**: unlock a recipe with money (three cards, keep one), craft copies with iron, wood,
  stone and coal; failure chance grows with quality. Unlimited copies; spares level a model.
- **Electrification**: third rail, catenary and HV catenary over track, live within reach of a
  substation on a powered pole grid; substations have a throughput the trains under them share.
- **Towns grow**: townhouses build in stages, hold 10 / 25 / 50 residents by level, fill slowly
  while fed and spawn near track and other houses as traffic grows.
- **Semaphores**: home and distant arms on a post, animated between danger, caution and clear.
- **Roster**: over thirty real locomotives from the Rocket to the TGV, wagons in four classes plus
  service carts (coal, fuel, battery) that stretch a matching engine's range.

## Controls

| Action   | Keys                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Pan      | WASD / arrows / middle-drag / edge scroll                                                                       |
| Zoom     | mouse wheel (0.5x-2x); zoom out past 0.5x opens the overview                                                    |
| Overview | Tab (Esc, scroll in or click a station/train to return)                                                         |
| Build    | toolbar buttons, `R` rotate (track and signals), drag to lay straights, right-click / Delete remove, Esc cancel |
| Time     | Space pause, `1` `2` `3` speed                                                                                  |
| Screens  | `F` depot, `C` contracts, `G` craft, `V` roster, `M` market, `` ` `` debug                                      |

## Layout

- `src/engine` loop, camera, input, iso math, atlas pipeline, audio hooks, RNG
- `src/world` map generation, tiles, regions, track graph, pathfinding
- `src/sim` clock, economy, stockpile, stations, buildings, power grid, trains, fleet, traffic control, towns, contracts, build rules, save format (versioned, migration registry, unknown fields preserved)
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

Each atlas group (`terrain`, `props`, `track`, `structures`, `rolling`, `wagons`, `fx`, `icons`,
`people`) is loaded from `public/assets/<group>.png` + `public/assets/<group>.json` when present
and generated procedurally otherwise. The JSON is
`{ "frames": { "<name>": { "x", "y", "w", "h", "ax", "ay" } } }` where `ax`/`ay` is the anchor in
pixels from the frame's top-left. Frame names are listed by the generators in `src/art`.

Drop `public/assets/audio/<event>.ogg` (event names in `src/engine/audio.ts`) to replace a
synthesized sound.

## Modelling tools

`.mcp.json` wires Claude Code up to MCP for Blender, MCP for Unity and Chrome DevTools MCP;
`docs/mcp-setup.md` covers the same for Codex, the Blender addon and the Unity package, and the
camera, facing and anchor rules that make a Blender render drop straight into `public/assets`.

`npm run pack-atlas -- <group>` packs a folder of rendered frames (`art-src/<group>/*.png`, with
one `atlas.json` carrying the group's anchor) into `public/assets/<group>.png` + `.json`. It trims
each frame, corrects the anchor for the trim, and is deterministic, so re-packing unchanged art
changes nothing.

In a dev build the PixiJS browser extension can inspect the scene graph; the hook-up is stripped
from production bundles.

`docs/live-loop.md` describes the tight loop: Claude Code running locally with voice dictation
against the dev server, where an edit reloads the page and the running game carries over instead
of starting again.

See `MILESTONES.md` for progress notes and the post-merge fix pass.
