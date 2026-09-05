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

**Stubbed**
- Overview stations/trains/contracts sources are empty until milestones 2-4.
- Reputation tiers never unlock regions yet.
- Spawn-contract debug button is a no-op.

**Known bugs**
- Water animation is a simple two-frame flip.
- Very large zoom-out on small windows can show the map edge beyond the clamp margin.

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

**Stubbed**
- Stations produce cargo into storage but nothing collects it yet (milestone 3).
- No signal/water-tower decor placement, although sprites exist.

**Known bugs**
- Replacing a piece with a different one charges the full price minus the refund without a confirmation.
- Station adjacency is not re-checked when the last neighbouring track is removed (panel shows a warning only).

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

**Stubbed**
- No collision or block signalling: trains pass through each other.
- Delivery events are emitted but contracts do not exist yet (milestone 4).
- Save/load of trains is drafted (`toJSON`/`fromJSON`) but not wired.

**Known bugs**
- A recalled train's cargo is lost.
- Loco facing after loading `fromJSON` is forward until the next dispatch.

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

**Stubbed**
- Cargo delivered without a contract still pays half the base price (simple spot market).
- Station panel does not list contracts touching that station.

**Known bugs**
- Contract labels overlap when stations sit within a couple of tiles of each other in the overview.

## 5. Gacha + roster

**Works**
- Seeded gacha (`src/gacha/gacha.ts`, rates in `src/data/gacha.json`): N/R/SR/SSR at 60/30/8/2 %, hard SSR pity at 50 (counter shown), 10x pull guarantees at least one R, two banners (the second is tier-gated). Tickets only; no purchases.
- Pool: 11 locomotives and 12 wagons with name, era flavour, rarity and stats. Duplicates become upgrade points that level the item (+8 % stats per level, cap 5).
- Rolling Stock Works screen (`G`): banner list with pool preview and rates, 1x / 10x pulls, card-flip reveal sequence (click to skip a card), SSR pulse, new/duplicate/level-up badges, collect.
- Roster screen (`V`): filter by kind and rarity, unassigned only, sort by rarity/name/level/newest; cards show stats at current level, duplicate progress and which train uses the item.
- Pulled items appear in the depot immediately for assembly.

**Stubbed**
- No item art on the cards (text only); sprites are shown once the item is on a train.
- Banner rotation is static.

**Known bugs**
- If the pool has no item of a rolled rarity the picker falls back to any pool item.

## 6. Polish

**Works**
- Day/night: multiply-blended tint follows the clock (warm dusk/dawn, blue night); toggle in settings.
- Station lanterns and locomotive headlamps glow additively at night (procedural dithered glow sprites in the `fx` atlas).
- Steam locomotives emit rising, fading smoke puffs while moving (toggle in settings).
- Sound hooks (`src/engine/audio.ts`): named events (`ui.click`, `build.place`, `train.whistle`, `contract.done`, `gacha.ssr`, ...) fire throughout; a file at `/public/assets/audio/<event>.ogg` plays automatically, otherwise the call is a no-op. Volume sliders in settings.
- Save/load: versioned `SaveGame` (v1) in localStorage with track, stations, trains (position + consist + cargo), contracts, inventory, gacha state (incl. RNG), economy, clock and camera. Autosave every real minute and on unload; manual save, load, new game with optional seed, export/import as text. Booting resumes the save automatically (`#seed=...&new` forces a fresh map).
- Settings screen: audio, edge scrolling, autosave, day/night, smoke, FPS counter, control reference.
- Vignette overlay, hidden toolbar in the overview, FPS readout in the top bar.

**Stubbed**
- No audio assets and no music player; only the hook layer.
- Weather, seasons and per-tile lighting are out of scope.

**Known bugs**
- Trains restored from a save lose their reversed flag until the next dispatch, so a pushed consist may briefly render the locomotive facing the wrong way.
- The multiply tint also darkens the DOM canvas background but not the HTML UI, which stays fully lit by design.
