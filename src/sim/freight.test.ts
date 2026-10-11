import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { Train, DYNAMIC_MODES, resetTrainIds, type WagonSlot } from './trains';
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
    const w = world();
    const t = train(w, 30);
    const hx = t.poses[0].x;
    const s = mirror ? -1 : 1;
    const q = put(w, 'quarry', Math.round(hx - s * 14), { stone: 40 });
    const house = put(w, 'warehouse', Math.round(hx + s * 14), { stone: 40 });
    put(w, 'depot', q.x + (s > 0 ? 3 : -4));
    put(w, 'depot', house.x + (s > 0 ? -4 : 3));
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

  it('picks the fuller whatever the layout, with equal hauls and legs', () => {
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
  it('takes nothing back out of what it put in, and is not bound for that warehouse on leaving', () => {
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
  });

  it('does not take goods the warehouse also holds on at a stop where it put goods down', () => {
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
  });

  it('stays out of the warehouse it filled when nothing else is worth a trip, for another train to empty', () => {
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
  });

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
