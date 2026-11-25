# Ages and Upgrading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six ages with one building level per age, upgrades that take game time and close the building while they run (the depot's is instant), and a halo over whatever was upgraded.

**Architecture:** The rules live in small pure modules with unit tests: `src/sim/levels.ts` (the level a building may reach in an age) and `src/sim/upgrade.ts` (a work under way: target level, time left). Stations, works and houses each carry an optional work and ask it whether they are closed; `Builder` starts works, advances them once per tick and reports the ones that finish. The halo is a timeline function with tests (`src/render/haloTimeline.ts`) drawn by a thin Pixi layer. Panels and the hover text read the same state.

**Tech Stack:** TypeScript, Vitest, PixiJS (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-10-04-ages-and-upgrading-design.md`

## Global Constraints

- No runtime dependencies beyond PixiJS. No new picture files: the halo is drawn by code.
- Ages in order: steam, diesel, electric, nuclear, magnetic, hyper. Goals: nuclear 1 substation under power; magnetic 150,000 earned; hyper 500,000 earned (the user asked for goals that can be walked through quickly; they are data).
- A new age changes nothing but the level cap of buildings: contracts, crafting, banners and a level's starting land read the age through `railAge()`, which stops at electric.
- Level cap: `age - first age + 1`, at most 6. In the Steam age nothing can be upgraded. Editor mode ignores the cap, as today. Bridges keep four levels.
- Upgrade times to level 2..6: 6, 9, 12, 18, 24 game hours, times `rules.upgradeTimeMul` (0 makes every upgrade instant). The depot's upgrade is always instant and free.
- A closed building makes nothing, takes nothing in and has no crew to feed. Trains still stop at a closed station and may load what it holds.
- Saves: version 14 with a migration step; older saves load as they are and keep their levels.
- Every string the player reads is in `src/strings.ts`.
- Run typecheck, lint, tests, build and CI's prettier scope before every push. The effect and the panels are shown from the running game on a review page before the branch is offered for merging.

## Review Focus

- A game saved in the middle of an upgrade loads with the same time left and finishes (Task 3 test `carries a work under way through a save`).
- A building removed while it is being upgraded is gone for good: no level-up later, no halo (Task 3 test `forgets the work of a building that was removed`).
- The clock paused or fast: the work follows game time, not real time (Task 3 test `follows game time`).
- An old save or a level file with a building above the age's cap keeps its level and cannot be upgraded until its age comes (Task 2 test `keeps a level above the cap and offers no upgrade`).
- A train at a closed station: loading works, a delivery waits. No test drives a train through a station stop today, so Task 3 tests the station's side (`gives out what it holds and takes nothing in`) and Task 6 shows a train at a closed station in the running game.

---

### Task 1: Six ages

**Files:** Modify `src/data/ages.json`, `src/sim/ages.ts`, `src/strings.ts` (`AGE_NAMES`, `AGE_ORDER`, `STR.ages.name`, `STR.editor.startTier`), `src/sim/contracts.ts` (`generate`), `src/game.ts` (`startFresh`), `src/sim/economy.ts` (comment). Test: `src/sim/ages.test.ts` (new).

**Interfaces (Produces):**

- `ages.json`: six entries. `nuclear: [{ kind: 'substations', target: 1 }]`, `magnetic: [{ kind: 'earned', target: 150000 }]`, `hyper: [{ kind: 'earned', target: 500000 }]`.
- `export const RAIL_AGES = 3` and `export function railAge(tier: number): number` in `ages.ts`: the age as trains, contracts and land see it (`Math.min(tier, RAIL_AGES - 1)`).
- `AGE_NAMES`: `nuclear: 'Nuclear Age'`, `magnetic: 'Magnetic Age'`, `hyper: 'Hyper Age'`.

- [ ] **Step 1: Failing tests** `src/sim/ages.test.ts`:
  - `has six ages in order`: ids are steam, diesel, electric, nuclear, magnetic, hyper; `LAST_AGE` is 5; every id has a name in `STR.ages.name` and `ageLabel`.
  - `walks through the new ages as their goals are met`: an `Economy` at electric with one powered substation enters nuclear; with 150,000 earned, magnetic; with 500,000, hyper; five tickets for each.
  - `keeps trains, contracts and land at the electric age`: `railAge(0..5)` is 0, 1, 2, 2, 2, 2; a `ContractBoard` with a fixed seed offers the same amount and payout at age 5 as at age 2.
- [ ] **Step 2: Run** `npx vitest run src/sim/ages.test.ts`. Expected: FAIL (three ages, no `railAge`).
- [ ] **Step 3: Implement.** Data and names; `contracts.generate` reads `railAge(this.economy.tier)`; `startFresh` calls `regions.applyTier(railAge(start.tier))`; the editor's start-age hint lists six ages.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS (`expansion.test.ts` still finds electric at index 2).
- [ ] **Step 5: Commit** `Ages: nuclear, magnetic and hyper follow electric`.

### Task 2: One level per age

**Files:** Create `src/sim/levels.ts`, `src/sim/levels.test.ts`. Modify `src/data/stations.json` (six values per table; `maxLevelByTier` goes), `src/data/houses.json` (six capacities, five costs), `src/data/content.ts` (types, `validateContent`), `src/sim/stations.ts` (`MAX_LEVEL`, `fromLevel`, `spriteLevel`), `src/sim/buildings.ts`, `src/sim/bridges.ts`, `src/sim/houses.ts`, `src/sim/build.ts` (`canUpgrade`, `canUpgradeBuilding`, `upgradeBuilding`), `src/ui/stationPanel.ts`, `src/ui/buildingPanel.ts`, `src/ui/decorPanel.ts`, `src/strings.ts`.

**Interfaces (Produces):**

- `levels.ts`: `export const MAX_LEVEL = 6`; `export function levelCap(firstAge: number, age: number): number` (1..6); `export function ageOfLevel(firstAge: number, level: number): number`.
- `Station`: `MAX_LEVEL` re-exported from `levels.ts`; `get firstAge()` (`def.tier ?? 0`).
- `buildings.ts`: `worksMaxLevel(b: Building): number` (bridges 4, works `MAX_LEVEL`); `buildingLevel` clamps to it; `buildingFrame` uses today's pictures up to their highest (`_lv4`).
- `Builder.canUpgrade(s: Station): PlacementCheck` and new `Builder.canUpgradeBuilding(b: Building): PlacementCheck`: `ok`, `cost`, and for a level the age does not allow `reason: STR.build.levelOpens(level, ageName)`.
- `HouseRegistry.canUpgrade(h)` gains the same cap (a house's first age is 0).
- `STR.build.levelOpens(level: number, age: string)`: `Level 3 opens in the Electric Age`.

- [ ] **Step 1: Failing tests** `src/sim/levels.test.ts`:
  - `gives one level per age from the age a building appears in`: `levelCap(0, 0..5)` is 1..6; `levelCap(1, 1..5)` is 1..5; `levelCap(2, 5)` is 4; never under 1 or over 6.
  - `offers no upgrade in the Steam age`: a farm at level 1 in age 0: `canUpgrade` is not ok and its reason names the Diesel Age; in age 1 it is ok; at level 2 in age 1 the reason names the Electric Age.
  - `caps works and houses the same way`: a windmill, a refinery (first age 1) and a house.
  - `keeps a level above the cap and offers no upgrade`: a station at level 3 in age 0 stays level 3, produces as level 3, and cannot be upgraded.
  - `leaves the editor free and bridges at four levels`.
  - `has six values in every table`: capacity 60..750, load rate, trains at once, production, crew, cost multiplier; `validateContent(DEFAULT_CONTENT)` is empty; a windmill at level 6 makes 15 food; houses hold 20..800.
- [ ] **Step 2: Run** `npx vitest run src/sim/levels.test.ts`. Expected: FAIL (no module, five values).
- [ ] **Step 3: Implement.** Tables from the spec's section 2. `spriteByLevel` becomes `[1, 2, 3, 4, 5, 5]` and house and works frames stop at their highest picture, until sub-project 4 brings the new ones. The panels read `canUpgrade` for the button's state and reason; the literal `5` in `stationPanel.ts` goes.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS after updating tests that pinned five levels or an upgrade in the Steam age (`expansion.test.ts`: the windmill and house cases run in an age that allows their level).
- [ ] **Step 5: Commit** `Levels: one per age, six in all, for stations, works and houses`.

### Task 3: An upgrade takes time and closes the building

**Files:** Create `src/sim/upgrade.ts`, `src/sim/upgrade.test.ts`. Modify `src/sim/rules.ts` (`upgradeTimeMul`), `src/sim/stations.ts`, `src/sim/buildings.ts`, `src/sim/houses.ts`, `src/sim/build.ts`, `src/sim/power.ts`, `src/sim/catenary.ts`, `src/sim/save.ts` (version 14), `src/game.ts` (`update`, `snapshot`, `applySave`), `src/sim/save.test.ts`.

**Interfaces (Produces):**

- `upgrade.ts`:
  - `export interface Work { to: number; left: number; total: number }` (game seconds).
  - `export const UPGRADE_HOURS = [6, 9, 12, 18, 24]` (to level 2..6).
  - `export function upgradeSeconds(toLevel: number): number` (hours of a game day, times `rules.upgradeTimeMul`).
  - `export function startWork(toLevel: number): Work | null` (null when the time is 0: do it at once).
  - `export function advanceWork(w: Work, gameDt: number): boolean` (true when it is done).
  - `export function workProgress(w: Work): number` (0..1) and `hoursLeft(w: Work): number`.
- `Station.work: Work | null`, `get closed()`; `Building.work?: Work`; `House.work?: Work`.
- `Builder.upgradeStation(s)`, `Builder.upgradeBuilding(b)`, `HouseRegistry.upgrade(h)`: pay, then start the work, or finish at once for a depot, in the editor, or when the time is 0.
- `Builder.tickWorks(gameDt: number): void` and `HouseRegistry.tickWorks(gameDt: number): void`, called from `Game.update` with the game time passed.
- `Builder.onUpgraded: ((e: Upgraded) => void) | null`, with `export interface Upgraded { kind: 'station' | 'works' | 'house'; x: number; y: number; w: number; h: number; name: string; level: number }`; `HouseRegistry.onUpgraded` the same.
- `StationJSON.work?: Work`; the works tuple gains a sixth element `work?: Work`; `HouseJSON.work?: Work`.
- `STR.build.upgradingNow`: `Already being upgraded`.

**Rules:**

- A closed station: `tick` makes nothing; `crew` is 0; `accepts()` is false; `room` is 0 and `store()` puts nothing in; `take()` and `hasFreePlatform()` work as always.
- A closed works: `tickBuildings` skips its recipe (`reason: 'upgrading'`, `active: false`); it is left out of `crewTotal`, of `plantCount`, of the power grid and of the wire it feeds; `onBuildingChanged` fires when the work starts and ends so power is rebuilt.
- A closed house: no new residents; the ones it has stay.
- No second upgrade while one runs (`reason: STR.build.upgradingNow`).
- When a work is done the level rises by one, `onStationChanged` / `onBuildingChanged` / the house's `onChanged` fire, then `onUpgraded`.

- [ ] **Step 1: Failing tests** `src/sim/upgrade.test.ts`:
  - `takes 6, 9, 12, 18 and 24 game hours`; `is instant when the rules say so` (`upgradeTimeMul = 0`).
  - `raises the level when the time is up, not before`: a farm in age 1; after half the time level 1 and closed; after the rest level 2, open, `onUpgraded` once with its tile, size and name.
  - `follows game time`: nothing happens over a tick of 0 seconds; three ticks of a third each finish it.
  - `closes a station while it is upgraded`: no production, crew 0.
  - `gives out what it holds and takes nothing in`: `take` works, `hasFreePlatform()` is true, `accepts` is false for a cargo it normally accepts, a warehouse's `room` is 0 and `store` returns 0.
  - `closes a works`: inputs untouched, nothing made, `reason` is `'upgrading'`, no crew, a power plant not counted, a substation's wire dead; all back when the work is done.
  - `keeps a house's people and lets nobody in`.
  - `upgrades the depot at once and for nothing`.
  - `starts no second upgrade while one runs`; `changes nothing when the upgrade cannot be paid for`.
  - `forgets the work of a building that was removed`.
  - `carries a work under way through a save`: station, works and house, through `toJSON` / `fromJSON` and the tuples; `save.test.ts` gets its step for version 14.
- [ ] **Step 2: Run** `npx vitest run src/sim/upgrade.test.ts src/sim/save.test.ts`. Expected: FAIL (no module, version 13).
- [ ] **Step 3: Implement**, in this order: `upgrade.ts` and the rule; the station; works with power and wire; houses; `Builder.tickWorks` and the callbacks; the save.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS after updating tests that expected an instant upgrade (`expansion.test.ts`: the house case sets `upgradeTimeMul = 0` or ticks the work through).
- [ ] **Step 5: Commit** `Upgrades take game time and close the building; the depot's is instant`.

### Task 4: The halo and the chime

**Files:** Create `src/render/haloTimeline.ts`, `src/render/haloTimeline.test.ts`, `src/render/halo.ts`. Modify `src/art/fx.ts` (frames `fx/halo_ring`, `fx/halo_beam`, `fx/spark`), `src/engine/audio.ts` and `src/engine/synth.ts` (`'upgrade.done'`), `src/sim/build.ts` (`onReclassed`), `src/strings.ts` (`STR.upgrade.done`), `src/game.ts` (wiring), `src/art/fx.test.ts` if it lists frames.

**Interfaces (Produces):**

- `haloTimeline.ts`: `export const HALO_SECONDS = 1.6`; `export function haloAt(t: number): HaloFrame`, with `HaloFrame { ring: { rise: number; scale: number; alpha: number }; beam: { height: number; alpha: number }; sparks: { x: number; y: number; alpha: number }[]; done: boolean }` (`rise` and `height` in shares of the building's height, `x` and `y` in shares of its width).
- `halo.ts`: `class Halos { constructor(atlas, layer, surface); spawn(x: number, y: number, w: number, h: number, size: 'building' | 'piece'): void; update(dt: number): void }`, additive sprites in `world.overlay`, real time.
- `Builder.onReclassed: ((tiles: { x: number; y: number }[], target: WideClass) => void) | null`, fired by `reclassTrack` with the anchors it relaid.
- `STR.upgrade.done(name: string, level: number)`: `Farm is now level 3`.

- [ ] **Step 1: Failing tests** `src/render/haloTimeline.test.ts`: nothing shows at 0 and after 1.6 s (`done`); the ring starts on the ground and only rises; its light peaks in the first half and is gone at the end; the beam is brightest when the ring is half way up; every spark starts inside the footprint and ends above where it started; the same `t` gives the same frame. In `src/sim/reclass.test.ts`: an upgrade reports the pieces it relaid, a downgrade reports them with its target, a stroke that changes nothing reports nothing.
- [ ] **Step 2: Run** `npx vitest run src/render/haloTimeline.test.ts src/sim/reclass.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the timeline, the three frames, the layer, the sound, and the wiring: `builder.onUpgraded` and `houses.onUpgraded` spawn a building halo, play `upgrade.done` and post `STR.upgrade.done(name, level)`; `builder.onReclassed` spawns a small halo on each piece of an upgrade (none for a downgrade), at most twelve in one frame.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `Halo: a golden ring, a beam and a chime when something is upgraded`.

### Task 5: What the player sees

**Files:** Create `src/render/workBars.ts`. Modify `src/ui/stationPanel.ts`, `src/ui/buildingPanel.ts`, `src/ui/decorPanel.ts`, `src/game.ts` (`updateRtsTooltip`, `render`), `src/strings.ts`, `src/strings.test.ts`, `src/ui/style.css` (the bar, if the house's is not reused).

**Interfaces (Produces):**

- `STR.upgrade`: `button(level: number, cost: string, hours: number)` (`Upgrade to level 3 · 60 wood, 40 stone · 9 h`; without the time when it is instant), `running(level: number, hours: number)` (`Upgrading to level 3 · 4 h left`), `closed: 'Closed while it is upgraded'`.
- `workBars.ts`: `class WorkBars { constructor(layer, surface); sync(works: { x: number; y: number; w: number; h: number; progress: number }[]): void }`: one small bar over each building being upgraded.
- `Builder.works(): { x; y; w; h; progress }[]` and `HouseRegistry.works()` for the layer.

- [ ] **Step 1: Failing tests** `src/strings.test.ts`: the three texts above, with and without a time, hours rounded up to the next whole hour and never `0 h left` while a work runs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The three panels show the button with cost and time, the reason when the age does not allow the level, and the bar with the time left while a work runs (they already redraw twice a second). The hover text says a building is closed. The bars are drawn each frame from `works()`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `Panels: an upgrade shows its cost, its time and its progress`.

### Task 6: Proof

- [ ] **Step 1:** In the running game, with the debug age button and resources set: upgrade a farm (the bar, the closed line, then the halo), a works, a house and the depot (instant, halo at once); let a train call at a closed station; upgrade track with a stroke (the shimmer). Stills and a film of each under `scratchpad/` and on a review page (`G:\DEV\Terepasztal\renders\ages-upgrading\`).
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test && npm run build` and `npx prettier --check --end-of-line auto "src/**/*.{ts,json,css}" index.html`. Expected: all pass.
- [ ] **Step 3:** Commit and push `buildings/ages-upgrading`; publish the review page; ask before merging.
