import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { StoreRegistry } from './stores';
import { TownRegistry } from './towns';
import { Train, DYNAMIC_MODES, defaultStop, resetTrainIds, type WagonSlot } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { rowLengths } from '../testing/modelFixtures';
import { STR } from '../strings';
import { forAll } from '../testing/property';
import { storeWith } from '../testing/storeFixtures';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

// The Freight route mode (issue #233): one mode for what Production and Collection did. An empty
// train ranks the producers that keep their own pile by how full they are; a store (a depot, a
// warehouse, a Townhouse) is never a pickup, only where loads go: the nearest one with room that
// they did not come from (the town stores, final review C1); a loaded train tops up at producers
// only; and a train never takes out of a store what it put into it.

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
});

const SIZE = 96;
const ROW = 30;
const GDT = 0.05;

/** A grass map with a straight line along row 30, and a fleet over it. */
function world() {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass);
  const track = new TrackGraph(SIZE, SIZE);
  const economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, storeWith({}).stores);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy);
  for (let x = 2; x < SIZE - 2; x++) track.place(x, ROW, 'straight', 1);
  return { map, track, builder, fleet };
}
type World = ReturnType<typeof world>;

/** A station of `kind` beside the line at column `x`, holding `stored` units of each cargo. */
function put(w: World, kind: string, x: number, stored: Record<string, number> = {}) {
  const s = new Station(kind, x, ROW - 1);
  for (const [cargo, n] of Object.entries(stored)) s.storage.set(cargo, n);
  w.builder.stations.push(s);
  return s;
}

/** A hopper's worth of stone (20 units) in a wagon, taken at `origin`. */
function stoneFrom(origin: number | null, amount = 20): WagonSlot {
  return {
    uid: 0,
    def: wagonDef('wood_hopper'),
    level: 1,
    cargo: 'stone',
    amount,
    origin,
  };
}
const empty = (): WagonSlot => ({
  uid: 0,
  def: wagonDef('wood_hopper'),
  level: 1,
  cargo: null,
  amount: 0,
  origin: null,
});

/** A diesel freight train at column `x` with the wagons given (two empty hoppers by default). */
function train(w: World, x: number, wagons: WagonSlot[] = [empty(), empty()], east = true) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = wagons.map((g, i) => ({ ...g, uid: 10 + i }));
  expect(t.spawnAt(w.track, x, ROW, east ? Dir.W : Dir.E)).not.toBe(false);
  t.oil = t.oilCap;
  t.mode = 'freight';
  w.fleet.trains.push(t);
  return t;
}

/** Set the train off the way a player's switch to Freight does: for the stop it would pick. */
function launch(w: World, t: Train) {
  expect(w.fleet.setMode(t, 'freight')).toEqual({ ok: true });
  return t;
}

const reach = (a: Station, b: Station) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

/**
 * Two quarries either side of a train whose head is at column `hx`, each with a depot on the side
 * facing the train, laid so that the way there and on to the depot is as long for both: the sum
 * the ranking weighs (`Fleet.chooseNext`). Each quarry's middle is 14 from the train and its
 * depot's 3.5 on. The west one is at level `levels[0]`, the east one at `levels[1]` (which sets
 * the room each has), and each holds `stored`.
 */
function twins(
  w: World,
  hx: number,
  levels: readonly [number, number],
  stored: Record<string, number>,
) {
  const west = put(w, 'quarry', Math.floor(hx - 14), stored);
  const east = put(w, 'quarry', Math.ceil(hx + 14), stored);
  [west.level, east.level] = levels;
  const d1 = put(w, 'depot', west.x + 3);
  const d2 = put(w, 'depot', east.x - 4);
  const way = (st: Station, d: Station) => Math.abs(st.cx - hx) + reach(d, st);
  expect(way(west, d1), 'premise: as far there and on').toBe(way(east, d2));
  return { west, east };
}

describe('the route modes', () => {
  it('are schedule and the dynamic freight, transport and contract', () => {
    expect(DYNAMIC_MODES).toEqual(['freight', 'transport', 'contract']);
  });

  it('are named in the menus without the two modes Freight replaced', () => {
    for (const set of [
      STR.train.mode,
      STR.train.modeHint,
      STR.depot.routeMode,
      STR.depot.routeHint,
    ]) {
      expect(Object.keys(set)).not.toContain('production');
      expect(Object.keys(set)).not.toContain('collection');
      expect(typeof set.freight).toBe('string');
    }
  });

  it('are explained for Freight without a number the tuning can change', () => {
    for (const text of [STR.depot.routeHint.freight, STR.train.modeHint.freight])
      expect(text, text).not.toMatch(/\d/);
  });
});

// ------------------------------------------------------------------ ranking an empty train

describe('an empty freight train choosing a stop', () => {
  // the twins stand on whole tiles, as far from the middle of its first car as each other: a car
  // of a whole number of tiles
  rowLengths(locoDef('f7'));

  it('never picks a store, however much it holds, and picks a producer instead', () => {
    rules.warehouseCap = 45;
    const w = world();
    const t = train(w, 30);
    // a warehouse nearly full for its room, and a depot holding a lot, both near the train
    put(w, 'warehouse', 44, { stone: 44 });
    put(w, 'depot', 20, { stone: 500 });
    expect(w.fleet.chooseNext(t)).toBeNull();
    // a thin pile at a quarry far off is a stop
    const far = put(w, 'quarry', 80, { stone: 12 });
    expect(w.fleet.chooseNext(t)).toBe(far.id);
  });

  it('picks the fuller of two producers, whichever side it is on', () => {
    // 40 stone: two thirds of a level 1 quarry's 60, a third of a level 2's 120
    for (const levels of [
      [1, 2],
      [2, 1],
      [3, 1],
      [2, 4],
    ] as const) {
      const w = world();
      const t = train(w, 30);
      const { west, east } = twins(w, t.poses[0].x, levels, { stone: 40 });
      const fuller = levels[0] < levels[1] ? west : east;
      expect(w.fleet.chooseNext(t), `levels ${levels.join(', ')}`).toBe(fuller.id);
    }
  });

  it('counts only what the train can haul', () => {
    const w = world();
    const t = train(w, 30);
    // a hopper takes no water: 500 of it is no pile
    put(w, 'pump', 50, { water: 500 });
    put(w, 'depot', 70);
    expect(w.fleet.chooseNext(t)).toBeNull();
    // a single unit of stone is too little to send a train for; ten are worth it
    const q = put(w, 'quarry', 56, { stone: 1 });
    expect(w.fleet.chooseNext(t)).toBeNull();
    q.storage.set('stone', 10);
    expect(w.fleet.chooseNext(t)).toBe(q.id);
  });
});

// ------------------------------------------------------------------ where a load goes

describe('a loaded freight train choosing a stop', () => {
  it('takes any load to the nearest store with room, a depot or a warehouse alike', () => {
    for (const [houseX, depotX, nearer] of [
      [34, 70, 'warehouse'],
      [70, 34, 'depot'],
    ] as const) {
      const w = world();
      // goods from a warehouse (a load a scheduled train took on) go where any goods go
      const src = put(w, 'warehouse', 6, { stone: 100 });
      const house = put(w, 'warehouse', houseX);
      const depot = put(w, 'depot', depotX);
      const t = train(w, 30, [stoneFrom(src.id), stoneFrom(src.id)]);
      expect(w.fleet.chooseNext(t), nearer).toBe((nearer === 'depot' ? depot : house).id);
    }
  });

  it('never takes goods back to the station they came from', () => {
    const w = world();
    const src = put(w, 'warehouse', 33, { stone: 100 });
    const far = put(w, 'warehouse', 70);
    const t = train(w, 30, [stoneFrom(src.id), stoneFrom(src.id)]);
    expect(w.fleet.chooseNext(t)).toBe(far.id);
    w.builder.stations.splice(w.builder.stations.indexOf(far), 1);
    expect(w.fleet.chooseNext(t)).toBeNull();
  });

  it('takes goods from producers to the nearest warehouse with room, not past it to a depot', () => {
    const w = world();
    const q = put(w, 'quarry', 6, { stone: 40 });
    const near = put(w, 'warehouse', 44);
    put(w, 'warehouse', 64);
    put(w, 'depot', 80);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    expect(w.fleet.chooseNext(t)).toBe(near.id);
  });

  it('passes a store with no room for the goods', () => {
    rules.warehouseCap = 30;
    const w = world();
    const q = put(w, 'quarry', 6, { stone: 40 });
    // full of stone, with room for wheat only
    put(w, 'warehouse', 34, { stone: 30 });
    const depot = put(w, 'depot', 70);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
  });

  it('tops up at a producer, never at a store', () => {
    rules.warehouseCap = 300;
    const w = world();
    const src = put(w, 'quarry', 2, { stone: 0 });
    // a warehouse full of stone near by: no place to put the goods, nor to take more on
    const pile = put(w, 'warehouse', 33, { stone: 300 });
    const depot = put(w, 'depot', 70);
    // half full of stone, room for as much again
    const t = train(w, 30, [stoneFrom(src.id), { ...empty() }]);
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
    expect(pile.roomFor('stone')).toBe(0);
    // with a quarry to the east, nearer than the depot, it tops up there first
    const q = put(w, 'quarry', 44, { stone: 40 });
    expect(w.fleet.chooseNext(t)).toBe(q.id);
  });

  it('may be bound for a warehouse when that is where the goods go', () => {
    const w = world();
    const q = put(w, 'quarry', 2, { stone: 40 });
    const house = put(w, 'warehouse', 40);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    expect(w.fleet.chooseNext(t)).toBe(house.id);
  });
});

// ------------------------------------------------------------------ nothing goes both ways

/** The goods a train holds, by kind. */
function aboard(t: Train): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of t.wagons) if (g.cargo) out.set(g.cargo, (out.get(g.cargo) ?? 0) + g.amount);
  return out;
}

/**
 * Watches a train through its stops at warehouses: what it takes in and out of each (by the
 * change in what it holds while it loads there) and where it sets off for.
 */
class Watch {
  /** the warehouse stop being watched, with what has gone in and out of the train so far */
  private stop: { at: number; in: Set<string>; out: Set<string> } | null = null;
  private held = new Map<string, number>();
  /** the warehouse the train last put goods into, until it sets off from there */
  private dropped: number | null = null;
  /** the warehouse it loaded at a moment ago, and whether it had put goods down there */
  private was: { at: number; dropped: boolean } | null = null;
  readonly problems: string[] = [];
  /** warehouse stops that put goods down, and stops that took goods out */
  drops = 0;
  pickups = 0;

  constructor(private readonly t: Train) {}

  look(at: number) {
    const t = this.t;
    const st = t.atStation;
    const here = st && t.state === 'loading' && st.def.stockpile ? st : null;
    const now = aboard(t);
    const say = (what: string) => this.problems.push(`t=${at.toFixed(2)}: ${what}`);
    // setting off from a warehouse it put goods into (backing off a platform holds, and goes
    // back to the same stop: that is not a pick): the stop it is bound for is not that warehouse
    if (this.was?.dropped && t.state === 'moving' && !t.holding) {
      const bound = t.schedule[t.routeIndex % t.schedule.length]?.stationId;
      if (bound === this.was.at) say(`bound for ${bound}, where it put goods down`);
    }
    if (t.state === 'moving' && !t.holding) this.dropped = null;
    if (here) {
      if (this.stop?.at !== here.id) {
        // a new stop at the warehouse it put goods into and has not set off from since
        if (this.dropped === here.id) say(`stopped again at ${here.id}, where it put goods down`);
        this.stop = { at: here.id, in: new Set(), out: new Set() };
      } else {
        for (const c of new Set([...now.keys(), ...this.held.keys()])) {
          const d = (now.get(c) ?? 0) - (this.held.get(c) ?? 0);
          if (d < -1e-6) this.stop.in.add(c);
          if (d > 1e-6) this.stop.out.add(c);
        }
        for (const c of this.stop.in)
          if (this.stop.out.has(c)) say(`${c} went both in and out at ${here.id}`);
        if (this.stop.in.size) this.dropped = here.id;
      }
    } else if (this.stop) {
      if (this.stop.in.size) this.drops++;
      if (this.stop.out.size) this.pickups++;
      this.stop = null;
    }
    this.was = here && this.stop ? { at: here.id, dropped: this.stop.in.size > 0 } : null;
    this.held = now;
  }
}

/**
 * Run `seconds` of the world from game time `from`, with every station making its goods unless
 * `make` is off, a watch on each train. Returns the game time it ends at.
 */
function run(w: World, watches: Watch[], seconds: number, make = true, from = 0) {
  let now = from;
  for (let i = 0; i < seconds / GDT; i++) {
    now += GDT;
    if (make) for (const s of w.builder.stations) s.tick(GDT);
    w.fleet.tick(GDT, now);
    for (const k of watches) k.look(now);
  }
  return now;
}

describe('a freight train at a warehouse', () => {
  it(
    'takes nothing back out of what it put in, and is not bound for that warehouse on leaving',
    { timeout: 60_000 },
    () => {
      const w = world();
      put(w, 'quarry', 20, { stone: 55 });
      const house = put(w, 'warehouse', 45);
      put(w, 'depot', 75);
      const t = launch(w, train(w, 30));
      const watch = new Watch(t);
      run(w, [watch], 500);
      expect(watch.drops, 'it put goods down at the warehouse').toBeGreaterThan(0);
      expect(watch.problems).toEqual([]);
      // it hauled stone in and out of the warehouse, across the run
      expect(house.stored('stone')).toBeGreaterThanOrEqual(0);
    },
  );

  it(
    'does not take goods the warehouse also holds on at a stop where it put goods down',
    { timeout: 60_000 },
    () => {
      // the warehouse holds wheat, which a flatbed could carry; the train arrives with stone, puts
      // it down and sets off with the wagons it emptied empty, rather than loading wheat there
      const w = world();
      put(w, 'quarry', 20, { stone: 55 });
      const house = put(w, 'warehouse', 45, { wheat: 50 });
      put(w, 'depot', 75);
      const flat = { ...empty(), def: wagonDef('flatbed') };
      const t = launch(w, train(w, 30, [empty(), flat]));
      let loadedAtHouse = 0;
      let dropped = false;
      let drops = 0;
      for (let i = 0, now = 0; i < 400 / GDT; i++) {
        const before = t.wagons.map((g) => g.amount);
        w.fleet.tick(GDT, (now += GDT));
        if (t.atStation !== house || t.state !== 'loading') {
          // the stop is over
          dropped = false;
          continue;
        }
        t.wagons.forEach((g, k) => {
          if (g.amount < before[k] - 1e-6) {
            if (!dropped) drops++;
            dropped = true;
          } else if (dropped && g.amount > before[k] + 1e-6) loadedAtHouse++;
        });
      }
      expect(drops, 'it put goods down at the warehouse').toBeGreaterThan(0);
      expect(loadedAtHouse).toBe(0);
    },
  );

  it(
    'leaves the load it put into a warehouse there, and so does a train new to the line',
    { timeout: 60_000 },
    () => {
      // the quarry holds one load and makes no more: the train hauls it to the warehouse, and the
      // pile there is no pickup for it nor for any other roaming train
      const w = world();
      const q = put(w, 'quarry', 20, { stone: 40 });
      const house = put(w, 'warehouse', 45);
      const depot = put(w, 'depot', 75);
      const first = launch(w, train(w, 30));
      const watch = new Watch(first);
      const filled = run(w, [watch], 200, false);
      expect(q.stored('stone')).toBeLessThan(1);
      expect(watch.drops, 'it put the load down').toBe(1);
      expect(house.stored('stone'), 'and left it there').toBeGreaterThan(30);
      expect(first.state).toBe('idle');
      expect(watch.problems).toEqual([]);
      // another train, new to the line, finds nothing to fetch
      const pile = house.stored('stone');
      const second = launch(w, train(w, 60, undefined, false));
      expect(w.fleet.chooseNext(second)).toBeNull();
      run(w, [watch, new Watch(second)], 300, false, filled);
      expect(watch.problems).toEqual([]);
      expect(house.stored('stone')).toBeCloseTo(pile, 6);
      expect(depot.stored('stone')).toBe(0);
      expect(aboard(second).size).toBe(0);
    },
  );

  it('never picks up a warehouse pile, arriving empty', () => {
    const w = world();
    const house = put(w, 'warehouse', 45, { stone: 60 });
    put(w, 'warehouse', 52);
    const depot = put(w, 'depot', 75);
    const t = launch(w, train(w, 30));
    // sent there on a stop of its own, it still takes nothing aboard
    t.schedule = [defaultStop(house.id)];
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    let at = false;
    for (let i = 0, now = 0; i < 300 / GDT; i++) {
      w.fleet.tick(GDT, (now += GDT));
      if (t.atStation === house) at = true;
    }
    expect(at, 'it called at the warehouse').toBe(true);
    expect(house.stored('stone')).toBe(60);
    expect(depot.stored('stone')).toBe(0);
    expect(aboard(t).size).toBe(0);
  });

  it('holds for any layout, with one train or two', { timeout: 120_000 }, () => {
    const KINDS = ['quarry', 'warehouse', 'farm', 'depot'] as const;
    interface Case {
      sites: { kind: (typeof KINDS)[number]; x: number; stocked: boolean }[];
      trains: { x: number; east: boolean }[];
    }
    let drops = 0;
    forAll(
      (rng: Rng): Case => {
        // sites on a grid of eight, the trains halfway between two of its places
        const slots = rng.shuffle(Array.from({ length: 11 }, (_, i) => 10 + 8 * i));
        const mids = rng.shuffle(Array.from({ length: 10 }, (_, i) => 14 + 8 * i));
        return {
          sites: [
            { kind: 'quarry', x: slots[0], stocked: true },
            { kind: 'warehouse', x: slots[1], stocked: rng.chance(0.5) },
            { kind: 'depot', x: slots[2], stocked: false },
            ...slots.slice(3, 3 + rng.int(0, 3)).map((x) => ({
              kind: rng.pick(KINDS),
              x,
              stocked: rng.chance(0.6),
            })),
          ],
          trains: Array.from({ length: rng.int(1, 2) }, (_, i) => ({
            x: mids[i],
            east: rng.chance(0.5),
          })),
        };
      },
      (c) => {
        const w = world();
        for (const s of c.sites) {
          const stored: Record<string, number> =
            !s.stocked || s.kind === 'depot'
              ? {}
              : s.kind === 'farm'
                ? { wheat: 30 }
                : { stone: s.kind === 'warehouse' ? 60 : 45 };
          put(w, s.kind, s.x, stored);
        }
        const trains = c.trains.map((k) => launch(w, train(w, k.x, undefined, k.east)));
        const watches = trains.map((t) => new Watch(t));
        run(w, watches, 300);
        for (const k of watches) expect(k.problems).toEqual([]);
        drops += watches.reduce((a, k) => a + k.drops, 0);
      },
      { seeds: Array.from({ length: 24 }, (_, i) => i + 1) },
    );
    // the layouts are worth running: trains did put goods down at warehouses
    expect(drops).toBeGreaterThan(0);
  });
});

describe('a freight train unloading at a station with a store', () => {
  /** The world's stations given the stores a game would make for them (`StoreRegistry.refresh`). */
  function stored(w: World) {
    const towns = new TownRegistry(w.builder);
    const stores = new StoreRegistry();
    stores.attach({ builder: w.builder, towns, track: w.track });
    const sync = () => {
      towns.refresh();
      stores.refresh();
    };
    sync();
    return { stores, sync };
  }
  const wood = (amount: number): WagonSlot => ({
    ...empty(),
    def: wagonDef('flatbed'),
    cargo: 'wood',
    amount,
    origin: 0,
  });
  const flatbed = (): WagonSlot => ({ ...empty(), def: wagonDef('flatbed') });
  /**
   * Send the train to the station, then on to `then` (a train loads only for a stop to unload at),
   * and run it; returns the most of each kind it held at any moment.
   */
  function visit(w: World, t: Train, at: Station, then: Station[] = [], seconds = 120) {
    t.schedule = [at, ...then].map((s) => defaultStop(s.id));
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    let arrived = false;
    const most = new Map<string, number>();
    for (let i = 0, now = 0; i < seconds / GDT; i++) {
      w.fleet.tick(GDT, (now += GDT));
      if (t.atStation === at) arrived = true;
      for (const [c, n] of aboard(t)) most.set(c, Math.max(most.get(c) ?? 0, n));
    }
    expect(arrived, 'it reached the station').toBe(true);
    return most;
  }

  it('unloading at a depot fills the depot store', () => {
    const w = world();
    const q = put(w, 'quarry', 6);
    const depot = put(w, 'depot', 75);
    const { stores, sync } = stored(w);
    sync();
    expect(depot.dock).toBe(stores.dockOf(depot));
    const t = train(w, 30, [stoneFrom(q.id)]);
    visit(w, t, depot);
    expect(stores.dockOf(depot)!.get('stone')).toBeCloseTo(20, 6);
    expect(depot.stored('stone')).toBeCloseTo(20, 6);
    expect(stores.totals().get('stone'), 'and no other store got any').toBeCloseTo(20, 6);
    expect(aboard(t).get('stone') ?? 0).toBe(0);
  });

  it('unloading at a town warehouse fills the town store and a second warehouse can load it', () => {
    const w = world();
    put(w, 'town', 46);
    const a = put(w, 'warehouse', 40);
    const b = put(w, 'warehouse', 52);
    const { stores, sync } = stored(w);
    sync();
    const store = stores.dockOf(a)!;
    expect(store.key).toMatch(/^town:/);
    expect(stores.dockOf(b)).toBe(store);
    visit(w, train(w, 20, [wood(10), wood(10)]), a);
    expect(store.get('wood')).toBeCloseTo(20, 6);
    expect(b.stored('wood'), 'the other warehouse shows the same goods').toBeCloseTo(20, 6);
    expect(b.availableCargo()).toContain('wood');
    // a train on a schedule loads at a store's station
    const loader = train(w, 70, [flatbed(), flatbed()], false);
    loader.mode = 'schedule';
    const depot = put(w, 'depot', 10);
    sync();
    const most = visit(w, loader, b, [depot]);
    // it takes in whole loads of the pile: what it holds came out of the store
    expect(most.get('wood') ?? 0, 'the loading train took wood').toBeGreaterThan(15);
    expect(store.get('wood') + (most.get('wood') ?? 0), 'and none was lost').toBeCloseTo(20, 6);
  });

  it('a full store refuses the unload', () => {
    const w = world();
    put(w, 'town', 46);
    const a = put(w, 'warehouse', 40);
    const { stores, sync } = stored(w);
    sync();
    const store = stores.dockOf(a)!;
    // the Townhouse's 300 and 1000 for the warehouse
    expect(store.cap('wood')).toBe(1300);
    expect(store.add('wood', 1300)).toBe(1300);
    expect(a.roomFor('wood')).toBe(0);
    expect(a.roomFor('stone'), 'the cap is per resource').toBe(1300);
    const t = train(w, 20, [wood(10), wood(10)]);
    visit(w, t, a);
    expect(store.get('wood')).toBe(1300);
    expect(aboard(t).get('wood')).toBeCloseTo(20, 6);
  });
});

describe('a freight train that put goods down at a stop', () => {
  it('says so in its save, and drops that on setting off', () => {
    const w = world();
    const q = put(w, 'quarry', 20, { stone: 55 });
    const house = put(w, 'warehouse', 45);
    put(w, 'depot', 75);
    const t = launch(w, train(w, 30));
    let seen = false;
    let now = 0;
    for (let i = 0; i < 400 / GDT && !seen; i++) {
      w.fleet.tick(GDT, (now += GDT));
      const dropped = t.toJSON().dropped;
      if (t.atStation === house && dropped) {
        seen = true;
        const back = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())) as never, w.track);
        expect(back.toJSON().dropped).toBe(true);
      }
    }
    expect(seen, 'a train put goods down at the warehouse').toBe(true);
    // more stone at the quarry: it sets off for it, and what it put down no longer holds it
    q.storage.set('stone', 40);
    let away = false;
    for (let i = 0; i < 400 / GDT && !away; i++) {
      w.fleet.tick(GDT, (now += GDT));
      away = t.state === 'moving' && t.atStation === null;
    }
    expect(away, 'it set off').toBe(true);
    expect(t.toJSON().dropped).toBe(false);
  });
});

// ------------------------------------------------------------------ generated layouts
//
// Verification (#233). The tests above pin the rules on hand-built lines; these state them for
// every layout of a class: sites along the line at a fixed spacing, a train between two of them.
// Each failure names its seed, and the shrinkers take sites away from it.

type Kind = 'quarry' | 'warehouse' | 'farm' | 'depot';
interface Site {
  kind: Kind;
  /** left edge of the site, on a grid of eight that starts at 10 */
  x: number;
  /** what it holds: stone, or wheat at a farm; nothing at a depot */
  held: number;
}
const SLOT = (i: number) => 10 + 8 * i;
const MID = (i: number) => 14 + 8 * i;

function putSite(w: World, s: Site) {
  const kind = s.kind === 'farm' ? 'wheat' : 'stone';
  const held: Record<string, number> = s.kind !== 'depot' && s.held > 0 ? { [kind]: s.held } : {};
  return put(w, s.kind, s.x, held);
}

/** `n` distinct slots of the ten the line has room for, in a seeded order. */
function slots(rng: Rng, n: number): number[] {
  return rng.shuffle(Array.from({ length: 10 }, (_, i) => SLOT(i))).slice(0, n);
}

// ---- where a loaded train goes

interface LoadedCase {
  sites: Site[];
  /** the warehouse capacity of the case, which sets how much room a pile leaves */
  cap: number;
  /** slot between two sites the train stands at, heading east or west */
  mid: number;
  east: boolean;
  /** the two hoppers: stone from the site at that index (or from none), or empty */
  wagons: ({ from: number | null; amount: number } | null)[];
}

function genLoaded(rng: Rng): LoadedCase {
  const nHouses = rng.int(0, 3);
  const nDepots = rng.int(0, 2);
  const nQuarries = rng.int(0, 2);
  const at = slots(rng, nHouses + nDepots + nQuarries + rng.int(0, 1));
  const sites: Site[] = [];
  for (let i = 0; i < nHouses; i++)
    sites.push({ kind: 'warehouse', x: at.pop()!, held: rng.pick([0, 10, 40, 100]) });
  for (let i = 0; i < nDepots; i++) sites.push({ kind: 'depot', x: at.pop()!, held: 0 });
  for (let i = 0; i < nQuarries; i++)
    sites.push({ kind: 'quarry', x: at.pop()!, held: rng.pick([0, 12, 40, 55]) });
  if (at.length) sites.push({ kind: 'farm', x: at.pop()!, held: 30 });
  // goods are loaded at a producer or a warehouse, never at a depot
  const sources = sites.flatMap((s, i) => (s.kind === 'depot' ? [] : [i]));
  const loaded = () => ({
    from: rng.chance(0.15) || !sources.length ? null : rng.pick(sources),
    amount: rng.pick([20, 20, 20, 8]),
  });
  return {
    sites,
    cap: rng.pick([30, 60, 120, 400]),
    mid: MID(rng.int(0, 8)),
    east: rng.chance(0.5),
    wagons: [loaded(), rng.chance(0.5) ? loaded() : null],
  };
}

/** The case without site `i`: wagons that came from it came from none, later indices shift. */
function withoutSite(c: LoadedCase, i: number): LoadedCase {
  const from = (f: number | null) => (f === null || f === i ? null : f > i ? f - 1 : f);
  return {
    ...c,
    sites: c.sites.filter((_, k) => k !== i),
    wagons: c.wagons.map((g) => g && { ...g, from: from(g.from) }),
  };
}
function* shrinkLoaded(c: LoadedCase): Iterable<LoadedCase> {
  for (let i = 0; i < c.sites.length; i++) yield withoutSite(c, i);
  if (c.wagons[1]) yield { ...c, wagons: [c.wagons[0], null] };
  for (let i = 0; i < c.sites.length; i++)
    if (c.sites[i].held > 0)
      yield { ...c, sites: c.sites.map((s, k) => (k === i ? { ...s, held: 0 } : s)) };
}

/**
 * Where a loaded freight train's goods may go, said without the fleet's own helpers: the nearest
 * store (a depot or a warehouse) with room for `min(units, 5)` of the stone at least, that is not
 * one the goods came from. `ok` is every station that is right; ties in distance give several.
 */
function dumpsFor(w: World, t: Train) {
  const head = t.poses[0];
  const far = (s: Station) => Math.abs(s.cx - head.x) + Math.abs(s.cy - head.y);
  const all = w.builder.stations;
  const houses = all.filter((s) => s.def.stockpile);
  const stores = all.filter((s) => s.def.pool || s.def.stockpile);
  const sources = new Set(t.wagons.map((g) => g.origin).filter((o): o is number => o !== null));
  const loaded = t.wagons.filter((g) => g.cargo && g.amount > 0);
  const units = loaded.reduce((a, g) => a + g.amount, 0);
  const fromStore = loaded.some((g) => houses.some((s) => s.id === g.origin));
  const roomy = stores.filter(
    (s) => !sources.has(s.id) && s.roomFor('stone') >= Math.min(units, 5),
  );
  const m = Math.min(...roomy.map(far));
  const ok = roomy.filter((s) => far(s) === m);
  return { ok, fromStore, houses, sources };
}

describe('where a loaded freight train is bound, over generated lines', () => {
  /** the layout built, with the train on it */
  function build(c: LoadedCase) {
    rules.warehouseCap = c.cap;
    const w = world();
    const stations = c.sites.map((s) => putSite(w, s));
    const wagons = c.wagons.map((g) =>
      g ? stoneFrom(g.from === null ? null : stations[g.from].id, g.amount) : empty(),
    );
    const t = train(w, c.mid, wagons, c.east);
    return { w, t, stations };
  }
  /** the case with both hoppers full, so no top-up is open and the stop is where the goods go */
  function full(c: LoadedCase): LoadedCase {
    const first = { ...c.wagons[0]!, amount: 20 };
    return { ...c, wagons: [first, c.wagons[1] ? { ...c.wagons[1], amount: 20 } : first] };
  }
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

  it('takes a load to the nearest store with room that is not its source, wherever it came from', () => {
    const seen = { fromStore: 0, house: 0, depot: 0, nowhere: 0 };
    forAll(
      genLoaded,
      (c) => {
        const { w, t } = build(full(c));
        const spec = dumpsFor(w, t);
        const got = w.fleet.chooseNext(t);
        if (!spec.ok.length) {
          expect(got, 'nowhere to send it').toBeNull();
          seen.nowhere++;
          return;
        }
        expect(
          spec.ok.map((s) => s.id),
          'the stop',
        ).toContain(got);
        expect(spec.sources.has(got!), 'back to its source').toBe(false);
        if (spec.fromStore) seen.fromStore++;
        const stop = w.builder.stations.find((s) => s.id === got)!;
        if (stop.def.stockpile) seen.house++;
        else seen.depot++;
      },
      { seeds: SEEDS, shrink: shrinkLoaded },
    );
    // the layouts are worth running: loads from a store and from producers, to either kind
    expect(seen.fromStore).toBeGreaterThan(5);
    expect(seen.house).toBeGreaterThan(5);
    expect(seen.depot).toBeGreaterThan(5);
    expect(seen.nowhere).toBeGreaterThan(0);
  });

  it('tops up at a producer holding what it carries, or goes where the goods go, no store else', () => {
    const seen = { topUp: 0, dump: 0, houseHeldStone: 0 };
    forAll(
      genLoaded,
      (c) => {
        // room left: the second hopper empty, the first with a little in it
        const { w, t } = build({ ...c, wagons: [{ from: c.wagons[0]!.from, amount: 8 }, null] });
        const spec = dumpsFor(w, t);
        const got = w.fleet.chooseNext(t);
        // a warehouse with a pile of what the train carries is not a place to top up
        if (spec.houses.some((s) => s.stored('stone') >= 4)) seen.houseHeldStone++;
        if (got === null) {
          expect(spec.ok, 'bound for nowhere').toEqual([]);
          return;
        }
        if (spec.ok.some((s) => s.id === got)) {
          seen.dump++;
          return;
        }
        // not the dump: a producer of stone, never a depot or a warehouse
        const stop = w.builder.stations.find((s) => s.id === got)!;
        expect(stop.def.pool, 'a depot that is not the dump').toBeFalsy();
        expect(stop.def.stockpile, 'a warehouse that is not the dump').toBeFalsy();
        expect(stop.availableCargo()).toContain('stone');
        seen.topUp++;
      },
      { seeds: SEEDS, shrink: shrinkLoaded },
    );
    expect(seen.topUp).toBeGreaterThan(0);
    expect(seen.dump).toBeGreaterThan(0);
    expect(seen.houseHeldStone).toBeGreaterThan(10);
  });

  it('takes a load from a quarry to whichever of a warehouse and a depot is nearer', () => {
    const at = (houseX: number, depotX: number) => {
      const w = world();
      const q = put(w, 'quarry', 6, { stone: 40 });
      const house = put(w, 'warehouse', houseX);
      const depot = put(w, 'depot', depotX);
      const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
      return { stop: w.fleet.chooseNext(t), house, depot };
    };
    const house = at(52, 60);
    expect(house.stop).toBe(house.house.id);
    const depot = at(60, 52);
    expect(depot.stop).toBe(depot.depot.id);
  });
});

// ---- ranking an empty train

describe('an empty freight train ranking producers, over generated piles', () => {
  // as in 'an empty freight train choosing a stop'
  rowLengths(locoDef('f7'));

  interface Twins {
    /** units of stone in each: equal, so the haul is too */
    stored: number;
    /** a quarry's room is `capacityMul` of its level's */
    mul: number;
    /** the levels of the west and the east quarry */
    levels: [number, number];
  }

  it('picks the one that is fuller for its room, with equal hauls and legs', () => {
    const seen = { west: 0, east: 0 };
    const press = (f: number) => 1 + f + (f >= 0.8 ? 1 : 0);
    forAll(
      (rng: Rng): Twins => ({
        stored: rng.pick([10, 25, 40, 100, 400]),
        mul: rng.pick([0.5, 0.75, 1, 1.5, 2, 4]),
        levels: [rng.int(1, 4), rng.int(1, 4)],
      }),
      (c) => {
        rules.capacityMul = c.mul;
        const w = world();
        const t = train(w, 30);
        const { west, east } = twins(w, t.poses[0].x, c.levels, { stone: c.stored });
        // the same pressure is a tie the order of the stations breaks: nothing to say of it
        if (press(west.fill()) === press(east.fill())) return;
        const fuller = press(west.fill()) > press(east.fill()) ? west : east;
        expect(w.fleet.chooseNext(t), `fill ${west.fill()} west, ${east.fill()} east`).toBe(
          fuller.id,
        );
        if (fuller === west) seen.west++;
        else seen.east++;
      },
      {
        seeds: Array.from({ length: 80 }, (_, i) => i + 1),
        shrink: function* (c) {
          if (c.stored !== 40) yield { ...c, stored: 40 };
          if (c.mul !== 1) yield { ...c, mul: 1 };
        },
      },
    );
    expect(seen.west).toBeGreaterThan(5);
    expect(seen.east).toBeGreaterThan(5);
  });
});

// ---- running trains through a line

interface RunCase {
  sites: Site[];
  /** the warehouse capacity of the case */
  cap: number;
  trains: { mid: number; east: boolean; flat: boolean }[];
  /** whether the stations make goods while the trains run */
  make: boolean;
}

function genRun(rng: Rng): RunCase {
  const extra = rng.int(0, 3);
  const at = slots(rng, 3 + extra);
  const sites: Site[] = [
    { kind: 'quarry', x: at.pop()!, held: rng.pick([20, 45, 60]) },
    { kind: 'warehouse', x: at.pop()!, held: rng.pick([0, 0, 40, 80]) },
    { kind: 'depot', x: at.pop()!, held: 0 },
  ];
  const kinds: Kind[] = ['quarry', 'warehouse', 'farm', 'depot'];
  while (at.length) {
    const kind = rng.pick(kinds);
    sites.push({
      kind,
      x: at.pop()!,
      held: kind === 'depot' ? 0 : rng.pick([0, 30, 60]),
    });
  }
  const mids = rng.shuffle(Array.from({ length: 9 }, (_, i) => MID(i)));
  return {
    sites,
    cap: rng.pick([30, 60, 200, 600]),
    trains: Array.from({ length: rng.int(1, 2) }, (_, i) => ({
      mid: mids[i],
      east: rng.chance(0.5),
      flat: rng.chance(0.3),
    })),
    make: rng.chance(0.5),
  };
}
function* shrinkRun(c: RunCase): Iterable<RunCase> {
  if (c.trains.length > 1) yield { ...c, trains: c.trains.slice(0, 1) };
  for (let i = 0; i < c.sites.length; i++)
    if (c.sites.length > 3) yield { ...c, sites: c.sites.filter((_, k) => k !== i) };
  for (let i = 0; i < c.sites.length; i++)
    if (c.sites[i].held > 0)
      yield { ...c, sites: c.sites.map((s, k) => (k === i ? { ...s, held: 0 } : s)) };
}

/** Every unit of stone and wheat in the world: in stations, on trains and in the stores. */
function goods(w: World): Map<string, number> {
  const out = new Map<string, number>();
  const add = (c: string, n: number) => out.set(c, (out.get(c) ?? 0) + n);
  for (const s of w.builder.stations) for (const [c, n] of s.storage) add(c, n);
  for (const t of w.fleet.trains) for (const g of t.wagons) if (g.cargo) add(g.cargo, g.amount);
  const stored = w.builder.stores.totals();
  for (const c of ['stone', 'wheat']) add(c, stored.get(c) ?? 0);
  return out;
}

/**
 * What a warehouse holds, through each stop of a train at it: no kind of goods goes both in and
 * out. With one train on the line that is the warehouse's own account of the stop.
 */
class Ledger {
  private at: Station | null = null;
  private last = new Map<string, number>();
  private way = new Map<string, number>();
  readonly problems: string[] = [];
  stops = 0;
  constructor(private readonly t: Train) {}

  look(now: number) {
    const st = this.t.atStation?.def.stockpile ? this.t.atStation : null;
    if (st !== this.at) {
      this.at = st;
      this.last.clear();
      this.way.clear();
      if (st) this.stops++;
    }
    if (!st) return;
    for (const c of new Set([...st.storage.keys(), ...this.last.keys()])) {
      const v = st.stored(c);
      const was = this.last.get(c);
      this.last.set(c, v);
      if (was === undefined || Math.abs(v - was) < 1e-9) continue;
      const dir = v > was ? 1 : -1;
      const before = this.way.get(c);
      if (before !== undefined && before !== dir)
        this.problems.push(
          `t=${now.toFixed(2)}: ${c} in warehouse ${st.id} went ${dir > 0 ? 'up' : 'down'} after going ${before > 0 ? 'up' : 'down'} in one stop`,
        );
      this.way.set(c, dir);
    }
  }
}

describe('freight trains running a generated line', () => {
  function build(c: RunCase) {
    // ids start over, so that a layout built twice is the same layout
    resetTrainIds();
    resetStationIds();
    rules.warehouseCap = c.cap;
    const w = world();
    for (const s of c.sites) putSite(w, s);
    const trains = c.trains.map((k) =>
      launch(
        w,
        train(
          w,
          k.mid,
          k.flat ? [empty(), { ...empty(), def: wagonDef('flatbed') }] : undefined,
          k.east,
        ),
      ),
    );
    return { w, trains };
  }

  it(
    'moves no kind of goods both ways at one warehouse stop, and creates and loses none',
    { timeout: 300_000 },
    () => {
      const seen = { ledgerStops: 0, conserved: 0, drops: 0 };
      forAll(
        genRun,
        (c) => {
          const { w, trains } = build(c);
          const watches = trains.map((t) => new Watch(t));
          // the warehouse's own account of a stop is the whole story with one train only
          const ledgers = trains.length === 1 ? trains.map((t) => new Ledger(t)) : [];
          const before = goods(w);
          let now = 0;
          for (let i = 1; i <= 240 / GDT; i++) {
            now += GDT;
            if (c.make) for (const s of w.builder.stations) s.tick(GDT);
            w.fleet.tick(GDT, now);
            for (const k of watches) k.look(now);
            for (const k of ledgers) k.look(now);
            if (!c.make && i % 20 === 0) {
              const was = goods(w);
              for (const key of new Set([...before.keys(), ...was.keys()]))
                expect(was.get(key) ?? 0, `${key} at t=${now.toFixed(2)}`).toBeCloseTo(
                  before.get(key) ?? 0,
                  6,
                );
            }
          }
          if (!c.make) seen.conserved++;
          for (const k of watches) expect(k.problems).toEqual([]);
          for (const k of ledgers) {
            expect(k.problems).toEqual([]);
            seen.ledgerStops += k.stops;
          }
          seen.drops += watches.reduce((a, k) => a + k.drops, 0);
        },
        {
          seeds: Array.from({ length: 24 }, (_, i) => i + 1),
          shrink: shrinkRun,
        },
      );
      // the layouts are worth running
      expect(seen.ledgerStops).toBeGreaterThan(5);
      expect(seen.conserved).toBeGreaterThan(3);
      expect(seen.drops).toBeGreaterThan(5);
    },
  );

  it('runs the same way twice', { timeout: 300_000 }, () => {
    forAll(
      genRun,
      (c) => {
        const outcome = () => {
          const { w, trains } = build(c);
          let now = 0;
          for (let i = 0; i < 120 / GDT; i++) {
            now += GDT;
            if (c.make) for (const s of w.builder.stations) s.tick(GDT);
            w.fleet.tick(GDT, now);
          }
          return JSON.stringify({
            trains: trains.map((t) => t.toJSON()),
            stations: w.builder.stations.map((s) => [s.id, [...s.storage]]),
            stores: w.builder.stores.toJSON(),
          });
        };
        expect(outcome()).toBe(outcome());
      },
      { seeds: [1, 2, 3, 4, 5, 6], shrink: shrinkRun },
    );
  });
});

// ---- what comes aboard, and what a stop does when it can only be partly emptied

describe('what a freight train takes on at the stations it serves', () => {
  /** The most of each kind the train held at any moment of `seconds`, ticked one by one. */
  function peak(w: World, t: Train, seconds: number, from = 0) {
    const most = new Map<string, number>();
    for (let i = 0, now = from; i < seconds / GDT; i++) {
      w.fleet.tick(GDT, (now += GDT));
      for (const [c, n] of aboard(t)) most.set(c, Math.max(most.get(c) ?? 0, n));
    }
    return most;
  }
  const flat = () => ({ ...empty(), def: wagonDef('flatbed') });

  it('loads what a producer makes, as Production did', () => {
    const w = world();
    put(w, 'farm', 50, { wheat: 40 });
    const depot = put(w, 'depot', 75);
    const t = launch(w, train(w, 30, [empty(), flat()]));
    const wheat0 = depot.stored('wheat');
    const most = peak(w, t, 200);
    expect(most.get('wheat') ?? 0).toBeGreaterThan(10);
    expect(depot.stored('wheat') - wheat0).toBeGreaterThan(10);
  });

  it('takes nothing a warehouse holds, however much, as Collection did no more', () => {
    const w = world();
    const house = put(w, 'warehouse', 50, { stone: 60, wheat: 60 });
    const depot = put(w, 'depot', 75);
    const t = launch(w, train(w, 30, [empty(), flat()]));
    const most = peak(w, t, 200);
    expect(most.size, 'nothing aboard').toBe(0);
    expect(house.stored('stone') + house.stored('wheat')).toBe(120);
    expect(depot.totalStored()).toBe(0);
  });

  it('loads nothing at a warehouse while carrying goods from elsewhere, and unloads what it can', () => {
    // arriving with 40 stone from a quarry at a warehouse that has room for 30 of it: the train
    // puts 30 down, keeps 10, takes nothing of the wheat the warehouse also holds, and its next
    // stop is not that warehouse
    rules.warehouseCap = 60;
    const w = world();
    const q = put(w, 'quarry', 6);
    const house = put(w, 'warehouse', 45, { stone: 0, wheat: 30 });
    const depot = put(w, 'depot', 75);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    t.wagons.push({ ...flat(), uid: 13 });
    const stone0 = depot.stored('stone');
    launch(w, t);
    expect(house.roomFor('stone')).toBe(30);
    const watch = new Watch(t);
    // to the moment it has left the warehouse
    let now = 0;
    let at = false;
    let carried: Map<string, number> | null = null;
    while (!carried && now < 200) {
      now += GDT;
      w.fleet.tick(GDT, now);
      watch.look(now);
      if (t.atStation === house) at = true;
      else if (at) carried = aboard(t);
    }
    expect(watch.drops, 'it unloaded at the warehouse').toBe(1);
    expect(house.stored('stone')).toBeCloseTo(30, 6);
    expect(house.stored('wheat'), 'and took no wheat').toBeCloseTo(30, 6);
    expect(carried?.get('stone') ?? 0, 'what did not fit it carries on').toBeCloseTo(10, 6);
    expect(carried?.has('wheat')).toBe(false);
    run(w, [watch], 150, false, now);
    expect(watch.problems).toEqual([]);
    // the 10 that did not fit reached the depot; the pile the train left behind stays
    expect(depot.stored('stone') - stone0, 'the rest reached the depot').toBeCloseTo(10, 6);
    expect(house.stored('stone')).toBeCloseTo(30, 6);
  });

  it('takes nothing at a warehouse it could put none of its goods into, though it holds some', () => {
    // sent to a warehouse that has filled up since: it carries stone from a quarry, cannot unload
    // it, and must not fill its empty wagon with the wheat the warehouse holds
    rules.warehouseCap = 30;
    const w = world();
    const q = put(w, 'quarry', 6);
    const house = put(w, 'warehouse', 45, { stone: 20, wheat: 10 });
    put(w, 'depot', 75);
    expect(house.roomFor('stone')).toBe(0);
    const t = train(w, 30, [stoneFrom(q.id), flat()]);
    t.schedule = [defaultStop(house.id)];
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    let stopped = 0;
    for (let i = 0, now = 0; i < 120 / GDT; i++) {
      w.fleet.tick(GDT, (now += GDT));
      if (t.atStation !== house) continue;
      stopped++;
      expect(aboard(t).get('wheat') ?? 0, 'wheat aboard').toBe(0);
      expect(house.stored('wheat'), 'the warehouse still holds its wheat').toBe(10);
      expect(house.stored('stone'), 'and its stone').toBe(20);
    }
    expect(stopped, 'it stopped at the warehouse').toBeGreaterThan(20);
  });

  it('no longer says it put goods down from the moment it sets off', () => {
    const w = world();
    put(w, 'quarry', 20, { stone: 55 });
    const house = put(w, 'warehouse', 45);
    put(w, 'depot', 75);
    const t = launch(w, train(w, 30));
    let said = 0;
    let left = false;
    for (let i = 0, now = 0; i < 400 / GDT && !left; i++) {
      w.fleet.tick(GDT, (now += GDT));
      if (t.atStation === house && t.toJSON().dropped) said++;
      // the first moment it is no longer at the warehouse it put the goods into
      else if (said && t.atStation === null) {
        left = true;
        expect(t.state).toBe('moving');
        expect(t.toJSON().dropped, 'saved while under way').toBe(false);
      }
    }
    expect(said, 'it said so while it stood at the warehouse').toBeGreaterThan(0);
    expect(left, 'and then set off').toBe(true);
  });

  it(
    'stays at the warehouse it filled while nothing else is worth a trip, however long',
    { timeout: 60_000 },
    () => {
      // each time its idle wait ends it asks again, and the pile it put down is the best there is:
      // that is not a pick to set off for, nor a reason to load it again
      const w = world();
      const q = put(w, 'quarry', 20, { stone: 40 });
      const house = put(w, 'warehouse', 45);
      put(w, 'depot', 75);
      const t = launch(w, train(w, 30));
      const watch = new Watch(t);
      const now = run(w, [watch], 150, false);
      expect(q.stored('stone')).toBeLessThan(1);
      expect(t.atStation, 'standing at the warehouse').toBe(house);
      const pile = house.stored('stone');
      expect(pile).toBeGreaterThan(30);
      run(w, [watch], 900, false, now);
      expect(watch.problems).toEqual([]);
      expect(t.atStation).toBe(house);
      expect(house.stored('stone'), 'the pile is as it was').toBeCloseTo(pile, 6);
      expect(aboard(t).size, 'and the train empty').toBe(0);
    },
  );
});
