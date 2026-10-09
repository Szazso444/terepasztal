# CORE

Core's record of the project: where it stands, what was decided, what is wrong with it and what
is proposed next. Core keeps it true (`docs/process/lifecycle.md`, step 10). Domain roles do not
read it; they get what they need through their task briefs.

Last audit: 2026-10-09, on `develop` at `cef6d11`.

## State

- **The game.** An isometric train logistics game in TypeScript and PixiJS v8, at v0.8.x by the
  changelog, with no runtime dependency besides Pixi. About 43,000 lines in `src` and 40 test
  files with 423 tests, all green. Typecheck, lint, build and formatting are clean too.
- **The organisation.** Nine roles (`AGENTS.md`). The ownership map gives every tracked path one
  owner. The scope check runs from `main`'s copy of `.github/workflows/scope.yml` and needs the
  author's own `gate:approved` for gate files. Tasks run on `<role>/<issue>-<slug>` branches into
  `develop`; the author releases `develop` into `main`.
- **The organisation reviewed itself.** QA checked the organisation's own files through four
  lenses. A skeptic then re-checked every finding: 36 held, 23 were refuted. The pull request that
  brings this file fixes all 36.
- **First delivery through the process.** #35, the seeded property runner in `src/testing`, went
  through issue, role agent in its own worktree, QA, pull request (#38) and merge. #36
  (pathfinding properties) and #37 (track geometry properties) are in progress.

## Goals

- **A performance-oriented rewrite** (Rust, or Java; for a browser game in practice Rust compiled
  to WebAssembly for the simulation core, with Pixi kept for rendering). A goal, not a task. What
  prepares it now:
  - the simulation pulled out of `src/game.ts` into a headless step (A01, A02);
  - the deterministic tests in `docs/process/verification.md`, which become the specification
    a port must pass;
  - fixed-step simulation independent of game speed (A03).
- **Measure before rewriting.** Part of today's cost does not depend on the language:
  - a full-map scan in the render loop every 0.12 s;
  - per-tick signal evaluation that is quadratic;
  - a 939 kB main bundle.

## Decisions

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-09 | Nine roles: Core, Engine, World, Gameplay, Rendering, UI/UX, Art, QA, Verification | author |
| 2026-10-09 | One short-lived branch per task, `<role>/<issue>-<slug>`, in its own worktree; agents are bound to roles, never to branches | author |
| 2026-10-09 | Core merges into `develop` after CI and QA; only the author merges into `main` | author |
| 2026-10-09 | Merged branches deleted; unmerged work kept as `archive/<branch>` tags and its branches kept until triage (#28–#34) | author |
| 2026-10-09 | Role definitions in `.claude/agents/<role>.md` with a tool-neutral body; `AGENTS.md` is the one source of global rules and `CLAUDE.md` imports it | author |
| 2026-10-09 | Audit findings go into this file first; issues only for findings the author approves | author |
| 2026-10-09 | Gate files (rules, `.claude`, `.github`, `tools/agents`, dependency and tool configs, map generation goldens) change only with the author's in-person `gate:approved` | author |
| 2026-10-09 | `src/game.ts` belongs to Engine as the integration hub | Core, from the approved role table |
| 2026-10-09 | Each domain owns its own test files; Verification may write any test file and owns `src/testing`; QA writes nothing | Core |
| 2026-10-09 | Verification adds its tests before QA reviews, so QA's verdict covers the head commit | Core |
| 2026-10-09 | Repository documents stay in English, as before | Core |

## Open questions for the author

Each one blocks the findings listed with it. The audit tables below mark them `decide`.

1. **Map expansion and region grids change generated worlds** (A08, A09). Fixing them means new
   map hashes and different worlds for existing seeds. Fix now and re-bless the goldens, or keep
   the worlds and only stop new damage?
2. **Pathfinding across a class or gauge break** (A10). `findPath` lets a route cross a joint that
   `connected()` refuses. Should it refuse, which may strand trains in existing saves?
3. **Game speed changes outcomes** (A03, A16). Sub-stepping makes 1x and 3x identical but changes
   current trajectories. Accept the change?
4. **Settings and tuning in saves** (A24, A67). Loading a save rewrites global
   tuning, and exported saves carry player settings, against `AGENTS.md`'s rule. Which is meant?
5. **Migration rule versus code** (A26). Old steps 4–7 rely on load code, and steps 11–12
   rewrite values. Loosen the rule, or move the defaults into the steps?
6. **Content overrides** (A21). Per-table diffs, or a content version that discards stale
   overrides?
7. **A UI-to-simulation command layer** (A37), and moving panel wiring out of `src/game.ts`
   (A40). Wanted?
8. **Building ages and rotations** (A46): 6 ages × 4 rotations in the art package against 3 ages
   × 2 in the game. Decided through #30 and #29.
9. **The live loop** (`docs/live-loop.md`, A50). It now says a person's live work happens on a task
   branch and reaches `develop` by pull request. Confirm, or keep a direct path for your own work?
10. **Tuning labels and the strings rule** (A69). `RULE_META` holds English labels and hints, as
    the tuning rule requires, but the strings rule says every player-facing string lives in
    `src/strings.ts`. Which rule wins for tuning labels?
11. **Repository weight** (A55). `.git` is about 830 MB, 582 tracked images, and `scratchpad/`
    holds 146 MB of evidence. Move the scratchpad evidence out, ignore future evidence images,
    adopt Git LFS, or leave it?
12. **Machine-specific tooling** (A54). `.codex/hooks.json` holds a `C:\Users\...` path, and the
    Codex hook never runs under Codex. Fix it, or keep it as your local setting?
13. **Gates beyond `src`** (A57). Lint, typecheck and formatting skip `tools/`, the configs and
    the docs. Extend them? This is a gate change.

## Audit

The audit came from nine read-only domain maps and a completeness critic. A skeptic then checked
each high and medium risk again against the code, with scratch reproductions where the claim was
about behaviour:

| Verdict | Count |
| --- | --- |
| confirmed | 47 |
| partly true, restated as it holds | 23 |
| refuted, dropped | 3 |
| merged as duplicates | 4 |

The full evidence (file:line, commands and outputs, acceptance criteria) is in
`docs/process/audit/2026-10-09-verified.json` under the IDs below. The owner is the role that
would do the fix. "decide" means the author decides first.

### Engine

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A01 | high | src/game.ts is a 2874-line hub touched by 53 of the 172 commits on main, and most feature commits also edit it. | Make engine/audio free of side effects at import, then move update()'s simulation body and startStock out into a src/sim module that game.ts calls, so feature branches stop editing the hub. | decide |
| A03 | medium | The game loop always steps at SIM_HZ=20 (0.05 s), and GameClock.advance multiplies that step by the speed, so at 3x each fleet.tick gets gdt=0.15 s. | Advance the sim in fixed 0.05 s game-time sub-steps, running clock.speed steps per loop tick instead of one scaled step, so results do not depend on game speed. | decide |
| A04 | medium | Importing src/engine/audio touches document and window, so every test that loads trains, fleet, build, houses or ui/dom at runtime must vi.mock it. | Register the window and document listeners in AudioBus and Ambience lazily (on first update or unlock, guarded by typeof window), and change recovery.test.ts:10 to `{ sfx: vi.fn() }`. | — |
| A06 | medium | main.ts sets window.game = game for every build, production included. | Declare `interface Window { game: Game }` globally, and add the three tracked scratchpad scripts (with // @ts-check) to a typechecked config that npm run typecheck covers, making the members they use public. | — |
| A24 | medium | applySave calls setRules(j.rules) with persist left at its default of true. | On load, apply the save's rules in-session only as setRules({...DEFAULT_RULES, ...j.rules}, false), and leave global tuning for the tuning screen to persist. | decide |
| A25 | medium | The save shape is built and consumed only in game.ts: startStock at 155-174, snapshot() at 986-1028 and applySave() at 1071-1141. game.ts imports pixi.js and touches document at module load, so node tests cannot import it. | Move the list of top-level save keys, or a pure buildSave(parts) function, into src/sim/save.ts so snapshot() uses it, and have save.test.ts assert every key it emits is in KNOWN_SAVE_KEYS. | — |
| A32 | medium | Depth layers are bare numbers scattered across two roles. | Export a named depth-layer table from src/engine/iso.ts and use its names in place of the literals in src/render and game.ts. | — |
| A34 | medium | Nothing enforces import direction between source areas. eslint.config.js has no no-restricted-imports or import-boundary rule, package.json has no dependency-cruiser or madge, and scope.mjs checks which paths changed, not… | Move biomeShade out of src/ui/minimap.ts into src/render or src/art, then add a no-restricted-imports rule that forbids src/{engine,world,sim,gacha,data,render} from importing ../ui or ../editor; eslint.config.js is a gate… | decide |
| A37 | medium | It is true that no command layer sits between the UI and sim. game.ts hands live Fleet, Builder, Stockpile, Economy and Train references to the panels, and the panels call their methods or write fields directly. | Ask the author whether a sim-side command module is wanted. | decide |
| A40 | medium | src/game.ts (2874 lines) is the UI composition root and holds most of the keymap, plus a few hardcoded strings. ownership.json assigns it to Engine. 'Any UI change must edit it' is overstated, since a change inside one panel… | Move panel construction and wiring, and the play keymap, into UI/UX-owned modules (e.g. src/ui/panels.ts, src/ui/keymap.ts). game.ts would call them through one narrow interface that passes the domain objects once. | decide |
| A57 | medium | The gates cover src only. | Widen the gates in one gate-approved change: tsconfig (or a tsconfig.node.json) includes the root *.config.ts and tools/*.ts, eslint gets a node-globals block for tools/**/*.mjs and is run on src and tools, and the CI prettier… | decide |
| A61 | medium | The only tick order is Game.update, and game.ts cannot be imported in Node. | Move the gdt>0 body of Game.update into a DOM-free sim step module, for example src/sim/step.ts, that takes the domain objects. | — |
| A65 | medium | World growth does span boot (main.ts:94-109), chunk purchase (game.ts:1608-1618: expandSave, writeSave, setIntentAndReload) and expand.ts. | Move the cold-load growth loop into src/sim/expand.ts as one tested function, and share one paramsFromRules and one parseSeedText helper between main.ts and game.ts. | — |
| A67 | medium | Since v8 the save carries the full settings object, volumes included (save.ts:78-79, snapshot at game.ts:1017). | Decide which settings belong to the save. | decide |
| A68 | medium | diagnostics() (game.ts:551-559) wraps the snapshot as {diagnostics, saveVersion, at, traffic, save}. 'Copy diagnostics' writes it into the same textarea that Import reads from (settingsScreen.ts:312-324). importSave… | In importSave (or parseSave), unwrap `j.save` when the parsed object has `diagnostics === 1`, before validating the seed. | — |

### World

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A08 | high | The comment in expandSave ("old tiles come back unchanged") is wrong. | Hash variant on world coordinates (x+originX, y+originY) in emptyMap, and generate over a fixed off-map margin so the passes clipped at the map edge (biome smoothing, cleanup, mountains, rivers) see the same neighbourhood… | decide |
| A09 | high | regionTierMap measures ring distance from the exact grid centre and rounds it. | Make regionTierMap use the same integer start chunk as mapgen (floor((n-1)/2)) with an integer Chebyshev distance, or restrict mapSize and editor sizes to odd chunk counts. | decide |
| A10 | medium | findPath (and walkBack) only check opensTo on the neighbour. | In findPath and walkBack, gate each step on track.connected(x, y, out) instead of track.opensTo(nx, ny, nin). | — |
| A12 | medium | src/world imports runtime state from sim and data. mapgen imports supplyMode, regions and track import rules, and track imports content, which applies localStorage overrides at module load. generateMap's props depend on the… | Pass the supply mode into generateMap, placeOilFields, ensureStartDeposits and mapFromLevel as an explicit argument from Game, not inside MapGenParams, which is persisted in saves. | decide |

### Gameplay

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A02 | high | Gameplay rules live only in Game.update and the module-private startStock() in src/game.ts, and no test covers them. | Move the gdt>0 body of Game.update and startStock() into a src/sim module with named constants, keeping the order and values unchanged, and have game.ts call it. | — |
| A20 | high | A content override that is malformed makes validateContent throw instead of returning problems. buildContent has no try/catch and runs at module load, so the whole module graph fails before boot() runs: no menu, no editor and… | In buildContent, wrap validateContent(merged) in try/catch and treat a throw as a rejected override (warn and return base), and make the per-table checks null-safe. | — |
| A21 | high | Confirmed: Apply stores the whole draft, which is a clone of every table, with no version stamp, so an accepted override hides later shipped changes to every table. | Make validateContent require every field the sim reads (contracts.rarities, all eight stations.levels arrays), and have the author choose between per-table diffs and a content-version stamp that discards stale overrides. | decide |
| A36 | high | Panels do change sim state directly. | Add the spot-trade, paid-pull and in-cab-fitting operations to sim (TradeDesk.spotBuy/spotSell with their prices, a ticket-checked pull, Inventory/Fleet.fitInCab). | — |
| A16 | medium | The mechanism is real. | Have Fleet.tick split any gdt larger than 0.05 into fixed 0.05 game-second substeps, so game speed only changes how many steps run per real step. | decide |
| A17 | medium | Train.fromJSON always sets state 'noRoute' with stateTime 10 (trains.ts:2455-2456). path, holding and blockedTime are not saved. | Save speed, state/stateTime, the station the train stands at, holding, blockedTime and yieldCount in Train.toJSON. | decide |
| A18 | medium | Two of the three points hold on this branch. docs/traffic-current.md (2026-09-11) describes the design from before recovery and signals, and its line numbers are wrong. docs/bogie-model.md:39-40 says large models are barred… | Either rewrite docs/traffic-current.md around the current traffic.ts, recovery.ts and signals.ts, or mark it historical at the top. | — |
| A22 | medium | ContractBoard.toJSON leaves out the RNG state, while Gacha, Crafting and Weather store theirs. | Add rng: this.rng.state to ContractBoard.toJSON and restore it in load when it is a number, the way Crafting.load does, leaving old saves on the reseeded stream. | decide |
| A23 | medium | reputationMul and tradeCycleDays are in Rules and DEFAULT_RULES but not in RULE_META, so sanitize resets them to their defaults on every setRules and readRules. | Either delete tradeCycleDays and reputationMul from Rules and drop the j.rules.tradeCycleDays write, or wire tradeCycleDays into TradeDesk.cycleSeconds and add it to RULE_META; the author picks which. | decide |
| A26 | medium | The no-op steps are from:4, 5, 6 and 7, not 9: the from:9 step fills crafting recipes. | Have the author decide whether the rule or the code is right. | decide |
| A27 | medium | stationDef, buildingDef, locoDef and wagonDef throw on an unknown id. | Filter unknown ids in Inventory.load the way Crafting.load does, and have applySave skip or refund stations, buildings and train vehicles whose def no longer exists, with a migration note; the author decides between dropping… | decide |
| A28 | medium | parseSave checks only that seed is a number and then migrates. importSave writes the result over the real save and reloads. | Make parseSave return null unless the required v1 fields (clock, economy, track, stations, trains, camera and lastDay) have the right types, so importSave refuses before writeSave and readSave ignores a corrupt stored save. | — |
| A31 | medium | The duplication is real. | Add one helper to src/sim/body.ts, next to DRAWN_FACINGS and mirrorFacing, that returns {facing, flip} for an angle and the bogie style index for (k, n, back), and call it from trainRenderer, previewLayers and game.ts. | — |
| A38 | medium | trainScreen.ts writes t.mode directly and skips the immediate re-plan that Fleet.create does. | Add Fleet.setMode(t, mode). | decide |
| A39 | medium | The bridge slow-down threshold, mass above 0.8 of bridge capacity, is written as a bare 0.8 in three places with no shared constant. | Export the threshold and the half-speed factor as constants from src/sim/bridges.ts. | — |
| A59 | medium | The weather eases its visible strength by real seconds, and that strength scales train vmax through speedFactor. | Base the sim's speed factor on game time: pass gdt to weather.tick (game.ts:2016), or have speedFactor ease by game seconds and keep the real-dt easing for the renderer only. | — |
| A64 | medium | PeopleSim draws every decision from Math.random (people.ts:101), including the 8% of outings that walk to a station and become 'waiting' (people.ts:261-300). | Give PeopleSim a constructor RNG parameter and have game.ts:823 pass a seeded `new Rng(this.seed ^ K)`, so `rnd` stops defaulting to Math.random. | — |
| A66 | medium | There are ten terepasztal.* storage keys in six files, not nine: six in localStorage (save, settings, slots, rules, levels, content) and four in sessionStorage (intent, testing, editorDraft, dev-reload). | Store a version number in terepasztal.rules and run the value remaps in readRules only when the stored object has no version. | decide |

### Rendering

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A29 | high | Trains stretch and squash on ramps on main and on develop, whose src/render is the same. | Bring 4ae3045's pitchShear/pitchOnRail and its slope.test.ts into develop on a rendering branch, leaving out its scratchpad/slope-pitch files, which are outside the rendering scope. | — |
| A30 | high | WorldRenderer.groundAllows returns true whenever landscape.failed is set, and game.ts wires it in as Builder.groundCheck. | Remove `this.landscape.failed \|\|` from WorldRenderer.groundAllows so the main-thread relief always decides; later, move the rule out of src/render into src/world. | decide |

### UI/UX

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A35 | high | Many player-facing English strings in src/ui, plus three in src/game.ts, skip STR. | Move these literals into STR. | — |

### Art

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A41 | high | Two tools write public/assets/structures.json and each replaces the whole file. tools/illustrated-sprites.mjs writes the 92 illustrated structures frames at resolution 4. | Make pack-atlas refuse, or merge, when the target <group>.json already holds frames or a resolution that its --src does not supply. | decide |
| A42 | high | illustrated-sprites.build() does read docs/art-direction/frame-inventory.json, and the counts are right: 2839 keys there, 3462 from today's generators, 25 removed loco_steam_early_small_yellow_* keys. | Have illustrated-sprites take its target frame list headlessly from the src/art generators (or from a generator-only dump), not from the browser-built doc snapshot. | — |
| A07 | medium | atlas.ts accepts `resolution` (1-8; above 1 it samples linear with mipmaps) and `partial`. | Update docs/mcp-setup.md 6.2 to show the contract as `{ frames, partial?, resolution? }`, and say that resolution>1 samples linear with mipmaps while pack-atlas output (resolution 1) is nearest. | — |
| A33 | medium | Both passages are out of date, but only one would mislead. phase-decisions.md:176-177 names the removed src/render/vehicleVisual.ts, and lines 181-191 describe bogie masks. | Put a line at the top of terrain-v4.md saying it is superseded by terrain-production.md and that Landscape is live, and remove '(current)' from README.md:366; | — |
| A46 | medium | The facts hold. building-kit has 6 AGES and 4 ROTATIONS keyed structures/<f>_a<age>_r<rot>. | Update art-direction README:13-15 to point at the 2026-10-02 spec as the current decision on ages and rotations. | decide |
| A47 | medium | docs/mcp-setup.md §6 is out of date with the runtime. §6.1 says public/assets 'does not exist yet' (it holds 7 groups) and lists groups without bridges. §6.2 says textures are sampled with nearest and not to upscale, but… | Rewrite mcp-setup §6.1-6.2 for today's contract (existing public/assets, bridges group, partial, resolution with linear sampling) and fix the README:3 link to scratchpad/illustrated/README.md. | — |
| A71 | medium | tools/asset-pipeline/game_rules.test.mjs imports src/sim/body and src/engine/iso (lines 5-13) and runs python3 at line 32. vitest.config.ts includes tools/**/*.test.mjs, so npm test needs a Python interpreter, and a change to… | Skip the suite with a visible warning when no Python interpreter is found outside CI, and keep it required in CI (CI runs on ubuntu-latest, which has python3). | decide |
| A72 | medium | tools/bridge-kit.mjs:179 writes src/render/bridgeKit.json with JSON.stringify(...,null,2), and ci.yml runs prettier --check on src/**/*.json. | Pass the geometry through prettier.format (already a devDependency) with the repo config before writing it, so any future shape still passes the gate. | — |

### Verification

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A14 | high | No test that CI runs checks the end-to-end no-collision / no-jam guarantee. | Port scratchpad/traffic-scenario.js into src/sim/trafficScenario.test.ts using the expansion.test.ts world fixture with audio mocked. | — |
| A11 | medium | There is no src/world/pathfinding.test.ts. findPath is called directly only in expansion.test.ts:187-191: one straight line, testing bridge-mass access. | Add src/world/pathfinding.test.ts covering route choice, reconstruction, the predicates, maxCost, walkBack and heap order. | — |
| A13 | medium | The golden map tripwire pins a single configuration: 48x48, a 2x2 chunk grid that is even and has no tier-0 chunk (see world-2), at origin 0, in simple supply mode, with props checked only by count. | Add golden cases to mapgen.test.ts: 160x160 at origin 0, 224x224 at origin -32, and 160x160 in full supply mode (setSupplyMode in before/after hooks). | — |
| A19 | medium | The facing and draw-width contract (FACINGS, DRAWN_FACINGS, DRAWN_WIDTH, mirrorFacing, residualRotation, ROTATION_SHARE) lives in src/sim/body.ts and art, render, ui and game import it. | Add a test that every rolling/*_f<N> key in a shipped public/assets/*.json atlas has N in DRAWN_FACINGS, and that each model present covers all of DRAWN_FACINGS. | — |
| A44 | medium | AGENTS.md (imported by CLAUDE.md) requires re-running scratchpad/art-sheets.mjs and checking that frame counts and anchors did not move. | Add a headless vitest that snapshots each generator group's frame keys and anchors, so counts and anchors are checked automatically. | decide |
| A45 | medium | tools/building-kit.test.mjs hard-codes 27 families and 560 pictures, but loadInventory derives both from src/data (stations, stations_full, buildings, buildings_full, decor). | Assert the invariant: family count equals the qualifying src/data entries, and pictures equals the sum of ages times 4 rotations. | — |
| A63 | medium | The test named 'lists every field of a current save as known' only checks the 13 keys of oldestSave(). | Also assert that every key of migrate(oldestSave()) and of a fully populated current-version save fixture is in KNOWN_SAVE_KEYS. | — |

### Core

| ID | Sev. | Finding | Proposed fix | Author |
| --- | --- | --- | --- | --- |
| A15 | high | trains.ts is 2460 lines and puts consist physics, routing, fuel, loading, contract jobs, retreat/recovery and save in one file, mostly inside one Train class. | Add a planning rule to lifecycle.md step 3 and the core skill: two tasks that write the same file (in practice src/sim/trains.ts or fleet.ts) are never ready together, and the later one is marked Blocked by the earlier. | — |
| A50 | high | docs/live-loop.md still contradicts the gated lifecycle: line 3 says 'no branch and no pull request', and lines 89-99 ('What replaces the pull request', 'dropping the PR cycle', 'main still gets the gate') describe a no-PR… | Rewrite live-loop.md line 3 and the 'What replaces the pull request' section to say what the note at lines 5-8 says: a person commits locally on the task branch, and the work reaches develop through a PR. | — |
| A51 | high | Most of the sprawl has been cleaned up. | Delete verification/35-property-helper now that it is merged. | decide |
| A05 | medium | On main and on origin/develop, ci.yml runs on push to main only, plus pull_request. | Merge this branch's ci.yml (push on main and develop) into develop and keep pull_request as the CI gate for agent branches. | — |
| A48 | medium | Three old art branches are unmerged and 67 commits behind main, with very large diffs from their merge base: art/rear-views-v1 (14 ahead, 1144 files), local/train-models (15 ahead, 1337 files) and locomotive-render-v1 (13… | Ask the author whether each old art branch is superseded or should be salvaged, then archive (tag and delete) the superseded ones. | decide |
| A52 | medium | The claimed tags now exist: the API returns 11 tags (10 archive/* and v0.1.0, matching .github/ref-archive.json), and the v0.1.0 branch is deleted. | Either add v0.2.0-v0.8.0 to ref-archive.json at each version's last commit as listed in the CHANGELOG, or reword README.md:26 and CHANGELOG.md:5 to say only v0.1.0 is tagged. | decide |
| A53 | medium | README.md Controls, README.md:58 and CHANGELOG.md disagree with the code. | Rewrite the README Controls table and line 58 to match the hotkeys in game.ts (K market, M overview, Tab/Shift+Tab tool, Q/E type, U/Shift+U reclass, 1-9 piece). | — |
| A54 | medium | Machine-specific paths and tooling are tracked. .codex/hooks.json:8 hardcodes 'C:\Users\Zso\terepasztal\...'. | Make .codex/hooks.json use a repo-relative command and gate the Codex hook on a Codex variable (or drop it). | decide |
| A55 | medium | The repository carries large binary history. .git is about 834 MB (an 831 MiB pack). 582 image files are tracked (403 png, 178 jpg, 1 svg; the claim said 585), with no .gitattributes and no LFS. scratchpad/ is 146 MB in 462… | Add a root `.ignore` listing scratchpad/ and assets/source/ so ripgrep-based agent search skips the evidence without moving files. | decide |
| A56 | medium | The docs overlap and supersede each other. | Make README's Layout a pointer to AGENTS.md, make MILESTONES point to CHANGELOG instead of restating it, and have the author either add current-phase-spec.md or mark the phase docs historical. | decide |
| A69 | medium | AGENTS.md:128-129 says tuning lives in rules.ts with its label, range and hint, and RULE_META (rules.ts:124 onward) holds the English label, group and hint. | Have the author choose: either RULE_META carries STR keys (labels move into strings.ts) or RULE_META is a written exception. | decide |

Merged as duplicates: A58 (= A08), A60 (= A22), A62 (= A05), A70 (= A06). Refuted and dropped: A43, A49, A73.


## Test gaps

`docs/process/verification.md` keeps the property table:

- **Covered:** save format, map generation, RNG, rigid bodies and traffic sections.
- **Open:**
  - pathfinding (#36) and track geometry (#37), in progress;
  - separation and deadlock (A14: the guarantee is checked only by browser scripts);
  - economy conservation;
  - facings;
  - the gameplay rules inside `src/game.ts` (A02).

## Branches and issues

- **Branches:**
  - `main`, `develop` and the task branches;
  - the nine unmerged branches kept for triage (#28–#34, tags `archive/*`; see
    `docs/archived-work.md`);
  - this session's `claude/optimistic-thompson-ndc4an`.
- **Waiting on the author:** triage issues #28–#34.
- **Open verification issues:** #36 and #37.

## Proposed issues

Once the author approves, Core files each confirmed finding that needs no decision as a task for
its owner, in this order:

1. **Determinism and safety nets**
   - A14: port the traffic scenario into a Node test;
   - A64: draw people's decisions from a seeded RNG (they steer dispatch);
   - A63: make the known-save-keys test check what `snapshot()` writes;
   - A28: reject malformed imports before they overwrite the save;
   - A20: catch a malformed content override at boot;
   - A04: audio import without side effects;
   - A06: type `window.game`.
2. **Structure that unblocks parallel work**
   - A02: move the gameplay rules out of `src/game.ts`;
   - A25: give the save shape one source;
   - A39: name the bridge threshold as a constant.
3. **Tests**
   - A11: pathfinding (#36);
   - A13: golden map cases;
   - A44: frame counts and anchors checked headless (only declaring Playwright needs a decision);
   - A45: building-kit counts derived from data.
4. **Docs**
   - A53: README controls, layout and changelog behind the code;
   - A18: stale traffic and bogie docs;
   - A33: stale terrain doc;
   - A07, A47: `mcp-setup.md` section 6.
