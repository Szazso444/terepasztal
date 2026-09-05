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
