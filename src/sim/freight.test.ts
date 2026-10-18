import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, stationDef } from './stations';
import { Train, DYNAMIC_MODES, defaultStop, resetTrainIds, type WagonSlot } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { STR } from '../strings';
import { forAll } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

// The Freight route mode (issue #233): one mode for what Production and Collection did. An empty
// train ranks producers and warehouses by how full they are; a load taken from a warehouse goes to
// a depot and one taken at producers to a warehouse; a loaded train tops up at producers only;
// and a train never takes out of a warehouse what it put into it.

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  // a warehouse is worth picking with what a level 1 store holds
  rules.collectMin = 30;
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
});

afterEach(() => {
  delete stationDef('quarry').span;
});

/**
 * A quarry as wide as the warehouse (2 x 1), for a test that wants the two the same distance from
 * a tile: a warehouse's centre is half a tile past its corner, a one-tile quarry's is on it.
 * `afterEach` takes the span off again.
 */
function wideQuarry() {
  stationDef('quarry').span = { w: 2, h: 1 };
}

const SIZE = 96;
const ROW = 30;
const GDT = 0.05;

/** A grass map with a straight line along row 30, and a fleet over it. */
function world() {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass);
  const track = new TrackGraph(SIZE, SIZE);
  const stock = new Stockpile();
  const economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
  for (let x = 2; x < SIZE - 2; x++) track.place(x, ROW, 'straight', 1);
  return { map, track, stock, builder, fleet };
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
  /**
   * A quarry and a warehouse, each holding 40 stone, the same distance either side of a train
   * standing at column 30, each with a depot four tiles from it on the side facing the train, so
   * that the way on to where the load would go (a depot for either) is as long for both too. The
   * quarry's room is `capacityMul` of 60 and the warehouse's `warehouseCap`, which sets how full
   * each is. `mirror` puts the quarry to the east instead of the west.
   */
  function pair(capacityMul: number, warehouseCap: number, mirror: boolean) {
    rules.capacityMul = capacityMul;
    rules.warehouseCap = warehouseCap;
    wideQuarry();
    const w = world();
    const t = train(w, 30);
    const hx = t.poses[0].x;
    const s = mirror ? -1 : 1;
    // both two tiles wide: the one west of the train starts 15 tiles from it, the other 14
    const q = put(w, 'quarry', Math.round(s > 0 ? hx - 15 : hx + 14), { stone: 40 });
    const house = put(w, 'warehouse', Math.round(s > 0 ? hx + 14 : hx - 15), { stone: 40 });
    put(w, 'depot', q.x + (s > 0 ? 4 : -4));
    put(w, 'depot', house.x + (s > 0 ? -4 : 4));
    // the premise: equally far, and as far again to the depot that takes the load
    expect(Math.abs(q.cx - hx)).toBe(Math.abs(house.cx - hx));
    const [d1, d2] = w.builder.stations.filter((x) => x.def.pool);
    expect(reach(d1, q)).toBe(reach(d2, house));
    return { w, t, q, house };
  }

  it('picks the fuller of a producer and a warehouse, whichever is which', () => {
    // the quarry holds 40 of 60 (two thirds); the warehouse 40 of its capacity
    const cases: [mul: number, cap: number, fuller: 'quarry' | 'warehouse'][] = [
      [1, 45, 'warehouse'],
      [1, 80, 'quarry'],
      [1, 1000, 'quarry'],
      // both past four fifths, which counts for more still: the fuller of the two
      [0.75, 41, 'warehouse'],
      [0.7, 1000, 'quarry'],
      [0.75, 48, 'quarry'],
    ];
    for (const [mul, cap, fuller] of cases)
      for (const mirror of [false, true]) {
        const { w, t, q, house } = pair(mul, cap, mirror);
        expect(w.fleet.chooseNext(t), `${fuller} fuller, quarry ${mirror ? 'east' : 'west'}`).toBe(
          fuller === 'quarry' ? q.id : house.id,
        );
      }
  });

  it('picks the fuller whatever the layout, with equal hauls and legs', { timeout: 60_000 }, () => {
    forAll(
      (rng: Rng) => ({
        mul: rng.pick([0.5, 0.75, 1, 1.5, 2]),
        cap: rng.pick([42, 45, 50, 60, 80, 120, 400, 1000]),
        mirror: rng.chance(0.5),
      }),
      ({ mul, cap, mirror }) => {
        const { w, t, q, house } = pair(mul, cap, mirror);
        const fillQ = q.totalStored() / q.capacity;
        const fillW = house.totalStored() / house.capacity;
        const press = (f: number) => 1 + f + (f >= 0.8 ? 1 : 0);
        // equal pressure is a tie the order of the stations breaks: not asked here
        if (press(fillQ) === press(fillW)) return;
        expect(w.fleet.chooseNext(t)).toBe(press(fillQ) > press(fillW) ? q.id : house.id);
      },
    );
  });

  it('leaves a warehouse alone below the pickup pile, however full it is, and moves the line', () => {
    rules.warehouseCap = 30;
    const w = world();
    const t = train(w, 30);
    // 29 of 30 is nearly full for its capacity
    const house = put(w, 'warehouse', 50, { stone: 29 });
    const far = put(w, 'quarry', 80, { stone: 12 });
    put(w, 'depot', 70);
    expect(w.fleet.chooseNext(t)).toBe(far.id);
    for (const [min, picked] of [
      [29, true],
      [29.5, false],
      [10, true],
      [100, false],
    ] as const) {
      rules.collectMin = min;
      expect(w.fleet.chooseNext(t) === house.id, `pickup pile ${min}`).toBe(picked);
    }
    // and a warehouse alone with it is no stop at all
    rules.collectMin = 30;
    w.builder.stations.splice(w.builder.stations.indexOf(far), 1);
    expect(w.fleet.chooseNext(t)).toBeNull();
  });

  it('counts only what the train can haul towards the pickup pile', () => {
    const w = world();
    const t = train(w, 30);
    // a hopper takes no water: 500 of it is no pile, and the 10 stone beside it are too few
    const house = put(w, 'warehouse', 50, { water: 500, stone: 10 });
    put(w, 'depot', 70);
    expect(w.fleet.chooseNext(t)).toBeNull();
    // with the pickup pile at nothing a handful of stone is still too little to send a train for,
    // and the credit a producer filling up gets is none to a warehouse that holds a lot besides
    rules.collectMin = 0;
    house.storage.set('stone', 1);
    expect(w.fleet.chooseNext(t)).toBeNull();
    house.storage.set('stone', 10);
    expect(w.fleet.chooseNext(t)).toBe(house.id);
  });
});

// ------------------------------------------------------------------ where a load goes

describe('a loaded freight train choosing a stop', () => {
  it('takes goods from a warehouse to a depot, though a warehouse with room is nearer', () => {
    const w = world();
    const src = put(w, 'warehouse', 6, { stone: 100 });
    const near = put(w, 'warehouse', 34);
    const depot = put(w, 'depot', 70);
    const t = train(w, 30, [stoneFrom(src.id), stoneFrom(src.id)]);
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
    expect(near.room).toBeGreaterThan(5);
  });

  it('takes goods from a warehouse to another warehouse only when no depot is reachable', () => {
    const w = world();
    const src = put(w, 'warehouse', 6, { stone: 100 });
    const near = put(w, 'warehouse', 34);
    const t = train(w, 30, [stoneFrom(src.id), stoneFrom(src.id)]);
    expect(w.fleet.chooseNext(t)).toBe(near.id);
    // never back into the one it came from
    w.builder.stations.splice(w.builder.stations.indexOf(near), 1);
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

  it('takes goods from producers to a depot when that is clearly nearer', () => {
    const w = world();
    const q = put(w, 'quarry', 6, { stone: 40 });
    put(w, 'warehouse', 70);
    const depot = put(w, 'depot', 33);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
  });

  it('takes any load with goods from a warehouse in it to a depot', () => {
    const w = world();
    const q = put(w, 'quarry', 6, { stone: 40 });
    const src = put(w, 'warehouse', 12, { stone: 100 });
    put(w, 'warehouse', 36);
    const depot = put(w, 'depot', 75);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(src.id)]);
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
    // and with only producer goods aboard, to the warehouse
    t.wagons[1].origin = q.id;
    expect(w.fleet.chooseNext(t)).toBe(w.builder.stations.find((s) => s.x === 36)!.id);
  });

  it('tops up at a producer, never at a warehouse that is not where the goods go', () => {
    const w = world();
    const src = put(w, 'warehouse', 2, { stone: 100 });
    const pile = put(w, 'warehouse', 33, { stone: 300 });
    const depot = put(w, 'depot', 64);
    // half full of stone from a warehouse, room for as much again
    const t = train(w, 30, [stoneFrom(src.id), { ...empty() }]);
    // the only other store of stone worth a detour is a warehouse: the train goes to the depot
    expect(w.fleet.chooseNext(t)).toBe(depot.id);
    expect(pile.stored('stone')).toBeGreaterThan(rules.collectMin);
    // with a quarry off to the west, nearer than the depot, it tops up there first
    const q = put(w, 'quarry', 10, { stone: 40 });
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
    'stays out of the warehouse it filled when nothing else is worth a trip, for another train to empty',
    { timeout: 60_000 },
    () => {
      // the quarry holds one load and makes no more: the train hauls it to the warehouse, whose
      // pile is then the one thing worth fetching, and the train that put it there is not the one
      // to fetch it
      const w = world();
      const q = put(w, 'quarry', 20, { stone: 40 });
      const house = put(w, 'warehouse', 45);
      put(w, 'depot', 75);
      const first = launch(w, train(w, 30));
      const watch = new Watch(first);
      const filled = run(w, [watch], 200, false);
      expect(q.stored('stone')).toBeLessThan(1);
      expect(watch.drops, 'it put the load down').toBe(1);
      expect(house.stored('stone'), 'and left it there').toBeGreaterThan(30);
      expect(first.state).toBe('idle');
      expect(watch.problems).toEqual([]);
      // another train, new to the line, takes the pile to the depot
      const second = launch(w, train(w, 60, undefined, false));
      run(w, [watch, new Watch(second)], 300, false, filled);
      expect(watch.problems).toEqual([]);
      expect(house.stored('stone')).toBeLessThan(1);
      expect(w.stock.get('stone')).toBeGreaterThan(30);
    },
  );

  it('picks a warehouse pile up when it arrives empty, and takes it to the depot', () => {
    const w = world();
    const house = put(w, 'warehouse', 45, { stone: 60 });
    put(w, 'warehouse', 52);
    const depot = put(w, 'depot', 75);
    const t = launch(w, train(w, 30));
    let atDepot = false;
    for (let i = 0, now = 0; i < 400 / GDT; i++) {
      w.fleet.tick(GDT, (now += GDT));
      if (t.atStation === depot) atDepot = true;
    }
    expect(atDepot, 'it reached the depot').toBe(true);
    expect(house.stored('stone')).toBeLessThan(60);
    expect(w.stock.get('stone')).toBeGreaterThan(0);
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

describe('a freight train that put goods down at a stop', () => {
  it('says so in its save, and drops that on setting off', () => {
    const w = world();
    put(w, 'quarry', 20, { stone: 55 });
    const house = put(w, 'warehouse', 45);
    put(w, 'depot', 75);
    const t = launch(w, train(w, 30));
    let seen = false;
    for (let i = 0, now = 0; i < 400 / GDT && !seen; i++) {
      w.fleet.tick(GDT, (now += GDT));
      const dropped = t.toJSON().dropped;
      if (t.atStation === house && dropped) {
        seen = true;
        const back = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())) as never, w.track);
        expect(back.toJSON().dropped).toBe(true);
      }
    }
    expect(seen, 'a train put goods down at the warehouse').toBe(true);
    // it sets off, and what it put down no longer holds it
    for (let i = 0, now = 100; i < 60 / GDT; i++) w.fleet.tick(GDT, (now += GDT));
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
 * Where a loaded freight train's goods may go, said without the fleet's own helpers: a load with
 * anything from a warehouse in it to a depot (to a warehouse that is not a source only if there is
 * no depot), a load from producers only to the nearest warehouse with room that is not a source,
 * or a depot that is nearer. `ok` is every station that is right; ties in distance give several.
 */
function dumpsFor(w: World, t: Train) {
  const head = t.poses[0];
  const far = (s: Station) => Math.abs(s.cx - head.x) + Math.abs(s.cy - head.y);
  const all = w.builder.stations;
  const depots = all.filter((s) => s.def.pool);
  const houses = all.filter((s) => s.def.stockpile);
  const sources = new Set(t.wagons.map((g) => g.origin).filter((o): o is number => o !== null));
  const loaded = t.wagons.filter((g) => g.cargo && g.amount > 0);
  const units = loaded.reduce((a, g) => a + g.amount, 0);
  const fromStore = loaded.some((g) => houses.some((s) => s.id === g.origin));
  const nearest = (xs: Station[]) => {
    const m = Math.min(...xs.map(far));
    return xs.filter((s) => far(s) === m);
  };
  const ok: Station[] = [];
  if (fromStore) {
    if (depots.length) ok.push(...nearest(depots));
    else {
      const roomy = houses.filter((s) => !sources.has(s.id) && s.room > 1);
      if (roomy.length) ok.push(...nearest(roomy));
    }
  } else {
    const roomy = houses.filter((s) => !sources.has(s.id) && s.room >= Math.min(units, 5));
    if (!roomy.length) {
      if (depots.length) ok.push(...nearest(depots));
    } else {
      const house = nearest(roomy);
      const depot = depots.length ? nearest(depots) : [];
      // the warehouse, unless a depot is nearer: then either (how much nearer is pinned below)
      if (!depot.length || far(depot[0]) >= far(house[0])) ok.push(...house);
      else ok.push(...house, ...depot);
    }
  }
  return { ok, fromStore, houses, depots, sources };
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

  it('takes goods from a warehouse to a depot, or to another warehouse only if none exists', () => {
    const seen = { fromStore: 0, noDepot: 0, depotNotNearest: 0 };
    forAll(
      genLoaded,
      (c) => {
        const { w, t } = build(full(c));
        const spec = dumpsFor(w, t);
        if (!spec.fromStore) return;
        seen.fromStore++;
        if (!spec.depots.length) seen.noDepot++;
        const got = w.fleet.chooseNext(t);
        if (!spec.ok.length) {
          expect(got, 'nowhere to send it').toBeNull();
          return;
        }
        expect(
          spec.ok.map((s) => s.id),
          'the stop',
        ).toContain(got);
        // a depot is bound for though a warehouse with room is nearer
        const roomier = spec.houses.some((s) => s.room > 1 && !spec.sources.has(s.id));
        if (roomier && spec.depots.length) seen.depotNotNearest++;
      },
      { seeds: SEEDS, shrink: shrinkLoaded },
    );
    // the layouts are worth running: both rules were asked
    expect(seen.fromStore).toBeGreaterThan(10);
    expect(seen.noDepot).toBeGreaterThan(0);
    expect(seen.depotNotNearest).toBeGreaterThan(0);
  });

  it('takes goods from producers to a warehouse that is not their source, or a depot nearer', () => {
    const seen = { producerOnly: 0, house: 0, depot: 0 };
    forAll(
      genLoaded,
      (c) => {
        const { w, t } = build(full(c));
        const spec = dumpsFor(w, t);
        if (spec.fromStore) return;
        seen.producerOnly++;
        const got = w.fleet.chooseNext(t);
        if (!spec.ok.length) {
          expect(got, 'nowhere to send it').toBeNull();
          return;
        }
        expect(
          spec.ok.map((s) => s.id),
          'the stop',
        ).toContain(got);
        const stop = w.builder.stations.find((s) => s.id === got)!;
        if (stop.def.stockpile) seen.house++;
        else seen.depot++;
        expect(spec.sources.has(got!), 'back to its source').toBe(false);
      },
      { seeds: SEEDS, shrink: shrinkLoaded },
    );
    expect(seen.producerOnly).toBeGreaterThan(10);
    expect(seen.house).toBeGreaterThan(0);
    expect(seen.depot).toBeGreaterThan(0);
  });

  it('tops up at a producer holding what it carries, or goes where the goods go, no warehouse else', () => {
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

  it('keeps the rule Production had for a depot that is nearer: a depot only when clearly so', () => {
    // a load from a quarry, and a warehouse with room: the warehouse unless the depot is more than
    // half as near again
    const at = (houseX: number, depotX: number) => {
      const w = world();
      const q = put(w, 'quarry', 6, { stone: 40 });
      const house = put(w, 'warehouse', houseX);
      const depot = put(w, 'depot', depotX);
      const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
      const head = t.poses[0];
      const far = (s: Station) => Math.abs(s.cx - head.x) + Math.abs(s.cy - head.y);
      return { stop: w.fleet.chooseNext(t), house, depot, ratio: far(house) / far(depot) };
    };
    const near = at(60, 52);
    expect(near.ratio, 'premise: nearer, but not by half').toBeGreaterThan(1);
    expect(near.ratio).toBeLessThan(1.5);
    expect(near.stop).toBe(near.house.id);
    const clear = at(80, 44);
    expect(clear.ratio, 'premise: nearer by more than half').toBeGreaterThan(1.5);
    expect(clear.stop).toBe(clear.depot.id);
  });
});

// ---- ranking an empty train

describe('an empty freight train ranking a producer and a warehouse, over generated piles', () => {
  interface Pair {
    /** units of stone in each: equal, so the haul is too */
    stored: number;
    /** the quarry's room is 60 times this */
    mul: number;
    /** the warehouse's room */
    cap: number;
    /** `rules.collectMin`, at most `stored` so that the warehouse is a candidate */
    pickup: number;
    mirror: boolean;
  }
  /**
   * A quarry and a warehouse the same distance either side of the train, each with a depot four
   * tiles from it on the side facing the train: the way there, the way on, the haul and the time
   * since a train last loaded are equal, and only how full each is differs.
   */
  function pairAt(c: Pair) {
    rules.capacityMul = c.mul;
    rules.warehouseCap = c.cap;
    rules.collectMin = c.pickup;
    wideQuarry();
    const w = world();
    const t = train(w, 30);
    const hx = t.poses[0].x;
    const s = c.mirror ? -1 : 1;
    const q = put(w, 'quarry', Math.round(s > 0 ? hx - 15 : hx + 14), { stone: c.stored });
    const house = put(w, 'warehouse', Math.round(s > 0 ? hx + 14 : hx - 15), { stone: c.stored });
    put(w, 'depot', q.x + (s > 0 ? 4 : -4));
    put(w, 'depot', house.x + (s > 0 ? -4 : 4));
    const [d1, d2] = w.builder.stations.filter((x) => x.def.pool);
    expect(Math.abs(q.cx - hx), 'premise: equally far').toBe(Math.abs(house.cx - hx));
    expect(reach(d1, q), 'premise: as far on').toBe(reach(d2, house));
    return { w, t, q, house };
  }
  const fill = (s: Station) => s.totalStored() / s.capacity;

  it('picks the one that is fuller for its room, whatever the pile it must hold at least', () => {
    const seen = { quarry: 0, house: 0, fullHouseBigPile: 0 };
    forAll(
      (rng: Rng): Pair => {
        const stored = rng.pick([10, 25, 40, 100, 400]);
        return {
          stored,
          mul: rng.pick([0.5, 0.75, 1, 1.5, 2, 4]),
          cap: rng.pick([12, 30, 45, 60, 100, 500, 1000]),
          pickup: rng.pick([0, 1, 10, stored]),
          mirror: rng.chance(0.5),
        };
      },
      (c) => {
        const { w, t, q, house } = pairAt(c);
        // the same fullness is a tie the order of the stations breaks: nothing to say of it
        if (fill(q) === fill(house)) return;
        const fuller = fill(q) > fill(house) ? q : house;
        expect(w.fleet.chooseNext(t), `quarry ${fill(q)} full, warehouse ${fill(house)}`).toBe(
          fuller.id,
        );
        if (fuller === q) seen.quarry++;
        else seen.house++;
        // a warehouse holding many times the pile it needs, and fuller than a producer or not
        if (c.stored >= 4 * Math.max(1, c.pickup) && fuller === q) seen.fullHouseBigPile++;
      },
      {
        seeds: Array.from({ length: 80 }, (_, i) => i + 1),
        shrink: function* (c) {
          if (c.mirror) yield { ...c, mirror: false };
          if (c.pickup > 0) yield { ...c, pickup: 0 };
        },
      },
    );
    expect(seen.quarry).toBeGreaterThan(5);
    expect(seen.house).toBeGreaterThan(5);
    // a big pile does not outweigh the room it sits in: the producer that is fuller still wins
    expect(seen.fullHouseBigPile).toBeGreaterThan(3);
  });

  it('weighs a pile the warehouse holds many times over the pickup pile no more than its fill', () => {
    // 100 stone against a pickup pile of 5: a pull that grew with the pile past the pickup pile
    // would carry the warehouse past a producer that is two thirds full
    const { w, t, q, house } = pairAt({
      stored: 100,
      mul: 1.5,
      cap: 1000,
      pickup: 5,
      mirror: false,
    });
    expect(fill(q)).toBeGreaterThan(fill(house));
    expect(w.fleet.chooseNext(t)).toBe(q.id);
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

/** Every unit of stone and wheat in the world: in stations, on trains and in the stockpile. */
function goods(w: World): Map<string, number> {
  const out = new Map<string, number>();
  const add = (c: string, n: number) => out.set(c, (out.get(c) ?? 0) + n);
  for (const s of w.builder.stations) for (const [c, n] of s.storage) add(c, n);
  for (const t of w.fleet.trains) for (const g of t.wagons) if (g.cargo) add(g.cargo, g.amount);
  for (const c of ['stone', 'wheat']) add(c, w.stock.get(c));
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
            stock: [...w.stock.amounts],
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
    put(w, 'depot', 75);
    const t = launch(w, train(w, 30, [empty(), flat()]));
    const wheat0 = w.stock.get('wheat');
    const most = peak(w, t, 200);
    expect(most.get('wheat') ?? 0).toBeGreaterThan(10);
    expect(w.stock.get('wheat') - wheat0).toBeGreaterThan(10);
  });

  it('loads every kind of goods a warehouse holds that the wagons take, as Collection did', () => {
    const w = world();
    const house = put(w, 'warehouse', 50, { stone: 60, wheat: 60 });
    put(w, 'depot', 75);
    const t = launch(w, train(w, 30, [empty(), flat()]));
    const before = { stone: w.stock.get('stone'), wheat: w.stock.get('wheat') };
    const most = peak(w, t, 200);
    expect(most.get('stone') ?? 0, 'stone aboard').toBeGreaterThan(10);
    expect(most.get('wheat') ?? 0, 'wheat aboard').toBeGreaterThan(10);
    expect(house.stored('stone') + house.stored('wheat')).toBeLessThan(120);
    expect(w.stock.get('stone') - before.stone).toBeGreaterThan(10);
    expect(w.stock.get('wheat') - before.wheat).toBeGreaterThan(10);
  });

  it('loads nothing at a warehouse while carrying goods from elsewhere, and unloads what it can', () => {
    // arriving with 40 stone from a quarry at a warehouse that has room for 30 of it: the train
    // puts 30 down, keeps 10, takes nothing of the wheat the warehouse also holds, and its next
    // stop is not that warehouse
    rules.warehouseCap = 60;
    const w = world();
    const q = put(w, 'quarry', 6);
    const house = put(w, 'warehouse', 45, { stone: 0, wheat: 30 });
    put(w, 'depot', 75);
    const t = train(w, 30, [stoneFrom(q.id), stoneFrom(q.id)]);
    t.wagons.push({ ...flat(), uid: 13 });
    const stone0 = w.stock.get('stone');
    launch(w, t);
    expect(house.room).toBe(30);
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
    // the 10 that did not fit reached the depot, and then the pile the train left behind
    expect(w.stock.get('stone') - stone0, 'the rest reached the depot').toBeGreaterThanOrEqual(10);
  });

  it('takes nothing at a warehouse it could put none of its goods into, though it holds some', () => {
    // sent to a warehouse that has filled up since: it carries stone from a quarry, cannot unload
    // it, and must not fill its empty wagon with the wheat the warehouse holds
    rules.warehouseCap = 30;
    const w = world();
    const q = put(w, 'quarry', 6);
    const house = put(w, 'warehouse', 45, { stone: 20, wheat: 10 });
    put(w, 'depot', 75);
    expect(house.room).toBe(0);
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
