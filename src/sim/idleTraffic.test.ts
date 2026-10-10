import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../engine/iso';
import type { TrackKind } from '../world/track';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { sharedTiles } from '../testing/trafficScenario';
import { Train, defaultStop, resetTrainIds, type RouteMode, type StopPlan } from './trains';
import { resetStationIds, type Station } from './stations';
import { locoDef, wagonDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { setSeasonOffset } from './weather';
import { STR } from '../strings';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds();
  resetStationIds();
});

/** Row of the main line. */
const ROW = 30;
const GDT = 0.05;
/** Each case steps a few thousand ticks: a second or two alone, far longer on a loaded runner. */
const SLOW = { timeout: 60_000 };
/** Longest a train may stand behind an idle train before it moves off: well under the 4 s grace. */
const HELD_AT_MOST = 2;
/** The notes an idle train may show: none, or one about making way. */
const IDLE_NOTES: string[] = [
  '',
  STR.traffic.madeWay,
  STR.traffic.waitAside,
  STR.traffic.noWayAside,
  STR.traffic.replan,
];

/** Lays a piece through the builder, free of cost and region, as the game would. */
function lay(w: SimWorld, x: number, y: number, kind: TrackKind, rot: number) {
  w.builder.free = true;
  const ok = w.builder.placeTrack(x, y, { kind, cls: 'regular' }, rot);
  w.builder.free = false;
  if (!ok) throw new Error(`no ${kind} at ${x},${y}`);
}
/** Six tiles of dead-end siding running south from (x, y). */
function siding(w: SimWorld, x: number, y: number) {
  for (let sy = y; sy < y + 6; sy++) lay(w, x, sy, 'straight', 0);
}

/**
 * A terminus line: the main line along ROW from x 4 to 40, a warehouse at its west end (platform
 * x 5) and a quarry at its dead east end (platform x 40). A switch at x 20, its throat facing
 * east, leads into a siding south of the line.
 */
function terminus() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  lay(w, 20, ROW, 'switch', 1);
  siding(w, 20, ROW + 2);
  line(w, 4, ROW, 19);
  line(w, 22, ROW, 40);
  const west = station(w, 'warehouse', 5, ROW - 1);
  const end = station(w, 'quarry', 40, ROW - 1);
  return { w, west, end };
}

/**
 * A through station: the main line along ROW from x 4 to 56 with a quarry beside it at x 30 and
 * a warehouse at x 50. Past the quarry a switch at x 36, its throat facing west, leads into a
 * siding south of the line.
 */
function through() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  lay(w, 36, ROW, 'switch', 7);
  siding(w, 37, ROW + 2);
  line(w, 4, ROW, 35);
  line(w, 38, ROW, 56);
  const mid = station(w, 'quarry', 30, ROW - 1);
  const east = station(w, 'warehouse', 50, ROW - 1);
  return { w, mid, east };
}

/** An F7 diesel and a hopper standing on the main line with its head at x, tanks full. */
function train(w: SimWorld, x: number, east: boolean, mode: RouteMode, stops: StopPlan[]) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  expect(t.spawnAt(w.track, x, ROW, east ? Dir.W : Dir.E)).toBe(true);
  t.oil = t.oilCap;
  t.mode = mode;
  t.schedule = stops;
  w.fleet.trains.push(t);
  return t;
}
/** A stop where the train calls and moves on without waiting for full wagons. */
function call(s: Station, load: 'auto' | 'none' = 'auto'): StopPlan {
  return { ...defaultStop(s.id), waitFull: false, load };
}
/** Head for the current stop as the fleet sends a train off. */
function go(w: SimWorld, t: Train) {
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  t.onPathReady({ builder: w.builder });
}

/**
 * Steps the fleet as the game does and watches every step: no two trains on one tile, no station
 * with more trains on its platforms than it has, no idle train holding a platform or showing a
 * note about anything but making way, and how long each train stood held behind an idle train.
 */
function run(w: SimWorld) {
  let now = 0;
  const arrivals = new Map<number, number[]>();
  const next = w.fleet.onArrive;
  w.fleet.onArrive = (t, s) => {
    arrivals.set(t.id, [...(arrivals.get(t.id) ?? []), s.id]);
    next?.(t, s);
  };
  const holding = new Map<number, number>();
  const heldByIdle = new Map<number, number>();
  let broken: string | null = null;
  const check = (): string | null => {
    const at = `${now.toFixed(2)} s`;
    const shared = sharedTiles(w.fleet.trains, w.track.w);
    if (shared.length) return `${at}: trains share tiles ${JSON.stringify(shared)}`;
    for (const s of w.builder.stations) {
      if (s.occupants.size > s.platforms) return `${at}: ${s.name} has too many trains`;
      for (const id of s.occupants)
        if (w.fleet.byId(id)?.state === 'idle') return `${at}: idle #${id} holds ${s.name}`;
    }
    for (const t of w.fleet.trains) {
      if (t.state === 'idle' && !IDLE_NOTES.includes(t.lastMessage))
        return `${at}: idle ${t.name} says "${t.lastMessage}"`;
      if (t.makingWay && t.lastMessage !== STR.traffic.makingWay)
        return `${at}: ${t.name} makes way saying "${t.lastMessage}"`;
    }
    return null;
  };
  const step = () => {
    w.fleet.tick(GDT, (now += GDT));
    for (const t of w.fleet.trains) {
      const by = t.blocked && t.blockedBy !== null ? w.fleet.byId(t.blockedBy) : undefined;
      const held = by?.state === 'idle' ? (holding.get(t.id) ?? 0) + GDT : 0;
      holding.set(t.id, held);
      heldByIdle.set(t.id, Math.max(heldByIdle.get(t.id) ?? 0, held));
    }
    broken ??= check();
  };
  return {
    get now() {
      return now;
    },
    get broken() {
      return broken;
    },
    arrivals: (t: Train) => arrivals.get(t.id) ?? [],
    /** the longest a train stood held behind a train that was idle, seconds */
    heldByIdle: (t: Train) => heldByIdle.get(t.id) ?? 0,
    /** Steps until `done` holds, for at most `seconds`; returns whether it does. */
    until(done: () => boolean, seconds: number) {
      for (let i = 0; i < seconds / GDT && !done(); i++) step();
      return done();
    },
    ticks(seconds: number) {
      for (let i = 0; i < seconds / GDT; i++) step();
    },
    counters: () => w.fleet.traffic.counters,
  };
}
type Run = ReturnType<typeof run>;

/** A roaming train that went to `stop` and found nothing worth hauling anywhere. */
function idleAt(w: SimWorld, sim: Run, x: number, stop: Station) {
  const t = train(w, x, true, 'production', [defaultStop(stop.id)]);
  go(w, t);
  expect(
    sim.until(() => t.state === 'idle', 60),
    `${t.name} never idled`,
  ).toBe(true);
  expect(t.atStation).toBe(stop);
  return t;
}

/** No overlap, no deadlock and nobody stuck in the whole run, and every watched step was sound. */
function expectSound(sim: Run) {
  expect(sim.broken).toBeNull();
  const { overlaps, deadlocks, stuck } = sim.counters();
  expect({ overlaps, deadlocks, stuck }).toEqual({ overlaps: 0, deadlocks: 0, stuck: 0 });
}

describe('an idle train with nothing worth hauling', () => {
  for (const from of [8, 30])
    it(
      `at a terminus makes way for a train that calls there (it sets off at x ${from})`,
      SLOW,
      () => {
        const { w, west, end } = terminus();
        const sim = run(w);
        const idle = idleAt(w, sim, 34, end);
        // from x 30 the caller already stands between the siding and the idle train
        const caller = train(w, from, true, 'schedule', [call(end), call(west)]);
        go(w, caller);
        const calls = () => sim.arrivals(caller).filter((id) => id === end.id).length;
        expect(
          sim.until(() => calls() >= 1, 150),
          `the caller never reached ${end.name}`,
        ).toBe(true);
        // and the line stays clear: the caller keeps running its loop past the parked train
        expect(
          sim.until(() => calls() >= 3, 400),
          'the caller stopped running its loop',
        ).toBe(true);
        expect(idle.state).toBe('idle');
        expect(idle.lastMessage).toBe(STR.traffic.madeWay);
        expectSound(sim);
      },
    );

  it(
    'at a terminus leaves the station its platform: a train on its other road loads there',
    SLOW,
    () => {
      // the quarry's west road ends at the platform south of it, a second road from the north ends
      // at the platform east of it; the quarry has one platform for both
      const w = simWorld({ terrain: 'grass', size: 64 });
      line(w, 4, ROW, 30);
      for (let y = ROW - 8; y <= ROW - 1; y++) lay(w, 31, y, 'straight', 0);
      const end = station(w, 'quarry', 30, ROW - 1);
      const north = station(w, 'warehouse', 32, ROW - 7);
      expect(end.platforms).toBe(1);
      const sim = run(w);
      const idle = idleAt(w, sim, 24, end);
      const t = new Train([{ uid: 3, level: 1, def: locoDef('f7') }]);
      expect(t.spawnAt(w.track, 31, ROW - 6, Dir.N)).toBe(true);
      t.oil = t.oilCap;
      t.schedule = [call(end), call(north)];
      w.fleet.trains.push(t);
      go(w, t);
      expect(
        sim.until(() => t.state === 'loading' && t.atStation === end, 60),
        `the second train is ${t.state}`,
      ).toBe(true);
      // the idle train was in nobody's way, so it stayed where it stood
      expect(idle.state).toBe('idle');
      expect(idle.atStation).toBe(end);
      expectSound(sim);
    },
  );

  for (const { from, first } of [
    { from: 12, first: 'east' },
    { from: 25, first: 'east' },
    { from: 12, first: 'mid' },
  ] as const)
    it(
      `on a through station track makes way for the train behind it (from x ${from}, to ${first})`,
      SLOW,
      () => {
        const { w, mid, east } = through();
        const sim = run(w);
        const idle = idleAt(w, sim, 24, mid);
        const stops = first === 'east' ? [call(east), call(mid)] : [call(mid), call(east)];
        const behind = train(w, from, true, 'schedule', stops);
        go(w, behind);
        const loops = () => sim.arrivals(behind).length;
        expect(
          sim.until(() => loops() >= 4, 400),
          'the train behind stopped running',
        ).toBe(true);
        // it was never held behind the idle train for longer than the idle train took to move off
        expect(sim.heldByIdle(behind)).toBeLessThanOrEqual(HELD_AT_MOST);
        // which then stayed parked out of the way rather than going back where it stood
        expect(idle.state).toBe('idle');
        expect(idle.atStation).toBeNull();
        expect(idle.lastMessage).toBe(STR.traffic.madeWay);
        expectSound(sim);
      },
    );

  it('takes up work again when cargo turns up where it stands', SLOW, () => {
    const { w, west, end } = terminus();
    const sim = run(w);
    const idle = idleAt(w, sim, 34, end);
    sim.ticks(30);
    expect(idle.state).toBe('idle');
    end.store('stone', 40);
    expect(
      sim.until(() => idle.totalCargo() > 0, 30),
      'it never loaded',
    ).toBe(true);
    expect(
      sim.until(() => west.stored('stone') > 0, 120),
      'it never delivered',
    ).toBe(true);
    expectSound(sim);
  });

  it('takes up work again from the siding it made way into', SLOW, () => {
    const { w, west, end } = terminus();
    const sim = run(w);
    const idle = idleAt(w, sim, 34, end);
    const caller = train(w, 8, true, 'schedule', [call(end, 'none'), call(west, 'none')]);
    go(w, caller);
    // the caller calls at the quarry, goes back and leaves service
    expect(sim.until(() => sim.arrivals(caller).join() === [end.id, west.id].join(), 200)).toBe(
      true,
    );
    w.fleet.recall(caller);
    // it waits off the line, clear of the quarry's platform
    const platform = w.builder.platformTiles(end).map((p) => p.y * w.track.w + p.x);
    expect(idle.occupancyKeys(w.track.w).some((k) => platform.includes(k))).toBe(false);
    expect(idle.lastMessage).toBe(STR.traffic.madeWay);
    end.store('stone', 40);
    expect(
      sim.until(() => idle.totalCargo() > 0, 120),
      'it never loaded',
    ).toBe(true);
    expect(
      sim.until(() => west.stored('stone') > 0, 120),
      'it never delivered',
    ).toBe(true);
    expectSound(sim);
  });

  it('with nowhere to move aside to, says so and holds no platform', SLOW, () => {
    // a single line between two termini: nowhere to pass
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const west = station(w, 'warehouse', 5, ROW - 1);
    const end = station(w, 'quarry', 40, ROW - 1);
    const sim = run(w);
    const idle = idleAt(w, sim, 34, end);
    const caller = train(w, 8, true, 'schedule', [call(end), call(west)]);
    go(w, caller);
    sim.ticks(20);
    expect(end.occupants.size).toBe(0);
    expect(idle.state).toBe('idle');
    expect(idle.lastMessage).toBe(STR.traffic.noWayAside);
    expect(sim.broken).toBeNull();
  });
});
