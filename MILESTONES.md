# Milestones

## 1. Iso map + camera

**Works**

- 96x96 seeded map (mulberry32 + value-noise fbm): grass, forest, hills, water, rock, sand. Seed via `#seed=...` in the URL or the debug panel.
- Procedural placeholder atlas generated at startup (`src/art/*`): dithered 64x32 diamond tiles, raised hill blocks with cliff faces, round/pine trees, boulders, bushes, cursor/ghost diamonds. Nearest-neighbour textures.
- Asset pipeline (`src/engine/atlas.ts`): each atlas group tries `/assets/<group>.json` + `.png` first, falls back to the generator. Frame names are the contract.
- RTS camera: WASD/arrows, middle-drag, edge scrolling, wheel zoom 0.5x-2x in steps, clamped to map bounds.
- Chunked ground layer with per-chunk culling; depth-sorted object layer keyed on (tileX + tileY).
- Diamond minimap (terrain, viewport rectangle, click/drag to navigate).
- Strategic overview: flat schematic of the whole map, locked regions dimmed with tier labels; Tab / zoom-out-past-0.5x enters, Tab / Esc / scroll-in / click leaves; ~300 ms crossfade + scale.
- Debug panel (backtick): FPS, seed, entity counts, zoom, camera, hovered tile, money/ticket cheats, depth-sort tint overlay, regenerate with a new seed.
- HUD top bar with clock (1 day = 4 real minutes) and speed controls (Space pauses, 1/2/3 keys).

**Fixed in the post-merge pass**

- Overview sources, region unlocks and the spawn-contract button were completed by milestones 2-4.
- Water now cycles through four ripple frames (`terrain/water_<v>_f0..3`).
- An 8-tile ring of "void" sea tiles surrounds the map (`WorldRenderer.BORDER`), fading into the background, so zooming out never shows a hard map edge.

## 2. Track + stations

**Works**

- Track pieces: straight (2 rot), curve (4), switch (8: two mirror families), crossing, bridge (water only). `R` rotates, ghost preview tinted cyan/red with the reason in the toolbar status line, terrain cost multipliers (forest clearing, hill cutting), 50 % refund on removal.
- Drag-laying straights and bridges along the dominant axis with per-tile ghosts and a running cost.
- Right-click / Delete removes track or a station; right-click with nothing under the cursor cancels the tool; Esc cancels / deselects.
- Track graph (`src/world/track.ts`): per-tile link lists, `exits(x, y, entry)` for pathfinding, `connected()` for edge checks. Track on a hill flattens it ("cut"); trees are cleared.
- Stations from `src/data/stations.json` (7 types, tier-gated), placed on a tile touching track. Levels 1-5 scale capacity, loading rate, platforms and production; level thresholds unlock extra produced cargo; sprite changes at levels 3 and 5. Level cap follows the age (since v0.8.0; the reputation tier before).
- Station panel: stats, storage bars, upgrade with cost, rename, demolish. Hover tooltip in the field view and in the overview.
- Overview now draws track as lines and stations as labelled nodes; minimap marks track and stations.
- Economy class with tier ladder; tier-ups reveal regions (fog, overview, minimap all rebuild) and grant tickets. (Replaced by ages in v0.8.0, see milestone 13.)

**Fixed in the post-merge pass**

- Decor tools (`src/data/decor.json`): signals stand on track tiles, rotate with `R` to pick the tile they guard and show red while a train sits on it; water towers speed up loading at stations within two tiles (+25 %, two towers stack). Removing track removes its signal; decor refunds 50 %.
- Replacing a piece shows an amber ghost and a "Replace <kind>: net $x" status line before the click.
- Removing a station's last platform tile raises a bobbing warning marker over it and a toast; restoring track clears it. Orphaned stations are excluded from contract generation and route building.

## 3. Trains

**Works**

- Rolling stock defined in `src/data/locomotives.json` / `wagons.json` (rarity, era flavour, stats). Starter inventory: Old Puffer + Plank Boxcar + Wooden Hopper.
- Procedural rolling-stock atlas: steam and diesel bodies in 8 facings and 4 paints, four wagon bodies, tintable cargo overlays (heap / crates / logs) coloured per cargo type.
- Depot screen (`F` or the top-bar button): pick a free locomotive, tick wagons (max per loco, weight meter vs pulling power), name the train, build a looped route from stations with platforms, dispatch. Existing trains: locate, edit route, recall (items return to the inventory).
- Pathfinding: Dijkstra over (tile, entry-edge) states so switches and curves are respected and trains never reverse mid-tile. Diverging switch legs cost extra.
- Movement: fixed-timestep sim, render interpolation, acceleration/deceleration, stop at the platform tile centre, curve slowdown (0.55x), bridge (0.8x) and hill (0.85x) factors, heavy consists crawl. Running cost per tile deducted.
- Cars follow a recorded trail behind the head; at dead ends the consist reverses and the locomotive pushes.
- Stations: trains wait for a free platform, unload accepted cargo (base price paid, delivery event emitted for contracts), load produced cargo only if some later stop accepts it, then depart after a minimum dwell.
- Track edits invalidate paths: trains re-route or become stranded if their tile was removed; recall from the depot.
- Overview shows trains as heading arrows with tooltips; minimap marks trains.

**Fixed in the post-merge pass**

- Train separation: each tick the fleet rebuilds a tile occupancy map; a train scans 2.5 tiles of its path ahead and brakes to hold 0.45 tiles short of any tile under another train (tiles under its own cars are ignored so overlapping trains can separate). Trains stuck 25 s try a path around occupied tiles; head-on meetings resolve after 4 s by letting the lower-numbered train squeeze through; anything still stuck after 60 s squeezes past. Depot and overview show "Held behind a train".
- New trains spawn on a free platform tile when one exists.
- Recalling a train salvages its cargo at 40 % of base price (toast shows the amount).
- Saves store the car trail and the reversed flag, so restored trains keep their exact car positions and pushing direction.
- Contracts and save/load were completed by milestones 4 and 6.

## 4. Contracts + economy + time

**Works**

- Contract templates in `src/data/contracts.json` (local haul, bulk, rush, grand charter, standing supply) gated by reputation tier; amounts, payouts and reputation scale with tier and distance.
- Board keeps ~5 offers refreshed every 0.2 in-game days from valid (producer, acceptor, cargo) station pairs; offers expire. Accepting starts the deadline clock (base + per-tile + per-unit time).
- Delivery matching: a train unloading cargo at the destination that was loaded at the contract's origin credits the earliest-deadline matching contract. Completion pays money, reputation and tickets; a missed deadline costs 60 % of the reputation reward and nothing else (no game over).
- Contract Board screen (`C` / top-bar button): offers with accept/decline, active with progress and time left, recent history and totals.
- Always-visible side list with countdowns, progress bars and a red urgent state below 25 % time; click the title to open the board.
- Overview draws active contracts as arrows with a deadline ring and label; trains as arrows.
- Time: pause / 1x / 2x / 3x (buttons, Space, 1-2-3). One day = 4 real minutes at 1x. A daily +1 ticket is granted when at least one contract was delivered the previous day. Tier-ups grant tickets and chart new regions.
- Debug: spawn contract now forces an offer.

**Fixed in the post-merge pass**

- Spot market: cargo unloaded without a matching contract is paid at the destination's current price, which falls with recent deliveries of that cargo (satiety) and recovers over about a day, and rises with haul distance. The station panel lists prices and demand bars per accepted cargo. Contract-credited units are paid by the contract only.
- Station panel lists active contracts that start or end at the station with progress and time left.
- Overview labels (stations and contracts) are pushed apart so they never overlap.

## 5. Gacha + roster

**Works**

- Seeded gacha (`src/gacha/gacha.ts`, rates in `src/data/gacha.json`): N/R/SR/SSR at 60/30/8/2 %, hard SSR pity at 50 (counter shown), 10x pull guarantees at least one R, two banners (the second is tier-gated). Tickets only; no purchases.
- Pool: 11 locomotives and 12 wagons with name, era flavour, rarity and stats. Duplicates become upgrade points that level the item (+8 % stats per level, cap 5).
- Rolling Stock Works screen (`G`): banner list with pool preview and rates, 1x / 10x pulls, card-flip reveal sequence (click to skip a card), SSR pulse, new/duplicate/level-up badges, collect.
- Roster screen (`V`): filter by kind and rarity, unassigned only, sort by rarity/name/level/newest; cards show stats at current level, duplicate progress and which train uses the item.
- Pulled items appear in the depot immediately for assembly.

**Fixed in the post-merge pass**

- Item art everywhere: reveal cards, roster cards and depot rows show the locomotive or wagon sprite cropped from the atlas (`src/ui/spritePreview.ts`).
- Featured rotation: every 3 in-game days each banner features one SSR and two SR items (seeded by banner and rotation index); featured items take 50 % of their rarity's rolls. The banner screen shows the featured set and the days until it rotates; revealed cards carry a "featured" badge.
- A rolled rarity the pool cannot supply now downgrades to the nearest rarity the pool has, and the reveal reports the real rarity. `validateBanners()` warns at startup about any pool missing a rarity.

## 6. Polish

**Works**

- Day/night: multiply-blended tint follows the clock (warm dusk/dawn, blue night); toggle in settings.
- Station lanterns and locomotive headlamps glow additively at night (procedural dithered glow sprites in the `fx` atlas).
- Steam locomotives emit rising, fading smoke puffs while moving (toggle in settings).
- Sound hooks (`src/engine/audio.ts`): named events (`ui.click`, `build.place`, `train.whistle`, `contract.done`, `gacha.ssr`, ...) fire throughout; a file at `/public/assets/audio/<event>.ogg` plays automatically, otherwise the call is a no-op. Volume sliders in settings.
- Save/load: versioned `SaveGame` (v1) in localStorage with track, stations, trains (position + consist + cargo), contracts, inventory, gacha state (incl. RNG), economy, clock and camera. Autosave every real minute and on unload; manual save, load, new game with optional seed, export/import as text. Booting resumes the save automatically (`#seed=...&new` forces a fresh map).
- Settings screen: audio, edge scrolling, autosave, day/night, smoke, FPS counter, control reference.
- Vignette overlay, hidden toolbar in the overview, FPS readout in the top bar.

**Fixed in the post-merge pass**

- Audio is generated at runtime (`src/engine/synth.ts`): every sound event has a Web Audio design (clicks, thuds, whistles, bells, chimes, fanfare) and a generative ambient loop (drone plus wandering pentatonic melody) plays at the music volume. An `.ogg` in `/public/assets/audio/` still overrides any event. The context unlocks on the first click or key.
- Weather (`src/sim/weather.ts`): seeded clear / rain / fog spells; rain draws screen-space streaks and darkens the tint, fog drifts patches over the world with a haze, both slow trains slightly. Seasons of 6 days each tint the ground and props (spring, summer, autumn, winter) and scale production (farms +35 % in autumn, half in winter). The top bar shows season and weather; a settings toggle disables all of it.
- Per-tile lighting: additive light diamonds on the tiles around stations and in front of locomotives at night, on top of the lantern glows.
- The night tint is now a world-space polygon covering the map and its void ring, so nothing outside the world is tinted; the HTML UI stays lit on purpose.
- Restored trains keep their reversed flag (see milestone 3).
- Save format v2 (`decor`, `weather`); v1 saves migrate on load.

**Known limitations**

- Rain and fog particles are purely visual; there is no per-tile weather.
- The music loop is procedural and simple by design; no composed tracks ship.

## Review pass (adversarial, 7 lenses, 3 verifiers per finding)

26 confirmed findings fixed after the fix pass, among them: a reroute that could leave a moving train with no path and crash the simulation; trains snapping backwards when a consist reversed (paths now re-anchor on the new head); hold counters carried across states; seasonal production not applied to stations built mid-season; orphan markers and hill cuts left behind by demolished stations and towers; the season tint not refreshing when the weather toggle changes; top-bar overflow at 1280 px and an empty cell with weather off; fog drifting over the page background (now clipped to the world); a water animation that snapped every fourth frame (now periodic); a station panel that did not scroll; a replacement status that advertised a negative price; sounds dropped between the first click and the audio context resuming; the featured rate-up that was really 65-77 % (now exactly 50 %) and stale featured panels across rotations; a Collect button that vanished within half a second; duplicate text on max-level items; the settings importer refusing v1 saves; and stale audio copy in Settings and the README.

## 7. Menus, tuning, content editor, level editor

**Works**

- Main menu on boot over the paused world: Continue (when a save exists), New game with an optional seed, Game tuning, Content editor, Settings, and a Levels column (play / edit / delete, new blank or generated level in 32-128 tiles, import from JSON). Pause menu on Esc or the Menu button: resume, save, settings, tuning, content, main menu, and "Back to editor" while play-testing.
- Boot intents (`src/intent.ts`): menus store what the next load should do in sessionStorage and reload; the world behind the main menu is the last save.
- Game tuning (`src/sim/rules.ts`, `src/ui/tuningScreen.ts`): 27 live rules with sliders (start funds/tickets/reputation, build cost and refund, running cost, spot price, contract payout/reputation/penalty/deadline/offer count/refresh, train speed, loading, production, capacity, day length, season length, rain and fog chance, map size and terrain levels) plus the tier ladder. Read at use time, persisted in localStorage and stored inside every save; map values apply to the next generated map.
- Content editor (`src/data/content.ts`, `src/ui/contentScreen.ts`): every data table (locomotives, wagons, cargo, stations and their level table, contract templates and config, decor, gacha config and banners, track config) is editable in-client with generated forms, duplicate/remove/add, validation (ids, cargo references, banner pools, starters, rates), export/import of the whole bundle, "Reset to shipped data", and "Apply and reload". Overrides live in localStorage and are applied once at module load.
- Level editor (`src/editor/editor.ts`, `src/ui/editorPanel.ts`): free building of any track, station (any level, tier ignored), decor; terrain brush (six terrains, three sizes, drag to paint, props regenerate, buildings on painted tiles are cleared); fill and regenerate; level name, description and player start block (funds, tickets, reputation, tier); save, save as, export/import JSON, play test (starts a new game from the level and offers "Back to editor"), exit. Levels persist in localStorage (`terepasztal.levels`); terrain is stored as packed bytes.
- Save format v3: stores the world spec (generated parameters or the whole level) and the rules; v1/v2 saves migrate.

**Known limitations**

- Content changes need a reload (the editor does it); a save that references removed content items may fail to load.
- Levels do not ship pre-placed trains or contracts.
- Terrain painting under existing track removes the track rather than re-laying it.

## 8. Resource economy, fuel, real locomotives, power

**Works**

- Start: one Stephenson's Rocket and three wagons (water cart, hopper, flatbed); the depot assembles up to four locomotives and sixteen wagons per train, with a haul meter (hauled tonnes vs. combined engine power).
- Resources (`src/sim/stockpile.ts`): water, wheat, stone, wood (basic) plus coal, oil, iron. A global stockpile fed only by deliveries to a **Warehouse**; every piece of track, station, decor and building costs resources instead of money. The second top-bar row shows every resource, the crew count and wheat upkeep; the stockpile cap grows with warehouse levels.
- Upkeep: every station, building and locomotive has a crew; crews eat wheat per day (`wheatPerCrew`). Running out starts a famine: production halves and trains slow to 70 % until wheat returns.
- Processing buildings (`src/data/buildings.json`, `src/sim/buildings.ts`): Charcoal Kiln (2 wood → 1 coal), Stone Grinder (10 stone → 1 iron), Oil Refinery (3 coal + 2 water → 1 oil, tier 1), Power Plant (1 coal or 1 oil + 1 wood + 1 water → 1 power, tier 1). Recipes run continuously against the stockpile; the toolbar "Works" group places them.
- Oil: made by the refinery (Fischer-Tropsch style coal-to-liquid, so coal plus water is the only feedstock) or bought on the **Market** (M), which trades every resource for money at a 1.6× buy / 0.6× sell spread.
- Fuel (`src/sim/trains.ts`): steam engines carry coal (or wood at half value; the train screen picks the preference) and water and burn both per tile; diesels burn oil; electrics draw power from the stockpile and only run on powered tiles. Tanks refill at a Warehouse, near a Coaling Stage (fuel) or Water Tower (water), and at Water Pumps; each stop in the schedule can opt out of refuelling. A train out of fuel/water stops with `No fuel`; an electric on a dead tile shows `No power`; emergency refuel from the train screen costs double.
- Weight: locomotive and wagon tare plus cargo weight per unit (`cargo.json`) must not exceed the combined engine power in tonnes; loading stops at the limit and an overweight train refuses to depart.
- Schedules (`StopPlan`): per stop load (auto/none), unload (all/none), wait for full wagons, refuel, depart direction (auto/forward/reverse) and pass-through. Trains run automatically; the train screen (Depot → Details) shows tanks, per-tile use, range, weight, wagons, loop statistics (distance, consumed, refuelled, gathered, delivered, income) for the last and the current loop.
- Roster: 26 real locomotives ordered by rarity across three banners: Age of Steam (Rocket, Adler, John Bull, MÁV 375, The General, Jupiter, MÁV 424, PRR K4s, DRG 01, Flying Scotsman, SP Daylight, Mallard, Big Boy), Diesel Era (SW1, Class 08, M62, F7, SD40, Deltic, DDA40X) and Electric Line (Kandó V40, V63, Ce 6/8 Crocodile, Taurus, Re 460, GG1). Wagons come in three classes: tankers (water, oil), hoppers (coal, stone, iron) and flats (wood, wheat).
- Power (`src/sim/power.ts`): **Power Line** poles are decor that can stand on track or any buildable tile; poles within two tiles connect, a network with a Power Plant is live and electrifies every tile within one tile of a node. The overview tints powered tiles.
- Art: eight locomotive bodies (early steam, standard, streamlined, switcher, cab unit, hood unit, box electric, crocodile) in the paints the roster uses; station families (farm, lumber yard, quarry, water pump, town, warehouse) with three growth stages; the four works buildings; coaling stage and power pole; resource icons.
- Save format v4 (stockpile, buildings); levels store buildings and a starting-stock multiplier; the editor and content editor cover buildings.

**Known limitations**

- Power is stored as a global battery rather than routed per network; any live network draws from the same pool.
- Wagons of the wrong class never load at a station that only produces another class; the depot shows what each wagon carries.

## 9. Chunks, automatic routes, side panels, floating indicators

**Works**

- Chunk purchase (`src/world/regions.ts`): the map is a grid of chunks; the player owns the centre one and buys neighbours from the overview (click an Uncharted chunk, confirm). Prices start at `chunkCost` and multiply by `chunkCostMul` per ring from the start. Owning a chunk reveals its neighbours as Uncharted; chunks further out stay hidden (void in the field view, black in the overview). The overview fits the revealed area. Reputation tiers no longer chart land; they gate rolling stock and works.
- Every basic resource terrain (water, forest, hill, grass) is guaranteed inside the starting chunk (`ensureStartResources`).
- Automatic routes: dispatching a train needs only a consist; the route defaults to every station with platform track in nearest-neighbour order. A custom route can still be picked in the depot; the live schedule (stops, load/unload, wait for full, refuel, departure direction, pass) is edited in the train details screen and applies at once.
- Unloading anywhere feeds the stockpile: contract cargo is credited at its destination first, everything else goes to the pool at whichever station the train unloads. Warehouses only raise the stockpile cap (`warehouseCap`, 1000 per level) and refuel.
- Train side panel (`src/ui/trainSide.ts`): lists the trains on screen in the field view and every train in the overview, with top speed, crew, weight vs power, tanks, use per tile, a coal/wood switch for steam engines, wagon capacities and per-week estimates (consumed, collected, delivered) from the last completed loop. Hovering a card traces the train's current path (cyan), next leg (amber) and the one after (white) on the track and in the overview.
- Building panel and tooltip (`src/ui/buildingPanel.ts`): recipe, current and full rate, status (running / waiting for input / stockpile full), batch progress, crew, lifetime output and the output's stockpile level. Click a works building to open it.
- Floating indicators (`src/render/floaters.ts`): green "+n" with the resource icon rises from a station when goods enter the stockpile; red "-n" descends when a train refuels from it.
- Toolbar (`src/ui/toolbar.ts`): category row (Track, Stations, Decor, Works, Remove; Terrain in the editor) and an item row with icon, name and cost. Number keys 1-9 and the mouse wheel step through the open category; Esc closes it. Hovering or selecting an item fills the info card above the survey map (preview, cost with icons, description).
- Power lines draw as sagging wires between connected poles and plants (`src/render/powerLines.ts`); live wires carry small cyan sparks.
- Cheat button in the top bar: +$10,000 and every resource to its cap. The pause control is a large play/pause icon (Space toggles); the game starts paused.
- Save format v5 stores owned chunks.

**Known limitations**

- Weekly estimates come from the last loop only; a short first loop can over- or under-state them until the next loop completes.
- Chunk price depends on ring distance only, not on terrain.

## 10. v0.5.0 — traffic, biomes, people, notices

From this version on the per-version record lives in `CHANGELOG.md` (versions ↔ pull requests ↔ commits). Highlights: trains pull aside for oncoming traffic instead of phasing through, economy mode on low tanks, half top-ups at every stop; 9×9 chunk world with lazily built ground and diagonal reveal; six biomes with effects, rivers, islands and biome vegetation; walkers that wear paths into roads, crossings, passengers and coaches; notices with map markers and an advisor; reworked top bar, resource cards, train panel, toolbar groups and station/works art.

**Known limitations**

- Two trains on a single track with no loop or siding cannot pass; the notice and advisor point at it.
- Passenger boarding walkers are decorative; the fare is paid on alighting regardless of how many appear.
- Roads never wear back to grass.

## 11. v0.6.0 — depots, warehouses as stores, towns, route modes

See `CHANGELOG.md`. Highlights: the Depot (two-by-two, four gates, one per nine owned chunks) is the only way into the stockpile and the place trains roll out of; warehouses hold goods locally; Collect routing sweeps producers and warehouses into the nearest depot with a fuel reserve rule; towns found themselves around a town station with a townhouse and a warehouse, get names, colours and a panel; trains can be picked in the field view.

**Known limitations**

- The two gate rows of a depot are separate stubs; connect both or trains only use one side.
- A town's reach is a fixed seven-tile square around its station; overlapping reaches go to the nearer station.

## 12. v0.7.0 — traffic control, statistics, routing groups

See `CHANGELOG.md`. Highlights: section claims keep single track to one train at a time, holders keep it, followers may enter behind; waiting trains park off the holder's path, idle trains make room or drive to a free platform; stuck detection, deadlock reports and a traffic report; Static Schedule with dwell options and the Dynamic Production / Collection / Transport modes.

**Known limitations**

- A single line with no siding or loop between two busy platforms still queues trains; the notice and the traffic report point at it.
- Sections are claimed whole, so a very long stretch between switches admits one train per direction at a time.

## 13. v0.8.0 — ages, production chains

Reputation is gone. The game moves through three **ages** (`src/data/ages.json`, `src/sim/ages.ts`): Steam from the start, Diesel once three depots stand and the population reaches 1000, Electric once $250,000 has been earned in total (`economy.earned`, fed by `earn`). Goals are checked once per in-game hour; an age-up toasts, posts a notice, refreshes the toolbar and grants five tickets. `economy.tier` stays as the age index and still gates works, stations, decor, station levels (`maxLevelByTier` is now three entries), contract templates (`minTier`) and gacha banners. The top bar shows the age; hovering it lists every age's goals with progress bars. Tuning lost the reputation and tier-ladder entries; the level start block carries the start age and the production chain.

**Production chains** (`src/sim/supply.ts`, chosen on New game, `SaveGame.supply`, format v9): _Simple_ keeps the kiln / grinder / refinery chain from the stockpile, diesels burn oil and warehouses top up fuel from the stockpile. _Full_ appends a second data set (`cargo_full.json`, `stations_full.json`, `buildings_full.json`, every entry `supply: "full"`, hidden from the toolbar, resource bar and market otherwise): coal seams and oil seeps are map props placed at generation (`coal` on hills, `oil` on sand and wet grass) and gate the Colliery (wood → 3 coal) and Oil Derrick (→ crude); Iron Mine (rock → iron ore) and Ironworks (ore + coal → 2 iron); Refinery (crude → diesel), which diesel engines burn (`Train.oilKind`); Sand Pit on sand and one sand per 200 tiles run by any train; Copper Mine and Wire Mill (copper ore + coal → wire). Warehouses refuel only from their own store. Fuel prices (oil, diesel, crude) drift ±40 % on a seeded daily random walk (`TradeDesk.fuelMul`), shown as a trend column in the market.

**Known limitations**

- Deposits are placed by hash, so a start chunk can have few or no seeps; the market sells crude and diesel meanwhile.
- The full-chain stations reuse the quarry art; the power plant still burns oil as its alternative fuel in both chains.
