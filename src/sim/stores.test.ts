import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { Store, StorePool, StoreRegistry, previewOf } from './stores';
import { setSupplyMode } from './supply';
import { levelMul } from '../gacha/items';
import type { Station } from './stations';
import { defaultStop, Train, type StopPlan } from './trains';
import { content } from '../data/content';
import { Dir } from '../engine/iso';
import { SimStep, startStock, type StepContext } from './step';
import { buildingDef, tickBuildings, type Building } from './buildings';
import { STR } from '../strings';
import { depotWith, storesWith } from '../testing/storeFixtures';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
// a test that sets the supply mode leaves it as it found it
afterEach(() => setSupplyMode('simple'));

/**
 * A flat world with a long line and a store registry attached, as Task 3 will wire it. Stores on
 * the one line share their goods in Simple mode; the tests of a single store's caps, docks and
 * goods run in Full mode, where each stands alone.
 */
function world() {
  const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
  line(w, 2, 30, 90);
  const stores = new StoreRegistry();
  stores.attach({ builder: w.builder, towns: w.towns, track: w.track });
  return { w, stores };
}

/** Bring the towns and the stores up to date after the builder placed or removed something. */
function sync(w: SimWorld, stores: StoreRegistry) {
  w.towns.refresh();
  stores.refresh();
}

describe('town stores', () => {
  it('a town store holds 300 plus 1000 per warehouse level', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    sync(w, stores);
    const town = stores.townStore(hall.x, hall.y)!;
    expect(town.key).toBe(`town:${w.towns.byStation(hall.id)!.id}`);
    expect(town.cap('wood')).toBe(300);
    const wh = station(w, 'warehouse', 24, 29);
    wh.level = 2;
    sync(w, stores);
    expect(stores.townStore(hall.x, hall.y)!.cap('wood')).toBe(2300);
  });

  it('a warehouse in a town is a dock of the town store', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const wh = station(w, 'warehouse', 24, 29);
    sync(w, stores);
    const t = w.towns.byStation(hall.id)!;
    expect(stores.dockOf(wh)!.key).toBe(`town:${t.id}`);
    expect(stores.byKey(`st:${wh.id}`)).toBeUndefined();
  });

  it('a warehouse outside every town has a store of its own', () => {
    const { w, stores } = world();
    const wh = station(w, 'warehouse', 40, 29);
    wh.level = 3;
    sync(w, stores);
    const dock = stores.dockOf(wh)!;
    expect(dock.key).toBe(`st:${wh.id}`);
    expect(dock.cap('coal')).toBe(3000);
  });

  it('a level-up raises the caps at the next refresh', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const inTown = station(w, 'warehouse', 24, 29);
    const alone = station(w, 'warehouse', 60, 29);
    sync(w, stores);
    const town = stores.townStore(hall.x, hall.y)!;
    const own = stores.dockOf(alone)!;
    expect([town.cap('wood'), own.cap('wood')]).toEqual([1300, 1000]);
    inTown.level = 3;
    alone.level = 2;
    sync(w, stores);
    expect([town.cap('wood'), own.cap('wood')]).toEqual([3300, 2000]);
  });

  it('a depot is a store', () => {
    const { w, stores } = world();
    const depot = station(w, 'depot', 40, 24);
    sync(w, stores);
    expect(stores.dockOf(depot)!.key).toBe(`st:${depot.id}`);
    expect(stores.dockOf(depot)!.cap('stone')).toBe(rules.depotCap);
  });

  it('a station that is no store has no dock', () => {
    const { w, stores } = world();
    const farm = station(w, 'farm', 40, 29);
    sync(w, stores);
    expect(stores.dockOf(farm)).toBeNull();
  });

  it('overlapping towns: each tile belongs to the nearest Townhouse', () => {
    const { w, stores } = world();
    const a = station(w, 'town', 20, 29);
    // the builder keeps Townhouses 25 tiles apart; moving one in makes the reaches overlap
    const b = station(w, 'town', 50, 29);
    b.x = 30;
    sync(w, stores);
    const ta = w.towns.byStation(a.id)!;
    const tb = w.towns.byStation(b.id)!;
    expect(stores.townStore(24, 29)!.key).toBe(`town:${ta.id}`);
    expect(stores.townStore(36, 29)!.key).toBe(`town:${tb.id}`);
    expect(stores.townStore(60, 29)).toBeNull();
    stores.byKey(`town:${ta.id}`)!.add('wood', 100);
    stores.byKey(`town:${tb.id}`)!.add('wood', 50);
    expect(stores.totals().get('wood')).toBe(150);
  });
});

describe('finding a store', () => {
  it('nearest stays within 24 tiles', () => {
    const { w, stores } = world();
    const near = station(w, 'depot', 30, 24);
    const edge = station(w, 'depot', 46, 24);
    const far = station(w, 'depot', 50, 24);
    sync(w, stores);
    // from (22, 24): the depot at x=46 is 24 away, the one at x=50 is 28
    expect(stores.byKey(`st:${near.id}`)!.anchor).toEqual({ x: 30, y: 24 });
    const keys = stores.nearest(22, 24).map((s) => s.key);
    expect(keys).toEqual([`st:${near.id}`, `st:${edge.id}`]);
    expect(keys).not.toContain(`st:${far.id}`);
    // 25 tiles is out of reach
    expect(stores.nearest(21, 24).map((s) => s.key)).toEqual([`st:${near.id}`]);
    // a wider range finds all three, nearest first
    expect(stores.nearest(22, 24, 40).map((s) => s.key)).toEqual([
      `st:${near.id}`,
      `st:${edge.id}`,
      `st:${far.id}`,
    ]);
  });

  it('supplierFor takes the town store, else the nearest', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 40, 24);
    sync(w, stores);
    const t = w.towns.byStation(hall.id)!;
    expect(stores.supplierFor(22, 29)!.key).toBe(`town:${t.id}`);
    expect(stores.supplierFor(36, 29)!.key).toBe(`st:${depot.id}`);
    expect(stores.supplierFor(80, 29)).toBeNull();
  });

  it('payerFor skips a nearer store that cannot pay', () => {
    const { w, stores } = world();
    const a = station(w, 'depot', 30, 24);
    const b = station(w, 'depot', 40, 24);
    sync(w, stores);
    stores.byKey(`st:${a.id}`)!.add('wood', 5);
    stores.byKey(`st:${b.id}`)!.add('wood', 100);
    expect(stores.payerFor({ wood: 50 }, 31, 24)!.key).toBe(`st:${b.id}`);
    expect(stores.payerFor({ wood: 5 }, 31, 24)!.key).toBe(`st:${a.id}`);
    expect(stores.payerFor({ wood: 500 }, 31, 24)).toBeNull();
  });
});

describe('a changing set of stores', () => {
  function twoDepots() {
    const { w, stores } = world();
    const a = station(w, 'depot', 30, 24);
    const b = station(w, 'depot', 40, 24);
    sync(w, stores);
    return { w, stores, a, b };
  }

  it('removing an anchor moves its goods to the nearest store in reach', () => {
    const { w, stores, a, b } = twoDepots();
    stores.byKey(`st:${a.id}`)!.add('wood', 500);
    // room for 400 more wood at B
    stores.byKey(`st:${b.id}`)!.add('wood', rules.depotCap - 400);
    expect(w.builder.removeStation(a)).toBe(true);
    sync(w, stores);
    expect(stores.byKey(`st:${a.id}`)).toBeUndefined();
    expect(stores.byKey(`st:${b.id}`)!.get('wood')).toBe(rules.depotCap);
    expect(stores.totals().get('wood')).toBe(rules.depotCap);
  });

  it('removing an anchor with no store in reach loses the goods', () => {
    const { w, stores } = world();
    const a = station(w, 'depot', 30, 24);
    station(w, 'depot', 70, 24);
    sync(w, stores);
    stores.byKey(`st:${a.id}`)!.add('wood', 500);
    expect(stores.totals().get('wood')).toBe(500);
    w.builder.removeStation(a);
    sync(w, stores);
    expect(stores.totals().get('wood') ?? 0).toBe(0);
  });

  it('a warehouse store that joins a town merges into it', () => {
    const { w, stores } = world();
    const wh = station(w, 'warehouse', 40, 29);
    sync(w, stores);
    stores.byKey(`st:${wh.id}`)!.add('stone', 200);
    const hall = station(w, 'town', 36, 29);
    sync(w, stores);
    const t = w.towns.byStation(hall.id)!;
    expect(stores.byKey(`town:${t.id}`)!.get('stone')).toBe(200);
    expect(stores.byKey(`st:${wh.id}`)).toBeUndefined();
    expect(stores.totals().get('stone')).toBe(200);
  });

  it('keeps the goods of every store that survives a refresh', () => {
    const { stores, b } = twoDepots();
    stores.byKey(`st:${b.id}`)!.add('coal', 70);
    const before = stores.byKey(`st:${b.id}`);
    stores.refresh();
    expect(stores.byKey(`st:${b.id}`)).toBe(before);
    expect(stores.byKey(`st:${b.id}`)!.get('coal')).toBe(70);
  });
});

describe('a store', () => {
  function depotStore() {
    const { w, stores } = world();
    const d: Station = station(w, 'depot', 30, 24);
    sync(w, stores);
    return { w, stores, s: stores.dockOf(d)! };
  }

  it('caps what it takes in, spends all or nothing and refunds rounded down', () => {
    const { s } = depotStore();
    expect(s.add('wood', rules.depotCap + 50)).toBe(rules.depotCap);
    expect(s.take('wood', rules.depotCap - 100)).toBe(rules.depotCap - 100);
    expect(s.get('wood')).toBe(100);
    expect(s.canAfford({ wood: 60 }, 2)).toBe(false);
    expect(s.missing({ wood: 60, stone: 3 }, 2)).toEqual({ wood: 20, stone: 6 });
    expect(s.spend({ wood: 60 }, 2)).toBe(false);
    expect(s.get('wood')).toBe(100);
    expect(s.spend({ wood: 30 }, 2)).toBe(true);
    expect(s.get('wood')).toBe(40);
    s.refund({ wood: 5 }, 0.5);
    expect(s.get('wood')).toBe(42);
  });

  it('holds no power; the grid holds power and nothing else', () => {
    const { w, stores, s } = depotStore();
    expect(s.cap('power')).toBe(0);
    expect(stores.grid.key).toBe('grid');
    const grid = stores.poolOf(stores.grid);
    expect(grid.cap('wood')).toBe(0);
    expect(grid.cap('power')).toBe(rules.powerCap + 100 * w.builder.plantCount());
  });

  it('is its own pool of one, the same object every time', () => {
    const { stores } = depotStore();
    const d = stores.all().find((x) => x.kind === 'depot')!;
    expect(stores.poolOf(d)).toBe(stores.poolOf(d));
    expect(stores.poolOf(d).key).toBe(d.key);
  });

  it('is named after its town or its station', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 40, 24);
    sync(w, stores);
    const t = w.towns.byStation(hall.id)!;
    expect(stores.label(stores.townStore(20, 29)!)).toBe(t.name);
    expect(stores.label(stores.dockOf(depot)!)).toBe(depot.name);
  });
});

describe('binding docks at refresh', () => {
  it('gives depots and warehouses their dock and every other station none', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 30, 24);
    const wh = station(w, 'warehouse', 60, 29);
    wh.level = 2;
    const producer = station(w, 'lumber', 40, 29);
    sync(w, stores);
    expect(hall.dock).toBeNull();
    expect(producer.dock).toBeNull();
    expect(depot.dock).toBe(stores.dockOf(depot));
    expect(depot.dock!.key).toBe(`st:${depot.id}`);
    expect(wh.dock).toBe(stores.dockOf(wh));
    expect(wh.dock!.key).toBe(`st:${wh.id}`);
    expect(wh.dock!.cap('wood')).toBe(rules.warehouseCap * 2);
  });

  it('rebinds a warehouse to the town store when a town grows round it', () => {
    const { w, stores } = world();
    const wh = station(w, 'warehouse', 24, 29);
    sync(w, stores);
    expect(wh.dock!.key).toBe(`st:${wh.id}`);
    const hall = station(w, 'town', 20, 29);
    sync(w, stores);
    expect(wh.dock!.key).toBe(`town:${w.towns.byStation(hall.id)!.id}`);
    expect(wh.dock).toBe(stores.townStore(hall.x, hall.y));
  });
});

describe('a station with a dock', () => {
  function town() {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const a = station(w, 'warehouse', 24, 29);
    const b = station(w, 'warehouse', 28, 29);
    sync(w, stores);
    return { w, stores, hall, a, b };
  }

  it('stores, counts and gives back goods through the dock', () => {
    const { a } = town();
    expect(a.store('wood', 120)).toBe(120);
    expect(a.stored('wood')).toBe(120);
    expect(a.dock!.get('wood')).toBe(120);
    expect(a.storage.size).toBe(0);
    a.store('coal', 30);
    expect(a.totalStored()).toBe(150);
    expect(a.take('wood', 50)).toBe(50);
    expect(a.take('wood', 500)).toBe(70);
    expect(a.take('wood', 1)).toBe(0);
    expect(a.totalStored()).toBe(30);
  });

  it('lists the goods another warehouse of the town unloaded', () => {
    const { a, b } = town();
    expect(b.availableCargo()).toEqual([]);
    a.store('wood', 40);
    a.store('coal', 0.5);
    expect(b.availableCargo()).toEqual(['wood']);
    expect(b.stored('wood')).toBe(40);
    expect(b.take('wood', 15)).toBe(15);
    expect(a.stored('wood')).toBe(25);
  });

  it('has room per good, not for all goods together', () => {
    const { a } = town();
    const cap = a.capacity;
    expect(a.roomFor('wood')).toBe(cap);
    a.store('wood', cap);
    expect(a.roomFor('wood')).toBe(0);
    expect(a.roomFor('coal')).toBe(cap);
  });

  it('is full by its fullest good, not by the sum of its goods', () => {
    const { a, b } = town();
    expect(a.fill()).toBe(0);
    a.store('wood', a.capacity / 2);
    a.store('coal', a.capacity / 4);
    expect(a.totalStored()).toBe((a.capacity * 3) / 4);
    expect(a.fill()).toBeCloseTo(0.5);
    expect(a.fullest()).toBeCloseTo(a.capacity / 2);
    expect(b.fill()).toBeCloseTo(0.5);
    a.store('wood', a.capacity);
    expect(a.fill()).toBe(1);
    expect(a.fullest()).toBe(a.capacity);
  });

  it('is full by the sum of its goods when it has no dock', () => {
    const { w } = world();
    const mine = station(w, 'lumber', 40, 29);
    expect(mine.dock).toBeNull();
    mine.storage.set('wood', mine.capacity / 4);
    mine.storage.set('coal', mine.capacity / 4);
    expect(mine.fill()).toBeCloseTo(0.5);
    expect(mine.fullest()).toBeCloseTo(mine.capacity / 2);
  });

  it('while closed refuses goods but lets them be taken', () => {
    const { a, b } = town();
    a.store('wood', 100);
    a.work = { to: 2, left: 100, total: 100 };
    expect(a.closed).toBe(true);
    expect(a.roomFor('wood')).toBe(0);
    expect(a.store('wood', 10)).toBe(0);
    expect(a.stored('wood')).toBe(100);
    expect(a.take('wood', 30)).toBe(30);
    expect(b.stored('wood')).toBe(70);
  });
});

describe('saving stores', () => {
  it('toJSON and load round-trip amounts and famine', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 40, 24);
    sync(w, stores);
    const t = stores.byKey(stores.townStore(hall.x, hall.y)!.key)!;
    t.add('food', 120);
    t.famine = true;
    stores.byKey(`st:${depot.id}`)!.add('coal', 800);
    stores.grid.add('power', 40);
    const saved = JSON.parse(JSON.stringify(stores.toJSON()));

    const again = new StoreRegistry();
    again.attach({ builder: w.builder, towns: w.towns, track: w.track });
    again.refresh();
    again.load(saved);
    expect(again.byKey(t.key)!.get('food')).toBe(120);
    expect(again.byKey(t.key)!.famine).toBe(true);
    expect(again.byKey(`st:${depot.id}`)!.get('coal')).toBe(800);
    expect(again.byKey(`st:${depot.id}`)!.famine).toBe(false);
    expect(again.grid.get('power')).toBe(40);
    expect(again.toJSON()).toEqual(saved);
  });

  it('load starts from what was saved alone, however often and over whatever it runs', () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 40, 24);
    sync(w, stores);
    const t = stores.byKey(stores.townStore(hall.x, hall.y)!.key)!;
    t.add('food', 120);
    stores.byKey(`st:${depot.id}`)!.add('coal', 800);
    const saved = JSON.parse(JSON.stringify(stores.toJSON()));
    // goods and a famine that came after the save
    t.add('wood', 30);
    t.famine = true;
    stores.byKey(`st:${depot.id}`)!.add('coal', 100);
    stores.grid.add('power', 40);
    stores.load(saved);
    expect(stores.toJSON()).toEqual(saved);
    stores.load(saved);
    expect(stores.toJSON()).toEqual(saved);
  });

  it('clear forgets every store, what each held and every famine', () => {
    const { w, stores } = world();
    station(w, 'depot', 40, 24);
    sync(w, stores);
    stores.all()[1].add('coal', 800);
    stores.grid.add('power', 40);
    stores.grid.famine = true;
    stores.clear();
    expect(stores.all()).toEqual([stores.grid]);
    expect(stores.toJSON()).toEqual([{ key: 'grid', amounts: {}, famine: false }]);
    // and the stations bring theirs back, empty
    stores.refresh();
    expect(stores.totals().size).toBe(0);
    expect(stores.all().map((s) => s.kind)).toEqual(['grid', 'depot']);
  });

  it("load gives a saved store with no place of its own to the store that covers it, else the start depot's", () => {
    const { w, stores } = world();
    const hall = station(w, 'town', 20, 29);
    const inTown = station(w, 'warehouse', 24, 29);
    const depot = station(w, 'depot', 40, 24);
    station(w, 'depot', 50, 24);
    sync(w, stores);
    const town = stores.townStore(hall.x, hall.y)!.key;
    expect(stores.byKey(`st:${inTown.id}`), 'a warehouse in a town has no store').toBeUndefined();
    stores.load([
      { key: town, amounts: { food: 10 }, famine: false },
      // past the town's cap: what a load brings is kept whole, as a store's own goods are
      { key: `st:${inTown.id}`, amounts: { stone: 5000 }, famine: false },
      { key: 'unplaced', amounts: { wood: 400 }, famine: true },
      { key: 'st:999', amounts: { wood: 6, iron: 2 }, famine: false },
    ]);
    expect(stores.byKey(town)!.get('food')).toBe(10);
    expect(stores.byKey(town)!.get('stone')).toBe(5000);
    const start = stores.byKey(`st:${depot.id}`)!;
    expect(Object.fromEntries(start.amounts)).toEqual({ wood: 406, iron: 2 });
    // a famine goes with the goods; the next meal there ends it, as any famine
    expect(start.famine).toBe(true);
    expect(stores.byKey(town)!.famine).toBe(false);
  });
});

describe('works and harvesters at their store', () => {
  /** A world with the stores the builder keeps (`w.stores`) and two towns 26 tiles apart. */
  function twoTowns() {
    // in Simple mode two towns on one line are one store; these are about each town's own
    const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
    line(w, 2, 30, 90);
    const a = station(w, 'town', 20, 29);
    const b = station(w, 'town', 46, 29);
    const storeA = w.stores.townStore(a.x, a.y)!;
    const storeB = w.stores.townStore(b.x, b.y)!;
    return { w, a, b, storeA, storeB };
  }
  /** Places a works through the builder in the editor's way. */
  function works(w: SimWorld, id: string, x: number, y: number): Building {
    w.builder.free = true;
    const b = w.builder.placeBuilding(x, y, id);
    w.builder.free = false;
    if (!b) throw new Error(`no ${id} at ${x},${y}`);
    return b;
  }
  const tick = (w: SimWorld, dt: number) =>
    tickBuildings(w.builder.buildings.values(), (b) => w.stores.worksStore(b), dt);

  it("a works runs from its town store and not from another town's", () => {
    const { w, storeA, storeB } = twoTowns();
    // town B's store is within the works' build reach, but the works is in town A
    const kiln = works(w, 'kiln', 24, 25);
    expect(w.stores.townStore(kiln.x, kiln.y)).toBe(storeA);
    storeB.add('wood', 60);
    tick(w, weekSeconds());
    expect(storeA.get('coal')).toBe(0);
    expect(storeB.get('wood')).toBe(60);
    expect(kiln.reason).toBe('inputs');
    // stocked, it runs from its own town
    storeA.add('wood', 60);
    tick(w, weekSeconds());
    expect(storeA.get('coal')).toBeGreaterThan(0);
    expect(storeB.get('wood')).toBe(60);
  });

  it('a works outside every town draws from the nearest store in reach', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    line(w, 2, 30, 90);
    const near = depotWith(w, { wood: 100 }, { x: 40, y: 24 });
    const far = depotWith(w, { wood: 100 }, { x: 60, y: 24 });
    const kiln = works(w, 'kiln', 48, 20);
    expect(w.stores.townStore(kiln.x, kiln.y)).toBeNull();
    tick(w, weekSeconds());
    expect(near.get('wood')).toBeLessThan(100);
    expect(near.get('coal')).toBe((100 - near.get('wood')) / 2);
    expect(far.get('wood')).toBe(100);
    expect(far.get('coal')).toBe(0);
  });

  it('a works with no store in reach does not run, and its notice says no store is in reach', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const kiln = works(w, 'kiln', 48, 20);
    expect(w.stores.worksStore(kiln)).toBeNull();
    tick(w, weekSeconds());
    expect([kiln.active, kiln.reason, kiln.acc, kiln.made]).toEqual([
      false,
      'inputs',
      0,
      undefined,
    ]);
    w.notices.refresh({ trains: [], builder: w.builder, power: w.power });
    const notice = w.notices.list.find((n) => n.key === `b${kiln.x},${kiln.y}:in`);
    expect(notice?.text).toBe(STR.notice.noStore(buildingDef('kiln').name, rules.buildReach));
  });

  it("a power plant's power goes to the grid, its fuel comes from its store", () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const depot = depotWith(w, { coal: 50, wood: 50, water: 50 }, { x: 40, y: 24 });
    const plant = works(w, 'power_plant', 44, 20);
    tick(w, daySeconds());
    expect(depot.get('coal')).toBeLessThan(50);
    expect(w.stores.grid.get('power')).toBe(plant.made?.power);
    expect(w.stores.grid.get('power')).toBeGreaterThan(0);
  });

  it("a farm in a town's reach puts its wheat straight into the town store", () => {
    const { w, a, storeA } = twoTowns();
    const farm = station(w, 'farm', a.x + 5, a.y);
    const alone = station(w, 'farm', 70, 29);
    expect(farm.outlet).toBe(storeA);
    expect(alone.outlet).toBeNull();
    const day = (s: Station) =>
      (s.productionPerWeek * s.productionMul * daySeconds()) / weekSeconds();
    expect(day(farm)).toBeGreaterThan(0);
    farm.tick(daySeconds());
    alone.tick(daySeconds());
    // its own storage stays empty; what it has on hand for trains is the town store's
    expect(farm.storage.get('wheat') ?? 0).toBe(0);
    expect(storeA.get('wheat')).toBeCloseTo(day(farm), 9);
    expect(farm.stored('wheat')).toBe(storeA.get('wheat'));
    // a farm outside every town still fills its own storage
    expect(alone.stored('wheat')).toBeCloseTo(day(alone), 9);
  });
});

describe('upkeep and famine per store', () => {
  /** A depot store and a town store, each in a pool of one. */
  function twoStores() {
    const w = simWorld({ terrain: 'grass', size: 96 });
    line(w, 2, 30, 90);
    const hall = station(w, 'town', 20, 29);
    const depot = station(w, 'depot', 60, 24);
    const town = w.stores.townStore(hall.x, hall.y)!;
    const dock = w.stores.dockOf(depot)!;
    const said: string[] = [];
    w.stores.onMessage = (m, k) => said.push(`${k}: ${m}`);
    return { w, town, dock, said, name: w.towns.byStation(hall.id)!.name };
  }

  it('eats food once per weekly rate and leaves wheat for the mill', () => {
    const { w, town } = twoStores();
    town.add('food', 100);
    town.add('wheat', 20);
    for (let i = 0; i < 7; i++) w.stores.tickUpkeep(daySeconds(), new Map([[town, 24]]));
    expect(town.get('food')).toBeCloseTo(76);
    expect(town.get('wheat')).toBe(20);
    expect(town.famine).toBe(false);
  });

  it('starves a store after more than 10 s short, with its name in the message, and feeds it again', () => {
    const { w, town, dock, said, name } = twoStores();
    dock.add('food', 100);
    const eaters = new Map([
      [town, 10],
      [dock, 10],
    ]);
    w.stores.tickUpkeep(10, eaters);
    expect(town.famine).toBe(false);
    w.stores.tickUpkeep(0.5, eaters);
    expect([town.famine, dock.famine]).toEqual([true, false]);
    expect(said).toEqual([`warn: ${name}: the crews are out of food: production halved`]);
    // every member of the pool is marked
    expect(w.stores.byKey(town.key)!.famine).toBe(true);
    town.add('food', 50);
    w.stores.tickUpkeep(1, eaters);
    expect(town.famine).toBe(false);
    expect(said[1]).toBe(`good: ${name}: food is back; crews are fed again`);
  });

  it('a store nobody eats at any more is fed', () => {
    const { w, town } = twoStores();
    w.stores.tickUpkeep(11, new Map([[town, 5]]));
    expect(town.famine).toBe(true);
    w.stores.tickUpkeep(1, new Map());
    expect(town.famine).toBe(false);
  });
});

describe('trains at a harvester in a town', () => {
  /**
   * A town at (20, 29) with a farm in its reach at (25, 29), a warehouse at the far end of the line
   * and a depot at its west end, its store holding a new game's stock (a new train fills its tanks
   * from it), and a train of an Adler and a flatbed running farm, warehouse, with or without
   * waiting for full wagons at the farm.
   */
  function farmLine(waitFull: boolean) {
    const w = simWorld({ terrain: 'grass', size: 96 });
    // the depot is on the town's line, so in Simple mode its stock is the town's: it holds no wheat
    const stock = startStock();
    stock.wheat = 0;
    depotWith(w, stock, { x: 4, y: 30 });
    line(w, 6, 30, 90);
    const hall = station(w, 'town', 20, 29);
    const farm = station(w, 'farm', 25, 29);
    const warehouse = station(w, 'warehouse', 80, 29);
    const town = w.stores.townStore(hall.x, hall.y)!;
    expect(farm.outlet).toBe(town);
    const loco = w.inventory.add('adler', 0);
    const flat = w.inventory.add('flatbed', 0);
    const stop = (id: number): StopPlan => ({ ...defaultStop(id), unload: 'none', waitFull });
    const t = w.fleet.create([loco.uid], [flat.uid], [stop(farm.id), stop(warehouse.id)]);
    if (typeof t === 'string') throw new Error(`fleet.create: ${t}`);
    return { w, farm, town, t };
  }
  /** Steps the world until the train has called at the farm and left it; the game time it left. */
  function untilItLeaves(w: SimWorld, t: Train, farm: Station) {
    const step = new SimStep(w);
    const ctx: StepContext = {
      mode: 'play',
      weather: false,
    };
    let called = false;
    for (let i = 0; i < 20000; i++) {
      w.clock.run((gdt) => step.run(gdt, ctx));
      if (t.atStation === farm) called = true;
      else if (called) return w.clock.time;
    }
    throw new Error('the train never left the farm');
  }

  it('loads its wheat from the town store', () => {
    const { w, farm, town, t } = farmLine(false);
    town.add('wheat', 12);
    expect(farm.stored('wheat')).toBe(12);
    expect(farm.availableCargo()).toEqual(['wheat']);
    expect(farm.totalStored()).toBe(12);
    untilItLeaves(w, t, farm);
    const aboard = t.wagons[0].cargo === 'wheat' ? t.wagons[0].amount : 0;
    expect(aboard).toBeGreaterThanOrEqual(12);
    // what it took came out of the town store, the farm's own storage stays empty
    expect(town.get('wheat')).toBeLessThan(1);
    expect(farm.storage.get('wheat') ?? 0).toBe(0);
  });

  it('waiting for full wagons, leaves loaded when the town store holds the wheat', () => {
    const { w, farm, town, t } = farmLine(true);
    town.add('wheat', 200);
    const cap = t.wagons[0].def.capacity * levelMul(t.wagons[0].level);
    untilItLeaves(w, t, farm);
    expect(t.wagons[0].cargo).toBe('wheat');
    expect(t.wagons[0].amount).toBeCloseTo(cap, 6);
    expect(town.get('wheat')).toBeGreaterThanOrEqual(200 - cap);
    expect(town.get('wheat')).toBeLessThan(200);
  });

  it('a harvester with an outlet takes its own leftover storage first, and shows no other goods', () => {
    const { farm, town } = farmLine(false);
    farm.storage.set('wheat', 5);
    town.add('wheat', 10);
    const stone = town.get('stone');
    town.add('stone', 40);
    expect(farm.stored('wheat')).toBe(15);
    expect(farm.stored('stone')).toBe(0);
    expect(farm.totalStored()).toBe(15);
    expect(farm.take('wheat', 8)).toBe(8);
    expect([farm.storage.get('wheat') ?? 0, town.get('wheat')]).toEqual([0, 7]);
    expect(farm.take('stone', 10)).toBe(0);
    expect(town.get('stone')).toBe(stone + 40);
    expect(farm.accepts('wheat')).toBe(false);
  });

  it("shows no more stored than its own capacity, however much wheat the town's store holds", () => {
    const { farm, town } = farmLine(false);
    town.add('wheat', farm.capacity + 150);
    expect(farm.stored('wheat')).toBe(farm.capacity + 150);
    expect(farm.shownStored()).toBe(farm.capacity);
    town.take('wheat', 160);
    expect(farm.shownStored()).toBe(farm.capacity - 10);
  });
});

describe('pooling by rail network', () => {
  /**
   * Depots A (x 20) and B (x 50) with the line between them: a shed has no track of its own, its
   * gates are the rails each side of it, so the rails run 22..49 along row 30, and 2..19 beyond A.
   */
  function twoOnALine(supply?: 'full') {
    const w = simWorld({ terrain: 'grass', size: 96, supply });
    w.builder.free = true;
    const a = station(w, 'depot', 20, 29);
    const b = station(w, 'depot', 50, 29);
    line(w, 22, 30, 49);
    line(w, 2, 30, 19);
    const storeA = w.stores.byKey(`st:${a.id}`)!;
    const storeB = w.stores.byKey(`st:${b.id}`)!;
    return { w, a, b, storeA, storeB };
  }
  const members = (w: SimWorld, s: Store) => (w.stores.poolOf(s) as StorePool).members;

  it('simple: two depots on one line share their goods', () => {
    const { w, storeA, storeB } = twoOnALine();
    storeA.add('wood', 100);
    storeA.add('stone', 20);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(100);
    expect(w.stores.poolOf(storeB).cap('wood')).toBe(2 * rules.depotCap);
    // a farm built near B is paid from A's goods
    w.builder.free = false;
    w.regions.applyTier(99);
    const farm = w.builder.placeStation(46, 29, 'farm', 0);
    expect(farm).not.toBeNull();
    expect(storeA.get('wood')).toBe(100 - 30);
    expect(storeA.get('stone')).toBe(10);
    expect(storeB.get('wood')).toBe(0);
  });

  it("simple: cutting the line splits the pool and keeps each store's goods", () => {
    const { w, storeA, storeB } = twoOnALine();
    storeA.add('wood', 100);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(100);
    expect(w.builder.removeTrack(35, 30)).toBe(true);
    w.stores.refresh();
    expect(w.stores.poolOf(storeA).get('wood')).toBe(100);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(0);
  });

  it('simple: the pools follow the rails without a refresh', () => {
    const { w, a, b, storeA, storeB } = twoOnALine();
    storeA.add('wood', 100);
    w.stores.follow();
    expect(b.dock!.get('wood')).toBe(100);
    w.builder.removeTrack(35, 30);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(0);
    expect(a.dock!.get('wood')).toBe(100);
    expect(b.dock!.get('wood')).toBe(0);
    line(w, 35, 30, 35);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(100);
    expect(b.dock!.get('wood')).toBe(100);
  });

  it('full: two depots on one line do not share', () => {
    const { w, storeA, storeB } = twoOnALine('full');
    storeA.add('wood', 100);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(0);
    expect(w.stores.poolOf(storeA).get('wood')).toBe(100);
    expect(w.stores.poolOf(storeA).cap('wood')).toBe(rules.depotCap);
  });

  it('a change of supply mode pools or splits the stores at once', () => {
    const { w, storeA, storeB } = twoOnALine();
    storeA.add('wood', 100);
    expect(w.stores.poolOf(storeB).get('wood')).toBe(100);
    setSupplyMode('full');
    expect(w.stores.poolOf(storeB).get('wood')).toBe(0);
    setSupplyMode('simple');
    expect(w.stores.poolOf(storeB).get('wood')).toBe(100);
  });

  it('a store with no track pools alone, and the grid pools with nothing', () => {
    const { w, storeA } = twoOnALine();
    const lone = station(w, 'depot', 40, 60);
    const loneStore = w.stores.byKey(`st:${lone.id}`)!;
    storeA.add('wood', 100);
    expect(w.stores.poolOf(loneStore).get('wood')).toBe(0);
    expect(members(w, loneStore)).toEqual([loneStore]);
    expect(members(w, w.stores.grid)).toEqual([w.stores.grid]);
  });

  it("a town pools through its Townhouse's platform with the depots on the line", () => {
    const { w, storeA, storeB } = twoOnALine();
    const hall = station(w, 'town', 35, 29);
    const town = w.stores.byKey(`town:${w.towns.byStation(hall.id)!.id}`)!;
    expect(w.builder.platformTiles(hall).length).toBeGreaterThan(0);
    storeA.add('stone', 40);
    expect(w.stores.townStore(hall.x, hall.y)!.get('stone')).toBe(40);
    expect(members(w, town).map((m) => m.key)).toEqual([town.key, storeA.key, storeB.key]);
    // cut between the town and B: B is alone
    w.builder.removeTrack(40, 30);
    w.stores.refresh();
    expect(w.stores.poolOf(storeB).get('stone')).toBe(0);
    expect(w.stores.poolOf(town).get('stone')).toBe(40);
  });

  it('a pool is seen from its own store: that store first, the rest nearest first', () => {
    const { w, storeA, storeB } = twoOnALine();
    const c = station(w, 'depot', 80, 29);
    line(w, 52, 30, 79);
    const storeC = w.stores.byKey(`st:${c.id}`)!;
    const keys = (s: Store) => members(w, s).map((m) => m.key);
    expect(keys(storeA)).toEqual([storeA.key, storeB.key, storeC.key]);
    expect(keys(storeB)).toEqual([storeB.key, storeA.key, storeC.key]);
    expect(keys(storeC)).toEqual([storeC.key, storeB.key, storeA.key]);
    expect(w.stores.poolOf(storeC).anchor).toBe(storeC.anchor);
    expect(w.stores.poolOf(storeC)).toBe(w.stores.poolOf(storeC));
  });

  it('feeds one network from one stock with one famine verdict', () => {
    const { w, storeA, storeB } = twoOnALine();
    const said: string[] = [];
    w.stores.onMessage = (m, k) => said.push(`${k}: ${m}`);
    const pa = w.stores.poolOf(storeA);
    const pb = w.stores.poolOf(storeB);
    const eaters = new Map([
      [pa, 12],
      [pb, 12],
    ]);
    // the food is at A; the 24 eaters of both ends eat 24 in a week
    storeA.add('food', 100);
    for (let i = 0; i < 7; i++) w.stores.tickUpkeep(daySeconds(), eaters);
    expect(storeA.get('food')).toBeCloseTo(76);
    expect([pa.famine, pb.famine]).toEqual([false, false]);
    // short for too long: told once, and the whole network is in famine
    storeA.take('food', 76);
    w.stores.tickUpkeep(11, eaters);
    expect(said).toHaveLength(1);
    expect([pa.famine, pb.famine, storeA.famine, storeB.famine]).toEqual([true, true, true, true]);
    w.stores.tickUpkeep(1, eaters);
    expect(said).toHaveLength(1);
    // fed again from either end
    storeB.add('food', 50);
    w.stores.tickUpkeep(1, eaters);
    expect([pa.famine, pb.famine, storeA.famine, storeB.famine]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(said).toHaveLength(2);
  });
});

describe('a network that acts as one place', () => {
  /** Depots A (x 20) and B (x 50) on one line, and a train at the platform of each. */
  function trainsOnALine() {
    const w = simWorld({ terrain: 'grass', size: 96 });
    w.builder.free = true;
    const a = station(w, 'depot', 20, 29);
    const b = station(w, 'depot', 50, 29);
    line(w, 22, 30, 49);
    const mk = (x: number) => {
      const t = new Train([
        { uid: x, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! },
      ]);
      t.spawnAt(w.track, x, 30, Dir.W);
      w.fleet.trains.push(t);
      return t;
    };
    const [ta, tb] = [mk(24), mk(46)];
    const storeA = w.stores.byKey(`st:${a.id}`)!;
    const storeB = w.stores.byKey(`st:${b.id}`)!;
    // each train is supplied by the depot it stands next to
    expect([w.fleet.supplierOf(ta)!.key, w.fleet.supplierOf(tb)!.key]).toEqual([
      storeA.key,
      storeB.key,
    ]);
    return { w, ta, tb, storeA, storeB };
  }

  it('refuels a group from the network stock once: all full, or none', () => {
    const { w, ta, tb, storeA, storeB } = trainsOnALine();
    // the network holds the oil of one train at twice the materials, not of two
    storeA.add('oil', 2 * ta.oilCap);
    expect(w.fleet.refuelAll([ta, tb])).toBe(false);
    expect([ta.oil, tb.oil]).toEqual([0, 0]);
    expect(storeA.get('oil')).toBe(2 * ta.oilCap);
    storeB.add('oil', 2 * tb.oilCap);
    expect(w.fleet.refuelAll([ta, tb])).toBe(true);
    expect([ta.oil, tb.oil]).toEqual([ta.oilCap, tb.oilCap]);
    expect(w.stores.poolOf(storeA).get('oil')).toBeCloseTo(0);
  });

  it('is one pool for any store on it, and the store itself when alone', () => {
    const { w, storeA, storeB } = trainsOnALine();
    expect(w.stores.networkPool(w.stores.poolOf(storeB))).toBe(w.stores.poolOf(storeA));
    expect(w.stores.networkPool(storeB)).toBe(w.stores.poolOf(storeA));
    const lone = station(w, 'depot', 40, 60);
    const loneStore = w.stores.byKey(`st:${lone.id}`)!;
    expect(w.stores.networkPool(w.stores.poolOf(loneStore))).toBe(w.stores.poolOf(loneStore));
    expect(w.stores.networkPool(w.stores.grid)).toBe(w.stores.grid);
  });

  it('is told of under its towns when it has several', () => {
    const { w, storeA } = trainsOnALine();
    line(w, 2, 30, 19);
    const hallA = station(w, 'town', 30, 29);
    const hallB = station(w, 'town', 5, 29);
    const names = [hallA, hallB].map((h) => w.towns.byStation(h.id)!.name);
    const said: string[] = [];
    w.stores.onMessage = (m) => said.push(m);
    const pool = w.stores.poolOf(storeA);
    expect((pool as StorePool).members.filter((m) => m.kind === 'town')).toHaveLength(2);
    w.stores.tickUpkeep(11, new Map([[pool, 5]]));
    expect(said).toHaveLength(1);
    for (const n of names) expect(said[0]).toContain(n);
    expect(said[0]).not.toContain(storeA.key);
  });

  it('carries a shortage timer to the first store of the regrouped network', () => {
    const { w, storeA, storeB } = trainsOnALine();
    const said: string[] = [];
    w.stores.onMessage = (m) => said.push(m);
    // cut: B leads itself and eats alone for 6 s with no food
    w.builder.removeTrack(35, 30);
    w.stores.refresh();
    w.stores.tickUpkeep(6, new Map([[w.stores.poolOf(storeB), 5]]));
    expect(said).toHaveLength(0);
    // mended: A leads, and the 6 s count with it, so 5 s more is more than 10 s short
    line(w, 35, 30, 35);
    w.stores.refresh();
    w.stores.tickUpkeep(5, new Map([[w.stores.poolOf(storeA), 5]]));
    expect(said).toHaveLength(1);
    expect([storeA.famine, storeB.famine]).toEqual([true, true]);
  });
});

describe('a pool of several stores', () => {
  /** Three stores in a row: A at x 0, B at x 10, C at x 30, each holding up to `cap`. */
  function pool(cap = 100) {
    const mk = (key: string, x: number) =>
      new Store(key, 'depot', { x, y: 0 }, (id) => (id === 'power' ? 0 : cap));
    const [a, b, c] = [mk('st:1', 0), mk('st:2', 10), mk('st:3', 30)];
    return { a, b, c, p: new StorePool([a, b, c]) };
  }
  const held = ({ a, b, c }: { a: Store; b: Store; c: Store }, id = 'wood') => [
    a.get(id),
    b.get(id),
    c.get(id),
  ];

  it('holds the sum of its members and the sum of their caps', () => {
    const s = pool();
    s.a.add('wood', 30);
    s.b.add('wood', 20);
    s.c.add('wood', 5);
    s.c.add('coal', 7);
    expect(s.p.get('wood')).toBe(55);
    expect(s.p.get('coal')).toBe(7);
    expect(s.p.cap('wood')).toBe(300);
    expect(s.p.cap('power')).toBe(0);
    expect(new Map(s.p.held())).toEqual(
      new Map([
        ['wood', 55],
        ['coal', 7],
      ]),
    );
    expect(s.p.canAfford({ wood: 55 })).toBe(true);
    expect(s.p.canAfford({ wood: 56 })).toBe(false);
    expect([s.p.key, s.p.anchor]).toEqual(['st:1', s.a.anchor]);
  });

  it('takes from its first member, then the next nearest, across members', () => {
    const s = pool();
    s.a.add('wood', 30);
    s.b.add('wood', 20);
    s.c.add('wood', 5);
    expect(s.p.take('wood', 10)).toBe(10);
    expect(held(s)).toEqual([20, 20, 5]);
    expect(s.p.take('wood', 40)).toBe(40);
    expect(held(s)).toEqual([0, 0, 5]);
    // more than there is: all of it
    expect(s.p.take('wood', 100)).toBe(5);
    expect(s.p.get('wood')).toBe(0);
    // spend is all or nothing over the sum
    s.a.add('wood', 30);
    s.b.add('wood', 20);
    expect(s.p.spend({ wood: 60 })).toBe(false);
    expect(s.p.get('wood')).toBe(50);
    expect(s.p.spend({ wood: 40 })).toBe(true);
    expect(held(s)).toEqual([0, 10, 0]);
  });

  it('fills the receiving member to its cap, then overflows to the others nearest first', () => {
    const s = pool();
    s.a.add('wood', 90);
    expect(s.p.add('wood', 30)).toBe(30);
    expect(held(s)).toEqual([100, 20, 0]);
    expect(s.p.add('wood', 100)).toBe(100);
    expect(held(s)).toEqual([100, 100, 20]);
    // what fits nowhere is not stored
    expect(s.p.add('wood', 500)).toBe(80);
    expect(s.p.get('wood')).toBe(300);
    expect(s.p.add('wood', 1)).toBe(0);
    // a refund is capped over the whole pool
    s.p.take('wood', 5);
    s.p.refund({ wood: 10 }, 1);
    expect(s.p.get('wood')).toBe(300);
  });

  it('is in famine when a member is, as one verdict', () => {
    const s = pool();
    expect(s.p.famine).toBe(false);
    s.b.famine = true;
    expect(s.p.famine).toBe(true);
    s.b.famine = false;
    s.a.famine = true;
    expect(s.p.famine).toBe(true);
  });

  it('adds up the weekly flows of its members, and the grid and a store keep their own', () => {
    const { stores, depots } = storesWith([
      { amounts: { wood: 50 }, at: { x: 0, y: 0 } },
      { amounts: { wood: 50 }, at: { x: 10, y: 0 } },
    ]);
    const [a, b] = depots;
    const p = new StorePool([a, b]);
    // the goods a game begins with are not received
    expect(p.weeklyFlow('wood')).toEqual({ produced: 0, consumed: 0 });
    stores.beginFlowHistory();
    a.add('wood', 30);
    b.add('wood', 5);
    b.take('wood', 12);
    p.take('wood', 4);
    stores.grid.add('power', 9);
    expect(a.weeklyFlow('wood')).toEqual({ produced: 30, consumed: 4 });
    expect(b.weeklyFlow('wood')).toEqual({ produced: 5, consumed: 12 });
    expect(p.weeklyFlow('wood')).toEqual({ produced: 35, consumed: 16 });
    expect(p.weeklyFlow('power')).toEqual({ produced: 0, consumed: 0 });
    // a works sees its store's flows, and the grid's for power
    const works = stores.withGrid(p);
    expect(works.weeklyFlow('wood')).toEqual(p.weeklyFlow('wood'));
    expect(works.weeklyFlow('power')).toEqual({ produced: 9, consumed: 0 });
    // a week on, the old flows are gone
    stores.tickUpkeep(weekSeconds() * 1.01, new Map());
    expect(p.weeklyFlow('wood')).toEqual({ produced: 0, consumed: 0 });
  });

  it('records no flow for a try-out copy, nor for goods an heir takes over', () => {
    const { stores, depots, stations } = storesWith([
      { amounts: { wood: 50 }, at: { x: 0, y: 0 } },
      { amounts: { wood: 50 }, at: { x: 10, y: 0 } },
    ]);
    stores.beginFlowHistory();
    const copy = previewOf(stores.poolOf(depots[0]));
    copy.add('wood', 5);
    expect(copy.weeklyFlow('wood')).toEqual({ produced: 0, consumed: 0 });
    stations.pop();
    stores.refresh();
    expect(depots[0].get('wood')).toBe(100);
    expect(depots[0].weeklyFlow('wood')).toEqual({ produced: 0, consumed: 0 });
  });
});

describe('the selected store', () => {
  it("is the start depot's pool until the player picks one, and again once that one is gone", () => {
    const { w, stores } = world();
    expect(stores.selected, 'no store yet').toBeNull();
    const first = station(w, 'depot', 30, 24);
    station(w, 'depot', 70, 24);
    const wh = station(w, 'warehouse', 50, 29);
    sync(w, stores);
    expect(stores.selected!.key).toBe(`st:${first.id}`);
    stores.selected = stores.dockOf(wh);
    expect(stores.selected!.key).toBe(`st:${wh.id}`);
    expect(stores.selected).toBe(stores.dockOf(wh));
    w.builder.free = true;
    expect(w.builder.removeStation(wh)).toBe(true);
    sync(w, stores);
    expect(stores.selected!.key, 'the picked one went').toBe(`st:${first.id}`);
    stores.clear();
    stores.refresh();
    expect(stores.selected!.key, 'a load forgets the pick').toBe(`st:${first.id}`);
  });

  it('lists one choice for each place goods are kept, a rail network as one, in label order', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    w.builder.free = true;
    const a = station(w, 'depot', 20, 29);
    const b = station(w, 'depot', 50, 29);
    line(w, 22, 30, 49);
    const lone = station(w, 'depot', 40, 70);
    a.name = 'Zeta';
    b.name = 'Alpha';
    lone.name = 'Mid';
    const keys = () => w.stores.choices().map((c) => c.key);
    // A and B share a network: one choice, named after its first store in registry order
    expect(keys()).toEqual([`st:${lone.id}`, `st:${a.id}`]);
    expect(w.stores.choices().map((c) => w.stores.label(c))).toEqual(['Mid', 'Zeta']);
    setSupplyMode('full');
    expect(keys()).toEqual([`st:${b.id}`, `st:${lone.id}`, `st:${a.id}`]);
  });

  it('shows a store with the grid power beside it', () => {
    const { w, stores } = world();
    const d = station(w, 'depot', 30, 24);
    sync(w, stores);
    const store = stores.dockOf(d)!;
    store.add('wood', 40);
    stores.grid.amounts.set('power', 70);
    const view = stores.withGrid(store);
    expect(view.get('wood')).toBe(40);
    expect(view.get('power')).toBe(70);
    expect(view.cap('power')).toBe(stores.grid.cap('power'));
    expect(view.cap('wood')).toBe(rules.depotCap);
    expect(stores.withGrid(store)).toBe(view);
  });
});

describe('the selected store on a rail network (Simple mode)', () => {
  it('is the network under one name, whether it falls back, is clicked or is cycled to', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    w.builder.free = true;
    const depot = station(w, 'depot', 20, 29);
    line(w, 22, 30, 49);
    line(w, 2, 30, 19);
    const hall = station(w, 'town', 35, 29);
    const town = `town:${w.towns.byStation(hall.id)!.id}`;
    const [choice] = w.stores.choices();
    expect(w.stores.choices()).toHaveLength(1);
    expect(choice.key).toBe(town);
    // the start depot's fallback, a click on the depot and the bar's choice: one key, one name
    expect(w.stores.selected!.key).toBe(town);
    w.stores.selected = w.stores.dockOf(depot);
    expect(w.stores.selected!.key).toBe(town);
    expect(w.stores.label(w.stores.selected!)).toBe(w.stores.label(choice));
    w.stores.selected = choice;
    expect(w.stores.selected).toBe(choice);
  });
});

describe('the weekly flow of goods a train hauls', () => {
  /**
   * A depot at the west end of a line and a town on it with a farm in its reach. A train's load at
   * the farm is `farm.take` (out of the town store, through the outlet) and its unload at the
   * depot is `depot.store` (into the depot's dock): the calls `Train` makes.
   */
  function haulWorld(supply: 'simple' | 'full') {
    const w = simWorld({ terrain: 'grass', size: 96, supply });
    const depotStore = depotWith(w, {}, { x: 4, y: 30 });
    line(w, 6, 30, 90);
    const hall = station(w, 'town', 20, 29);
    const farm = station(w, 'farm', 25, 29);
    const depot = w.builder.stations.find((s) => s.def.depot)!;
    const town = w.stores.byKey(`town:${w.towns.townAt(hall.x, hall.y)!.id}`)!;
    expect(farm.outlet).toBe(w.stores.townStore(hall.x, hall.y));
    w.stores.beginFlowHistory();
    w.stores.tickUpkeep(1, new Map());
    return { w, farm, depot, depotStore, town };
  }
  const haul = (farm: Station, depot: Station, n: number) => {
    const took = farm.take('wheat', n);
    expect(took).toBeCloseTo(n, 9);
    expect(depot.store('wheat', took)).toBeCloseTo(took, 9);
    return took;
  };

  it('counts the farm output once in Simple mode, where the town and the depot are one pool', () => {
    const { w, farm, depot, depotStore, town } = haulWorld('simple');
    farm.tick(daySeconds());
    const made = town.get('wheat');
    expect(made).toBeGreaterThan(0);
    const pool = w.stores.networkPool(w.stores.poolOf(town));
    expect(pool.key).toBe(w.stores.networkPool(w.stores.poolOf(depotStore)).key);
    const before = pool.weeklyFlow('wheat');
    expect(before).toEqual({ produced: made, consumed: 0 });
    haul(farm, depot, made);
    expect(depotStore.get('wheat')).toBeCloseTo(made, 9);
    // the haul between two members of the pool is neither received nor spent
    expect(pool.weeklyFlow('wheat').produced).toBeCloseTo(made, 9);
    expect(pool.weeklyFlow('wheat').consumed).toBe(0);
  });

  it('shows a haul into a store from outside its pool as received', () => {
    const { w, farm, depot, depotStore, town } = haulWorld('simple');
    farm.tick(daySeconds());
    const made = town.get('wheat');
    haul(farm, depot, made);
    // the depot alone, as a pool of one, sees the load arrive; the town alone sees it leave
    const lone = new StorePool([depotStore]);
    expect(lone.weeklyFlow('wheat')).toEqual({ produced: made, consumed: 0 });
    expect(new StorePool([town]).weeklyFlow('wheat').consumed).toBeCloseTo(made, 9);
    expect(w.stores.grid.weeklyFlow('wheat')).toEqual({ produced: 0, consumed: 0 });
  });

  it('shows the depot unloading as received in Full mode, where every store stands alone', () => {
    const { w, farm, depot, depotStore, town } = haulWorld('full');
    farm.tick(daySeconds());
    const made = town.get('wheat');
    expect(made).toBeGreaterThan(0);
    const n = haul(farm, depot, made);
    expect(w.stores.poolOf(depotStore).weeklyFlow('wheat')).toEqual({ produced: n, consumed: 0 });
    const away = w.stores.poolOf(town).weeklyFlow('wheat');
    expect(away.produced).toBeCloseTo(made, 9);
    expect(away.consumed).toBeCloseTo(n, 9);
  });
});
