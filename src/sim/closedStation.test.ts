import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { locoDef, wagonDef } from '../gacha/items';
import { Builder } from './build';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import { MAX_LEVEL, STATION_DEFS, Station, resetStationIds } from './stations';
import { Train, defaultStop, resetTrainIds, type StopPlan } from './trains';
import { startWork } from './upgrade';
import { rules, DEFAULT_RULES, daySeconds, weekSeconds } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { setSeasonOffset } from './weather';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
  resetStationIds();
});

// ------------------------------------------------------------------ production

describe('a station closed for its upgrade, of every kind and level', () => {
  it('makes nothing until the work is done, then its normal rate, its store untouched', () => {
    // Every kind at every level a work starts from, under any production rule, ground and
    // catchment, holding any goods: closed, its weekly rate is 0 however long it waits; the step
    // that ends the work gives the rate of the same station at the new level never closed. What
    // it holds stays as it was throughout.
    const kinds = STATION_DEFS.map((d) => d.id);
    const cargos = [...new Set(STATION_DEFS.flatMap((d) => d.produces.map((p) => p.cargo)))];
    const map = emptyMap(4242, 16, 16, Terrain.Grass);
    const builder = new Builder(
      map,
      new RegionState(map),
      new TrackGraph(16, 16),
      new Economy(),
      new Stockpile(),
    );
    forAll(
      (rng) => ({
        productionMul: rng.pick([0.5, 1, 2.5]),
        terrainFactor: rng.pick([0.15, 0.6, 1, 1.6]),
        people: rng.pick([0, 10, 60, 500]),
        held: cargos.filter(() => rng.chance(0.4)).map((c) => [c, rng.int(0, 80)] as const),
        dt: rng.pick([1, daySeconds(), weekSeconds()]),
        /** share of the work's time the first step takes, short of its end */
        part: rng.pick([0.01, 0.5, 0.99]),
      }),
      ({ productionMul, terrainFactor, people, held, dt, part }) => {
        rules.productionMul = productionMul;
        const make = (id: string, level: number) => {
          const s = new Station(id, 1, 1);
          s.level = level;
          s.terrainFactor = terrainFactor;
          s.passengerPopulation = people;
          for (const [c, n] of held) if (n > 0) s.storage.set(c, n);
          return s;
        };
        for (const id of kinds)
          for (let level = 1; level < MAX_LEVEL; level++) {
            const label = `${id} at level ${level}`;
            const s = make(id, level);
            const holds = () => JSON.stringify([...s.storage]);
            const before = holds();
            const open = s.productionPerWeek;
            s.work = startWork(level + 1);
            expect(s.closed, label).toBe(true);
            expect(s.productionPerWeek, `${label}, closed`).toBe(0);
            expect(holds(), `${label}: closing it`).toBe(before);
            // open again with the work dropped (the editor's downgrade), the rate is back
            const work = s.work;
            s.work = null;
            expect(s.productionPerWeek, `${label}, reopened`).toBe(open);
            s.work = work;

            builder.stations.splice(0, builder.stations.length, s);
            builder.tickWorks(work!.total * part);
            s.tick(dt);
            expect([s.closed, s.level, s.productionPerWeek], `${label}, part way`).toEqual([
              true,
              level,
              0,
            ]);
            expect(holds(), `${label}: a tick of ${dt} s while closed`).toBe(before);
            builder.tickWorks(work!.total);
            const next = make(id, level + 1);
            expect([s.closed, s.level], `${label}, done`).toEqual([false, level + 1]);
            expect(s.productionPerWeek, `${label}, done`).toBe(next.productionPerWeek);
            expect(holds(), `${label}: the work ending`).toBe(before);
            // the comparison is worth making: a producer open makes something
            if (s.producedCargo().length && (id !== 'station' || people > 0))
              expect(next.productionPerWeek, `${label}, the open rate`).toBeGreaterThan(0);
          }
      },
      {
        shrink: function* (c) {
          for (const held of shrinkArray(c.held)) yield { ...c, held };
        },
      },
    );
  });
});

// ------------------------------------------------------------------ trains at a closed station

/** Row of the main line. */
const ROW = 30;
const GDT = 0.05;
/** `MIN_DWELL` in src/sim/trains.ts: the shortest stop a train makes, game seconds */
const MIN_DWELL = 2;
/** `MAX_DWELL_FULL` in src/sim/trains.ts: the longest a train waits for full wagons */
const MAX_DWELL_FULL = 240;

/** A grass world with the main line along ROW from x 4 to 56. */
function railway(): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 64 });
  line(w, 4, ROW, 56);
  return w;
}

/** An F7 diesel and the given wagons on the main line, its head at x, heading east, tanks full. */
function train(w: SimWorld, x: number, wagons: string[]) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = wagons.map((id, i) => ({
    uid: 2 + i,
    def: wagonDef(id),
    level: 1,
    cargo: null,
    amount: 0,
    origin: null,
  }));
  expect(t.spawnAt(w.track, x, ROW, Dir.W)).toBe(true);
  t.oil = t.oilCap;
  w.fleet.trains.push(t);
  return t;
}

/** The fleet stepped as the game steps it, with the game clock. */
function clock(w: SimWorld) {
  let now = 0;
  return {
    get now() {
      return now;
    },
    /** Steps until `done` holds, for at most `seconds`; returns whether it does. */
    until(done: () => boolean, seconds: number) {
      for (let i = 0; i < seconds / GDT && !done(); i++) w.fleet.tick(GDT, (now += GDT));
      return done();
    },
  };
}

interface Call {
  closed: boolean;
  /** wheat in the farm's store when the train pulls in */
  pile: number;
  /** the stop's own least dwell, game seconds (0: only as long as loading takes) */
  minDwell: number;
}

/**
 * A scheduled train with a boxcar, set to wait for a full load at a farm (x 30) and then go on to
 * a warehouse (x 50), pulls in from x 20. Returns how long it stood at the farm, what it took on
 * and what the farm held when it left.
 */
function callAt(c: Call) {
  const w = railway();
  const farm = station(w, 'farm', 30, ROW - 1);
  const store = station(w, 'warehouse', 50, ROW - 1);
  if (c.pile > 0) farm.storage.set('wheat', c.pile);
  if (c.closed) farm.work = startWork(2);
  expect(farm.closed).toBe(c.closed);
  const t = train(w, 20, ['boxcar']);
  const stop: StopPlan = { ...defaultStop(farm.id), waitFull: true, minDwell: c.minDwell };
  t.schedule = [stop, defaultStop(store.id)];
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  t.onPathReady({ builder: w.builder });
  const sim = clock(w);
  expect(
    sim.until(() => t.state === 'loading' && t.atStation === farm, 120),
    'never reached the farm',
  ).toBe(true);
  const arrived = sim.now;
  expect(
    sim.until(() => t.atStation !== farm, MAX_DWELL_FULL + 30),
    'never left the farm',
  ).toBe(true);
  const wagon = t.wagons[0];
  return {
    dwell: sim.now - arrived,
    loaded: wagon.cargo === 'wheat' ? wagon.amount : 0,
    capacity: wagon.def.capacity,
    left: farm.stored('wheat'),
    /** units a second the farm hands over */
    rate: farm.loadRate * farm.loadBoost * rules.loadRateMul,
    closed: farm.closed,
  };
}

describe('a train set to wait for a full load', () => {
  // each call steps the fleet for up to a few game minutes
  const SLOW = { timeout: 20_000 };

  it('at a closed station with nothing in store leaves after its least dwell', SLOW, () => {
    for (const minDwell of [0, 5, 30]) {
      const r = callAt({ closed: true, pile: 0, minDwell });
      const least = Math.max(MIN_DWELL, minDwell);
      expect(r.dwell, `least dwell ${minDwell}`).toBeGreaterThanOrEqual(least - GDT / 2);
      expect(r.dwell, `least dwell ${minDwell}`).toBeLessThanOrEqual(least + 3 * GDT);
      expect([r.loaded, r.left, r.closed]).toEqual([0, 0, true]);
    }
  });

  it('at a closed station holding a pile loads from it and leaves without waiting', SLOW, () => {
    // piles below one unit, below a wagonful and above it
    for (const pile of [0.5, 3, 10.5, 25.9, 26, 80])
      for (const minDwell of [0, 12]) {
        const label = `pile ${pile}, least dwell ${minDwell}`;
        const r = callAt({ closed: true, pile, minDwell });
        // it took what the pile gave, down to less than a unit or up to a full wagon
        expect(r.loaded + r.left, `${label}: wheat kept`).toBeCloseTo(pile, 6);
        const full = r.loaded >= r.capacity - 1e-3;
        expect(full || r.left < 1, `${label}: left ${r.left} with ${r.loaded} aboard`).toBe(true);
        if (pile >= 1) expect(r.loaded, `${label}: loaded`).toBeGreaterThan(0);
        // and stood no longer than loading it took, or its least dwell
        const loading = Math.min(pile, r.capacity) / r.rate;
        const most = Math.max(MIN_DWELL, minDwell, loading) + 3 * GDT;
        expect(r.dwell, label).toBeLessThanOrEqual(most);
        expect(r.closed).toBe(true);
      }
  });

  it('at an open producer still waits for output, up to the limit', SLOW, () => {
    for (const pile of [0, 10.5]) {
      const r = callAt({ closed: false, pile, minDwell: 0 });
      // the boxcar does not fill from the pile, so the train waits the whole limit
      expect(r.loaded, `pile ${pile}`).toBeCloseTo(pile - r.left, 6);
      expect(r.loaded, `pile ${pile}`).toBeLessThan(r.capacity);
      expect(r.dwell, `pile ${pile}`).toBeGreaterThanOrEqual(MAX_DWELL_FULL - GDT / 2);
      expect(r.dwell, `pile ${pile}`).toBeLessThanOrEqual(MAX_DWELL_FULL + 3 * GDT);
    }
  });
});

// ------------------------------------------------------------------ dispatch

/** Producers a production train fetches from; a farm and a lumber camp make bulk goods. */
const PRODUCERS = ['farm', 'lumber', 'quarry', 'pump', 'mine', 'sand_pit', 'copper_mine'] as const;
/** Wagons for every kind of goods, the brake van's six units of bulk the smallest. */
const WAGONS = ['brake_van', 'flatbed', 'boxcar', 'wood_hopper', 'dump_hopper', 'water_cart'];
/** Big wagons that carry no bulk goods. */
const BIG_OTHER = ['dump_hopper', 'bathtub', 'pressure_tank', 'welded_tank'];

interface Producer {
  kind: (typeof PRODUCERS)[number];
  /** column beside the line, above it */
  x: number;
  /** units of its cargo waiting */
  pile: number;
  closed: boolean;
}
interface Dispatch {
  producers: Producer[];
  /** a warehouse on the line to dump into, at this column, or none */
  warehouse: number | null;
  wagons: string[];
  trainX: number;
}

/** A production train on the main line, the producers and any warehouse beside it. */
function dispatchScene(c: Dispatch) {
  const w = railway();
  const placed: { s: Station; p: Producer }[] = [];
  for (const p of c.producers) {
    const s = new Station(p.kind, p.x, ROW - 1);
    s.storage.set(s.producedCargo()[0], p.pile);
    w.builder.stations.push(s);
    placed.push({ s, p });
  }
  if (c.warehouse !== null) w.builder.stations.push(new Station('warehouse', c.warehouse, ROW - 1));
  const t = train(w, c.trainX, c.wagons);
  t.mode = 'production';
  return { w, t, placed };
}

/**
 * What the train picks with the closed producers closed, as producers that make nothing and are
 * open, and as producers open at their normal rate.
 */
function picks(c: Dispatch) {
  const { w, t, placed } = dispatchScene(c);
  const shut = placed.filter(({ p }) => p.closed).map(({ s }) => s);
  const pick = () => w.fleet.chooseNext(t);
  for (const s of shut) s.work = startWork(2);
  const closed = pick();
  for (const s of shut) {
    s.work = null;
    s.terrainFactor = 0;
  }
  expect(shut.every((s) => s.productionPerWeek === 0)).toBe(true);
  const idle = pick();
  for (const s of shut) s.terrainFactor = 1;
  const working = pick();
  return { closed, idle, working, ids: placed.map(({ s }) => s.id) };
}

describe('dispatch to a closed producer', () => {
  it('gives a small pile no credit for filling up', () => {
    // a brake van holds six units of wheat; seven waiting are worth the trip only with the
    // credit a producer that keeps producing gets
    const c: Dispatch = {
      producers: [{ kind: 'farm', x: 30, pile: 7, closed: true }],
      warehouse: 50,
      wagons: ['brake_van', 'dump_hopper'],
      trainX: 12,
    };
    const { closed, idle, working, ids } = picks(c);
    expect(working).toBe(ids[0]);
    expect(idle).toBeNull();
    expect(closed).toBe(idle);
  });

  it('weighs a closed producer as one whose rate is zero, over layouts', () => {
    let credited = 0;
    forAll(
      (rng): Dispatch => {
        const slots = rng.shuffle(Array.from({ length: 9 }, (_, i) => 14 + 5 * i));
        const trainX = slots.pop()!;
        // half the trains have room for a few units of bulk among big wagons for other goods:
        // the consist the credit for filling up changes a pick for, at a pile just past the van
        const van = rng.chance(0.5);
        return {
          producers: Array.from({ length: rng.int(1, 4) }, () => ({
            kind:
              van && rng.chance(0.6) ? rng.pick(['farm', 'lumber'] as const) : rng.pick(PRODUCERS),
            x: slots.pop()!,
            pile: rng.chance(0.4)
              ? 6 + 0.25 * rng.int(1, 8)
              : rng.chance(0.3)
                ? rng.int(0, 60)
                : rng.int(0, 12) + rng.pick([0, 0.5]),
            closed: rng.chance(0.6),
          })),
          warehouse: rng.chance(0.7) ? slots.pop()! : null,
          wagons: van
            ? ['brake_van', rng.pick(BIG_OTHER), ...(rng.chance(0.3) ? [rng.pick(BIG_OTHER)] : [])]
            : Array.from({ length: rng.int(1, 3) }, () => rng.pick(WAGONS)),
          trainX,
        };
      },
      (c) => {
        const { closed, idle, working } = picks(c);
        expect(closed).toBe(idle);
        if (working !== idle) credited++;
      },
      {
        shrink: function* (c) {
          for (const producers of shrinkArray(c.producers))
            if (producers.length) yield { ...c, producers };
          for (const wagons of shrinkArray(c.wagons)) if (wagons.length) yield { ...c, wagons };
          if (c.warehouse !== null) yield { ...c, warehouse: null };
          for (let i = 0; i < c.producers.length; i++)
            for (const pile of shrinkInt(Math.floor(c.producers[i].pile)))
              yield {
                ...c,
                producers: c.producers.map((p, j) => (j === i ? { ...p, pile } : p)),
              };
        },
      },
    );
    // the layouts are worth comparing: in some the credit would change the pick
    expect(credited).toBeGreaterThan(0);
  });
});
