# Track Wear and Maintenance Trains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track pieces lose health with time and traffic, slow trains, then fail; the player repairs
by hand or with maintenance trains.

**Architecture:** Health is a share on a small `wear` object shared by a piece's tiles. `TrackWear`
(`src/sim/wear.ts`, held by `Builder`) owns hits, the daily scan, repair and events. `Train.canUse`
reads the health, so every search sees a failed piece without new plumbing. Maintenance is a route
mode driven by `MaintenanceBoard` (`src/sim/maintenance.ts`).

**Tech Stack:** TypeScript strict, PixiJS v8, vitest under Node.

**Spec:** `docs/superpowers/specs/2026-10-30-track-wear-design.md`

## Global Constraints

- Three pull requests into `develop`, in the order of the phases below. Each gets a GitHub issue and
  a branch `<role>/<issue>-<slug>` in a new worktree under `G:\DEV\wt`, from `develop`. Each needs
  Core's `scope:cross`. Merge only on Zsolt's word.
- `G:\DEV\Terepasztal\terepasztal` is read-only. Do not touch `terepasztal-local`, the playtest
  worktree, `G:\DEV\wt\terepasztal-locoblk`, `G:\DEV\wt\track-lines`.
- Use node_modules binaries directly, not npm or npx, after installing them in the worktree:
  `node_modules/.bin/vitest run <file>`, `tsc`, `eslint`, `prettier`. Before each push: typecheck,
  lint, tests, build, format check, `node tools/agents/scope.mjs check`.
- No runtime dependency beyond PixiJS. Every player-facing string goes in `src/strings.ts`. Every
  tunable goes in `src/sim/rules.ts` with `RULE_META`. New save fields go in `KNOWN_SAVE_KEYS`
  through `SAVE_PART_KEYS`, and a version bump needs a `MIGRATIONS` step.
- Maglev Guideway and Hyperloop Tube never wear. Tunnels are out of scope.
- A third-party model goes in `src/data/credits.json` in the change that brings it in.
- Visual work is shown to Zsolt as renders from the running game before it is locked.
- Commit subjects are `Area: outcome`, one logical change per commit, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Grown map:** buying land runs `expandSave`, which shifts every tuple. A piece's health must
  survive it. `expandSave` already keeps the tail with `...rest`; pinned in Task 1.
- **A failed piece at the far end of a platform:** a train loading on the other tile of the same
  platform must leave without a stall; pinned in Task 3.
- **A switch that changes form when track is laid next to it:** a worn switch must stay worn;
  pinned in Task 1.
- **Everything fails at once:** a long line laid in one go passes the thresholds on the same day.
  One `track.version` step, and no frame spike; pinned in Task 3.
- **No store holds the price:** hand repair is refused with the reason and a maintenance train
  waits with a notice, instead of repairing for free; pinned in Tasks 5 and 9.

---

## Phase 1: Wear and repair (`gameplay/<issue>-track-wear`, after `uiux/build-bar` merges)

### Task 1: Health on the piece, rules, saves

**Files:**

- Create: `src/sim/wear.ts`, `src/sim/wear.test.ts`
- Modify: `src/world/track.ts`, `src/sim/rules.ts`, `src/sim/save.ts`, `src/game.ts`,
  `src/testing/simWorld.ts`, `src/sim/build.ts`
- Test: `src/sim/save.test.ts`, `src/sim/expand.test.ts`, `src/world/track.test.ts`

**Interfaces:**

- Produces:
  - `TrackPiece.wear: PieceWear`, where `interface PieceWear { health: number }` (share 0..1)
  - `TrackTuple` gains a 7th element `health?: number`, written only when below 1
  - `rules`: `trackWearMul` 1, `trackHpNarrow` 600, `trackHpBranch` 1000, `trackHpMain` 2000,
    `trackHpTrunk` 3500, `trackWearNarrow` 1, `trackWearBranch` 1, `trackWearMain` 1.3,
    `trackWearTrunk` 1.6, `trackWearPerTonne` 0.015, `trackTimeWear` 0.004 (share a day),
    `trackDegradedAt` 0.3, `trackCloseAt` 0.45, `trackDegradedSpeed` 0.6, `trackDegradedWear` 2,
    `trackCrawlSpeed` 0.25, `trackRepairPrice` 0.4, `trackRepairSeconds` 25, `trackHandRepairMul` 2
  - `wear.ts`: `type WearState = 'healthy' | 'degraded' | 'unusable'`; `wearsAtAll(p: TrackPiece):
boolean` (false for Maglev and Hyperloop on either axis);
    `maxHp(p: TrackPiece): number` (the bigger line's); `lineWearMul(cls: TrackClass): number`;
    `stateOf(p: TrackPiece): WearState`
  - `class TrackWear`, constructed `new TrackWear(track, builder)`, held as `Builder.wear`
  - `SaveParts.wear: { degraded: boolean; unusable: boolean }`, from `TrackWear.toJSON()`

- [ ] **Step 1: Write the failing tests**

```ts
// wear.test.ts
it('every tile of a multi-tile piece shares one wear', () => {
  const g = new TrackGraph(20, 20);
  const tiles = g.place(5, 5, 'curve', 0, 'main');
  const first = g.get(tiles[0].x, tiles[0].y)!.wear;
  for (const t of tiles) expect(g.get(t.x, t.y)!.wear).toBe(first);
});
it('a crossing has one wear and takes max HP from its bigger line', () => {
  const g = new TrackGraph(20, 20);
  g.place(5, 5, 'crossing', 0, 'branch', 'trunk');
  expect(maxHp(g.get(5, 5)!)).toBe(3500);
});
it('states follow the thresholds', () => {
  const p = makePiece('straight', 0, 'branch');
  p.wear.health = 0.31;
  expect(stateOf(p)).toBe('healthy');
  p.wear.health = 0.29;
  expect(stateOf(p)).toBe('degraded');
  p.wear.health = 0;
  expect(stateOf(p)).toBe('unusable');
});
it('Maglev and Hyperloop do not wear', () => {
  expect(wearsAtAll(makePiece('straight', 0, 'maglev'))).toBe(false);
  expect(wearsAtAll(makePiece('straight', 0, 'hyperloop'))).toBe(false);
});
it('a worn switch stays worn when its form changes', () => {
  // lay a switch, set health 0.5 on it, lay track past its S exit so refreshSwitchForms flips it
  expect(g.get(ax, ay)!.form).toBe('parallel');
  expect(g.get(ax, ay)!.wear.health).toBe(0.5);
});
```

```ts
// save.test.ts
it('a v22 save loads with full track and clear flags', () => {
  /* migrate, expect wear false,false */
});
it('health and the flags survive a round trip', () => {
  /* health 0.5 at a curve anchor, a
  crossing with cls2 undefined keeps its 7th element in place */
});
// expand.test.ts
it('a grown map keeps a piece health', () => {
  /* tuple with health shifted, health unchanged */
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/wear.test.ts src/sim/save.test.ts src/sim/expand.test.ts`
Expected: FAIL, `wear` and `maxHp` do not exist.

- [ ] **Step 3: Implement**

`makePiece` and `TrackGraph.place` create `wear: { health: 1 }`, one object per piece. In
`refreshSwitchForms` keep the old `wear` and assign it to every tile after `place`, beside the
`caps` carry. `SAVE_VERSION` 23 with a step `from: 22` that sets `j.wear = { degraded: false,
unusable: false }`. `Game.snapshot` writes the 7th element from `t.piece.wear.health` when below 1
(rounded to 4 places), `cls2 ?? null` before it. The load loop at `src/game.ts:1294` sets the health
after `place`, before `refreshSwitchForms`. `TrackWear` gets its constructor, `toJSON`, `fromJSON`
only. `simWorld` follows `Game`.

- [ ] **Step 4: Run them to see them pass**

Run: same command, plus `node_modules/.bin/vitest run src/world src/sim/save`
Expected: PASS.

- [ ] **Step 5: Commit** `Wear: track pieces carry health, and saves keep it`

### Task 2: Wear from trains and time, slowing on degraded track

**Files:**

- Modify: `src/sim/wear.ts`, `src/sim/trains.ts:2404-2412` (cap loop), `src/sim/trains.ts` after
  `layTrail` in `tickMove`, `src/sim/step.ts:269`, `src/sim/fleet.ts`
- Test: `src/sim/wear.test.ts`, `src/sim/lineSpeed.test.ts`

**Interfaces:**

- Consumes: Task 1
- Produces:
  - `TrackWear.hit(x: number, y: number, entry: Dir, tonnes: number): void`
  - `TrackWear.daily(): void`
  - `TrackWear.exempt(x, y): boolean`: `free`, a tile in `builder.depots()` gate tiles, or
    `!wearsAtAll`. Gate keys are cached and rebuilt when `track.version` changes
  - `Train.lastWornPiece: TrackPiece['wear'] | null`, not saved

- [ ] **Step 1: Write the failing tests**

```ts
it('a 150 t train takes 2.25 HP from Branch', () => {
  wear.hit(5, 5, Dir.W, 150);
  expect(piece.wear.health).toBeCloseTo(1 - 2.25 / 1000);
});
it('degraded track wears twice as fast', () => {
  /* health .2, hit, delta .0045 */
});
it('both axes of a crossing wear the same HP, each with its own multiplier', () => {
  // branch x trunk: a hit through the N entry uses 1.0, through the E entry 1.6, both over 3500
});
it('a depot gate never loses health', () => {
  /* hit and daily on a gate tile: health 1 */
});
it('a free builder wears nothing', () => {
  /* builder.free = true */
});
it('daily takes 0.4 % and twice that once degraded, never below 0', () => {});
it('trackWearMul 0 leaves every piece full', () => {});
it('one pass over a 5x5 curve is one hit', () => {
  // run a train through a curve in simWorld: health = 1 - one hit
});
it('a train brakes for a degraded piece ahead and runs it at 0.6 of its top speed', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/wear.test.ts src/sim/lineSpeed.test.ts`
Expected: FAIL, `hit` does not exist.

- [ ] **Step 3: Implement**

In `tickMove` after `layTrail`: read the head piece; when its `wear` differs from
`lastWornPiece`, call `hit` with `this.mass` and set it. In the line-speed loop the limit becomes
the lower of `lineSpeedCap` and, on a degraded piece, `this.maxSpeed * rules.trackDegradedSpeed`.
`SimStep`'s day change calls `builder.wear.daily()`. Hit size:
`tonnes * rules.trackWearPerTonne * lineWearMul(pieceClassFor(p, entry)) * rules.trackWearMul /
maxHp(p)`, doubled by `trackDegradedWear` when degraded, floored at 0.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit** `Wear: trains and time wear track, and degraded track slows trains`

### Task 3: Failure

**Files:**

- Modify: `src/sim/wear.ts`, `src/sim/trains.ts` (`canUse` at 1180, the version check at 2056, the
  `noRoute` retry at 2140, crawl cap), `src/sim/fleet.ts:990` (`tick`)
- Test: `src/sim/wearFailure.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 2
- Produces:
  - `TrackWear.unusable: Set<number>` (tile keys of every member tile)
  - `TrackWear.flush(): void`, called at the end of `Fleet.tick`: `track.version++` once when any
    piece entered or left `unusable` since the last flush
  - `TrackWear.onChange: ((tiles: {x:number;y:number}[]) => void) | null`, fired on any state change
  - `Train.leaveBroken(ctx: TickCtx): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
it('no train enters an unusable piece from sound track', () => {
  // canUse false; findPath with t.canUse returns null on a single line
});
it('a train takes another way when there is one', () => {});
it('a train with no other way waits in noRoute and leaves after the repair', () => {
  expect(t.state).toBe('noRoute');
  repair; run ticks;
  expect(t.state).toBe('moving');
});
it('a train on a failed piece crawls off and stops on sound track', () => {
  // two broken pieces in a row: head ends on a sound tile, speed <= 0.25 while on them
});
it('a train keeps crawling until its last vehicle is off', () => {
  // head on sound track, tail on a broken piece: speed capped until the tail clears
});
it('a train loading on a platform whose other tile fails finishes and leaves', () => {});
it('a batch of failures in one tick raises track.version once', () => {
  // daily() fails 50 pieces; flush(); version + 1
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/wearFailure.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`canUse` adds `&& p.wear.health > 0`. Crawl: when `wear.unusable.size > 0` and any of
`occupancyKeys` is in it, `cap = Math.min(cap, rules.trackCrawlSpeed)`.

`leaveBroken`: when the head piece is unusable, walk forward from `headSeg` by `track.exits`,
preferring the current path's `out`, through unusable pieces and on over sound track until
`this.length + 0.5` tiles of sound track lie ahead or the track ends. A walk that reaches no sound
tile returns false. Otherwise set `this.path`, the points and `setState('moving')` as `dispatch`
does. Arrival at its end takes the existing `noRoute` branch, whose retry dispatches from sound
track.

The version branch at line 2064 tries `leaveBroken` before `dispatch`, and so does the `noRoute`
retry at 2156.

- [ ] **Step 4: Run them to see them pass**

Run: `node_modules/.bin/vitest run src/sim` . Expected: PASS, the traffic and recovery suites too.

- [ ] **Step 5: Commit** `Wear: failed track closes, and trains on it crawl off`

### Task 4: Warnings, tooltip, tint

**Files:**

- Create: `src/ui/wearAlert.ts`
- Modify: `src/sim/wear.ts`, `src/sim/notices.ts`, `src/strings.ts`, `src/game.ts`,
  `src/render/worldRenderer.ts:1299`, `src/ui/minimap.ts` through
  `Game.minimapTrack`
- Test: `src/sim/wear.test.ts`, `src/sim/notices` tests in `src/sim/wearNotices.test.ts`

**Interfaces:**

- Consumes: Task 3
- Produces:
  - `TrackWear.onFirst: ((kind: 'degraded' | 'unusable', x: number, y: number) => void) | null`,
    fired once per game, the flags saved
  - `WearAlertScreen implements Screen`, `show(x, y)`, buttons `repair()` and `depot()`
  - `Notices.refresh` takes `wear: TrackWear`
  - `WorldRenderer.trackWearAt: (i: number) => WearState`, set by `Game`

- [ ] **Step 1: Write the failing tests**

```ts
it('the first degraded and first unusable piece fire once each', () => {});
it('flags from a save keep them from firing again', () => {});
it('three unusable pieces give three notices, four give one with a count', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/wear.test.ts src/sim/wearNotices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`onFirst('degraded')` pushes a `warn` notice with a tile target, text per spec section 5.
`onFirst('unusable')`: `Game` calls `pauseGame`, pans the camera, opens `WearAlertScreen`;
`onClose` calls `resumeGame`. Repair selects the Repair tool (Task 5), Depot opens the depot screen
of the nearest depot of the piece's gauge on the maintenance wagon (the wagon arrives in Task 7, so
until then it opens the depot). `trackColour` multiplies by rust `0xd8b070` when degraded and
`0xb05040` when unusable. `onChange` retints the tiles. `tileSnap` adds
`wear: { percent, state } | null`, and the tooltip shows it.

- [ ] **Step 4: Run them to see them pass, and look at it**

Run: same command, then start the dev server preview, load a save with a worn piece, confirm tint,
tooltip, alert and pause. Expected: PASS and the screen shows them.

- [ ] **Step 5: Commit** `Wear: warnings, tooltip and tint`

### Task 5: Hand repair

**Files:**

- Modify: `src/sim/build.ts`, `src/sim/stores.ts:814`, `src/sim/wear.ts`, `src/ui/toolbar.ts`,
  `src/ui/buildController.ts`, the build bar icon set, `src/strings.ts`
- Test: `src/sim/wearRepair.test.ts`, `src/ui/buildController.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 3
- Produces:
  - `StoreRegistry.payerAnywhere(cost: Cost, x: number, y: number): ResourceStore | null`: as
    `payerFor` with no reach limit. The one payment function of spec section 8
  - `TrackWear.repairCost(p: TrackPiece, share: number, hand: boolean): Cost`
  - `TrackWear.restore(x: number, y: number, share: number): void`, which flushes state changes
  - `Builder.checkRepair(tiles): { ok: boolean; cost: Cost; pieces: {x;y}[]; reason?: string }`
  - `Builder.repairTrack(tiles): boolean`
  - `Tool` gains `{ kind: 'repair' }`

- [ ] **Step 1: Write the failing tests**

```ts
it('a hand repair is instant and costs twice the train price', () => {
  // Branch straight at health 0.5: 0.4 x 2 x 0.5 of its build cost, ceil per resource
});
it('a store past buildReach pays', () => {});
it('no store can pay: refused with the reason, health unchanged', () => {});
it('a multi-tile piece repaired from any of its tiles is charged once', () => {});
it('a piece under a train can be repaired', () => {});
it('a depot gate and a full piece offer nothing to repair', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/wearRepair.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`repairCost` is `scaleCost(pieceCost(kind, cls, cls2), share * rules.trackRepairPrice *
rules.buildCostMul * (hand ? rules.trackHandRepairMul : 1))`. The tool follows the Upgrade tool:
`ReclassStroke` for the stroke and whole-piece outlines, with the price in the same place. The
button is on the right of the build bar beside Demolish, hammer icon. Repair is available in every
age. In the editor it stays off.

- [ ] **Step 4: Run them to see them pass, and look at it**

Run: same command plus `node_modules/.bin/vitest run src/ui/buildController.test.ts`, then in the
preview stroke over worn pieces. Expected: PASS and the pieces turn healthy.

- [ ] **Step 5: Commit** `Wear: Repair tool beside Demolish`

### Task 6: The numbers

**Files:**

- Create: `src/sim/wearNumbers.test.ts`

- [ ] **Step 1: Write the test**

```ts
it('a six-train Steam network first degrades a piece near the hour, not before half of it', () => {
  // simWorld, six 150 t trains sharing one platform on a 30-tile line, 1x steps for up to 2 h
  expect(firstDegradedMinute).toBeGreaterThan(30);
  expect(firstDegradedMinute).toBeLessThan(90);
});
it('an unused line takes about 12 hours to degrade', () => {
  // daily() only: 175 days +- 2
});
```

- [ ] **Step 2: Run it** `node_modules/.bin/vitest run src/sim/wearNumbers.test.ts`

Expected: PASS. On a miss, report the measured minute to Zsolt with a proposed `trackWearPerTonne`.
Balance is his call: do not change it silently.

- [ ] **Step 3: Full check and pull request**

Run typecheck, lint, all tests, build, format check, scope check. Push, open the pull request into
`develop` with the issue linked, and report the first-degraded minute in it.

---

## Phase 2: Maintenance (`gameplay/<issue>-maintenance-trains`)

### Task 7: Wagons and locomotives in the data

**Files:**

- Modify: `src/data/wagons.json`, `src/data/locomotives.json`, `src/data/content.ts`,
  `src/data/gacha.json`, `src/sim/trains.ts`
- Test: `src/data/content.test.ts`, `src/sim/starterKit.test.ts`, `src/gacha/crafting.test.ts`

**Interfaces:**

- Produces:
  - `WagonDef.maintenance?: boolean`
  - wagons `maint_wagon_narrow` (class corvette, gauge narrow) and `maint_wagon_branch` (class
    frigate): `tier: 0`, `capacity: 0`, `carries: 'bulk'`, `weight: 8`, `rarity: 'N'`,
    `starter: true`, `body: 'hopper'`, `paint: 'yellow'`
  - locomotives `maint_loco_narrow` (corvette, gauge narrow, speed 0.7, weight 5) and
    `maint_loco_branch` (frigate, speed 1.0, weight 22): `type: 'diesel'`, `rarity: 'N'`, in the
    `diesel_era` pool, so `craftTier` gives them Diesel
  - `Train.hasMaintenanceWagon: boolean` getter

- [ ] **Step 1: Write the failing tests**

```ts
it('maintenance wagons are Steam, starter stock, one per network', () => {});
it('maintenance locomotives are Diesel', () => {
  expect(craftTier('maint_loco_branch')).toBe(1);
});
it('a train with a maintenance wagon says so', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/data src/gacha src/sim/starterKit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the data and the getter**

Placeholder sprites come from the `hopper` and diesel generators in `src/art`; Task 13 replaces
them. A save older than this has no starter copies, and those players draw the wagon from the Steam
pool like any wagon.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit** `Maintenance: wagons and locomotives`

### Task 8: The route mode

**Files:**

- Modify: `src/sim/trains.ts:158`, `src/sim/fleet.ts:540`, `src/ui/trainScreen.ts:22,264`,
  `src/strings.ts`
- Test: `src/sim/commands.test.ts`, `src/sim/maintenance.test.ts`

**Interfaces:**

- Consumes: Task 7
- Produces:
  - `RouteMode` gains `'maintenance'`, not in `DYNAMIC_MODES`
  - `Fleet.setMode` refuses it without the wagon: `STR.fleet.needMaintenanceWagon`
  - a train that loses the wagon goes to `'schedule'`, or `'freight'` with fewer than two stops

- [ ] **Step 1: Write the failing tests**

```ts
it('the mode is refused without the wagon', () => {
  expect(w.fleet.setMode(t, 'maintenance')).toEqual({
    ok: false,
    message: STR.fleet.needMaintenanceWagon,
  });
});
it('any locomotive of its network may take the wagon', () => {});
it('taking the wagon off ends the mode', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/commands.test.ts src/sim/maintenance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ROUTE_BUTTONS` adds the mode. Without the wagon the button has `disabled` and a `title` with
`STR.fleet.needMaintenanceWagon`. `STR.train.mode.maintenance: 'Maintenance'` and a `modeHint`.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit** `Maintenance: a route mode that needs the wagon`

### Task 9: Job choice and work

**Files:**

- Create: `src/sim/maintenance.ts`
- Modify: `src/sim/trains.ts` (`TrainState`, `tick`, `toJSON`, `fromJSON`), `src/sim/fleet.ts`,
  `src/strings.ts:790`, `src/sim/notices.ts`
- Test: `src/sim/maintenance.test.ts`

**Interfaces:**

- Consumes: Tasks 5, 8
- Produces:
  - `TrainState` gains `'repairing'`
  - `interface MaintJob { ax: number; ay: number; tier: 0 | 1 | 2; x: number; y: number }`, with
    `x, y` the tile the train stands on
  - `class MaintenanceBoard` (held by `Fleet`, passed in `TickCtx`):
    `pick(t: Train, track: TrackGraph): { job: MaintJob; path: PathSegment[] } | null` and
    `release(t: Train): void`
  - `Train.maint: MaintJob | null`, saved as an optional field. No version bump: absent is null
  - `Train.tickMaintenance(gdt: number, ctx: TickCtx): void`

- [ ] **Step 1: Write the failing tests**

```ts
it('takes unusable before degraded before close to degraded', () => {});
it('within a tier takes the nearest', () => {});
it('two trains never claim one piece', () => {});
it('repairs an unusable piece from the tile beside it', () => {
  expect(t.headTile).toEqual(besidePiece);
  expect(piece.wear.health).toBeGreaterThan(0);
});
it('repairs a broken stretch from its near end inward', () => {});
it('leaves healthy track over 45 % alone', () => {});
it('full repair takes 25 game seconds and is paid as it goes', () => {});
it('partial repair stays when the job is left', () => {});
it('waits with a notice when no store can pay', () => {});
it('goes to its depot with no work and looks again every 30 seconds', () => {});
it('never searches more than three times for one pick', () => {
  // spy on findPath
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/maintenance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`pick` runs one `findPath` per tier, `isTarget` true on any unclaimed job tile of that tier, using
the train's `canUse`, and stops at the first hit. An unusable job's tile is the sound tile through
an open end of the piece. Walk the unusable set to build it; a piece with no sound neighbour waits
for its neighbour's repair. `pick` is called only when a train starts, finishes or leaves a job.

`tickMaintenance` replaces `depart` and the route logic while `mode === 'maintenance'`: moving to
`maint`, then `repairing`, raising health by `gdt / rules.trackRepairSeconds` a second and paying
through `payerAnywhere`. It keeps the fractional cost owed per resource on the train and pays whole
units. At full health it calls `pick` again.

- [ ] **Step 4: Run them to see them pass**

Run: same command, plus `node_modules/.bin/vitest run src/sim`. Expected: PASS.

- [ ] **Step 5: Commit** `Maintenance: trains find worn track and repair it`

### Task 10: Priority

**Files:**

- Modify: `src/sim/traffic.ts:403,511`, `src/sim/compat.ts`, `src/sim/fleet.ts`
- Test: `src/sim/maintenance.test.ts`

**Interfaces:**

- Consumes: Task 9
- Produces: `trafficRank(t: Train): number`: 4 when `t.maint?.tier === 0`, 0 for any other
  maintenance job, else `classRank(t.trainClass)`. `Traffic` reads it in place of `classRank`.

- [ ] **Step 1: Write the failing tests**

```ts
it('a train heading for an unusable piece goes first', () => {});
it('on degraded track it gives way, and a train held 5 s by it makes it pull aside', () => {
  // the job stays claimed by nobody, partial health stays, it picks again after
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/sim/maintenance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Fleet.tick` after the wait-for graph: a `repairing` train with tier above 0 that any train has
as `blockedBy` for over 5 seconds calls `release` and pulls aside by the path `makeWay` uses
(`findRefugePath`).

- [ ] **Step 4: Run them to see them pass**

Run: `node_modules/.bin/vitest run src/sim`. Expected: PASS.

- [ ] **Step 5: Full check and pull request**

Run the full checks, push, open the pull request into `develop`. Show Zsolt a clip of a maintenance
train repairing a failed piece.

---

## Phase 3: Art (`art/<issue>-track-wear-looks`)

### Task 11: Painted wear materials

**Files:**

- Create outside the repository: `G:\DEV\Terepasztal\specs\codex-track-wear.txt`
- Modify: `tools/track-materials.mjs`, `src/art/trackMaterials.ts`, `public/assets/track-materials`

**Interfaces:**

- Produces: in `materials.json`, each of `narrow`, `branch`, `main`, `trunk` gains
  `degraded` and `unusable` material sets with the same file names and sizes as today's

- [ ] **Step 1: Write the brief**

Same strip sizes as the current materials, 256 px a tile and seamless. Degraded: rust, weeds, rotten
sleepers. Unusable: broken sleepers, displaced rail. Keep each line's character. Build on what
`specs/codex-track-fit.txt` delivers, so this waits for that work.

- [ ] **Step 2: Hand the brief to Zsolt for Codex and wait for the pictures**

- [ ] **Step 3: Pack them and run** `node_modules/.bin/vitest run src/art`

Expected: PASS, with the frame counts and anchors of the sound track unchanged.

- [ ] **Step 4: Commit** `Track art: painted degraded and unusable materials`

### Task 12: Worn frames on demand

**Files:**

- Modify: `src/art/trackIllustrated.ts:697`, `src/world/track.ts` (`pieceFrame`), `src/art/index.ts`,
  `src/render/worldRenderer.ts`, `src/engine/atlas.ts`
- Test: `src/art/trackSleepersDrawn.test.ts`, `src/world/track.test.ts`

**Interfaces:**

- Consumes: Task 11, Task 3 `onChange`
- Produces: `pieceFrame(p: TrackPiece, state?: WearState): string`, adding `_d` or `_u`;
  `generateIllustratedTrackAtlas(opts?: { line: TrackClass; state: WearState })`

- [ ] **Step 1: Write the failing tests**

```ts
it('a degraded piece names a worn frame, a healthy one its old name', () => {});
it('the worn set has the same anchors as the sound set', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run src/world/track.test.ts src/art`
Expected: FAIL.

- [ ] **Step 3: Implement, and measure**

The first piece of a line and state to need its frames triggers that set's generation; the tint
stands in until it is ready. Record generation time and memory for one set in the pull request. If
one set takes over 200 ms, generate it in steps over several frames.

- [ ] **Step 4: Run them to see them pass, then make the review page**

Run: same command. Then build a review page from renders of the running game under
`G:\DEV\Terepasztal\renders\track-wear\`, publish it, and get Zsolt's approval.

- [ ] **Step 5: Commit** `Track art: worn frames are built when first needed`

### Task 13: The yellow models

**Files:**

- Modify: `public/assets` rolling atlas, `src/data/locomotives.json`, `src/data/wagons.json`,
  `src/data/credits.json`
- Create outside the repository: `models3d/sheets/CODEX-maintenance-sheets.txt`
- Test: `src/ui/credits.test.ts`, `src/data/content.test.ts`

- [ ] **Step 1: Write the Codex brief**

Sheets per `models3d/sheets/CODEX-loco-sheets.txt` for `mow_loco`, `narrow_work_loco` and
`std_ballast_hopper`, all in maintenance yellow. For the Narrow wagon pick a Corvette wagon in the
game and repaint a copy. Models keep their real shape and size.

- [ ] **Step 2: Hand the brief to Zsolt for Codex and wait for the sheets**

- [ ] **Step 3: Bake, render and install in this worktree, with credits for each model**

Use `models3d/run_look_loco.sh` and `install.py`, pointed at this worktree. Do not use the `ship.sh`
default target, which is the locoblk worktree.

- [ ] **Step 4: Run** `node_modules/.bin/vitest run src/data src/ui/credits.test.ts`

Expected: PASS.

- [ ] **Step 5: Review page, full check, pull request**

Show the models turning in a curve on a review page, as with other locomotives. After Zsolt's
approval push and open the pull request into `develop`.
