# Track lines and train classes: implementation plan

Spec: `G:\DEV\Terepasztal\specs\track-classes.md` (agreed 2026-10-25). Status: **approved by the
author on 2026-10-28**, with the recommended answer to every question below (Q3: no cap on Main and
Trunk; Q4: hard locks; Q5: the listed multipliers). Q7 (K4s and GG1) had no recommendation and is
asked again before step 3.

## Where the code stands (develop @ 1586dc42)

- `TrackClass = 'regular' | 'high_speed' | 'narrow'`, `CLASS_N = { regular: 2, high_speed: 2, narrow: 1 }`
  (`src/world/track.ts:21-32`). Curve radius `n - 0.5`, footprint `n x n`.
- Geometry and art are already generic in `n`: `unitDef` (`src/world/trackGeom.ts:101`) builds any
  `n x n` curve or switch (both forms), and `generateIllustratedTrackAtlas`
  (`src/art/trackIllustrated.ts:571`) draws every member it gets. 3x3, 4x4 and 5x5 cost no new math.
- Joining: `classesJoin` allows like with like; a `transition` piece joins regular and high speed;
  narrow joins only narrow (`track.ts:174`). `TrackGraph.connected` and `findPath` refuse a joint
  that does not join.
- Train access: `consistAccess` (`src/sim/compat.ts:125`) measures every model on a reference curve
  of each class and adds a gauge rule; `Train.canUse` / `tollOf` feed `findPath`
  (`src/sim/trains.ts:1019-1048`).
- High speed today: needs in-cab signalling, route cost x3 for non-`highSpeed` engines, a money
  charge per tile (`rules.hsAccessCharge`), no line-speed cap (`src/sim/lineSpeed.ts`).
- Traffic priority: none by class. `Traffic.assign` orders claims by recovery, waiting time, yields,
  weight, id (`src/sim/traffic.ts:283-290`); jams back off by `fleet.ts:997-1026`.
- Upgrade tool: `planReclass` (`src/world/reclass.ts`) swaps regular and high speed only; it works
  because both are 2x2, so it never has to resize a curve. Narrow is refused.
- Depots: `StationDef.gauge` (`regular` / `narrow`); the narrow depot has its own cap.
- Save: track tuples `[x, y, kind, rot, cls?, cls2?]`, `SAVE_VERSION = 20` (`src/sim/save.ts`).
- Class names are hard-coded in: `trackIllustrated.ts` STYLE / level crossings / transition art,
  `render/levelCrossing.ts` `CROSSABLE`, `ui/trackGroups.ts`, `ui/toolbar.ts`, `ui/keymap.ts`,
  `strings.ts` (`trackClass`, `trackDesc`, compat and fleet texts), `sim/roads.ts`,
  `sim/startDepot.ts`, `sim/step.ts`, `engine/loadRepair.ts`, `game.ts`, the editor and levels.
- Related open issues: #299 track planner (drag a path into the class's curves), #313 the drag tool,
  #305 three-way switch, #366 bridge width per track, #367 gauge tests.

## Model

- `TrackClass = 'narrow' | 'branch' | 'main' | 'trunk' | 'maglev' | 'hyperloop'`, one table
  `LINES[cls] = { n, network, tier, costMul, age }`. `network` is `standard` (branch, main, trunk;
  tiers 1, 2, 3), `narrow`, `maglev` or `hyperloop`. Hyperloop has `n = 0`: straights only.
- Joining: two pieces join when they are on the same network. Branch, Main and Trunk join directly
  at any edge (Q1); different networks never join.
- Vehicle class: an explicit `class` field on every locomotive and wagon
  (`corvette | frigate | destroyer | cruiser | carrier | hydrofoil | submarine`), filled from the spec
  table. A test checks that each vehicle really fits the curve of its class's line (the existing
  measurement in `compat.ts`), so the data cannot claim a fit the geometry refuses.
- Train class = the biggest class in the consist. A consist mixing networks is refused (replaces
  today's "mixed gauge").
- Access: on the standard network a class runs on its own line's tier and above; on a separate
  network only its own class. Carrier counts as tier 3 (Trunk) with its own badge.
- `Gauge` disappears; depots carry a network (standard / narrow, later maglev / hyperloop).

## Steps (one pull request each)

1. **Lines replace classes (cross-scope: world, sim, ui, art, render, strings).** The new
   `TrackClass` and `LINES` table; `regular` becomes `branch`. High speed and the transition piece go
   (Q2): no in-cab gate, no x3 toll, no per-tile charge. Save migration v21: `regular` and
   `high_speed` become `branch`, transitions become straights. Only Narrow and Branch are buildable
   yet; behaviour of both is unchanged. Tests: joins, migration, footprints, compat by network.
   Review page: the toolbar and an old save loaded.
2. **Main and Trunk Line pieces (world + art).** Straight, 3x3 / 4x4 curve, switch (both hands, turn
   and S forms), crossings between any two standard lines, buffer stop. Procedural placeholder
   look per spec (Main: concrete sleepers, wide clean shoulder; Trunk: heavier dark rail, wide
   sleepers, dark basalt ballast). Codex paints the final art later. Golden frames updated.
   Review page: every piece rendered from the game, a train through each curve and switch.
3. **Vehicle classes (gameplay + data).** `class` on every loco and wagon from the spec table,
   access by class, train class = biggest, depot by network, fit test. Vehicle sheets say
   "Class: Destroyer, runs on Main and Trunk Line". Review: depot screen and a save with trains of
   each class.
4. **Priority and pathfinding (gameplay).** A smaller train on a bigger line pays extra route cost
   per tier step (`rules.smallOnBigLine`, Q6); at a contested switch exit or single-track section
   the train whose class needs that line is served first, ahead of today's order. Tests in the
   traffic suite. Review: a save where a Frigate gives way to a Cruiser.
5. **Cost, speed and unlocks (gameplay).** Cost multipliers per line (Q5), line-speed caps per line
   (Q3), each line unlocked in its spec age (Q4). Tuning in `rules.ts`.
6. **Upgrade tool for all standard lines (world + gameplay + ui).** Drag to raise or lower a stretch
   by one line. Straights and crossings change in place; a curve or switch that does not fit at
   the new size is shown red and left as it is (Q9). Pricing by difference, downgrade free as
   today.
7. **Toolbar and badges (ui + art).** One toolbar group per line; the badge (colour plus 1-3 bars,
   or the icon of a separate network) on the track pieces, the engines, the wagons and the train
   panels. Strings for every name in English.
8. **Maglev Guideway (separate network, later).** 5x5 curves and switches, its own crossings, a
   maglev depot, the Hydrofoil class for the Transrapid set the loco session built. Unlocked in the
   Magnetic age.
9. **Hyperloop Tube (separate network, later; needs its own short spec first).** Straight tubes on
   their own layer (elevated or underground, so they cross anything), end stations and stations on
   the straight, shuttle running, transfer stations to rail. Submarine pods. Hyper age.

Steps 1 to 3 are the base and go in order. 4, 5, 6 and 7 can then run in parallel. #299 / #313 (the
drag planner) build on step 2 and give the upgrade tool its "re-lay the curve bigger" later.

Every step: typecheck, lint, test, build, format:check; game renders on a review page before it is
locked in; pull request into `develop`, merged only when the author asks; Core sets `scope:cross`.

## Open questions for the author

1. Branch, Main and Trunk join directly at any edge, and the transition piece goes. (Recommended.)
2. Old high-speed track becomes Branch Line (same 2x2 curves), and the high-speed rules go
   (in-cab requirement, x3 route cost, per-tile charge). (Recommended.)
3. Line-speed caps: Narrow 1.2, Branch 2.0, Main and Trunk none: bigger curves are already faster.
   Or a cap for Main too?
4. Unlocks by age as in the spec: Narrow and Branch from Steam, Main from Diesel, Trunk from Electric,
   Maglev from Magnetic, Hyperloop from Hyper. Hard locks?
5. Cost: Narrow 0.6, Branch 1, Main 1.5, Trunk 2.5, Maglev 4, Hyperloop 4?
6. A smaller train on a bigger line: route cost +25 % per tier step; at a contested section the
   train that needs the line goes first. OK?
7. K4s and GG1: measured, 3x3 is enough (Destroyer); the spec keeps them Cruiser. Which?
8. Separate worlds cross only by bridge or underpass. Today a narrow line may cross a wide one on
   the level, and rail-over-rail bridges do not exist (bridges only span water). Keep the narrow x
   Branch level crossing until such bridges exist? (Recommended: keep it; maglev and hyperloop never
   cross on the level.)
9. Upgrade tool: a curve that is too small for the new line stays and shows red (first version), and
   automatic re-laying comes with the drag planner (#299)? (Recommended.)
