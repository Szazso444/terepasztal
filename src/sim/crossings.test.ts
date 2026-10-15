import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { DESCENT_SPEED } from '../world/railProfile';
import { Rng } from '../engine/rng';
import { content } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
import {
  consistPhysics,
  defaultStop,
  resetTrainIds,
  type LocoMode,
  type RouteMode,
  type StopPlan,
  type Train,
  type TrainState,
} from './trains';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SimStep, startStock, type StepContext } from './step';
import { SIM_STEP } from './time';
import {
  BOARDING_SPEED_MUL,
  DETOUR_RETRY,
  PeopleSim,
  ROAD_SPEED_MUL,
  WAKE,
  WALK_MARGIN,
  WALK_SPEED,
  offCrossing,
  walkSpeed,
  walkable,
  type CrossingDetour,
  type Person,
  type PersonState,
} from './people';
import {
  CROSSING_HOLD,
  CROSSING_HORIZON,
  CROSSING_LEAD,
  CROSSING_MARGIN,
  CROSSING_WALK,
  CrossingWatch,
  DETOUR_STATES,
  ROUTED_STATES,
  crossingPull,
  crossingReach,
  type CrossingTrain,
} from './crossings';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  resetTrainIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the crossings or the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

/** Chebyshev distance from a point to the centre of tile (x, y): under 0.5 is on the tile. */
const cheb = (p: { x: number; y: number }, x: number, y: number) =>
  Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
/** On tile (x, y), inside its edge by more than rounding: the oracle for "on the crossing". */
const onTile = (p: { x: number; y: number }, x: number, y: number) => cheb(p, x, y) < 0.5 - 1e-6;

// ------------------------------------------------------------------ the constants

describe('the crossing constants', () => {
  it('hold 1.5 s, and look ahead for the slowest walk over a tile corner to corner, plus 2 s', () => {
    expect(CROSSING_HOLD).toBe(1.5);
    expect(CROSSING_MARGIN).toBe(2);
    // the slowest pace a walker has anywhere is a walker's off a road, not boarding
    for (const transient of [false, true])
      for (const onRoad of [false, true])
        expect(walkSpeed({ transient }, onRoad)).toBeGreaterThanOrEqual(WALK_SPEED);
    expect(walkSpeed({ transient: false }, false)).toBe(WALK_SPEED);
    expect(BOARDING_SPEED_MUL).toBeGreaterThanOrEqual(1);
    expect(ROAD_SPEED_MUL).toBeGreaterThanOrEqual(1);
    expect(CROSSING_WALK).toBeCloseTo(Math.SQRT2 / WALK_SPEED, 12);
    expect(CROSSING_HORIZON).toBeCloseTo(CROSSING_WALK + CROSSING_MARGIN, 12);
    // the number the issue asks to state: 9.07 s at 0.2 tiles a second
    expect(CROSSING_HORIZON).toBeCloseTo(9.07, 2);
    // a train is counted at a tile no later than its edge: pathAhead's arc is an eighth past it
    expect(CROSSING_LEAD).toBeGreaterThanOrEqual(1 / 8);
  });
});

// ------------------------------------------------------------------ the watch, with plain trains

/** Width of the map the plain trains' keys are of. */
const W = 64;
const keyOf = (x: number, y: number) => y * W + x;

/**
 * Every state a train can be in, and whether it has its way set and runs along it as soon as it
 * may: under way or held on its way (`moving`), or stopped on it for fuel, power or pull. A state
 * added to TrainState fails the typecheck here until it is told one way or the other.
 */
const ROUTED: Record<TrainState, boolean> = {
  moving: true,
  noFuel: true,
  noPower: true,
  overweight: true,
  loading: false,
  waiting: false,
  idle: false,
  yielding: false,
  noRoute: false,
  stranded: false,
};
const STATES = Object.keys(ROUTED) as TrainState[];
const ROUTED_LIST = STATES.filter((s) => ROUTED[s]);

/** What a plain train is made of; with no state, it is under way (`moving`). */
interface Plain {
  state?: TrainState;
  speed?: number;
  progress?: number;
  cars?: number[];
  ahead?: { x: number; y: number; arc: number }[];
  acceleration?: number;
  maxSpeed?: number;
}
/** A train as the watch reads it, from plain data. */
function plain(o: Plain): CrossingTrain {
  return {
    state: o.state ?? 'moving',
    speed: o.speed ?? 0,
    pathProgress: o.progress ?? 0,
    occupancyKeys: (w) => {
      expect(w).toBe(W);
      return o.cars ?? [];
    },
    pathAhead: () => o.ahead ?? [],
    ...(o.acceleration === undefined ? {} : { acceleration: o.acceleration }),
    ...(o.maxSpeed === undefined ? {} : { maxSpeed: o.maxSpeed }),
  };
}
/**
 * The way east along row `y` from a head on the centre of tile `x0` at arc `progress`, `tiles`
 * long, as `pathAhead` gives a plain straight: each tile's arc an eighth of a tile past its west
 * edge, the head's own tile first.
 */
function eastward(x0: number, y: number, progress: number, tiles: number) {
  return Array.from({ length: tiles }, (_, i) => ({
    x: x0 + i,
    y,
    arc: progress - 0.5 + i + 1 / 8,
  }));
}
/** Every tile the watch holds closed, as keys in order. */
function closedKeys(watch: CrossingWatch, h = W) {
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) if (watch.closed(x, y)) out.push(keyOf(x, y));
  return out;
}

describe('CrossingWatch with plain trains', () => {
  it('closes a crossing a car stands on, whatever the train is doing, and no tile but a crossing', () => {
    forAll(
      (rng) => ({
        crossings: Array.from({ length: rng.int(0, 6) }, () =>
          keyOf(rng.int(0, 15), rng.int(0, 7)),
        ),
        trains: Array.from({ length: rng.int(0, 3) }, () => ({
          state: rng.pick(STATES),
          speed: rng.pick([0, 0, 0.4, 1.5]),
          cars: Array.from({ length: rng.int(0, 5) }, () => keyOf(rng.int(0, 15), rng.int(0, 7))),
        })),
      }),
      (c) => {
        const watch = new CrossingWatch(W);
        watch.update(
          c.trains.map((t) => plain(t)),
          new Set(c.crossings),
          SIM_STEP,
        );
        const want = [...new Set(c.crossings)]
          .filter((k) => c.trains.some((t) => t.cars.includes(k)))
          .sort((a, b) => a - b);
        expect(closedKeys(watch, 8)).toEqual(want);
        expect(watch.size).toBe(want.length);
      },
      {
        shrink: function* (c) {
          for (const crossings of shrinkArray(c.crossings)) yield { ...c, crossings };
          for (const trains of shrinkArray(c.trains)) yield { ...c, trains };
        },
      },
    );
  });

  it('closes a crossing a train with its way set could reach within the horizon, and none further on', () => {
    // running or standing on its way, in any state that has one
    forAll(
      (rng) => {
        const progress = rng.range(0, 40);
        return {
          state: rng.pick(ROUTED_LIST),
          speed: rng.pick([0, 1e-3, 0.3, 0.9, 1.6, 2.4]),
          progress,
          head: rng.int(1, 4),
          acceleration: rng.pick([undefined, 0, 0.05, 0.4, 0.9]),
          maxSpeed: rng.pick([undefined, 0.5, 1, 2.3]),
          crossings: Array.from({ length: rng.int(1, 5) }, () => rng.int(1, 58)),
        };
      },
      (c) => {
        const way = eastward(c.head, 9, c.progress, 60 - c.head);
        const t = plain({ ...c, ahead: way });
        const watch = new CrossingWatch(W);
        const keys = new Set(c.crossings.filter((x) => x >= c.head).map((x) => keyOf(x, 9)));
        watch.update([t], keys, SIM_STEP);
        const far = crossingReach(t, CROSSING_HORIZON) + CROSSING_LEAD;
        for (const s of way)
          expect(watch.closed(s.x, s.y), `tile ${s.x} at arc ${s.arc} of ${far}`).toBe(
            keys.has(keyOf(s.x, s.y)) && s.arc - c.progress <= far,
          );
      },
    );
  });

  it('closes for a train reaching it just inside the horizon, not just outside it', () => {
    for (const speed of [0.25, 0.9, 1.6, 3]) {
      const progress = 3.5;
      // the arc at which a train keeping its speed is at the crossing in CROSSING_HORIZON seconds
      const at = progress + speed * CROSSING_HORIZON + CROSSING_LEAD;
      for (const [arc, closed] of [
        [at - 1e-6, true],
        [at + 1e-6, false],
      ] as const) {
        const watch = new CrossingWatch(W);
        const t = plain({ speed, progress, ahead: [{ x: 40, y: 3, arc }] });
        watch.update([t], new Set([keyOf(40, 3)]), SIM_STEP);
        expect(watch.closed(40, 3), `${speed} tiles/s, arc ${arc}`).toBe(closed);
      }
    }
  });

  it('names the states in which a train has its way set', () => {
    expect([...ROUTED_STATES].sort()).toEqual([...ROUTED_LIST].sort());
  });

  it('closes for a stopped train with no route no crossing off its tiles, and for one held with its route set those within its reach', () => {
    // the train of #404's finding: held 3 tiles short of a crossing, at a signal or loading
    const way = eastward(5, 4, 12, 20);
    const keys = new Set([keyOf(5, 4), keyOf(8, 4), keyOf(20, 4)]);
    const cars = [keyOf(5, 4), keyOf(4, 4)];
    const held = { speed: 0, progress: 12, cars, ahead: way, acceleration: 0.4, maxSpeed: 1 };
    // from a standstill it could run 9.09 tiles in the horizon: to the crossing 3 tiles on, not 15
    expect(crossingReach(plain(held), CROSSING_HORIZON)).toBeCloseTo(9.085, 3);
    for (const state of STATES) {
      const watch = new CrossingWatch(W);
      watch.update([plain({ ...held, state })], keys, SIM_STEP);
      expect(closedKeys(watch), state).toEqual(
        ROUTED[state] ? [keyOf(5, 4), keyOf(8, 4)] : [keyOf(5, 4)],
      );
    }
    // any way and speed it was left with: with no route, only the tiles under its cars; held with
    // its route set, the crossings it could reach from a standstill, and none further on
    forAll(
      (rng) => ({
        state: rng.pick(STATES),
        speed: rng.pick([0, 0, 0.4, 1.5]),
        progress: rng.range(0, 40),
        head: rng.int(1, 4),
        acceleration: rng.pick([undefined, 0, 0.05, 0.4, 0.9]),
        maxSpeed: rng.pick([undefined, 0.5, 1, 2.3]),
        crossings: Array.from({ length: rng.int(1, 5) }, () => rng.int(0, 58)),
      }),
      (c) => {
        const speed = ROUTED[c.state] ? 0 : c.speed;
        const way = eastward(c.head, 9, c.progress, 60 - c.head);
        const cars = [keyOf(c.head, 9), keyOf(c.head - 1, 9)];
        const t = plain({ ...c, speed, cars, ahead: way });
        const watch = new CrossingWatch(W);
        const keys = new Set(c.crossings.map((x) => keyOf(x, 9)));
        watch.update([t], keys, SIM_STEP);
        const far = crossingReach(t, CROSSING_HORIZON) + CROSSING_LEAD;
        for (let x = 0; x < W; x++) {
          const k = keyOf(x, 9);
          const ahead = way.find((s) => s.x === x);
          const reached = ROUTED[c.state] && !!ahead && ahead.arc - c.progress <= far;
          expect(watch.closed(x, 9), `${c.state}: tile ${x}`).toBe(
            keys.has(k) && (cars.includes(k) || reached),
          );
        }
      },
    );
  });

  it('reaches as far as full acceleration to the top speed downhill takes a train', () => {
    // the oracle: the run stepped through in steps of 1e-4 s
    forAll(
      (rng) => ({
        speed: rng.range(0, 3),
        acceleration: rng.pick([undefined, 0, rng.range(0.05, 0.9)]),
        maxSpeed: rng.pick([undefined, rng.range(0.3, 3)]),
        t: rng.range(0, 12),
      }),
      (c) => {
        const t = plain(c);
        const a = c.acceleration ?? 0;
        const top = Math.max(c.speed, (c.maxSpeed ?? 0) * DESCENT_SPEED);
        const dt = 1e-4;
        let v = c.speed;
        let run = 0;
        for (let s = 0; s < c.t; s += dt) {
          const h = Math.min(dt, c.t - s);
          const v1 = Math.min(top, v + a * h);
          run += ((v + v1) / 2) * h;
          v = v1;
        }
        expect(crossingReach(t, c.t)).toBeCloseTo(run, 3);
        expect(crossingReach(t, c.t)).toBeGreaterThanOrEqual(c.speed * c.t - 1e-9);
      },
    );
  });

  it('counts on the hardest pull its units could give once they may, whatever pulls now', () => {
    const modes: readonly LocoMode[] = ['leading', 'multiple', 'doubleHeaded', 'standby'];
    const tanks = content.wagons.filter((w) => w.body === 'tank');
    forAll(
      (rng) => ({
        locos: Array.from({ length: rng.int(1, 4) }, (_, i) => ({
          def: rng.pick(content.locomotives),
          level: rng.int(0, 3),
          mode: i === 0 ? ('leading' as const) : rng.pick(modes.slice(1)),
          engaged: rng.chance(0.5),
        })),
        wagons: Array.from({ length: rng.int(0, 6) }, () => ({
          def: rng.chance(0.5) ? rng.pick(tanks) : rng.pick(content.wagons),
          level: rng.int(0, 3),
          cargo: rng.pick([null, 'stone', 'water']),
          amount: rng.range(0, 40),
          // the share of what it carries a run leaves in it, if a run may draw on it
          left: rng.range(0, 1),
        })),
      }),
      (c) => {
        const now = consistPhysics(c.locos, c.wagons).acceleration;
        const pull = crossingPull({ ...plain({ acceleration: now }), ...c });
        expect(pull).toBeGreaterThanOrEqual(now);
        expect(pull).toBeLessThanOrEqual(content.track.physics.maxAccel);
        // every way a run may lighten it: with a steam unit aboard, pulling or not, the water of
        // a tank wagon may go into the boiler, part of it or all (Train.drawTankerWater)
        const steam = c.locos.some((l) => l.def.type === 'steam');
        const drawable = (w: (typeof c.wagons)[number]) =>
          steam && w.def.body === 'tank' && w.cargo === 'water';
        const loads = [
          c.wagons,
          c.wagons.map((w) => (drawable(w) ? { ...w, amount: w.amount * w.left } : w)),
          c.wagons.map((w) => (drawable(w) ? { ...w, cargo: null, amount: 0 } : w)),
        ];
        // and every way fuel, water and the wire may leave its units able to pull, and the
        // standby rule of Train.refreshModes with them: the units not on standby that can pull
        // do, and when none of them can, the first standby unit that can steps in
        for (let usable = 0; usable < 1 << c.locos.length; usable++) {
          const can = (i: number) => ((usable >> i) & 1) === 1;
          const working = c.locos.some((l, i) => l.mode !== 'standby' && can(i));
          const stepIn = c.locos.findIndex((l, i) => l.mode === 'standby' && can(i));
          const on = c.locos.map((l, i) => ({
            ...l,
            engaged: l.mode !== 'standby' ? can(i) : !working && i === stepIn,
          }));
          for (const wagons of loads)
            expect(consistPhysics(on, wagons).acceleration).toBeLessThanOrEqual(pull + 1e-12);
        }
      },
    );
    // a steam engine with three tank wagons of water: what its boiler draws from them as it runs
    // leaves a consist that gains speed more than twice as hard as it does carrying it
    const mav375 = content.locomotives.find((l) => l.id === 'mav375')!;
    const riveted = content.wagons.find((w) => w.id === 'riveted_tank')!;
    const carrying = {
      ...plain({ state: 'moving' }),
      locos: [{ def: mav375, level: 0, mode: 'leading' as const, engaged: true }],
      wagons: Array.from({ length: 3 }, () => ({
        def: riveted,
        level: 0,
        cargo: 'water' as string | null,
        amount: riveted.capacity,
      })),
    };
    const loaded = consistPhysics(carrying.locos, carrying.wagons).acceleration;
    const drawn = consistPhysics(
      carrying.locos,
      carrying.wagons.map((w) => ({ ...w, cargo: null, amount: 0 })),
    ).acceleration;
    expect(drawn).toBeGreaterThan(2 * loaded);
    expect(crossingPull(carrying)).toBeGreaterThanOrEqual(drawn);
    // the train of the ten-minute step test, stopped for fuel 5 tiles short of a crossing: nothing
    // pulls while it waits, yet it sets off with its engine pulling once it has fuel
    const f7 = content.locomotives.find((l) => l.id === 'f7')!;
    const hopper = content.wagons.find((w) => w.id === 'wood_hopper')!;
    const stalled = {
      ...plain({ state: 'noFuel', progress: 3, ahead: eastward(2, 6, 3, 30), acceleration: 0 }),
      maxSpeed: f7.speed,
      locos: [{ def: f7, level: 0, mode: 'leading' as const, engaged: false }],
      wagons: [{ def: hopper, level: 0, cargo: null, amount: 0 }],
    };
    const fuelled = consistPhysics([{ ...stalled.locos[0], engaged: true }], stalled.wagons);
    expect(fuelled.acceleration).toBeGreaterThan(0.5);
    expect(crossingPull(stalled)).toBe(fuelled.acceleration);
    for (const [t, closed] of [
      [stalled, true],
      // counting only on what pulls now, it would not close
      [{ ...stalled, locos: undefined }, false],
    ] as const) {
      const watch = new CrossingWatch(W);
      watch.update([t], new Set([keyOf(7, 6)]), SIM_STEP);
      expect(watch.closed(7, 6)).toBe(closed);
    }
  });

  it('stays closed exactly CROSSING_HOLD from the first step it is clear, then opens', () => {
    forAll(
      (rng) => ({
        // steps with a car on it, or with a train coming, before it is clear
        busy: rng.int(1, 6),
        coming: rng.chance(0.5),
        steps: Array.from({ length: rng.int(1, 60) }, () =>
          rng.pick([SIM_STEP, 0.1, 0.25, 1 / 3, 0.5, 0.7]),
        ),
      }),
      (c) => {
        const watch = new CrossingWatch(W);
        const keys = new Set([keyOf(20, 6)]);
        const there = c.coming
          ? plain({ speed: 1, progress: 18, ahead: eastward(18, 6, 18, 5) })
          : plain({ cars: [keyOf(20, 6)] });
        for (let i = 0; i < c.busy; i++) {
          watch.update([there], keys, c.steps[0]);
          expect(watch.closed(20, 6)).toBe(true);
        }
        // gone: the first step that sees it clear starts the hold
        let clear = 0;
        let open = false;
        for (let i = 0; i < c.steps.length; i++) {
          if (i > 0) clear += c.steps[i];
          watch.update([plain({})], keys, c.steps[i]);
          const closed = watch.closed(20, 6);
          expect(closed, `after ${clear} s clear`).toBe(clear < CROSSING_HOLD - 1e-9);
          // once open it stays open
          if (open) expect(closed).toBe(false);
          open = !closed;
        }
      },
      {
        shrink: function* (c) {
          for (const steps of shrinkArray(c.steps)) if (steps.length) yield { ...c, steps };
          for (const busy of shrinkInt(c.busy, 1)) yield { ...c, busy };
        },
      },
    );
  });

  it('holds each crossing from the last step a train was over or coming, a train in the hold restarting it', () => {
    // The oracle reads the whole history: a crossing is closed while a car is on it or a train is
    // coming, and after that while the steps since the first clear one add up to under the hold.
    const xs = [5, 20, 40];
    forAll(
      (rng) => ({
        steps: Array.from({ length: rng.int(1, 120) }, () => ({
          gdt: rng.pick([SIM_STEP, 0.1, 0.25, 0.4, 0.7]),
          busy: xs.map(() =>
            rng.pick(['car', 'coming', 'clear', 'clear', 'clear', 'clear'] as const),
          ),
        })),
      }),
      (c) => {
        const keys = new Set(xs.map((x) => keyOf(x, 3)));
        const watch = new CrossingWatch(W);
        c.steps.forEach((s, i) => {
          const trains = s.busy.flatMap((b, j) =>
            b === 'car'
              ? [plain({ cars: [keyOf(xs[j], 3)] })]
              : b === 'coming'
                ? [plain({ speed: 1, progress: 0, ahead: [{ x: xs[j], y: 3, arc: 2 }] })]
                : [],
          );
          watch.update(trains, keys, s.gdt);
          xs.forEach((x, j) => {
            let last = -1;
            for (let m = 0; m <= i; m++) if (c.steps[m].busy[j] !== 'clear') last = m;
            let since = 0;
            for (let m = last + 2; m <= i; m++) since += c.steps[m].gdt;
            const want = last === i || (last >= 0 && since < CROSSING_HOLD - 1e-9);
            expect(watch.closed(x, 3), `crossing ${x} at step ${i}, ${since} s clear`).toBe(want);
          });
        });
      },
      {
        shrink: function* (c) {
          for (const steps of shrinkArray(c.steps)) if (steps.length) yield { steps };
        },
      },
    );
  });

  it('opens a crossing at once when its road or track is taken up, even in its hold', () => {
    const watch = new CrossingWatch(W);
    const k = keyOf(7, 7);
    watch.update([plain({ cars: [k] })], new Set([k]), SIM_STEP);
    watch.update([plain({})], new Set([k]), SIM_STEP);
    expect(watch.closed(7, 7)).toBe(true);
    watch.update([plain({})], new Set(), SIM_STEP);
    expect(watch.closed(7, 7)).toBe(false);
    // and a car on a tile that is no crossing closes nothing
    watch.update([plain({ cars: [k] })], new Set(), SIM_STEP);
    expect(watch.size).toBe(0);
  });

  it('holds no tile off the map closed, whatever key it would share', () => {
    const watch = new CrossingWatch(W);
    const k = keyOf(W - 1, 2);
    watch.update([plain({ cars: [k] })], new Set([k]), SIM_STEP);
    expect(watch.closed(W - 1, 2)).toBe(true);
    // (-1, 3) and (2W - 1, 1) would have the key y * W + x of (W - 1, 2)
    expect(watch.closed(-1, 3)).toBe(false);
    expect(watch.closed(2 * W - 1, 1)).toBe(false);
  });
});

// ------------------------------------------------------------------ the walkers

/** The crossing the walker tests are about, on a 21 by 21 grass map with no track. */
const CX = 10;
const CY = 10;
const closedC = (x: number, y: number) => x === CX && y === CY;
const MIDDAY = 0.5;
const WALKING: readonly PersonState[] = ['walk', 'gather', 'toStation', 'return'];

function field(seed = 1) {
  const map = emptyMap(seed, 21, 21, Terrain.Grass);
  const builder = new Builder(
    map,
    new RegionState(map),
    new TrackGraph(21, 21),
    new Economy(),
    new Stockpile(),
  );
  builder.free = true;
  return { map, builder };
}
/** A boarding figure (transient, so it lives without a home) at `at` walking `path`. */
function figure(path: { x: number; y: number }[], at = path[0]): Person {
  return {
    id: 1,
    x: at.x,
    y: at.y,
    home: '',
    outfit: 0,
    profession: 'passenger',
    carrying: false,
    state: 'walk',
    timer: 0,
    path,
    step: 0,
    transient: true,
    stationId: null,
  };
}
/** Tiles from (x0, y0) to (x1, y1), a step at a time, straight or diagonal. */
function walkOf(x0: number, y0: number, x1: number, y1: number) {
  const out = [{ x: x0, y: y0 }];
  let { x, y } = out[0];
  while (x !== x1 || y !== y1) {
    x += Math.sign(x1 - x);
    y += Math.sign(y1 - y);
    out.push({ x, y });
  }
  return out;
}

describe('a walker at a level crossing', () => {
  it('stops at its edge while it is closed, waits there as it was, and goes on when it opens', () => {
    const { map, builder } = field();
    const path = walkOf(CX, CY + 4, CX, CY - 4);
    // the same walker with the crossing closed, and with no crossing at all
    const people = new PeopleSim(map, builder, new Rng(1));
    const p = figure(path);
    people.persons.push(p);
    const free = new PeopleSim(map, builder, new Rng(1));
    const q = figure(path.map((t) => ({ ...t })));
    free.persons.push(q);
    const gdt = 0.25;
    let held: string | null = null;
    for (let i = 0; i < 160; i++) {
      people.tick(gdt, 0, MIDDAY, closedC);
      free.tick(gdt, 0, MIDDAY);
      expect(onTile(p, CX, CY)).toBe(false);
      if (held !== null) expect(JSON.stringify(p)).toBe(held);
      else if (q.y > CY + 0.5) expect(p).toEqual(q);
      else {
        // the step the free walker passes the edge, this one stops exactly on it
        expect(p.x).toBe(CX);
        expect(p.y).toBe(CY + 0.5);
        held = JSON.stringify(p);
      }
    }
    expect(held).not.toBeNull();
    // open: it goes on as a walker standing on the edge with nothing closed does, to the end
    const open = () => false;
    const after = new PeopleSim(map, builder, new Rng(1));
    after.persons.push(
      figure(
        path.map((t) => ({ ...t })),
        { x: CX, y: CY + 0.5 },
      ),
    );
    after.persons[0].step = p.step;
    for (let i = 0; i < 200 && (people.persons.length || after.persons.length); i++) {
      people.tick(gdt, 0, MIDDAY, open);
      after.tick(gdt, 0, MIDDAY);
      expect(people.persons).toEqual(after.persons);
    }
    expect(people.persons).toEqual([]);
  });

  it('never steps onto a closed crossing on any way, and goes on along any other', () => {
    // A walker anywhere about the crossing, on its edge or on it, bound for any tile round it, in
    // a step of any length. The oracle samples the way it would go with no crossing at all.
    forAll(
      (rng) => {
        const kind = rng.int(0, 2);
        let x: number;
        let y: number;
        if (kind === 0) {
          x = rng.range(CX - 2, CX + 2);
          y = rng.range(CY - 2, CY + 2);
        } else if (kind === 1) {
          // on an edge or a corner of the crossing
          const along = rng.pick([CX - 0.5, CX + 0.5, rng.range(CX - 0.5, CX + 0.5)]);
          const side = rng.pick([-0.5, 0.5]);
          [x, y] = rng.chance(0.5) ? [CX + side, along - CX + CY] : [along, CY + side];
        } else {
          x = CX + rng.int(-2, 2);
          y = CY + rng.int(-2, 2);
        }
        return {
          x,
          y,
          from: { x: Math.round(x), y: Math.round(y) },
          to: { x: CX + rng.int(-2, 2), y: CY + rng.int(-2, 2) },
          gdt: rng.pick([SIM_STEP, 0.5, 1, 2.5, 6, 15]),
        };
      },
      (c) => {
        const { map, builder } = field();
        const run = (closed: ((x: number, y: number) => boolean) | null) => {
          const people = new PeopleSim(map, builder, new Rng(1));
          const p = figure([c.from, c.to], c);
          people.persons.push(p);
          people.tick(c.gdt, 0, MIDDAY, closed);
          return p;
        };
        const free = run(null);
        const p = run(closedC);
        const before = figure([c.from, c.to], c);
        // nothing but where it stands and how far along its path it is
        expect({ ...p, x: 0, y: 0, step: 0 }).toEqual({ ...before, x: 0, y: 0, step: 0 });
        // the way it would have gone, sampled finely; how far in it gets past the crossing's edge
        const n = 4000;
        const inside = (s: number) =>
          onTile({ x: c.x + (free.x - c.x) * s, y: c.y + (free.y - c.y) * s }, CX, CY);
        let enters = -1;
        for (let i = 0; i <= n && enters < 0; i++) if (inside(i / n)) enters = i;
        if (onTile(c, CX, CY) || enters < 0) {
          // on it already, or a way that never sets foot on it: as with no crossing at all
          expect(p).toEqual(free);
          return;
        }
        // held: on the way it would have gone, short of the crossing, on its edge
        expect(p.step).toBe(before.step);
        expect(onTile(p, CX, CY)).toBe(false);
        expect(Math.abs(cheb(p, CX, CY) - 0.5)).toBeLessThanOrEqual(1e-6);
        const len = Math.hypot(free.x - c.x, free.y - c.y);
        const went = Math.hypot(p.x - c.x, p.y - c.y);
        expect(Math.abs((p.x - c.x) * (free.y - c.y) - (p.y - c.y) * (free.x - c.x))).toBeLessThan(
          1e-9,
        );
        // to within a sample of where the way first enters it
        expect(went).toBeLessThanOrEqual((enters / n) * len + 1e-9);
        expect(went).toBeGreaterThanOrEqual(((enters - 1) / n) * len - 1e-9);
      },
    );
  });

  it('goes exactly as it would with no crossing while no train comes', () => {
    // any walk through or past the crossing, at any step: a watch with no train changes nothing
    forAll(
      (rng) => ({
        from: { x: CX + rng.int(-5, 5), y: CY + rng.pick([-5, 5]) },
        to: { x: CX + rng.int(-5, 5), y: CY + rng.pick([-5, 5]) },
        gdt: rng.pick([SIM_STEP, 0.3, 1, 2.5]),
      }),
      (c) => {
        const { map, builder } = field();
        const plainWalk = new PeopleSim(map, builder, new Rng(3));
        const watched = new PeopleSim(map, builder, new Rng(3));
        const path = walkOf(c.from.x, c.from.y, c.to.x, c.to.y);
        plainWalk.persons.push(figure(path.map((q) => ({ ...q }))));
        watched.persons.push(figure(path.map((q) => ({ ...q }))));
        const watch = new CrossingWatch(21);
        const keys = new Set([CY * 21 + CX]);
        for (let i = 0; i < 10_000 && plainWalk.persons.length; i++) {
          plainWalk.tick(c.gdt, 0, MIDDAY);
          watch.update([], keys, c.gdt);
          watched.tick(c.gdt, 0, MIDDAY, watch.closed);
          expect(watched.persons).toEqual(plainWalk.persons);
        }
        expect(watched.persons).toEqual([]);
      },
    );
  });

  it('draws no random number and keeps its state and timer while it waits, in every walking state', () => {
    forAll(
      (rng) => ({
        state: rng.pick(WALKING),
        timer: rng.pick([0, 3.25, 47]),
        carrying: rng.chance(0.5),
        fromSouth: rng.chance(0.5),
        wait: rng.int(1, 40),
        stream: rng.int(1, 1e6),
      }),
      (c) => {
        const { map, builder } = field();
        const house = builder.spawnDecor(CX + 3, CY + (c.fromSouth ? 6 : -6), 'townhouse', 0);
        expect(house).not.toBeNull();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const sign = c.fromSouth ? 1 : -1;
        const p: Person = {
          ...figure(walkOf(CX, CY + 3 * sign, CX, CY - 3 * sign)),
          state: c.state,
          timer: c.timer,
          carrying: c.carrying,
          transient: c.state === 'walk',
          home: c.state === 'walk' ? '' : `d${house!.x},${house!.y}`,
        };
        people.persons.push(p);
        const population = p.transient ? 0 : 1;
        // walk up to the edge
        for (let i = 0; i < 400 && p.y !== CY + 0.5 * sign; i++)
          people.tick(0.25, population, MIDDAY, closedC);
        expect(p.y).toBe(CY + 0.5 * sign);
        const held = JSON.stringify(p);
        const stream = people.toJSON().rng;
        for (let i = 0; i < c.wait; i++) {
          people.tick(0.25, population, MIDDAY, closedC);
          expect(JSON.stringify(p)).toBe(held);
          expect(people.toJSON().rng).toBe(stream);
        }
        expect(people.persons).toEqual([p]);
      },
    );
  });
});

// ------------------------------------------------------------------ any run of a train with its way set

/** Tiles/s² a plain train brakes at. Any will do: the horizon bounds how soon a train can come. */
const BRAKE = 1.65;
/** The eight ways a walk can leave a tile. */
const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** What a plain train with its way set is made of. */
interface RunnerSpec {
  /** +1 runs east along row CY, -1 west */
  dir: 1 | -1;
  /** tiles from its head to the edge of the crossing it reaches first */
  gap: number;
  /** tiles of cars behind the head */
  length: number;
  acceleration: number;
  maxSpeed: number;
  /** share of its top speed downhill it starts at */
  share: number;
  /**
   * the least it slows to: 0 lets it stop and stand on its way, held as at a signal, until its
   * driving lets it go again
   */
  floor: number;
}

/**
 * A train on row CY of the walkers' field, read as the watch reads a Train and moved as trains.ts
 * moves one: each step its speed is set first, gaining no faster than its acceleration and never
 * past its top speed downhill, and then it runs that speed's distance. `push` picks the speed in
 * what the step allows, 0 braking hardest and 1 gaining fastest. Its cars cover the tiles from
 * the tail's to the head's, and pathAhead puts each tile's arc an eighth of a tile past the edge
 * the train enters it by, as on a plain straight. It has its way east or west along the row set
 * (`moving`) unless a test says otherwise.
 */
class Runner implements CrossingTrain {
  state: TrainState = 'moving';
  speed: number;
  pathProgress = 0;
  readonly acceleration: number;
  readonly maxSpeed: number;
  private readonly x0: number;
  constructor(readonly spec: RunnerSpec) {
    this.acceleration = spec.acceleration;
    this.maxSpeed = spec.maxSpeed;
    this.speed = Math.max(spec.floor, spec.share * spec.maxSpeed * DESCENT_SPEED);
    this.x0 = CX - spec.dir * (0.5 + spec.gap);
  }
  /** where its head is along the row */
  get head() {
    return this.x0 + this.spec.dir * this.pathProgress;
  }
  /** the columns its cars cover, westmost first */
  private span(): [number, number] {
    const tail = this.head - this.spec.dir * this.spec.length;
    return [
      Math.floor(Math.min(this.head, tail) + 0.5),
      Math.floor(Math.max(this.head, tail) + 0.5),
    ];
  }
  /** a car of it is on the crossing */
  get onCrossing() {
    const [lo, hi] = this.span();
    return lo <= CX && CX <= hi;
  }
  /** its last car has left the crossing behind */
  get past() {
    return this.spec.dir * (this.head - this.spec.dir * this.spec.length - CX) > 0.5;
  }
  occupancyKeys(w: number) {
    const [lo, hi] = this.span();
    return Array.from({ length: hi - lo + 1 }, (_, i) => CY * w + lo + i);
  }
  pathAhead() {
    const out: { x: number; y: number; arc: number }[] = [];
    const under = Math.floor(this.head + 0.5);
    for (let i = -1; i <= 60; i++) {
      const x = under + this.spec.dir * i;
      const arc = this.spec.dir * (x - this.x0) - 0.5 + 1 / 8;
      if (arc >= this.pathProgress - 0.5) out.push({ x, y: CY, arc });
    }
    return out;
  }
  move(gdt: number, push: number) {
    const top = Math.max(this.speed, this.maxSpeed * DESCENT_SPEED);
    const lo = Math.max(this.spec.floor, this.speed - BRAKE * gdt);
    const hi = Math.max(lo, Math.min(top, this.speed + this.acceleration * gdt));
    this.speed = lo + (hi - lo) * push;
    this.pathProgress += this.speed * gdt;
  }
}

/**
 * How a train is driven, from its own stream: flat out, braking, half way between or anything,
 * each held for a while. A third of them run flat out throughout, the run the horizon is for.
 */
function driver(seed: number) {
  const rng = new Rng(seed);
  const steady = rng.chance(1 / 3);
  let mode = steady ? 0 : rng.int(0, 3);
  return () => {
    if (!steady && rng.chance(1 / 40)) mode = rng.int(0, 3);
    return mode === 0 ? 1 : mode === 1 ? 0 : mode === 2 ? 0.5 : rng.next();
  };
}

/** A walk over the crossing and the trains along its line, as the horizon property draws them. */
interface RunCase {
  trains: RunnerSpec[];
  /** the walk: from `from[1]` tiles out in direction `from[0]`, over the crossing, to `to` */
  from: readonly [readonly [number, number], number];
  to: readonly [readonly [number, number], number];
  /** where in its first tile the walker stands at the start (a walk turned where it stood) */
  offset: readonly [number, number];
  /** a walker with a home, at the slowest pace there is; otherwise a boarding figure */
  regular: boolean;
  /**
   * Seconds before (-) or after (+) the crossing would first close (`closing`), or the first car
   * would come (`car`), that the walker would reach it with no crossing in its way.
   */
  lead: number;
  anchor: 'closing' | 'car';
  /** the trains' driving */
  profile: number;
}

/** Steps a run of the horizon property is given at most. */
const RUN_STEPS = 6000;
/** Where the regular walker of the horizon property lives, far from the crossing. */
const HOME = { x: 1, y: 1 };

/**
 * Walkers and trains moved in SimStep's order, a step at a time: the watch from the trains as they
 * stand, then the walker with what the watch holds closed, then the trains. Returns what happened,
 * or a line on the first step a walker stood on the crossing while a car was on it.
 */
function crossingRun(c: RunCase) {
  const { map, builder } = field();
  expect(builder.spawnDecor(HOME.x, HOME.y, 'townhouse', 0)).not.toBeNull();
  const [[fx, fy], fk] = c.from;
  const [[tx, ty], tk] = c.to;
  const path = [
    ...walkOf(CX + fx * fk, CY + fy * fk, CX, CY),
    ...walkOf(CX, CY, CX + tx * tk, CY + ty * tk).slice(1),
  ];
  const walker = (): Person => {
    const p = figure(
      path.map((q) => ({ ...q })),
      { x: path[0].x + c.offset[0], y: path[0].y + c.offset[1] },
    );
    return c.regular ? { ...p, transient: false, home: `d${HOME.x},${HOME.y}` } : p;
  };
  const population = (p: Person | undefined) => (p && !p.transient ? 1 : 0);
  const keys = new Set([CY * map.w + CX]);
  // when the crossing would first close and the first car would come, and when the walker would
  // reach the crossing with none
  const alone = c.trains.map((s) => new Runner(s));
  const drive = c.trains.map((_, i) => driver(c.profile + i));
  const ahead = new CrossingWatch(map.w);
  let closingAt = RUN_STEPS;
  let carAt = RUN_STEPS;
  for (let i = 0; i < RUN_STEPS && carAt === RUN_STEPS; i++) {
    ahead.update(alone, keys, SIM_STEP);
    if (closingAt === RUN_STEPS && ahead.closed(CX, CY)) closingAt = i;
    alone.forEach((t, k) => t.move(SIM_STEP, drive[k]()));
    if (alone.some((t) => t.onCrossing)) carAt = i;
  }
  const free = new PeopleSim(map, builder, new Rng(1));
  free.persons.push(walker());
  let reach = 0;
  while (reach < RUN_STEPS && !onTile(free.persons[0], CX, CY)) {
    free.tick(SIM_STEP, population(free.persons[0]), MIDDAY);
    reach++;
  }
  const at = c.anchor === 'closing' ? closingAt : carAt;
  const start = Math.max(0, at - reach + Math.round(c.lead / SIM_STEP));

  const trains = c.trains.map((s) => new Runner(s));
  const drives = c.trains.map((_, i) => driver(c.profile + i));
  const watch = new CrossingWatch(map.w);
  const people = new PeopleSim(map, builder, new Rng(1));
  const out = { waited: false, steppedOn: -1, firstCar: -1, done: false };
  let before: Person | null = null;
  for (let i = 0; i < RUN_STEPS; i++) {
    watch.update(trains, keys, SIM_STEP);
    if (i === start) people.persons.push(walker());
    const p = people.persons[0] as Person | undefined;
    people.tick(SIM_STEP, population(p), MIDDAY, watch.size ? watch.closed : null);
    trains.forEach((t, k) => t.move(SIM_STEP, drives[k]()));
    const car = trains.some((t) => t.onCrossing);
    if (car && out.firstCar < 0) out.firstCar = i;
    const walking = !!p && people.persons.includes(p) && p.state === 'walk';
    if (walking && onTile(p, CX, CY)) {
      if (car)
        return {
          ...out,
          hit: `step ${i}: walker at ${p.x}, ${p.y} on the crossing with a car; heads at ${trains
            .map((t) => t.head.toFixed(3))
            .join(', ')}`,
        };
      if (out.steppedOn < 0) out.steppedOn = i;
    }
    if (walking && before && p.x === before.x && p.y === before.y) out.waited = true;
    before = walking ? { ...p } : null;
    if (i > start && !walking && trains.every((t) => t.past)) {
      out.done = true;
      break;
    }
  }
  return { ...out, hit: null };
}

describe('the horizon, against any run a train can make', () => {
  // The trains here have their way set throughout: running, or stopped on it and setting off again
  // (floor 0), as a train held at a signal or behind another does. A train given its way while a
  // walker is already on the crossing is the gap below.
  // slow: up to 6000 steps of the watch, a walker and two trains for each of the 100 seeds
  it(
    'keeps every walker off the crossing while a car is on it, whatever the walk and the driving of a train with its way set',
    { timeout: 120_000 },
    () => {
      const seen = { waited: 0, ahead: 0, closest: Infinity, done: 0 };
      forAll(
        (rng): RunCase => ({
          trains: Array.from({ length: rng.chance(0.25) ? 2 : 1 }, () => {
            const spec: RunnerSpec = {
              dir: rng.pick([1, -1] as const),
              gap: 0,
              length: rng.pick([0.8, 1.6, 2.5, 4]),
              acceleration: rng.pick([0.02, 0.1, 0.3, 0.6, 1.2]),
              maxSpeed: rng.pick([0.3, 0.8, 1.4, 2.2, 3.5]),
              share: rng.chance(0.4) ? 0 : rng.next(),
              floor: rng.pick([0, 0, 0.05, 0.2, 0.5]),
            };
            // from well inside to well outside what the watch looks ahead for this train
            const far = crossingReach(new Runner(spec), CROSSING_HORIZON) + CROSSING_LEAD;
            return { ...spec, gap: rng.chance(0.2) ? rng.range(0, 2) : far * rng.range(0.9, 2.5) };
          }),
          from: [rng.pick(DIRS8), rng.int(1, 4)],
          to: [rng.pick(DIRS8), rng.int(1, 4)],
          offset: rng.chance(0.3) ? [rng.range(-0.45, 0.45), rng.range(-0.45, 0.45)] : [0, 0],
          regular: rng.chance(0.5),
          lead: rng.range(-9, 1),
          anchor: rng.pick(['closing', 'car'] as const),
          profile: rng.int(1, 2 ** 30),
        }),
        (c) => {
          const r = crossingRun(c);
          expect(r.hit).toBeNull();
          if (r.waited) seen.waited++;
          if (r.done) seen.done++;
          // it stepped on ahead of the first car: how long before that car came
          if (r.steppedOn >= 0 && r.firstCar > r.steppedOn) {
            seen.ahead++;
            seen.closest = Math.min(seen.closest, (r.firstCar - r.steppedOn) * SIM_STEP);
          }
        },
        {
          shrink: function* (c) {
            if (c.trains.length > 1) for (const t of c.trains) yield { ...c, trains: [t] };
            for (const lead of shrinkInt(Math.round(c.lead))) yield { ...c, lead };
            if (c.offset[0] || c.offset[1]) yield { ...c, offset: [0, 0] as const };
            if (!c.regular) yield { ...c, regular: true };
          },
        },
      );
      // not vacuous: walkers waited for trains, others crossed ahead of them, one of those within
      // a second of the closest the watch allows, and nearly every run played out to the end
      expect(seen.waited).toBeGreaterThanOrEqual(20);
      expect(seen.ahead).toBeGreaterThanOrEqual(10);
      expect(seen.closest).toBeLessThan(CROSSING_HORIZON + 1);
      expect(seen.done).toBeGreaterThanOrEqual(90);
    },
  );
});

// ------------------------------------------------------------------ the gap: a way set under a walker

/** The hardest pull of any consist, tiles/s²: `consistPhysics` clamps acceleration to it. */
const HARDEST_PULL = content.track.physics.maxAccel;

/**
 * A walk over the crossing by a walker with a home: north to south along a road (`road`), one
 * tile at the road pace, the way walkers mostly take over a crossing; or corner to corner off any
 * road (`corner`), √2 tiles at the slowest pace, the longest a walker is on a crossing
 * (CROSSING_WALK).
 */
type GapWalk = 'road' | 'corner';

/**
 * The walker on `walk` and a train on row CY with its head `gap` tiles short of the crossing's west
 * edge, moved in SimStep's order: the watch, the walker, the train. Unless `routed`, the train
 * stands with no way set (loading at a platform) until the step the walker first stands on the
 * crossing; in that step it is given its way east over it and sets off at once, as early as a way
 * can be given under a walker. If `routed`, it stands held on that way from the first step and
 * sets off in the step the walker first stands on the crossing or at its edge. Either way it sets
 * off at the hardest pull of any consist and keeps gaining, with no top speed to stop it. Whether
 * a car was ever on the crossing while the walker was, whether the walker waited, and how many
 * steps it ended on the crossing.
 */
function wayUnderWalker(walk: GapWalk, gap: number, routed: boolean) {
  const { map, builder } = field();
  expect(builder.spawnDecor(HOME.x, HOME.y, 'townhouse', 0)).not.toBeNull();
  const path =
    walk === 'road' ? walkOf(CX, CY - 3, CX, CY + 3) : walkOf(CX - 3, CY - 3, CX + 3, CY + 3);
  if (walk === 'road') for (const t of path) expect(builder.placeRoad(t.x, t.y)).toBe(true);
  const people = new PeopleSim(map, builder, new Rng(1));
  const p: Person = { ...figure(path), transient: false, home: `d${HOME.x},${HOME.y}` };
  people.persons.push(p);
  const train = new Runner({
    dir: 1,
    gap,
    length: 2.5,
    acceleration: HARDEST_PULL,
    maxSpeed: 1e6,
    share: 0,
    floor: 0,
  });
  if (!routed) train.state = 'loading';
  const watch = new CrossingWatch(map.w);
  const keys = new Set([CY * map.w + CX]);
  const out = { met: false, waited: false, onSteps: 0 };
  let going = false;
  for (let i = 0; i < 4000 && (p.state === 'walk' || !train.past); i++) {
    watch.update([train], keys, SIM_STEP);
    const was = { ...p };
    people.tick(SIM_STEP, 1, MIDDAY, watch.size ? watch.closed : null);
    if (was.state === 'walk' && p.x === was.x && p.y === was.y) out.waited = true;
    if (!going && p.state === 'walk' && cheb(p, CX, CY) < 0.5 + (routed ? 1e-6 : -1e-6)) {
      going = true;
      train.state = 'moving';
    }
    if (going) train.move(SIM_STEP, 1);
    if (p.state === 'walk' && onTile(p, CX, CY)) {
      out.onSteps++;
      if (train.onCrossing) out.met = true;
    }
  }
  expect(p.state, 'the walk is over').not.toBe('walk');
  expect(train.past, 'the train is past the crossing').toBe(true);
  return out;
}

/**
 * The furthest a train given its way under a walker on `walk` can stand from the crossing's edge
 * and still meet it, in tiles, to within 1e-4, found by halving.
 */
function gapWidth(walk: GapWalk) {
  let lo = 1e-3;
  let hi = 40;
  expect(wayUnderWalker(walk, lo, false).met).toBe(true);
  expect(wayUnderWalker(walk, hi, false).met).toBe(false);
  while (hi - lo > 1e-4) {
    const mid = (lo + hi) / 2;
    if (wayUnderWalker(walk, mid, false).met) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('the gap: a train given its way while a walker is already on the crossing', () => {
  // A train loading at a platform, waiting for one or idle closes only the tiles under its cars, so
  // a walker may set foot on a crossing in front of it; given its way out in that step, the train
  // can reach the crossing before the walker is off it. This pins how far off that can be.
  // slow: some 360 runs of a walker and a train over the crossing, up to 4000 steps each
  it(
    'meets the walker within 2.87 tiles on the road and 22.84 corner to corner, never when its way was set first',
    { timeout: 60_000 },
    () => {
      // each walk, the seconds it is on the crossing tile, and how wide the gap is in tiles
      for (const [walk, onFor, width] of [
        ['road', 1 / walkSpeed({ transient: false }, true), 2.87],
        ['corner', CROSSING_WALK, 22.84],
      ] as const) {
        const gap = gapWidth(walk);
        // exactly what a train set off at the hardest pull runs over the steps the walker ends on the
        // crossing, the step it sets foot on among them: its time on the tile, and a step more
        const k = wayUnderWalker(walk, 40, false).onSteps;
        expect(k, walk).toBeLessThanOrEqual(Math.ceil(onFor / SIM_STEP) + 1);
        expect(gap, walk).toBeCloseTo((HARDEST_PULL * SIM_STEP ** 2 * k * (k + 1)) / 2, 3);
        // pinned: a change that widens it, or narrows it, fails here
        expect(gap, walk).toBeCloseTo(width, 2);
        // the same train standing with its way set before the walker comes, from any gap: the
        // walker waits for it or is over before it can come, and walkers waited
        let waits = 0;
        for (let at = 0.05; at < 40; at += 0.25) {
          const r = wayUnderWalker(walk, at, true);
          expect(r.met, `${walk} walk, ${at} tiles`).toBe(false);
          if (r.waited) waits++;
        }
        expect(waits, walk).toBeGreaterThanOrEqual(40);
      }
    },
  );
});

// ------------------------------------------------------------------ in the game's step

/** The map of the step tests: a line along ROW with a level crossing on column CROSS_X. */
const SIDE = 64;
const ROW = 20;
const CROSS_X = 34;
const CROSS_KEY = ROW * SIDE + CROSS_X;
/** Houses north of the line, by the road that runs south over the crossing to the station. */
const HOUSES: readonly (readonly [number, number])[] = [
  [33, 9],
  [35, 9],
  [33, 12],
  [35, 12],
  [33, 15],
  [35, 15],
];

/**
 * A grass world with a line along ROW from a depot at its west end, a quarry and a warehouse near
 * its ends, a passenger station south of it and houses north of it, joined by a road over the line
 * on CROSS_X: the one level crossing. With `loco`, a train of it and a hopper shuttles between the
 * quarry and the warehouse, stopping at each without loading, over the crossing each way. The
 * clock stands just after the walkers wake.
 */
function crossingWorld(loco: string | null, seed: number): { w: SimWorld; train: Train | null } {
  const w = simWorld({ terrain: 'grass', size: SIDE, seed });
  for (const [k, n] of Object.entries(startStock())) w.stock.add(k, n);
  station(w, 'depot', 4, ROW);
  line(w, 6, ROW, 60);
  const quarry = station(w, 'quarry', 10, ROW - 1);
  const warehouse = station(w, 'warehouse', 56, ROW - 1);
  station(w, 'station', CROSS_X + 1, ROW + 1);
  w.builder.free = true;
  for (let y = 8; y <= ROW + 1; y++)
    expect(w.builder.placeRoad(CROSS_X, y), `road at ${CROSS_X},${y}`).toBe(true);
  for (const [x, y] of HOUSES) {
    expect(w.builder.placeDecor(x, y, 'townhouse', 0), `house at ${x},${y}`).not.toBeNull();
    Object.assign(w.houses.at(x, y)!, { progress: 1, residents: 6 });
  }
  w.builder.free = false;
  expect([...w.builder.roads.crossingKeys()]).toEqual([CROSS_KEY]);
  w.clock.time = daySeconds() * (WAKE + 0.01);
  if (!loco) return { w, train: null };
  const l = w.inventory.add(loco, 0);
  const hopper = w.inventory.add('wood_hopper', 0);
  const stop = (id: number): StopPlan => ({
    ...defaultStop(id),
    load: 'none',
    unload: 'none',
    waitFull: false,
    maxDwell: 3,
  });
  const train = w.fleet.create([l.uid], [hopper.uid], [stop(quarry.id), stop(warehouse.id)]);
  if (typeof train === 'string') throw new Error(`fleet.create: ${train}`);
  return { w, train };
}

/** Every walker as it was before a step (a shallow copy: its path is the same list). */
const was = (people: PeopleSim) =>
  new Map<number, Person>(people.persons.map((p) => [p.id, { ...p }]));
/** Went through the step without moving along the same walk: it waited. */
const waited = (p: Person, b: Person | undefined) =>
  !!b &&
  WALKING.includes(p.state) &&
  p.state === b.state &&
  p.path === b.path &&
  p.step === b.step &&
  p.x === b.x &&
  p.y === b.y;

/** Play mode with the weather off and Game's storage cap. */
const playContext = (w: SimWorld): StepContext => ({
  mode: 'play',
  weather: false,
  stockCap: (id) => w.stock.cap(id, w.builder.depotCount(), w.builder.plantCount()),
});

/** Ten game minutes of steps in play mode, the weather off, and what came of them. */
function tenMinutes(w: SimWorld, train: Train | null) {
  const step = new SimStep(w);
  const ctx = playContext(w);
  const steps = Math.round(600 / SIM_STEP);
  // how far ahead a run of the train is checked against what the watch allowed it
  const ahead = Math.floor(CROSSING_HORIZON / SIM_STEP);
  const runs: { distance: number; allowed: number | null }[] = [];
  const out = { passages: 0, halts: 0, resumes: 0, crossed: 0, closedSteps: 0 };
  let car = false;
  let leftAt = -Infinity;
  let closedBefore = false;
  let carThisClosing = false;
  let waiting = new Set<number>();
  const onIt = new Set<number>();
  let before = was(w.people);
  for (let i = 0; i < steps; i++) {
    w.clock.run((gdt) => step.run(gdt, ctx));
    for (const t of w.fleet.trains) {
      t.coal = t.coalCap;
      t.water = t.waterCap;
      t.oil = t.oilCap;
    }
    const time = w.clock.time;
    // closed as the walkers found it this step, from the trains as they stood before it
    const closed = step.crossings!.closed(CROSS_X, ROW);
    const carNow = w.fleet.trains.some((t) => t.occupancyKeys(SIDE).includes(CROSS_KEY));
    if (carNow && !car) out.passages++;
    if (car && !carNow) leftAt = time;
    car = carNow;
    if (closed) {
      out.closedSteps++;
      carThisClosing ||= car;
    } else if (closedBefore) {
      // it closed for a train that came over it, and opened CROSSING_HOLD and a step after the
      // step in which the last car left it
      expect(carThisClosing, `closed with no train over it, at ${time}`).toBe(true);
      expect(time - leftAt).toBeCloseTo(CROSSING_HOLD + SIM_STEP, 6);
      carThisClosing = false;
    }
    closedBefore = closed;
    const nowWaiting = new Set<number>();
    for (const p of w.people.persons) {
      const on = onTile(p, CROSS_X, ROW);
      if (on && car) expect.fail(`walker ${p.id} on the crossing with a car, at ${time}`);
      if (on) onIt.add(p.id);
      else if (onIt.delete(p.id)) out.crossed++;
      const b = before.get(p.id);
      if (waited(p, b)) {
        // it waits only at the edge of the crossing while that is closed, as it was
        expect(closed, `walker ${p.id} waited at an open crossing, at ${time}`).toBe(true);
        expect(Math.abs(cheb(p, CROSS_X, ROW) - 0.5)).toBeLessThanOrEqual(1e-6);
        expect(p).toEqual(b);
        if (!waiting.has(p.id)) out.halts++;
        nowWaiting.add(p.id);
      } else if (waiting.has(p.id) && b && p.path === b.path && p.state === b.state) {
        // it goes on along the same walk: the step the crossing opened, CROSSING_HOLD and one
        // step after the last car left it
        expect(closed).toBe(false);
        expect(time - leftAt).toBeCloseTo(CROSSING_HOLD + SIM_STEP, 6);
        out.resumes++;
      }
    }
    waiting = nowWaiting;
    before = was(w.people);
    if (train)
      runs.push({
        distance: train.distance,
        allowed: ROUTED_STATES.has(train.state) ? crossingReach(train, CROSSING_HORIZON) : null,
      });
  }
  // a train with its way set, running or standing on it, never ran further in the horizon than
  // the watch counted on, short of the eighth of a tile between the arc it reads and the
  // crossing's edge
  for (let i = 0; i + ahead < runs.length; i++) {
    const allowed = runs[i].allowed;
    if (allowed === null) continue;
    const ran = runs[i + ahead].distance - runs[i].distance;
    if (ran > allowed + CROSSING_LEAD - 1 / 8)
      expect.fail(`from step ${i} the train ran ${ran} tiles, the watch counted on ${allowed}`);
  }
  return out;
}

describe('walkers and a train over a level crossing, ten game minutes in the step', () => {
  // slow: 12 000 steps of a whole world with a train and some forty walkers
  it.each([
    ['adler', 4242],
    ['f7', 7],
  ] as const)(
    '%s, seed %i: no walker is on the crossing with a car, and each waits only while it is closed',
    (loco, seed) => {
      const { w, train } = crossingWorld(loco, seed);
      const out = tenMinutes(w, train);
      // not vacuous: the train came over it again and again, many walkers crossed, and some of
      // them waited for it and went on
      expect(out.passages).toBeGreaterThanOrEqual(8);
      expect(out.crossed).toBeGreaterThanOrEqual(50);
      expect(out.halts).toBeGreaterThanOrEqual(5);
      expect(out.resumes).toBeGreaterThanOrEqual(5);
    },
    120_000,
  );

  // slow for the same reason
  it(
    'with no train, never closes, and every walker crosses with no delay',
    { timeout: 120_000 },
    () => {
      const { w, train } = crossingWorld(null, 4242);
      const out = tenMinutes(w, train);
      expect(out.closedSteps).toBe(0);
      expect(out.halts).toBe(0);
      expect(out.crossed).toBeGreaterThanOrEqual(10);
    },
  );
});

// ------------------------------------------------------------------ real trains, every way they stand

/**
 * A train of the fleet runs: its units (the first leads), its wagons, the units set to standby, how
 * it picks its stops (the quarry and warehouse shuttle of crossingWorld unless it roams), and, if
 * given, the game second of the run, under DRY_EVERY, its dry spells start from: it runs with empty
 * tanks for DRY_FOR of every DRY_EVERY game seconds from then. A train given `water` as well carries
 * water in its tank wagons, filled in its dry spells, in which its boiler stands just under half
 * rather than empty; outside them its boiler is left to it, so it sets off from each spell topping
 * the boiler up from its tank wagons (`Train.drawTankerWater`), the lighter for it.
 */
interface Consist {
  locos: readonly string[];
  wagons: readonly string[];
  standby?: readonly number[];
  mode?: RouteMode;
  dry?: number;
  water?: boolean;
}
/** Game seconds of every DRY_EVERY that a train given `dry` runs with empty tanks. */
const DRY_FOR = 15;
const DRY_EVERY = 120;

/** A train as the watch read it before a step: what it was doing and how far it had run. */
interface Seen {
  state: TrainState;
  speed: number;
  distance: number;
  /** tonnes */
  mass: number;
  /** crossingReach over the horizon for a train with its way set; null for any other */
  reach: number | null;
  /** crossingPull for a train with its way set; null for any other */
  pull: number | null;
}

/**
 * crossingWorld with no train of its own and `consists` rolled out of its depot in order, each as
 * soon as the gate is clear, then ten game minutes of steps in play mode. Before each step every
 * train is read as the watch reads it; after it, a train given `dry` has its tanks emptied in its
 * dry spell and filled outside it (its boiler as `water` says), and every other train has them
 * filled. Fails on the first step
 * a crossing is open that a car stood on or a train with its way set could reach as the step
 * began, on the first a walker stands on a level crossing a car is on, and on the first a walker
 * has stood on one for longer than its slowest walk over one (CROSSING_WALK), give or take the step
 * that first found it there. Returns what each train was seen as before every step from its first,
 * how many walkers crossed, and in how many steps a crossing was due to close for a train standing
 * with its way set alone.
 */
function fleetRun(seed: number, consists: readonly Consist[]) {
  const { w } = crossingWorld(null, seed);
  const stationOf = (id: string) => w.builder.stations.find((s) => s.def.id === id)!.id;
  const stop = (id: number): StopPlan => ({
    ...defaultStop(id),
    load: 'none',
    unload: 'none',
    waitFull: false,
    maxDwell: 3,
  });
  const stops = [stop(stationOf('quarry')), stop(stationOf('warehouse'))];
  const units = consists.map((c) => ({
    locos: c.locos.map((id) => w.inventory.add(id, 0).uid),
    wagons: c.wagons.map((id) => w.inventory.add(id, 0).uid),
  }));
  const step = new SimStep(w);
  const ctx = playContext(w);
  const crossings = [...w.builder.roads.crossingKeys()];
  const trains: Train[] = [];
  const seen: Seen[][] = [];
  // each walker on a crossing, by id, and the game time it was first found on it
  const onIt = new Map<number, number>();
  let crossed = 0;
  // steps a crossing no car was on was due to close for a train standing with its way set alone
  let heldDue = 0;
  for (let i = 0; i < Math.round(600 / SIM_STEP); i++) {
    const next = consists[trains.length];
    if (next) {
      const u = units[trains.length];
      const t = w.fleet.create(u.locos, u.wagons, stops, undefined, next.mode ?? 'schedule');
      if (typeof t !== 'string') {
        for (const k of next.standby ?? []) t.setStandby(k, true);
        trains.push(t);
        seen.push([]);
      }
    }
    trains.forEach((t, k) =>
      seen[k].push({
        state: t.state,
        speed: t.speed,
        distance: t.distance,
        mass: t.mass,
        reach: ROUTED_STATES.has(t.state) ? crossingReach(t, CROSSING_HORIZON) : null,
        pull: ROUTED_STATES.has(t.state) ? crossingPull(t) : null,
      }),
    );
    // the crossings due to close in the step, from the trains as they stand before it: those a car
    // is on, and those along the way of a train with its way set within its reach
    const under = new Set(trains.flatMap((t) => t.occupancyKeys(SIDE)));
    const due = new Map<number, 'car' | 'running' | 'standing'>();
    for (const k of crossings) if (under.has(k)) due.set(k, 'car');
    for (const t of trains) {
      if (!ROUTED_STATES.has(t.state)) continue;
      const far = crossingReach(t, CROSSING_HORIZON) + CROSSING_LEAD;
      for (const s of t.pathAhead()) {
        if (s.arc - t.pathProgress > far) break;
        const k = s.y * SIDE + s.x;
        if (!crossings.includes(k) || due.get(k) === 'car' || due.get(k) === 'running') continue;
        due.set(k, t.speed > 0 ? 'running' : 'standing');
      }
    }
    w.clock.run((gdt) => step.run(gdt, ctx));
    const time = w.clock.time;
    for (const [k, why] of due) {
      const [x, y] = [k % SIDE, Math.floor(k / SIDE)];
      expect(step.crossings!.closed(x, y), `crossing ${x},${y} (${why}) at ${time}`).toBe(true);
      if (why === 'standing') heldDue++;
    }
    trains.forEach((t, k) => {
      const { dry, water } = consists[k];
      const empty = dry !== undefined && (i * SIM_STEP + DRY_EVERY - dry) % DRY_EVERY < DRY_FOR;
      t.coal = empty ? 0 : t.coalCap;
      t.oil = empty ? 0 : t.oilCap;
      if (!water) t.water = empty ? 0 : t.waterCap;
      else if (empty) {
        t.water = t.waterCap * 0.49;
        for (const wg of t.wagons) {
          wg.cargo = 'water';
          wg.amount = wg.def.capacity;
        }
      }
    });
    const cars = new Set(trains.flatMap((t) => t.occupancyKeys(SIDE)));
    for (const p of w.people.persons) {
      let on = false;
      for (const k of crossings) {
        const [x, y] = [k % SIDE, Math.floor(k / SIDE)];
        if (!onTile(p, x, y)) continue;
        on = true;
        if (cars.has(k))
          expect.fail(`walker ${p.id} on the crossing ${x},${y} with a car, at ${time}`);
      }
      if (!on) {
        if (onIt.delete(p.id)) crossed++;
        continue;
      }
      const since = onIt.get(p.id) ?? time;
      onIt.set(p.id, since);
      if (time - since > CROSSING_WALK + SIM_STEP + 1e-9)
        expect.fail(`walker ${p.id} (${p.state}) on a crossing from ${since} to ${time}`);
    }
  }
  return { trains, seen, crossed, heldDue };
}

/**
 * The furthest the train of the gap test runs in `k` steps from a standstill, given its way in the
 * first of them: the hardest pull of any consist, no top speed, gaining speed before it moves in
 * each step as trains.ts does.
 */
const gapRun = (k: number) => (HARDEST_PULL * SIM_STEP ** 2 * k * (k + 1)) / 2;

describe('real trains in the step, through every way they stand', () => {
  // The bounds the watch and the gap rest on, checked on the trains of trains.ts rather than plain
  // ones: held behind each other, roaming with nothing to haul, out of fuel, an electric engine off
  // the wire with a diesel on standby that steps in, a steam engine lightened by the water its
  // boiler draws from its tank wagons, loading, pulling aside.
  // slow: 12 000 steps of a whole world with up to three trains and some forty walkers
  it.each([
    [
      'two shuttles meeting on one line, the second running dry, and a roaming train',
      4242,
      [
        { locos: ['adler'], wagons: ['wood_hopper'] },
        { locos: ['f7'], wagons: ['wood_hopper'], dry: 60 },
        { locos: ['sw1'], wagons: ['wood_hopper'], mode: 'freight' },
      ],
      ['idle', 'loading', 'moving', 'noFuel', 'yielding'],
      0,
    ],
    [
      'an electric engine off the wire with a diesel of twice its pull on standby, running dry',
      7,
      [{ locos: ['kando_v40', 'dda40x'], wagons: ['wood_hopper'], standby: [1], dry: 0 }],
      ['loading', 'moving', 'noPower'],
      0,
    ],
    [
      'a steam engine out of coal with its boiler under half, topping it up from three tank wagons of water as it sets off',
      4242,
      [
        {
          locos: ['mav375'],
          wagons: ['riveted_tank', 'riveted_tank', 'riveted_tank'],
          dry: 30,
          water: true,
        },
      ],
      ['loading', 'moving', 'noFuel'],
      100,
    ],
  ] as const)(
    '%s: one with its way set runs no further and gains speed no faster than the watch counts on, one with none runs no further than the gap train',
    (_, seed, consists, states, lightened) => {
      const { trains, seen, crossed, heldDue } = fleetRun(seed, consists);
      expect(trains).toHaveLength(consists.length);
      const ahead = Math.floor(CROSSING_HORIZON / SIM_STEP);
      const out = {
        states: new Set<TrainState>(),
        heldOff: 0,
        stalledOff: 0,
        departed: 0,
        lightened: 0,
      };
      seen.forEach((runs, k) => {
        for (let i = 0; i < runs.length; i++) {
          const s = runs[i];
          out.states.add(s.state);
          const far = Math.min(i + ahead, runs.length - 1);
          const ran = runs[far].distance - s.distance;
          if (s.reach !== null) {
            // within the eighth of a tile between the arc the watch reads and the crossing's edge
            if (far === i + ahead && ran > s.reach + CROSSING_LEAD - 1 / 8)
              expect.fail(
                `train ${k + 1} (${s.state}) ran ${ran} tiles from step ${i}, the watch counted on ${s.reach}`,
              );
            // and never gained speed faster than the pull it counted on, top speed or not
            for (let j = i; j < far; j++) {
              const gain = runs[j + 1].speed - runs[j].speed;
              if (gain > s.pull! * SIM_STEP + 1e-9)
                expect.fail(
                  `train ${k + 1} (${s.state} at step ${i}) gained ${gain / SIM_STEP} tiles/s² in step ${j}, the watch counted on ${s.pull}`,
                );
            }
            // standing with its way set, it set off within the horizon
            if (s.speed === 0 && ran > 0) {
              out.heldOff++;
              if (s.state !== 'moving') out.stalledOff++;
            }
            // it got lighter within the horizon
            if (runs[far].mass < s.mass - 1e-9) out.lightened++;
            continue;
          }
          for (let j = 1; j <= far - i; j++) {
            const run = runs[i + j].distance - s.distance;
            if (run > gapRun(j) + 1e-9)
              expect.fail(
                `train ${k + 1} (${s.state}) ran ${run} tiles in ${j} steps from step ${i}, the gap train ${gapRun(j)}`,
              );
          }
          if (ran > 0) out.departed++;
        }
      });
      // not vacuous: the trains went through every state named, trains stood with their way set,
      // out of fuel or power among them, and set off within the horizon; trains with no way set
      // set off within it too; walkers crossed; the crossing closed for a train standing with its
      // way set alone; and a train with its way set got lighter within the horizon as often as named
      expect([...out.states].sort()).toEqual(expect.arrayContaining([...states]));
      expect(out.lightened).toBeGreaterThanOrEqual(lightened);
      expect(out.heldOff).toBeGreaterThanOrEqual(100);
      expect(out.stalledOff).toBeGreaterThanOrEqual(50);
      expect(out.departed).toBeGreaterThanOrEqual(50);
      expect(crossed).toBeGreaterThanOrEqual(20);
      expect(heldDue).toBeGreaterThanOrEqual(100);
    },
    180_000,
  );
});

describe('the crossings the step watches', () => {
  it('are read again when a road is laid or taken up, or the track under one', () => {
    const { w, train } = crossingWorld('adler', 4242);
    const step = new SimStep(w);
    const ctx = playContext(w);
    const once = () => w.clock.run((gdt) => step.run(gdt, ctx));
    // the train under way east from the quarry, a few tiles short of a tile with no road yet
    for (let i = 0; i < 4000 && !(train!.speed > 0.5 && train!.headTile!.x === 22); i++) once();
    expect(train!.headTile!.x).toBe(22);
    const [x, y] = [28, ROW];
    w.builder.free = true;
    expect(w.builder.placeRoad(x, y)).toBe(true);
    once();
    expect(step.crossings!.closed(x, y), 'a road laid across the line ahead').toBe(true);
    expect(w.builder.removeRoad(x, y)).toBe(true);
    once();
    expect(step.crossings!.closed(x, y), 'the road taken up').toBe(false);
    expect(w.builder.placeRoad(x, y)).toBe(true);
    once();
    expect(step.crossings!.closed(x, y)).toBe(true);
    const roads = w.builder.roads.version;
    expect(w.builder.removeTrack(x, y)).toBe(true);
    expect(w.builder.roads.version).toBe(roads);
    once();
    expect(step.crossings!.closed(x, y), 'the track under the road taken up').toBe(false);
  });

  it('close on the first step of a step made anew, as after a load, before its walkers move', () => {
    // Nothing of the watch is saved, and a load starts a new SimStep: its first step reads the
    // trains before the walkers of that step move, so none of them finds the crossing open with a
    // car on it or the train coming.
    const cases: readonly (readonly [string, (t: Train) => boolean])[] = [
      ['a car on it', (t) => t.occupancyKeys(SIDE).includes(CROSS_KEY)],
      // running east towards it, with no car on it yet
      ['the train coming', (t) => t.speed > 0.5 && t.headTile?.x === CROSS_X - 4],
    ];
    for (const [why, there] of cases) {
      const { w, train } = crossingWorld('adler', 4242);
      const ctx = playContext(w);
      const before = new SimStep(w);
      for (let i = 0; i < 4000 && !there(train!); i++) w.clock.run((gdt) => before.run(gdt, ctx));
      expect(there(train!), why).toBe(true);
      expect(train!.occupancyKeys(SIDE).includes(CROSS_KEY), why).toBe(why === 'a car on it');
      const step = new SimStep(w);
      expect(step.crossings, why).toBeNull();
      const tick = vi.spyOn(w.people, 'tick');
      w.clock.run((gdt) => step.run(gdt, ctx));
      expect(tick).toHaveBeenCalledTimes(1);
      expect(tick.mock.calls[0][3]?.(CROSS_X, ROW) ?? false, why).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ a train standing at the platform by the crossing

/** Game seconds the train of platformWorld stands at the passenger platform each time it calls. */
const DWELL = 60;
/** The passenger platform of crossingWorld: the tile right east of the crossing. */
const PLATFORM_KEY = CROSS_KEY + 1;

/**
 * crossingWorld with a train of `loco` and a hopper calling at the warehouse, the passenger station
 * and the quarry in turn, loading nothing. Back west from the warehouse it stands DWELL game seconds
 * at the platform right east of the crossing, with no way set; it is then given its way on west
 * over the crossing to the quarry, and runs back east over it and past the platform.
 */
function platformWorld(loco: string, seed: number) {
  const { w } = crossingWorld(null, seed);
  const id = (def: string) => w.builder.stations.find((s) => s.def.id === def)!.id;
  expect(w.builder.platformTiles(w.builder.stationById(id('station'))!)).toEqual([
    { x: CROSS_X + 1, y: ROW },
  ]);
  const stop = (stationId: number, dwell: number): StopPlan => ({
    ...defaultStop(stationId),
    load: 'none',
    unload: 'none',
    waitFull: false,
    minDwell: dwell,
    maxDwell: dwell + 3,
  });
  const l = w.inventory.add(loco, 0);
  const hopper = w.inventory.add('wood_hopper', 0);
  const train = w.fleet.create(
    [l.uid],
    [hopper.uid],
    [stop(id('warehouse'), 0), stop(id('station'), DWELL), stop(id('quarry'), 0)],
  );
  if (typeof train === 'string') throw new Error(`fleet.create: ${train}`);
  return { w, train };
}

describe('a train standing at the platform by a level crossing, ten game minutes in the step', () => {
  // Core's rule for #404 on the trains of trains.ts: a train with no way set closes only the tiles
  // under its cars, so walkers go on crossing in front of one standing at a platform. Given its way
  // over the crossing, it closes it from the next step; a walker already on the crossing then is the
  // gap, and the only walker a car may meet there.
  // slow: 12 000 steps of a whole world with a train and some forty walkers
  it.each([
    ['adler', 4242],
    ['f7', 7],
    ['mav375', 99],
  ] as const)(
    '%s, seed %i: closes exactly as the rule says, walkers cross in front of the standing train, and a car meets only a walker on the crossing before the train had its way over it',
    (loco, seed) => {
      const { w, train } = platformWorld(loco, seed);
      const step = new SimStep(w);
      const ctx = playContext(w);
      // the crossing as the walkers of the step found it
      const tick = w.people.tick.bind(w.people);
      let found: boolean | null = null;
      vi.spyOn(w.people, 'tick').mockImplementation((gdt, population, day, closed) => {
        found = closed?.(CROSS_X, ROW) ?? false;
        tick(gdt, population, day, closed);
      });
      const hold = Math.round(CROSSING_HOLD / SIM_STEP);
      // the last step that, as the step read the train before it, had a car on the crossing or the
      // train with its way set over it, within its reach
      let busy = -Infinity;
      // each walker on the crossing, and whether the train had its way over it as it set foot there
      const onIt = new Map<number, boolean>();
      const out = { inFront: 0, setOff: 0, underIt: 0 };
      let overBefore = false;
      for (let i = 0; i < Math.round(600 / SIM_STEP); i++) {
        // the oracle reads the train through this file's own table of states, not ROUTED_STATES
        const over = ROUTED[train.state]
          ? train.pathAhead().find((s) => s.x === CROSS_X && s.y === ROW)
          : undefined;
        const cars = train.occupancyKeys(SIDE);
        if (cars.includes(CROSS_KEY)) busy = i;
        const reach = crossingReach(train, CROSSING_HORIZON) + CROSSING_LEAD;
        if (over && over.arc - train.pathProgress <= reach) busy = i;
        const standing = train.state === 'loading' && cars.includes(PLATFORM_KEY);
        // given its way over the crossing in the last step, where it stood at the platform: the
        // walkers on the crossing then had set foot on it before
        if (over && !overBefore && train.speed === 0 && cars.includes(PLATFORM_KEY)) {
          out.setOff++;
          out.underIt += onIt.size;
        }
        overBefore = !!over;
        found = null;
        w.clock.run((gdt) => step.run(gdt, ctx));
        for (const t of w.fleet.trains) {
          t.coal = t.coalCap;
          t.water = t.waterCap;
          t.oil = t.oilCap;
        }
        // closed exactly from a busy step to CROSSING_HOLD after it, and so never for the train
        // standing at the platform with no way set
        expect(found, `seed ${seed}, step ${i}, ${train.state}`).toBe(i - busy <= hold);
        const car = train.occupancyKeys(SIDE).includes(CROSS_KEY);
        for (const p of w.people.persons) {
          if (!onTile(p, CROSS_X, ROW)) {
            onIt.delete(p.id);
            continue;
          }
          if (!onIt.has(p.id)) {
            onIt.set(p.id, !!over);
            if (standing) out.inFront++;
          }
          // a car on it: only a walker that set foot on it before the train had its way over it
          if (car)
            expect(
              onIt.get(p.id),
              `seed ${seed}: walker ${p.id} on the crossing with a car, step ${i}`,
            ).toBe(false);
        }
      }
      // not vacuous: walkers crossed in front of the train standing at the platform, it set off
      // over the crossing from there again and again, and walkers were on the crossing as it did
      // (24 to 58 walkers in front, 3 or 4 departures and 3 to 24 walkers on it as it set off, with
      // 3 to 23 of them met by a car, over these three runs)
      expect(out.inFront).toBeGreaterThanOrEqual(15);
      expect(out.setOff).toBeGreaterThanOrEqual(3);
      expect(out.underIt).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );
});

// ------------------------------------------------------------------ walkers set down by a crossing

/** A second level crossing of the line, with a house right north of it: its door faces it. */
const DOOR_X = 46;
const DOOR_KEY = ROW * SIDE + DOOR_X;
const DOOR_HOME = `d${DOOR_X},${ROW - 1}`;

/**
 * crossingWorld with a road over the line on DOOR_X (ROW and ROW + 1), which makes a second level
 * crossing, and a townhouse of six residents on the tile north of it, so the walkers idling by its
 * door stand towards the crossing.
 */
function doorWorld(loco: string | null, seed: number) {
  const { w, train } = crossingWorld(loco, seed);
  w.builder.free = true;
  for (const y of [ROW, ROW + 1]) expect(w.builder.placeRoad(DOOR_X, y)).toBe(true);
  expect(w.builder.placeDecor(DOOR_X, ROW - 1, 'townhouse', 0)).not.toBeNull();
  Object.assign(w.houses.at(DOOR_X, ROW - 1)!, { progress: 1, residents: 6 });
  w.builder.free = false;
  expect([...w.builder.roads.crossingKeys()].sort((a, b) => a - b)).toEqual([CROSS_KEY, DOOR_KEY]);
  return { w, train };
}

describe('a walker set down by a level crossing', () => {
  // slow: 12 000 steps of a whole world with a train and some forty walkers
  it.each([4242, 7])(
    'seed %i: no walker stands on a crossing while a car is on it, those of the house by the line idling at its door',
    (seed) => {
      const { w } = doorWorld('adler', seed);
      const step = new SimStep(w);
      const ctx = playContext(w);
      const crossings = [...w.builder.roads.crossingKeys()];
      let byDoor = 0;
      for (let i = 0; i < Math.round(600 / SIM_STEP); i++) {
        w.clock.run((gdt) => step.run(gdt, ctx));
        for (const t of w.fleet.trains) {
          t.coal = t.coalCap;
          t.water = t.waterCap;
          t.oil = t.oilCap;
        }
        const cars = new Set(w.fleet.trains.flatMap((t) => t.occupancyKeys(SIDE)));
        for (const p of w.people.persons) {
          for (const k of crossings) {
            const [x, y] = [k % SIDE, Math.floor(k / SIDE)];
            if (cars.has(k) && onTile(p, x, y))
              expect.fail(
                `walker ${p.id} (${p.state}) at ${p.x}, ${p.y} on the crossing ${x},${y} with a car, at ${w.clock.time}`,
              );
          }
          if (p.state === 'idle' && p.home === DOOR_HOME && cars.has(DOOR_KEY)) {
            // by the door, in front of the house
            expect(onTile(p, DOOR_X, ROW - 1), `walker ${p.id} at ${p.x}, ${p.y}`).toBe(true);
            expect(p.y).toBeGreaterThanOrEqual(ROW - 1 + 0.3);
            byDoor++;
          }
        }
      }
      // not vacuous: walkers of the house idled at its door while a car was on the crossing
      expect(byDoor).toBeGreaterThanOrEqual(20);
    },
    120_000,
  );

  it('stands at the edge of the crossing it was set down on, where its way off leaves it', () => {
    forAll(
      (rng) => {
        const crossings: [number, number][] = [[5, 5]];
        // two crossings side by side, as on a double line
        if (rng.chance(0.4))
          crossings.push(
            rng.pick([
              [6, 5],
              [4, 5],
              [5, 6],
              [5, 4],
            ] as [number, number][]),
          );
        // on a lattice of sixteenths, so edges and corners come up
        const at = { x: rng.int(48, 112) / 16, y: rng.int(48, 112) / 16 };
        const toward = rng.chance(0.5)
          ? { x: rng.int(2, 8), y: rng.int(2, 8) }
          : { x: rng.range(2, 8), y: rng.range(2, 8) };
        return { crossings, at, toward };
      },
      (c) => {
        const isCrossing = (x: number, y: number) =>
          c.crossings.some(([a, b]) => a === x && b === y);
        const off = offCrossing(c.at, c.toward, isCrossing);
        const on = c.crossings.find(([x, y]) => onTile(c.at, x, y));
        if (!on || onTile(c.toward, on[0], on[1])) {
          expect(off).toBeNull();
          return;
        }
        expect(off).not.toBeNull();
        // on no crossing, on the edge of the one it was on
        for (const [x, y] of c.crossings) expect(onTile(off!, x, y)).toBe(false);
        expect(Math.abs(cheb(off!, on[0], on[1]) - 0.5)).toBeLessThan(1e-9);
        // straight on from where it was set down towards `toward`, no further than that, and
        // every point of the way before it is on the crossing: it is where the way leaves
        const len = Math.hypot(c.toward.x - c.at.x, c.toward.y - c.at.y);
        const ux = (c.toward.x - c.at.x) / len;
        const uy = (c.toward.y - c.at.y) / len;
        const went = (off!.x - c.at.x) * ux + (off!.y - c.at.y) * uy;
        expect(went).toBeGreaterThan(0);
        expect(went).toBeLessThanOrEqual(len + 1e-9);
        expect(Math.hypot(c.at.x + ux * went - off!.x, c.at.y + uy * went - off!.y)).toBeLessThan(
          1e-9,
        );
        for (let i = 0; i < 64; i++) {
          const s = (went * i) / 64;
          expect(cheb({ x: c.at.x + ux * s, y: c.at.y + uy * s }, on[0], on[1])).toBeLessThan(
            0.5 + 1e-9,
          );
        }
      },
      {
        shrink: function* (c) {
          if (c.crossings.length > 1) yield { ...c, crossings: [c.crossings[0]] };
        },
      },
    );
  });

  // slow: 6000 steps of two walker sims side by side, compared each step
  it(
    'keeps one idling by its door off a level crossing in front of it, with the draws it had',
    { timeout: 60_000 },
    () => {
      // the same house by the line twice, with the crossing in front of its door and with none
      const sims = [true, false].map((road) => {
        const w = simWorld({ terrain: 'grass', size: SIDE, seed: 4242 });
        line(w, 6, ROW, 60);
        w.builder.free = true;
        if (road) expect(w.builder.placeRoad(DOOR_X, ROW)).toBe(true);
        expect(w.builder.placeDecor(DOOR_X, ROW - 1, 'townhouse', 0)).not.toBeNull();
        w.builder.free = false;
        expect(w.builder.roads.isCrossing(DOOR_X, ROW)).toBe(road);
        // no station and nothing to gather: its walkers only ever idle by the door
        return new PeopleSim(w.map, w.builder, new Rng(3));
      });
      const [crossing, bare] = sims;
      let idle = 0;
      let beyond = 0;
      for (let i = 0; i < 6000; i++) {
        for (const people of sims) people.tick(SIM_STEP, 6, MIDDAY);
        expect(crossing.toJSON()).toEqual(bare.toJSON());
        expect(crossing.persons).toHaveLength(bare.persons.length);
        crossing.persons.forEach((p, k) => {
          const b = bare.persons[k];
          // the same walker doing the same, at the same x; only how far out it stands differs
          expect({ ...p, y: 0 }).toEqual({ ...b, y: 0 });
          expect(onTile(p, DOOR_X, ROW), `walker ${p.id} at ${p.x}, ${p.y}`).toBe(false);
          if (p.state !== 'idle') return;
          idle++;
          expect(onTile(p, DOOR_X, ROW - 1)).toBe(true);
          expect(p.y).toBeGreaterThanOrEqual(ROW - 1 + 0.3);
          if (onTile(b, DOOR_X, ROW)) beyond++;
        });
      }
      // not vacuous: with no crossing there, walkers stood out on that tile now and then
      expect(idle).toBeGreaterThanOrEqual(1000);
      expect(beyond).toBeGreaterThanOrEqual(200);
    },
  );

  it('steps off a level crossing laid where it idles, to its edge on the side of its home', () => {
    const w = simWorld({ terrain: 'grass', size: SIDE, seed: 4242 });
    line(w, 6, ROW, 60);
    w.builder.free = true;
    expect(w.builder.placeDecor(DOOR_X, ROW - 1, 'townhouse', 0)).not.toBeNull();
    const people = new PeopleSim(w.map, w.builder, new Rng(3));
    const out = () => people.persons.find((p) => p.state === 'idle' && onTile(p, DOOR_X, ROW));
    for (let i = 0; i < 6000 && !out(); i++) people.tick(SIM_STEP, 6, MIDDAY);
    const p = out()!;
    expect(p).toBeDefined();
    const rng = people.toJSON().rng;
    const timer = p.timer;
    const at = { x: p.x, y: p.y };
    expect(w.builder.placeRoad(DOOR_X, ROW)).toBe(true);
    people.tick(SIM_STEP, 6, MIDDAY);
    // still idling, at the crossing's edge, straight towards the house from where it stood
    expect(p.state).toBe('idle');
    expect(p.timer).toBeCloseTo(timer - SIM_STEP, 9);
    expect(people.toJSON().rng).toBe(rng);
    expect(p.y).toBeCloseTo(ROW - 0.5, 9);
    expect(onTile(p, DOOR_X, ROW)).toBe(false);
    const toward = { x: DOOR_X - at.x, y: ROW - 1 - at.y };
    expect((p.x - at.x) * toward.y - (p.y - at.y) * toward.x).toBeCloseTo(0, 9);
  });

  it('sets a figure alighting on a platform a road crosses down at its edge, on its way, with the draws it had', () => {
    const [px, py] = [CROSS_X + 1, ROW];
    // a platform with a road over it, and the same platform with none
    const sims = [true, false].map((road) => {
      const w = simWorld({ terrain: 'grass', size: SIDE, seed: 4242 });
      line(w, 6, ROW, 60);
      const st = station(w, 'station', px, ROW + 1);
      expect(w.builder.platformTiles(st)).toEqual([{ x: px, y: py }]);
      w.builder.free = true;
      if (road) expect(w.builder.placeRoad(px, py)).toBe(true);
      w.builder.free = false;
      expect(w.builder.roads.isCrossing(px, py)).toBe(road);
      const people = new PeopleSim(w.map, w.builder, new Rng(9));
      for (let k = 0; k < 20; k++) people.alight(st, 3);
      return people;
    });
    const [crossing, bare] = sims;
    expect(crossing.toJSON()).toEqual(bare.toJSON());
    expect(crossing.persons).toHaveLength(60);
    crossing.persons.forEach((p, k) => {
      const b = bare.persons[k];
      expect({ ...p, x: 0, y: 0 }).toEqual({ ...b, x: 0, y: 0 });
      // set down on the platform with no road there; with one, at its edge, straight on from
      // there towards the figure's first step
      expect(onTile(b, px, py)).toBe(true);
      expect(Math.abs(cheb(p, px, py) - 0.5)).toBeLessThan(1e-9);
      const to = p.path[1];
      expect((p.x - b.x) * (to.y - b.y) - (p.y - b.y) * (to.x - b.x)).toBeCloseTo(0, 9);
      expect((p.x - b.x) * (to.x - b.x) + (p.y - b.y) * (to.y - b.y)).toBeGreaterThan(0);
    });
    // and off they go to the station with a train on the crossing, never setting foot on it
    const closed = (x: number, y: number) => x === px && y === py;
    for (let i = 0; i < 400 && crossing.persons.length; i++) {
      crossing.tick(SIM_STEP, 0, MIDDAY, closed);
      for (const p of crossing.persons) expect(onTile(p, px, py)).toBe(false);
    }
    expect(crossing.persons).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ walking round a crossing trains out of fuel hold (#447)

/**
 * Every state a train can be in, and whether walkers walk round a crossing that trains in it alone
 * hold closed: standing out of fuel or water (the author, 2026-10-14), or an electric engine
 * standing out of power (Core's reading of it). A state added to TrainState fails the typecheck
 * here until it is told one way or the other.
 */
const DRY: Record<TrainState, boolean> = {
  moving: false,
  noFuel: true,
  noPower: true,
  overweight: false,
  loading: false,
  waiting: false,
  idle: false,
  yielding: false,
  noRoute: false,
  stranded: false,
};

type Tile = { x: number; y: number };
/** The tiles of `list`, as a predicate. */
const among =
  (list: readonly Tile[]) =>
  (x: number, y: number): boolean =>
    list.some((t) => t.x === x && t.y === y);
/** A walker at `p` stands on the edge of tile (x, y), off it. */
const onEdge = (p: Tile, x: number, y: number) => Math.abs(cheb(p, x, y) - 0.5) <= 1e-6;

/**
 * The fewest steps of a walk from `a` to `b` in 8 directions over walkable tiles `avoid` does not
 * name, `b` among them, inside findWalk's box (WALK_MARGIN round the two ends): breadth first, as a
 * walk with no road under it is the fewest steps; null when there is none.
 */
function fewestSteps(
  map: GameMap,
  a: Tile,
  b: Tile,
  avoid: (x: number, y: number) => boolean,
): number | null {
  const x0 = Math.max(0, Math.min(a.x, b.x) - WALK_MARGIN);
  const y0 = Math.max(0, Math.min(a.y, b.y) - WALK_MARGIN);
  const x1 = Math.min(map.w - 1, Math.max(a.x, b.x) + WALK_MARGIN);
  const y1 = Math.min(map.h - 1, Math.max(a.y, b.y) + WALK_MARGIN);
  const seen = new Set([`${a.x},${a.y}`]);
  let front: Tile[] = [a];
  for (let d = 0; front.length; d++) {
    if (front.some((t) => t.x === b.x && t.y === b.y)) return d;
    const next: Tile[] = [];
    for (const t of front)
      for (const [dx, dy] of DIRS8) {
        const n = { x: t.x + dx, y: t.y + dy };
        if (n.x < x0 || n.y < y0 || n.x > x1 || n.y > y1 || seen.has(`${n.x},${n.y}`)) continue;
        if (avoid(n.x, n.y)) continue;
        if (!walkable(map, n.x, n.y) && !(n.x === b.x && n.y === b.y)) continue;
        seen.add(`${n.x},${n.y}`);
        next.push(n);
      }
    front = next;
  }
  return null;
}

/** All of a walker but where it stands and its walk: what walking round may not change. */
const besidesWalk = (p: Person) => ({ ...p, x: 0, y: 0, path: [], step: 0 });

describe('a crossing only trains out of fuel or power hold closed', () => {
  it('names the states whose trains walkers walk round, each one a train standing on its way in', () => {
    expect([...DETOUR_STATES].sort()).toEqual(STATES.filter((s) => DRY[s]).sort());
    for (const s of DETOUR_STATES) expect(ROUTED[s], s).toBe(true);
  });

  it('is told apart by the watch, which also says the tiles cars stand on', () => {
    const y = 9;
    forAll(
      (rng) => ({
        crossings: Array.from({ length: rng.int(0, 6) }, () => rng.int(0, 15)),
        trains: Array.from({ length: rng.int(0, 3) }, () => ({
          state: rng.pick(STATES),
          speed: rng.pick([0, 0, 0.4, 1.5]),
          head: rng.int(0, 15),
          length: rng.int(1, 4),
          progress: rng.range(0, 10),
          acceleration: rng.pick([undefined, 0, 0.05, 0.4]),
          maxSpeed: rng.pick([undefined, 0.5, 1]),
        })),
      }),
      (c) => {
        // each train on row y, its head on `head` and its cars behind it to the west, its way east
        const trains = c.trains.map((t) => ({
          ...t,
          cars: Array.from({ length: t.length }, (_, i) => t.head - i)
            .filter((x) => x >= 0)
            .map((x) => keyOf(x, y)),
          ahead: eastward(t.head, y, t.progress, 16 - t.head),
        }));
        const plains = trains.map((t) => plain(t));
        const keys = new Set(c.crossings.map((x) => keyOf(x, y)));
        const watch = new CrossingWatch(W);
        watch.update(plains, keys, SIM_STEP);
        for (let x = 0; x < W; x++)
          for (const ty of [y - 1, y, y + 1]) {
            const k = keyOf(x, ty);
            // the trains that close the tile: a car on it, or a train with its way set reaching it
            const closers = trains.filter((t, i) => {
              if (t.cars.includes(k)) return true;
              if (!ROUTED[t.state]) return false;
              const far = crossingReach(plains[i], CROSSING_HORIZON) + CROSSING_LEAD;
              return t.ahead.some((s) => s.x === x && s.y === ty && s.arc - t.progress <= far);
            });
            const closed = keys.has(k) && closers.length > 0;
            expect(watch.closed(x, ty), `${x},${ty}`).toBe(closed);
            expect(watch.detour(x, ty), `${x},${ty}`).toBe(
              closed && closers.every((t) => DRY[t.state]),
            );
            expect(watch.occupied(x, ty), `${x},${ty}`).toBe(
              keys.size > 0 && trains.some((t) => t.cars.includes(k)),
            );
          }
        // the trains gone: the crossings they closed are in their hold, none walked round, and no
        // car stands anywhere
        const held = closedKeys(watch);
        watch.update([], keys, SIM_STEP);
        expect(closedKeys(watch)).toEqual(held);
        for (let x = 0; x < W; x++) {
          expect(watch.detour(x, y)).toBe(false);
          expect(watch.occupied(x, y)).toBe(false);
        }
      },
      {
        shrink: function* (c) {
          for (const crossings of shrinkArray(c.crossings)) yield { ...c, crossings };
          for (const trains of shrinkArray(c.trains)) yield { ...c, trains };
        },
      },
    );
  });

  it('is walked round from the step a walker reaches its edge, on no closed crossing and no tile under a car, and the walker keeps to that walk', () => {
    // A walk straight over the crossing in any of the eight ways, the cars of a train along any line
    // through it or beside it, other crossings closed round it, walked round or not, in any walking
    // state and step; then the crossings stay as they are, or all open.
    const seen = { straight: 0, back: 0, none: 0 };
    forAll(
      (rng) => {
        const dir = rng.pick(DIRS8);
        const line = rng.pick(DIRS8);
        const shift = rng.pick([
          [0, 0],
          [0, 0],
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const);
        const first = rng.int(-5, 1);
        return {
          dir,
          before: rng.int(1, 4),
          after: rng.int(1, 4),
          cars: Array.from({ length: rng.int(0, 6) }, (_, i) => ({
            x: CX + line[0] * (first + i) + shift[0],
            y: CY + line[1] * (first + i) + shift[1],
          })),
          others: Array.from({ length: rng.int(0, 4) }, () => ({
            x: CX + rng.int(-4, 4),
            y: CY + rng.int(-4, 4),
            round: rng.chance(0.5),
          })),
          state: rng.pick(WALKING),
          stream: rng.int(1, 1e6),
          gdt: rng.pick([SIM_STEP, 0.25, 1]),
          opens: rng.chance(0.5),
        };
      },
      (c) => {
        const [sx, sy] = c.dir;
        const walk = walkOf(
          CX - sx * c.before,
          CY - sy * c.before,
          CX + sx * c.after,
          CY + sy * c.after,
        );
        // the tile it stands at on the crossing's edge, and the end of its walk
        const back = walk[c.before - 1];
        const end = walk[walk.length - 1];
        // nothing in the way before the crossing, and nothing on the end of the walk
        const kept = among([...walk.slice(0, c.before), end, { x: CX, y: CY }]);
        const cars = c.cars.filter((t) => !kept(t.x, t.y));
        const others = c.others.filter((t) => !kept(t.x, t.y));
        const closed = among([{ x: CX, y: CY }, ...others]);
        const detour: CrossingDetour = {
          detour: among([{ x: CX, y: CY }, ...others.filter((t) => t.round)]),
          occupied: among(cars),
        };
        const avoid = (x: number, y: number) => closed(x, y) || detour.occupied(x, y);
        const { map, builder } = field();
        const house = builder.spawnDecor(CX + 8, CY + 8, 'townhouse', 0);
        expect(house).not.toBeNull();
        const transient = c.state === 'walk';
        const population = transient ? 0 : 1;
        const make = () => {
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          const p: Person = {
            ...figure(walk.map((t) => ({ ...t }))),
            state: c.state,
            transient,
            home: transient ? '' : `d${house!.x},${house!.y}`,
          };
          people.persons.push(p);
          return { people, p };
        };
        // the same walker with no crossing at all, and with these
        const free = make();
        const { people, p } = make();
        const stream = people.toJSON().rng;
        const way = p.path;
        let reached = false;
        for (let i = 0; i < 2000 && !reached; i++) {
          const before = { ...p };
          free.people.tick(c.gdt, population, MIDDAY);
          people.tick(c.gdt, population, MIDDAY, closed, detour);
          if (p.path === way && JSON.stringify(p) === JSON.stringify(free.p)) continue;
          // the step it reaches the edge: it stops on it, as it was but for its walk, no draw
          reached = true;
          expect(onEdge(p, CX, CY), `at ${p.x}, ${p.y}`).toBe(true);
          expect(besidesWalk(p)).toEqual(besidesWalk(before));
          expect(people.toJSON().rng).toBe(stream);
        }
        expect(reached).toBe(true);
        const steps = fewestSteps(map, back, end, avoid);
        if (steps === null) {
          // no way round: it waits on the edge with the walk it had
          expect(p.path).toBe(way);
          seen.none++;
          return;
        }
        // a walk round from the tile it stands at, back to that tile's middle first only where the
        // way straight on would cut into a tile it keeps off, as short as any, on no tile it keeps
        // off
        expect(p.path).not.toBe(way);
        expect(p.step).toBe(0);
        const round = p.path;
        expect(round[0]).toEqual(back);
        const tiles = round[1].x === back.x && round[1].y === back.y ? round.slice(1) : round;
        seen[tiles === round ? 'straight' : 'back']++;
        expect(tiles[tiles.length - 1]).toEqual(end);
        expect(tiles.length - 1).toBe(steps);
        tiles.forEach((t, k) => {
          if (!k) return;
          const s = tiles[k - 1];
          expect(Math.max(Math.abs(t.x - s.x), Math.abs(t.y - s.y))).toBe(1);
          expect(avoid(t.x, t.y), `${t.x},${t.y}`).toBe(false);
        });
        // on to its end, the crossings closed as they were or all open: it keeps to the walk round,
        // sets foot on none of the tiles it kept off, and draws nothing until its walk ends
        const off: Tile[] = [{ x: CX, y: CY }, ...others, ...cars];
        let done = false;
        for (let i = 0; i < 4000 && !done; i++) {
          people.tick(c.gdt, population, MIDDAY, c.opens ? null : closed, c.opens ? null : detour);
          done = !people.persons.includes(p) || p.state !== c.state;
          if (done) break;
          expect(p.path).toBe(round);
          for (const t of off) expect(onTile(p, t.x, t.y), `${t.x},${t.y}`).toBe(false);
          expect(people.toJSON().rng).toBe(stream);
        }
        expect(done).toBe(true);
      },
    );
    // not vacuous: most walkers found a way round, some straight on from the edge and some back
    // through the middle of the tile they stood at first
    expect(seen.straight + seen.back).toBeGreaterThanOrEqual(90);
    expect(seen.straight).toBeGreaterThanOrEqual(10);
    expect(seen.back).toBeGreaterThanOrEqual(10);
  });

  it('is walked round along the roads where a road goes round, as any walk keeps to them', () => {
    const { map, builder } = field();
    // a road north over the crossing, and one round it to the east; a train across the crossing
    const loop = [
      { x: CX + 1, y: CY + 1 },
      { x: CX + 2, y: CY + 1 },
      { x: CX + 2, y: CY },
      { x: CX + 2, y: CY - 1 },
      { x: CX + 1, y: CY - 1 },
    ];
    for (let y = CY - 4; y <= CY + 4; y++) expect(builder.roads.add(CX, y)).toBe(true);
    for (const t of loop) expect(builder.roads.add(t.x, t.y)).toBe(true);
    const cars = [
      { x: CX - 1, y: CY },
      { x: CX, y: CY },
      { x: CX + 1, y: CY },
    ];
    const people = new PeopleSim(map, builder, new Rng(1));
    const way = walkOf(CX, CY + 4, CX, CY - 4);
    const p = figure(way);
    people.persons.push(p);
    const detour = { detour: closedC, occupied: among(cars) };
    for (let i = 0; i < 400 && p.path === way; i++)
      people.tick(SIM_STEP, 0, MIDDAY, closedC, detour);
    // straight on from the edge along the road round, which costs no more than a way over the
    // grass beside the train and keeps to the road all the way
    expect(p.path).toEqual([{ x: CX, y: CY + 1 }, ...loop, ...walkOf(CX, CY - 1, CX, CY - 4)]);
    expect(p).toMatchObject({ x: CX, y: CY + 0.5, step: 0 });
    for (let i = 0; i < 2000 && people.persons.length; i++) {
      people.tick(SIM_STEP, 0, MIDDAY, closedC, detour);
      for (const t of cars) expect(onTile(p, t.x, t.y)).toBe(false);
    }
    expect(people.persons).toEqual([]);
  });

  it('with no way round, keeps a walker waiting on its edge as it was, trying again every DETOUR_RETRY game seconds', () => {
    // A lane of grass through water over the crossing, the walker on its edge bound north over it;
    // a tile beside the crossing turns to grass some steps on. It takes the way round at the first
    // try after.
    expect(DETOUR_RETRY).toBe(5);
    forAll(
      (rng) => {
        const gdt = rng.pick([SIM_STEP, 0.25, 0.5, 1]);
        const period = Math.round(DETOUR_RETRY / gdt);
        const n = rng.int(1, 3);
        return {
          gdt,
          // the step in which the way opens, after the first: on a try, just before one, or any
          opens: rng.pick([n * period - 1, n * period, rng.int(0, 3 * period)]),
          state: rng.pick(WALKING),
          stream: rng.int(1, 1e6),
        };
      },
      (c) => {
        const { map, builder } = field();
        const house = builder.spawnDecor(0, 0, 'townhouse', 0);
        expect(house).not.toBeNull();
        for (let y = 0; y < map.h; y++)
          for (let x = 0; x < map.w; x++)
            if (!(x === CX && Math.abs(y - CY) <= 4) && !(x === 0 && y === 0))
              map.terrain[y * map.w + x] = Terrain.Water;
        const transient = c.state === 'walk';
        const population = transient ? 0 : 1;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const way = walkOf(CX, CY + 1, CX, CY - 4);
        const p: Person = {
          ...figure(way, { x: CX, y: CY + 0.5 }),
          state: c.state,
          transient,
          home: transient ? '' : `d${house!.x},${house!.y}`,
        };
        people.persons.push(p);
        const held = JSON.stringify(p);
        const stream = people.toJSON().rng;
        const detour = { detour: closedC, occupied: () => false };
        const tick = () => people.tick(c.gdt, population, MIDDAY, closedC, detour);
        // tries fall every period steps from the first: it takes the way at the first try after
        // the step the way opens in
        const period = Math.round(DETOUR_RETRY / c.gdt);
        const takes = (Math.floor(c.opens / period) + 1) * period;
        for (let i = 0; i < takes; i++) {
          tick();
          expect(JSON.stringify(p), `step ${i}`).toBe(held);
          expect(people.toJSON().rng).toBe(stream);
          if (i === c.opens) map.terrain[CY * map.w + CX - 1] = Terrain.Grass;
        }
        tick();
        // back to the middle of the tile it stands at, as the way straight on would cut the
        // crossing's corner, then round it over the new grass
        expect(p.path).toEqual([
          { x: CX, y: CY + 1 },
          { x: CX, y: CY + 1 },
          { x: CX - 1, y: CY },
          ...walkOf(CX, CY - 1, CX, CY - 4),
        ]);
        expect(besidesWalk(p)).toEqual(besidesWalk(JSON.parse(held) as Person));
        expect(people.toJSON().rng).toBe(stream);
        for (let i = 0; i < 4000 && people.persons.includes(p) && p.state === c.state; i++) {
          tick();
          expect(onTile(p, CX, CY)).toBe(false);
        }
        expect(people.persons.includes(p) && p.state === c.state).toBe(false);
      },
    );
  });

  it('keeps a walker waiting as before for a train passing, held at a signal or behind another, or standing in any other state', () => {
    // Plain trains on row CY of the walker field, read by a watch as the step reads them, stand
    // there for 40 game seconds and are gone. The walker goes north over the crossing, and a twin
    // of it is told of no way round: it waits as #404 has it.
    const crossing = keyOf(CX, CY);
    const keys = new Set([crossing]);
    // standing short of the crossing to the west with its way east over it, within its reach
    const short = (state: TrainState): Plain => ({
      state,
      speed: 0,
      progress: 12,
      cars: [keyOf(CX - 2, CY), keyOf(CX - 3, CY)],
      ahead: eastward(CX - 2, CY, 12, 6),
      acceleration: 0.4,
      maxSpeed: 1,
    });
    // standing on it, its way east
    const on = (state: TrainState): Plain => ({
      state,
      cars: [crossing, keyOf(CX - 1, CY)],
      ahead: eastward(CX, CY, 12, 4),
    });
    const passing: Plain = {
      speed: 1.5,
      progress: 3,
      cars: [keyOf(CX - 1, CY)],
      ahead: eastward(CX - 1, CY, 3, 6),
    };
    const cases: [string, Plain[]][] = [
      ['passing over it', [passing]],
      ['held at a signal short of it', [short('moving')]],
      ['out of fuel on it, another held behind it', [on('noFuel'), short('moving')]],
      ['out of fuel on it, another passing', [on('noFuel'), passing]],
      [
        'out of fuel on it, an electric one out of power behind it',
        [on('noFuel'), short('noPower')],
      ],
      ...STATES.map((s): [string, Plain[]] => [`${s} on it`, [on(s)]]),
      ...ROUTED_LIST.map((s): [string, Plain[]] => [`${s} short of it`, [short(s)]]),
    ];
    let rounds = 0;
    for (const [name, trains] of cases) {
      const walkedRound = trains.every((t) => DRY[t.state ?? 'moving']);
      const { map, builder } = field();
      const watch = new CrossingWatch(W);
      const [told, twin] = [0, 1].map(() => {
        const people = new PeopleSim(map, builder, new Rng(5));
        people.persons.push(figure(walkOf(CX, CY + 4, CX, CY - 4)));
        return people;
      });
      const way = told.persons[0].path;
      let edge = -1;
      let differs = -1;
      let walk: Tile[] | null = null;
      for (let i = 0; i < 400 && told.persons.length + twin.persons.length; i++) {
        watch.update(i < 160 ? trains.map(plain) : [], keys, 0.25);
        if (i < 160) expect(watch.closed(CX, CY), name).toBe(true);
        told.tick(0.25, 0, MIDDAY, watch.closed, watch);
        twin.tick(0.25, 0, MIDDAY, watch.closed);
        if (edge < 0 && twin.persons.length && onEdge(twin.persons[0], CX, CY)) edge = i;
        if (differs < 0 && JSON.stringify(told.persons) !== JSON.stringify(twin.persons)) {
          differs = i;
          walk = told.persons[0].path;
        }
      }
      // the twin waited on the edge while the trains stood there
      expect(edge, name).toBeGreaterThanOrEqual(0);
      expect(edge, name).toBeLessThan(160);
      if (walkedRound) {
        // a way round the step it reached the edge
        expect(differs, name).toBe(edge);
        expect(walk, name).not.toBe(way);
        rounds++;
      } else {
        // it waited and went on over the crossing exactly as its twin
        expect(differs, name).toBe(-1);
        expect(told.persons, name).toEqual([]);
      }
    }
    expect(rounds).toBe(2 + 2 + 1);
  });

  it('is walked round in the step the train holding it runs out of fuel or power, by a walker waiting on its edge', () => {
    // A train held at a signal short of the crossing, or standing on it with its way set, keeps the
    // walker waiting (#404). At any step of that wait it runs dry: the watch says so in that step,
    // and the walker walks round in it.
    const crossing = keyOf(CX, CY);
    const keys = new Set([crossing]);
    forAll(
      (rng) => ({
        dry: rng.pick(['noFuel', 'noPower'] as const),
        on: rng.chance(0.5),
        gdt: rng.pick([SIM_STEP, 0.25, 1]),
        wait: rng.int(0, 60),
        north: rng.chance(0.5),
        stream: rng.int(1, 1e6),
      }),
      (c) => {
        const cars = c.on ? [crossing, keyOf(CX - 1, CY)] : [keyOf(CX - 2, CY), keyOf(CX - 3, CY)];
        const train = (state: TrainState): CrossingTrain =>
          c.on
            ? plain({ state, cars, ahead: eastward(CX, CY, 12, 4) })
            : plain({
                state,
                speed: 0,
                progress: 12,
                cars,
                ahead: eastward(CX - 2, CY, 12, 6),
                acceleration: 0.4,
                maxSpeed: 1,
              });
        const { map, builder } = field();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const way = c.north ? walkOf(CX, CY + 4, CX, CY - 4) : walkOf(CX, CY - 4, CX, CY + 4);
        const p = figure(way);
        people.persons.push(p);
        const stream = people.toJSON().rng;
        const watch = new CrossingWatch(W);
        let edge = -1;
        let round = -1;
        for (let i = 0; i < 4000 && round < 0; i++) {
          const dry = edge >= 0 && i > edge + c.wait;
          watch.update([train(dry ? c.dry : 'moving')], keys, c.gdt);
          expect(watch.closed(CX, CY), `step ${i}`).toBe(true);
          expect(watch.detour(CX, CY), `step ${i}`).toBe(dry);
          const was = { ...p };
          people.tick(c.gdt, 0, MIDDAY, watch.closed, watch);
          expect(onTile(p, CX, CY), `step ${i}`).toBe(false);
          expect(people.toJSON().rng).toBe(stream);
          if (!dry) {
            expect(p.path, `step ${i}`).toBe(way);
            if (edge < 0 && onEdge(p, CX, CY)) edge = i;
            continue;
          }
          // the first step the train stands dry: a walk round from where it waits
          round = i;
          expect(p.path).not.toBe(way);
          expect(Math.hypot(p.x - was.x, p.y - was.y)).toBeLessThan(1e-9);
          expect(besidesWalk(p)).toEqual(besidesWalk(was));
          expect(p.path[0]).toEqual({ x: CX, y: CY + (c.north ? 1 : -1) });
          expect(p.path.at(-1)).toEqual(way.at(-1));
          for (const t of p.path.slice(1)) {
            expect(t.x === CX && t.y === CY).toBe(false);
            expect(cars.includes(keyOf(t.x, t.y)), `${t.x},${t.y}`).toBe(false);
          }
        }
        expect(edge).toBeGreaterThanOrEqual(0);
        expect(round).toBe(edge + c.wait + 1);
      },
    );
  });
});

/**
 * crossingWorld with its shuttle, run in play mode with the weather off until it runs east with its
 * head on column `head`. Given `dry`, its tanks are then emptied: it stands out of fuel on its way
 * over the crossing, and stays so. Otherwise they are kept full and it shuttles on over it. Then
 * `minutes` game minutes of steps, each walker read against the crossing after each step: none
 * steps onto it while it is closed, and no walk round goes over it or a tile a car stands on.
 * Returns how many walkers walked
 * round it (their walk changed on its edge in the step), how many steps a walker spent waiting on
 * its edge, how many of those that walked round went over the line, and every walk round taken, in
 * order, with the walkers' random stream at the end.
 */
function roundRun(seed: number, head: number, dry: boolean, minutes: number) {
  const { w, train } = crossingWorld('adler', seed);
  const step = new SimStep(w);
  const ctx = playContext(w);
  const t = train!;
  const tanks = () => {
    t.coal = dry ? 0 : t.coalCap;
    t.water = dry ? 0 : t.waterCap;
    t.oil = dry ? 0 : t.oilCap;
  };
  for (let i = 0; i < 6000 && !(t.speed > 0.5 && t.headTile?.x === head); i++) {
    w.clock.run((gdt) => step.run(gdt, ctx));
    t.coal = t.coalCap;
    t.water = t.waterCap;
    t.oil = t.oilCap;
  }
  expect(t.headTile?.x).toBe(head);
  // the step the watch first reads it out of fuel, before the walkers move
  tanks();
  w.clock.run((gdt) => step.run(gdt, ctx));
  if (dry) expect(t.state).toBe('noFuel');
  const out = { rounds: 0, waits: 0, over: 0, walks: [] as string[], rng: 0 };
  const rounded = new Set<number>();
  const side = new Map<number, number>();
  let before = was(w.people);
  for (let i = 0; i < Math.round((minutes * 60) / SIM_STEP); i++) {
    // the crossing and the cars as the walkers of this step find them
    const cars = t.occupancyKeys(SIDE);
    w.clock.run((gdt) => step.run(gdt, ctx));
    tanks();
    const watch = step.crossings!;
    const closed = watch.closed(CROSS_X, ROW);
    if (dry) {
      expect(t.state).toBe('noFuel');
      expect(closed).toBe(true);
      expect(watch.detour(CROSS_X, ROW)).toBe(true);
    } else expect(watch.detour(CROSS_X, ROW)).toBe(false);
    for (const p of w.people.persons) {
      const b = before.get(p.id);
      if (closed && onTile(p, CROSS_X, ROW) && !(b && onTile(b, CROSS_X, ROW)))
        expect.fail(`walker ${p.id} stepped onto the closed crossing at ${w.clock.time}`);
      const edge = onEdge(p, CROSS_X, ROW);
      if (edge && waited(p, b)) out.waits++;
      if (edge && b && WALKING.includes(b.state) && p.state === b.state && p.path !== b.path) {
        // a walk round, from the tile it stands at, on neither the crossing nor a car's tile
        out.rounds++;
        rounded.add(p.id);
        out.walks.push(`${i} ${p.id} ${JSON.stringify(p.path)}`);
        for (const s of p.path.slice(1)) {
          expect(s.x === CROSS_X && s.y === ROW, `walker ${p.id}`).toBe(false);
          expect(cars.includes(s.y * SIDE + s.x), `walker ${p.id} at ${s.x},${s.y}`).toBe(false);
        }
      }
      // north or south of the line, off it; a walker that walked round and is now on the other side
      // went over the line somewhere other than the crossing
      const now = p.y < ROW - 0.5 ? -1 : p.y > ROW + 0.5 ? 1 : 0;
      if (!now) continue;
      if (rounded.has(p.id) && side.has(p.id) && side.get(p.id) !== now) out.over++;
      side.set(p.id, now);
    }
    before = was(w.people);
  }
  out.rng = w.people.toJSON().rng;
  return out;
}

describe('walkers at a crossing a real train holds, in the step', () => {
  // slow: up to 6000 steps to bring the train there, then 4800 of a whole world with some forty
  // walkers, twice over
  it.each([
    ['standing out of fuel short of it, its way over it', CROSS_X - 3],
    ['standing out of fuel across it', CROSS_X + 1],
  ] as const)(
    '%s: walkers walk round it from the step they reach its edge, never waiting there, and the same seed gives the same walks',
    (_, head) => {
      const out = roundRun(4242, head, true, 4);
      expect(out.waits).toBe(0);
      // not vacuous: many walked round, and walkers went over the line elsewhere
      expect(out.rounds).toBeGreaterThanOrEqual(10);
      expect(out.over).toBeGreaterThanOrEqual(5);
      // determinism: the same world gives the same walks round, and the same stream after them
      const again = roundRun(4242, head, true, 4);
      expect(again.walks).toEqual(out.walks);
      expect(again.rng).toBe(out.rng);
    },
    180_000,
  );

  // slow: as above, once
  it(
    'a train passing over it keeps walkers waiting on its edge, none walking round',
    { timeout: 120_000 },
    () => {
      const out = roundRun(4242, CROSS_X - 4, false, 4);
      expect(out.rounds).toBe(0);
      // not vacuous: walkers waited on its edge
      expect(out.waits).toBeGreaterThanOrEqual(20);
    },
  );
});

// ------------------------------------------------------------------ crossings that close, open and run dry at random (#447)

/**
 * Where the way from `a` straight to `b` runs inside tile (x, y): how far along it it enters the
 * tile's square and how far it leaves it, or null where it never runs inside it.
 */
function clip(a: Tile, b: Tile, x: number, y: number): [number, number] | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return null;
  let enter = 0;
  let leave = len;
  for (const [from, u, c] of [
    [a.x, (b.x - a.x) / len, x],
    [a.y, (b.y - a.y) / len, y],
  ]) {
    if (u === 0) {
      if (Math.abs(from - c) >= 0.5) return null;
      continue;
    }
    const s0 = (c - 0.5 - from) / u;
    const s1 = (c + 0.5 - from) / u;
    enter = Math.max(enter, Math.min(s0, s1));
    leave = Math.min(leave, Math.max(s0, s1));
  }
  return leave > enter ? [enter, leave] : null;
}
/** Of `tiles`, those the way from `p` to `q` runs into for more than rounding, but one `p` is on. */
const cutsInto = (p: Tile, q: Tile, tiles: readonly Tile[]) =>
  tiles.filter((t) => {
    if (onTile(p, t.x, t.y)) return false;
    const c = clip(p, q, t.x, t.y);
    return !!c && c[1] - c[0] > 1e-6;
  });
/** Of those, the ones it runs into at once: the closed crossings a walker at `p` is held at. */
const entersAt = (p: Tile, q: Tile, tiles: readonly Tile[]) =>
  cutsInto(p, q, tiles).filter((t) => clip(p, q, t.x, t.y)![0] <= 1e-6);
/** The tile a walker at `p` on its way to `q` stands at: the one its way crossed just before `p`. */
function standingAt(p: Tile, q: Tile): Tile {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  return {
    x: Math.round(p.x - ((q.x - p.x) / len) * 1e-7),
    y: Math.round(p.y - ((q.y - p.y) / len) * 1e-7),
  };
}

/** Three hundred seeds: walks round, tries and waits are a fraction of the steps of a case. */
const DRY_SEEDS: readonly number[] = Array.from({ length: 300 }, (_, i) => i + 1);
type Closing = 'open' | 'firm' | 'dry';
/** Game seconds over which each crossing stays open, closed, or closed by dry trains alone. */
interface Phase {
  seconds: number;
  /** one for each of the case's crossings, in order */
  states: Closing[];
  cars: Tile[];
}
interface DryCase {
  from: Tile;
  to: Tile;
  crossings: Tile[];
  water: Tile[];
  phases: Phase[];
  state: PersonState;
  stream: number;
  gdt: number;
}

describe('a walker among crossings that close, open and run dry at random', () => {
  // slow: 300 cases of up to some thousands of steps, each step read against the oracle
  it(
    'never sets foot on a closed one, and walks round exactly when and as the detour says: at once at the edge of one only dry trains hold, again every DETOUR_RETRY, by the fewest steps, to the same end',
    { timeout: 120_000 },
    () => {
      // A walker on a walk past up to six crossings, each open, closed, or closed by trains out of
      // fuel or power alone, and cars on tiles round them, all changing every few seconds; then all
      // open. Step lengths are never a whole part of the half tile from a tile's middle to its
      // edge, so the step a walker reaches an edge in is never a matter of rounding.
      const seen = {
        rounds: 0,
        back: 0,
        offCrossing: 0,
        turnedDry: 0,
        retried: 0,
        noWay: 0,
        startKeptOff: 0,
      };
      forAll(
        (rng): DryCase => {
          const near = (r: number) => ({ x: CX + rng.int(-r, r), y: CY + rng.int(-r, r) });
          const dir = rng.pick(DIRS8);
          const through = rng.chance(0.7);
          const before = rng.int(1, 4);
          const after = rng.int(1, 4);
          const from = through ? { x: CX - dir[0] * before, y: CY - dir[1] * before } : near(4);
          let to = through ? { x: CX + dir[0] * after, y: CY + dir[1] * after } : near(4);
          if (to.x === from.x && to.y === from.y) to = { x: to.x + 1, y: to.y };
          const steady = rng.chance(0.4);
          const crossings = [
            { x: CX, y: CY },
            ...Array.from({ length: rng.int(0, 5) }, () => near(2)),
          ];
          return {
            from,
            to,
            crossings,
            water: Array.from({ length: rng.int(0, 8) }, () => near(4)),
            phases: Array.from({ length: rng.int(1, 8) }, () => ({
              seconds: rng.pick([0.5, 2, 5, 12, 20]),
              // the first crossing held dry throughout in some cases, as by a train that stays so
              states: crossings.map((_, k) =>
                !k && steady ? 'dry' : rng.pick<Closing>(['open', 'firm', 'dry', 'dry', 'dry']),
              ),
              // trains: lines of cars through the tiles round the crossing
              cars: Array.from({ length: rng.int(0, 2) }, () => {
                const at = near(3);
                const [dx, dy] = rng.pick(DIRS8);
                return Array.from({ length: rng.int(1, 6) }, (_, k) => ({
                  x: at.x + dx * k,
                  y: at.y + dy * k,
                }));
              }).flat(),
            })),
            state: rng.pick(WALKING),
            stream: rng.int(1, 1e6),
            gdt: rng.pick([0.07, 0.3, 0.9]),
          };
        },
        (c) => {
          const { map, builder } = field();
          const house = builder.spawnDecor(CX + 8, CY + 8, 'townhouse', 0);
          expect(house).not.toBeNull();
          const walk = walkOf(c.from.x, c.from.y, c.to.x, c.to.y);
          const end = walk[walk.length - 1];
          // each crossing once, the first of a tile's entries telling how it closes
          const tiles = c.crossings.filter(
            (t, i) => c.crossings.findIndex((s) => s.x === t.x && s.y === t.y) === i,
          );
          const index = (t: Tile) => c.crossings.findIndex((s) => s.x === t.x && s.y === t.y);
          const isCrossing = among(tiles);
          for (const t of c.water)
            if (!among(walk)(t.x, t.y) && !isCrossing(t.x, t.y))
              map.terrain[t.y * map.w + t.x] = Terrain.Water;
          const transient = c.state === 'walk';
          const population = transient ? 0 : 1;
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          const p: Person = {
            ...figure(walk),
            state: c.state,
            transient,
            home: transient ? '' : `d${house!.x},${house!.y}`,
          };
          people.persons.push(p);
          const stream = people.toJSON().rng;
          // no road here: one pace on every leg
          const full = walkSpeed(p) * c.gdt;
          // steps from one try for a way round to the next: the first DETOUR_RETRY or more after it
          const period = Math.ceil(DETOUR_RETRY / c.gdt - 1e-9);
          const lengths = c.phases.map((ph) => Math.max(1, Math.round(ph.seconds / c.gdt)));
          const limit = lengths.reduce((a, b) => a + b, 0) + Math.ceil(400 / c.gdt);
          let phase = 0;
          let inPhase = 0;
          // the step before: held at the edge of crossings, and only dry trains closing them all
          let held = false;
          let heldDry = false;
          // steps since its last try for a way round, while it waits at such an edge
          let sinceTry = 0;
          let done = false;
          for (let i = 0; i < limit && !done; i++) {
            const ph = phase < c.phases.length ? c.phases[phase] : null;
            const closing = (t: Tile): Closing =>
              ph && isCrossing(t.x, t.y) ? ph.states[index(t)] : 'open';
            const closedTiles = tiles.filter((t) => closing(t) !== 'open');
            // a car stands on a crossing only while that crossing is closed
            const cars = ph
              ? ph.cars.filter((t) => !isCrossing(t.x, t.y) || closing(t) !== 'open')
              : [];
            const closed = ph ? among(closedTiles) : null;
            const detour: CrossingDetour | null = ph
              ? { detour: (x, y) => closing({ x, y }) === 'dry', occupied: among(cars) }
              : null;
            const keepOff = [...closedTiles, ...cars];
            const avoid = among(keepOff);
            const was = { ...p };
            people.tick(c.gdt, population, MIDDAY, closed, detour);
            // never onto a closed crossing it is not on, whatever it walks
            for (const t of cutsInto(was, p, closedTiles))
              expect.fail(`step ${i}: onto the closed crossing ${t.x},${t.y}`);
            done = !people.persons.includes(p) || p.state !== c.state;
            if (done) break;
            expect(people.toJSON().rng, `step ${i}`).toBe(stream);
            // where it is held, read off where it stands and its way on as it had it
            const next = was.path[was.step + 1];
            const changed = p.path !== was.path;
            const reached = !changed && p.step !== was.step;
            const moved = Math.hypot(p.x - was.x, p.y - was.y);
            const stopped =
              !reached && moved < Math.min(full, Math.hypot(next.x - was.x, next.y - was.y)) - 1e-9;
            const at = stopped && closed ? entersAt(p, next, closedTiles) : [];
            const nowHeld = at.length > 0;
            const nowHeldDry = nowHeld && at.every((t) => closing(t) === 'dry');
            // a try: the step it is first held so, then each period steps while it stays so
            const tries = nowHeldDry && (!heldDry || sinceTry + 1 >= period);
            const back = nowHeldDry ? standingAt(p, next) : null;
            const steps = tries ? fewestSteps(map, back!, end, avoid) : null;
            // Left open for the author (#447): the tile it stands at is one it keeps off (a car's,
            // or a closed crossing it walked onto) and its way round starts back through it. The
            // walker waits there and tries again, where section 10 of docs/traffic-current.md says
            // it takes the walk; either is let through here and counted.
            const startKeptOff = tries && steps !== null && avoid(back!.x, back!.y) && !changed;
            if (startKeptOff) seen.startKeptOff++;
            else
              expect(
                changed,
                `step ${i}: walked round ${changed}, a try ${tries}, ${steps} steps`,
              ).toBe(tries && steps !== null);
            if (tries && steps === null) seen.noWay++;
            if (changed) {
              // as it was but for its walk, standing where its old way stopped it
              expect(besidesWalk(p)).toEqual(besidesWalk(was));
              expect(p.step).toBe(0);
              const round = p.path;
              expect(round[0]).toEqual(back);
              expect(round.at(-1)).toEqual(end);
              const twice = round.length > 1 && round[1].x === back!.x && round[1].y === back!.y;
              const own = twice ? round.slice(1) : round;
              // the fewest steps of any walk keeping off the closed crossings and the cars' tiles
              expect(own.length - 1).toBe(steps);
              own.forEach((t, k) => {
                if (!k) return;
                const s = own[k - 1];
                expect(Math.max(Math.abs(t.x - s.x), Math.abs(t.y - s.y))).toBe(1);
                expect(avoid(t.x, t.y), `${t.x},${t.y}`).toBe(false);
                if (k < own.length - 1) expect(walkable(map, t.x, t.y), `${t.x},${t.y}`).toBe(true);
              });
              // straight on from where it stands, or back to its tile's middle first exactly where
              // the way straight on would cut into a tile it keeps off
              expect(cutsInto(p, round[1], keepOff)).toEqual([]);
              if (own.length > 1) expect(twice).toBe(cutsInto(p, own[1], keepOff).length > 0);
              seen.rounds++;
              if (twice) seen.back++;
              if (isCrossing(back!.x, back!.y)) seen.offCrossing++;
              if (held && !heldDry) seen.turnedDry++;
              if (heldDry) seen.retried++;
            }
            sinceTry = tries ? 0 : sinceTry + 1;
            held = nowHeld && !changed;
            heldDry = nowHeldDry && !changed;
            if (ph && ++inPhase >= lengths[phase]) {
              phase++;
              inPhase = 0;
            }
          }
          expect(done, 'still walking when the steps ran out').toBe(true);
        },
        {
          seeds: DRY_SEEDS,
          shrink: function* (c) {
            for (const phases of shrinkArray(c.phases)) if (phases.length) yield { ...c, phases };
            for (const water of shrinkArray(c.water)) yield { ...c, water };
            for (let i = c.crossings.length - 1; i > 0; i--)
              yield {
                ...c,
                crossings: c.crossings.filter((_, k) => k !== i),
                phases: c.phases.map((ph) => ({
                  ...ph,
                  states: ph.states.filter((_, k) => k !== i),
                })),
              };
            for (let i = 0; i < c.phases.length; i++)
              for (const cars of shrinkArray(c.phases[i].cars))
                yield {
                  ...c,
                  phases: c.phases.map((ph, k) => (k === i ? { ...ph, cars } : ph)),
                };
          },
        },
      );
      // not vacuous: walks round straight on and back through the middle of the tile first, from a
      // crossing's tile, in the step the trains ran dry and at a later try; and tries that found none
      expect(seen.rounds - seen.back).toBeGreaterThanOrEqual(40);
      expect(seen.back).toBeGreaterThanOrEqual(40);
      expect(seen.offCrossing).toBeGreaterThanOrEqual(3);
      expect(seen.turnedDry).toBeGreaterThanOrEqual(6);
      expect(seen.retried).toBeGreaterThanOrEqual(5);
      expect(seen.noWay).toBeGreaterThanOrEqual(40);
    },
  );
});
