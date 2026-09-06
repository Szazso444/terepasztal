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
- Stations from `src/data/stations.json` (7 types, tier-gated), placed on a tile touching track. Levels 1-5 scale capacity, loading rate, platforms and production; level thresholds unlock extra produced cargo; sprite changes at levels 3 and 5. Level cap follows the reputation tier.
- Station panel: stats, storage bars, upgrade with cost, rename, demolish. Hover tooltip in the field view and in the overview.
- Overview now draws track as lines and stations as labelled nodes; minimap marks track and stations.
- Economy class with tier ladder; tier-ups reveal regions (fog, overview, minimap all rebuild) and grant tickets.

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
