# Tunnels, Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player digs through mountains and lays track inside them, changes ground height, and maps generate tall, varied mountains.

**Architecture:** Tunnels stay ordinary pieces in the one `TrackGraph`. Two stored level planes (`generatedLevel`, `groundLevel`) replace the one-level derivation on generated maps. A new `Underground` store in `src/sim` owns dug tiles, cuttings and portals; `railProfile` and the renderers only read it.

**Tech Stack:** TypeScript, PixiJS v8, vitest. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-tunnels-design.md`

**Trial reference (throwaway, read it, do not copy its `any`):** `G:\DEV\Terepasztal\renders\tunnels\trial-src\tunnelTrial.ts` and `hooks.diff`. Named below as `trial:sculpt`, `trial:frontArt` and so on. Review page: https://claude.ai/artifact/T3BTbtA83QTM3R8aR1hUgQ

## Global Constraints

- Each task is one role's branch `<role>/<issue>-<slug>` and one pull request into `develop`; a task never changes a path outside its role (`node tools/agents/scope.mjs check --role <role>`).
- Map generation goldens change only with the author's own `gate:approved`. No agent sets it.
- Before each push: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`.
- Every player-facing string goes through `src/strings.ts`; the Hungarian text in `src/data/strings.hu.ts` is Gameplay's path.
- Prices are placeholders in `src/sim/rules.ts`, each a tuning slider: Raise and Lower `$100` per tile-level, Drill `$500` per tile, portal `$2,000`, `2` stone per dug tile, back-fill refunds half.
- Rail level inside is 0 in this step; each dug tile stores its floor so step 2 starts from saved data.
- A refusal covers the whole action: nothing moves and nothing is charged.
- Every visual ships through a review page of in-game renders before it is locked.
- The main checkout `G:\DEV\Terepasztal\terepasztal` is read-only. Worktrees go under `G:\DEV\wt`.

## Review Focus

- A map grown ring by ring next to raised ground or dug tiles: levels and portals read the same as on a map generated at the larger size.
- Removing the track or back-filling a portal while a train is inside: the train behaves as on the surface and is not left hidden.
- Raise or Lower beside a generated cliff of 4 levels: the action never makes a step over 1 that was not there, and never shrinks the map's ground under a dug tile below rail + 3.
- A v23 save with track on a mountain: every piece stays where it is and no rail changes height.
- A Drill drag across a tile with a building, road, deposit or surface track: the whole drag refuses, and trees on dug tiles stay as scenery.

---

## Decisions this plan makes

- **`maxStep`.** A map with `generatedLevel` allows neighbours 4 apart; a map without it (levels, editor) keeps the one-level rule.
- **Old chunks.** A chunk stored before `CHUNK_VERSION` 6 reads `generatedLevel` as 255; `buildMap` fills those tiles from the old rule, so a built map's plane is always whole.
- **Rail on cliffs.** `slope.ts` does not change. `trackRules` refuses a link that crosses an edge with a step over 1, unless a tile of that edge is dug or cut. Rail may run along a cliff.
- **Rivers start in the mountains (author, 2026-10-31).** The massif noise lifts `elev` at stage ELEV, before terrain and the river plan read it. Rivers keep to water levels 0 to 4; the sculpt pass runs after the water pass and falls away from water, which cuts a valley up to the river's head.
- **Massif mask.** A low-frequency noise from a new seed drawn last, as in `trial:sculpt`. The sculpt pass and the lift read the same `massifAt`, so both agree on where a mountain stands.
- **Forest on a slope.** Terrain stays Forest, for the simulation. The painter paints a raised Forest tile as grass.

## File map

| File                                               | Role      | Responsibility                                        |
| -------------------------------------------------- | --------- | ----------------------------------------------------- |
| `src/world/elevation.ts`                           | World     | planes, `MAX_LEVEL`, `maxStep`, `levelTarget`         |
| `src/world/waterfalls.ts`, `src/world/chunks.ts`   | World     | `MAX_WATER_LEVEL`, chunk version 6                    |
| `src/world/mountains.ts` (new)                     | World     | pure sculpt pass with the shape mix                   |
| `src/world/reshape.ts` (new)                       | World     | which tiles a raise or lower moves                    |
| `src/world/railProfile.ts`                         | World     | beds for dug and cut tiles                            |
| `src/sim/underground.ts` (new)                     | Gameplay  | dug tiles, cuts, portals, the dig plan                |
| `src/sim/build.ts`, `src/sim/rules.ts`             | Gameplay  | rules and prices                                      |
| `src/sim/save.ts`                                  | Gameplay  | `SAVE_VERSION` 24                                     |
| `src/render/terrainRelief.ts`, `landscape*.ts`     | Rendering | `RELIEF_MAX`, soft banks, light, forest on a slope    |
| `src/render/tunnelGlass.ts` (new)                  | Rendering | the glass view                                        |
| `src/render/tunnelPortals.ts` (new)                | Rendering | portal art cut to the ground, masks, the ghost copy   |
| `src/art/tunnelArt.ts` (new)                       | Art       | placeholder portal, floor and wall frames             |
| `src/ui/buildBar.ts`, `buildController.ts`         | UI/UX     | tools, ghosts, refusals                               |
| `src/game.ts`, `src/engine/loadRepair.ts`          | Engine    | wiring only                                           |

---

### Task 1: Stored levels and the new top (World)

**Files:**
- Modify: `src/world/elevation.ts`, `src/world/tiles.ts`, `src/world/waterfalls.ts`, `src/world/chunks.ts`
- Test: `src/world/elevation.test.ts`

**Interfaces:**
- Produces: `MAX_LEVEL = 16`; `NO_LEVEL = 255`; `MAX_WATER_LEVEL = 4` in `waterfalls.ts`, with `MAX_DROP = MAX_WATER_LEVEL`; `maxStep(map: Elevated): 1 | 4`; `GameMap.generatedLevel?: Uint8Array`; `GameMap.groundLevel?: Uint8Array`.

- [ ] **Step 1: Write the failing tests**

```ts
it('reads the player plane before the generated one', () => {
  const m = flatMap(3, 1, { generatedLevel: [2, 2, 2], groundLevel: [NO_LEVEL, 3, NO_LEVEL] });
  expect([...tileLevels(m)]).toEqual([2, 3, 2]);
});
it('keeps a generated step of 4 and clamps a step of 5', () => {
  const m = flatMap(2, 1, { generatedLevel: [0, 5] });
  expect([...tileLevels(m)]).toEqual([0, 4]);
});
it('keeps the one-level rule without a plane', () => {
  const m = terrainMap([[Terrain.Mountain, Terrain.Mountain, Terrain.Grass]]);
  expect(Math.abs(levelAt(m, 1, 0) - levelAt(m, 2, 0))).toBeLessThanOrEqual(1);
});
it('agrees with tileLevels on every tile of a map with both planes', () => {
  /* random planes over 40 seeds: levelAt(x, y) === tileLevels(m)[y * w + x] */
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/world/elevation.test.ts`. Expected: FAIL, `NO_LEVEL` not exported.
- [ ] **Step 3: Implement.** `levelTarget`: `groundLevel` if not `NO_LEVEL`, then `generatedLevel` if not `NO_LEVEL`, then the old rule with Mountain at `MAX_LEVEL`. `tileLevels` clamps by `maxStep(map)`. `levelAt` on a map with a plane reads the stored value and clamps against its four sides only; without one it loops to `level` tiles out, not `MAX_LEVEL`, so a call stays cheap. `MAX_DROP` and the chunk codec's "a side above 4" use `MAX_WATER_LEVEL`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, goldens unmoved (no generator writes the planes yet).
- [ ] **Step 5: Commit.** `git commit -m "World: stored level planes, top level 16"`

### Task 2: Chunks hold generated levels (World)

**Files:**
- Modify: `src/world/chunks.ts`
- Test: `src/world/chunks.test.ts`

**Interfaces:**
- Consumes: `generatedLevel`, `NO_LEVEL` (Task 1).
- Produces: `CHUNK_VERSION = 6`. `ChunkPlanes.generatedLevel: Uint8Array`.

- [ ] **Step 1: Write the failing tests.** `round-trips a chunk with levels 0 to 16`; `reads a version 5 text with every generatedLevel NO_LEVEL`; `buildMap fills NO_LEVEL tiles from the old rule, so a map from v5 chunks has the levels it had`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** After props, version 6 adds: whether the plane has any tile not 0, then the plane as water levels are, its contexts by terrain, five bits a value. Extend the head comment. `buildMap` runs `tileLevels` on a plane-free copy for the tiles at `NO_LEVEL` and writes them in.
- [ ] **Step 4: Run** `npx vitest run src/world/chunks.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "World: chunk version 6 holds generated levels"`

### Task 3: Relief, light and painting for tall ground (Rendering)

**Files:**
- Modify: `src/render/terrainRelief.ts`, `src/render/landscape.worker.ts`, `src/render/landscapeModel.ts`, `src/render/worldRenderer.ts`
- Test: `src/render/terrainRelief.test.ts`, `src/render/landscapeModel.test.ts`

**Interfaces:**
- Produces: `RELIEF_MAX = 200`; `ReliefStyle.softFrom?: number`, shipped `3`; `heightFactor(level, heightLight): number`.

- [ ] **Step 1: Write the failing tests.** `softFrom: a cell with a tile at level 3 or more ramps across the whole tile`; `cells of soft and hard banks meet exactly on their shared edge` (sample both sides over 200 points); `heightFactor is 1.24 at level 4 and 1.348 at level 16`; `a raised Forest tile paints as Grass and a level 0 one as Forest`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `terraceHeight` picks the bank per cell (`hooks.diff`). `heightFactor` is `1 + heightLight * (level <= 4 ? level : 4 + (level - 4) * 0.15)`, used by the painter and, with `levelAt`, for the peak tint. Peak pictures show only on a tile with no higher tile within 3 and at level 7 or more (`trial:clearSummits`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Rendering: tall ground, soft banks, capped height light"`

### Task 4: Mountains in map generation (World; goldens need `gate:approved`)

**Files:**
- Create: `src/world/mountains.ts`, `src/world/mountains.test.ts`
- Modify: `src/world/mapgen.ts`
- Test goldens: `src/world/mapgenSupply.test.ts`, `src/testing/simWorld.test.ts`

**Interfaces:**
- Consumes: `generatedLevel`, `maxStep` (Task 1), chunk version 6 (Task 2).
- Produces: `massifAt(wx: number, wy: number, seed: number): number`; `sculptMountains(field: SculptField, span: Span, keepClear: Span, seed: number): Uint8Array`; `MOUNTAIN_SHAPES = { hill: 0.7, ridge: 0.2, tower: 0.1 }`; `SCULPT_REACH = 32`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('stays within the top and a step of 4', () => { /* 20 seeds */ });
it('reaches at least level 12 on 18 of 20 seeds of 160 x 160', () => {});
it('uses all three shapes over 40 seeds, hill the most', () => {});
it('leaves water, the map border and the start chunk at their old levels', () => {});
it('a map grown by a ring has the same levels on the tiles both hold', () => {});
it('generates the same map twice', () => {});
it('leaves no flat top: under 2% of raised tiles stand at 16', () => {});
it('starts most rivers in the mountains: over 20 seeds, 70% of river heads lie within 6 tiles of a massif', () => {});
it('keeps every river at water level 4 or under, flowing downhill', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL, module missing.
- [ ] **Step 3: Implement `sculptMountains`, porting `trial:sculpt`.** Shapes `model`, `ridges` and `towers` only. The shape comes from a noise at wavelength about 90 tiles, cut into the `MOUNTAIN_SHAPES` shares; shapes blend across a band of 8 tiles. The distance to the mask edge and to water is capped at 16 and read over `SCULPT_REACH`, so a level depends on tiles within it, not on map size. Scale by a fixed factor per shape, not by a percentile of the map, which would depend on map size. Cover as in `trial:sculpt`: Forest low, Grass, Rock from level 6, Mountain from 10, Rock at any step of 3 or more, with the noise wobble.
- [ ] **Step 4: Wire it in `generateMapPlanes`.** Draw the new seed last in `seeds`. `Field` adds a lift from `massifAt` to `elev` at stage ELEV, fading to nothing around the start chunk, so `riverPlan` and `riverWater` drain away from the massifs. Tune the lift against the river test without moving the sea or the start guarantee. Raise `LATE_REACH` by `SCULPT_REACH`. Call it after the water pass and `raiseMountains`, before `startResources`, with `keepClear = grow(start, 4)`. A tile takes the higher of the old level and the sculpted one. Crop to `map.generatedLevel`.
- [ ] **Step 5: Run** `npm test`. Expected: only golden tests FAIL. List them; update them; say in the PR that the goldens move and every seed makes a new map.
- [ ] **Step 6: Review on real maps.** Render three seeds in the running game, on a review page, for the author. Stop here until the author has seen the mix, which they have not yet seen on one map.
- [ ] **Step 7: Commit.** `git commit -m "World: generated mountains, three shapes up to level 16"`

### Task 5: Rules, snow, saved planes (Gameplay)

**Files:**
- Modify: `src/sim/rules.ts`, `src/data/biomes.json`, `src/sim/save.ts`
- Create: `src/sim/underground.ts` (types and store only)
- Test: `src/sim/save.test.ts`, `src/sim/underground.test.ts`

**Interfaces:**
- Produces: `Rules.groundCost = 100`, `drillCost = 500`, `portalCost = 2000`, `drillStone = 2`.

```ts
export type Face = 'N' | 'E' | 'S' | 'W';
export interface Portal { x: number; y: number; face: Face; floor: number }
export class Underground {
  constructor(w: number, h: number);
  isDug(x: number, y: number): boolean;
  isCut(x: number, y: number): boolean;
  floorAt(x: number, y: number): number | undefined;
  portals(): readonly Portal[];
  toJSON(): UndergroundJSON;
  static fromJSON(j: unknown, w: number, h: number): Underground;
}
```

- [ ] **Step 1: Write the failing tests.** `round-trips dug tiles, cuts, portals and groundLevel`; `a v23 save loads with no plane and an empty store`; `junk in underground loads as empty`; `snow starts at 14 in plains, 16 in the desert, 12 in the coldest climate`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `snowLevel`: 5 becomes 16, 3 becomes 12, the rest 14. `SAVE_VERSION = 24`, a migration step that fills in nothing. Add the four sliders with the existing rule metadata.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Gameplay: tunnel rules, snow line, saved underground"`

### Task 6: What a raise moves (World)

**Files:**
- Create: `src/world/reshape.ts`, `src/world/reshape.test.ts`

**Interfaces:**
- Consumes: `tileLevels`.
- Produces:

```ts
export interface Reshape { moved: { x: number; y: number; to: number }[]; refused: { x: number; y: number }[] }
export function reshape(
  map: Elevated, levels: Uint8Array, tiles: readonly { x: number; y: number }[], delta: 1 | -1,
  fixed: (x: number, y: number) => boolean, least: (x: number, y: number) => number,
): Reshape;
```

- [ ] **Step 1: Write the failing tests.** `a raise lifts the neighbours one level short of it`; `a lower takes them down`; `a step that was 4 stays, and a new step is at most 1`; `a fixed tile that must move refuses the whole action`; `top 16 and bottom 0 refuse`; `least: a tile over a dug tile refuses below rail + 3`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Breadth-first from `tiles`: a neighbour moves when the step to it would grow past `max(1, the step it had)`.
- [ ] **Step 4: Run** `npx vitest run src/world/reshape.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "World: which tiles a raise or lower moves"`

### Task 7: Raise, Lower and rail on steps (Gameplay)

**Files:**
- Modify: `src/sim/build.ts`
- Test: `src/sim/ground.test.ts`, `src/sim/mountainTrack.test.ts`

**Interfaces:**
- Consumes: `reshape` (Task 6), `Underground` (Task 5).
- Produces: `Builder.checkGround(tiles, delta: 1 | -1): GroundCheck` (`PlacementCheck` plus `moved`, `refused`); `Builder.reshapeGround(tiles, delta): boolean`.

- [ ] **Step 1: Write the failing tests.** `refuses water, track, road, building and deposit tiles`; `Lower refuses a tile touching water, side or corner`; `prices per tile per level and charges nothing on refusal`; `lowering stone to 0 turns it to Grass; raising keeps terrain`; `a link across a step of 2 refuses; a straight along a cliff is laid`; `a link into a dug or cut tile ignores the step`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `reshapeGround` writes `map.groundLevel`, creating it at `NO_LEVEL` on first use, and the terrain. The step rule goes in the `links` loop of `trackRules`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Gameplay: Raise, Lower, rail refuses a cliff edge"`

### Task 8: Raise and Lower in the build menu (UI/UX, then Engine)

**Files:**
- Modify: `src/ui/buildBar.ts`, `src/ui/buildController.ts`, `src/strings.ts`
- Before it, on its own Gameplay branch: `src/data/strings.hu.ts`
- Then, on its own Engine branch: `src/game.ts`
- Test: `src/ui/buildBar.test.ts`, `src/ui/buildController.test.ts`

**Interfaces:**
- Consumes: `Builder.checkGround`, `Builder.reshapeGround`.
- Produces: `Tool` case `{ kind: 'ground'; delta: 1 | -1 }`; `toolKey` `ground:up`, `ground:down`; items in the Utility group, icons `up` and `down`.

- [ ] **Step 1: Write the failing tests.** `Utility holds Raise and Lower`; `a drag acts tile by tile, one level a step`; `the ghost lists every moved tile and the price`; `refused tiles show red and a click does nothing`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** in `buildController`'s tool switch, following `road`. Engine: after a reshape, `game.ts` retiles the moved tiles and sets `railsDirty`.
- [ ] **Step 4: Run** `npm test`, then try it in the running game. Expected: PASS, ground moves, rails on it follow.
- [ ] **Step 5: Commit** each branch: `git commit -m "UI: Raise and Lower tools"`, `git commit -m "Engine: retile after a ground change"`

### Task 9: The dig plan (Gameplay)

**Files:**
- Modify: `src/sim/underground.ts`, `src/sim/build.ts`
- Test: `src/sim/underground.test.ts`

**Interfaces:**
- Consumes: `reshape`, `Rules`, `tileLevels`.
- Produces:

```ts
export interface DigPlan extends PlacementCheck {
  dig: { x: number; y: number }[]; cut: { x: number; y: number }[];
  raise: Reshape['moved']; portals: Portal[]; stone: number;
}
Underground.plan(map, levels, tiles, surfaceFree): DigPlan;
Underground.apply(plan): void;
Underground.fill(x, y): { portal?: Portal };
Builder.checkDig(tiles): DigPlan; Builder.dig(tiles): boolean; Builder.fillDug(x, y): boolean;
```

- [ ] **Step 1: Write the failing tests.**

```ts
it('digs under ground at rail + 3 or higher', () => {});
it('raises a saddle between dug tiles to rail + 3, at the Raise price', () => {});
it('turns a tile on the way down to open ground into a cut', () => {});
it('puts a portal on the first tile at rail + 3 going in from the open side', () => {});
it('makes a portal for each of the four faces', () => {});
it('a cliff makes a portal with no cut outside it', () => {});
it('refuses a tile touching water, side or corner', () => {});
it('refuses the whole drag over a building, road, deposit or surface track', () => {});
it('adds 2 stone a dug tile; back-fill refunds half', () => {});
it('a back-filled portal tile takes its portal; track removal leaves the tile dug', () => {});
it('fill refuses a tile with track', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** A tile below rail + 3 is a cut when, along the drag, it leads down to level 0 with no dug tile beyond; otherwise it is raised. A portal costs `portalCost` on top of the tiles.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Gameplay: Drill plan, cuts and portals"`

### Task 10: Track inside and rail beds (World, then Gameplay)

**Files:**
- Modify: `src/world/railProfile.ts`
- Then: `src/sim/build.ts`
- Test: `src/world/railProfile.test.ts`, `src/sim/mountainTrack.test.ts`, `src/sim/trafficSoak.test.ts`

**Interfaces:**
- Consumes: `Underground`, through a view so World does not import `src/sim`.
- Produces: `interface BedsUnder { floorAt(x, y): number | undefined; isCut(x, y): boolean }`, a new last parameter of `railProfile`. `Builder.insideMode: boolean`.

- [ ] **Step 1: Write the failing tests.** `a dug tile has a flat bridge bed at its floor`; `a cut tile has a flat bed without bridge`; `the first tile past a cut keeps the cut's level` (the kink the author circled); `a unit piece on dug tiles has flat beds`; `a piece inside needs its whole footprint dug, member tiles without a rail included`; `straight, curve, switch, crossing and signal lay inside; stations, depots and buildings refuse`; `Drill lines are narrow, branch, main and trunk, from the diesel age`; `a train crosses a tunnel on the same path and time as the same line on flat ground`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `lineProfile`, a dug or cut tile's terrain value is its floor, and the `bridge` flag follows `floorAt`. Unit pieces: the second loop of `railProfile`, and the bed is flat. In `trackRules`, skip `groundCheck` on a dug tile; with `insideMode` every footprint tile must be dug; without it a dug tile refuses, as a tile with a surface.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** each branch: `git commit -m "World: beds for dug and cut tiles"`, `git commit -m "Gameplay: track inside a dug footprint"`

### Task 11: Placeholder art (Art)

**Files:**
- Create: `src/art/tunnelArt.ts`, `src/art/tunnelArt.test.ts`

**Interfaces:**
- Produces: frames `tunnel/portal_E`, `tunnel/portal_S`, `tunnel/floor_0` to `3`, `tunnel/wall_N_0` to `2`, `tunnel/wall_W_0` to `2`, `tunnel/shade_N`, `tunnel/shade_W`, `tunnel/rim_S`, `tunnel/rim_E`. `tunnel/brick_0` to `3` and `tunnel/coping`. `portal_*` holds the throat and ring only, on the plane of `trial:frontArt`.

- [ ] **Step 1: Write the failing test.** `every frame exists with its anchor at the tile centre`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement,** porting `trial:digArt`, `trial:bricks` and the arch of `trial:frontArt`. Rock colours from `src/art/palette.ts`. Re-run `scratchpad/art-sheets.mjs`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, frame counts of other sheets unmoved.
- [ ] **Step 5: Commit.** `git commit -m "Art: placeholder tunnel frames"`

### Task 12: Glass (Rendering)

**Files:**
- Create: `src/render/tunnelGlass.ts`, `src/render/tunnelGlass.test.ts`
- Modify: `src/render/worldRenderer.ts`

**Interfaces:**
- Consumes: `Underground` as a read view, `tunnel/*` frames.
- Produces: `WorldRenderer.setGlass(on: boolean, preview?: { x: number; y: number }[]): void`.

- [ ] **Step 1: Write the failing tests.** Pure parts: `every tile above level 0 outside a cut gets four quads`; `walls stand only on a dug tile's closed sides`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** porting `trial:xray`, without floors, veins or props. Glass alpha `0.13 + 0.015 * level`. Peaks, props and scatter on raised tiles hide; rooms draw from the floor up, back to front; a portal is an outline. One layer, rebuilt when the dug tiles or the view change. Trains sort over it.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Rendering: glass view for the Drill"`

### Task 13: Portals and trains going in (Rendering)

**Files:**
- Create: `src/render/tunnelPortals.ts`, `src/render/tunnelPortals.test.ts`
- Modify: `src/render/trainRenderer.ts`, `src/render/worldRenderer.ts`

**Interfaces:**
- Consumes: `Portal`, `tunnel/portal_*`, `WorldRenderer.groundAt`.
- Produces: `TunnelPortals.refresh(): void`; `TunnelPortals.dress(s: Sprite, x: number, y: number): void`, called from `TrainRenderer.pose` after `hideAt`.

- [ ] **Step 1: Write the failing tests.** `the portal back sorts on the depthKey scale`; `a car within reach of a portal never sorts below its back` (the fault the author reported); `a car going in sorts under the dark`; `the throat holds a copy of each track sprite on the three tiles behind the portal`; `the opening's outline never crosses itself`; `only cars within 4.5 tiles of a portal carry a mask`; `a rear face has no back picture`; `a car on a dug tile with no portal near is hidden`; `a car takes no mask in the glass`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** porting `trial:frontArt` (the face cut to the ground, opening half width 0.46 tile, crown 34 px, level 3.5, the brick face and the wall along the cutting), `opening`, `frontDark`, `throatRail`, `frontMask`, `rearMask`, `dress`, `syncTrack`. No ghost copy: `setGhost` is dead in the trial and is not ported. Masks set `renderable = false`, `includeInBuild = false`, `measurable = false`, or they draw white. Rebuild a portal when the ground around it changes, after the relief has settled.
- [ ] **Step 4: Run** `npm test`, then record runs on all four faces. Expected: PASS, the train is partly seen and swallowed at the jamb.
- [ ] **Step 5: Commit.** `git commit -m "Rendering: portals, trains going in and out"`

### Task 14: The Drill in the build menu (UI/UX, then Engine)

**Files:**
- Modify: `src/ui/buildBar.ts`, `src/ui/buildController.ts`, `src/strings.ts`
- Before it, on its own Gameplay branch: `src/data/strings.hu.ts`
- Then, on its own Engine branch: `src/game.ts`, `src/engine/loadRepair.ts`
- Editor: `src/editor`, with UI/UX
- Test: `src/ui/buildController.test.ts`, `src/engine/loadRepair.test.ts`

**Interfaces:**
- Consumes: `Builder.checkDig`, `dig`, `fillDug`, `insideMode`, `setGlass`, `TunnelPortals`.
- Produces: `Tool` case `{ kind: 'drill' }`, in the Track menu.

- [ ] **Step 1: Write the failing tests.** `the Drill is hidden before the diesel age`; `Drill on turns glass on, off turns it off, and any other menu turns it off`; `with the Drill on, track tools lay inside only`; `Remove back-fills a dug tile with no track`; `the ghost shows dig, raise and price`; `repairBuiltTiles keeps the ground over dug tiles`; `painting a tile in the editor clears its stored level and dug state`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Engine: `new Underground` beside the builder, saved and loaded; `railProfile` gets the view; `hideAt` also answers for a car under the ground, and a removed track puts no car out of sight (Review Focus). Map expansion keeps both planes.
- [ ] **Step 4: Run** `npm test`, `npm run build`, then play a full tunnel through in the running game: dig, lay, run a train, back-fill, save, load. Expected: PASS and the same world after load.
- [ ] **Step 5: Commit** each branch: `git commit -m "UI: the Drill"`, `git commit -m "Engine: wire the underground"`

### Task 15: Author review and final art (Core)

- [ ] **Step 1:** Render every view on the review page from `develop`: Raise and Lower, Drill and glass, a curve, a switch and a crossing inside, all four portal faces with trains, three real maps.
- [ ] **Step 2:** Bring `specs/codex-tunnels.txt` up to the final frames of Task 11 and start Codex on the author's word.
- [ ] **Step 3:** Wear in tunnels goes to the track wear spec; open the issues for step 2 (floors, ramps, ores, mines).
