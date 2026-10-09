import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameClock, DAY_SECONDS, SIM_STEP, SPEEDS } from './time';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Train, resetTrainIds, type CarPose } from './trains';
import { Weather, setSeasonOffset } from './weather';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station } from './stations';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { content } from '../data/content';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { Rng } from '../engine/rng';
import {
  buildTrafficScenario,
  sharedTiles,
  SCENARIO_MAX_TICKS,
  type ScenarioResult,
  type TrafficScenario,
} from '../testing/trafficScenario';
import { forAll, shrinkArray, shrinkInt, SEEDS } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

function resetModules() {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
}
beforeEach(resetModules);

/** A clock at game speed `speed` (a value of SPEEDS, not its index). */
function clockAt(speed: number) {
  const clock = new GameClock();
  clock.setSpeed(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]));
  expect(clock.speed).toBe(speed);
  return clock;
}

/** Loop ticks that cover `seconds` of game time at `speed`. */
const loopTicks = (seconds: number, speed: number) => Math.round(seconds / SIM_STEP / speed);

/** A regular line along row 30 from x 2 to 89, on a grass map. */
function line() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    stock = new Stockpile(),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
  for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
  return { map, track, builder, fleet };
}

/** One f7 at x 10 heading east, dispatched to a station at x 60. */
function f7Run() {
  const w = line();
  const def = content.locomotives.find((d) => d.id === 'f7')!;
  const t = new Train([{ uid: 1, level: 0, def }]);
  expect(t.spawnAt(w.track, 10, 30, Dir.W)).toBe(true);
  t.oil = t.oilCap;
  const station = new Station('quarry', 60, 29);
  w.builder.stations.push(station);
  t.route = [station.id];
  w.fleet.trains.push(t);
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  return { ...w, t };
}

describe('GameClock.run', () => {
  it('steps 0.05 game seconds, one loop tick at 1/SIM_STEP Hz', () => {
    expect(SIM_STEP).toBe(0.05);
    expect(1 / SIM_STEP).toBe(20);
  });

  it.each([0, 1, 2, 3])(
    'at speed %i runs that many steps of SIM_STEP, each after time has moved on',
    (speed) => {
      const clock = clockAt(speed);
      clock.time = 100;
      const seen: { gdt: number; time: number }[] = [];
      const ran = clock.run((gdt) => seen.push({ gdt, time: clock.time }));
      let time = 100;
      const expected = Array.from({ length: speed }, () => ({
        gdt: SIM_STEP,
        time: (time += SIM_STEP),
      }));
      expect(seen).toEqual(expected);
      expect(clock.time).toBe(time);
      expect(clock.time - 100).toBeCloseTo(speed * SIM_STEP, 10);
      expect(ran).toBeCloseTo(speed * SIM_STEP, 10);
      expect(clock.speed).toBe(speed);
    },
  );
});

describe('the same game time gives the same outcome at every game speed', () => {
  /** The refuge scenario driven `ticks` loop ticks at `speed`, as the game loop will drive it. */
  function driveScenario(count: number, pinned: boolean, speed: number, ticks: number) {
    resetModules();
    const scenario = buildTrafficScenario(count, pinned);
    const clock = clockAt(speed);
    for (let i = 0; i < ticks; i++) {
      scenario.fleet.beginFrame();
      clock.run((gdt) => scenario.step(gdt, clock.time));
    }
    return {
      time: clock.time,
      result: scenario.result(),
      distances: scenario.trains.map((t) => t.distance),
      blockedTimes: scenario.trains.map((t) => t.blockedTime),
    };
  }

  it.each([
    { count: 3, pinned: false },
    { count: 4, pinned: true },
    { count: 12, pinned: false },
  ])(
    'the traffic scenario, $count trains (pinned: $pinned), run 3N steps at 1x and N loop ticks at 3x',
    ({ count, pinned }) => {
      const n = SCENARIO_MAX_TICKS / 3;
      const slow = driveScenario(count, pinned, 1, 3 * n);
      const fast = driveScenario(count, pinned, 3, n);
      // Arrival times, distances, holds, traffic counters and episodes, all exactly.
      expect(fast).toEqual(slow);
      // Not vacuous: every train got through and left.
      expect(slow.result.passed).toBe(true);
      expect(slow.result.trains.filter((t) => t.arrivedAt === null)).toEqual([]);
    },
    30_000,
  );

  it('a single f7 on a straight line arrives at the same game time at 1x and 3x', () => {
    const arrive = (speed: number) => {
      resetModules();
      const { fleet, t } = f7Run();
      const clock = clockAt(speed);
      let arrivedAt: number | null = null;
      fleet.onArrive = () => (arrivedAt ??= clock.time);
      for (let i = 0; i < loopTicks(180, speed); i++)
        clock.run((gdt) => fleet.tick(gdt, clock.time));
      return { arrivedAt, distance: t.distance, time: clock.time };
    };
    const slow = arrive(1);
    // One scaled 0.15 s step per loop tick, as `advance` gives at 3x, arrives 0.2 s early here
    // (audit A03: 39.15 s against 39.35 s).
    expect(arrive(3)).toEqual(slow);
    expect(slow.arrivedAt).not.toBeNull();
    expect(slow.arrivedAt!).toBeLessThan(180);
  }, 30_000);

  it('weather slows trains by the same amount at 1x and 3x when it eases by game time', () => {
    const travel = (speed: number) => {
      resetModules();
      const clock = clockAt(speed);
      const weather = new Weather(new Rng(2));
      let distance = 0;
      const kinds = new Set<string>();
      for (let i = 0; i < loopTicks(600, speed); i++)
        clock.run((gdt) => {
          weather.tick(clock.time, clock.day, gdt);
          distance += gdt * weather.speedFactor();
          kinds.add(weather.kind);
        });
      return { distance, visible: weather.visible, kinds: [...kinds].sort() };
    };
    const slow = travel(1);
    expect(travel(3)).toEqual(slow);
    // Not vacuous: this seed brings rain and fog within the 600 s, and they slowed the trains.
    expect(slow.kinds).toEqual(['clear', 'fog', 'rain']);
    expect(slow.distance).toBeLessThan(600 - 1);
  });
});

describe('Fleet.beginFrame', () => {
  /** The f7 run, stepped until it is under way. */
  function underWay() {
    const w = f7Run();
    const { fleet, t } = w;
    let now = 0;
    const tick = () => fleet.tick(SIM_STEP, (now += SIM_STEP));
    while (t.speed === 0 && now < 30) tick();
    tick();
    expect(t.speed).toBeGreaterThan(0);
    return { ...w, tick };
  }

  it('keeps the poses from before the first step through every step of the loop tick', () => {
    const { fleet, t, tick } = underWay();
    const poses = structuredClone(t.poses);
    const vehiclePoses = t.vehiclePoses;
    fleet.beginFrame();
    tick();
    tick();
    tick();
    expect(t.prevPoses).toEqual(poses);
    expect(t.prevVehiclePoses).toBe(vehiclePoses);
    expect(t.poses).not.toEqual(poses);
    // The next loop tick starts from where this one ended.
    fleet.beginFrame();
    expect(t.prevPoses).toEqual(t.poses);
    expect(t.prevPoses).not.toBe(t.poses);
    expect(t.prevVehiclePoses).toBe(t.vehiclePoses);
  });

  it('without it, each tick captures the poses it starts from, as before', () => {
    const { t, tick } = underWay();
    tick();
    tick();
    const poses = structuredClone(t.poses);
    const vehiclePoses = t.vehiclePoses;
    tick();
    expect(t.prevPoses).toEqual(poses);
    expect(t.prevVehiclePoses).toBe(vehiclePoses);
    expect(t.poses).not.toEqual(poses);
  });

  it.each(['spawn', 'restore', 'reverse'] as const)(
    'a %s inside a loop tick is a jump: it captures where the train lands, and later steps keep that',
    (jump) => {
      const w = underWay();
      const { fleet, t, tick } = w;
      const saved = t.toJSON().trail;
      for (let i = 0; i < 20; i++) tick();
      fleet.beginFrame();
      const start = structuredClone(t.poses);
      tick();
      if (jump === 'spawn') expect(t.spawnAt(w.track, 40, 30, Dir.W)).toBe(true);
      if (jump === 'restore') t.restoreTrail(saved, false);
      if (jump === 'reverse') (t as unknown as { reverseConsist(): void }).reverseConsist();
      const landed = structuredClone(t.poses);
      const vehiclePoses = t.vehiclePoses;
      expect(landed).not.toEqual(start);
      // Not interpolated from where the loop tick started: the renderer draws the landing pose.
      expect(t.prevPoses).toEqual(landed);
      expect(t.prevVehiclePoses).toBe(vehiclePoses);
      // Send it on (a reversed consist keeps its path), so the steps after the jump move it.
      const reversed = t.reversed;
      if (jump !== 'reverse') expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
      expect(t.reversed).toBe(reversed);
      tick();
      tick();
      expect(t.poses).not.toEqual(landed);
      expect(t.prevPoses).toEqual(landed);
      expect(t.prevVehiclePoses).toBe(vehiclePoses);
    },
  );
});

// ---------------------------------------------------------------- properties of the fixed steps

describe('GameClock against a model of its steps', () => {
  /** A start time and one speed control per loop tick: setSpeed(0 to 3), -1 togglePause, 4 none. */
  interface ClockCase {
    start: number;
    controls: number[];
  }

  it('each run() takes `speed` steps of SIM_STEP and adds SIM_STEP to time before each one', () => {
    forAll(
      (rng): ClockCase => ({
        start: rng.chance(0.2) ? 0 : rng.range(0, 10 * DAY_SECONDS),
        controls: Array.from({ length: rng.int(1, 40) }, () => rng.int(-1, 4)),
      }),
      ({ start, controls }) => {
        const clock = new GameClock();
        clock.time = start;
        // The model: the speed controls as the UI uses them, and time as SIM_STEP added per step.
        let index = 1;
        let previous = 1;
        let time = start;
        for (const [n, control] of controls.entries()) {
          if (control === -1) {
            clock.togglePause();
            index = index === 0 ? previous : 0;
          } else if (control <= 3) {
            clock.setSpeed(control);
            if (control !== 0) previous = control;
            index = control;
          }
          const seen: [number, number][] = [];
          const ran = clock.run((gdt) => seen.push([gdt, clock.time]));
          const expected: [number, number][] = [];
          for (let i = 0; i < SPEEDS[index]; i++) expected.push([SIM_STEP, (time += SIM_STEP)]);
          expect(seen, `loop tick ${n}: [gdt, time] per step`).toEqual(expected);
          expect(clock.time, `loop tick ${n}: time after`).toBe(time);
          expect(ran, `loop tick ${n}: game seconds run`).toBeCloseTo(SPEEDS[index] * SIM_STEP, 12);
          expect(clock.speedIndex, `loop tick ${n}: speed`).toBe(index);
        }
      },
      {
        shrink: function* ({ start, controls }) {
          if (start !== 0) yield { start: 0, controls };
          for (const c of shrinkArray(controls, (x) => (x === 4 ? [] : [4])))
            yield { start, controls: c };
        },
      },
    );
  });

  it('advance(realDt) still adds and returns realDt x speed', () => {
    forAll(
      (rng) =>
        Array.from({ length: rng.int(1, 30) }, () => ({
          index: rng.int(0, 3),
          realDt: rng.range(0, 0.25),
        })),
      (ticks) => {
        const clock = new GameClock();
        let time = 0;
        for (const { index, realDt } of ticks) {
          clock.setSpeed(index);
          const gdt = realDt * SPEEDS[index];
          expect(clock.advance(realDt)).toBe(gdt);
          expect(clock.time).toBe((time += gdt));
        }
      },
      { shrink: (ticks) => shrinkArray(ticks) },
    );
  });
});

/** Car poses equal to the last bit. */
const samePoses = (a: readonly CarPose[], b: readonly CarPose[]) =>
  a.length === b.length &&
  a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.heading === b[i].heading);

/** A train's poses and render capture at one moment. */
interface Held {
  t: Train;
  poses: CarPose[];
  vehiclePoses: Train['vehiclePoses'];
  prevPoses: CarPose[];
  prevVehiclePoses: Train['prevVehiclePoses'];
  reversed: boolean;
}
const hold = (trains: readonly Train[]): Held[] =>
  trains.map((t) => ({
    t,
    poses: t.poses.map((p) => ({ ...p })),
    vehiclePoses: t.vehiclePoses,
    prevPoses: t.prevPoses,
    prevVehiclePoses: t.prevVehiclePoses,
    reversed: t.reversed,
  }));
/** The train now interpolates from the poses it had at `h`: they were captured then. */
function capturedAt(h: Held): string | null {
  if (!samePoses(h.t.prevPoses, h.poses))
    return `train ${h.t.id} prevPoses ${JSON.stringify(h.t.prevPoses)}, expected ${JSON.stringify(h.poses)}`;
  if (h.t.prevVehiclePoses !== h.vehiclePoses)
    return `train ${h.t.id} prevVehiclePoses is not the vehiclePoses it had`;
  return null;
}
/** Nothing captured since `h`: the train interpolates from the very arrays it did then. */
function untouched(h: Held): string | null {
  if (h.t.prevPoses !== h.prevPoses || h.t.prevVehiclePoses !== h.prevVehiclePoses)
    return `train ${h.t.id} captured its poses again`;
  return null;
}

/**
 * Everything a scenario step decides, render capture left out, as one string: the trains' states,
 * speeds, distances, holds, poses and occupied tiles, and the traffic counters.
 */
function simState(s: TrafficScenario, time: number): string {
  const { traffic } = s.fleet;
  return JSON.stringify({
    time,
    fleet: s.fleet.trains.map((t) => t.id),
    trains: s.trains.map((t) => ({
      id: t.id,
      state: t.state,
      speed: t.speed,
      distance: t.distance,
      blockedTime: t.blockedTime,
      yields: t.yieldCount,
      reversed: t.reversed,
      poses: t.poses,
      tiles: t.occupancyKeys(s.track.w),
    })),
    counters: traffic.counters,
    episodes: traffic.episodes.length,
    recoveries: traffic.recoveries.active.size,
  });
}
/** The first field where two simState strings differ, for a failure message. */
function firstDifference(expected: string, actual: string): string {
  const walk = (a: unknown, b: unknown, path: string): string | null => {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null)
      return Object.is(a, b) ? null : `${path} is ${JSON.stringify(b)}, at 1x ${JSON.stringify(a)}`;
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const found = walk(x[k], y[k], `${path}.${k}`);
      if (found) return found;
    }
    return null;
  };
  return walk(JSON.parse(expected), JSON.parse(actual), 'state') ?? 'no difference';
}

/** The refuge scenario at 1x on the fixed-step path, never framed, step by step. */
interface Reference {
  /** simState after each step, SCENARIO_MAX_TICKS of them */
  trace: string[];
  result: ScenarioResult;
  /** the first tile two trains stood on at once, after any step */
  firstShared: string | null;
  /** the first step that did not capture the poses its trains started from */
  captureFault: string | null;
  /** train steps that moved a train, so the capture check saw something */
  moved: number;
}
const references = new Map<string, Reference>();
/** Deterministic, so it is built once per case, whichever test asks first. */
function reference(count: number, pinned: boolean): Reference {
  const key = `${count} ${pinned}`;
  const known = references.get(key);
  if (known) return known;
  resetModules();
  const s = buildTrafficScenario(count, pinned);
  const clock = clockAt(1);
  const trace: string[] = [];
  let firstShared: string | null = null;
  let captureFault: string | null = null;
  let moved = 0;
  while (trace.length < SCENARIO_MAX_TICKS)
    clock.run((gdt) => {
      const before = hold(s.fleet.trains);
      s.step(gdt, clock.time);
      const step = trace.push(simState(s, clock.time)) - 1;
      const shared = sharedTiles(s.fleet.trains, s.track.w);
      if (shared.length && firstShared === null)
        firstShared = `${JSON.stringify(shared)} after step ${step} at ${clock.time} s`;
      for (const h of before) {
        // A train that reversed in the step jumped, and captured where it landed.
        if (h.t.reversed !== h.reversed) continue;
        if (!samePoses(h.t.poses, h.poses)) moved++;
        const fault = capturedAt(h);
        if (fault && captureFault === null) captureFault = `step ${step}: ${fault}`;
      }
    });
  const ref = { trace, result: s.result(), firstShared, captureFault, moved };
  references.set(key, ref);
  return ref;
}

describe('the traffic scenarios on the fixed-step path', () => {
  const CASES = [
    { count: 3, pinned: false, stuckFree: true },
    { count: 4, pinned: true, stuckFree: true },
    { count: 12, pinned: false, stuckFree: false },
  ];

  it.each(CASES)(
    '$count trains (pinned: $pinned) at 1x: train 2 passes, no overlap, no deadlock, all leave',
    ({ count, pinned, stuckFree }) => {
      const r = reference(count, pinned);
      const { overlaps, deadlocks, stuck } = r.result.traffic.counters;
      expect({
        passed: r.result.passed,
        overlaps,
        sharedTile: r.firstShared,
        deadlocks,
        ...(stuckFree ? { stuck } : {}),
        // As the browser check: a run that never needed a coordinated recovery proves nothing.
        recovered: r.result.maxActive > 0,
        stillOut: r.result.trains.filter((t) => t.arrivedAt === null).map((t) => t.id),
        // No beginFrame: every step captures the poses it starts from, as before.
        captureFault: r.captureFault,
      }).toEqual({
        passed: true,
        overlaps: 0,
        sharedTile: null,
        deadlocks: 0,
        ...(stuckFree ? { stuck: 0 } : {}),
        recovered: true,
        stillOut: [],
        captureFault: null,
      });
      expect(r.moved).toBeGreaterThan(100);
    },
    60_000,
  );

  it.each(CASES.flatMap((c) => [2, 3].map((speed) => ({ ...c, speed }))))(
    '$count trains (pinned: $pinned) at speed $speed with beginFrame: each step is the 1x step, each loop tick keeps its start poses',
    ({ count, pinned, speed }) => {
      const ref = reference(count, pinned);
      resetModules();
      const s = buildTrafficScenario(count, pinned);
      const clock = clockAt(speed);
      let step = 0;
      let mismatch: string | null = null;
      let frameFault: string | null = null;
      let moved = 0;
      while (step < ref.trace.length && mismatch === null) {
        s.fleet.beginFrame();
        const start = hold(s.fleet.trains);
        clock.run((gdt) => {
          if (mismatch !== null) return;
          s.step(gdt, clock.time);
          const got = simState(s, clock.time);
          if (got !== ref.trace[step])
            mismatch = `step ${step} at ${clock.time} s: ${firstDifference(ref.trace[step], got)}`;
          step++;
        });
        for (const h of start) {
          if (h.t.reversed !== h.reversed) continue;
          if (!samePoses(h.t.poses, h.poses)) moved++;
          const fault = capturedAt(h);
          if (fault && frameFault === null) frameFault = `loop tick to step ${step}: ${fault}`;
        }
      }
      expect({ mismatch, frameFault }).toEqual({ mismatch: null, frameFault: null });
      expect(step).toBe(ref.trace.length);
      expect(moved).toBeGreaterThan(100);
    },
    60_000,
  );

  /** A stretch of loop ticks at one game speed, each with or without beginFrame. */
  interface Stretch {
    speed: number;
    ticks: number;
    frame: boolean;
  }
  function* shrinkStretch(x: Stretch): Iterable<Stretch> {
    for (const ticks of shrinkInt(x.ticks, 1)) yield { ...x, ticks };
    for (let speed = 0; speed < x.speed; speed++) yield { ...x, speed };
    if (x.frame) yield { ...x, frame: false };
  }

  it('3 trains under any mix of speeds, pauses and frames: every step is the 1x step', () => {
    const ref = reference(3, false);
    forAll(
      (rng): Stretch[] =>
        Array.from({ length: rng.int(1, 6) }, () => ({
          speed: rng.int(0, 3),
          ticks: rng.int(1, 400),
          frame: rng.chance(0.5),
        })),
      (stretches) => {
        resetModules();
        const s = buildTrafficScenario(3, false);
        const clock = new GameClock();
        let step = 0;
        let framed = false;
        for (const [n, { speed, ticks, frame }] of stretches.entries()) {
          clock.setSpeed(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]));
          for (let i = 0; i < ticks && step < ref.trace.length; i++) {
            if (frame) {
              s.fleet.beginFrame();
              framed = true;
            }
            const start = hold(s.fleet.trains);
            let last = null as Held[] | null;
            clock.run((gdt) => {
              if (step >= ref.trace.length) return;
              last = hold(s.fleet.trains);
              s.step(gdt, clock.time);
              const got = simState(s, clock.time);
              if (got !== ref.trace[step])
                throw new Error(
                  `step ${step} at ${clock.time} s: ${firstDifference(ref.trace[step], got)}`,
                );
              step++;
            });
            // Render capture: a framed loop tick keeps its start poses; a fleet never framed
            // captures at each step; a framed fleet that skips beginFrame captures nothing.
            const [held, rule]: [Held[], (h: Held) => string | null] = frame
              ? [start, capturedAt]
              : !framed && last
                ? [last, capturedAt]
                : [start, untouched];
            for (const h of held) {
              if (h.t.reversed !== h.reversed) continue;
              const fault = rule(h);
              if (fault) throw new Error(`stretch ${n}, loop tick ${i}: ${fault}`);
            }
          }
        }
      },
      {
        seeds: SEEDS.slice(0, 10),
        shrink: (stretches) => shrinkArray(stretches, shrinkStretch),
        shrinkBudget: 200,
      },
    );
  }, 120_000);
});
