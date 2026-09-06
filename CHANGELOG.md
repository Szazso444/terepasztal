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
| v0.5.0  | (this branch)                                         | see below                       | Everything in the section below.                                                                                                                                      |

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

- Every crew member not on a train is a walker who moves between stations, works and services. Footsteps wear the ground: worn tiles become dirt paths, busy paths become stone roads (kept in the save). Straight track over a path or road shows a plank or slab crossing. Roads have no gameplay effect and track can be laid over them.
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

- Format v6: owned chunks, season offset, path wear, biome per tile (levels too).
