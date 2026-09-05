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
