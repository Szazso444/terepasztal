# Changelog

Terepasztal uses semantic versions from v0.6.0 on. Earlier work is mapped to versions after the
fact; the git history keeps its original commit messages (rewriting merged history would break
every clone), the pull requests were retitled to carry the version. Tags: `git tag -l`.

| Version | Pull request                                          | Commits                         | Summary                                                                                                                                                               |
| ------- | ----------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0  | [#1](https://github.com/Szazso444/terepasztal/pull/1) | `9d03aaf` … `dde51b7`           | Milestones 1–6: iso map and camera, track and stations, trains, contracts and economy, gacha and roster, polish (day/night, smoke, sound hooks, save/load, settings). |
| v0.2.0  | [#2](https://github.com/Szazso444/terepasztal/pull/2) | `6daf3fa`, `cb9a819`, `34f11e1` | Post-merge fix pass (synth audio, weather, seasons, lighting), adversarial review fixes, main and pause menus, game tuning, in-client content editor, level editor.   |
| v0.3.0  | [#3](https://github.com/Szazso444/terepasztal/pull/3) | `e28519e`                       | Resource economy and stockpile, fuel and water, real locomotives by era, wagon classes, works buildings, power grid, market, train details, new art.                  |
| v0.4.0  | [#4](https://github.com/Szazso444/terepasztal/pull/4) | `56d9a4c`                       | Chunk purchase, automatic routes, train side panel, building panel, floating indicators, toolbar with categories, power wires, cheat button, pause icon.              |
| v0.5.0  | [#5](https://github.com/Szazso444/terepasztal/pull/5) | `fe886e2` … `80b6905`           | Traffic handling, biomes and endless world, people and passengers, notices and advisor, dynamic routing (section below).                                              |
| v0.6.0  | [#6](https://github.com/Szazso444/terepasztal/pull/6) | `3d54b6d`                       | Depot as the only way into the stockpile, warehouses as local stores, Collect routing with fuel reserve, towns, train picking in the field view.                      |

## v0.6.0

### Depot and stockpile

- New two-by-two **Depot** station: four gates, two on each of two opposite sides (R rotates while placing), two trains at a time. Every game starts with one at the middle of the start chunk (gate track laid); older saves get one on load. Further depots are free but unlock one per nine owned chunks.
- Cargo enters the stockpile only when unloaded at a depot. Each depot raises the stockpile cap (`depotCap`, 3000; base cap raised to 1000). New trains roll out of the depot chosen in the Depot screen, from a gate that connects to their first stop; a train with no such gate is refused with a message.
- **Warehouses** are local stores: 1000 units per level of any goods in total. Trains unload into them and load out of them again for a depot or a buyer (never for another warehouse). The station panel shows the stored kinds; the overview draws a fill ring around each warehouse and a square for each depot.
- Chunk prices grow linearly: each ring adds (`chunkCostMul` − 1) × the first-ring price instead of multiplying.

### Routing and fuel

- Three routing modes per train (Depot screen and train details): **Schedule**, **Dynamic** (producer whose cargo the stockpile lacks most) and **Collect** (producer or warehouse with the biggest load waiting, weighed against the way there and on to the nearest depot). Loaded roaming trains go to a contract destination, else the nearest depot. A stop the tanks could not reach and leave again is never picked; a stop that turns out unreachable is remembered for a while and another is chosen.
- Fuel reserve: a leg starts only when the tanks cover it plus the run from its end to the nearest fuel point (a depot, or a station with both a coaling stage and a water tower in reach); otherwise the train diverts to the best fuel point it can still reach. Tanks fill completely at every refuelling stop; a warehouse refuels from its own store.
- Loading keeps the train while goods keep coming; waiting for full wagons only happens when the station's output can fill them within the dwell limit (now 120 s). Cargo taken on at a station is never handed back there.

### Towns

- A Town Station must stand 25 tiles from any other. Placing one asks for a name (generated, editable, rename later from the station or town panel). With a Townhouse (new, under Stations: homes for six) and a Warehouse within seven tiles the town is founded: every station inside is renamed "<town> <kind>" and follows renames.
- Overview: a tinted circle in the town's colour with its name and population (dashed until founded); a Towns panel on the left lists colour, people, what the town makes and uses per day, what it still needs, with Go and Rename.
- Residents count as population (they eat wheat) and walk about their houses.

### Interface

- Field view: hovering a train flashes it and shows a tooltip; clicking selects it (steady tint, path lit) and the card above the survey map shows its state, next stop, wagons, tanks and buttons for details and locate. Clicking empty ground or a station clears it.

### Save

- Save format v7: station orientation, train routing mode (old `dynamic` flag maps to Dynamic), towns.

## v0.5.0

### Trains

- No more phasing through each other: a head-on meeting makes the lighter train pull aside to the nearest track off the other train's path (a siding, a loop) and wait until a clear path exists; trains behind a slower one hold and retry rerouting every 20 s. A single track with no loop stays blocked and is reported.
- Departures prefer a path that avoids tiles other trains stand on, so a free loop is taken proactively.
- Pushing the consist backwards runs at 35–70 % speed depending on load.
- Economy mode: any tank under 30 % cuts speed and consumption to 60 % (yellow notice); empty tanks stop the train (red notice).
- Every stop tops tanks up halfway from carts; stations with a Coaling Stage, Water Tower, Water Pump or Warehouse fill them. Tank capacities doubled.

### World

- 9×9 chunk grid (288×288 tiles, `mapSize` rule) generated up front; only revealed chunks build ground and props; reveal spreads to all eight neighbours; chunk price grows per Chebyshev ring. Overview and survey map fit the revealed area; the survey map is twice as large.
- Biomes: Plains, Forest, Desert, Taiga, Swamp, Ocean from temperature and moisture noise with smoothed edges. Effects (`src/data/biomes.json`): plains farms +25 %; forest lumber +30 %, track ×1.2; desert quarries +30 %, pumps −50 %, farms −50 %, steam water use ×1.5; taiga lumber +15 %, pumps +10 %, farms −30 %, speed ×0.9, track ×1.1; swamp pumps +40 %, farms −20 %, track ×2, speed ×0.8; ocean pumps +30 %. The starting chunk is always temperate (plains/forest) and still carries water, forest, hill and grass.
- Rivers flow downhill from high ground to water, widening downstream; deserts dry them out. Seas carry islands. Stone fields are drawn into the rock tiles instead of scattered rock props.
- Vegetation per biome: oak, birch, tree, pine, spruce, palm, cactus, dead tree, bushes, four kinds of flowers, reeds, boulders.
- The season on day 1 matches the player's calendar (northern hemisphere, spring fallback); games start at noon.

### People

- Every crew member not on a train belongs to a station, works or service. They stay inside most of the day, step out to idle by the door, occasionally walk to a nearby resource tile to gather, or go to the closest station to wait for a coach; nobody is outside at night. Walkers never change the map.
- Passengers: towns produce them; they board coaches, alight only at another town and pay a fare that grows with distance. Boarding and alighting spawn walkers between station and platform. Wooden Coach is a fourth starter wagon; Steel Coach and Pullman are in the banners.

### Interface

- Notices panel above the contracts list: out of fuel, no power, overweight, no route, economy mode, held by traffic, station without platform, unwired power plant, starved or blocked works, failed contracts. Markers float over the object in the field view and dot the overview.
- Advisor (top right, badge, silence toggle): plain instructions for blockers and suggestions (no stations, idle locomotives, low wheat, missing water source, coal short, affordable chunk, offers waiting, full stockpile).
- Trains-in-view panel: speed (current/top), capacity, tanks and fuel per tile with icons, coal/wood switch, one row per wagon with cargo icon, and a single per-week block.
- Top bar: screen buttons next to Menu; funds, tickets and reputation moved to the right end of the resource row; weather and day/night toggles. Resource cells show a card on hover: what it is, where it comes from, what it is for, stockpile/cap, produced and consumed per day. "Crew" is now "Population".
- Toolbar groups: Track, Stations, Works, Services (Water Tower, Coaling Stage), Utility (Signal, Power Line). Tab (Shift+Tab) steps through the open group, the wheel always zooms, M toggles the overview, K opens the Market. Info card lists where an item can go; placing a service or pole highlights its reach.
- Overview draws trains as their locomotive sprite.
- Descriptions rewritten without numbers; recipes and rates come from the data.
- Contracts appear much more slowly (3 offers, refresh every 1.5 days).
- Icons: water and oil droplets, iron bar with Fe, passengers, population. Station families and works redrawn to fit their tile with distinct silhouettes.

### Save

- Format v6: owned chunks, season offset, biome per tile (levels too). Saves from the 3×3-chunk era are placed in the middle of the larger grid on load (coordinates shifted, trains returned to the depot).

### Pre-merge fixes (same release)

- Path wear, dirt paths, stone roads and crossings (from an earlier build of this branch) removed. Boarding removes waiting travellers, alighting adds a few who settle nearby.
- No boulder props on grass (they stay on hills); track is shaded with the night so it no longer glows against dark forest.
- Fuel first: at every stop a train fills up when the next leg would be out of reach on a half tank; if the planned leg still exceeds the range it diverts to the nearest reachable station (supplied ones preferred), refuels, then continues. A train short of fuel never waits for full wagons.
- Default stops: unload only at a warehouse or where the cargo is wanted, wait for full wagons while the station can still fill them.
- Floating indicators show one net number per resource per stop.
- Harvesting stations scale with nearby terrain: forest for lumber yards, grass for farms, rock/hill for quarries, water for pumps, weighted by distance within four tiles. The build status shows the weekly yield before placing; the station panel shows the multiplier.
- Placement ghost shows the actual station family sprite; hovering a bare tile lists terrain, biome, track, poles, vegetation, power and track-cost effects.
- Overview text uses the interface fonts; the cheat button also adds 10 tickets.
- The world grows: a new game starts on a 5×5 chunk grid; buying a chunk that touches the edge adds a ring of chunks around the whole map (the game saves, regrows and reloads). Terrain and rivers are generated in world coordinates, so everything already charted stays exactly as it was.
- Large stone fields rise into mountains in the middle (two tiles deep): raised twice as high as a hill, snow on the crown; nothing can be built on them and no one walks over them.
- Track laid through forest or grass pushes the trees and bushes to the sides of the rails on that tile (curves, switches and crossings clear it).
- Buildings stand on the ground: the raised full-tile platforms are gone, replaced by soft shadows and small local patches (field rows, a pond, a concrete pad only under a shed).
- Every service and utility (water tower, coaling stage, signal, power line) has a hover tooltip and a click panel: reach, stations served, live or dead network, demolish. Bare tiles list terrain, biome, track, vegetation and power.
- Dynamic routing (depot: "Dynamic"; train details toggle): the train picks its next stop on the fly, favouring the producing station whose cargo the stockpile lacks most, then the nearest warehouse (or a contract destination); it avoids stations other dynamic trains are bound for, and reads other trains' reserved paths eight tiles ahead to detour around oncoming traffic before stopping.
- Jams: the fleet follows who blocks whom through any number of trains; when the chain loops or ends in a stuck train, the train that has pulled aside least (then the lightest) makes room. A train already holding on a siding still reports what blocks it, so a ring of holding trains resolves instead of waiting forever; a hold is only taken where the whole consist clears the other train's line, and a short dead-end siding is used as far as it goes. Trains queued behind one that is loading simply wait.
- Dynamic trains load at any station whose cargo some other station takes, keep loading when the same station stays the best pick, and idle without holding a platform when nothing is worth hauling.
- A new train starts on a free platform tile (the next stop's if the first is taken) and is refused when every platform on its route is occupied, so trains never spawn on top of each other.
- Route recording in the overview: click a train to select it (its path is traced), press R, click stations in order, press R or Enter to apply; Esc cancels.
