# terepasztal

Isometric train logistics game. Vite + TypeScript + PixiJS v8 in the browser. `README.md` explains
the game; this file is what to know before changing it.

## Commands

```
npm run dev        # http://localhost:5173
npm test           # vitest, once (npm run test:watch to stay in it)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src
npm run build      # typecheck + production bundle
npm run format     # prettier over src and index.html
```

CI runs typecheck, lint, tests, build and `prettier --check` on every pull request. Run them before
pushing; the formatting gate in particular fails on code that was never formatted.

The dev server carries the running game across its own reloads (`src/engine/devsession.ts`), so an
edit lands where the player was standing rather than costing them the world. It snapshots to
`sessionStorage` in play mode only, never touches the real save, and is stripped from production
builds. `docs/live-loop.md` describes the loop it belongs to.

## Layout

- `src/engine` loop, camera, input, iso math, atlas pipeline, audio, seeded RNG
- `src/world` map generation, tiles, regions, track graph and geometry, pathfinding, levels
- `src/sim` the simulation: clock, economy, stations, buildings, power, trains, fleet, traffic
  control, towns, contracts, build rules, save format
- `src/render` world, overview, trains, effects
- `src/ui` DOM overlay screens and panels
- `src/art` procedural placeholder sprite generators, one file per atlas group
- `src/data` all content as JSON, loaded through `content.ts`
- `tools` node-side build tooling (the atlas packer)

## Rules that bite

**No runtime dependencies beyond PixiJS.** Everything else is a devDependency. Sprites are
generated procedurally in `src/art`, audio synthesized in `src/engine/synth.ts`. Adding a runtime
dependency is a decision to raise with the author, not a detail.

**A new save format version needs a migration step.** Bumping `SAVE_VERSION` in `src/sim/save.ts`
means adding an entry to `MIGRATIONS` with `from` set to the version before it, and adding any new
top-level field to `KNOWN_SAVE_KEYS`. `src/sim/save.test.ts` fails if a version has no step. Each
step only knows the shape it upgrades from, and only ever fills in defaults — it never assumes a
field a later version introduced. Unknown fields are carried through untouched, on purpose.

**Changing map generation invalidates every existing seed.** `src/world/mapgen.test.ts` holds
golden hashes of the terrain, biome and variant planes. A failure there is a question, not a
number to update: re-bless it only when the change to generation was the point.

**Atlas frame keys are global and their prefix is not always the group.** A group is a file pair
(`public/assets/<group>.png` + `.json`) that overrides `src/art`'s generator for that group alone.
The keys inside carry their own prefix: the `wagons` group supplies keys named `rolling/wagon_*`.
The contract is `{ frames: { "<name>": { x, y, w, h, ax, ay } } }` with `ax`/`ay` the anchor in
pixels from the frame's top-left. `tools/pack-atlas.mjs` writes it; `docs/mcp-setup.md` section 6
has the camera, facing and anchor rules for producing the frames in Blender.

**User-facing text lives in `src/strings.ts`.** It is kept flat so a translation table can mirror
it. Do not hardcode a string in a panel.

**Content is data.** Locomotives, wagons, cargo, stations, contracts, decor, buildings, crafting
and gacha are JSON in `src/data`, and the in-client content editor can override any table from
localStorage. `content.ts` applies overrides once at module load, so content changes take effect on
the next page load. Entries marked `supply: "full"` and the `*_full.json` files belong to the Full
production chain, picked when a game starts.

**Tuning is `src/sim/rules.ts`.** Anything a player can drag in Game tuning lives there with its
label, range and hint, and travels with the save. `forestDensity` is a moisture threshold despite
the name — lower means more forest, which is what its slider says.

## Geometry

2:1 isometric, base tile 64x32 px (`src/engine/iso.ts`: `TILE_W`, `TILE_H`, `ELEV_PX = 10`).
One step along +tx is half a tile right and a quarter tile down.

Rolling stock is drawn at `FACINGS = 48` headings, 7.5° apart, but only `DRAWN_FACINGS` (25 of
them) have sprites: the renderer mirrors a drawn facing to cover its partner, and
`residualRotation` turns the sprite the rest of the way, at `ROTATION_SHARE` of the remainder.
Bodies are rigid and never change length (`src/sim/body.ts`).

Track classes derive everything from `n`: curve radius `n - 0.5`, curve and switch footprint
`n x n`, cost `n x 1.5` above regular. Classes only join through a transition piece.

## Tests

`src/**/*.test.ts` and `tools/**/*.test.mjs`, run under Node with no DOM. `src/sim/build.ts` and
anything that touches Pixi need a browser, so tests stay on the parts that do not: save migrations,
geometry, the track graph, traffic sections, map generation, RNG.

Test the invariant, not the current output. The registry test in `save.test.ts` is the model: it
fails when someone adds a version and forgets the step, which is the actual failure mode.
