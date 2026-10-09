# terepasztal

Isometric train logistics game. Vite + TypeScript + PixiJS v8 in the browser. `README.md` explains
the game; this file is what every agent, of any tool, must know before changing it. It is the
single source for global rules, project context, architecture constraints and conventions.
`CLAUDE.md` imports it and adds only what is specific to Claude Code.

## How work is organised

The project is run like a product team in which agents hold the roles. Nine roles, each defined in
`.claude/agents/<role>.md` (the frontmatter is Claude Code's; the body is plain instructions any
agent can follow):

| Role         | Owns                                                                      | Does                                                                                     |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Core         | process, instructions, `CORE.md`, `.github`, repository hygiene           | turns a request into tasks, delegates, gates, merges into `develop`, audits              |
| Engine       | `src/engine`, `src/main.ts`, `src/game.ts`, `src/intent.ts`, build config | loop, camera, input, iso math, atlas loader, audio, RNG, the integration hub             |
| World        | `src/world`                                                               | map generation, tiles, regions, elevation, levels, track graph and geometry, pathfinding |
| Gameplay     | `src/sim`, `src/data`, `src/gacha`                                        | simulation, trains and traffic, economy, content, tuning, save format                    |
| Rendering    | `src/render`                                                              | world, trains, overview and effects renderers                                            |
| UI/UX        | `src/ui`, `src/editor`, `src/strings.ts`, `index.html`                    | panels, screens, editor, every player-facing string                                      |
| Art          | `src/art`, art tools, `assets`, `public/assets`, art direction            | sprite generators, the asset pipeline, atlases                                           |
| QA           | nothing; read-only                                                        | reviews each change against its issue and these rules                                    |
| Verification | `src/testing`, write access to every test file                            | deterministic tests for the math and logic                                               |

- `tools/agents/ownership.json` maps every tracked path to exactly one role; CI fails a pull
  request into `develop` that changes a path outside its role (`node tools/agents/scope.mjs`).
  Gate files (these rules, `.claude`, `.codex`, `.mcp.json`, `.github`, `tools/agents`, dependency
  and tool configs, map generation goldens) change only with the author's own `gate:approved`
  label; no agent sets it.
- `docs/process/lifecycle.md` is the order of work, the gates and the branch model: `main` is
  released, `develop` is where work is integrated and validated, and every task is its own
  `<role>/<issue>-<slug>` branch in its own worktree. Core merges into `develop`; only the author
  merges into `main`.
- `docs/process/context.md` is what each agent is given and hands back. Read your own role file,
  your task brief and what that file's table gives your role; a domain role does not read other
  roles' files or other tasks.
- Work is tracked as GitHub issues. Nothing an agent reports is accepted on its word: QA and CI
  check it, and a failure that persists becomes an issue with its log and acceptance criteria.
- When anything is unclear or contradicts this file, a spec or an earlier decision, ask the author
  before acting, with the options and a recommendation. Do not resolve it by guessing.
- Agents never push to `main` or `develop` and never merge into `main`. The author's own work may
  go straight to `develop`; an agent working with the author's account still opens a pull request.
  `.githooks/pre-push` refuses an agent's push to either branch (the session hooks turn it on with
  `git config core.hooksPath .githooks`), and Claude Code's settings deny it too.

## Commands

```
npm run dev        # http://localhost:5173
npm test           # vitest, once (npm run test:watch to stay in it)
npm run typecheck  # tsc over src, then tsconfig.node.json over the build configs and tools/*.ts
npm run lint       # eslint over src, tools and the build configs
npm run build      # typecheck + production bundle
npm run format     # prettier over src, tools, the docs and the agent files (format:check to check)
node tools/agents/scope.mjs check --role <role>   # changed paths stay in the role's scope
```

CI runs typecheck, lint, tests, build and `npm run format:check` on every pull request and on
pushes to `develop` and `main`, plus the scope check on pull requests into `develop`. Run them before
pushing; the formatting gate in particular fails on code that was never formatted.

The dev server carries the running game across its own reloads (`src/engine/devsession.ts`), so an
edit lands where the player was standing rather than costing them the world. It snapshots to
`sessionStorage` in play mode only, never touches the real save, and is stripped from production
builds. `docs/live-loop.md` describes the loop it belongs to.

## Layout

- `src/engine` loop, camera, input, iso math, atlas pipeline, audio, seeded RNG
- `src/main.ts` boot; `src/intent.ts` the boot intents (new, play, edit, continue, menu)
- `src/game.ts` the integration hub: wires every domain, runs the tick order, holds hotkeys and the
  save snapshot. Every domain meets here, so keep changes to it small and wiring-only
- `src/world` map generation, tiles, regions, track graph and geometry, pathfinding, levels
- `src/sim` the simulation: clock, economy, stations, buildings, power, trains, fleet, traffic
  control, towns, contracts, build rules, save format
- `src/gacha` crafting and banners
- `src/render` world, overview, trains, effects
- `src/ui` DOM overlay screens and panels; `src/editor` the level editor
- `src/strings.ts` every player-facing string
- `src/art` procedural placeholder sprite generators, by atlas group
- `src/data` all content as JSON, loaded through `content.ts`
- `src/testing` shared helpers for deterministic tests
- `tools` node-side build tooling (the atlas packer, the art tools); `tools/agents` the ownership
  map and scope check; `tools/asset-pipeline` the Python photo -> 3D -> sprite pipeline (ComfyUI,
  Blender), with its own `AGENTS.md`

## Rules that bite

**No runtime dependencies beyond PixiJS.** Everything else is a devDependency. Sprites are
generated procedurally in `src/art`, sound effects synthesized in `src/engine/synth.ts`. Adding a
runtime dependency is a decision to raise with the author, not a detail.

**Art direction lives in `docs/art-direction/README.md`.** The generators follow it: the palette
seeds in `src/art/palette.ts`, one upper-left light, broad colour clusters rather than per-pixel
noise, selective contours (`PixelBuf.outline` darkens lower and side rims only) and ground
shadows that touch each object's base. Semantic colours stay brighter than any scenery colour.
Changing a generator means re-running `scratchpad/art-sheets.mjs` and checking frame counts and
anchors did not move.

**Music is files, effects are synthesized.** Music is the playlist in `src/engine/musicPlaylist.ts`
(`public/assets/audio/music/*.mp3`): Pastoral Pulse plays first, then the variations in shuffled
rounds. A track that fails is skipped, and the synth loop takes over only when every file has
failed. Volume sliders live in both menus and the settings screen and travel with the settings,
not the save.

**A new save format version needs a migration step.** Bumping `SAVE_VERSION` in `src/sim/save.ts`
means adding an entry to `MIGRATIONS` with `from` set to the version before it, and adding any new
top-level field to `KNOWN_SAVE_KEYS`. `src/sim/save.test.ts` fails if a version has no step. Each
step only knows the shape it upgrades from, and only ever fills in defaults — it never assumes a
field a later version introduced. Unknown fields are carried through untouched, on purpose.

**Changing map generation invalidates every existing seed.** `src/world/mapgen.test.ts` holds
golden hashes of the terrain, biome and variant planes. A failure there is a question, not a
number to update: re-bless it only when the change to generation was the point, and only with the
author's agreement.

**Atlas frame keys are global and their prefix is not always the group.** A group is a file pair
(`public/assets/<group>.png` + `.json`) that overrides `src/art`'s generator for that group. The
keys inside carry their own prefix: the `wagons` group supplies keys named `rolling/wagon_*`.
The contract is `{ frames: { "<name>": { x, y, w, h, ax, ay } }, partial?, resolution? }` with
`ax`/`ay` the anchor in pixels from the frame's top-left; `"partial": true` layers the file over
the generator instead of replacing it, and `resolution` (1 to 8) is texels per world pixel
(`src/engine/atlas.ts`). `tools/pack-atlas.mjs` writes it; `docs/mcp-setup.md` section 6 has the
camera, facing and anchor rules for producing the frames in Blender.

**User-facing text lives in `src/strings.ts`.** The game is in English only, for now. Strings are
kept flat so a translation table can mirror them later. Do not hardcode a string in a panel or in
the simulation. The one exception is tuning: each rule's English label, group and hint live in
`RULE_META` in `src/sim/rules.ts`, next to its range.

**Content is data.** Locomotives, wagons, cargo, stations, contracts, decor, buildings, crafting
and gacha are JSON in `src/data`, and the in-client content editor can override any table from
localStorage. `content.ts` applies overrides once at module load, so content changes take effect on
the next page load. Entries marked `supply: "full"` and the `*_full.json` files belong to the Full
production chain, picked when a game starts.

**Tuning is `src/sim/rules.ts`.** Anything a player can drag in Game tuning lives there with its
label, range and hint, and travels with the save. `forestDensity` is a moisture threshold despite
the name — lower means more forest, which is what its slider says.

**Large artifacts stay in the repository.** Report generated images and other large outputs by
path with a short text summary; never paste images, base64 or long logs into a report. Keep tool
output bounded. When resuming from an earlier session's history, extract its text only, never its
images or attachments.

## Geometry

2:1 isometric, base tile 64x32 px (`src/engine/iso.ts`: `TILE_W`, `TILE_H`, `ELEV_PX = 10`).
One step along +tx is half a tile right and a quarter tile down.

Rolling stock is drawn at `FACINGS = 48` headings, 7.5° apart, but only `DRAWN_FACINGS` (25 of
them) have sprites: the renderer mirrors a drawn facing to cover its partner, and
`residualRotation` turns the sprite the rest of the way, at `ROTATION_SHARE` of the remainder.
Bodies are rigid and never change length (`src/sim/body.ts`). These constants are a contract
between Gameplay, Rendering and Art: changing one changes atlas frame counts.

Track classes derive their geometry from `n` (`CLASS_N`: regular 2, high speed 2, narrow 1): curve
radius `n - 0.5`, curve and switch footprint `n x n`. Cost is a multiplier on the piece's base
cost: regular 1, high speed `n x 1.5`, narrow 0.6 (`classCostMul`). Regular and high speed join only
through a transition piece; narrow is another gauge and joins only narrow (a mixed crossing lets a
narrow line cross a wide one without joining it).

## Tests

`src/**/*.test.ts` and `tools/**/*.test.mjs`, run under Node with no DOM. Anything that touches
the DOM, a canvas or a WebGL context at import time needs a browser; `pixi.js` itself imports under
Node and its `Matrix`, `Container`, `Sprite` and `Graphics` construct there, but an `Application`,
a renderer or `Text` does not. Simulation modules that import
`src/engine/audio.ts` are tested with it mocked (`src/sim/expansion.test.ts` shows the fixture).
Tests stay on what runs headless: save migrations, geometry, the track graph, traffic sections,
map generation, RNG, the build rules.

Test the invariant, not the current output. The registry test in `save.test.ts` is the model: it
fails when someone adds a version and forgets the step, which is the actual failure mode. The
standard for deterministic tests is `docs/process/verification.md`; the ownership test in
`tools/agents/ownership.test.mjs` follows the same idea for the organisation itself.

## Conventions

- TypeScript strict, ESM, Prettier (`singleQuote`, `printWidth` 100, trailing commas). Match the
  surrounding code's naming, comment density and idiom.
- Commit subjects are `Area: outcome` in plain words (`Pathfinding: ties break toward the
straight leg`); one logical change per commit.
- Docs say what is true now. A doc that no longer matches the code is a bug in the doc.
