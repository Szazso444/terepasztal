import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameClock, SIM_STEP, SPEEDS } from './time';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Train, resetTrainIds } from './trains';
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
import { buildTrafficScenario, SCENARIO_MAX_TICKS } from '../testing/trafficScenario';

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
    const { fleet, t } = f7Run();
    let now = 0;
    const tick = () => fleet.tick(SIM_STEP, (now += SIM_STEP));
    while (t.speed === 0 && now < 30) tick();
    tick();
    expect(t.speed).toBeGreaterThan(0);
    return { fleet, t, tick };
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
});
