import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { StoreRegistry } from './stores';
import { levelMul } from '../gacha/items';
import type { Station } from './stations';
import { defaultStop, type StopPlan, type Train } from './trains';
import { SimStep, startStock, type StepContext } from './step';
import { tickBuildings, type Building } from './buildings';
import { depotWith } from '../testing/storeFixtures';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** A flat world with a long line and a store registry attached, as Task 3 will wire it. */
function world() {
  const w = simWorld({ terrain: 'grass', size: 96 });
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
});

describe('works and harvesters at their store', () => {
  /** A world with the stores the builder keeps (`w.stores`) and two towns 26 tiles apart. */
  function twoTowns() {
    const w = simWorld({ terrain: 'grass', size: 96 });
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

  it('a works with no store in reach does not run', () => {
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
    expect(said).toEqual([
      `warn: ${name}: the crews are out of food: production halved, trains slowed`,
    ]);
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
   * and a depot at its west end, the stockpile holding a new game's stock (a train refuels from
   * it), and a train of an Adler and a flatbed running farm, warehouse, with or without waiting
   * for full wagons at the farm.
   */
  function farmLine(waitFull: boolean) {
    const w = simWorld({ terrain: 'grass', size: 96 });
    station(w, 'depot', 4, 30);
    line(w, 6, 30, 90);
    const hall = station(w, 'town', 20, 29);
    const farm = station(w, 'farm', 25, 29);
    const warehouse = station(w, 'warehouse', 80, 29);
    for (const [k, n] of Object.entries(startStock())) w.stock.add(k, n);
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
      stockCap: (id) => w.stock.cap(id, w.builder.depotCount(), w.builder.plantCount()),
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
    town.add('stone', 40);
    expect(farm.stored('wheat')).toBe(15);
    expect(farm.stored('stone')).toBe(0);
    expect(farm.totalStored()).toBe(15);
    expect(farm.take('wheat', 8)).toBe(8);
    expect([farm.storage.get('wheat') ?? 0, town.get('wheat')]).toEqual([0, 7]);
    expect(farm.take('stone', 10)).toBe(0);
    expect(town.get('stone')).toBe(40);
    expect(farm.accepts('wheat')).toBe(false);
  });
});
