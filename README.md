# terepasztal

Isometric train logistics with a gacha roster. Vite + TypeScript + PixiJS v8, no other runtime
dependencies. Retro 2:1 isometric look with procedurally generated placeholder art.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
npm run lint
```

## Controls

| Action | Keys |
| --- | --- |
| Pan | WASD / arrows / middle-drag / edge scroll |
| Zoom | mouse wheel (0.5x-2x); zoom out past 0.5x opens the overview |
| Overview | Tab (Esc, scroll in or click a station/train to return) |
| Build | toolbar buttons, `R` rotate (track and signals), drag to lay straights, right-click / Delete remove, Esc cancel |
| Time | Space pause, `1` `2` `3` speed |
| Screens | `F` depot, `C` contracts, `G` gacha, `V` roster, `` ` `` debug |

## Layout

- `src/engine` loop, camera, input, iso math, atlas pipeline, audio hooks, RNG
- `src/world` map generation, tiles, regions, track graph, pathfinding
- `src/sim` clock, economy, stations, trains, fleet, contracts, build rules, save format
- `src/gacha` items, inventory, gacha
- `src/render` world, overview, trains, fx
- `src/ui` DOM overlay screens and panels
- `src/art` procedural placeholder generators (one file per atlas group)
- `src/data` all content as JSON

## Assets

Everything is generated at runtime: sprites by the procedural generators in `src/art`, sound
effects and the ambient loop by the Web Audio synthesizer in `src/engine/synth.ts`. Nothing is
taken from other games. Both can be overridden file by file.

## Replacing placeholder art

Each atlas group (`terrain`, `props`, `track`, `structures`, `rolling`, `fx`) is loaded from
`public/assets/<group>.png` + `public/assets/<group>.json` when present and generated procedurally
otherwise. The JSON is `{ "frames": { "<name>": { "x", "y", "w", "h", "ax", "ay" } } }` where
`ax`/`ay` is the anchor in pixels from the frame's top-left. Frame names are listed by the
generators in `src/art`.

Drop `public/assets/audio/<event>.ogg` (event names in `src/engine/audio.ts`) to replace a
synthesized sound.

See `MILESTONES.md` for progress notes and the post-merge fix pass.
