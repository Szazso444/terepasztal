# Draft issues, 2026-10-17 evening (Core planning, nothing filed)

Read on `origin/develop` e56682a (extracted with `git archive`; the checked-out tree is old). Inputs:
feedback-1017/FEEDBACK.md and feedback-1017b/FEEDBACK.md, the night-log tail, bridges-plan/PLAN.md, demo v9.1
sources (`codex-demo-work/src.v91-final/app.js`, line numbers below), demo-v9/scale-table.md, the two Codex reviews,
the v8 prompts page, demo-v91/fix2/legDefects.json, demo-v91/result.json.

Handles (F1, W3, ...) become issue numbers when Core files them. Labels are `agent:<role>` + `type:task`; a task
that touches `src/game.ts` also gets `scope:cross` and says which line (the cross-role line Core grants).

**Not published yet.** Demo v9.2 (smoke, scale options, road bridges, storm and fog) is still being built
(wf_e43194f9-e5d). Issues W9, B1 to B6 and X1 to X3 are written from the author's words and PLAN.md; their numbers
are filled in from the published v9.2 source before filing (each says so).

## Questions for the author first

Nothing below is filed until these are answered. Core's recommendation is marked.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | "Take 2 tiles": which shape? | (a) two tiles in a row, 2 x 1 (1 x 2 when turned); (b) 2 x 2 like the depot | **(a).** The scale table says "a 2 x 1 footprint" for the town hall and the goods shed, the picture's wall base is 1.4 x 0.7 tiles at 1.5x, and a 2 x 2 is bigger than any picture needs. |
| Q2 | Saves that already hold a town hall, goods shed or farm halt on one tile: the new shape needs a second tile. | (a) the load grows each into a free neighbour tile (east, else south, turning it if needed) and changes nothing else; a building with no free neighbour stays on one tile and is drawn as today; (b) as (a) but a blocked one takes the blocking house, road or decor off with a refund; (c) old saves are not supported for these three | **(a).** AGENTS.md requires a migration step for a changed save meaning; (b) destroys the player's town; (c) breaks the rule. |
| Q3 | The audit finds more buildings whose picture is wider than a tile (table in F6). Change them in the same round? | (a) now; (b) after your playtest of the three; (c) never | **(b).** You wrote "for now let it be so". F6 is drafted and held. |
| Q4 | Wind in the game: a setting you choose (as in the demo: level and direction) or a weather the game changes by itself? | (a) setting only (Calm, Breeze, Windy, Storm; 8 directions), default Breeze from the west, like the demo; (b) the game's own weather (rain, fog) drives the level and the direction drifts; (c) both: a setting with an Auto choice | **(a) now, (c) later** as its own issue once you have played with (a). The game's rain and fog (src/sim/weather.ts:49) stay as they are meanwhile. |
| Q5 | The windmill turns only in its first view (rotation 0) until Codex paints the other three; turned windmills keep today's drawn-in sails and do not turn. | (a) yes; (b) Codex paints all four views now (4 times the pictures) | **(a).** The 2:1 shaft direction differs per rotation, so each view needs its own body; one view proves the method first (the review of 10-16 made the same cut, C1). |
| Q6 | The four extra passengers (variants 1 to 4) are in the demo's 14 back strips and 4 limping front strips. Ship them? | (a) repaint and ship; (b) repaint the back strips (they are already in the 14) and leave the 4 front strips for later; (c) drop them | **(b).** Core's earlier decision (10-11) kept them out of the first ship; their backs are in the list, their fronts are four more strips of the 12 limping ones. |

Not a question, a note: the demo's "True to people" factors (water tower 1.75, quarry 0.8, farm, windmill and
pump 0.9, Fuel Pump 0.8) are **not** ported. You wrote that True to people is still not right; v9.2 offers four
settings and you pick. F3 uses only the two sizes the people measurement asked for the town hall and goods shed,
as multipliers on today's scale, and says so.

---

# 1. Buildings take the footprint their picture needs

## What the code does today (read, not guessed)

- A footprint is the station def's span at rotation 0, swapped on an odd rotation: `placeSpan` (src/sim/doors.ts:59-64):
  `long` is 2 x 1, otherwise `size` squared (depot: `size: 2`, src/data/stations.json), a works or decor one tile.
  `stationSpan`/`stationFootprint` (src/sim/stations.ts:32-46) and `Station.footprint()/w/h` (stations.ts:370-394)
  derive everything from the def, `(x, y)` (the corner, lowest x and y) and `rot`. **The save holds no footprint**:
  `StationJSON` is `{id, defId, name, x, y, level, storage, rot, work}` (stations.ts:82-98).
- `long` is welded to the shed rule: `gatesOf` (stations.ts:56) gives any `long` def gates at the two ends only, and
  `platforms` returns 1 for a depot (stations.ts:410). A town hall with `long: true` would lose its gates on the
  sides. So `long` cannot be reused as it stands. Today's only `long` def is `narrow_depot`.
- Placing: `checkStation` (src/sim/build.ts:~799-840) checks every footprint tile, but `hasAdjacentTrack(x, y)`
  (build.ts:281, called at ~831) looks only at the corner tile, so a 2-tile station served only at its far tile is refused.
- A town measures its reach from the hall's corner: `townAt` (src/sim/towns.ts:108-120), `members` (towns.ts:134),
  `TOWN_RADIUS = 7` (towns.ts:9). Stations elsewhere use `s.x, s.y` (src/sim/people.ts:493-498, 741) or the centre
  `cx/cy` (src/sim/fleet.ts:683-726), which a 2-tile station already gets right.
- Drawing: `Game.onStationChanged` (src/game.ts:1678-1735) has three branches: `def.long` (frame `structures/<art>_r<rot%2>`
  between its two tiles, depot art only), `size === 2` (depot), else `structures/<art>_<level>` anchored on the corner
  tile. The picture's anchor is "the footprint's centre on the ground" (src/art/buildingGround.ts header).
- Ground data: `src/art/buildingGround.json` holds, per frame, `footprint`, the `foot` parallelogram (world px, unscaled)
  and the doors; `tools/building-ground.mjs:780-801` fills `footprint` from `placeSpan`, so it follows the defs after a
  regeneration. The renderer scales it by `scaleReference` (src/render/assetScale.ts:102-112) and builds the yard,
  plinth and ground fit from `footprintTiles(f.ground, ...)` (src/render/worldRenderer.ts:~2006).
- Size: a building is drawn so its door is `DOOR_PX = 13.2` px (assetScale.ts:9), the 2.1 m door beside the
  **11 px** person it was calibrated against; the walker is now `PERSON_PX = 9` (assetScale.ts:2). Per family:
  `DOOR_FRACTION` (town 43/199, warehouse 53/191, farm 47/262, ...), `DOOR_REFERENCE_PX`, `EQUIPMENT_SCALE`.
- Load repair stands every station footprint tile on `land` (src/engine/loadRepair.ts:92). Levels (`LevelStation`,
  src/world/level.ts:7) carry `defId, x, y, rot`; no level ships in the repository (user levels live in localStorage).
- Save version is 20 (src/sim/save.ts:34), the last step is `from: 19` (save.ts:584). Mapgen does not place stations.

## Audit: every building against its picture

Method (reproducible): for each `structures/*` frame, the drawn wall base ("foot", from
`src/art/buildingGround.json`) times the scale `structureScale` gives, in tiles along x and y (one tile edge =
35.8 world px). Max over all levels of the family. A footprint of one tile holds 1.00; the wall base should be
about 0.9 or less to leave the yard. "People" is the demo's scale-table.md measurement against a 9 px, 1.75 m person
(1 px = 0.194 m); the door and eave columns are the picture as drawn **today**, before any True-to-people factor.

| Building (def, art family) | Footprint now | Wall base now (tiles, x by y) | Door / eave today | Verdict |
| --- | --- | --- | --- | --- |
| Town hall (`town`, town_1..5) | 1 | 0.89 x 0.40 | 1.74 m on steps / storey 2.1 to 2.5 m | **Change (F2, F3):** people ask 1.5x, which makes the base 1.34 x 0.60: **2 x 1** |
| Goods shed (`warehouse`, warehouse_1..5) | 1 | 0.90 x 0.40 | goods door 2.08 m / eave 3.0 m | **Change (F2, F3):** people ask 1.25x, base 1.13 x 0.50: **2 x 1** |
| Farm halt (`farm`, farm_1..5) | 1 | 0.53 x **1.49** | door 2.84 m / eave 3.9 m (walls true, door large) | **Change (F2):** size stays; the long axis is **y**: **1 x 2** at rotation 0 |
| Lumber yard (`lumber`) | 1 | **1.67** x 0.28 | no door / eave 3.7 m (true) | Candidate (F6): 2 x 1, size stays |
| Town station (`station`) | 1 | **1.33** x 0.70 | 2.30 m / 3.9 m (true) | Candidate (F6): 2 x 1, size stays |
| Power plant (`power_plant`, works) | 1 | **1.29** x 0.54 | not measured | Candidate (F6); a works has no span field yet |
| Colliery (works, full chain) | 1 | **1.28** x 0.47 | not measured | Candidate (F6) |
| Water pump (`pump`) | 1 | 0.82 to **1.26** x 0.34 | door 2.43 m / eave 4.1 m | Borderline: the level 4 and 5 pictures are wide; look at it in the playtest |
| Ironworks (works, full) | 1 | 1.22 x 0.47 | not measured | Borderline |
| Quarry, mine, sand pit, copper mine (`quarry`) | 1 | 1.11 x 0.45 | no door / hoist eave 3.2 m, skip 2.4 m (twice a real one) | Borderline; skip needs a repaint, not a footprint |
| Hydro plant, substation (works) | 1 | 1.08 x 0.59, 1.05 x 0.76 | not measured | Fit within the yard; leave |
| Windmill (works) | 1 | 0.65 x 0.57 | door 2.50 m / tower 8.0 m (door large) | Fits. Size is a scale question (v9.2), not a footprint one |
| Kiln, grinder, refinery, diesel refinery, oil derrick, wire mill | 1 | 0.45 x 0.60 to 0.95 x 0.75 | not measured | Fit; leave |
| Houses (`townhouse`, s0..s2, 1..4) | 1 | 0.83 x 0.49 | door 2.26 m / eave 3.1 m | Fit and true |
| Water tower, coaling stage (decor) | 1 | 0.24 x 0.23, 0.58 x 0.23 | tower 4.7 m in all (too small) | Fit; the tower's size is a scale question |
| Depot, narrow depot | 2 x 2, 2 x 1 | n/a (generated) | n/a | Already multi-tile |

No building is too small for its tile by footprint alone; the smallest wall base is the water tower's 0.24.

---

## F1 · Stations: a def can span two tiles in a row, and a shed's gates stay the shed's

**Labels:** agent:gameplay, type:task · **Priority:** p2 · **Verification tests:** yes · **Size:** about 250 lines
**Blocked by:** Q1, Q2 answered.

### The author's words (2026-10-17, translated)
> The warehouse and the town hall are too small. And the farm halt is too big to fit on 1 tile. Could you make them
> take 2 tiles? Their size need not change, only their in-game use. This may be the case for other buildings too.

### Goal
A station def can declare a 2 x 1 or 1 x 2 footprint without becoming a shed. No def uses it yet (F2 flips the three),
so nothing changes in play.

### Acceptance criteria
- [ ] `StationDef` gets `span?: { w: number; h: number }` (width along x and depth along y at rotation 0; 1 to 2 each,
      area at most 2). `placeSpan` (src/sim/doors.ts:59) reads it first, then `long`, then `size`. `content.ts` validates
      it with the other def fields (src/data/content.ts:~195-215) and refuses a span of area above 2 or non-integers.
- [ ] `gatesOf` (src/sim/stations.ts:56) separates the shed rule from the footprint: a def with `depot` set keeps the
      shed gates; any other def with a 2-tile span gets every orthogonal neighbour of its footprint, as a 1-tile station does.
      `platforms` and `Station.size` keep their meaning.
- [ ] `Builder.hasAdjacentTrack(x, y)` (build.ts:281) is asked of the footprint, not the corner: `checkStation` accepts a
      2-tile station whose only track neighbour touches its second tile, and refuses one with none.
- [ ] `TownRegistry.townAt` and `members` (towns.ts:108-140) measure the reach from the nearest footprint tile of the
      hall (`Station.distTo`, stations.ts:396), so a 2-tile hall reaches `TOWN_RADIUS` beyond both its tiles. A 1-tile
      hall answers exactly as today (shown by a test over the existing towns fixtures).
- [ ] Tests (Verification may write them): a property over every orientation `rot` 0 to 3 and over spans 2 x 1 and 1 x 2:
      footprint size 2, tiles adjacent, `rot` and `rot + 2` cover the same tiles, gates are exactly the footprint's
      orthogonal neighbours, no gate lies inside the footprint; a depot's gates are unchanged.
- [ ] `doors.test.ts` (placeSpan table at src/sim/doors.test.ts:299 and :648-666) covers `span`.
- [ ] typecheck, lint, test and format:check pass. No save change (the span is derived from the def).

### Out of scope
Flipping the data (F2). Works (`BuildingDef`) keep one tile (F6 decides whether they get a span).

---

## F2 · Town hall, goods shed and farm halt take two tiles, and a save grows them

**Labels:** agent:gameplay, type:task · **Priority:** p2 · **Verification tests:** yes · **Size:** about 350 lines
**Blocked by:** F1, Q1, Q2.

### Goal
`town` and `warehouse` span 2 x 1, `farm` spans 1 x 2 (rotation 0). Old saves and level files load with each of them
on two tiles where a neighbour is free.

### Acceptance criteria
- [ ] src/data/stations.json: `town` and `warehouse` get `span: {w: 2, h: 1}`, `farm` gets `span: {w: 1, h: 2}`
      (the long axis the pictures have, from the audit). Their doors stay the defaults (platform on the front row's tile,
      street door on the back row); if Art's ground-data check (F4) reports a door more than half a tile off its tile,
      this issue sets `doors` explicitly to the tile the picture shows.
- [ ] `SAVE_VERSION` 21 with a `MIGRATIONS` entry `from: 20`. For every saved `town`, `warehouse` and `farm` station it
      picks a rotation whose second tile is free of track, stations, decor, works, houses, bridge platforms, roads and
      water or rock in the saved ground, trying the rotation it has first, then the other axis; the saved tile `(x, y)`
      stays in the footprint and its street door and platform door stay on the tiles they were on. Where no rotation is
      free the station is saved with `single: true` (an optional `StationJSON` field, not a top-level key, so
      `KNOWN_SAVE_KEYS` stays) and `Station`, `stationFootprint`, `gatesOf` and the load repair honour it, so that one
      stays on one tile exactly as before. A new placement never sets it. (Q2 option a; the issue changes if the author picks b or c.)
- [ ] The step only fills in what it needs and never assumes a field a later version introduced (AGENTS.md rule).
      `save.test.ts` registry test passes. A test builds saves from the existing fixtures with these three buildings next
      to a house, a road, a track and the map edge and asserts: every station's footprint tiles are disjoint from every
      other object, the old tile is inside, gates still include every tile track reached before, and the second load of
      the migrated save is a no-op.
- [ ] `loadRepair` (src/engine/loadRepair.ts:92) stands the grown tile on land too, and `LevelStation` files from the
      editor (`Station.fromLevel`, stations.ts:557) get the same growth on load.
- [ ] `STR.build` gets no new string; the placing preview already shows a 2-tile ghost (src/ui/toolRotation.ts:48) once
      `Station.w/h` say 2.
- [ ] `towns.test.ts` passes with a 2-tile hall; houses are still placed round the hall without covering its second tile
      (src/sim/houses.ts, `Builder.checkStation` is the one occupancy rule).
- [ ] typecheck, lint, test and format:check pass. The map-generation goldens do not move.

### Out of scope
Drawing (F3, F4). The other buildings of the audit (F6).

---

## F3 · Two-tile stations are drawn centred on their pair, the town hall at 1.5 and the goods shed at 1.25

**Labels:** agent:rendering, type:task, scope:cross · **Priority:** p2 · **Verification tests:** yes (assetScale) · **Size:** about 250 lines
**Blocked by:** F1. Lands before or with F2 so a flipped def never draws at a corner anchor.

### Goal
A station with a 2-tile span is drawn from the centre of its two tiles with its ground fit, yard, plinth and
shadow over both; the town hall is drawn 1.5 times and the goods shed 1.25 times as large as today, the farm halt
as large as today.

### Today
`Game.onStationChanged` (src/game.ts:1692-1735): the `long` branch centres a frame named `<art>_r<rot%2>` (depot art
only); the generic branch anchors on the corner tile. Scale: `structureScale` (src/render/assetScale.ts:81-89).
Demo: the town hall at 1.5 and the goods shed at 1.25 are what `BSCALE_TRUE` could not apply because they did not fit
one tile (codex-demo-work/src.v91-final/app.js:5858-5870 and demo-v9/scale-table.md, "Buildings the footprint does not suit").

### Acceptance criteria
- [ ] **game.ts, one branch (the cross-role line, at most 15 lines in `onStationChanged`):** any non-depot station
      whose `w * h` is 2 is placed like the `long` branch does: anchored between its two tiles, sorted with the tile
      nearer the camera, frame `structureFrame(atlas, 'structures/<art>_<level>', rot)`. Nothing else in game.ts moves.
- [ ] assetScale.ts gets `FAMILY_SIZE: Record<string, number> = { town: 1.5, warehouse: 1.25 }` multiplying
      `structureScale` for the unturned family; comment: provisional factors, the people measurement of 10-17, re-measured
      if the global scale changes. `assetScale.test.ts` pins the two factors and that no other family changes.
- [ ] The yard, plinth, ground fit and window lights follow the drawn picture (they read `scaleReference`, so the
      factor reaches them); a door path still starts on the picture's door (src/render/buildingYard.ts).
- [ ] Rotations 0 to 3: the generated turned frames exist for each family, so every rotation draws something centred
      on the pair; Art (F4) makes their size right.
- [ ] QA in a browser: screenshots of a town hall, a goods shed and a farm halt at rotations 0 and 1, zoom 1 and 2,
      beside a walker and a house; the town hall reads as the civic centre, the shed as a shed. A 1-tile `single`
      station (F2 fallback) is drawn as today, without the multiplier.
- [ ] Paint cost: wall time at zoom 1 within 2% of develop on the #436 benchmark map.
- [ ] typecheck, lint, test and format:check pass.

### Out of scope
The other True-to-people factors (water tower, quarry, farm, windmill, pump, Fuel Pump); the global scale choice (v9.2).

---

## F4 · Ground data and turned views for the two-tile stations

**Labels:** agent:art, type:task · **Priority:** p2 · **Verification tests:** no (the ground-data test and building-ground tests run) · **Size:** about 200 lines plus the regenerated `buildingGround.json`
**Blocked by:** F2 (defs), F3 (scale multipliers).

### Acceptance criteria
- [ ] `node tools/building-ground.mjs` regenerated: the town, warehouse and farm frames carry the 2-tile `footprint`;
      its notes list no frame whose door is more than half a tile from the door tile of its def (the list goes to F2).
- [ ] The generated turned frames `town_N_r1..r3`, `warehouse_N_r1..r3`, `farm_N_r1..r3` (src/art, `addTurns`) are drawn
      for the 2-tile footprint at the same scale relation as the illustrated frame: at the multiplied scale they stand
      on the pair, not on one tile. Frame counts and anchors in `public/assets` do not change (re-run
      `scratchpad/art-sheets.mjs` and attach the sheet).
- [ ] `frame-inventory.json`, `atlasFrames.golden.json` updated only if a key set changed (it should not).
- [ ] typecheck, lint, test and format:check pass.

---

## F5 · A building's drawn wall base fits its footprint

**Labels:** agent:verification, type:task · **Priority:** p3 · **Verification tests:** is the task · **Size:** about 150 lines
**Blocked by:** F2, F3, F4.

### Goal
The rule the author asked for becomes a test, so a picture that outgrows its tile fails instead of being found by eye.

### Acceptance criteria
- [ ] A test over `buildingGround.json` and `structureScale`: for every building frame at rotation 0, the wall base
      extent along x and along y (scaled) is at most the footprint's tiles along that axis plus 0.1.
- [ ] The failures today are listed once in an allowlist with the issue that fixes each (F6): lumber, station,
      power_plant, colliery, pump (levels 4 and 5), ironworks, quarry. The test fails if an entry is no longer needed.
- [ ] Mutation check: raising `FAMILY_SIZE.town` to 3 fails the test.

---

## F6 · HOLD: the other buildings of the audit take the footprint their picture needs

**Labels:** agent:gameplay, type:task, status:triage · **Priority:** p3 · **Verification tests:** yes
**Do not file until** the author has played F1 to F5 (Q3).

Candidates, measured above: lumber yard 2 x 1, town station 2 x 1, power plant and colliery (works; `BuildingDef`
needs a `span` field and `layBuilding`/`checkBuilding` a footprint loop first, about 300 lines of its own), then
pump levels 4 and 5, ironworks and quarry if the playtest shows overhang. Same rule: the size stays, the footprint
grows. Each is a data flip plus the F2 migration step (extended to its def) and F4 ground data. The station's door
the platform stays on the tile track serves today.

---

# 2. The approved demo items, one issue each

Sleepers: already in the game through #405 (closed; `sleeperLayout` in src/art/trackIllustrated.ts, narrow joins).
Nothing to do; the demo's "Sleepers: Even" only showed it before #405 was merged.

Desert dead trees at 20%: the game places no dead trees on desert sand (the demo's placement is its own), so there is
nothing to port. Not an issue.

## W1 · Wind: one level, one direction, one gust field

**Labels:** agent:gameplay, type:task · **Priority:** p2 · **Verification tests:** yes · **Size:** about 200 lines
**Blocked by:** Q4.

### The author's words (2026-10-17)
> Wind and waves on the still water ... The rest is good. / Actually the wind is fine. Keep it as it is in the demo.

### Today
No wind in the game. Weather is rain or fog from a seeded RNG (src/sim/weather.ts:49-), drawn as screen rain streaks
(src/render/fx.ts:200) and a HUD on/off toggle (src/ui/hud.ts:53); settings live in `Settings` (src/sim/save.ts:171, `DEFAULT_SETTINGS` at :237) and `settingsScreen.ts:138-169`. Trees are static sprites (src/render/worldRenderer.ts:763).

### Demo
`codex-demo-work/src.v91-final/app.js:3-41`: `WIND = {level, strength, from, to, toTile}` with `WIND_STRENGTH`
calm 0, breeze 0.35, windy 0.7, storm 1; eight directions (`WIND_FROM`, wind named by where it blows from; default
Breeze from the west; north at the top of the screen); `setWind(level, from)` throws on an unknown name and changes
nothing; `windGust(px, py, t)` is the shared 0..1 field of bands that travel downwind at `40 + 200 * strength` world
px a second, bent across the wind by sines; 0 everywhere when calm. Every effect reads it and none changes it.

### Acceptance criteria
- [ ] `src/sim/wind.ts`: the same level names, strengths, directions, `setWind`, `windGust(px, py, t)` with the demo's
      exact terms (a, b, c bands, the smoothstep), pure and deterministic; `toTile` computed as the demo does.
      Exports `WIND` as one mutable object whose `to` and `toTile` change in place.
- [ ] `Settings` (Gameplay's file, so every new field is added here once) gets `windLevel` (default `'breeze'`), `windFrom` (default `'W'`),
      `buildingLife` (default `true`) and `waveStrength` (`'gentle'` default, or `'v9'`), all in `DEFAULT_SETTINGS` (save.ts:237),
      carried with the settings and not the save; an unknown stored value falls back to the default. No `SAVE_VERSION` change.
- [ ] Tests: calm gives 0 everywhere; the gust is in [0, 1]; at fixed `t` the field is the same for every call; a band
      moves downwind by `speed * dt` (shift test along `to`); `toTile` projected by the iso formula equals `to`.
- [ ] No other module imports wind yet (consumers are W3, W4, W6 to W11).

### Out of scope
The UI (W2), any drawing.

---

## W2 · Settings: Weather (wind level), Wind from, Building life

**Labels:** agent:uiux, type:task · **Priority:** p2 · **Verification tests:** no · **Size:** about 150 lines
**Blocked by:** W1.

### Acceptance criteria
- [ ] The settings screen (src/ui/settingsScreen.ts:138-169) gets a Weather row (Calm, Breeze, Windy, Storm; Breeze
      default), a Wind from row (N, NE, E, SE, S, SW, W, NW; W default) and a Building life on/off toggle (default on;
      off when `prefers-reduced-motion`), all through `STR.settings.*` in src/strings.ts. The Weather row names the wind
      level; the existing HUD weather button and rain/fog keep their meaning (Q4).
- [ ] Changing a row applies at once (no reload) via `setWind`, and survives a restart with the other settings.
- [ ] Tooltips say what each level does ("Trees sway, tumbleweeds roll"); English only, flat keys.
- [ ] `game.ts` wiring (cross-role line, Core grants, at most 3 lines): `setWind(settings.windLevel, settings.windFrom)`
      on load and on change; the same for `settings.buildingLife`.
- [ ] typecheck, lint, test and format:check pass.

---

## W3 · Trees sway in the wind

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** yes (pure sway function) · **Size:** about 350 lines
**Blocked by:** W1, W2.

### Today
Trees are `props/*` sprites scaled by `TREE_SCALE` (src/render/worldRenderer.ts:763); `isTree` (assetScale.ts:111) lists
tree, pine, oak, spruce, birch, palm, deadtree. Mangrove and willow frames are packed (#460, #467, props atlas) and are
added to `isTree` by the swamp issue S2.

### Demo (app.js:6154-6209)
Each tree bends from the foot of its picture, more toward its top: the bend is `x(h) = D (h / H)^p`. `SWAY` per kind
`[amp, hz, p]`: oak 0.8/0.42/1.7, tree 0.9/0.48/1.7, birch 1.15/0.58/1.5, pine 0.7/0.66/2.1, spruce 0.62/0.72/2.3,
palm 1.0/0.36/1.4, deadtree 0.25/0.9/2. Lean (a share of height) =
`amp * (S * (0.025 + 0.045 * gust) + (0.011 + 0.026 * S) * (0.4 + 0.6 * gust) * osc)`, `osc = sin(t om + ph) + 0.3 sin(1.83 t om + 1.7 ph)`,
`gust = windGust(foot x, foot y - 0.7 H, t)`, phase, frequency and amplitude varied per tree by a hash of its foot. The
lean goes downwind on screen and a push toward the camera squashes the picture a little about its foot. One to three
bands (cut where the top moves under 0.6 px, 2.5 px or more), edges snapped to screen rows so no seam shows. In a
calm every tree is drawn as before, pixel for pixel.

### Acceptance criteria
- [ ] Trees on screen lean as the demo: same `SWAY` table, lean formula and per-tree variation, from `windGust`.
- [ ] The foot never moves (a test on the pure lean/offset function: offset 0 at the foot, monotone up, 0 in calm,
      symmetric for opposite winds).
- [ ] Calm, Building life irrelevant: a calm screenshot of a forest equals today's pixel for pixel.
- [ ] Only trees inside the view are updated; paint cost at zoom 1 on a forest map within 1.5% CPU of develop (measured like #474).
- [ ] No texture-seam artefacts at zoom 1, 2, 4 (screenshots).
- [ ] typecheck, lint, test and format:check pass.

---

## W4 · Desert: tumbleweeds roll and sand drifts

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** yes · **Size:** about 300 lines
**Blocked by:** W1, W2.

### Today
The game has desert ground (`Biome.Desert`, `terrain/desert_*`; src/render/worldRenderer.ts:527-541) and nothing that moves on it.

### Demo (app.js:6537-6760)
Desert ground is desert-climate sand that is not beach, building, water, rock or pond. Tumbleweeds roll along lanes
downwind: each lane a run of desert at least 0.2 tile from anything not desert, entering at its upwind end and leaving at
the downwind end, bouncing and spinning with a small ground shadow; one now and then in a breeze, a few when windy, many
in a storm; they keep clear of the foot of a cactus or palm. Low soft streaks of sand drift downwind in the gusts, more
and stronger with the wind. Nothing moves in a calm.

### Acceptance criteria
- [ ] Tumbleweeds and sand streaks as above, drawn procedurally (no new atlas frames), depth-sorted with objects.
- [ ] A pure `desertLanes(map, wind)` function returns the lanes; test: every lane tile is desert, none within 0.2 tile
      of a non-desert tile, each lane runs with the wind within 45 degrees, and a tumbleweed position is never inside an
      obstacle's footprint at any sampled time.
- [ ] The numbers per level (how many at once) come from the demo source; the document in the PR says which.
- [ ] Calm: nothing is drawn; reduced motion: nothing moves.
- [ ] typecheck, lint, test and format:check pass.

### Note
The demo's "dead trees 20%" is demo-only (the game places none).

---

## W5 · Water fields for waves: where the open water is and what the wind has crossed to reach it

**Labels:** agent:rendering, type:task · **Priority:** p2 · **Verification tests:** yes · **Size:** about 350 lines
**Blocked by:** W1, #365 (the moving-water slice, below).

### Today and the dependency
The game's only water animation is a sparse set of ripple strokes on built water tiles, redrawn every 0.12 s
(src/render/worldRenderer.ts:921-950). The moving-water layer of #365 (sea, lakes, rivers, falls, the Animated/Still setting)
is open and blocked by #343, #355, #356 and #363. The waves need only the part #365 calls "lake and sea water": Core
will carve that slice out of #365 as its first task (a comment on #365) and W5 to W7 build on it. Rivers keep their
flow animation; nothing here touches them.

### Demo (app.js:4722-5101, 5102-5348)
A grid node every 4 world px across and 2 down. The fields do not depend on the wind (computed on repaint): `K` (what the
painter put at a point: still water, river current, fall, land), distance to the shore and the fetch (how much open
water lies upwind), `wavesDir` travel time (slower near the shore, so crests bunch up, turn to meet the shore and bend
round headlands, fading where they break).

### Acceptance criteria
- [ ] `src/render/waterFields.ts`, pure: `still water mask`, `shore distance`, `fetch along a direction`, `wave travel time`.
      Typed arrays on the demo's grid; a function of the map's water only.
- [ ] Tests: a square lake: distance 0 at the shore and grows inward; fetch grows with the width upwind and is 0 on
      the upwind shore; travel time increases monotonically toward the shore; rivers and falls are excluded from the mask;
      a river mouth is outside the swash.
- [ ] The fields are rebuilt only when the painted water changes, not every frame.
- [ ] typecheck, lint, test and format:check pass.

---

## W6 · Open-water waves: Swell (default), Ripples, Chop, at the Gentle strength

**Labels:** agent:rendering, type:task · **Priority:** p2 · **Verification tests:** no (QA in a browser) · **Size:** about 400 lines
**Blocked by:** W5, W2.

### The author's words
> Wind and waves on the still water is a little too aggressive, can it be slighter and smaller? ... Actually the wind is fine.

Core's reading, kept in v9.1: the strength switch **Wave strength: Gentle (the default) or v9**.

### Demo (app.js:4722-4760 and 5102-5348)
`WAVES`: v8 / ripples / **swell (default)** / chop; `GENT = { c: 0.5, cc: 0.65, z: 2/3, zc: 0.55, dn: 1.2, cp: 0.5 }`:
c = share of v9's contrast, z = share of its size (crest length, width and wavelength; the swell's period goes with its
wavelength), dn = crest density, cp = white-cap share. Measured: mean |dY| of open-water pixels 4.56 to 2.18 (x0.48),
Storm still rougher than Breeze (storm/breeze 1.22, 1.49, 1.73 for Swell, Ripples, Chop). Crests lie across the wind,
travel downwind, grow with strength; gusts show as patches of darker, rougher water; Calm draws v8's water.

### Acceptance criteria
- [ ] Swell, Ripples and Chop treatments with `WAVES` and the **Wave strength** setting (`Gentle` default, `v9`; the field is W1's
      `waveStrength`); the settings row is UI/UX's one-line addition to W2's rows when this lands.
- [ ] Gentle uses the `GENT` multipliers and v9 the unmultiplied constants; Breeze < Windy < Storm in contrast at both.
- [ ] Calm: v8 water exactly. Rivers, falls and mouths: unchanged. Reduced motion: still water.
- [ ] QA in a browser: shots of sea, bay, lake at Breeze, Windy, Storm, wind W and N, zoom 1, 2, 4, Gentle against v9;
      the author's "slighter and smaller" is visible and the crests still read at Storm.
- [ ] Paint cost: the water layer within 3% CPU of develop at zoom 1 over the sea (budget measured in the PR).
- [ ] typecheck, lint, test and format:check pass.

---

## W7 · Waves break on the shores the wind blows toward (the swash)

**Labels:** agent:rendering, type:task · **Priority:** p2 · **Verification tests:** no · **Size:** about 350 lines
**Blocked by:** W5. May run beside W6.

### The author's words
> The waves on shores are better. (Do not change the shore swash.)

### Demo (app.js:5349-5731, `drawShore`)
On shores the wind blows toward, each wave breaks into a line of foam that runs up the beach or bank and draws back,
leaving the sand wet until it dries before the next one. It follows the waterline the painter drew, never reaches past its
run-up, keeps out of river mouths, is smaller on lakes (and where little open water lies upwind), nearly nothing where the
wind blows off the shore. Its own rhythm (`lam`, `T`) stays v9's in both strengths.

### Acceptance criteria
- [ ] Foam run-up, backwash, wet sand and film as the demo, from the same fields (W5), with the demo's constants.
- [ ] A pure function `swashAt(shore, wind, t)` with tests: zero off-shore wind, bounded run-up, no swash at river mouths,
      period independent of wave strength.
- [ ] Calm: none. Screenshots at the demo's shots (bay shore, lake) against the demo at the same time value.
- [ ] typecheck, lint, test and format:check pass.

---

## W8 · Art: where the chimney pots are and the quarry crane's load as its own picture

**Labels:** agent:art, type:task · **Priority:** p3 · **Verification tests:** yes (a data test) · **Size:** about 250 lines
**Blocked by:** nothing. Starts now.

### Goal
Rendering needs picture-relative data it cannot measure at run time.

### Demo (app.js:6489-6500 and 6448-6488)
`CHIMNEYS`: per frame, the pot tops in the picture's own pixels (town_2/3 two pots, townhouse one, station_2 three,
warehouse_1 two, lumber_2 one works pot, farm_2 one, pump_1 one works pot; a works pot always smokes and thicker, of the
houses about two in three are lit). The crane: `structures/quarry_2` (271 x 346) has a crate, slings, hook and rope that
hang free of everything else and swing from the pulley at (44.5, 41).

### Acceptance criteria
- [ ] `src/art/buildingLife.json`: per frame key (every level of the families above, all rotations that show the pot),
      the pot tops as `[dx, dy]` world px from the frame's anchor at scale 1, `work: true|false`; the crane's pivot and
      the load's rectangle (or a cut-out frame `structures/quarry_load_<n>` with its anchor).
- [ ] A test: every key is a frame in the atlas; every pot lies inside its frame's box and above the foot; the crane
      load's cut leaves the body's remaining pixels opaque where the body is (no hole in the sky-side rim).
- [ ] If the crane is cut into its own frame: the packer, `frame-inventory.json` and atlas frame count change and the
      new count is stated in the PR (an atlas-contract change; Core agrees before merging).
- [ ] typecheck, lint, test and format:check pass.

---

## W9 · Building life: chimney smoke (and the quarry crane's load swings)

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** yes (pure plume/pendulum) · **Size:** about 350 lines
**Blocked by:** W1, W2, W8. **Numbers from the published v9.2** (smoke higher and sparser); v9.1's are below.

### The author's words
> In Building life the chimney smoke's animation is a little wrong. It does not rise high enough, and it could be sparser.

### Today
Only locomotive smoke exists (`Smoke`, src/render/fx.ts:302-). Nothing rises from a building.

### Demo v9.1 (app.js:6489-6536) and what changes
Each plume is a train of `SMOKE_N = 14` soft puffs, life 4.2 s (works) or 4.8 s (house) scaled `(1 - 0.35 S)`, rise 15 to 18 px
scaled `(1 - 0.6 S)`, drift downwind `S (6 + 30 S) (0.7 + 0.6 gust)` with `age^1.35`, puff radius growing with age,
two ellipses (shade lower right, body upper left), alpha `A min(1, 9 age)(1 - age)^1.3`; a storm tears it flat. v9.2
changes: it rises clearly higher (several storeys before it fades, bending downwind with height), fewer and more widely
spaced puffs, fewer chimneys lit, a thinner plume. **The v9.2 constants replace these.**

### Acceptance criteria
- [ ] Plumes from every pot in `buildingLife.json`, constants from v9.2; calm: rises straight; off with Building life.
- [ ] The crane's load swings from its pivot downwind and back as a pendulum (more in a gust); still in a calm.
- [ ] Pure functions `plumePuff(age, S, gust)` and `cranePhase(t, S, gust)` with tests: puffs rise monotonically, alpha 0 at
      age 0 and 1, drift 0 when calm, bounded swing angle.
- [ ] Only plumes in view are drawn; at most 2% CPU over develop with 60 lit chimneys on screen.
- [ ] typecheck, lint, test and format:check pass.

---

## W10 · The windmill's sails turn with the wind

**Labels:** agent:rendering, type:task, scope:cross · **Priority:** p2 · **Verification tests:** yes · **Size:** about 300 lines
**Blocked by:** W1, W2, Codex **C17c** reviewed, Art packs the new windmill (below), Q5.

### The author's words
> Can you also set the windmill's speed relative to the wind? ... The windmill is rendered at a slightly wrong angle.

### Today
Sails are painted into `structures/windmill` (illustrated) and code-drawn into the generated turns (src/art/civic.ts:74-125).
Nothing turns.

### Demo v9.1 (app.js:6210-6330)
Speed (turns per second) is piecewise-linear in wind strength through 0 to 0, 0.35 to 0.10, 0.7 to 0.17, 1 to 0.24, times a
gust factor `0.65 + 0.7 * windGust(at the hub)` (about +-35%); the strength part eases with a 1.8 s time constant, the gust
part with 0.25 s; a calm coasts to a stop. The sails turn in the vertical plane perpendicular to the lower-left (+y, SW)
face, drawn by the 2:1 camera: an ellipse of 0.61 minor over major.

### Acceptance criteria
- [ ] The repainted body (no sails) is drawn at rotation 0 with the sail cross over it, pinned at the recorded hub point,
      turning about the hub at the speed above, in the plane `A = s * [[0.7071, 0], [0.3536, 0.866]]` applied to the
      face-on square cross (u right, v down). The ~50 px sweep is not clipped and not in the hover box. The cross is drawn
      above the body at the body's depth slot.
- [ ] `DOOR_FRACTION.windmill` (assetScale.ts:22-29, 38/240 is the old picture's) is re-measured on the packed new body so the windmill's
      scale comes from its true 2.1 m door, not the demo's 0.9.
- [ ] Other rotations keep today's static windmill picture (Q5). Levels 2 to 4 use the same body and cross at their
      packed scales.
- [ ] Pure `millRev(S, gustAtHub)` and `millPhase` with tests: 0 when calm, monotone in S, mean equal to the table at gust 0.5,
      the phase advances `2 pi rev dt` and wraps, the hub does not move during a turn (hub pixel is a fixed point of the transform).
- [ ] Building life Off: the plain static windmill as today.
- [ ] game.ts wiring (cross-role line, at most 4 lines): none if the renderer already receives the frame list; otherwise the
      single call that tells the world renderer which structure ids are windmills at rotation 0.
- [ ] typecheck, lint, test and format:check pass.

---

## S1 · World: a swamp coast, mangroves and willows

**Labels:** agent:world, type:task (the PR needs the author's `gate:approved` for the goldens) · **Priority:** p3 · **Verification tests:** yes · **Size:** about 400 lines; split off the `PropKind` addition (100 lines) first if it runs over
**Blocked by:** nothing for the code (the six pictures are packed: `props/mangrove_0..2`, `props/willow_0..2`, #460 and #467); the author's `gate:approved` for the map-generation goldens.

### Author's words (2026-10-16)
> The forest biome by the sea ... sometimes it could become a mangrove or swamp biome, and we would put these trees there, directly on the waterfront.

### Demo (app.js:6762-7000, "Coast: Swamp")
On the forest-by-sea peninsula the beach and the forest's edge become a mangrove swamp: dark wet earth and moss in broad
clusters, pools, a ragged muddy waterline and murky shallows; mangroves at the waterline and in the shallows, willows on the banks
behind, reeds and cattails in clumps, a dead snag or two, the forest's own trees where the ground rises away from the water.
Parts per tile: SWZ 0 none, 1 swamp ground where the beach was, 2 the forest's edge by it, 3 the shallows, 4 the forest further in.

### Acceptance criteria
- [ ] `PropKind` gains `mangrove` and `willow` (src/world/); mapgen places mangroves on shallow water by forest or swamp
      coasts (offset clamped, never blocking a river mouth) and willows on grass or forest beside rivers and lakes.
- [ ] A swamp biome id is **appended** to the biome plane (never renumbered) under the plane rule of #339 (a chunk encoding
      version bump; older chunks decode with the plane empty); only chunks generated after this change get it (#368).
- [ ] Build rules: nothing but a bridge goes on mangrove shallows; track and stations refuse them with a reason.
- [ ] The mapgen goldens change; the PR says so, the author re-blesses with `gate:approved`, the issue does not touch them.
- [ ] Tests: determinism by seed; a swamp tile has water or beach or forest within one tile; no swamp on a mountain or desert.

---

## S2 · Rendering: mangroves and willows stand in the water and sway

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** no · **Size:** about 250 lines
**Blocked by:** S1, W3 (for the sway).

- [ ] `isTree` (assetScale.ts:111) adds `mangrove` and `willow` with scale, season tint (does the evergreen mangrove take autumn? default no)
      and sway entries (willow's hanging curtain swings later than its crown); depth over animated water; mangrove_0's roots checked at zoom 1.
- [ ] The swamp's ground, pools and murky shallows are painted by the landscape painter from the biome plane (the demo's
      look, app.js:6762-6930), including the ragged waterline.
- [ ] QA shots of the bay at zoom 1, 2, 4. Cost within 2% of develop.

(UI/UX adds the swamp's name and tooltip strings in `STR` as a one-line task when S1 lands: agent:uiux, about 30 lines.)

---

## T1 · Gameplay: the border of a town

**Labels:** agent:gameplay, type:task · **Priority:** p3 · **Verification tests:** yes · **Size:** about 250 lines
**Blocked by:** F2 (a hall has two tiles).

### Demo (app.js:5950-6104)
A town reaches `TOWN_RADIUS` (Chebyshev 7) round its town hall, the nearest hall where reaches overlap. The border takes every
building of the town (hall and every house, station, works and warehouse in its reach), every tile of their footprints grown
by 3 tiles as one region; where two towns meet each tile goes to the nearer hall, so borders never overlap.

### Acceptance criteria
- [ ] `townRegions(towns, builder)` returns, per town, its tile set (the footprints grown by 3, nearest hall wins) and the outline
      loops of each; uses `stationFootprint` so a 2-tile hall counts both tiles.
- [ ] Tests: two towns' regions are disjoint; a lone house outside the radius is not in any; regions are 4-connected through the
      hall; the outline of a rectangle region is its rectangle; moving a hall by one tile moves the border.

## T2 · Rendering: the border drawn on the ground

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** no · **Size:** about 250 lines
**Blocked by:** T1.

- [ ] A thin line in the town's colour at reduced strength, corners rounded (outline of the blurred region taken a little
      inside its edge so two towns' lines run side by side), lying on the ground at each point's height, hidden where a rise
      hides it, under buildings, trees and trains, over ground and roads (demo app.js:5950-6104).
- [ ] An API `showBorder(townId | null)`; one border pinned plus one hovered at most.

## T3 · UI/UX: hover a town hall to see its town's border; click pins it

**Labels:** agent:uiux, type:task, scope:cross · **Priority:** p3 · **Verification tests:** no · **Size:** about 150 lines
**Blocked by:** T2.

- [ ] Hovering a town hall shows its town's border; a click pins it; a second click on that hall or Escape lets go;
      under reduced motion the same, instantly. Strings in `STR`. game.ts wiring (cross-role line, at most 4 lines): the hover
      and click hook to `showBorder`.

---

## P1 · Update #323: people's fixed walk (planted foot, gait, pose order)

**Labels:** agent:rendering, type:task · **Priority:** p2 · **Verification tests:** yes · **Size:** about 300 lines
**Blocked by:** Codex **R7c** reviewed and the people atlas packed (#331, #304); #323 is the home of this work.

### Today
`PeopleRenderer` shows two generated frames while a walker moves (src/render/peopleRenderer.ts:17, 69); there is no
`people.png`. #323 (open): "steps follow the distance walked, and a figure faces where it walks".

### Demo (app.js:5732-5857, "Fixed walk")
The pose changes every `PEOPLE_FRAME_S = 0.125` s and the walker moves `PEOPLE_GAIT` per pose (about 0.026 to 0.034 tile,
per strip; half the distance between the feet of the front strip's contact poses), so each pose stands where its foot came
down; the pose still follows the distance walked. Each strip plays in walking order (`PEOPLE_STRIPS.order`), the stand
pose when stopped, and a small bob (`dy`) keeps the planted foot on the ground. After R7c every back strip is a repainted
cycle in time order P1 to P4 and plays 0, 1, 2, 3.

### Acceptance criteria
- [ ] Edit #323's acceptance to add the above (Core posts it as a comment now, with the demo constants), and implement it.
- [ ] Pure `walkPose(distance, strip)` and `plantedFootError(strip)` with tests: pose index follows distance; across a full
      cycle the planted sole moves less than 0.5 world px against the ground (the demo's skating criterion); the stand pose is
      used when stopped.
- [ ] The directions: up-left, up-right use the back strips (the up-left mirrored), down-left, down-right the front.
- [ ] typecheck, lint, test and format:check pass.

---

## B1 to B6 · Road bridges (option A of bridges-plan/PLAN.md), one beside a rail bridge merging into one deck

The author (10-17): "The road bridge sounds good. Could you make it so that if it is next to a plain bridge, it widens and they become one?"
Defaults Core assumes until the author says otherwise (feedback-1017 item 10): wood and stone as for rail, the same span
rules as rail bridges, no footbridges away from roads, one tile holds rail or road, no save field. **The look and the
numbers come from the published v9.2**; each issue is filed after it.

### B1 · Gameplay: a road may go on a bridge platform that carries no rail
**Labels:** agent:gameplay, type:task · **Verification tests:** yes · **Size:** about 250 lines · **Blocked by:** nothing.
- [ ] `roadRules` (src/sim/build.ts:1184-1193) accepts a tile with a bridge platform (`Builder.buildingAt` is a `bridge_*`)
      that has no rail piece; a tile with a rail refuses a road ("the bridge carries rail") and a platform with a road refuses
      rail. Water without a platform is still refused.
- [ ] `repairBuiltRoads` (src/engine/loadRepair.ts:137) keeps a road on a saved platform; a saved road on bare water is still taken off.
- [ ] `bridgeSpan` (src/sim/bridges.ts:24) joins road platforms of one material as it joins rail ones; the bank-level rule is
      `supportedDeck` as for rail (or a gentler rule if the author asks).
- [ ] No save change (a road is a tile, a platform a saved building). Tests: round-trip of a saved road on a platform; a rail and a
      road never share a tile; removing the platform removes or refuses by the existing rule.

### B2 · Gameplay: walkers cross a road bridge
**Labels:** agent:gameplay, type:task · **Verification tests:** yes · **Size:** about 200 lines · **Blocked by:** B1.
- [ ] `walkable` (src/sim/people.ts:251) allows a water tile only where a road lies on a platform; `findWalk` (:342) steps onto it
      orthogonally only and widens its search past `WALK_MARGIN = 4` (:272) when the shortest way crosses a bridge, bounded by the bridge length.
- [ ] A walker never walks the track bridge's rails. Tests: a walk from bank to bank over a 5-tile road bridge exists and is shorter than
      the long way; with the bridge removed `startWalk` returns false as today.

### B3 · Rendering: bridge layout merges a road deck with a rail deck
**Labels:** agent:rendering, type:task · **Verification tests:** yes · **Size:** about 300 lines · **Blocked by:** B1.
- [ ] `bridgeLayout.ts` (`merges` :77, `bridgeJoins` :86, `bridgePlan` :157): a road deck and a rail deck on neighbouring tiles
      of one material merge into one deck across both tiles: piers and parapets shared, parapets only on the outer edges, the rail
      on one half and the road on the other; a road deck beside a road deck merges as two rail ones do.
- [ ] Pure tests over the layout: a 2-wide merged span has parapets on exactly the two outer long edges; a lone road deck has
      both; a road deck and a rail deck of different materials do not merge.

### B4 · Rendering: the road deck mesh
**Labels:** agent:rendering, type:task · **Verification tests:** no · **Size:** about 300 lines · **Blocked by:** B3, B5.
- [ ] `bridgeMeshes.ts` draws gravel or setts on the deck (the road look), planks or stones of the bridge on the edges, meeting at the
      seam; `roadPaint`/`refreshGround` treat a platform road as bridge (no painted road on the water); the deck height follows
      the banks. The textured default is covered; the kit and procedural modes still draw a plausible deck (or the PR says
      road bridges need textured).
- [ ] QA shots at zoom 1, 2, 4 of a lone wood road bridge, a lone stone one and one beside a rail bridge.

### B5 · Art: the road-top surfaces for decks
**Labels:** agent:art, type:task · **Verification tests:** no · **Size:** about 200 lines · **Blocked by:** nothing.
- [ ] `public/assets/bridge-surface-wood-road.png` and `bridge-surface-stone-road.png` (or one per material), in the bridge surface
      family (bridge-surface-*.png), same cap pass and sizes; the packer's caps test passes.

### B6 · UI/UX: the road tool on bridge tiles
**Labels:** agent:uiux, type:task · **Verification tests:** no · **Size:** about 150 lines · **Blocked by:** B1.
- [ ] The road ghost and price on a platform tile; refusal strings in `STR.build` for "the bridge carries rail", "no platform here", "the banks are not level"; one line in the hover text.

---

## M1 · Mountain: the level steps on the right-hand faces read as ledges

**Labels:** agent:rendering, type:task · **Priority:** p3 · **Verification tests:** no · **Size:** about 350 lines
**Blocked by:** nothing.

The author (10-16): "the right side of the mountain still runs together very much: you cannot tell where the steps are." Approved in v9
("the rest is good"). Demo app.js:2986-3100: on faces turned to the lower right and upper right (rightness `t0`..1), each level
edge (the edge between levels k and k+1 lies at height k+0.5) is painted: riser a value step darker, its lip lit, a shadow at
its foot, the tread back toward the plateau light; edges wander up to 0.16 tile; widths in screen px so they keep their size
whichever way the face turns. `RSP.game` (Game v2, the default): crisp ledges of the flank's crag rock; `RSP.smooth` is not ported.

- [ ] Ledges in the landscape painter (`src/render/landscape.worker.ts` / terrainRelief.ts) with `RSP.game`'s constants; faces turned
      left and everything off the mountain are pixel for pixel as today (test over a seeded map: pixels equal outside the mask).
- [ ] QA shots at zoom 1 and 2 of two mountains from all four rotations of the view.

---

## Held: not yet approved by the author

### X1 · Storm weather: rain, lightning, fog setting
Asked 10-17 (fourth message), shown in v9.2. The game already has rain streaks (src/render/fx.ts:200) and a Weather that rolls rain or fog
(src/sim/weather.ts:49). Draft when v9.2 is approved: slanted rain with the wind, wet darker ground and water ripples, overcast light, a
far bolt and a gentle brightening at most once every several seconds and none under reduced motion; a Fog setting (Off, Valley mist,
Thick) drifting with the wind. Roles: Rendering and UI/UX, about 600 lines in three tasks. Blocked by W1, W2 and the author's yes.

### X2 · Building scale
The author says True to people is still not right; v9.2 shows four settings (As before, True v9, Smaller, People larger). After the pick:
one Rendering task on `DOOR_PX`/`PERSON_PX` and the family tables in assetScale.ts, then F3's `FAMILY_SIZE` is re-measured against it.

### X3 · Windmill rotations 1 to 3 (Q5 option b), the passenger variants' front strips (Q6)
Only if the author picks them.

---

# 3. Art: guides for Codex C17c and R7c (one issue)

## A1 · Guides for the windmill repaint (C17c) and the people repaint (R7c)

**Labels:** agent:art, type:task · **Priority:** p1 (Codex is waiting on it) · **Verification tests:** yes (tools/*.test.mjs) · **Size:** two parts, about 350 lines each, two pull requests
**Blocked by:** Part A nothing, starts now. Part B the in-flight #325 block-out change (wf_d14e3ed4-ad8: `blockHeight` per family and a
family's own guides, in `tools/building-guides.mjs` and `assets/source/buildings-v2/families.json`), so the two do not conflict.

### The author's words (2026-10-17, translated)
> The windmill looks quite wonky like this. If you can give specific prompts to Codex, I will gladly have the windmill regenerated so it can
> be animated properly. Don't repaint only the legs but the whole figure.

### Why guides
The first windmill body came out with a 19.2 degree camera (the game's is 30) and its door and shaft 25 to 29 degrees off the lower-left face
(demo-v91/result.json, `fix.windmillAngle`); the people repaints failed because Codex copies the legs of any painting attached to it
(codex-review-1017/SUMMARY.md, R7b). Both are cured by exact guides made by Art, in the game's own projection, and by attaching no painting
whose legs or shaft already have the wrong pose. The guides must be committed to `develop` (new folders, Art-owned) so a Codex branch can
`git merge origin/develop` and read them; nothing here is on the art branches today (`windmill-2026-10-16` is on art/461-windmill-sails,
`people-2026-10-11` on art/331-people, neither merged).

### Existing tools to build on (read on develop e56682a)
- `tools/building-guides.mjs` (draws the grey block-out; `GREY` palette, `blockOf`, `fillPoly`, `HEIGHT` per footprint) and
  `tools/building-kit.mjs` (`FOOTPRINTS` t1: canvas 1024, scale 8 canvas px per game px, centre (512, 832); `project(fp, x, y, z)` is the one
  camera: `[cx + scale * (x - y) * 32, cy + scale * ((x + y) * 16 - z)]`, a 2:1 ground and 30 degrees down), `tools/building-queue.mjs`
  (show, take, set, redo), `tools/building-check.mjs`, `tools/building-fit.mjs`, `assets/source/buildings-v2/GUIDE.md` (camera rule: refuse
  more than 2 degrees off).
- People: no tool on develop. Codex's art/331-people has `make-pose-guides.mjs` (hand-traced joints of a straight-away figure, 192 px columns),
  `check-poses.mjs` (height, 2:3 return, repeat test), `assemble-strips.mjs`, `pose-tools.test.mjs`, `redo-protection.mjs`. Art may read them with
  `gh api` on the branch; it must not edit them.

### Part A: pose guides for R7c (starts now)

New `tools/people-guides.mjs` (pngjs only, deterministic, a test beside it) writing to **`assets/source/people-v3-guides/`**:

- A grey mannequin (capsule limbs, box torso, sphere head; three greys by the normal with the light from the upper left, like `GREY`) posed
  by joint angles and projected by `project()` of the game's camera (30 degrees down, 2:1). Canvas **1024 x 1536**, transparent, figure
  height 960 px, soles on row 1440, centre column 512 (the size R7b asked Codex for).
- **Four poses**, in time order, repainted frame k is step P(k+1) and the demo plays 0, 1, 2, 3: P1 contact, right foot leads; P2 passing,
  right foot planted; P3 contact, left foot leads; P4 passing, left foot planted. Contact: lead heel down, toe up, trailing heel lifted,
  arms opposite to the legs; passing: stance leg vertical, swing leg thigh forward with the knee bent about 55 degrees and the foot clear of the
  ground by about 5% of the height; the pelvis 1% of the height lower at contact than at passing.
- **Gait taken from the game, not from a textbook:** the walker advances 0.031 tile per pose (PEOPLE_GAIT, app.js:5732-5760) = 1.11 world px =
  0.123 of the 9 px figure, so at contact the feet are 0.123 of the height each side of the pelvis and **the planted foot slides back 0.123 of the
  height per pose** along the walking direction (4 texels at zoom 4). The guide encodes that, so the feet do not skate.
- **Back view, turned 45 degrees:** walking along tile -y, up-right on screen; the camera sees the back and the right side in three quarters.
  The up-left walk is this mirrored. **Front view, turned 45 degrees:** walking along tile +x, down-right; the camera sees the face and the
  front-right side; the down-left walk is its mirror. (The painted back strips today are straight-away views, legDefects.json "DIRECTION".)
- **Arm variants** (4 poses x 2 views each): swing (walks), shoulder load (right arm holds a log or sheaf, left swings), block (both
  forearms forward and up, a carried stone), yoke (both hands on a yoke across the shoulders). That is 32 guides, named
  `<view>-<arm>-p<1..4>.png`, plus `manifest.json` with every joint in canvas px per guide.
- **Identity crops** for Codex (never a painting with legs): `identity/<strip>-upper.png`, the strip's best existing frame of the same view cut at
  the hip line, legs removed with a soft alpha fade, so the pose cannot be copied; the front strips' crops serve for the back repaints of the
  same person's face and clothes.
- **Test** (`tools/people-guides.test.mjs`): soles on row 1440 +-1; height 960 +-3; the planted foot's slide between P1 and P2 and P2 and P3
  equals 0.123 x height +-0.01; contact poses P1 and P3 differ in the lowest 40% by an intersection over union under 0.45 (R7b's own repeat
  test, so a copied leg cannot pass); the mirror guide is the pixel mirror; the output hashes are stable across two runs.
- `README.md` in the folder: the pose table, the direction, what to attach and what never to attach.

### Part B: windmill block-out and sail guide for C17c (after the #325 block-out merges)

Added to `tools/building-guides.mjs` and `families.json` as a **windmill** guide kind (it uses the block-out change's per-family guides),
written to **`assets/source/buildings-v2/guides/`**:

- `windmill-r0.png`, 1024 x 1024, footprint t1 (centre (512, 832), scale 8): a round tower of truncated cone (base radius 0.30 tile, top
  radius 0.20, 52 block-out px from the ground to the cap, the t1 scale), a cone cap, a **windshaft stub pointing along
  tile +y (the lower-left face; on screen down-left at slope 0.5)**, about 0.38 tile long, ending at the hub; a door on the +y face at ground
  level (width 0.12 tile, height 14 px = 0.27 of the tower: a 2.1 m door on an 8 m tower; the first picture drew it 2.5 m, which is why the
  demo shrank it to 0.9). Light and greys as the other block-outs. Camera exactly `project()`: the foot ellipse has minor over
  major 0.50, not 0.31.
- `windmill-r0-hub.json`: the hub in canvas px and in game px from the anchor (starting from #461's hub.json (-12.25, -25.70), re-derived for
  the guide), the shaft's screen direction, the door's centre, and the **exact affine** of the face-on cross into the camera:
  screen = s * [[0.7071, 0], [0.3536, 0.866]] * (u right, v down) (the plane of tile x and the vertical; ellipse 0.612 minor over major). It
  replaces the empirical `sailAffine` of the first delivery.
- `windmill-sails-face.png`, 1254 x 1254 (the square C17b used), hub at (626.5, 626.5), the plate radius about 80 px, **arms at 45 degrees as
  the accepted cross**, reach 0.46 of the side: the guide of the sail cross seen face on along the shaft, grey. C17b's cross (reach 0.461,
  quarter-turn 0.997, all checks pass, review of 10-17) is already face on along the shaft, so Core's recommendation is to **reuse it** and
  paint only the body in C17c; this guide is the fallback if the new body shows the old cross wrong in size or timber colour.
- `tools/building-check.mjs` treats the windmill as a round family (outline-only rule flagged in `families.json`), so its camera test is no longer
  the false positive of 10.8 degrees that the first body produced; a test pins both.
- Test: the guide's foot ellipse ratio is 0.50 +-0.02; the stub's projected direction slope is 0.50 +-0.03 on the lower left; the hub JSON agrees
  with the drawn stub end within 1 px; the affine applied to the square's corners reproduces the 0.612 ellipse.

### Acceptance criteria
- [ ] Part A merged to develop (`assets/source/people-v3-guides/`, tool, test, README); Core tells Codex the folder.
- [ ] Part B merged to develop (the three windmill files, the check change, the test); Core tells Codex the paths.
- [ ] Both folders are readable from `origin/develop` with `git show` (no art branch needed); sizes under 6 MB together.
- [ ] typecheck, lint, test, format:check pass; `scratchpad/art-sheets.mjs` shows no frame count or anchor moved.

### Out of scope
Painting (Codex), packing the delivered pictures (follow-up Art tasks recorded in #461, #331, #325: pack the windmill body by its hub box into
`structures/windmill` and `_lv2`..`_lv4`, the sail cross as a square `structures/windmill_sails`; pack the people atlas at resolution 4 with keys
`people/<profession>_<front|back>_<walk|carry>_f0..f3`; pack the coaling stage).
