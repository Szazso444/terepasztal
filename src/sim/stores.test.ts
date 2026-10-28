import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from './rules';
import { StoreRegistry } from './stores';
import type { Station } from './stations';

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
