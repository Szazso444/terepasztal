import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
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
  type StopPlan,
  type Train,
  type TrainState,
} from './trains';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SimStep, startStock, type StepContext } from './step';
import { SIM_STEP } from './time';
import {
  BOARDING_SPEED_MUL,
  PeopleSim,
  ROAD_SPEED_MUL,
  WAKE,
  WALK_SPEED,
  offCrossing,
  walkSpeed,
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
    forAll(
      (rng) => ({
        locos: Array.from({ length: rng.int(1, 4) }, (_, i) => ({
          def: rng.pick(content.locomotives),
          level: rng.int(0, 3),
          mode: i === 0 ? ('leading' as const) : rng.pick(modes.slice(1)),
          engaged: rng.chance(0.5),
        })),
        wagons: Array.from({ length: rng.int(0, 6) }, () => ({
          def: rng.pick(content.wagons),
          level: rng.int(0, 3),
          cargo: rng.pick([null, 'stone', 'water']),
          amount: rng.range(0, 40),
        })),
      }),
      (c) => {
        const now = consistPhysics(c.locos, c.wagons).acceleration;
        const pull = crossingPull({ ...plain({ acceleration: now }), ...c });
        expect(pull).toBeGreaterThanOrEqual(now);
        expect(pull).toBeLessThanOrEqual(content.track.physics.maxAccel);
        // every way fuel, water and the wire may leave its units able to pull, and the standby
        // rule of Train.refreshModes with them: the units not on standby that can pull do, and
        // when none of them can, the first standby unit that can steps in
        for (let usable = 0; usable < 1 << c.locos.length; usable++) {
          const can = (i: number) => ((usable >> i) & 1) === 1;
          const working = c.locos.some((l, i) => l.mode !== 'standby' && can(i));
          const stepIn = c.locos.findIndex((l, i) => l.mode === 'standby' && can(i));
          const on = c.locos.map((l, i) => ({
            ...l,
            engaged: l.mode !== 'standby' ? can(i) : !working && i === stepIn,
          }));
          expect(consistPhysics(on, c.wagons).acceleration).toBeLessThanOrEqual(pull + 1e-12);
        }
      },
    );
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
  it('meets the walker within 2.87 tiles on the road and 22.84 corner to corner, never when its way was set first', () => {
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
  });
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

  it('keeps one idling by its door off a level crossing in front of it, with the draws it had', () => {
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
  });

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
