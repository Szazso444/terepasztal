# Town Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global stockpile with per-town stores, depot stores and warehouse
stores. Works, houses, crews, refuelling and building draw from the nearest store.

**Architecture:**

- **Registry.** A new `StoreRegistry` (`src/sim/stores.ts`) derives one physical `Store` per town,
  per depot and per stand-alone warehouse, plus one power `grid`, from the stations and towns. It
  re-derives them after every change.
- **One interface.** Callers never see a `Store` directly. They get a `ResourceStore`: a
  `StorePool` over one store in Full mode, or over every store on one rail network in Simple mode.
- **Docks.** Depots and warehouses are bound to their store, so the trains' existing warehouse
  load and unload paths keep working.
- **No global stockpile.** `Stockpile` is deleted at the end.

**Tech Stack:** TypeScript 5, Vitest, PixiJS v8 (UI only).

**Spec:** `docs/superpowers/specs/2026-10-27-production-loop-design.md`, section 6 (sub-project 1).
Sections 2 and 13 also apply.

## Global Constraints

- Gate: `npm run typecheck`, `npm run lint`, `npm test` and `npm run format:check` all pass on every
  commit (`AGENTS.md`).
- The worktree has no `node_modules`. Run `npm ci` once in it on the G: drive, never on C:.
- Branch: `gameplay/<issue>-town-stores` from `origin/develop` after the spec branch has merged.
  Core merges into `develop` after QA. Only the author merges to `main`.
- **Rules** live in `src/sim/rules.ts`, each with a `RULE_META` entry. **Player text** lives in
  `src/strings.ts` (`STR`). Code, comments and docs are in English.
- **Spec values, verbatim:**
  - Town reach is `TOWN_RADIUS` (7 tiles round the Townhouse).
  - The Townhouse holds 300 units.
  - A town's capacity is 300 + 1 000 per Warehouse level.
  - Building draws from the nearest store holding the material, within 24 tiles.
  - Simple mode pools every store on one connected rail network.
  - Nothing feeds a global stockpile.
- **Caps are per resource,** as the stockpile's are today:
  - town: `townStoreCap + warehouseCap × Σ warehouse levels`;
  - depot: `depotCap`;
  - stand-alone warehouse: `warehouseCap × level`;
  - grid power: `powerCap + 100 × plants`.
- **Map generation does not change.**
- **Save:** take the next free `SAVE_VERSION` at merge time (21 unless #544 merged first). Add one
  `MIGRATIONS` step and one new save part, `stores`. Remove the `stockpile` part.
- **Old saves** only have to load without error, with their goods kept (CORE, 2026-10-09).

## Review Focus

1. **Removing a store's anchor** (a depot, Townhouse or warehouse that holds goods): the goods move
   to the nearest store within 24 tiles, up to its cap, and the rest is lost. Nothing is
   duplicated. This is tested in Task 1.
2. **Two towns whose reaches overlap:** each house, works and warehouse belongs to exactly one
   town (the nearest Townhouse, as `townAt` decides), and no goods are counted twice. This is
   tested in Task 1.
3. **A cost no single store covers** while the stores together would: refused. The reason names the
   nearest store's shortfall and never sums stores in Full mode. This is tested in Task 3.
4. **A Simple-mode network split** by removing track: each store keeps its own goods, and each new
   pool's `get` equals the sum of its members. This is tested in Task 6.
5. **A v20 save** with a stockpile and warehouse storage: the goods survive the migration, minus
   anything over a cap. A save with no depot left still loads. This is tested in Task 7.

---

## File Structure

| File                                                               | Responsibility                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/sim/stores.ts` (new)                                          | `ResourceStore`, `Store`, `StorePool`, `StoreRegistry`: derivation, lookup, caps, food upkeep, save |
| `src/sim/stores.test.ts` (new)                                     | registry unit tests                                                                                 |
| `src/testing/storeFixtures.ts` (new)                               | `storeWith(amounts)`, a one-store registry for tests that used `new Stockpile()`                    |
| `src/sim/stations.ts`                                              | `Station.dock` binding; storage delegates to it; `roomFor(cargo)`                                   |
| `src/sim/build.ts`                                                 | pays from `stores.payerFor`, refunds to `supplierFor` (else the nearest store)                      |
| `src/sim/buildings.ts`                                             | `tickBuildings` takes a store per works                                                             |
| `src/sim/houses.ts`                                                | food and upgrade costs from the house's town store                                                  |
| `src/sim/trains.ts`, `src/sim/fleet.ts`                            | refuel from dock or fuel store; `owed` food and sand; power from `stores.grid`                      |
| `src/sim/step.ts`                                                  | food upkeep and famine per pool                                                                     |
| `src/gacha/crafting.ts`, `src/sim/commands.ts`, `src/sim/trade.ts` | pay from the selected store                                                                         |
| `src/sim/save.ts`, `src/sim/saveContent.ts`, `src/game.ts`         | `stores` save part, migration, wiring, start stock                                                  |
| `src/ui/resourceBar.ts`, `src/ui/buildInfo.ts`, `src/ui/panels.ts` | store selector, totals, "paid from"                                                                 |
| `src/sim/stockpile.ts`                                             | deleted in Task 9, apart from `fmtCost`, `scaleCost` and `RESOURCE_IDS`, which move to `stores.ts`  |

---

### Task 1: The store registry

**Files:**

- Create: `src/sim/stores.ts`, `src/sim/stores.test.ts`
- Modify: `src/sim/rules.ts`: add `townStoreCap: 300` and `buildReach: 24` with `RULE_META`
  entries (group `Economy`). `stockpileCap` stays until Task 9.

**Interfaces:**

- Produces:
  ```ts
  export interface ResourceStore {
    readonly key: string; // the pool's first member's key
    readonly anchor: { x: number; y: number };
    readonly famine: boolean;
    get(id: string): number;
    cap(id: string): number;
    add(id: string, amount: number): number; // capped; returns stored
    take(id: string, amount: number): number;
    canAfford(cost: Cost, mul?: number): boolean;
    missing(cost: Cost, mul?: number): Cost;
    spend(cost: Cost, mul?: number): boolean; // all or nothing
    refund(cost: Cost, mul?: number): void; // floor(v*mul), capped, overflow lost
  }
  export type StoreKind = 'town' | 'depot' | 'warehouse' | 'grid';
  export interface StoreJSON {
    key: string;
    amounts: Record<string, number>;
    famine: boolean;
  }
  export class Store {
    key;
    kind;
    anchor;
    amounts: Map<string, number>;
    famine: boolean;
    capOf: (id: string) => number;
  }
  export class StorePool implements ResourceStore {
    constructor(members: Store[]);
  }
  export class StoreRegistry {
    readonly grid: Store; // key 'grid', power only
    selected: ResourceStore | null;
    attach(d: { builder: Builder; towns: TownRegistry; track: TrackGraph }): void;
    refresh(): void;
    all(): Store[];
    byKey(key: string): Store | undefined;
    poolOf(s: Store): ResourceStore;
    townStore(x: number, y: number): ResourceStore | null; // the store of the town whose reach covers the tile
    dockOf(st: Station): ResourceStore | null; // depot / warehouse; town store for a warehouse in a town
    nearest(x: number, y: number, range?: number): ResourceStore[]; // Chebyshev from anchor, nearest first, default rules.buildReach
    supplierFor(x: number, y: number): ResourceStore | null; // townStore ?? nearest(x, y)[0] ?? null
    payerFor(cost: Cost, x: number, y: number): ResourceStore | null; // first of nearest() that canAfford
    totals(): Map<string, number>;
    label(r: ResourceStore): string; // town name or station name
    toJSON(): StoreJSON[];
    load(list: StoreJSON[]): void;
  }
  ```
- **Keys:** `town:<townId>`, `st:<stationId>` (a depot, or a warehouse outside every town) and
  `grid`. A town's anchor is its Townhouse; a station store's anchor is the station.

- [ ] **Step 1: Write the failing tests** in `src/sim/stores.test.ts`. Use `simWorld({ terrain:
'grass', size: 64 })`, `line` and `station` from `src/testing/simWorld.ts`, as `towns.test.ts`
      does:
  - `'a town store holds 300 plus 1000 per warehouse level'`:
    - a Townhouse alone gives `cap('wood') === 300`;
    - add a level-2 warehouse in reach: `cap('wood') === 2300`.
  - `'a warehouse in a town is a dock of the town store'`: `dockOf(warehouse).key === 'town:<id>'`.
  - `'a warehouse outside every town has a store of its own'`: key `st:<id>` and `cap === 1000 ×
level`.
  - `'a depot is a store'`: `dockOf(depot).cap('stone') === rules.depotCap`.
  - `'overlapping towns: each tile belongs to the nearest Townhouse'`:
    - Townhouses 10 tiles apart, a house at distance 4 from A and 6 from B;
    - `townStore(house).key === 'town:A'`;
    - `totals()` is the sum of A and B, with nothing counted twice.
  - `'nearest stays within 24 tiles'`:
    - a depot at distance 24 is found, one at 25 is not;
    - two stores come back ordered by distance.
  - `'payerFor skips a nearer store that cannot pay'`.
  - `'removing an anchor moves its goods to the nearest store in reach'`:
    - depot A with 500 wood, depot B 10 tiles away with cap room 400;
    - remove A, then `refresh()`: B holds 400, and the rest is lost;
    - with no store in reach, the goods are gone and `totals().get('wood') === 0`.
  - `'a warehouse store that joins a town merges into it'`:
    - a stand-alone warehouse with 200 stone, then a Townhouse placed in reach, then `refresh()`;
    - the town store holds 200, and the key `st:<id>` is gone.
  - `'toJSON and load round-trip amounts and famine'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/stores.test.ts`. Expected: it fails, because
      `stores.ts` does not exist.
- [ ] **Step 3:** Implement `src/sim/stores.ts`.
  - `refresh()` re-derives the stores from `builder.stations` and `towns.towns` and keeps the
    amounts of every key that survives.
  - It moves orphaned or merged amounts as in the tests.
  - It binds docks (Task 2 adds the field; until then `refresh` only builds stores).
  - In Full mode `poolOf(s)` returns a `StorePool([s])`, cached by key.
  - The grid's cap is `rules.powerCap + 100 × builder.plantCount()`.
- [ ] **Step 4:** Run the same command. Expected: it passes.
- [ ] **Step 5: Commit:** `git commit -m "Stores: a store per town, depot and stand-alone warehouse"`.

### Task 2: Docks — depots and warehouses use their store

**Files:**

- Modify: `src/sim/stations.ts:310-475`, `src/sim/stores.ts` (`refresh` binds docks),
  `src/sim/trains.ts:2441-2468` (unloading).
- Test: `src/sim/freight.test.ts` (extend "a freight train at a warehouse").

**Interfaces:**

- Consumes: `StoreRegistry.dockOf`.
- Produces:
  - `Station.dock: ResourceStore | null`: not saved; set by `StoreRegistry.refresh()`.
  - `Station.roomFor(cargo: string): number`.
  - While `dock` is set, `stored`, `store`, `take`, `totalStored`, `availableCargo` and `capacity`
    read and write the dock. `room` is removed; callers use `roomFor`.

- [ ] **Step 1: Write the failing tests:**
  - `'unloading at a depot fills the depot store'`: a train with 20 stone unloads at the depot;
    then `stores.dockOf(depot).get('stone') === 20`.
  - `'unloading at a town warehouse fills the town store and a second warehouse can load it'`: unload
    20 wood at warehouse A of a town, then a train at warehouse B of the same town loads 20 wood.
  - `'a full store refuses the unload'`:
    - the dock's `cap('wood')` is 300 and it holds 300;
    - the train keeps its load;
    - `roomFor('wood') === 0`.
- [ ] **Step 2:** Run `npx vitest run src/sim/freight.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the binding.**
  - In `tickLoad`, unloading uses `st.roomFor(w.cargo)` and `st.store(...)` for every dock, and
    drops the `ctx.stockpile.add` branch for `def.pool`.
  - Contracts credit as before.
  - Delete the warehouse wording in `stations.json:182` and `strings.ts:28`. The new wording is:
    "Pools its goods with the town's store; outside a town it is a store of its own."
- [ ] **Step 4:** Run `npx vitest run src/sim/freight.test.ts src/sim/stores.test.ts`. Expected:
      PASS.
- [ ] **Step 5: Commit:** `git commit -m "Stations: depots and warehouses load and unload their store"`.

### Task 3: Building pays from the nearest store

**Files:**

- Modify: `src/sim/build.ts`:
  - the constructor takes `stores: StoreRegistry` in place of `stock`;
  - `affordable`, `pay` and `refund` (l.272-294) take a tile;
  - every caller listed at l.368-1274 passes the tile of the thing built or removed.
- Modify: `src/ui/roadStroke.ts:141-150`, `src/strings.ts`.
- Test: `src/sim/build.test.ts` (new `describe('paying from stores')`).

**Interfaces:**

- Consumes: `payerFor`, `nearest`, `supplierFor`.
- Produces:
  - `Builder.payerAt(cost: Cost, x: number, y: number): ResourceStore | null`, used by UI previews.
  - `STR.build.noStoreInReach(range: number, missing: string): string`. Copy: `"No store within
${range} tiles holds ${missing}"`.
- **Which tile pays:**
  - a line or a road stroke pays from its first tile;
  - a refund goes to `supplierFor(tile)`, or else to `nearest(tile, Infinity)[0]`.

- [ ] **Step 1: Write the failing tests:**
  - `'a station pays from the nearest store that holds its cost'`:
    - depot A, 5 tiles away, holds 10 wood; depot B, 12 tiles away, holds 100;
    - placing a farm (wood 30) takes it from B, and A still holds 10.
  - `'nothing in reach: refused with the reach in the reason'`:
    - a store 30 tiles away holds plenty;
    - `checkStation(...).ok === false`, and the reason is `STR.build.noStoreInReach(24, '30 wood,
10 stone')`.
  - `'two stores together are not enough'`: A and B hold 20 wood each, so a 30-wood farm is refused.
  - `'a removed station refunds to the nearest store'`.
  - `'free mode pays nothing'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `affordable(cost, x, y)` returns the store as `PlacementCheck.payer?: string` (the store's key),
    so `place*` pays the store that the check approved.
  - Update `src/testing/simWorld.ts` to construct and attach a `StoreRegistry`.
  - Create `src/testing/storeFixtures.ts`. Its `storeWith(amounts: Record<string, number>,
at = { x: 0, y: 0 })` returns `{ stores, depot }`: a registry with one depot store holding the
    amounts.
  - Port the tests that built `new Stockpile()` for a `Builder` to it.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -m "Build: costs come from the nearest store within 24 tiles"`.

### Task 4: Works, houses, crews and famine per store

**Files:**

- Modify:
  - `src/sim/buildings.ts:171-240`;
  - `src/sim/houses.ts:102-230, 294, 347`;
  - `src/sim/step.ts:205-260`;
  - `src/sim/build.ts`: `crewTotal()` gains `crewSites()`;
  - `src/sim/notices.ts:107`, `src/ui/buildingPanel.ts:61-135`.
- Test: `src/sim/expansion.test.ts`, `src/sim/step.test.ts` ("SimStep: famine"),
  `src/sim/stores.test.ts`.

**Interfaces:**

- Produces:
  - `tickBuildings(buildings: Iterable<Building>, storeOf: (b: Building) => ResourceStore | null,
gameDt: number): void`. A works with no store does not run. Famine is read from its store.
  - `Builder.crewSites(): { x: number; y: number; crew: number }[]`: stations and works.
  - `Station.outlet: ResourceStore | null`: not saved; set by `refresh()` to `townStore(s)` for a
    harvesting station in a town's reach. Its workers carry its output straight there:
    `Station.tick` adds to the outlet instead of its own storage, which stays for stations
    outside towns.
  - `StoreRegistry.tickUpkeep(gameDt: number, eaters: Map<ResourceStore, number>): void`.
    - It takes `eaters × rules.wheatPerCrew × dt / weekSeconds()` food from each pool.
    - It sets `famine` on every member after more than 10 s short, and clears it once fed.
    - It sends the existing two messages through `onMessage`, prefixed with
      `label(pool)`: "Kisfalva: the crews are out of food…".
- **Who eats where:**
  - residents eat at `townStore(house)`;
  - station and works crews eat at `supplierFor(site)`;
  - crews with no store in reach eat nothing and never starve;
  - train crews are Task 5.
- **Who is slowed:** a harvesting station's production takes the famine of `supplierFor(s)`, and a
  works takes its own store's.

- [ ] **Step 1: Write the failing tests:**
  - `'a works runs from its town store and not from another town's'`:
    - a kiln in town A, and 60 wood in town B only;
    - after a week A's store has no coal, and B still holds 60 wood.
  - `'a works outside every town draws from the nearest store in reach'`.
  - `'a farm in a town's reach puts its wheat straight into the town store'`: after a day the farm's
    own `stored('wheat') === 0` and the town store holds the day's output. A farm outside every
    town still fills its own storage.
  - `'one town starves while the other is fed'`:
    - A has food, B has none;
    - after 11 s only B's store is in famine;
    - A's works run at full rate and B's at `FAMINE_PRODUCTION_MUL`.
  - `'a house upgrade pays from its own town store'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/expansion.test.ts src/sim/step.test.ts
src/sim/stores.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `step.ts` builds the eater map each step from `houses.houses` and `builder.crewSites()`.
  - `Stockpile.tick` is no longer called.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Stores: works, houses and crews use their own store; famine per town"`.

### Task 5: Trains refuel from stores; crews and sand are settled at stores

**Files:**

- Modify:
  - `src/sim/trains.ts`:
    - `TickCtx` (l.356-374);
    - the fuel detour (l.615-631);
    - `refuel`, `refuelFromStation` and `drainTo` (l.1254-1340);
    - the moving draws (l.2206-2221);
    - the service stop (l.2250);
    - station arrival (l.2392-2400);
    - `toJSON` and `fromJSON`.
  - `src/sim/fleet.ts:73-112, 486, 569, 620`, `src/ui/trainScreen.ts:234, 383`.
- Test: `src/sim/freight.test.ts`, `src/sim/expansion.test.ts:261`, new
  `src/sim/trainStores.test.ts`.

**Interfaces:**

- Consumes: `dockOf`, `supplierFor`, `grid`.
- Produces:
  - `TickCtx.stores: StoreRegistry`, which replaces `stockpile` and `stockCap`.
  - `Train.refuel(store: ResourceStore, what: { fuel: boolean; water: boolean; fuelFrac?: number;
waterFrac?: number }, mul?: number)`, with today's body on the new type.
    `refuelFromStation` is deleted.
  - `Train.owed: { food: number; sand: number }`. It is saved as optional JSON fields that default
    to 0.
  - `Train.settle(store: ResourceStore): void`. It takes the food and sand owed and resets them.
  - `Train.hungry: boolean`. It is true while the food owed exceeds one game day's crew food; the
    train then runs at `FAMINE_SPEED_MUL`.
- **Where a train refuels:**
  - at a dock: `dockOf(st)`;
  - at a non-dock station with fuel or water, or at a trackside service tile:
    `supplierFor(x, y)`, but only within `rules.fuelReach` (new rule, 8 tiles). See open question 1.
  - every refuel also calls `settle`.
- **Electric trains:** power on the wire, regenerative braking and battery charging use
  `stores.grid`.
- **Fleet:**
  - `refuelAll` previews on a copy of each train's `supplierFor(train tile)`;
  - a new train refuels at its depot's dock;
  - `recall` drains into `supplierFor(train tile) ?? nearest(..., Infinity)[0]`.

- [ ] **Step 1: Write the failing tests:**
  - `'a train refuels at a depot from the depot store'`: a train with an empty tender and the depot
    store with coal 100; after the stop, `get('coal')` has dropped by the amount taken.
  - `'a coaling stage in a town draws from the town store'`.
  - `'a coaling stage with no store within 8 tiles serves nothing'`.
  - `'crew food is owed on the line and settled at the next store'`: run for half a day with no
    stop, then stop at the depot; the depot's food drops by the crew's half-day ration.
  - `'a train owed more than a day of food is slowed'`.
  - `'sand is settled at a store in full mode'`.
  - `'braking feeds the power grid'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/trainStores.test.ts src/sim/freight.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement as in Interfaces.**
  - In Simple mode the old warehouse top-up (trains.ts:2396) is dropped: pooling (Task 6) covers it.
  - Add `rules.fuelReach: 8` with a `RULE_META` entry.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Trains: refuel from stores, settle crew food and sand at the next store"`.

### Task 6: Simple mode pools per rail network

**Files:**

- Modify: `src/sim/stores.ts` (`refresh`, `poolOf`), `src/sim/fleet.ts:126-143` (reuse
  `reachableTiles`).
- Test: `src/sim/stores.test.ts`.

**Interfaces:**

- Consumes: `TrackGraph.reach(seeds)`, `builder.platformTiles(s)`.
- Produces: in Simple mode `poolOf(s)` is the pool of every store whose dock platform tiles, or
  Townhouse platform tiles, lie on one connected network. A store with no track pools alone.
- **Pool rules:**
  - **`get`** is the sum of its members.
  - **`take`** draws nearest-first from the pool's first member's anchor.
  - **`add`** fills the receiving member up to its cap, then overflows to the others nearest-first.
  - **`cap`** is the sum of the members' caps.

- [ ] **Step 1: Write the failing tests:**
  - `'simple: two depots on one line share their goods'`: 100 wood in A, so `poolOf(B).get('wood')
=== 100`, and a farm built near B takes from A.
  - `'simple: cutting the line splits the pool and keeps each store's goods'`: remove a track tile
    and `refresh()`; then `poolOf(A).get('wood') === 100` and `poolOf(B).get('wood') === 0`.
  - `'full: two depots on one line do not share'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/stores.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Label the network components once per `refresh()` and cache the pools
      by component.
- [ ] **Step 4:** Run `npx vitest run src/sim/stores.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Stores: simple mode pools every store on one rail network"`.

### Task 7: Save, migration and start stock

**Files:**

- Modify:
  - `src/sim/save.ts`:
    - `SAVE_VERSION`;
    - `SaveParts` and `SAVE_PART_KEYS`, which add `stores` and drop `stockpile`;
    - a new `MIGRATIONS` step.
  - `src/sim/saveContent.ts:87-180` (`stockpileAmounts`, which becomes `depotStoreAmounts`).
  - `src/game.ts:520-531` (start stock after the start depot), `1186-1210` and `1300-1350`
    (save/load).
- Test: `src/sim/save.test.ts`.

**Interfaces:**

- Produces:
  - **Save part:** `stores: StoreJSON[]`.
  - **Migration step `from: <N-1>`** (note: "the global stockpile moved into the start depot; each
    warehouse keeps its own goods"):
    - `j.stores = [{ key: 'st:<lowest depot station id>', amounts: stockpile minus power, famine },
{ key: 'grid', amounts: { power } }]`;
    - plus `{ key: 'st:<id>', amounts: s.storage }` for every warehouse station, which then has its
      `storage` cleared;
    - with no depot, the stockpile goes to the first warehouse, else to the first Townhouse as
      `town:<its town id>`;
    - `delete j.stockpile`.
  - **On load,** `StoreRegistry.load` then `refresh()` merges warehouse stores that now lie in a
    town (Task 1's rule).
  - **Start stock:** `startFresh` adds `startStock()` to the start depot's store after
    `ensureDepot`.

- [ ] **Step 1: Write the failing tests:**
  - Extend 'has a step for every version', 'has no step that leaves the file as it found it' and
    the `filled` table with `stores`.
  - `'a v<N-1> save keeps its stockpile in the start depot and its warehouse goods'`:
    - a fixture with stockpile `{ wood: 400, power: 50 }` and a warehouse holding `{ stone: 80 }`;
    - after the migration and load, the depot store holds wood 400, the grid power 50, and the
      warehouse's store (or its town's) stone 80.
  - `'a save with no depot loads and keeps its goods'`.
  - `'a new game puts the start stock in the start depot'`: `dockOf(startDepot).get('water') ===
600 × rules.startStock`.
- [ ] **Step 2:** Run `npx vitest run src/sim/save.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write the migration the way the step at `from: 11` (save.ts:452-488)
      edits the stockpile and the station storage.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Save: stores replace the stockpile; old stockpiles move into the start depot"`.

### Task 8: Crafting, market and trade from the selected store; the top bar

**Files:**

- Modify:
  - `src/gacha/crafting.ts:85-200`;
  - `src/sim/commands.ts:27-146`;
  - `src/sim/trade.ts:34-136`;
  - `src/ui/resourceBar.ts:100-135`;
  - `src/ui/buildInfo.ts:113`;
  - `src/ui/panels.ts:110-540`;
  - `src/ui/marketScreen.ts`, `src/ui/craftingScreen.ts`, `src/ui/townPanel.ts`,
    `src/ui/stationPanel.ts:131`;
  - `src/game.ts` (advisor l.2048-2072; `stockCap` removed);
  - `src/strings.ts`.
- Test: `src/gacha/crafting.test.ts`, `src/sim/trade.test.ts`, `src/sim/commands.test.ts`.

**Interfaces:**

- **Crafting:** `Crafting.canCraft(id, store: ResourceStore)` and `Crafting.craft(id, store:
ResourceStore)`. Refunds go to the same store.
- **Market:** `Commands.spotBuy(cargoId, n, store)` and `Commands.spotSell(cargoId, n, store)`.
- **Trade desk:** `TradeDesk.storeKey: string | null` is saved with the desk. Deals settle with
  `byKey(storeKey)`, or with `selected` when that store is gone.
- **Default store:** `StoreRegistry.selected` defaults to the start depot's pool. Clicking a town,
  a depot or a warehouse selects its store.
- **Top bar:**
  - `ResourceBar.update(store: ResourceStore, label: string, totals: Map<string, number>)`;
  - the bar shows the selected store's amounts and caps, with `label` as a heading button;
  - the button cycles through `stores.all()` pools in label order;
  - the tooltip adds "All stores: N".
- **Build preview:** `BuildInfo` shows `STR.build.paidFrom(label)`, copy `"Paid from ${label}"`,
  or the `noStoreInReach` reason.

- [ ] **Step 1: Write the failing tests:**
  - `'crafting pays from the given store'`.
  - `'spot buy fills the given store up to its cap'`.
  - `'a standing deal settles with its store, and with the selected store once that store is gone'`.
- [ ] **Step 2:** Run `npx vitest run src/gacha/crafting.test.ts src/sim/trade.test.ts
src/sim/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the sim side, then the UI.**
- [ ] **Step 4:** Run `npm test`. Then check in the browser preview:
  - start a new game;
  - the top bar shows the start depot's store;
  - build a Townhouse and a warehouse and cycle the bar to the town;
  - place a farm 30 tiles from every store and see the `noStoreInReach` reason.
    Take a screenshot of each for the review page.
- [ ] **Step 5: Commit:** `git commit -m "UI: the top bar shows the selected store; crafting and the market use it"`.

### Task 9: Remove the stockpile

**Files:**

- Delete: `Stockpile` from `src/sim/stockpile.ts`. Move `RESOURCE_IDS`, `fmtCost` and `scaleCost`
  to `src/sim/stores.ts` and update their importers (`buildController.ts`, `toolbar.ts`,
  `upgradeView.ts`).
- Modify:
  - `src/sim/rules.ts`: remove `stockpileCap` and its `RULE_META`;
  - `src/sim/stats.ts:10`: `resourceStats` reads the flows of the selected store;
  - every remaining test that imports `Stockpile`;
  - `CHANGELOG.md` (an Unreleased entry).
- Test: the whole suite.

- [ ] **Step 1:** Run `grep -rn "Stockpile\|stockpile\b\|stockCap" src`. Expected: only migration
      code in `save.ts` and its tests.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run format:check`.
      Expected: all pass.
- [ ] **Step 3: Commit:** `git commit -m "Stores: the global stockpile is gone"`.

---

## Open question for the author before Task 5

1. **Fuel buildings outside towns.** The spec says a fuel building outside a town has "its own
   tank, filled by train". This plan serves it from the nearest store within 8 tiles instead, so
   a Warehouse or depot next to it is its tank, filled by trains unloading there. A true tank
   would need decor storage and a new unloading stop at decor. Is the Warehouse version acceptable?
