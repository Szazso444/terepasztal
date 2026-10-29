import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { storesWith, townWith } from '../testing/storeFixtures';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { locoDef, wagonDef } from '../gacha/items';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY, sandPerTile } from './supply';
import {
  Train,
  defaultStop,
  resetTrainIds,
  FAMINE_SPEED_MUL,
  type StopPlan,
  type TickCtx,
} from './trains';
import type { Station } from './stations';
import { StorePool } from './stores';
import { SimStep, startStock, type StepContext } from './step';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

// Trains and the stores (sub-project 1, task 5): a train fills its tanks from the store of the
// depot or warehouse it stops at, or from the store that supplies a coaling stage or water tower
// within `rules.fuelReach`; its crew's food and the sand it spreads are owed on the line and
// settled at the next store it fills up at; electric trains draw from and brake into the grid.

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
});

const ROW = 20;
const GDT = 0.05;

/** A flat grass world, in the production chain given. */
const grass = (supply?: 'simple' | 'full') => simWorld({ terrain: 'grass', size: 64, supply });

/** A stop that loads and unloads nothing and does not wait. */
const quiet = (id: number): StopPlan => ({
  ...defaultStop(id),
  load: 'none',
  unload: 'none',
  waitFull: false,
});

/** The context the fleet hands its trains in a tick at `now`. */
const ctxOf = (w: SimWorld, now = 0) =>
  (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(now, 1);

/**
 * A train of `loco` and an empty `wagon` (a hopper unless named) on the line at column `x` facing west, in the fleet, with
 * the stops given (none: it stands where it is).
 */
function onLine(
  w: SimWorld,
  loco: string,
  x: number,
  stops: Station[] = [],
  wagon = 'wood_hopper',
) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef(loco) }]);
  t.wagons = [{ uid: 2, def: wagonDef(wagon), level: 1, cargo: null, amount: 0, origin: null }];
  expect(t.spawnAt(w.track, x, ROW, Dir.E)).not.toBe(false);
  w.fleet.trains.push(t);
  if (stops.length) {
    t.schedule = stops.map((s) => quiet(s.id));
    expect(t.dispatch(w.track, w.builder, w.map), 'a way to the first stop').toBe(true);
    t.onPathReady(ctxOf(w));
  }
  return t;
}

/** Fleet ticks of GDT until `done` holds (at most `max`); the ticks run. */
function runUntil(w: SimWorld, done: () => boolean, max = 40000) {
  let n = 0;
  for (; n < max && !done(); n++) w.fleet.tick(GDT, (w.clock.time += GDT));
  expect(done(), `done within ${max} ticks`).toBe(true);
  return n;
}

/** Food a train's crew eats in `seconds` of game time. */
const ration = (t: Train, seconds: number) =>
  (t.crew * rules.wheatPerCrew * seconds) / weekSeconds();

/** A depot at the west end of a line along ROW, and its store. */
function depotLine(w: SimWorld) {
  const depot = station(w, 'depot', 4, ROW);
  line(w, 6, ROW, 60);
  return { depot, store: w.stores.byKey(`st:${depot.id}`)! };
}

describe('trains and the stores', () => {
  it('a train refuels at a depot from the depot store', () => {
    const w = grass();
    const { depot, store } = depotLine(w);
    const quarry = station(w, 'quarry', 40, ROW - 1);
    store.amounts.set('coal', 1000);
    store.amounts.set('water', 1000);
    // a nearly empty tender: enough for the 16 tiles to the depot
    const t = onLine(w, 'mallard', 20, [depot, quarry]);
    t.coal = 10;
    t.water = t.waterCap;
    runUntil(w, () => t.coal >= t.coalCap - 1e-9);
    const taken = t.trip.fuel['refuel_coal'] ?? 0;
    expect(taken, 'coal taken').toBeGreaterThan(t.coalCap - 10 - 1e-9);
    expect(1000 - store.get('coal'), 'the depot store gave what the tender took').toBeCloseTo(
      taken,
      9,
    );
  });

  it('a coaling stage in a town draws from the town store', () => {
    const w = grass();
    line(w, 2, ROW, 60);
    const town = townWith(w, { coal: 1000, water: 1000 }, { x: 34, y: ROW - 1 });
    w.builder.free = true;
    expect(w.builder.placeDecor(30, ROW + 1, 'fuel_stop', 0)).not.toBeNull();
    expect(w.builder.placeDecor(32, ROW + 1, 'water_tower', 0)).not.toBeNull();
    w.builder.free = false;
    const quarry = station(w, 'quarry', 50, ROW - 1);
    const t = onLine(w, 'mallard', 10, [quarry]);
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap * 0.3;
    // eastward: the train turns to face the quarry
    runUntil(w, () => t.coal > t.coalCap * 0.9 && t.water > t.waterCap * 0.9);
    const coal = t.trip.fuel['refuel_coal'] ?? 0;
    const water = t.trip.fuel['refuel_water'] ?? 0;
    expect(coal, 'coal taken').toBeGreaterThan(0);
    expect(1000 - town.get('coal'), 'from the town store').toBeCloseTo(coal, 9);
    expect(1000 - town.get('water'), 'from the town store').toBeCloseTo(water, 9);
  });

  it('a coaling stage with no store within 8 tiles serves nothing', () => {
    // the stage's service tiles run to column 32; a warehouse at column 32 + gap is that far
    const plan = (gap: number) => {
      const w = grass();
      line(w, 2, ROW, 60);
      const house = station(w, 'warehouse', 32 + gap, ROW - 1);
      const store = w.stores.byKey(`st:${house.id}`)!;
      store.amounts.set('coal', 500);
      store.amounts.set('water', 500);
      w.builder.free = true;
      expect(w.builder.placeDecor(30, ROW + 1, 'fuel_stop', 0)).not.toBeNull();
      expect(w.builder.placeDecor(30, ROW - 2, 'water_tower', 0)).not.toBeNull();
      w.builder.free = false;
      expect(w.stores.supplierFor(32, ROW), 'premise: it supplies the stage').toBe(
        w.stores.poolOf(store),
      );
      const quarry = station(w, 'quarry', 56, ROW - 1);
      const t = onLine(w, 'mallard', 10, [quarry]);
      t.coal = t.coalCap * 0.3;
      t.water = t.waterCap * 0.3;
      return { planned: t.planFuelDetour(ctxOf(w)), end: t.pathAhead().at(-1) };
    };
    const near = plan(rules.fuelReach);
    expect(rules.fuelReach).toBe(8);
    expect(near.planned, 'a store 8 tiles away serves the stage').toBe(true);
    expect(near.end?.x).toBeGreaterThanOrEqual(28);
    expect(near.end?.x).toBeLessThanOrEqual(32);
    expect(plan(rules.fuelReach + 1).planned, 'one 9 tiles away does not').toBe(false);
  });

  it('crew food is owed on the line and settled at the next store', () => {
    const w = grass();
    const { depot, store } = depotLine(w);
    store.amounts.set('food', 100);
    const t = onLine(w, 'f7', 12);
    t.oil = t.oilCap;
    // half a day standing on the line, no stop
    const half = Math.round(daySeconds() / 2 / GDT);
    for (let i = 0; i < half; i++) w.fleet.tick(GDT, (w.clock.time += GDT));
    expect(t.owed.food, 'owed for half a day').toBeCloseTo(ration(t, half * GDT), 9);
    expect(store.get('food'), 'nothing taken on the line').toBe(100);
    t.schedule = [quiet(depot.id)];
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady(ctxOf(w, w.clock.time));
    const more = runUntil(w, () => store.get('food') < 100);
    // half a day, and the few seconds to the depot
    expect(more * GDT, 'premise: the depot is close').toBeLessThan(daySeconds() / 20);
    expect(100 - store.get('food'), 'the half-day ration').toBeCloseTo(
      ration(t, (half + more) * GDT),
      9,
    );
    expect(t.owed.food, 'settled').toBe(0);
  });

  it('a train owed more than a day of food is slowed', () => {
    const day = (t: Train) => ration(t, daySeconds());
    const bare = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    bare.owed.food = day(bare);
    expect(bare.hungry, 'a day owed').toBe(false);
    bare.owed.food = day(bare) * 1.001;
    expect(bare.hungry, 'more than a day owed').toBe(true);
    const first = (share: number) => {
      const w = grass();
      line(w, 2, ROW, 60);
      const quarry = station(w, 'quarry', 50, ROW - 1);
      const t = onLine(w, 'f7', 10, [quarry]);
      t.oil = t.oilCap;
      t.owed.food = day(t) * share;
      w.fleet.tick(GDT, GDT);
      expect(t.state).toBe('moving');
      return t;
    };
    const fed = first(0.9);
    const hungry = first(1.1);
    expect(fed.hungry).toBe(false);
    expect(hungry.hungry).toBe(true);
    expect(fed.freeSpeed).toBeGreaterThan(0);
    expect(hungry.freeSpeed).toBeCloseTo(fed.freeSpeed * FAMINE_SPEED_MUL, 12);
  });

  it('sand is settled at a store in full mode', () => {
    const w = grass('full');
    expect(sandPerTile(), 'premise: trains spread sand').toBeGreaterThan(0);
    const { depot, store } = depotLine(w);
    store.amounts.set('sand', 100);
    const t = onLine(w, 'f7', 40, [depot]);
    t.oil = t.oilCap;
    runUntil(w, () => t.distance > 10);
    expect(store.get('sand'), 'none taken on the line').toBe(100);
    expect(t.owed.sand, 'owed for the tiles run').toBeCloseTo(sandPerTile() * t.distance, 9);
    runUntil(w, () => store.get('sand') < 100);
    expect(100 - store.get('sand'), 'settled at the depot').toBeCloseTo(
      sandPerTile() * t.distance,
      9,
    );
    expect(t.owed.sand).toBe(0);
  });

  it('braking feeds the power grid', () => {
    const w = grass();
    line(w, 2, ROW, 60);
    w.fleet.powered = () => true;
    w.fleet.supplyAt = () => 'catenary';
    const grid = w.stores.grid;
    grid.amounts.set('power', 50);
    const quarry = station(w, 'quarry', 50, ROW - 1);
    const t = onLine(w, 'kando_v40', 10, [quarry]);
    // running faster than it may: the tick brakes
    t.speed = t.maxSpeed * 3;
    const d0 = t.distance;
    w.fleet.tick(GDT, GDT);
    const step = t.distance - d0;
    expect(step, 'it ran').toBeGreaterThan(0);
    expect(t.speed, 'it braked').toBeLessThan(t.maxSpeed * 3);
    // the motors draw the step's power from the grid, and braking gives 30 % of it back
    expect(grid.get('power') - 50).toBeCloseTo(-t.powerRate * step + 0.3 * t.powerRate * step, 9);
  });

  it('a new train fills its tanks from its depot store', () => {
    const w = grass();
    const { depot, store } = depotLine(w);
    const quarry = station(w, 'quarry', 40, ROW - 1);
    store.amounts.set('coal', 1000);
    store.amounts.set('water', 1000);
    const loco = w.inventory.add('mallard', 0);
    const t = w.fleet.create([loco.uid], [], [depot.id, quarry.id]);
    if (typeof t === 'string') throw new Error(`fleet.create: ${t}`);
    expect(t.coal).toBe(t.coalCap);
    expect(t.water).toBe(t.waterCap);
    expect(store.get('coal')).toBeCloseTo(1000 - t.coalCap, 9);
    expect(store.get('water')).toBeCloseTo(1000 - t.waterCap, 9);
  });

  it('a pooled store serves a trackside point when one of its stores is within reach', () => {
    // two depot stores pooled as Simple mode will pool a rail network: the pool's anchor is its
    // first member's, 20 tiles from the second
    const { stores, depots } = storesWith([
      { amounts: {}, at: { x: 0, y: 0 } },
      { amounts: {}, at: { x: 20, y: 0 } },
    ]);
    const pool = new StorePool(depots);
    stores.poolOf = () => pool;
    expect(pool.anchor, 'premise: the anchor is the first member').toEqual({ x: 0, y: 0 });
    // 5 tiles from the second member, 25 from the first
    expect(stores.fuelSupplierFor(25, 0), 'the second member is in reach').toBe(pool);
    // 3 tiles from the first, 17 from the second
    expect(stores.fuelSupplierFor(3, 0), 'the first member is in reach').toBe(pool);
    // 10 tiles from the second, 30 from the first: within building reach, not within fuelReach
    expect(stores.supplierFor(30, 0), 'premise: it supplies the tile').toBe(pool);
    expect(stores.fuelSupplierFor(30, 0), 'no member in reach').toBeNull();
  });

  /**
   * Runs the train until it has called at `at` and left it: it must have stood there over a day.
   * Then it is not hungry, owes almost nothing and `store` gave its crew's food for the stay (and
   * for the way there, where it did not fill up on arrival).
   */
  function leavesFed(w: SimWorld, t: Train, at: Station, store: { get(id: string): number }) {
    runUntil(w, () => t.atStation === at && t.state === 'loading');
    const arrived = w.clock.time;
    const food = store.get('food');
    runUntil(w, () => t.atStation !== at);
    const stay = w.clock.time - arrived;
    expect(stay, 'premise: it stood there over a day').toBeGreaterThan(daySeconds());
    expect(t.hungry, 'not hungry as it leaves').toBe(false);
    expect(t.owed.food, 'owes no more than a tick of food').toBeLessThan(ration(t, 1));
    expect(food - store.get('food'), 'the crew ate there').toBeGreaterThan(ration(t, stay) * 0.999);
  }

  it('a train standing long at a store pays for its crew there before it leaves', () => {
    const w = grass();
    const { depot } = depotLine(w);
    const house = station(w, 'warehouse', 30, ROW - 1);
    const store = w.stores.byKey(`st:${house.id}`)!;
    store.amounts.set('food', 100);
    const t = onLine(w, 'f7', 20, [house, depot]);
    t.oil = t.oilCap;
    // a stay of a day and a half: a warehouse makes nothing, so nobody waits there for full wagons
    const stay = daySeconds() * 1.5;
    t.schedule = [{ ...quiet(house.id), minDwell: stay, maxDwell: stay }, quiet(depot.id)];
    leavesFed(w, t, house, store);
  });

  it('a train waiting for full wagons at a harvester in a town pays for its crew there', () => {
    const w = grass();
    const { depot } = depotLine(w);
    const town = townWith(w, { food: 100 }, { x: 34, y: ROW - 1 });
    const farm = station(w, 'farm', 38, ROW - 1);
    expect(farm.outlet, 'premise: the farm makes into the town store').toBe(w.stores.poolOf(town));
    const t = onLine(w, 'f7', 20, [farm, depot], 'flatbed');
    t.oil = t.oilCap;
    t.schedule = [{ ...defaultStop(farm.id), unload: 'none', waitFull: true }, quiet(depot.id)];
    leavesFed(w, t, farm, town);
  });

  it('owes nothing after a load of a file without what it owes, and keeps what it owes', () => {
    const track = new TrackGraph(8, 8);
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    t.owed = { food: 0.25, sand: 0.5 };
    const j = t.toJSON();
    expect(Train.fromJSON(j, track).owed).toEqual({ food: 0.25, sand: 0.5 });
    delete j.owed;
    expect(Train.fromJSON(j, track).owed).toEqual({ food: 0, sand: 0 });
  });

  it('with no store in reach, an emergency delivery sends nothing', () => {
    const w = grass();
    line(w, 2, ROW, 60);
    const t = onLine(w, 'f7', 30);
    expect(w.fleet.supplierOf(t)).toBeNull();
    expect(w.fleet.emergencyRefuel(t)).toEqual({});
    expect(t.oil).toBe(0);
  });

  it('a recalled train with no place on the map empties its tanks into the depot store', () => {
    const w = grass();
    const { store } = depotLine(w);
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    w.fleet.trains.push(t);
    expect(t.headTile, 'premise: nowhere on the map').toBeNull();
    t.oil = 40;
    w.fleet.recall(t);
    expect(store.get(t.oilKind)).toBeCloseTo(40, 9);
  });

  it('a recalled train empties its tanks into the store that supplies its tile', () => {
    const w = grass();
    const { store } = depotLine(w);
    const t = onLine(w, 'f7', 12);
    t.oil = 40;
    w.fleet.recall(t);
    expect(store.get(t.oilKind)).toBeCloseTo(40, 9);
  });
});

// Goods between the stores (the final review's C1 and I3): a train on a schedule loads and unloads
// at any station whose goods are a store's (a depot, a warehouse, a Townhouse) or at a harvester in
// a town; a roaming freight train never picks goods up at one, it only takes a producer's own pile
// to the nearest store.
describe('trains moving goods between stores', () => {
  /** A finished house with residents at (x, y), in the editor's way. */
  function home(w: SimWorld, x: number, y: number) {
    w.builder.free = true;
    expect(w.builder.spawnDecor(x, y, 'townhouse', 0)).not.toBeNull();
    w.builder.free = false;
    w.houses.finishAll();
  }
  /** The town store of the Townhouse `hall`, as the registry keeps it. */
  const townOf = (w: SimWorld, hall: Station) =>
    w.stores.byKey(`town:${w.towns.byStation(hall.id)!.id}`)!;
  /** Step the whole world (`SimStep`) until `done` holds. */
  function stepUntil(w: SimWorld, done: () => boolean, max = 40000) {
    const step = new SimStep(w);
    const ctx: StepContext = { mode: 'play', weather: false };
    let n = 0;
    for (; n < max && !done(); n++) w.clock.run((gdt) => step.run(gdt, ctx));
    expect(done(), `done within ${max} steps`).toBe(true);
  }
  /** An empty roaming freight train of an F7 and two hoppers at column `x`, facing west. */
  function roamer(w: SimWorld, x: number) {
    const t = onLine(w, 'f7', x);
    t.wagons.push({ ...t.wagons[0], uid: 3 });
    t.oil = t.oilCap;
    expect(w.fleet.setMode(t, 'freight')).toEqual({ ok: true });
    return t;
  }

  it('full mode: a scheduled train takes the start food from the depot to a town, whose residents are fed', () => {
    const w = grass('full');
    const { depot, store } = depotLine(w);
    for (const [id, n] of Object.entries(startStock())) store.amounts.set(id, n);
    // a flatbed takes the good of its kind the depot holds most of
    const bulk = ['food', 'wheat', 'wood', 'wire'];
    expect(
      bulk.every((c) => c === 'food' || store.get(c) < store.get('food')),
      'premise: food is the most of it',
    ).toBe(true);
    const hall = station(w, 'town', 44, ROW - 1);
    const house = station(w, 'warehouse', 40, ROW - 1);
    const town = townOf(w, hall);
    expect(house.dock!.key, 'premise: the warehouse is a dock of the town store').toBe(town.key);
    home(w, 46, ROW - 4);
    expect(w.houses.residentsTotal(), 'premise: people live there').toBeGreaterThan(0);
    const food = store.get('food');
    const t = onLine(w, 'f7', 20, [depot, house], 'flatbed');
    t.oil = t.oilCap;
    // a player's run: load at the depot, unload in the town
    t.schedule = [
      { ...defaultStop(depot.id), unload: 'none' },
      { ...defaultStop(house.id), load: 'none' },
    ];
    // it loads at the depot, then unloads in the town and sets off again
    let unloaded = false;
    stepUntil(w, () => {
      if (t.atStation === house && town.get('food') > 0) unloaded = true;
      return unloaded && t.atStation !== house;
    });
    expect(store.get('food'), 'out of the depot store').toBeLessThan(food);
    expect(town.get('food'), 'into the town store').toBeGreaterThan(0);
    // a day later the residents have eaten from it and are not starving
    const day = w.clock.time + daySeconds();
    stepUntil(w, () => w.clock.time >= day);
    expect(town.famine).toBe(false);
    expect(town.get('food')).toBeGreaterThan(0);
  });

  it('a scheduled train unloads at a Townhouse into its town store, and loads there', () => {
    const w = grass('full');
    const { depot } = depotLine(w);
    const hall = station(w, 'town', 44, ROW - 1);
    const town = townOf(w, hall);
    expect(w.stores.dockOf(hall)?.key, 'the Townhouse is a dock of its town store').toBe(town.key);
    expect(hall.dock?.key).toBe(town.key);
    const t = onLine(w, 'f7', 20, [hall, depot]);
    t.oil = t.oilCap;
    t.wagons[0] = { ...t.wagons[0], cargo: 'food', amount: 20, origin: depot.id };
    t.schedule = [{ ...defaultStop(hall.id), load: 'none' }, quiet(depot.id)];
    runUntil(w, () => t.atStation === hall && t.wagons[0].amount === 0);
    expect(town.get('food')).toBeCloseTo(20, 9);
    expect(hall.availableCargo()).toContain('food');
    expect(hall.stored('food')).toBeCloseTo(20, 9);
  });

  it('a roaming freight train never picks goods up at a depot, a warehouse, a Townhouse or a harvester in a town', () => {
    const w = grass('full');
    const { depot, store } = depotLine(w);
    store.amounts.set('stone', 500);
    const hall = station(w, 'town', 30, ROW - 1);
    const inTown = station(w, 'warehouse', 26, ROW - 1);
    const farm = station(w, 'farm', 34, ROW - 1);
    const alone = station(w, 'warehouse', 56, ROW - 1);
    const town = townOf(w, hall);
    town.amounts.set('stone', 500);
    town.amounts.set('wheat', 500);
    w.stores.byKey(`st:${alone.id}`)!.amounts.set('stone', 500);
    expect(farm.outlet, 'premise: the farm makes into the town store').not.toBeNull();
    for (const s of [depot, inTown, hall, farm, alone])
      expect(s.availableCargo().length, `premise: goods on hand at ${s.name}`).toBeGreaterThan(0);
    const t = roamer(w, 44);
    expect(w.fleet.chooseNext(t)).toBeNull();
    // and running, nothing comes aboard anywhere
    runUntil(w, () => w.clock.time > 300, 1e6);
    expect(t.wagons.every((g) => !g.cargo && g.amount === 0)).toBe(true);
    expect(t.trip.loaded).toEqual({});
  });

  it('a roaming freight train takes a harvester outside every town to the nearest store, a Townhouse too', () => {
    const w = grass('full');
    const { store } = depotLine(w);
    const quarry = station(w, 'quarry', 30, ROW - 1);
    quarry.storage.set('stone', 40);
    const hall = station(w, 'town', 42, ROW - 1);
    const town = townOf(w, hall);
    expect(quarry.outlet, 'premise: the quarry is outside every town').toBeNull();
    const t = roamer(w, 20);
    expect(w.fleet.chooseNext(t), 'the quarry is the pickup').toBe(quarry.id);
    // the Townhouse is nearer the quarry than the depot: the stone goes there
    runUntil(w, () => town.get('stone') >= 20, 1e6);
    expect(store.get('stone'), 'none to the depot').toBe(0);
    expect(quarry.stored('stone')).toBeLessThan(40);
  });
});
