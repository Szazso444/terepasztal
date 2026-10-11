import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import type { TrackKind } from '../world/track';
import { findPath, type PathSegment } from '../world/pathfinding';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { sharedTiles } from '../testing/trafficScenario';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { blockingGroups } from './recovery';
import {
  Train,
  defaultStop,
  resetTrainIds,
  type RouteMode,
  type StopPlan,
  type TickCtx,
  type RetreatPlan,
  type AsideSpots,
} from './trains';
import { Station, resetStationIds } from './stations';
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
 * The game clock starts at `from`: 0 for a new world, the save's time for a loaded one.
 */
function run(w: SimWorld, from = 0) {
  let now = from;
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

describe('a train left with no way on', () => {
  it(
    'behind an idle train with nowhere to move aside to, is a counted jam and says so until it clears',
    SLOW,
    () => {
      // a single line between two termini: nowhere to pass
      const w = simWorld({ terrain: 'grass', size: 64 });
      line(w, 4, ROW, 40);
      const west = station(w, 'warehouse', 5, ROW - 1);
      const end = station(w, 'quarry', 40, ROW - 1);
      const sim = run(w);
      const idle = idleAt(w, sim, 34, end);
      const caller = train(w, 8, true, 'schedule', [call(end), call(west)]);
      go(w, caller);
      expect(
        sim.until(() => caller.lastMessage === STR.traffic.jammed, 60),
        `the caller says "${caller.lastMessage}"`,
      ).toBe(true);
      expect(sim.counters().deadlocks).toBeGreaterThan(0);
      expect(caller.state).toBe('moving');
      // it keeps saying so for as long as it stands there, whatever else it tries meanwhile
      expect(sim.until(() => caller.lastMessage !== STR.traffic.jammed, 60)).toBe(false);
      // the idle train leaves service: the line is clear, and the note goes with the jam
      w.fleet.recall(idle);
      expect(
        sim.until(() => sim.arrivals(caller).includes(end.id), 60),
        'the caller never reached the quarry',
      ).toBe(true);
      expect(caller.lastMessage).not.toBe(STR.traffic.jammed);
      expect(sim.broken).toBeNull();
    },
  );

  it(
    'where it pulled aside, says it has no track on to its stop, and drops that once it sets off',
    SLOW,
    () => {
      // the line to the quarry has a gap at x 20: the track was taken up after the train pulled aside
      const w = simWorld({ terrain: 'grass', size: 64 });
      line(w, 4, ROW, 19);
      line(w, 21, ROW, 40);
      const west = station(w, 'warehouse', 5, ROW - 1);
      const end = station(w, 'quarry', 40, ROW - 1);
      const sim = run(w);
      const t = train(w, 12, true, 'schedule', [call(end), call(west)]);
      t.state = 'yielding';
      t.lastMessage = STR.traffic.pullingAside;
      sim.ticks(3);
      expect(t.state).toBe('yielding');
      expect(t.lastMessage).toBe(STR.traffic.noWayOn);
      // the gap is closed: it sets off, and no longer says anything about pulling aside
      lay(w, 20, ROW, 'straight', 1);
      expect(sim.until(() => t.state !== 'yielding', 5)).toBe(true);
      expect(t.lastMessage).toBe('');
      expect(
        sim.until(() => sim.arrivals(t).includes(end.id), 60),
        'it never reached the quarry',
      ).toBe(true);
      expect(sim.broken).toBeNull();
    },
  );
});

// ------------------------------------------------------------------ a save and load

/**
 * Save `w`'s trains and stations as the game saves them, and load them into the world `scene`
 * lays afresh: the same track and stations, the stations' state and the trains read back from
 * JSON, as a load builds the world before it reads the trains.
 */
function reload(w: SimWorld, scene: () => SimWorld): SimWorld {
  const text = JSON.stringify({
    trains: w.fleet.trains.map((t) => t.toJSON()),
    stations: w.builder.stations.map((s) => s.toJSON()),
  });
  const j = JSON.parse(text) as {
    trains: ReturnType<Train['toJSON']>[];
    stations: ReturnType<Station['toJSON']>[];
  };
  const back = scene();
  const stations = j.stations.map((s) => Station.fromJSON(s));
  back.builder.stations.splice(0, back.builder.stations.length, ...stations);
  back.fleet.trains = j.trains.map((t) => Train.fromJSON(t, back.track));
  return back;
}
/** The farthest any car of `a` stands from the same car of `b`, in tiles. */
function apart(a: Train, b: Train) {
  expect(b.poses.length).toBe(a.poses.length);
  return Math.max(...a.poses.map((p, i) => Math.hypot(p.x - b.poses[i].x, p.y - b.poses[i].y)));
}

describe('an idle train saved and loaded', () => {
  it('saved on its way aside, idles where the way ends, as it does never saved', SLOW, () => {
    const { w, west, end } = terminus();
    const sim = run(w);
    const idle = idleAt(w, sim, 34, end);
    const caller = train(w, 8, true, 'schedule', [call(end), call(west)]);
    go(w, caller);
    expect(
      sim.until(() => idle.makingWay, 10),
      'it never made way',
    ).toBe(true);
    sim.ticks(1);
    const back = reload(w, () => terminus().w);
    const again = run(back, sim.now);
    const [idleBack, callerBack] = back.fleet.trains;
    expect(idleBack.makingWay, 'loaded on its way aside').toBe(true);
    expect(idleBack.lastMessage).toBe(STR.traffic.makingWay);
    // both run on side by side: the loaded one never waits to go back where it stood
    const states = new Set<string>();
    for (let i = 0; i < 60 / GDT; i++) {
      sim.ticks(GDT);
      again.ticks(GDT);
      states.add(idleBack.state);
    }
    expect([...states].sort()).toEqual(['idle', 'moving']);
    for (const [a, b] of [
      [idle, idleBack],
      [caller, callerBack],
    ] as const) {
      expect(b.state, b.name).toBe(a.state);
      expect(apart(a, b), `${b.name}: tiles from where it stands never saved`).toBeLessThan(0.01);
    }
    expect(idleBack.lastMessage).toBe(STR.traffic.madeWay);
    expect(back.builder.stationById(end.id)!.occupants.has(idleBack.id)).toBe(false);
    expectSound(sim);
    expectSound(again);
  });

  it(
    'saved as a train comes into its way, moves aside on the tick it would never saved',
    SLOW,
    () => {
      // The fleet looks for idle trains in the way on the quarter seconds of the game clock, which
      // the save holds, so a load does not move the next look. Saved on any tick before or after
      // that look, the loaded train sets off aside on the tick the train never saved does.
      for (let saveAfter = 0; saveAfter < 8; saveAfter++) {
        const { w, west, end } = terminus();
        const sim = run(w);
        const idle = idleAt(w, sim, 34, end);
        const caller = train(w, 8, true, 'schedule', [call(end), call(west)]);
        go(w, caller);
        for (let i = 0; i <= saveAfter; i++) sim.ticks(GDT);
        const back = reload(w, () => terminus().w);
        const again = run(back, sim.now);
        const [idleBack, callerBack] = back.fleet.trains;
        const label = `saved ${saveAfter + 1} ticks after the caller set off`;
        let setOff: number | null = idle.makingWay ? -1 : null;
        let setOffBack: number | null = idleBack.makingWay ? -1 : null;
        for (let i = 0; i < 60 / GDT; i++) {
          sim.ticks(GDT);
          again.ticks(GDT);
          if (setOff === null && idle.makingWay) setOff = i;
          if (setOffBack === null && idleBack.makingWay) setOffBack = i;
        }
        expect(setOff, label).not.toBeNull();
        expect(setOffBack, label).toBe(setOff);
        for (const [a, b] of [
          [idle, idleBack],
          [caller, callerBack],
        ] as const) {
          expect(b.state, `${label}: ${b.name}`).toBe(a.state);
          expect(apart(a, b), `${label}: ${b.name}`).toBeLessThan(0.01);
        }
        expectSound(again);
      }
    },
  );

  it('loaded standing idle at its station, stands there holding no platform', SLOW, () => {
    const { w, end } = terminus();
    const sim = run(w);
    const idle = idleAt(w, sim, 34, end);
    sim.ticks(3);
    const back = reload(w, () => terminus().w);
    const again = run(back, sim.now);
    const [idleBack] = back.fleet.trains;
    const quarry = back.builder.stationById(end.id)!;
    sim.ticks(GDT);
    again.ticks(GDT);
    expect(idleBack.state).toBe('idle');
    expect(idleBack.atStation).toBe(quarry);
    expect([...quarry.occupants]).toEqual([]);
    // past its next look where to go, it is where it would be never saved, holding nothing there
    sim.ticks(15);
    again.ticks(15);
    expect(idleBack.state).toBe(idle.state);
    expect(idleBack.atStation?.id).toBe(idle.atStation?.id);
    expect([...quarry.occupants]).toEqual([]);
    expectSound(sim);
    expectSound(again);
  });
});

// ------------------------------------------------------------------ one reversal partway

/**
 * A single line from x 4 to 56 with a warehouse at its west end (platform x 5). A switch at x 30,
 * its throat facing west, leads into a siding south of the line under x 31: a train heading west
 * cannot run straight into it.
 */
function shuntLine() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  lay(w, 30, ROW, 'switch', 7);
  siding(w, 31, ROW + 2);
  line(w, 4, ROW, 29);
  line(w, 32, ROW, 56);
  const west = station(w, 'warehouse', 5, ROW - 1);
  return { w, west };
}
/** The fleet's private members a move aside is planned with, as `Fleet.makeWay` plans it. */
interface FleetInside {
  ctx(now: number, speedFactor: number): TickCtx;
  sidingTiles(): Set<number>;
}
/** The private Train member that turns a consist round where it stands. */
interface Turning {
  reverseConsist(): void;
}

/**
 * An idle train with no stop (so any refuge leaves it no worse off) stands with its head at x 40,
 * heading west on `shuntLine`, in the way of a train coming from x 52 for the warehouse. Only a
 * shunt gets it aside, and after the first tick it sets off on one as the fleet sets a train off
 * aside (`planAside`, `Train.retreat`).
 */
function shuntScene() {
  const { w, west } = shuntLine();
  const sim = run(w);
  const idle = train(w, 40, false, 'schedule', []);
  idle.idle('');
  const caller = train(w, 52, false, 'schedule', [call(west)]);
  go(w, caller);
  sim.ticks(GDT);
  const fleet = w.fleet as unknown as FleetInside;
  const ctx = fleet.ctx(sim.now, 1);
  const wk = w.track.w;
  const spots = {
    theirs: caller.pathTileKeys(wk),
    bound: new Set(w.builder.platformTiles(west).map((p) => p.y * wk + p.x)),
    sidings: fleet.sidingTiles(),
  };
  expect(idle.planAside(ctx, [caller.id], spots), 'a way aside with no turn').toBeNull();
  const plan = idle.planAside(ctx, [caller.id], spots, false, true)!;
  expect(plan?.back, 'a shunt').toBeDefined();
  expect(idle.retreat(ctx, [caller.id], plan)).toBe(true);
  return { w, west, sim, idle, caller, plan };
}

describe('a train that reverses once partway', () => {
  it(
    'runs past the switch, turns at rest clear of it with no car moving, and backs into the siding',
    SLOW,
    () => {
      const { w, west, sim, idle, caller, plan } = shuntScene();
      // head first: the turn partway is the only one
      expect(plan.flip).toBe(false);
      const wk = w.track.w;
      const turns: { speed: number; onSwitch: number[]; moved: number }[] = [];
      const turning = idle as unknown as Turning;
      const reverse = turning.reverseConsist.bind(idle);
      turning.reverseConsist = () => {
        const before = idle.poses.map((p) => ({ ...p }));
        const onSwitch = idle.occupancyKeys(wk).filter((k) => {
          const p = w.track.get(k % wk, Math.floor(k / wk));
          return !p || p.links.length !== 1 || !!p.unit;
        });
        const speed = idle.speed;
        reverse();
        const moved = Math.max(
          ...idle.poses.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y)),
        );
        turns.push({ speed, onSwitch, moved });
      };
      const lease = () => w.fleet.traffic.recoveries.active.get(idle.id)?.tiles;
      let released: string | null = null;
      let parked: { state: string; note: string; x: number; y: number } | null = null;
      const done = sim.until(() => {
        // until it turns, every tile of the second leg stays its own
        if (idle.holding && !turns.length)
          for (const s of plan.back!)
            if (!lease()?.has(s.y * wk + s.x)) released ??= `(${s.x},${s.y}) at ${sim.now} s`;
        const { x, y } = idle.headTile!;
        if (!parked && !idle.holding) parked = { state: idle.state, note: idle.lastMessage, x, y };
        return !!parked && sim.arrivals(caller).includes(west.id);
      }, 120);
      expect(done, `${idle.name} ${idle.state} "${idle.lastMessage}"`).toBe(true);
      expect(released, 'a tile of the second leg let go before the turn').toBeNull();
      expect(turns).toEqual([{ speed: 0, onSwitch: [], moved: expect.closeTo(0, 6) }]);
      // it ends its move in the siding, saying it made way, and its lease goes with the move
      expect(parked).toMatchObject({ state: 'idle', note: STR.traffic.madeWay, x: 31 });
      expect(parked!.y).toBeGreaterThan(ROW + 1);
      expect(lease()).toBeUndefined();
      expectSound(sim);
    },
  );

  it('saved and loaded at any tick of its shunt, runs on as it does never saved', SLOW, () => {
    // the ticks it turns and ends its shunt on, never saved
    const { sim, idle } = shuntScene();
    let turn = -1;
    let end = -1;
    for (let i = 0; end < 0 && i < 60 / GDT; i++) {
      const was = idle.reversed;
      sim.ticks(GDT);
      if (idle.reversed !== was) turn = i;
      if (!idle.holding) end = i;
    }
    expect(turn, 'it never turned').toBeGreaterThan(0);
    expect(end, 'it never ended its shunt').toBeGreaterThan(turn);
    const saves = new Set([turn - 1, turn, turn + 1, end - 1]);
    for (let k = 0; k < end; k += 15) saves.add(k);
    for (const k of saves) {
      const { w, sim, idle, caller } = shuntScene();
      for (let i = 0; i <= k; i++) sim.ticks(GDT);
      const back = reload(w, () => shuntLine().w);
      const again = run(back, sim.now);
      const [idleBack, callerBack] = back.fleet.trains;
      const at = `saved after tick ${k} of the shunt (it turns on ${turn})`;
      expect(idleBack.holding, at).toBe(true);
      for (let i = 0; i < 40 / GDT; i++) {
        sim.ticks(GDT);
        again.ticks(GDT);
        for (const [a, b] of [
          [idle, idleBack],
          [caller, callerBack],
        ] as const) {
          const was = `${at}, ${b.name} ${i} ticks on`;
          expect([b.state, b.holding, b.reversed, b.lastMessage], was).toEqual([
            a.state,
            a.holding,
            a.reversed,
            a.lastMessage,
          ]);
          expect(apart(a, b), was).toBeLessThan(0.01);
        }
      }
      expect(idleBack.holding, at).toBe(false);
      expect(idleBack.headTile?.x, at).toBe(31);
      expectSound(again);
    }
  });

  it(
    'loaded with its second leg no longer laid, stops where it stands and lets its lease go',
    SLOW,
    () => {
      const { w, sim } = shuntScene();
      sim.ticks(1);
      const back = reload(w, () => {
        const fresh = shuntLine().w;
        fresh.builder.free = true;
        expect(fresh.builder.removeTrack(31, ROW + 3)).toBe(true);
        fresh.builder.free = false;
        return fresh;
      });
      const again = run(back, sim.now);
      const [idleBack] = back.fleet.trains;
      expect(idleBack.holding).toBe(true);
      again.ticks(GDT);
      expect([idleBack.state, idleBack.holding, idleBack.lastMessage]).toEqual([
        'idle',
        false,
        STR.traffic.replan,
      ]);
      expect(back.fleet.traffic.recoveries.active.size).toBe(0);
      expect(again.broken).toBeNull();
    },
  );
});

// ------------------------------------------------------------------ generated lines

/** A siding south of the main line: a switch block on x and x + 1 and dead-end track below it. */
interface GenSiding {
  /** the west column of the switch block */
  x: number;
  /**
   * The throat faces east (rot 1, the siding under x), so a train heading west turns into it; else
   * it faces west (rot 7, the siding under x + 1) and a train heading east does.
   */
  east: boolean;
  /** tiles of dead-end track */
  len: number;
}
/**
 * A passing loop south of the main line: a switch block on x and x + 1 with its throat facing
 * west, `len` tiles of loop track along ROW + 1, and a switch block with its throat facing east
 * after them. The builder lays both switches in their parallel form, so a train heading either
 * way runs into the loop without reversing and out of it at the other end.
 */
interface GenLoop {
  x: number;
  len: number;
}
type StopName = 'west' | 'quarry' | 'east';
/** A scheduled train on the main line with its head at x, heading east. */
interface GenCaller {
  x: number;
  wagons: number;
  stops: StopName[];
}
/**
 * The main line along ROW from x 4 to `end`, a warehouse with its platform at WEST, and a quarry
 * with its platform at `quarry`: at the dead east end (a terminus), or on the way to a second
 * warehouse at `end` (a through station). A roaming train idles at the quarry, and with `westIdle`
 * wagons another at the west warehouse; the callers run their schedules past them.
 */
interface GenLine {
  end: number;
  quarry: number;
  sidings: GenSiding[];
  loops: GenLoop[];
  idleWagons: number;
  westIdle: number;
  callers: GenCaller[];
}

/** The west warehouse's platform. */
const WEST = 5;
/** Tiles under an F7 with this many hoppers, on straight track. */
const tilesOf = (wagons: number) => wagons + 3;
/** The quarry stands at the dead east end of the line. */
const atEnd = (l: GenLine) => l.quarry === l.end;
/** Inclusive column spans on the main line. */
type Span = [number, number];
const meets = (a: Span, b: Span, gap = 0) => a[0] <= b[1] + gap && b[0] <= a[1] + gap;
const blockOf = (s: GenSiding): Span => [s.x, s.x + 1];
/** The main-line columns a loop's two switch blocks and its loop track take. */
const loopSpan = (o: GenLoop): Span => [o.x, o.x + o.len + 3];
/** Where track leaves the main line: every siding's switch block and every loop. */
const turnouts = (l: GenLine): Span[] => [...l.sidings.map(blockOf), ...l.loops.map(loopSpan)];
/** Every switch block on the main line. */
const switchBlocks = (l: GenLine): Span[] => [
  ...l.sidings.map(blockOf),
  ...l.loops.flatMap((o): Span[] => [
    [o.x, o.x + 1],
    [o.x + o.len + 2, o.x + o.len + 3],
  ]),
];
const platformsOf = (l: GenLine) => (atEnd(l) ? [WEST, l.quarry] : [WEST, l.quarry, l.end]);
const quarryIdleSpan = (l: GenLine): Span => [l.quarry - tilesOf(l.idleWagons) + 1, l.quarry];
const westIdleSpan = (l: GenLine): Span => [WEST, WEST + tilesOf(l.westIdle) - 1];
const callerSpan = (c: GenCaller): Span => [c.x - tilesOf(c.wagons) + 1, c.x];
const idleSpans = (l: GenLine) => [quarryIdleSpan(l), ...(l.westIdle ? [westIdleSpan(l)] : [])];

/** Track the builder can lay and the idle trains can stand on: turnouts clear of both. */
function validTrack(l: GenLine): boolean {
  if (l.end < 40 || l.end > 58) return false;
  if (!atEnd(l) && (l.quarry < 22 || l.quarry > l.end - 10)) return false;
  if (l.sidings.some((s) => s.len < 1) || l.loops.some((o) => o.len < 1)) return false;
  const spans = turnouts(l);
  for (const b of spans) {
    if (b[0] < 8 || b[1] > l.end - 2) return false;
    if (platformsOf(l).some((p) => meets(b, [p, p], 1))) return false;
    if (idleSpans(l).some((t) => meets(b, t, 1))) return false;
  }
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++) if (meets(spans[i], spans[j], 2)) return false;
  return true;
}
/** A valid track with at least one caller, each on plain main line clear of every other train. */
function valid(l: GenLine): boolean {
  if (!validTrack(l) || !l.callers.length) return false;
  const taken = idleSpans(l);
  for (const c of l.callers) {
    const span = callerSpan(c);
    if (span[0] < 6 || span[1] > l.end - 1 || c.stops.length < 2) return false;
    if (turnouts(l).some((b) => meets(span, b))) return false;
    if (platformsOf(l).some((p) => meets(span, [p, p]))) return false;
    if (taken.some((t) => meets(span, t, 1))) return false;
    if (c.stops.includes('east') && atEnd(l)) return false;
    taken.push(span);
  }
  return true;
}

/** A caller's two stops: the quarry and the west warehouse, or through the quarry to the east. */
function stopsFor(rng: Rng, l: GenLine): StopName[] {
  const pairs: StopName[][] = atEnd(l)
    ? [
        ['quarry', 'west'],
        ['west', 'quarry'],
      ]
    : [
        ['quarry', 'west'],
        ['west', 'quarry'],
        ['east', 'west'],
        ['west', 'east'],
        ['quarry', 'east'],
      ];
  return rng.pick(pairs);
}

/** Draws callers until one stands clear, or gives up after a few tries. */
function addCaller(rng: Rng, l: GenLine, xs: [number, number]): boolean {
  for (let i = 0; i < 40; i++) {
    const c: GenCaller = { x: rng.int(xs[0], xs[1]), wagons: rng.int(1, 2), stops: [] };
    c.stops = stopsFor(rng, l);
    if (valid({ ...l, callers: [...l.callers, c] })) {
      l.callers.push(c);
      return true;
    }
  }
  return false;
}

/**
 * Any line: none to two sidings, each facing either way and possibly too short to hold a train,
 * sometimes a passing loop, possibly too short too, one caller anywhere on the line, and sometimes
 * a second idle train at the west end. One caller only, so every pair of trains has an idle one
 * in it.
 */
function anyLine(rng: Rng): GenLine {
  for (;;) {
    const end = rng.int(40, 58);
    const l: GenLine = {
      end,
      quarry: rng.chance(0.5) ? end : rng.int(22, end - 10),
      sidings: [],
      loops: [],
      idleWagons: rng.int(1, 2),
      westIdle: rng.chance(0.3) ? rng.int(1, 2) : 0,
      callers: [],
    };
    if (!validTrack(l)) continue;
    for (let n = rng.int(0, 2), i = 0; l.sidings.length < n && i < 40; i++) {
      const s = { x: rng.int(8, end - 3), east: rng.chance(0.5), len: rng.int(3, 8) };
      if (validTrack({ ...l, sidings: [...l.sidings, s] })) l.sidings.push(s);
    }
    for (let i = 0, n = rng.chance(0.4) ? 1 : 0; l.loops.length < n && i < 40; i++) {
      const o = { x: rng.int(8, end - 6), len: rng.int(2, 9) };
      if (validTrack({ ...l, loops: [o] })) l.loops.push(o);
    }
    if (addCaller(rng, l, [8, end - 1]) && valid(l)) return l;
  }
}

/**
 * The idle train at the quarry has a way aside that needs no reversal along it, and the caller
 * cannot shut it in: one siding, long enough for the idle train, facing it; one caller, west of
 * the idle train. A siding behind the idle train (west of it, facing east) stands far enough from
 * the west platform for the caller to back off past its switch, should it stand between the two;
 * one ahead of it (east of a through station, facing west) has nobody between.
 */
function hasWayAside(l: GenLine): boolean {
  if (!valid(l) || l.sidings.length !== 1 || l.callers.length !== 1 || l.westIdle) return false;
  if (l.loops.length) return false;
  const [s] = l.sidings;
  const [c] = l.callers;
  const idle = quarryIdleSpan(l);
  if (s.len < tilesOf(l.idleWagons) + 2 || callerSpan(c)[1] > idle[0] - 2) return false;
  return s.east
    ? s.x >= WEST + tilesOf(c.wagons) + 5 && s.x + 1 <= idle[0] - 2
    : !atEnd(l) && s.x >= l.quarry + 2;
}

/** A line on which the idle train has a way aside (`hasWayAside`), at a terminus or not. */
function clearLine(rng: Rng): GenLine {
  for (;;) {
    const end = rng.int(40, 58);
    const quarry = rng.chance(0.5) ? end : rng.int(22, end - 10);
    const idleWagons = rng.int(1, 2);
    const callerWagons = rng.int(1, 2);
    const len = tilesOf(idleWagons) + rng.int(2, 4);
    const ahead = quarry < end && rng.chance(0.5);
    const [lo, hi] = ahead
      ? [quarry + 2, end - 4]
      : [WEST + tilesOf(callerWagons) + 5, quarry - tilesOf(idleWagons) - 3];
    if (lo > hi) continue;
    const l: GenLine = {
      end,
      quarry,
      sidings: [{ x: rng.int(lo, hi), east: !ahead, len }],
      loops: [],
      idleWagons,
      westIdle: 0,
      callers: [],
    };
    if (!validTrack(l)) continue;
    const before = quarryIdleSpan(l)[0] - 2;
    for (let i = 0; i < 40 && !l.callers.length; i++) {
      const c = { x: rng.int(8, before), wagons: callerWagons, stops: stopsFor(rng, l) };
      if (hasWayAside({ ...l, callers: [c] })) l.callers.push(c);
    }
    if (l.callers.length) return l;
  }
}

/**
 * The idle train at the quarry has a passing loop to pull into and the caller cannot shut it in:
 * one loop, long enough for the idle train, between the caller and the idle train or past the
 * quarry of a through station; one caller, west of both.
 */
function hasLoopAside(l: GenLine): boolean {
  if (!valid(l) || l.loops.length !== 1 || l.sidings.length || l.callers.length !== 1) return false;
  if (l.westIdle) return false;
  const [o] = l.loops;
  const [c] = l.callers;
  const idle = quarryIdleSpan(l);
  const span = loopSpan(o);
  if (o.len < tilesOf(l.idleWagons) + 2 || callerSpan(c)[1] > Math.min(span[0], idle[0]) - 2)
    return false;
  return span[1] <= idle[0] - 2 || (!atEnd(l) && span[0] >= l.quarry + 2);
}

/** A line on which the idle train has a passing loop to pull into (`hasLoopAside`). */
function loopLine(rng: Rng): GenLine {
  for (;;) {
    const end = rng.int(40, 58);
    const quarry = rng.chance(0.5) ? end : rng.int(22, end - 10);
    const idleWagons = rng.int(1, 2);
    const len = tilesOf(idleWagons) + rng.int(2, 5);
    const ahead = quarry < end && rng.chance(0.5);
    const [lo, hi] = ahead
      ? [quarry + 2, end - len - 5]
      : [WEST + 8, quarry - tilesOf(idleWagons) - len - 4];
    if (lo > hi) continue;
    const l: GenLine = {
      end,
      quarry,
      sidings: [],
      loops: [{ x: rng.int(lo, hi), len }],
      idleWagons,
      westIdle: 0,
      callers: [],
    };
    if (!validTrack(l)) continue;
    const before = Math.min(loopSpan(l.loops[0])[0], quarryIdleSpan(l)[0]) - 2;
    for (let i = 0; i < 40 && !l.callers.length; i++) {
      const c = { x: rng.int(8, before), wagons: rng.int(1, 2), stops: stopsFor(rng, l) };
      if (hasLoopAside({ ...l, callers: [c] })) l.callers.push(c);
    }
    if (l.callers.length) return l;
  }
}

/**
 * Smaller lines that are still `ok` (valid by default): fewer sidings, loops and callers, fewer
 * wagons, shorter sidings and loops.
 */
function* shrinkLine(l: GenLine, ok = valid): Iterable<GenLine> {
  const out: GenLine[] = [];
  for (const sidings of shrinkArray(l.sidings)) out.push({ ...l, sidings });
  for (const loops of shrinkArray(l.loops)) out.push({ ...l, loops });
  l.loops.forEach((o, i) => {
    for (const len of shrinkInt(o.len, 1))
      out.push({ ...l, loops: l.loops.map((d, j) => (j === i ? { ...d, len } : d)) });
  });
  for (const callers of shrinkArray(l.callers)) out.push({ ...l, callers });
  if (l.westIdle) out.push({ ...l, westIdle: 0 });
  for (const idleWagons of shrinkInt(l.idleWagons, 1)) out.push({ ...l, idleWagons });
  l.callers.forEach((c, i) => {
    for (const wagons of shrinkInt(c.wagons, 1))
      out.push({ ...l, callers: l.callers.map((d, j) => (j === i ? { ...d, wagons } : d)) });
  });
  l.sidings.forEach((s, i) => {
    for (const len of shrinkInt(s.len, 1))
      out.push({ ...l, sidings: l.sidings.map((d, j) => (j === i ? { ...d, len } : d)) });
  });
  for (const c of out) if (ok(c)) yield c;
}

/** Lays a generated line and its stations. */
function layLine(l: GenLine) {
  const w = simWorld({ terrain: 'grass', size: 64 });
  // every switch block on the main line, west to east: (x, rot)
  const blocks: [number, number][] = [
    ...l.sidings.map((s): [number, number] => [s.x, s.east ? 1 : 7]),
    ...l.loops.flatMap((o): [number, number][] => [
      [o.x, 7],
      [o.x + o.len + 2, 1],
    ]),
  ].sort((a, b) => a[0] - b[0]);
  let from = 4;
  for (const [x, rot] of blocks) {
    lay(w, x, ROW, 'switch', rot);
    if (x - 1 >= from) line(w, from, ROW, x - 1);
    from = x + 2;
  }
  line(w, from, ROW, l.end);
  for (const s of l.sidings)
    for (let y = ROW + 2; y < ROW + 2 + s.len; y++)
      lay(w, s.east ? s.x : s.x + 1, y, 'straight', 0);
  for (const o of l.loops) {
    line(w, o.x + 2, ROW + 1, o.x + o.len + 1);
    // the loop track beside them bends both switches' branches into it
    for (const x of [o.x, o.x + o.len + 2])
      expect(w.track.get(x, ROW)!.form, `the switch at ${x} leads into the loop`).toBe('parallel');
  }
  const stations: Record<StopName, Station | null> = {
    west: station(w, 'warehouse', WEST, ROW - 1),
    quarry: station(w, 'quarry', l.quarry, ROW - 1),
    east: atEnd(l) ? null : station(w, 'warehouse', l.end, ROW - 1),
  };
  return { w, stations };
}

/** An F7 and `wagons` hoppers with full tanks, its head at x on the main line. */
function consist(w: SimWorld, x: number, east: boolean, wagons: number) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = Array.from({ length: wagons }, (_, i) => ({
    uid: 2 + i,
    def: wagonDef('wood_hopper'),
    level: 1,
    cargo: null,
    amount: 0,
    origin: null,
  }));
  expect(t.spawnAt(w.track, x, ROW, east ? Dir.W : Dir.E)).toBe(true);
  t.oil = t.oilCap;
  w.fleet.trains.push(t);
  return t;
}

/** The notes that say an idle train stands in another train's way. */
const IN_THE_WAY: string[] = [STR.traffic.waitAside, STR.traffic.noWayAside];
/** Longest an idle train may stand in another train's way before it moves or says so. */
const SAY_IN_WAY = 3;
/** Longest an idle train may keep saying it is in the way after nobody needs its track. */
const SAY_CLEAR = 0.5;
/** The notes that say a train has no way on: held in a jam none of its trains can clear, or cut off. */
const NO_WAY_ON: string[] = [STR.traffic.jammed, STR.traffic.noWayOn];
/** States the train panel names as having no way on ('No route', stranded off the track). */
const NO_WAY_STATES: string[] = ['noRoute', 'stranded'];
/**
 * Longest a train that is not idle may stand (its head within STOOD of where it stopped, not
 * loading) with no deadlock counted against it and neither a note nor a state saying it has no way
 * on: past the 90 s a yielding train gives the line before it sets off anyway.
 */
const STALL = 120;
/** Tiles a train's head may move and still stand where it stood, as the jam note counts it. */
const STOOD = 0.5;
/** Seconds a yielding train's note may lag a change of track: it looks again every 2 s. */
const NOTE_LAG = 2 + 2 * GDT;

/** A train as it stood before a step. */
interface Before {
  state: string;
  x: number;
  y: number;
  holding: boolean;
  atStation: number | null;
  stop: number | null;
  ends: PathSegment[];
}
/** The private Train member a refuge search starts from when the train backs off rear first. */
interface Reversible {
  reversedTrail(): { trail: { seg: PathSegment }[] };
}
/** The private Train member that holds a shunt's second leg until the train turns to run it. */
interface Shunting {
  shunt: PathSegment[] | null;
}
/** Where a train's head and rear stand, as the states it would set off from, either end first. */
function endsOf(t: Train): PathSegment[] {
  const rear = (t as unknown as Reversible).reversedTrail().trail.at(-1)?.seg;
  return [t.headSeg, rear].filter((s): s is PathSegment => !!s);
}
/** The station a train is bound for next: its fuel detour, else its stop. */
function nextStop(t: Train): number | null {
  return t.detour ?? (t.route.length ? t.route[t.routeIndex % t.route.length] : null);
}
/**
 * The oracle for a way on to `stationId`: from a state on one of its platforms, or with a way there
 * that never reverses, as findPath finds it for the consist on the bare track.
 */
function wayTo(w: SimWorld, t: Train, stationId: number) {
  const s = w.builder.stationById(stationId);
  const wk = w.track.w;
  const plat = new Set((s ? w.builder.platformTiles(s) : []).map((p) => p.y * wk + p.x));
  const isStop = (x: number, y: number) => plat.has(y * wk + x);
  return (from: { x: number; y: number; in: Dir }) =>
    isStop(from.x, from.y) ||
    findPath(w.track, from, isStop, Infinity, undefined, t.canUse) !== null;
}
/**
 * Whether train `t`, stopped with its head at the centre of the last tile of `way`, can go on from
 * there, head first or rear first. Its cars are put there as the game puts a train (`spawnAt`, back
 * along the track, which on a refuge is the way itself), and each end sets off as `dispatch` sets
 * off (`endsOf`), so a rear end on a tile edge sets off from the tile beyond it.
 */
function wayOnFrom(
  w: SimWorld,
  way: readonly PathSegment[],
  t: Train,
  to: (from: { x: number; y: number; in: Dir }) => boolean,
) {
  const last = way[way.length - 1];
  if (!last) return false;
  const locos = t.locos.map((l) => ({ uid: l.uid, level: l.level, def: l.def }));
  const there = new Train(locos, 'There', t.id);
  there.wagons = t.wagons.map((car) => ({ ...car }));
  if (!there.spawnAt(w.track, last.x, last.y, last.in)) return false;
  return endsOf(there).some(to);
}

/**
 * The oracle for the jam resolution's give-ways (`Train.gaveWay`), as `traffic-current.md` §5
 * states the rule: a working train backed off in a jam for train `other` is kept back when the
 * train it last backed off for in a jam was `other` and it has reached no stop since. A train with
 * no stop, or making way, is never kept back and its move counts for nothing. What a train last
 * gave way to is not saved (§8), so a loaded game starts with none, as this oracle does.
 *
 * `follow(t)` wraps a train's `gaveWay` once; `arrived(t)` is told each stop it reaches; `broken`
 * is the first give-way that broke the rule, and `keptAt(t)` when the train was last kept back.
 */
function keptBackRule() {
  const wrapped = new WeakSet<Train>();
  /** the train each one last gave way to in a jam, since the last stop it reached */
  const last = new Map<number, number>();
  const keptAt = new Map<number, number>();
  let broken: string | null = null;
  return {
    follow(t: Train, clock: () => number) {
      if (wrapped.has(t)) return;
      wrapped.add(t);
      const own = t.gaveWay.bind(t);
      t.gaveWay = (other: number) => {
        const counts = t.holding && !t.makingWay && t.route.length > 0;
        const before = last.get(t.id);
        const expected = counts && before === other;
        const got = own(other);
        if (counts) last.set(t.id, other);
        if (got) keptAt.set(t.id, clock());
        if (got !== expected)
          broken ??= `at ${clock().toFixed(2)} s #${t.id} gave way to #${other} ${got ? '' : 'not '}kept back, where the train it last gave way to since its last stop was ${before === undefined ? 'none' : `#${before}`}`;
        return got;
      };
    },
    arrived(t: Train) {
      last.delete(t.id);
    },
    broken: () => broken,
    keptAt: (t: Train) => keptAt.get(t.id),
  };
}

/**
 * Steps the fleet as the game does and checks after every step what must hold whatever the line:
 * no two trains on one tile; no station with more trains on its platforms than it has, nor an idle
 * one among them; an idle train has no path ahead, never moves, and claims no tile but those under
 * its cars; a train making way says so; and an idle train says it is in the way only while another
 * train's route crosses its tiles, and says so within SAY_IN_WAY seconds of standing there.
 *
 * And for every train, idle or not: it pulls aside only to where it has a way on to the station it
 * is bound for (an idle one, back to the station it stood at) if it had one where it stood; it is
 * never left standing longer than STALL with no deadlock counted against it and no note that says
 * it has no way on; and it says it is jammed only while it stands in a jam declared a deadlock, and
 * that it has no track on only when it has none.
 *
 * A train with no stop at all never waits where it pulled aside, nor pulls aside but to make way.
 * Each time the jam resolution backs a working train off (`Train.gaveWay`), it is kept back
 * exactly when the train it last backed off for in a jam was the same and it has reached no stop
 * since (`keptBackRule`), and the jam is declared as it sets off; and a train says it is kept back
 * only while it waits where that move ended.
 *
 * The game clock starts at `from`: 0 for a new world, the save's time for a loaded one.
 */
function watch(w: SimWorld, from = 0) {
  let now = from;
  let broken: string | null = null;
  const arrivals = new Map<number, number>();
  const kept = keptBackRule();
  const next = w.fleet.onArrive;
  w.fleet.onArrive = (t, s) => {
    arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
    kept.arrived(t);
    next?.(t, s);
  };
  // every deadlock the jam resolution declares: where each train of it stood, and when one counted
  const traffic = w.fleet.traffic;
  const declare = traffic.deadlock.bind(traffic);
  const declared = new Map<number, { x: number; y: number }>();
  const counted = new Map<number, number>();
  // when each train was last in a deadlock declared, counted or not (once a minute per group)
  const declaredAt = new Map<number, number>();
  traffic.deadlock = (chain, at) => {
    const was = traffic.counters.deadlocks;
    declare(chain, at);
    for (const t of chain) {
      const p = t.poses[0];
      if (p) declared.set(t.id, { x: p.x, y: p.y });
      declaredAt.set(t.id, at);
      if (traffic.counters.deadlocks > was) counted.set(t.id, at);
    }
  };
  // when each train last set off on an escape, as this watch saw it
  const setOff = new Map<number, number>();
  const stood = new Map<number, { since: number; x: number; y: number }>();
  const wrongNoWay = new Map<number, number>();
  const inWay = new Map<number, number>();
  const clear = new Map<number, number>();
  const wk = w.track.w;
  /** A train that set off aside in this step to where it has no way on, when it had one. */
  const strandedAside = (t: Train, was: Before | undefined) => {
    if (!was || was.holding || !t.holding) return null;
    const bound = t.makingWay ? (was.atStation ?? was.stop) : nextStop(t);
    if (bound === null) return null;
    const to = wayTo(w, t, bound);
    if (!was.ends.some(to)) return null;
    // the refuge is where the way ends: for a shunt, where its second leg does
    const way = (t as unknown as Shunting).shunt ?? t.pathAhead();
    if (wayOnFrom(w, way, t, to)) return null;
    const end = way.at(-1);
    const name = w.builder.stationById(bound)?.name;
    return `pulls aside to ${end?.x},${end?.y} with no way on to ${name} from there`;
  };
  const truthful = (t: Train, groups: Set<number>) => {
    const p = t.poses[0];
    if (t.lastMessage === STR.traffic.jammed) {
      const j = declared.get(t.id);
      if (!j) return 'says it is jammed in no declared deadlock';
      const off = Math.hypot(p.x - j.x, p.y - j.y);
      // the note holds within STOOD of where it was first held, each later call within STOOD too
      if (off > 2 * STOOD)
        return `says it is jammed ${off.toFixed(2)} tiles from where it was held`;
      if (t.holding || (t.state !== 'moving' && t.state !== 'yielding'))
        return `says it is jammed while ${t.state}${t.holding ? ', holding an escape' : ''}`;
      if (!groups.has(t.id)) return 'says it is jammed, held by no train';
    }
    // a yielding train looks again every 2 s: its note may lag a change of track by that long
    const says = t.lastMessage === STR.traffic.noWayOn;
    const bound = says || t.state === 'yielding' ? nextStop(t) : null;
    const to = bound === null ? null : wayTo(w, t, bound);
    const h = t.headSeg;
    const wrong = !!to && !!h && (to(h) || to({ ...h, in: h.out })) === says;
    if (wrong && (says || !t.holding)) {
      const since = wrongNoWay.get(t.id) ?? now;
      wrongNoWay.set(t.id, since);
      if (now - since > NOTE_LAG)
        return says
          ? `says it has no track on to its next stop, which it has had for ${(now - since).toFixed(2)} s`
          : `has waited aside with no track on to its next stop for ${(now - since).toFixed(2)} s, saying "${t.lastMessage}"`;
    } else wrongNoWay.delete(t.id);
    // notes about a yield hold only while the train pulls aside or waits where it did
    const yielding = t.state === 'yielding' || (t.state === 'moving' && t.holding && !t.makingWay);
    if (t.lastMessage === STR.traffic.pullingAside && !yielding)
      return `says it is pulling aside while ${t.state}${t.holding ? '' : ', not holding'}`;
    if (t.lastMessage === STR.traffic.replan && t.state !== 'yielding' && t.state !== 'idle')
      return `says it waits for a new escape plan while ${t.state}`;
    // kept back: only waiting where the move it was kept back on ended, declared a jam as it set off
    if (t.lastMessage === STR.traffic.keptBack) {
      if (t.state !== 'yielding') return `says it is kept back while ${t.state}`;
      const off = setOff.get(t.id);
      const keptAt = kept.keptAt(t);
      if (off !== undefined && keptAt !== off)
        return `says it is kept back, though the move it set off on at ${off.toFixed(2)} s was not`;
      if (keptAt !== undefined && (declaredAt.get(t.id) ?? -Infinity) < keptAt)
        return `says it is kept back, with no jam declared as it set off at ${keptAt.toFixed(2)} s`;
    }
    // a train with no stop has nothing to wait for where it pulled aside: it makes way, and idles
    if (!t.route.length && (t.state === 'yielding' || (t.holding && !t.makingWay)))
      return `has no stop, yet ${t.state === 'yielding' ? 'waits where it pulled aside' : 'pulls aside without making way'} saying "${t.lastMessage}"`;
    return null;
  };
  const check = (before: Map<number, Before>) => {
    const at = `at ${now.toFixed(2)} s`;
    const trains = w.fleet.trains;
    const shared = sharedTiles(trains, wk);
    if (shared.length) return `${at} trains share tiles: ${JSON.stringify(shared)}`;
    for (const s of w.builder.stations) {
      if (s.occupants.size > s.platforms)
        return `${at} ${s.name} has ${s.occupants.size} trains on ${s.platforms} platforms`;
      for (const id of s.occupants)
        if (w.fleet.byId(id)?.state === 'idle') return `${at} idle train #${id} holds ${s.name}`;
    }
    const routes = new Map(trains.map((t) => [t.id, t.pathTileKeys(wk)]));
    const groups = new Set(blockingGroups(trains).flatMap((g) => g.map((t) => t.id)));
    for (const t of trains) {
      const name = `#${t.id}`;
      const aside = strandedAside(t, before.get(t.id));
      if (aside) return `${at} ${name} ${aside}`;
      const untrue = truthful(t, groups);
      if (untrue) return `${at} ${name} ${untrue}`;
      const p = t.poses[0];
      const s = stood.get(t.id);
      if (
        !s ||
        t.state === 'idle' ||
        t.state === 'loading' ||
        Math.hypot(p.x - s.x, p.y - s.y) > STOOD
      )
        stood.set(t.id, { since: now, x: p.x, y: p.y });
      else if (
        now - s.since > STALL &&
        (counted.get(t.id) ?? -Infinity) < s.since &&
        !NO_WAY_ON.includes(t.lastMessage) &&
        !NO_WAY_STATES.includes(t.state)
      )
        return `${at} ${name} has stood ${(now - s.since).toFixed(1)} s ${t.state} saying "${t.lastMessage}", with no deadlock counted`;
      if (t.makingWay) {
        if (t.state !== 'moving' || !t.holding)
          return `${at} ${name} makes way while ${t.state}${t.holding ? '' : ', not holding'}`;
        if (t.lastMessage !== STR.traffic.makingWay)
          return `${at} ${name} makes way saying "${t.lastMessage}"`;
      }
      if (t.state !== 'idle') {
        inWay.delete(t.id);
        clear.delete(t.id);
        continue;
      }
      if (t.pathAhead().length) return `${at} idle ${name} keeps a path`;
      const was = before.get(t.id);
      if (was?.state === 'idle') {
        const p = t.poses[0];
        if (p.x !== was.x || p.y !== was.y) return `${at} idle ${name} moved`;
        const cars = new Set(t.occupancyKeys(wk));
        for (const [k, owner] of w.fleet.traffic.claims)
          if (owner === t.id && !cars.has(k))
            return `${at} idle ${name} claims ${k % wk},${Math.floor(k / wk)} off its cars`;
        if (w.fleet.traffic.recoveries.active.has(t.id))
          return `${at} idle ${name} keeps an escape reservation`;
      }
      const mine = t.occupancyKeys(wk);
      const needed = trains.some((o) => o !== t && mine.some((k) => routes.get(o.id)!.has(k)));
      inWay.set(t.id, needed ? (inWay.get(t.id) ?? 0) + GDT : 0);
      clear.set(t.id, needed ? 0 : (clear.get(t.id) ?? 0) + GDT);
      const says = IN_THE_WAY.includes(t.lastMessage);
      if (!says && inWay.get(t.id)! > SAY_IN_WAY)
        return `${at} idle ${name} has stood in another train's way for ${inWay.get(t.id)!.toFixed(2)} s saying "${t.lastMessage}"`;
      if (says && clear.get(t.id)! > SAY_CLEAR)
        return `${at} idle ${name} says "${t.lastMessage}" with nobody needing its track for ${clear.get(t.id)!.toFixed(2)} s`;
    }
    return null;
  };
  const step = () => {
    const before = new Map(
      w.fleet.trains.map((t): [number, Before] => [
        t.id,
        {
          state: t.state,
          x: t.poses[0].x,
          y: t.poses[0].y,
          holding: t.holding,
          atStation: t.atStation?.id ?? null,
          stop: nextStop(t),
          ends: endsOf(t),
        },
      ]),
    );
    for (const t of w.fleet.trains) kept.follow(t, () => now);
    w.fleet.tick(GDT, (now += GDT));
    for (const t of w.fleet.trains)
      if (t.holding && before.get(t.id)?.holding === false) setOff.set(t.id, now);
    broken ??= kept.broken() ?? check(before);
  };
  return {
    get now() {
      return now;
    },
    get broken() {
      return broken;
    },
    /** times the train pulled into a station */
    arrivals: (t: Train) => arrivals.get(t.id) ?? 0,
    /** Steps until `done` holds, for at most `seconds`; returns `done()`. */
    until(done: () => boolean, seconds: number) {
      for (let i = 0; i < seconds / GDT && !done(); i++) step();
      return done();
    },
  };
}

/**
 * Lays the line, idles the roaming trains on the platforms of their stations as `idleAt` does
 * (sent there with nothing to haul anywhere) and sets the callers off, calling with `load`.
 * `idled` says whether the roaming trains went idle.
 */
function setUp(l: GenLine, load: 'auto' | 'none' = 'auto') {
  const { w, stations } = layLine(l);
  const sim = watch(w);
  const roam = (x: number, east: boolean, wagons: number, at: Station) => {
    const t = consist(w, x, east, wagons);
    t.mode = 'production';
    t.schedule = [defaultStop(at.id)];
    go(w, t);
    return t;
  };
  const idle = roam(l.quarry, true, l.idleWagons, stations.quarry!);
  const west = l.westIdle ? roam(WEST, false, l.westIdle, stations.west!) : null;
  const idled = sim.until(() => idle.state === 'idle' && (!west || west.state === 'idle'), 30);
  const callers = l.callers.map((c) => {
    const t = consist(w, c.x, true, c.wagons);
    t.mode = 'schedule';
    t.schedule = c.stops.map((s) => call(stations[s]!, load));
    go(w, t);
    return t;
  });
  return { w, sim, stations, idle, callers, idled };
}

/** A failing case's story: where every train is, what it says and what the traffic counted. */
function story(w: SimWorld, sim: ReturnType<typeof watch>) {
  const trains = w.fleet.trains
    .map((t) => {
      const h = t.headTile;
      return `#${t.id} ${t.state} at ${h?.x},${h?.y} "${t.lastMessage}", ${sim.arrivals(t)} calls`;
    })
    .join('; ');
  const { overlaps, deadlocks, stuck } = w.fleet.traffic.counters;
  return `${sim.broken ?? 'no broken step'}; after ${sim.now.toFixed(1)} s: ${trains}; counters ${JSON.stringify({ overlaps, deadlocks, stuck })}`;
}

/**
 * A main-line column to take up: plain track (off every switch block and platform) under no train,
 * on the way a train waiting where it pulled aside wants to go on by when there is one; `pick` is
 * the fraction of the way along the ones that fit. Null when none fits.
 */
function tileToCut(w: SimWorld, l: GenLine, pick: number): number | null {
  const wk = w.track.w;
  const under = new Set(w.fleet.trains.flatMap((t) => t.occupancyKeys(wk)));
  const plat = new Set(
    w.builder.stations.flatMap((s) => w.builder.platformTiles(s)).map((p) => p.y * wk + p.x),
  );
  const plain: number[] = [];
  for (let x = 4; x <= l.end; x++) {
    const k = ROW * wk + x;
    if (!switchBlocks(l).some((b) => meets(b, [x, x])) && !plat.has(k) && !under.has(k))
      plain.push(x);
  }
  const wanted = new Set(
    w.fleet.trains.filter((t) => t.state === 'yielding').flatMap((t) => [...t.pathTileKeys(wk)]),
  );
  const onWay = plain.filter((x) => wanted.has(ROW * wk + x));
  const fit = onWay.length ? onWay : plain;
  return fit.length ? fit[Math.floor(pick * fit.length)] : null;
}

/**
 * Lines with a way aside the idle train can run straight into, and the movement properties hold
 * on them; lines whose only siding faces away need shunting (#189).
 */
const USABLE = [
  { kind: 'a siding facing it', gen: clearLine, ok: hasWayAside },
  { kind: 'a passing loop', gen: loopLine, ok: hasLoopAside },
];

/** Seeds per property: each case runs a few thousand fleet ticks. */
const LINE_SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
/** Each property runs LINE_SEEDS cases of minutes of game time: generous on a loaded runner. */
const PROPERTY = { timeout: 600_000 };

describe('idle trains on generated lines', () => {
  it(
    'never share a tile, hold a platform or a path, move, or misreport being in the way',
    PROPERTY,
    () => {
      interface Case {
        line: GenLine;
        /**
         * Seconds into the run at which track is laid far from the line, as a player builds
         * elsewhere: every escape reservation goes stale and the trains on one stop where they are.
         */
        builds: number[];
      }
      forAll<Case>(
        (rng) => ({
          line: anyLine(rng),
          builds: Array.from({ length: rng.int(0, 3) }, () => rng.int(5, 145)).sort(
            (a, b) => a - b,
          ),
        }),
        ({ line: l, builds }) => {
          const { w, sim, idled } = setUp(l);
          expect(idled, 'the roaming trains never idled').toBe(true);
          const stop = () => sim.broken !== null;
          let at = 0;
          for (const t of builds) {
            sim.until(stop, t - at);
            w.track.place(w.track.w - 2, w.track.h - 2, 'straight', 1);
            at = t;
          }
          sim.until(stop, 150 - at);
          expect(sim.broken, story(w, sim)).toBeNull();
          expect(w.fleet.traffic.counters.overlaps, story(w, sim)).toBe(0);
        },
        {
          seeds: LINE_SEEDS,
          shrink: function* (c) {
            for (const builds of shrinkArray(c.builds)) yield { ...c, builds };
            for (const line of shrinkLine(c.line)) yield { ...c, line };
          },
        },
      );
    },
  );

  // property B, restated for #151: a jam no siding can clear (#189 is shunting) is counted and
  // said, never a train standing silent; checked at every step by `watch`
  it(
    'never leave a train with no way on without a counted deadlock or a note saying so',
    PROPERTY,
    () => {
      interface Case {
        line: GenLine;
        /** seconds into the run at which track is laid far off: every escape goes stale */
        builds: number[];
      }
      forAll<Case>(
        (rng) => ({
          line: anyLine(rng),
          builds: Array.from({ length: rng.int(0, 3) }, () => rng.int(5, 300)).sort(
            (a, b) => a - b,
          ),
        }),
        ({ line: l, builds }) => {
          const { w, sim, idled } = setUp(l);
          expect(idled, 'the roaming trains never idled').toBe(true);
          const stop = () => sim.broken !== null;
          let at = 0;
          for (const t of builds) {
            sim.until(stop, t - at);
            w.track.place(w.track.w - 2, w.track.h - 2, 'straight', 1);
            at = t;
          }
          sim.until(stop, STALL * 3 - at);
          expect(sim.broken, story(w, sim)).toBeNull();
        },
        {
          seeds: LINE_SEEDS,
          shrink: function* (c) {
            for (const builds of shrinkArray(c.builds)) yield { ...c, builds };
            for (const line of shrinkLine(c.line)) yield { ...c, line };
          },
        },
      );
    },
  );

  // the note half of property B: no generated line strands a train in a siding, so here the line
  // itself is cut, at a tile a train waiting where it pulled aside wants to take, and laid again
  it(
    'say they have no track on only while they have none, as track is taken up and laid again',
    PROPERTY,
    () => {
      interface Case {
        line: GenLine;
        /** seconds into the run from which a tile is taken up once a train waits aside */
        from: number;
        /** seconds the tile stays out */
        out: number;
        /** which of the tiles fit to take up, as a fraction of their number */
        pick: number;
      }
      forAll<Case>(
        (rng) => ({
          line: anyLine(rng),
          from: rng.int(5, 120),
          out: rng.int(5, 60),
          pick: rng.next(),
        }),
        ({ line: l, from, out, pick }) => {
          const { w, sim, idled } = setUp(l);
          expect(idled, 'the roaming trains never idled').toBe(true);
          const stop = () => sim.broken !== null;
          sim.until(stop, from);
          sim.until(() => stop() || w.fleet.trains.some((t) => t.state === 'yielding'), 60);
          const x = tileToCut(w, l, pick);
          if (x !== null && !stop()) {
            w.builder.free = true;
            expect(w.builder.removeTrack(x, ROW)).toBe(true);
            w.builder.free = false;
            sim.until(stop, out);
            line(w, x, ROW, x);
          }
          sim.until(stop, STALL * 2);
          expect(
            sim.broken,
            `${x === null ? 'nothing cut' : `cut at x ${x}`}: ${story(w, sim)}`,
          ).toBeNull();
        },
        {
          seeds: LINE_SEEDS,
          shrink: function* (c) {
            for (const line of shrinkLine(c.line)) yield { ...c, line };
            for (const out of shrinkInt(c.out, 5)) yield { ...c, out };
          },
        },
      );
    },
  );

  for (const { kind, gen, ok } of USABLE)
    it(
      `let the train behind run its schedule when there is a way aside without reversing (${kind})`,
      PROPERTY,
      () => {
        forAll(
          gen,
          (l) => {
            const { w, sim, callers, idled } = setUp(l);
            expect(idled, 'the idle train never idled').toBe(true);
            const [caller] = callers;
            const ran = sim.until(() => sim.arrivals(caller) >= 3, 300);
            expect(ran, `the caller stopped running: ${story(w, sim)}`).toBe(true);
            expect(sim.broken, story(w, sim)).toBeNull();
          },
          { seeds: LINE_SEEDS, shrink: (l) => shrinkLine(l, ok) },
        );
      },
    );

  it('take up work where they stand at their next look once cargo turns up', PROPERTY, () => {
    interface Case {
      line: GenLine;
      /** seconds the train stands idle before the stone turns up */
      after: number;
      stone: number;
    }
    // alone on the line, so nobody needs its track or takes the stone first
    const alone = (l: GenLine) => validTrack(l) && !l.callers.length && !l.westIdle;
    forAll<Case>(
      (rng) => ({
        line: { ...anyLine(rng), callers: [], westIdle: 0 },
        after: rng.int(0, 30),
        stone: rng.int(20, 60),
      }),
      ({ line: l, after, stone }) => {
        const { w, sim, stations, idle, idled } = setUp(l);
        expect(idled, 'the idle train never idled').toBe(true);
        sim.until(() => false, after);
        expect(idle.state, story(w, sim)).toBe('idle');
        stations.quarry!.store('stone', stone);
        // an idle train looks again after 10 s standing idle, and takes the work it sees
        const set = sim.until(() => idle.state !== 'idle', 10 + 3 * GDT);
        expect(set, `still idle 10 s after the stone turned up: ${story(w, sim)}`).toBe(true);
        expect(
          sim.until(() => idle.totalCargo() > 0, 60),
          `never loaded: ${story(w, sim)}`,
        ).toBe(true);
        const delivered = () =>
          [stations.west, stations.east].some((s) => (s?.stored('stone') ?? 0) > 0);
        expect(sim.until(delivered, 200), `never delivered: ${story(w, sim)}`).toBe(true);
        expect(sim.broken, story(w, sim)).toBeNull();
      },
      {
        seeds: LINE_SEEDS,
        shrink: function* (c) {
          for (const line of shrinkLine(c.line, alone)) yield { ...c, line };
          for (const after of shrinkInt(c.after)) yield { ...c, after };
        },
      },
    );
  });

  for (const { kind, gen, ok } of USABLE)
    it(`take up work again from where they made way (${kind})`, PROPERTY, () => {
      forAll(
        gen,
        (l) => {
          // the caller calls without loading, and leaves service once the idle train has made way
          // for it: on single track, a loaded train meeting it would have to shunt
          const { w, sim, stations, idle, callers, idled } = setUp(l, 'none');
          expect(idled, 'the idle train never idled').toBe(true);
          const [caller] = callers;
          expect(
            sim.until(() => sim.arrivals(caller) >= 2, 300),
            story(w, sim),
          ).toBe(true);
          w.fleet.recall(caller);
          // it may still be on its way aside
          expect(
            sim.until(() => idle.state === 'idle', 60),
            story(w, sim),
          ).toBe(true);
          stations.quarry!.store('stone', 40);
          expect(
            sim.until(() => idle.totalCargo() > 0, 120),
            `never loaded: ${story(w, sim)}`,
          ).toBe(true);
          const delivered = () =>
            [stations.west, stations.east].some((s) => (s?.stored('stone') ?? 0) > 0);
          expect(sim.until(delivered, 200), `never delivered: ${story(w, sim)}`).toBe(true);
          expect(sim.broken, story(w, sim)).toBeNull();
        },
        { seeds: LINE_SEEDS, shrink: (l) => shrinkLine(l, ok) },
      );
    });

  it('back the train behind off only to where it can go on to its stop', SLOW, () => {
    // the idle train's way aside is the siding at x 24, which the caller stands across. The
    // siding at x 45 would clear it, but lets a train out westwards only, away from the quarry the
    // caller is bound for; backing west past x 24 instead leaves it a way on
    const l: GenLine = {
      end: 51,
      quarry: 51,
      sidings: [
        { x: 24, east: true, len: 5 },
        { x: 45, east: false, len: 5 },
      ],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [{ x: 30, wagons: 1, stops: ['quarry', 'west'] }],
    };
    expect(valid(l)).toBe(true);
    const { w, sim, idle, callers, idled } = setUp(l);
    expect(idled, 'the idle train never idled').toBe(true);
    const [caller] = callers;
    expect(
      sim.until(() => sim.arrivals(caller) >= 3, 300),
      `the caller stopped running: ${story(w, sim)}`,
    ).toBe(true);
    expect(idle.lastMessage, story(w, sim)).toBe(STR.traffic.madeWay);
    expect(sim.broken, story(w, sim)).toBeNull();
    expect(w.fleet.traffic.counters.deadlocks, story(w, sim)).toBe(0);
  });
});

// ------------------------------------------------------------------ generated lines, saved and loaded

/** Game seconds from the callers setting off that a save is drawn from. */
const SAVE_SPAN = 100;
/** A generated line and when it is saved. */
interface SavedLine {
  line: GenLine;
  /** the tick after which it is saved, counted from the callers setting off */
  tick: number;
  /**
   * Count `tick` among the ticks after which a train is making way instead, round and round, when
   * the line has any: a save while one is on its way aside is otherwise a rare draw.
   */
  aside: boolean;
}
/** A case on lines from `gen`: any tick of SAVE_SPAN, half the time one with a train making way. */
const savedLine =
  (gen: (rng: Rng) => GenLine) =>
  (rng: Rng): SavedLine => ({
    line: gen(rng),
    tick: rng.int(0, SAVE_SPAN / GDT - 1),
    aside: rng.chance(0.5),
  });
/** Smaller cases that are still `ok`: an earlier save, any save, then a smaller line. */
function* shrinkSaved(c: SavedLine, ok = valid): Iterable<SavedLine> {
  for (const tick of shrinkInt(c.tick)) yield { ...c, tick };
  if (c.aside) yield { ...c, aside: false };
  for (const line of shrinkLine(c.line, ok)) yield { ...c, line };
}
/** The tick of the callers' run a case is saved after (`SavedLine.aside`). */
function saveTick({ line: l, tick, aside }: SavedLine): number {
  if (!aside) return tick;
  const { w, sim } = setUp(l);
  const making: number[] = [];
  for (let i = 0; i < SAVE_SPAN / GDT; i++) {
    sim.until(() => false, GDT);
    if (w.fleet.trains.some((t) => t.makingWay)) making.push(i);
  }
  return making.length ? making[tick % making.length] : tick;
}
/**
 * Sets the line up as `setUp` does and runs it to the end of the tick the case is saved after,
 * every step watched; then saves it and loads it into the line laid afresh, watched from the saved
 * game time. Trains keep their ids through the load. The line never saved (`w`, `sim`) runs on
 * from the save too.
 */
function savedAndLoaded(c: SavedLine) {
  const tick = saveTick(c);
  const { w, sim, callers, idled } = setUp(c.line);
  expect(idled, 'the roaming trains never idled').toBe(true);
  for (let i = 0; i <= tick && sim.broken === null; i++) sim.until(() => false, GDT);
  const at = `saved after tick ${tick}`;
  expect(sim.broken, `${at}, before the save: ${story(w, sim)}`).toBeNull();
  const back = reload(w, () => layLine(c.line).w);
  return { w, sim, back, again: watch(back, sim.now), callers: callers.map((t) => t.id), at };
}

/** Seconds a loaded line runs beside the line never saved, and how far apart a car may stand. */
const SIDE_BY_SIDE = 60;
const APART = 0.01;
/**
 * What every train of a line is doing, where it stands and what it carries, what an idle train or
 * one making way says, and which trains hold each station's platforms.
 */
function doing(w: SimWorld) {
  return JSON.stringify({
    trains: w.fleet.trains.map((t) => ({
      id: t.id,
      state: t.state,
      makingWay: t.makingWay,
      holding: t.holding,
      station: t.atStation?.id ?? null,
      cargo: t.totalCargo(),
      note: t.state === 'idle' || t.makingWay ? t.lastMessage : null,
    })),
    platforms: w.builder.stations.map((s) => [...s.occupants].sort((a, b) => a - b)),
  });
}
/**
 * Loads the case's save and runs it SIDE_BY_SIDE seconds beside the line never saved: the first
 * tick after which the two part (a train doing or saying something else, or a car APART or more
 * from where it stands never saved), or null.
 */
function parting(c: SavedLine): string | null {
  const { w, sim, back, again, at } = savedAndLoaded(c);
  for (let k = 1; k <= SIDE_BY_SIDE / GDT; k++) {
    sim.until(() => false, GDT);
    again.until(() => false, GDT);
    const why = `${at}, ${k} ticks on`;
    if (doing(back) !== doing(w)) return `${why}: ${doing(back)} where never saved ${doing(w)}`;
    for (const [i, t] of back.fleet.trains.entries()) {
      const gap = apart(w.fleet.trains[i], t);
      if (gap >= APART) return `${why}: #${t.id} stands ${gap.toFixed(3)} tiles off`;
    }
  }
  expect(again.broken, `${at}: ${story(back, again)}`).toBeNull();
  return null;
}
/**
 * The smallest lines and saves found to part from the line never saved before v17 kept the way
 * each train runs, the way a waiting train wants and what it waits for, its note, and when it may
 * next try a way aside or out of a jam: an idle train in the way past a train held 4 s, whose
 * wanted way the jam resolution backed that train off along 4 s late; a train routed round an idle
 * one through a passing loop, planned straight into it; a train under way beside one making way,
 * planned from a tile ahead of its head and so not held behind that escape; a train waiting aside
 * whose wanted way through an idle train the idle train moved aside for up to 2 s late; an idle
 * train with no way aside whose looks after a failed one, 2 s apart, ran 1.5 s out of step, so it
 * said it had no way aside while never saved it waited for room; and a jam searched again at once
 * after a load rather than 4 s after the last search, which backed the caller off a tick late and
 * sent the idle train aside where never saved it stayed.
 */
const PARTED: readonly { line: GenLine; tick: number }[] = [
  {
    line: {
      end: 44,
      quarry: 44,
      sidings: [{ x: 29, east: true, len: 6 }],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [{ x: 38, wagons: 1, stops: ['quarry', 'west'] }],
    },
    tick: 120,
  },
  {
    line: {
      end: 49,
      quarry: 34,
      sidings: [],
      loops: [{ x: 36, len: 8 }],
      idleWagons: 2,
      westIdle: 0,
      callers: [{ x: 9, wagons: 1, stops: ['quarry', 'east'] }],
    },
    tick: 400,
  },
  {
    line: {
      end: 50,
      quarry: 50,
      sidings: [],
      loops: [{ x: 13, len: 6 }],
      idleWagons: 1,
      westIdle: 0,
      callers: [{ x: 10, wagons: 2, stops: ['west', 'quarry'] }],
    },
    tick: 150,
  },
  {
    line: {
      end: 44,
      quarry: 44,
      sidings: [{ x: 29, east: true, len: 6 }],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [{ x: 38, wagons: 1, stops: ['quarry', 'west'] }],
    },
    tick: 421,
  },
  {
    line: {
      end: 53,
      quarry: 53,
      sidings: [{ x: 28, east: true, len: 1 }],
      loops: [],
      idleWagons: 1,
      westIdle: 2,
      callers: [{ x: 16, wagons: 1, stops: ['west', 'quarry'] }],
    },
    tick: 775,
  },
  {
    line: {
      end: 56,
      quarry: 56,
      sidings: [{ x: 37, east: false, len: 1 }],
      loops: [],
      idleWagons: 2,
      westIdle: 0,
      callers: [{ x: 36, wagons: 1, stops: ['quarry', 'west'] }],
    },
    tick: 788,
  },
];

describe('idle trains on generated lines, saved and loaded at any tick', () => {
  // A load starts afresh the timers and memory the save does not hold (docs/traffic-current.md
  // §8): the order claims are granted in, how long an escape has gone without progress. Where one
  // of those decides, a loaded line can part from the line never saved, so a line saved at any
  // tick is held to run on soundly; the saves that parted before v17 kept each train's way, what
  // it waits for and when it may next try a way aside or out of a jam, to run on exactly as never
  // saved.
  it(
    'carry on as never saved where a load once parted them: every train doing and saying the same',
    SLOW,
    () => {
      // run SIDE_BY_SIDE seconds beside the line never saved, every car where it stands there
      for (const { line: l, tick } of PARTED)
        expect(parting({ line: l, tick, aside: false }), JSON.stringify(l)).toBeNull();
    },
  );

  it(
    'never share a tile, hold a platform or a path, move, misreport or stall, and idle where they made way',
    PROPERTY,
    () => {
      // after the load, every step `watch` checks holds for 150 s, past the STALL a train may
      // stand, and no two trains overlap. The roaming trains find nothing to haul all along, so
      // each idles or makes way: one loaded on its way aside idles where the way ends, and never
      // waits there to head back to its station (`yielding`) as a train that pulled aside does
      forAll(
        savedLine(anyLine),
        (c) => {
          const { back, again, at } = savedAndLoaded(c);
          const roaming = back.fleet.trains.filter((t) => t.mode === 'production');
          const yielding = () => roaming.find((t) => t.state === 'yielding');
          again.until(() => again.broken !== null || !!yielding(), 150);
          expect(again.broken, `${at}: ${story(back, again)}`).toBeNull();
          expect(yielding()?.id, `${at}, waits aside: ${story(back, again)}`).toBe(undefined);
          expect(back.fleet.traffic.counters.overlaps, `${at}: ${story(back, again)}`).toBe(0);
        },
        { seeds: LINE_SEEDS, shrink: (c) => shrinkSaved(c) },
      );
    },
  );

  for (const { kind, gen, ok } of USABLE)
    it(
      `let the train behind run its schedule on when there is a way aside without reversing (${kind})`,
      PROPERTY,
      () => {
        // as the uninterrupted line does (`let the train behind run its schedule`): from the load
        // on, the caller calls three more times within 300 s, and every step is sound
        forAll(
          savedLine(gen),
          (c) => {
            const { back, again, callers, at } = savedAndLoaded(c);
            const caller = back.fleet.byId(callers[0])!;
            const ran = again.until(() => again.arrivals(caller) >= 3, 300);
            expect(ran, `${at}, the caller stopped running: ${story(back, again)}`).toBe(true);
            expect(again.broken, `${at}: ${story(back, again)}`).toBeNull();
          },
          { seeds: LINE_SEEDS, shrink: (c) => shrinkSaved(c, ok) },
        );
      },
    );
});

// ------------------------------------------------------------------ shunting switched on

/** A move a train set off on (`Train.retreat`), and what was wrong as it set off. */
interface Move {
  id: number;
  plan: RetreatPlan;
  at: number;
  bad: string | null;
}
/** A reversal of a train's consist (`reverseConsist`), and how the train stood. */
interface Reversal {
  id: number;
  at: number;
  /** at the end of a shunt's first leg (`turn`): a turn partway along a move */
  partway: boolean;
  /** neither that nor as a move sets off (`retreat`), by a train holding an escape */
  stray: boolean;
  /** its speed when the step began, tiles a second */
  speed: number;
  /** tiles under its cars that are not plain track */
  onSwitch: string[];
  /** the farthest a car moved as it turned (over the whole of `turn`, for a turn partway), tiles */
  moved: number;
}
/** The private Train members that turn a consist round where it stands, and a shunt at its turn. */
interface Turnable {
  reverseConsist(): void;
  turn(ctx: TickCtx, back: PathSegment[]): void;
}
/** Plain track at tile key `k`: one link, and no part of a multi-tile switch. */
function plainAt(w: SimWorld, k: number) {
  const p = w.track.get(k % w.track.w, Math.floor(k / w.track.w));
  return !!p && p.links.length === 1 && !(p.unit && p.kind !== 'curve');
}
/**
 * The fastest a train may run as the step it turns partway in begins, tiles a second: it has
 * braked to a stand at the end of its first leg and creeps the last of it (about 0.15 on the
 * single-line layouts), far below running speed.
 */
const AT_REST = 0.5;

/** What `shuntingOn` records for one world, and the check of every step. */
interface ShuntLog {
  w: SimWorld;
  moves: Move[];
  reversals: Reversal[];
  /** How every train stands as a step begins: call before each step. */
  begin(): void;
  /** The first thing found wrong since the last call, or null. */
  check(): string | null;
}

/**
 * Shunting switched on as the fleet is to switch it on (the wiring is #189's follow-up): an idle
 * train moving aside and a train backing off fall back on a move that reverses once partway
 * (`planAside` and `planRetreat` with `shunt`; the way an idle train shows it would take stays
 * plain). `watch(w, clock)` records, for a world, every move set off (`Train.retreat`) with what
 * the claims and the other trains were as it began, and every reversal of a consist.
 *
 * Its `check` holds every step to what a shunt promises: a move never starts onto a tile another
 * train stands on or a train outside its group claims; a train reverses partway at most once a
 * move, and only along a shunt, at rest, with no car on a switch or crossing and no car moving;
 * a train holding an escape holds its lease, and every tile of the way still ahead of it, and of
 * a shunt's second leg until it turns, is claimed by it; from the step after it turns, its lease
 * keeps nothing of the second leg whole that it has left behind.
 */
function shuntingOn() {
  const logs: ShuntLog[] = [];
  const logOf = (t: Train) => logs.find((l) => l.w.fleet.trains.includes(t));
  const clocks = new Map<ShuntLog, () => number>();
  const began = new Map<Train, { holding: boolean; speed: number }>();
  const aside = Train.prototype.planAside;
  const back = Train.prototype.planRetreat;
  const retreat = Train.prototype.retreat;
  const turnable = Train.prototype as unknown as Turnable;
  const reverse = turnable.reverseConsist;
  const turn = turnable.turn;
  let turning = false;
  let settingOff = false;
  vi.spyOn(Train.prototype, 'planAside').mockImplementation(function (
    this: Train,
    ctx: TickCtx,
    group: number[],
    spots: AsideSpots,
    through = false,
  ) {
    return aside.call(this, ctx, group, spots, through, !through);
  });
  vi.spyOn(Train.prototype, 'planRetreat').mockImplementation(function (
    this: Train,
    ctx: TickCtx,
    group: number[] = [],
  ) {
    return back.call(this, ctx, group, true);
  });
  vi.spyOn(Train.prototype, 'retreat').mockImplementation(function (
    this: Train,
    ctx: TickCtx,
    group: number[] = [],
    plan = this.planRetreat(ctx, group),
  ) {
    const log = logOf(this);
    const claims = new Map(log?.w.fleet.traffic.claims ?? []);
    settingOff = true;
    const ok = (() => {
      try {
        return retreat.call(this, ctx, group, plan);
      } finally {
        settingOff = false;
      }
    })();
    if (!ok || !plan || !log) return ok;
    const wk = log.w.track.w;
    let bad: string | null = null;
    for (const s of [...plan.path, ...(plan.back ?? [])]) {
      const k = s.y * wk + s.x;
      const under = log.w.fleet.trains.find((o) => o !== this && o.occupancyKeys(wk).includes(k));
      const owner = claims.get(k);
      if (under) bad ??= `#${this.id} set off along ${s.x},${s.y} under #${under.id}`;
      else if (owner !== undefined && owner !== this.id && !plan.group.includes(owner))
        bad ??= `#${this.id} set off along ${s.x},${s.y}, claimed by #${owner} outside its group`;
    }
    log.moves.push({ id: this.id, plan, at: clocks.get(log)!(), bad });
    return ok;
  });
  vi.spyOn(turnable, 'turn').mockImplementation(function (
    this: Train,
    ctx: TickCtx,
    leg: PathSegment[],
  ) {
    const before = this.poses.map((p) => ({ ...p }));
    const log = logOf(this);
    const was = log?.reversals.length ?? 0;
    turning = true;
    try {
      turn.call(this, ctx, leg);
    } finally {
      turning = false;
    }
    // no car moves over the whole turn, the reversal and the new path both
    const r = log?.reversals[was];
    if (r) {
      const moved = this.poses.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y));
      r.moved = Math.max(r.moved, ...moved);
    }
  });
  vi.spyOn(turnable, 'reverseConsist').mockImplementation(function (this: Train) {
    const log = logOf(this);
    const before = this.poses.map((p) => ({ ...p }));
    const wk = log?.w.track.w ?? 1;
    const onSwitch = log
      ? this.occupancyKeys(wk)
          .filter((k) => !plainAt(log.w, k))
          .map((k) => `${k % wk},${Math.floor(k / wk)}`)
      : [];
    reverse.call(this);
    if (!log) return;
    const was = began.get(this);
    log.reversals.push({
      id: this.id,
      at: clocks.get(log)!(),
      partway: turning,
      stray: !turning && !settingOff && !!was?.holding,
      speed: was?.speed ?? 0,
      onSwitch,
      moved: Math.max(
        0,
        ...this.poses.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y)),
      ),
    });
  });
  const watch = (w: SimWorld, clock: () => number): ShuntLog => {
    let seen = 0;
    let turned = 0;
    const log: ShuntLog = {
      w,
      moves: [],
      reversals: [],
      begin() {
        for (const t of w.fleet.trains) began.set(t, { holding: t.holding, speed: t.speed });
      },
      check() {
        const at = `at ${clock().toFixed(2)} s`;
        for (const m of log.moves.slice(seen)) if (m.bad) return `${at}: ${m.bad}`;
        seen = log.moves.length;
        for (const r of log.reversals.slice(turned)) {
          if (r.stray) return `${at}: #${r.id} reversed holding an escape, not at a turn`;
          if (!r.partway) continue;
          const move = log.moves.filter((m) => m.id === r.id && m.at <= r.at).at(-1);
          if (!move?.plan.back) return `${at}: #${r.id} reversed partway along a move with no turn`;
          const again = log.reversals.filter((o) => o.id === r.id && o.partway && o.at >= move.at);
          if (again.length > 1)
            return `${at}: #${r.id} reversed ${again.length} times along a move`;
          if (r.speed > AT_REST) return `${at}: #${r.id} turned at ${r.speed} tiles a second`;
          if (r.onSwitch.length) return `${at}: #${r.id} turned with a car on ${r.onSwitch}`;
          if (r.moved > 1e-6) return `${at}: #${r.id} turned, a car moving ${r.moved} tiles`;
        }
        turned = log.reversals.length;
        const traffic = w.fleet.traffic;
        const wk = w.track.w;
        for (const t of w.fleet.trains) {
          if (!t.holding || t.state !== 'moving') continue;
          const lease = traffic.recoveries.active.get(t.id);
          if (!lease) return `${at}: #${t.id} holds an escape with no lease`;
          for (const s of t.pathAhead())
            if (traffic.claims.get(s.y * wk + s.x) !== t.id)
              return `${at}: #${t.id} has ${s.x},${s.y} still to run, claimed by #${traffic.claims.get(s.y * wk + s.x)}`;
          const move = log.moves.filter((m) => m.id === t.id).at(-1);
          if (!move) return `${at}: #${t.id} holds an escape it never set off on`;
          const turns = log.reversals.filter((r) => r.id === t.id && r.partway && r.at >= move.at);
          const turnedYet = turns.length > 0;
          // the step after it turns, the traffic control has seen the turn: what it left behind
          // goes, and nothing of the second leg is kept whole any more
          if (turns.some((r) => r.at < clock() - 1e-9) && lease.rest.size)
            return `${at}: #${t.id} turned, but its lease still keeps its second leg whole`;
          if (move.plan.back && !turnedYet)
            for (const s of move.plan.back) {
              const k = s.y * wk + s.x;
              if (!lease.tiles.has(k) || traffic.claims.get(k) !== t.id)
                return `${at}: #${t.id} let ${s.x},${s.y} of its second leg go before it turned`;
            }
        }
        return null;
      },
    };
    logs.push(log);
    clocks.set(log, clock);
    return log;
  };
  return { watch };
}

/**
 * A single line along ROW from x 4 to 56 with a warehouse at each end (platforms x 5 and 56) and one
 * dead-end siding of six tiles south of it off a switch at x 30: its throat facing east (rot 1, the
 * siding under x 30) or west (rot 7, the siding under x 31).
 */
function shuntingLine(throatEast: boolean) {
  const w = simWorld({ terrain: 'grass', size: 64 });
  lay(w, 30, ROW, 'switch', throatEast ? 1 : 7);
  siding(w, throatEast ? 30 : 31, ROW + 2);
  line(w, 4, ROW, 29);
  line(w, 32, ROW, 56);
  const west = station(w, 'warehouse', 5, ROW - 1);
  const east = station(w, 'warehouse', 56, ROW - 1);
  return { w, west, east, sidingX: throatEast ? 30 : 31 };
}
/** One of the ways round a single line whose siding faces away from the idle train. */
interface ShuntLayout {
  throatEast: boolean;
  /** the other train comes from the east end, bound for the west warehouse */
  fromEast: boolean;
  /** the idle train's head points at the switch (else it sets off rear first) */
  facing: boolean;
}
const SHUNT_LAYOUTS: ShuntLayout[] = [false, true].flatMap((throatEast) =>
  [true, false].flatMap((fromEast) =>
    [true, false].map((facing) => ({ throatEast, fromEast, facing })),
  ),
);
const showLayout = (l: ShuntLayout) =>
  `throat facing ${l.throatEast ? 'east' : 'west'}, the other train from the ${l.fromEast ? 'east' : 'west'}, the idle train ${l.facing ? 'facing' : 'backing towards'} the switch`;

/**
 * The layout laid and its trains set: the idle train (no stop, so any refuge leaves it no worse
 * off) stands on the side of the switch it cannot run straight into the siding from, with its head
 * at x 40 east of a westward throat or x 20 west of an eastward one; the other train sets off from
 * x 51 heading west or x 12 heading east, for the warehouse at the far end.
 */
function shuntingScene(l: ShuntLayout) {
  const { w, west, east, sidingX } = shuntingLine(l.throatEast);
  const sim = run(w);
  // west of the switch, a train faces it heading east
  const idle = train(w, l.throatEast ? 20 : 40, l.throatEast === l.facing, 'schedule', []);
  idle.idle('');
  const target = l.fromEast ? west : east;
  const caller = train(w, l.fromEast ? 51 : 12, !l.fromEast, 'schedule', [call(target)]);
  go(w, caller);
  return { w, sim, idle, caller, target, sidingX };
}

describe('with shunting on, an idle train in the way on a single line whose siding faces away from it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const l of SHUNT_LAYOUTS)
    it(
      `backs into the siding with one turn partway, and the other train passes (${showLayout(l)})`,
      SLOW,
      () => {
        const on = shuntingOn();
        const { w, sim, idle, caller, target, sidingX } = shuntingScene(l);
        const log = on.watch(w, () => sim.now);
        let broken: string | null = null;
        // how it stands as its move ends (with no stop, it gives up looking for work 10 s later)
        let parked: { state: string; note: string; keys: number[] } | null = null;
        const done = sim.until(() => {
          broken ??= log.check();
          log.begin();
          if (!parked && log.moves.length && !idle.holding)
            parked = {
              state: idle.state,
              note: idle.lastMessage,
              keys: idle.occupancyKeys(w.track.w),
            };
          return broken !== null || (!!parked && sim.arrivals(caller).includes(target.id));
        }, 120);
        const story = `${broken}; ${idle.state} "${idle.lastMessage}" at ${JSON.stringify(idle.headTile)}; caller ${caller.state} "${caller.lastMessage}"; ${JSON.stringify(log.reversals)}`;
        expect(broken, story).toBeNull();
        expect(done, story).toBe(true);
        // one move, a shunt, set off rear first when the head points away; and one turn partway
        expect(log.moves.map((m) => [m.id, !!m.plan.back, m.plan.flip])).toEqual([
          [idle.id, true, !l.facing],
        ]);
        expect(log.reversals.filter((r) => r.partway).map((r) => r.id)).toEqual([idle.id]);
        // it ends idle wholly in the siding, saying it made way, and its lease goes with the move
        expect([parked!.state, parked!.note]).toEqual(['idle', STR.traffic.madeWay]);
        const wk = w.track.w;
        for (const k of parked!.keys)
          expect([k % wk, Math.floor(k / wk) >= ROW + 2], story).toEqual([sidingX, true]);
        expect(w.fleet.traffic.recoveries.active.size).toBe(0);
        expectSound(sim);
      },
    );
});

/** Every train of a world as a step leaves it: what it does and says, and where its cars stand. */
function frameOf(w: SimWorld) {
  return w.fleet.trains.map((t) => ({
    id: t.id,
    doing: [t.state, t.holding, t.reversed, t.lastMessage],
    poses: t.poses.map((p) => ({ x: p.x, y: p.y })),
  }));
}
type Frame = ReturnType<typeof frameOf>;
/** Where two frames of the same trains part: a train doing or saying else, or a car APART off. */
function parts(a: Frame, b: Frame): string | null {
  for (const [i, t] of a.entries()) {
    const u = b[i];
    if (!u || u.id !== t.id) return `no #${t.id}`;
    if (JSON.stringify(u.doing) !== JSON.stringify(t.doing))
      return `#${t.id} ${JSON.stringify(u.doing)} where never saved ${JSON.stringify(t.doing)}`;
    const off = Math.max(
      ...t.poses.map((p, j) => Math.hypot(p.x - u.poses[j].x, p.y - u.poses[j].y)),
    );
    if (off >= APART) return `#${t.id} stands ${off.toFixed(3)} tiles off`;
  }
  return null;
}
/** A game's trains and stations saved as the game saves them (`reload` saves and loads at once). */
function saveText(w: SimWorld) {
  return JSON.stringify({
    trains: w.fleet.trains.map((t) => t.toJSON()),
    stations: w.builder.stations.map((s) => s.toJSON()),
  });
}
/** A save loaded into the world `scene` lays afresh, as `reload` loads it. */
function loadText(text: string, scene: () => SimWorld): SimWorld {
  const j = JSON.parse(text) as {
    trains: ReturnType<Train['toJSON']>[];
    stations: ReturnType<Station['toJSON']>[];
  };
  const back = scene();
  const stations = j.stations.map((s) => Station.fromJSON(s));
  back.builder.stations.splice(0, back.builder.stations.length, ...stations);
  back.fleet.trains = j.trains.map((t) => Train.fromJSON(t, back.track));
  return back;
}
/** Seconds a loaded game runs on past the end of the shunt beside the game never saved. */
const AFTER_SHUNT = 5;

/**
 * The layouts saved after every tick of the shunt (indexes into SHUNT_LAYOUTS): between them both
 * facings of the throat, the other train from either end and the idle train either way round.
 * The others, to keep the run short, after every SPARSE-th tick and every tick within 2 of the
 * ones it sets off, turns and ends on.
 */
const EVERY_TICK = new Set([0, 7]);
const SPARSE = 4;

describe('with shunting on, a shunt saved and loaded at any tick of it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [n, l] of SHUNT_LAYOUTS.entries())
    it(
      `runs on as it does never saved, every step sound (${showLayout(l)}${EVERY_TICK.has(n) ? ', every tick' : ''})`,
      PROPERTY,
      () => {
        const on = shuntingOn();
        // the game never saved: a save after every tick from the one before the move sets off to the
        // one it ends on (the turn included), and every train after every tick
        const { w, sim, idle } = shuntingScene(l);
        const log = on.watch(w, () => sim.now);
        const frames: Frame[] = [];
        const saves: { tick: number; now: number; text: string }[] = [];
        let last = { now: sim.now, text: saveText(w) };
        let start = -1;
        let turn = -1;
        let end = -1;
        const turns = () => log.reversals.filter((r) => r.partway).length;
        for (let i = 0; i < 60 / GDT && (end < 0 || i <= end + AFTER_SHUNT / GDT); i++) {
          log.begin();
          const was = turns();
          sim.ticks(GDT);
          if (turns() > was) turn = i;
          expect(log.check()).toBeNull();
          frames.push(frameOf(w));
          if (start < 0 && idle.holding) {
            start = i;
            saves.push({ tick: i - 1, ...last });
          }
          if (start >= 0 && end < 0) saves.push({ tick: i, now: sim.now, text: saveText(w) });
          if (start >= 0 && end < 0 && !idle.holding) end = i;
          last = { now: sim.now, text: saveText(w) };
        }
        expect(end, 'the shunt never ended').toBeGreaterThan(turn);
        expect(turn, 'it never turned').toBeGreaterThan(start);
        expect(turns()).toBe(1);
        expectSound(sim);
        const near = (k: number) => [start - 1, turn, end].some((t) => Math.abs(k - t) <= 2);
        const loaded = saves.filter(
          (s) => EVERY_TICK.has(n) || (s.tick - start) % SPARSE === 0 || near(s.tick),
        );
        // each save loaded and run beside it: the first tick at which the two part, if any
        const parted: string[] = [];
        for (const s of loaded) {
          const back = loadText(s.text, () => shuntingLine(l.throatEast).w);
          const again = run(back, s.now);
          const logBack = on.watch(back, () => again.now);
          // the move each loaded train was on as it was saved: the rest of it, both legs of a shunt
          // until it turns
          for (const t of JSON.parse(s.text).trains as ReturnType<Train['toJSON']>[])
            if (t.retreat) {
              const { path, back: leg, group } = t.retreat;
              const plan = { path, back: leg, group, flip: false, distance: 0 };
              logBack.moves.push({ id: t.id, plan, at: s.now, bad: null });
            }
          for (let i = s.tick + 1; i < frames.length; i++) {
            logBack.begin();
            again.ticks(GDT);
            const why = logBack.check() ?? again.broken ?? parts(frames[i], frameOf(back));
            if (why) {
              parted.push(
                `saved after tick ${s.tick} (it sets off on ${start}, turns on ${turn}, ends on ${end}), ${i - s.tick} ticks on: ${why}`,
              );
              break;
            }
          }
          const { overlaps, deadlocks, stuck } = again.counters();
          if (overlaps + deadlocks + stuck)
            parted.push(
              `saved after tick ${s.tick}: ${JSON.stringify({ overlaps, deadlocks, stuck })}`,
            );
        }
        expect(parted).toEqual([]);
      },
    );
});

/** A train on a generated shunting line: its head at x, heading east or west, F7 and hoppers. */
interface GenTrain {
  x: number;
  east: boolean;
  wagons: number;
}
/**
 * A line on which only a shunt may clear the way (`GenLine` with no callers and no loops; its
 * quarry at the dead east end): one or two sidings facing either way, some too short to hold a
 * train; an idle train with no stop anywhere on it, facing either way, so any refuge will do; a
 * caller running between the warehouse at the west end and the quarry, setting off either way;
 * and the seconds into the run at which track is laid far off, so that every reservation goes
 * stale and a shunt under way stops where it is.
 */
interface ShuntCase {
  line: GenLine;
  idle: GenTrain;
  caller: GenTrain;
  builds: number[];
}
const spanOf = (t: GenTrain): Span =>
  t.east ? [t.x - tilesOf(t.wagons) + 1, t.x] : [t.x, t.x + tilesOf(t.wagons) - 1];
/** Track that can be laid, and both trains on plain main line, clear of each other. */
function validShunt(c: ShuntCase): boolean {
  const l = c.line;
  if (!validTrack(l) || l.callers.length || l.loops.length || !atEnd(l) || !l.sidings.length)
    return false;
  const spans = [spanOf(c.idle), spanOf(c.caller)];
  for (const span of spans) {
    if (span[0] < 7 || span[1] > l.end - 2) return false;
    if (turnouts(l).some((b) => meets(span, b))) return false;
  }
  return !meets(spans[0], spans[1], 2);
}
function shuntCase(rng: Rng): ShuntCase {
  for (;;) {
    const end = rng.int(40, 58);
    const line: GenLine = {
      end,
      quarry: end,
      sidings: [],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [],
    };
    const draw = (): GenTrain => ({
      x: rng.int(8, end - 2),
      east: rng.chance(0.5),
      wagons: rng.int(1, 2),
    });
    const idle = draw();
    // mostly facing away from the idle train: a siding west of it it could run straight into
    // has its throat facing east
    for (let n = rng.int(1, 2), i = 0; line.sidings.length < n && i < 40; i++) {
      const x = rng.int(8, end - 4);
      const away = rng.chance(0.75);
      const s = { x, east: x < idle.x !== away, len: rng.int(3, 8) };
      if (validTrack({ ...line, sidings: [...line.sidings, s] })) line.sidings.push(s);
    }
    for (let i = 0; i < 40; i++) {
      const c: ShuntCase = {
        line,
        idle,
        caller: draw(),
        builds: Array.from({ length: rng.int(0, 3) }, () => rng.int(5, 145)).sort((a, b) => a - b),
      };
      if (validShunt(c)) return c;
    }
  }
}
function* shrinkShunt(c: ShuntCase): Iterable<ShuntCase> {
  const out: ShuntCase[] = [];
  for (const builds of shrinkArray(c.builds)) out.push({ ...c, builds });
  for (const sidings of shrinkArray(c.line.sidings))
    out.push({ ...c, line: { ...c.line, sidings } });
  for (const wagons of shrinkInt(c.idle.wagons, 1)) out.push({ ...c, idle: { ...c.idle, wagons } });
  for (const wagons of shrinkInt(c.caller.wagons, 1))
    out.push({ ...c, caller: { ...c.caller, wagons } });
  c.line.sidings.forEach((s, i) => {
    for (const len of shrinkInt(s.len, 1)) {
      const sidings = c.line.sidings.map((d, j) => (j === i ? { ...d, len } : d));
      out.push({ ...c, line: { ...c.line, sidings } });
    }
  });
  for (const o of out) if (validShunt(o)) yield o;
}
/**
 * Seeds for the generated shunting lines: many cases hold no shunt, and each runs 150 s. Seed 160
 * once left the idle train, which has no stop, standing where the jam resolution backed it off,
 * saying it was pulling aside.
 */
const SHUNT_SEEDS = [...Array.from({ length: 60 }, (_, i) => i + 1), 160];
/**
 * Most turns partway, and moves aside or back, one train may make in a run of a generated shunting
 * line (150 s, up to three stale reservations): seen at most one and three.
 */
const SHUNTS_AT_MOST = 2;
const MOVES_AT_MOST = 6;

describe('with shunting on, trains on generated lines that only a shunt clears', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // the overlap, no-silent-stall and deadlock properties of `idle trains on generated lines`,
  // with shunting on: `watch` checks every step as it does there, and the shunt log what a shunt
  // promises (`shuntingOn`)
  it(
    'never share a tile, start a move into another train, turn but at rest and clear, or stall silently',
    PROPERTY,
    () => {
      let shunts = 0;
      const on = shuntingOn();
      forAll<ShuntCase>(
        shuntCase,
        (c) => {
          const { w, stations } = layLine(c.line);
          const sim = watch(w);
          const log = on.watch(w, () => sim.now);
          const idle = consist(w, c.idle.x, c.idle.east, c.idle.wagons);
          idle.mode = 'schedule';
          idle.idle('');
          const caller = consist(w, c.caller.x, c.caller.east, c.caller.wagons);
          caller.mode = 'schedule';
          const [first, then] = c.caller.east ? ['quarry', 'west'] : ['west', 'quarry'];
          caller.schedule = [first, then].map((s) => call(stations[s as StopName]!, 'none'));
          go(w, caller);
          let broken: string | null = null;
          const step = () => {
            broken ??= log.check() ?? sim.broken;
            log.begin();
            return broken !== null;
          };
          let at = 0;
          for (const t of c.builds) {
            sim.until(step, t - at);
            w.track.place(w.track.w - 2, w.track.h - 2, 'straight', 1);
            at = t;
          }
          sim.until(step, 150 - at);
          const counted = w.fleet.traffic.counters;
          const said = `${broken ?? 'no broken step'}; ${story(w, sim)}; moves ${JSON.stringify(log.moves.map((m) => [m.id, m.at.toFixed(2), !!m.plan.back]))}`;
          expect(broken, said).toBeNull();
          expect(counted.overlaps, said).toBe(0);
          // the caller got through, or the jam was counted
          expect(sim.arrivals(caller) > 0 || counted.deadlocks > 0, said).toBe(true);
          // no livelock: each train turns partway and sets off aside or back a bounded number of
          // times in the run
          for (const t of [idle, caller]) {
            const turns = log.reversals.filter((r) => r.id === t.id && r.partway).length;
            const moves = log.moves.filter((m) => m.id === t.id).length;
            shunts += turns;
            expect(turns, `turns partway by #${t.id}: ${said}`).toBeLessThanOrEqual(SHUNTS_AT_MOST);
            expect(moves, `moves by #${t.id}: ${said}`).toBeLessThanOrEqual(MOVES_AT_MOST);
          }
        },
        { seeds: SHUNT_SEEDS, shrink: shrinkShunt },
      );
      // the property is not vacuous: lines are cleared by a shunt (most others hold none at all)
      expect(shunts, 'turns partway over all the lines').toBeGreaterThan(10);
    },
  );
});

/**
 * Ticks of a shunt at which track is laid far off: this many spread over it, the turn's, and the
 * first, middle and last of each stretch it stands astride the switch.
 */
const STALE_AT = 12;

describe('with shunting on, a shunt whose lease goes stale part-way', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // track laid elsewhere makes every reservation stale (`Traffic.maintainRecoveries`): the shunt
  // stops where it is, the turn included, and the fleet looks again from there. Stopped astride
  // the switch, the idle train runs on clear of it and turns (`findShuntPath`'s `under`), so the
  // other train passes wherever it stopped but in one place: backed into the siding with the
  // other train come up to the switch behind it, it could clear the switch only by running on
  // deeper into the siding, which no refuge search offers until the whole train fits ahead of its
  // head (`findRefugePath`). There the jam is counted and said
  for (const l of SHUNT_LAYOUTS)
    it(
      `stops where it is, and makes way again from there for the other train to pass (${showLayout(l)})`,
      PROPERTY,
      () => {
        const on = shuntingOn();
        // the ticks it sets off, turns and ends on, and stands astride the switch, never made stale
        const first = shuntingScene(l);
        const log = on.watch(first.w, () => first.sim.now);
        const wk = first.w.track.w;
        let start = -1;
        let turn = -1;
        let end = -1;
        const astride: [number, number][] = [];
        for (let i = 0; i < 60 / GDT && end < 0; i++) {
          log.begin();
          const was = log.reversals.length;
          first.sim.ticks(GDT);
          if (start < 0 && first.idle.holding) start = i;
          if (log.reversals.slice(was).some((r) => r.partway)) turn = i;
          if (start >= 0 && !first.idle.holding) end = i;
          const now =
            first.idle.holding && first.idle.occupancyKeys(wk).some((k) => !plainAt(first.w, k));
          const last = astride.at(-1);
          if (now && last?.[1] === i - 1) last[1] = i;
          else if (now) astride.push([i, i]);
        }
        expect([start >= 0, turn > start, end > turn]).toEqual([true, true, true]);
        expect(astride.length, 'stretches astride the switch, out and back').toBe(2);
        const ticks = new Set([turn - 1, turn, turn + 1]);
        for (let k = 0; k < STALE_AT; k++)
          ticks.add(start + Math.floor(((end - start) * k) / STALE_AT));
        for (const [a, b] of astride) for (const k of [a, (a + b) >> 1, b]) ticks.add(k);
        const failed: string[] = [];
        for (const k of [...ticks].sort((a, b) => a - b)) {
          // the same game, made stale after tick k, every step watched as on generated lines
          const { w: lw, idle, caller, target } = shuntingScene(l);
          const sim = watch(lw);
          const slog = on.watch(lw, () => sim.now);
          let broken: string | null = null;
          const step = () => {
            broken ??= slog.check() ?? sim.broken;
            slog.begin();
            return broken !== null;
          };
          sim.until(step, (k + 1) * GDT - GDT / 2);
          // backed into the siding, the other train coming from the side the siding lets out to
          const shutIn =
            l.fromEast === l.throatEast &&
            idle.occupancyKeys(wk).some((q) => Math.floor(q / wk) >= ROW + 2);
          lw.track.place(lw.track.w - 2, lw.track.h - 2, 'straight', 1);
          const where = `made stale after tick ${k} (it sets off on ${start}, turns on ${turn}, ends on ${end})`;
          // holding its shunt as the track changes, it stops on the next step and looks again: it
          // stands idle saying it waits for a plan or what it found, or sets off on a new move
          const held = idle.holding;
          const moves = slog.moves.length;
          sim.until(step, GDT / 2);
          const anew = slog.moves.length > moves;
          const looks = [STR.traffic.replan, ...IN_THE_WAY].includes(idle.lastMessage);
          if (held && !anew && (idle.holding || idle.state !== 'idle' || !looks))
            failed.push(`${where}: it ran on, ${idle.state} saying "${idle.lastMessage}"`);
          sim.until(() => step() || (!idle.holding && sim.arrivals(caller) > 0), STALL * 2);
          const counted = lw.fleet.traffic.counters;
          if (broken) failed.push(`${where}: ${broken}`);
          else if (counted.overlaps) failed.push(`${where}: ${counted.overlaps} overlaps`);
          else if (!sim.arrivals(caller) && !(shutIn && counted.deadlocks))
            failed.push(
              `${where}: the caller never reached ${target.name}${shutIn ? ' and no jam was counted' : ''}: ${story(lw, sim)}`,
            );
        }
        expect(failed).toEqual([]);
      },
    );
});

// ------------------------------------------------------------------ shunting on, more generated lines

/**
 * A generated shunting line laid and its trains set as `trains on generated lines that only a
 * shunt clears` sets them: the idle train with no stop, and the caller calling at both ends of the
 * line without loading, sent off.
 */
function shuntWorld(c: ShuntCase) {
  const { w, stations } = layLine(c.line);
  const idle = consist(w, c.idle.x, c.idle.east, c.idle.wagons);
  idle.mode = 'schedule';
  idle.idle('');
  const caller = consist(w, c.caller.x, c.caller.east, c.caller.wagons);
  caller.mode = 'schedule';
  const stops: StopName[] = c.caller.east ? ['quarry', 'west'] : ['west', 'quarry'];
  caller.schedule = stops.map((s) => call(stations[s]!, 'none'));
  go(w, caller);
  return { w, idle, caller };
}
/** The trains of a world on a shunt: holding a move whose plan, as the log has it, turns partway. */
function onShunt(w: SimWorld, log: ShuntLog) {
  return w.fleet.trains.filter(
    (t) => t.holding && !!log.moves.filter((m) => m.id === t.id).at(-1)?.plan.back,
  );
}

/** Seconds a generated shunting line runs. */
const SHUNT_RUN = 150;
/** A generated shunting line with no track laid off it, and when during a shunt it is saved. */
interface SavedShunt {
  shunt: ShuntCase;
  /** which of the ticks it may be saved after it is saved after, as a fraction of them */
  pick: number;
  /**
   * The ticks it may be saved after: any after which a train is on a shunt or sets off on one the
   * next, or only those within 2 of setting off or of a turn, or past a turn, when the line has any
   */
  near: 'any' | 'start' | 'turn' | 'after';
}
/** Seeds for the saved shunts: about a quarter of the lines hold one. */
const SAVED_SHUNT_SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

describe('with shunting on, a shunt on a generated line saved and loaded at any tick of it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `a shunt saved and loaded at any tick of it`, on generated lines: saved after the tick before a
  // train sets off on a shunt or any tick it is on one (its first leg, its turn, its second leg),
  // the loaded game runs beside the game never saved until AFTER_SHUNT past the end of that shunt,
  // every train doing and saying the same and every car where it stands there, so no train runs
  // its way the wrong way round; then on to SHUNT_RUN. Every step of both holds to the shunt log,
  // no two trains ever share a tile, and the loaded game is never found unsound by `watch` at a
  // step at which the game never saved is still sound: whether that one is, is the property of
  // `trains on generated lines that only a shunt clears`
  it('runs on as never saved until the shunt ends, and no less soundly after', PROPERTY, () => {
    const on = shuntingOn();
    const where = new Map<string, number>();
    forAll<SavedShunt>(
      (rng) => ({
        shunt: { ...shuntCase(rng), builds: [] },
        pick: rng.next(),
        near: rng.pick(['any', 'start', 'turn', 'after'] as const),
      }),
      (c) => {
        const ticks = SHUNT_RUN / GDT;
        const step = (sim: ReturnType<typeof watch>, log: ShuntLog) => {
          log.begin();
          sim.until(() => false, GDT);
          return log.check();
        };
        // the game never saved: every train after every tick, the ticks after which a train is on
        // a shunt, those it sets off on one and turns on, and the first it is found unsound on
        const never = shuntWorld(c.shunt);
        const sim = watch(never.w);
        const log = on.watch(never.w, () => sim.now);
        const frames: Frame[] = [];
        const shunting = new Set<number>();
        const starts: number[] = [];
        const turns: number[] = [];
        let unsound = Infinity;
        for (let i = 0; i < ticks; i++) {
          const moves = log.moves.length;
          const reversals = log.reversals.length;
          const why = step(sim, log);
          if (why) throw new Error(`never saved: ${why}`);
          if (sim.broken !== null) unsound = Math.min(unsound, i);
          frames.push(frameOf(never.w));
          if (log.moves.slice(moves).some((m) => m.plan.back)) starts.push(i);
          if (log.reversals.slice(reversals).some((r) => r.partway)) turns.push(i);
          if (onShunt(never.w, log).length) shunting.add(i);
        }
        if (!shunting.size) return;
        const all = [...new Set([...starts.map((k) => k - 1), ...shunting])].filter((k) => k >= 0);
        const close = (marks: number[]) => (k: number) => marks.some((t) => Math.abs(k - t) <= 2);
        const near = all.filter(
          c.near === 'start'
            ? close(starts)
            : c.near === 'turn'
              ? close(turns)
              : c.near === 'after'
                ? (k) => turns.some((t) => k > t + 2)
                : () => false,
        );
        const pool = near.length ? near : all;
        const tick = pool[Math.min(pool.length - 1, Math.floor(c.pick * pool.length))];
        // the shunt it is on, or sets off on the next tick, ends on the first tick off one after it
        let end = tick + 1;
        while (end < ticks && shunting.has(end)) end++;
        const side = Math.min(ticks - 1, end + AFTER_SHUNT / GDT);
        // the same game run again to the end of that tick, and saved
        const again = shuntWorld(c.shunt);
        const simAgain = watch(again.w);
        const logAgain = on.watch(again.w, () => simAgain.now);
        for (let i = 0; i <= tick; i++) step(simAgain, logAgain);
        expect(parts(frames[tick], frameOf(again.w)), 'the same game run again').toBeNull();
        const shunter = onShunt(again.w, logAgain)[0] as unknown as Shunting | undefined;
        const at = !shunter
          ? 'before it sets off'
          : turns.some((t) => Math.abs(tick - t) <= 2)
            ? 'at its turn'
            : shunter.shunt
              ? 'on its first leg'
              : 'on its second leg';
        where.set(at, (where.get(at) ?? 0) + 1);
        const text = saveText(again.w);
        const back = loadText(text, () => layLine(c.shunt.line).w);
        const loaded = watch(back, simAgain.now);
        const logBack = on.watch(back, () => loaded.now);
        // the move each loaded train was on as it was saved: the rest of it, both legs of a shunt
        // until it turns
        for (const t of JSON.parse(text).trains as ReturnType<Train['toJSON']>[])
          if (t.retreat) {
            const { path, back: leg, group } = t.retreat;
            const plan = { path, back: leg, group, flip: false, distance: 0 };
            logBack.moves.push({ id: t.id, plan, at: simAgain.now, bad: null });
          }
        const saved = `saved after tick ${tick} ${at} (it ends on ${end})`;
        for (let i = tick + 1; i < ticks; i++) {
          const why =
            step(loaded, logBack) ??
            (i <= side ? parts(frames[i], frameOf(back)) : null) ??
            (i < unsound ? loaded.broken : null);
          if (why) throw new Error(`${saved}, ${i - tick} ticks on: ${why}`);
        }
        expect(never.w.fleet.traffic.counters.overlaps, `never saved: ${story(never.w, sim)}`).toBe(
          0,
        );
        expect(back.fleet.traffic.counters.overlaps, `${saved}: ${story(back, loaded)}`).toBe(0);
      },
      {
        seeds: SAVED_SHUNT_SEEDS,
        shrink: function* (c) {
          for (const pick of shrinkInt(Math.round(c.pick * 100))) yield { ...c, pick: pick / 100 };
          if (c.near !== 'any') yield { ...c, near: 'any' as const };
          for (const shunt of shrinkShunt(c.shunt)) yield { ...c, shunt };
        },
      },
    );
    // not vacuous: lines are saved on a shunt's first leg, at its turn and on its second leg (seen
    // 14, 16 and 14 times; once just before it sets off)
    for (const at of ['on its first leg', 'at its turn', 'on its second leg'])
      expect(where.get(at) ?? 0, `saves ${at}`).toBeGreaterThan(5);
  });
});

/**
 * A busier line for shunting: the main line of `GenLine` with one to three sidings, mostly facing
 * away from the first idle train and some too short to hold a train, and sometimes a passing loop;
 * the quarry at the dead east end or a through station; one or two idle trains, either way round,
 * bound for a station they cannot reach (`ISLAND`); one or two callers running between two
 * stations, either way first; and the seconds into the run at which track is laid far off, so that
 * every reservation goes stale.
 */
interface BusyCase {
  line: GenLine;
  idles: GenTrain[];
  callers: { at: GenTrain; stops: StopName[] }[];
  builds: number[];
}
/**
 * Track that can be laid, and every train on plain main line clear of turnouts, platforms and each
 * other; and, unless `partial`, at least one idle train and one caller.
 */
function validBusy(c: BusyCase, partial = false): boolean {
  const l = c.line;
  if (!validTrack(l) || l.callers.length || l.westIdle || !l.sidings.length) return false;
  if (!partial && (!c.idles.length || !c.callers.length)) return false;
  if (c.callers.some((k) => k.stops.includes('east') && atEnd(l))) return false;
  const spans = [...c.idles, ...c.callers.map((k) => k.at)].map(spanOf);
  for (const span of spans) {
    if (span[0] < 7 || span[1] > l.end - 2) return false;
    if (turnouts(l).some((b) => meets(span, b))) return false;
    if (platformsOf(l).some((p) => meets(span, [p, p], 1))) return false;
  }
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++) if (meets(spans[i], spans[j], 2)) return false;
  return true;
}
function busyCase(rng: Rng): BusyCase {
  for (;;) {
    const end = rng.int(44, 58);
    const quarry = rng.chance(0.5) ? end : rng.int(22, end - 10);
    const line: GenLine = {
      end,
      quarry,
      sidings: [],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [],
    };
    if (!validTrack(line)) continue;
    const draw = (): GenTrain => ({
      x: rng.int(8, end - 2),
      east: rng.chance(0.5),
      wagons: rng.int(1, 2),
    });
    const idles = Array.from({ length: rng.int(1, 2) }, draw);
    // a siding west of the idle train it could run straight into has its throat facing east
    for (let n = rng.int(1, 3), i = 0; line.sidings.length < n && i < 40; i++) {
      const x = rng.int(8, end - 4);
      const s = { x, east: x < idles[0].x !== rng.chance(0.75), len: rng.int(2, 8) };
      if (validTrack({ ...line, sidings: [...line.sidings, s] })) line.sidings.push(s);
    }
    for (let i = 0, n = rng.chance(0.3) ? 1 : 0; line.loops.length < n && i < 40; i++) {
      const o = { x: rng.int(8, end - 6), len: rng.int(2, 9) };
      if (validTrack({ ...line, loops: [o] })) line.loops.push(o);
    }
    const builds = Array.from({ length: rng.int(0, 3) }, () => rng.int(5, 145)).sort(
      (a, b) => a - b,
    );
    // each train drawn until it stands clear of the track and of the trains drawn before it
    let c: BusyCase = { line, idles: [], callers: [], builds };
    const two = () => (rng.chance(0.5) ? 2 : 1);
    const kinds = [...Array<string>(two()).fill('idle'), ...Array<string>(two()).fill('caller')];
    for (const kind of kinds)
      for (let i = 0; i < 40; i++) {
        const at = draw();
        const next =
          kind === 'idle'
            ? { ...c, idles: [...c.idles, at] }
            : { ...c, callers: [...c.callers, { at, stops: stopsFor(rng, line) }] };
        if (validBusy(next, true)) {
          c = next;
          break;
        }
      }
    if (validBusy(c)) return c;
  }
}
function* shrinkBusy(c: BusyCase): Iterable<BusyCase> {
  const out: BusyCase[] = [];
  for (const builds of shrinkArray(c.builds)) out.push({ ...c, builds });
  for (const idles of shrinkArray(c.idles)) out.push({ ...c, idles });
  for (const callers of shrinkArray(c.callers)) out.push({ ...c, callers });
  for (const loops of shrinkArray(c.line.loops)) out.push({ ...c, line: { ...c.line, loops } });
  for (const sidings of shrinkArray(c.line.sidings))
    out.push({ ...c, line: { ...c.line, sidings } });
  c.line.sidings.forEach((s, i) => {
    for (const len of shrinkInt(s.len, 1)) {
      const sidings = c.line.sidings.map((d, j) => (j === i ? { ...d, len } : d));
      out.push({ ...c, line: { ...c.line, sidings } });
    }
  });
  for (const o of out) if (validBusy(o)) yield o;
}
/** Where the station of a line's idle trains stands, on a stretch of track of its own. */
const ISLAND = { x: 10, y: ROW + 20 };
/** Seeds for the busier lines: each runs SHUNT_RUN seconds with up to four trains. */
const BUSY_SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
/** The notes of a train held in a jam: none of its trains can pull aside, or it always does. */
const HELD: string[] = [STR.traffic.jammed, STR.traffic.keptBack];

describe('with shunting on, trains on busier generated lines', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // the overlap, no-silent-stall and deadlock properties once more, with two idle trains that may
  // shunt, passing loops, through stations, callers meeting head-on and leases going stale: every
  // step sound by `watch` and the shunt log, no two trains ever on one tile, every caller calls
  // somewhere or a jam is counted with a note that says so, and no train turns partway or sets off
  // aside or back more than a bounded number of times
  it(
    'never share a tile, start a move into another train, turn but at rest and clear, or stall silently',
    PROPERTY,
    () => {
      const on = shuntingOn();
      let shunts = 0;
      forAll(
        busyCase,
        (c) => {
          const { w, stations } = layLine(c.line);
          const sim = watch(w);
          const log = on.watch(w, () => sim.now);
          // roaming trains with nothing to haul, bound for a station on track of its own they cannot
          // reach: they stay idle, and any refuge leaves them no worse off
          line(w, ISLAND.x, ISLAND.y, ISLAND.x + 6);
          const island = station(w, 'warehouse', ISLAND.x + 3, ISLAND.y - 1);
          const idles = c.idles.map((g) => {
            const t = consist(w, g.x, g.east, g.wagons);
            t.mode = 'production';
            t.schedule = [defaultStop(island.id)];
            t.idle('');
            return t;
          });
          const callers = c.callers.map(({ at, stops }) => {
            const t = consist(w, at.x, at.east, at.wagons);
            t.mode = 'schedule';
            t.schedule = stops.map((s) => call(stations[s]!, 'none'));
            go(w, t);
            return t;
          });
          let broken: string | null = null;
          // what each caller has said, as `#id note`
          const told = new Set<string>();
          const step = () => {
            broken ??= log.check() ?? sim.broken;
            log.begin();
            for (const t of callers) told.add(`#${t.id} ${t.lastMessage}`);
            return broken !== null;
          };
          let at = 0;
          for (const t of c.builds) {
            sim.until(step, t - at);
            w.track.place(w.track.w - 2, w.track.h - 2, 'straight', 1);
            at = t;
          }
          sim.until(step, SHUNT_RUN - at);
          // a caller still backing off runs on to where its move ends, where it says why it did
          sim.until(() => step() || !callers.some((t) => t.holding), STALL);
          const counted = w.fleet.traffic.counters;
          const said = `${broken ?? 'no broken step'}; ${story(w, sim)}; moves ${JSON.stringify(log.moves.map((m) => [m.id, m.at.toFixed(2), !!m.plan.back]))}`;
          expect(broken, said).toBeNull();
          expect(counted.overlaps, said).toBe(0);
          // every caller calls somewhere, or a jam is counted and the caller has said it is held in
          // one: jammed, or kept back by a train it keeps giving way to
          for (const t of callers) {
            if (sim.arrivals(t) > 0) continue;
            expect(counted.deadlocks, `#${t.id} never called: ${said}`).toBeGreaterThan(0);
            const held = HELD.some((note) => told.has(`#${t.id} ${note}`));
            expect(held, `#${t.id} never called nor said why: ${said}`).toBe(true);
          }
          for (const t of [...idles, ...callers]) {
            const turns = log.reversals.filter((r) => r.id === t.id && r.partway).length;
            const moves = log.moves.filter((m) => m.id === t.id).length;
            shunts += turns;
            expect(turns, `turns partway by #${t.id}: ${said}`).toBeLessThanOrEqual(BUSY_TURNS);
            expect(moves, `moves by #${t.id}: ${said}`).toBeLessThanOrEqual(BUSY_MOVES);
          }
        },
        { seeds: BUSY_SEEDS, shrink: shrinkBusy },
      );
      // the property is not vacuous: idle trains shunt on these lines
      expect(shunts, 'turns partway over all the lines').toBeGreaterThan(8);
    },
  );
});

/**
 * Most turns partway, and moves aside or back, one train may make in a run of a busier line (150 s,
 * up to three stale reservations): seen at most one and nine.
 */
const BUSY_TURNS = 2;
const BUSY_MOVES = 12;

/**
 * Two shunts at once on one line: the main line along ROW from x 4 to 58 with a warehouse in the
 * middle (platform x 30); a switch at x 16 with its throat facing west, its siding under x 17, and
 * one at x 44 with its throat facing east, its siding under x 44, so that no train between them
 * can run straight into either. An idle train stands on x 20 to 23 and another on x 37 to 40,
 * heads `facing` the switch nearer each or backing towards it; a caller sets off from x 9 heading
 * east and another from x 51 heading west, both for the warehouse, so each idle train is in the way
 * of one caller and not the other's: their waiting groups share no train, and each may lease an
 * escape while the other holds one. Both idle trains are bound for a station on track of their own
 * they cannot reach (`ISLAND`), so any refuge leaves them no worse off.
 */
function twoShuntsLine() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  lay(w, 16, ROW, 'switch', 7);
  siding(w, 17, ROW + 2);
  lay(w, 44, ROW, 'switch', 1);
  siding(w, 44, ROW + 2);
  line(w, 4, ROW, 15);
  line(w, 18, ROW, 43);
  line(w, 46, ROW, 58);
  const mid = station(w, 'warehouse', 30, ROW - 1);
  line(w, ISLAND.x, ISLAND.y, ISLAND.x + 6);
  const island = station(w, 'warehouse', ISLAND.x + 3, ISLAND.y - 1);
  return { w, mid, island };
}
function twoShunts(facing: boolean) {
  const { w, mid, island } = twoShuntsLine();
  const sim = run(w);
  // heading west, the west one faces the switch at x 16; heading east, the east one the one at 44
  const idles = [
    { x: facing ? 20 : 23, east: !facing },
    { x: facing ? 40 : 37, east: facing },
  ].map(({ x, east: e }) => {
    const t = train(w, x, e, 'production', [defaultStop(island.id)]);
    t.idle('');
    return t;
  });
  const callers = [
    train(w, 9, true, 'schedule', [call(mid)]),
    train(w, 51, false, 'schedule', [call(mid)]),
  ];
  for (const t of callers) go(w, t);
  return { w, sim, idles, callers };
}

describe('with shunting on, two idle trains in the way on one line, each beside a siding facing away', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const facing of [true, false])
    it(
      `both shunt at once on ways of their own and back into their sidings (${facing ? 'facing' : 'backing towards'} the switches)`,
      SLOW,
      () => {
        const on = shuntingOn();
        const { w, sim, idles, callers } = twoShunts(facing);
        const log = on.watch(w, () => sim.now);
        let broken: string | null = null;
        let together = 0;
        let shared: string | null = null;
        const wk = w.track.w;
        sim.until(() => {
          broken ??= log.check();
          log.begin();
          const leases = idles.map((t) => w.fleet.traffic.recoveries.active.get(t.id)?.tiles);
          if (leases[0] && leases[1]) {
            together++;
            for (const k of leases[0])
              if (leases[1].has(k)) shared ??= `${k % wk},${Math.floor(k / wk)} at ${sim.now}`;
          }
          return broken !== null || (log.moves.length >= 2 && idles.every((t) => !t.holding));
        }, 60);
        const told = `${broken}; ${idles.map((t) => `#${t.id} ${t.state} "${t.lastMessage}" at ${JSON.stringify(t.headTile)}`).join('; ')}; ${JSON.stringify(log.moves.map((m) => [m.id, m.at, !!m.plan.back]))}`;
        expect(broken, told).toBeNull();
        // one shunt each, both leased at the same time, no tile in both leases
        expect(
          log.moves.map((m) => [m.id, !!m.plan.back]),
          told,
        ).toEqual(expect.arrayContaining(idles.map((t) => [t.id, true])));
        expect(together, `steps both leases were held: ${told}`).toBeGreaterThan(0);
        expect(shared, told).toBeNull();
        expect(
          log.reversals
            .filter((r) => r.partway)
            .map((r) => r.id)
            .sort(),
          told,
        ).toEqual(idles.map((t) => t.id).sort());
        // each ends idle wholly in its siding, saying it made way
        idles.forEach((t, i) => {
          expect([t.state, t.lastMessage], told).toEqual(['idle', STR.traffic.madeWay]);
          for (const k of t.occupancyKeys(wk))
            expect([k % wk, Math.floor(k / wk) >= ROW + 2], told).toEqual([i ? 44 : 17, true]);
        });
        // and the callers come on to the warehouse, the first of them calling there, every step sound
        expect(sim.until(() => callers.some((t) => sim.arrivals(t).length > 0), 120)).toBe(true);
        sim.until(() => false, 60);
        expect(sim.broken).toBeNull();
        expect(w.fleet.traffic.counters.overlaps).toBe(0);
      },
    );

  // both leases are taken again on load, in the order the trains were saved in, the one train's
  // never in the other's way: saved after every third tick of the two shunts and every tick within
  // 2 of a turn, the loaded game runs as the game never saved to AFTER_SHUNT past their end
  for (const facing of [true, false])
    it(
      `saved and loaded at any tick of the two shunts, runs on as never saved (${facing ? 'facing' : 'backing towards'} the switches)`,
      PROPERTY,
      () => {
        const on = shuntingOn();
        const { w, sim, idles } = twoShunts(facing);
        const log = on.watch(w, () => sim.now);
        const frames: Frame[] = [];
        const saves: { tick: number; now: number; text: string }[] = [];
        const turns: number[] = [];
        let end = -1;
        for (let i = 0; i < 60 / GDT && (end < 0 || i <= end + AFTER_SHUNT / GDT); i++) {
          log.begin();
          const was = log.reversals.length;
          sim.ticks(GDT);
          expect(log.check()).toBeNull();
          if (log.reversals.slice(was).some((r) => r.partway)) turns.push(i);
          frames.push(frameOf(w));
          const holding = idles.some((t) => t.holding);
          if (holding && end < 0) saves.push({ tick: i, now: sim.now, text: saveText(w) });
          if (end < 0 && log.moves.length >= 2 && !holding) end = i;
        }
        expect(turns.length, 'turns partway').toBe(2);
        expect(end, 'the shunts never ended').toBeGreaterThan(Math.max(...turns));
        const loaded = saves.filter(
          (s) => s.tick % 3 === 0 || turns.some((t) => Math.abs(s.tick - t) <= 2),
        );
        expect(loaded.length, 'saves loaded').toBeGreaterThan(20);
        const parted: string[] = [];
        for (const s of loaded) {
          const back = loadText(s.text, () => twoShuntsLine().w);
          const again = run(back, s.now);
          const logBack = on.watch(back, () => again.now);
          for (const t of JSON.parse(s.text).trains as ReturnType<Train['toJSON']>[])
            if (t.retreat) {
              const { path, back: leg, group } = t.retreat;
              const plan = { path, back: leg, group, flip: false, distance: 0 };
              logBack.moves.push({ id: t.id, plan, at: s.now, bad: null });
            }
          for (let i = s.tick + 1; i < frames.length; i++) {
            logBack.begin();
            again.ticks(GDT);
            const why = logBack.check() ?? again.broken ?? parts(frames[i], frameOf(back));
            if (why) {
              parted.push(
                `saved after tick ${s.tick} (they turn on ${turns}, end on ${end}), ${i - s.tick} ticks on: ${why}`,
              );
              break;
            }
          }
          const { overlaps, deadlocks, stuck } = again.counters();
          if (overlaps + deadlocks + stuck)
            parted.push(
              `saved after tick ${s.tick}: ${JSON.stringify({ overlaps, deadlocks, stuck })}`,
            );
        }
        expect(parted).toEqual([]);
      },
    );
});

/**
 * A terminus line on which nothing holds a train off the main line: `anyLine`'s with the quarry at
 * the dead east end, no passing loop, no second idle train and every siding one or two tiles long,
 * and the seconds into the run at which track is laid far off. The caller is bound for the quarry
 * sooner or later, where the roaming train stands idle.
 */
interface JamCase {
  line: GenLine;
  builds: number[];
}
const jammedLine = (l: GenLine) =>
  valid(l) && atEnd(l) && !l.loops.length && !l.westIdle && l.sidings.every((s) => s.len <= 2);
function jamCase(rng: Rng): JamCase {
  for (;;) {
    const l = anyLine(rng);
    const sidings = l.sidings.map((s) => ({ ...s, len: rng.int(1, 2) }));
    const line = { ...l, sidings, loops: [], westIdle: 0 };
    if (!jammedLine(line)) continue;
    const builds = Array.from({ length: rng.int(0, 3) }, () => rng.int(5, 145)).sort(
      (a, b) => a - b,
    );
    return { line, builds };
  }
}
/** Seconds a line with no siding that holds a train runs: the caller may call at the west end first. */
const JAM_RUN = 300;

describe('with shunting on, a line with no siding that holds a train', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // shunting finds nowhere either, so it changes nothing: the line runs as it does with shunting
  // off, every train doing and saying the same and every car where it stands there at every step,
  // stale leases and all; no train sets off on a shunt, every step is sound, the jam is counted, and
  // the caller says it is jammed and the idle train that it is in the way
  it('runs as with shunting off, to a counted jam both trains say, with no shunt', PROPERTY, () => {
    forAll(
      jamCase,
      ({ line: l, builds }) => {
        const play = (shunting: boolean) => {
          vi.restoreAllMocks();
          const on = shunting ? shuntingOn() : null;
          const { w, sim, idle, callers, idled } = setUp(l);
          expect(idled, 'the idle train never idled').toBe(true);
          const [caller] = callers;
          const log = on?.watch(w, () => sim.now);
          const frames: Frame[] = [];
          const said = new Set<string>();
          let broken: string | null = null;
          const step = () => {
            broken ??= log?.check() ?? sim.broken;
            log?.begin();
            frames.push(frameOf(w));
            said.add(`#${caller.id} ${caller.lastMessage}`).add(`#${idle.id} ${idle.lastMessage}`);
            return broken !== null;
          };
          let at = 0;
          for (const t of builds) {
            sim.until(step, t - at);
            w.track.place(w.track.w - 2, w.track.h - 2, 'straight', 1);
            at = t;
          }
          sim.until(step, JAM_RUN - at);
          const shunts = log?.moves.filter((m) => m.plan.back).length ?? 0;
          return { w, sim, idle, caller, frames, said, broken, shunts };
        };
        const off = play(false);
        const on = play(true);
        const told = `${on.broken ?? 'no broken step'}; ${story(on.w, on.sim)}`;
        // frames are taken as each step begins: the same count, and each the same
        expect(on.frames.length, told).toBe(off.frames.length);
        const parted = on.frames.findIndex((f, i) => parts(off.frames[i], f) !== null);
        if (parted >= 0)
          throw new Error(
            `parts from shunting off at step ${parted}: ${parts(off.frames[parted], on.frames[parted])}`,
          );
        expect(on.broken, told).toBeNull();
        expect(on.shunts, `shunts: ${told}`).toBe(0);
        const { overlaps, deadlocks } = on.w.fleet.traffic.counters;
        expect(overlaps, told).toBe(0);
        expect(deadlocks, told).toBeGreaterThan(0);
        expect(on.said, told).toContain(`#${on.caller.id} ${STR.traffic.jammed}`);
        expect(
          IN_THE_WAY.some((note) => on.said.has(`#${on.idle.id} ${note}`)),
          told,
        ).toBe(true);
      },
      {
        seeds: LINE_SEEDS,
        shrink: function* (c) {
          for (const builds of shrinkArray(c.builds)) yield { ...c, builds };
          for (const line of shrinkLine(c.line, jammedLine)) yield { ...c, line };
        },
      },
    );
  });
});

describe('a train with no stop, backed off in a jam', () => {
  // seed 160 of the generated shunting lines, the train with no stop in the caller's way: backed
  // off into the siding, it stood there saying it was pulling aside, with nothing to wait for
  it('makes way as an idle train does, and stands with no route again after', SLOW, () => {
    const { w, stations } = layLine({
      end: 41,
      quarry: 41,
      sidings: [{ x: 24, east: true, len: 5 }],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [],
    });
    const sim = watch(w);
    const idle = consist(w, 32, false, 1);
    idle.mode = 'schedule';
    idle.idle('');
    const caller = consist(w, 29, true, 1);
    caller.mode = 'schedule';
    caller.schedule = [call(stations.quarry!, 'none'), call(stations.west!, 'none')];
    go(w, caller);
    const stop = () => sim.broken !== null;
    // with no stop it stands with no route (`depart`), and the jam resolution backs it off
    expect(
      sim.until(() => stop() || idle.state === 'noRoute', 15),
      story(w, sim),
    ).toBe(true);
    expect(
      sim.until(() => stop() || idle.holding, 60),
      'never backed off',
    ).toBe(true);
    expect([idle.makingWay, idle.lastMessage]).toEqual([true, STR.traffic.makingWay]);
    expect(
      sim.until(() => stop() || !idle.holding, 60),
      'its way never ended',
    ).toBe(true);
    expect([idle.state, idle.lastMessage]).toEqual(['idle', STR.traffic.madeWay]);
    // it asks again 10 s on, and stands with no route again, where it parked
    expect(sim.until(() => stop() || idle.state === 'noRoute', 10 + 2 * GDT)).toBe(true);
    sim.until(stop, 150 - sim.now);
    expect(sim.broken, story(w, sim)).toBeNull();
    expect(sim.arrivals(caller), story(w, sim)).toBeGreaterThan(0);
    expect(w.fleet.traffic.counters.overlaps).toBe(0);
  });
});

/**
 * Seed 30 of the busier generated lines: a train with nothing to haul parked in the only siding,
 * #2 shuttling between the quarry and the east warehouse, and #3 bound east from west of the
 * quarry, which meets #2 head-on and backs off each time, as #2 has nowhere to go.
 */
function keptBackScene() {
  const { w, stations } = layLine({
    end: 56,
    quarry: 32,
    sidings: [{ x: 43, east: false, len: 5 }],
    loops: [],
    idleWagons: 1,
    westIdle: 0,
    callers: [],
  });
  line(w, ISLAND.x, ISLAND.y, ISLAND.x + 6);
  const island = station(w, 'warehouse', ISLAND.x + 3, ISLAND.y - 1);
  return { w, stations, island };
}

describe('a working train that keeps giving way to the same train', () => {
  it('is kept back: the jam is counted and it says so, and the other runs on', SLOW, () => {
    const { w, stations, island } = keptBackScene();
    const sim = watch(w);
    const idle = consist(w, 35, false, 1);
    idle.mode = 'production';
    idle.schedule = [defaultStop(island.id)];
    idle.idle('');
    const shuttle = consist(w, 16, false, 2);
    shuttle.mode = 'schedule';
    shuttle.schedule = [call(stations.quarry!, 'none'), call(stations.east!, 'none')];
    go(w, shuttle);
    const kept = consist(w, 11, true, 1);
    kept.mode = 'schedule';
    kept.schedule = [call(stations.east!, 'none'), call(stations.west!, 'none')];
    go(w, kept);
    const counted = w.fleet.traffic.counters;
    const stop = () => sim.broken !== null;
    // the first time it gives way, nothing is counted and it says it pulled aside
    const backs = (n: number) => () => stop() || (kept.yieldCount === n && kept.holding);
    expect(sim.until(backs(1), 150), story(w, sim)).toBe(true);
    expect(
      sim.until(() => stop() || !kept.holding, 60),
      story(w, sim),
    ).toBe(true);
    expect([kept.state, kept.lastMessage]).toEqual(['yielding', STR.traffic.pullingAside]);
    expect(counted.deadlocks).toBe(0);
    // the second, for the same train with no stop reached between, the jam is counted as it sets
    // off, and where its way ends it says it is kept back
    expect(sim.until(backs(2), 150), story(w, sim)).toBe(true);
    expect(counted.deadlocks).toBe(1);
    expect(kept.lastMessage).toBe(STR.traffic.pullingAside);
    expect(
      sim.until(() => stop() || !kept.holding, 60),
      story(w, sim),
    ).toBe(true);
    expect([kept.state, kept.lastMessage]).toEqual(['yielding', STR.traffic.keptBack]);
    // it says so only while it waits where it pulled aside, and the other train keeps calling
    const calls = sim.arrivals(shuttle);
    const said = new Set<string>();
    sim.until(() => {
      if (kept.lastMessage === STR.traffic.keptBack) said.add(kept.state);
      return stop();
    }, 300);
    expect(sim.broken, story(w, sim)).toBeNull();
    expect([...said]).toEqual(['yielding']);
    expect(sim.arrivals(shuttle)).toBeGreaterThan(calls);
    expect(sim.arrivals(kept)).toBe(0);
    expect(counted.overlaps).toBe(0);
  });

  it('saved on its way back the second time, says it is kept back where the way ends', SLOW, () => {
    const { w, stations, island } = keptBackScene();
    const sim = watch(w);
    const idle = consist(w, 35, false, 1);
    idle.mode = 'production';
    idle.schedule = [defaultStop(island.id)];
    idle.idle('');
    const shuttle = consist(w, 16, false, 2);
    shuttle.mode = 'schedule';
    shuttle.schedule = [call(stations.quarry!, 'none'), call(stations.east!, 'none')];
    go(w, shuttle);
    const kept = consist(w, 11, true, 1);
    kept.mode = 'schedule';
    kept.schedule = [call(stations.east!, 'none'), call(stations.west!, 'none')];
    go(w, kept);
    const stop = () => sim.broken !== null;
    const second = () => stop() || (kept.yieldCount === 2 && kept.holding);
    expect(sim.until(second, 300), story(w, sim)).toBe(true);
    sim.until(stop, 1);
    expect(kept.holding, 'its way back ended within a second').toBe(true);
    const back = reload(w, () => keptBackScene().w);
    const again = watch(back, sim.now);
    const loaded = back.fleet.trains[2];
    // both run on side by side until the way back ends, never saved and loaded
    const tick = (s: ReturnType<typeof watch>) => s.until(() => false, GDT);
    for (let i = 0; i < 60 / GDT && (kept.holding || loaded.holding); i++) {
      tick(sim);
      tick(again);
    }
    expect(sim.broken, story(w, sim)).toBeNull();
    expect(again.broken, story(back, again)).toBeNull();
    for (const t of [kept, loaded])
      expect([t.state, t.lastMessage], t.name).toEqual(['yielding', STR.traffic.keptBack]);
  });
});

describe('a working train that gave way to a train and has reached a stop since', () => {
  // on the terminus line #1, roaming, backs off for #2 on its way to the quarry, reaches it and
  // finds nothing to haul, then makes way for #2 coming back there; once stone turns up it sets
  // off for it and meets #2 again. Its make-way adds to yieldCount as a back-off does, yet it has
  // reached a stop since it last backed off for #2, so it is not kept back
  it('is not kept back: no jam is counted and it says it is pulling aside', SLOW, () => {
    const { w, west, end } = terminus();
    const sim = watch(w);
    const roaming = train(w, 26, true, 'production', [defaultStop(end.id)]);
    const other = train(w, 37, false, 'schedule', [call(west, 'none'), call(end, 'none')]);
    go(w, roaming);
    go(w, other);
    const counted = w.fleet.traffic.counters;
    const stop = () => sim.broken !== null;
    const backsOff = () => roaming.holding && !roaming.makingWay;
    expect(
      sim.until(() => stop() || backsOff(), 30),
      story(w, sim),
    ).toBe(true);
    expect(
      sim.until(() => stop() || (roaming.state === 'idle' && roaming.atStation === end), 200),
      story(w, sim),
    ).toBe(true);
    expect(
      sim.until(() => stop() || roaming.makingWay, 60),
      story(w, sim),
    ).toBe(true);
    expect(
      sim.until(() => stop() || roaming.lastMessage === STR.traffic.madeWay, 60),
      story(w, sim),
    ).toBe(true);
    end.store('stone', 40);
    expect(
      sim.until(() => stop() || backsOff(), 120),
      story(w, sim),
    ).toBe(true);
    expect(sim.arrivals(roaming), story(w, sim)).toBe(1);
    expect(roaming.yieldCount).toBe(2);
    expect(counted.deadlocks).toBe(0);
    expect(
      sim.until(() => stop() || !roaming.holding, 60),
      story(w, sim),
    ).toBe(true);
    expect(sim.broken, story(w, sim)).toBeNull();
    expect([roaming.state, roaming.lastMessage]).toEqual(['yielding', STR.traffic.pullingAside]);
    expect(counted.deadlocks).toBe(0);
    expect(counted.overlaps).toBe(0);
  });
});

describe('a working train that gives way to one train and then another', () => {
  // the main line to x 56 with the quarry at x 30, and one siding at x 12 facing east: a train
  // heading east backs into it. #1 sets off east for the east warehouse and meets #2 coming west,
  // then, once it has set off from the siding, #3, which is put on the line only then as #2 leaves
  // service: it backs off for each in turn and reaches no stop in between, yet it is never kept back
  it('is not kept back: no jam is counted and it says it is pulling aside', SLOW, () => {
    const { w, stations } = layLine({
      end: 56,
      quarry: 30,
      sidings: [{ x: 12, east: true, len: 6 }],
      loops: [],
      idleWagons: 1,
      westIdle: 0,
      callers: [],
    });
    const sim = watch(w);
    const there = [call(stations.east!, 'none'), call(stations.west!, 'none')];
    const back = [call(stations.west!, 'none'), call(stations.east!, 'none')];
    const first = consist(w, 20, true, 1);
    first.mode = 'schedule';
    first.schedule = there;
    go(w, first);
    const one = consist(w, 44, false, 1);
    one.mode = 'schedule';
    one.schedule = back;
    go(w, one);
    const stop = () => sim.broken !== null;
    const gave: number[] = [];
    const own = first.gaveWay.bind(first);
    first.gaveWay = (other) => {
      gave.push(other);
      return own(other);
    };
    expect(
      sim.until(() => stop() || (first.yieldCount === 1 && first.holding), 60),
      story(w, sim),
    ).toBe(true);
    expect(
      sim.until(() => stop() || (first.state === 'moving' && !first.holding), 120),
      story(w, sim),
    ).toBe(true);
    expect(gave, story(w, sim)).toEqual([one.id]);
    // the first train it gave way to leaves service, and the second comes on
    w.fleet.recall(one);
    const two = consist(w, 52, false, 1);
    two.mode = 'schedule';
    two.schedule = back;
    go(w, two);
    expect(
      sim.until(() => stop() || (first.yieldCount === 2 && first.holding), 120),
      story(w, sim),
    ).toBe(true);
    expect(gave, story(w, sim)).toEqual([one.id, two.id]);
    expect(sim.arrivals(first), 'it reached a stop in between').toBe(0);
    expect(
      sim.until(() => stop() || !first.holding, 60),
      story(w, sim),
    ).toBe(true);
    expect(sim.broken, story(w, sim)).toBeNull();
    expect([first.state, first.lastMessage]).toEqual(['yielding', STR.traffic.pullingAside]);
    expect(w.fleet.traffic.counters.deadlocks).toBe(0);
  });
});

/**
 * The kept-back scene set going: the train with nothing to haul parked in the siding, the shuttle
 * and the train that keeps giving way to it, watched (`watch`).
 */
function keptBackRun() {
  const { w, stations, island } = keptBackScene();
  const sim = watch(w);
  const idle = consist(w, 35, false, 1);
  idle.mode = 'production';
  idle.schedule = [defaultStop(island.id)];
  idle.idle('');
  const shuttle = consist(w, 16, false, 2);
  shuttle.mode = 'schedule';
  shuttle.schedule = [call(stations.quarry!, 'none'), call(stations.east!, 'none')];
  go(w, shuttle);
  const kept = consist(w, 11, true, 1);
  kept.mode = 'schedule';
  kept.schedule = [call(stations.east!, 'none'), call(stations.west!, 'none')];
  go(w, kept);
  return { w, sim, kept };
}
/** Seconds a loaded game runs on beside the one never saved once the kept-back move has ended. */
const AFTER_KEPT = 5;

describe('a kept-back move saved and loaded at any tick of it', () => {
  // saved after the tick the train sets off on, kept back, after every tick of the move (92 of
  // them) and every tick of the 5 s past its end, and each save loaded and run beside the game
  // never saved: what a train last gave way to is not saved (traffic-current.md §8), so a save from
  // before it sets off may not keep it back, but one from any tick after must, every step as never
  // saved and as sound
  it('runs on as never saved and ends kept back, every step sound', PROPERTY, () => {
    const { w, sim, kept } = keptBackRun();
    const frames: Frame[] = [];
    const saves: { tick: number; now: number; text: string }[] = [];
    let start = -1;
    let end = -1;
    const step = (s: ReturnType<typeof watch>) => s.until(() => false, GDT);
    for (let i = 0; i < 400 / GDT && (end < 0 || i <= end + AFTER_KEPT / GDT); i++) {
      step(sim);
      if (sim.broken) break;
      frames.push(frameOf(w));
      if (start < 0 && kept.holding && kept.yieldCount === 2) start = i;
      if (start >= 0) saves.push({ tick: i, now: sim.now, text: saveText(w) });
      if (start >= 0 && end < 0 && !kept.holding) end = i;
    }
    expect(sim.broken, story(w, sim)).toBeNull();
    expect(start, 'it never gave way a second time').toBeGreaterThanOrEqual(0);
    expect(end, 'its move never ended').toBeGreaterThan(start);
    expect([kept.state, kept.lastMessage]).toEqual(['yielding', STR.traffic.keptBack]);
    const parted: string[] = [];
    for (const s of saves) {
      const back = loadText(s.text, () => keptBackScene().w);
      const again = watch(back, s.now);
      for (let i = s.tick + 1; i < frames.length; i++) {
        step(again);
        const why = again.broken ?? parts(frames[i], frameOf(back));
        if (why) {
          parted.push(
            `saved after tick ${s.tick} (it sets off on ${start}, ends on ${end}), ${i - s.tick} ticks on: ${why}`,
          );
          break;
        }
      }
      const t = back.fleet.byId(kept.id)!;
      if (!parted.length && (t.state !== 'yielding' || t.lastMessage !== STR.traffic.keptBack))
        parted.push(`saved after tick ${s.tick}: ends ${t.state} saying "${t.lastMessage}"`);
      expect(back.fleet.traffic.counters.overlaps).toBe(0);
    }
    expect(parted).toEqual([]);
    // not vacuous: saves on the way, as it ends and after
    expect(saves.filter((s) => s.tick < end).length).toBeGreaterThan(10);
    expect(saves.filter((s) => s.tick >= end).length).toBeGreaterThan(2);
  });
});

// ------------------------------------------------------------------ the kept-back rule, event by event

/** The private Train members: whether the escape `retreat` set off on makes way, and a stop. */
interface Escaping {
  aside: boolean;
  arrive(st: Station): void;
}
/**
 * One thing that happens to a working train, as the kept-back rule reads it: it sets off on an
 * escape in a jam for train `other`, holding a stop (`back`), making way while idle (`aside`) or
 * with no stop at all (`noStop`); it reaches a stop (`arrive`) or the station of a fuel detour
 * (`detour`); or the game is saved and loaded.
 */
type GiveWay =
  | { kind: 'back' | 'aside' | 'noStop'; other: number }
  | { kind: 'arrive' }
  | { kind: 'detour' }
  | { kind: 'reload' };
const showGiveWays = (es: GiveWay[]) =>
  es.map((e) => ('other' in e ? `${e.kind} #${e.other}` : e.kind)).join(', ');
/** Seeds for the event sequences: each case is a handful of calls on one train, no fleet ticks. */
const GIVE_WAY_SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);

describe('Train.gaveWay against the kept-back rule, over any order of give-ways, stops and saves', () => {
  // The fleet notes every escape the jam resolution sets a train off on (`gaveWay`, right after
  // `retreat`). Here a train in the terminus scene is put through generated orders of escapes, for
  // two other trains, with stops, fuel detours and save-and-load between, each escape leaving it as
  // `retreat` does (holding, making way or not, one more `yieldCount`), and every answer is held to
  // the rule as traffic-current.md §5 states it (`keptBackRule`): kept back exactly when the last
  // escape it set off on in a jam, holding a stop, since it last reached a station (a fuel detour's
  // too: the fleet's `onArrive` counts it) and in this game since it was loaded, was for the same
  // train
  it('keeps a train back exactly when the rule does', () => {
    let backAfterStop = 0;
    let keptBack = 0;
    forAll<GiveWay[]>(
      (rng) =>
        Array.from({ length: rng.int(1, 12) }, (): GiveWay => {
          const kind = rng.pick([
            'back',
            'back',
            'back',
            'aside',
            'aside',
            'noStop',
            'arrive',
            'arrive',
            'detour',
            'reload',
          ] as const);
          return kind === 'back' || kind === 'aside' || kind === 'noStop'
            ? { kind, other: rng.int(2, 3) }
            : { kind };
        }),
      (events) => {
        const { w, end } = terminus();
        let t = train(w, 26, true, 'production', [defaultStop(end.id)]);
        let rule = keptBackRule();
        const rules = [rule];
        rule.follow(t, () => 0);
        // the train each escape holding a stop was for since the last stop, and before it
        let since: number | null = null;
        let beforeStop: number | null = null;
        for (const e of events) {
          if (e.kind === 'arrive' || e.kind === 'detour') {
            if (e.kind === 'detour') t.detour = end.id;
            (t as unknown as Escaping).arrive(end);
            t.detour = null;
            rule.arrived(t);
            beforeStop = since ?? beforeStop;
            since = null;
            continue;
          }
          if (e.kind === 'reload') {
            t = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), w.track);
            rule = keptBackRule();
            rules.push(rule);
            rule.follow(t, () => 0);
            since = beforeStop = null;
            continue;
          }
          const schedule = t.schedule;
          if (e.kind === 'noStop') t.schedule = [];
          const escaping = t as unknown as Escaping;
          escaping.aside = e.kind === 'aside';
          t.holding = true;
          t.yieldCount++;
          const kept = t.gaveWay(e.other);
          if (kept) keptBack++;
          if (e.kind === 'back') {
            if (since === null && beforeStop === e.other && t.yieldCount > 1) backAfterStop++;
            since = e.other;
          }
          t.holding = false;
          escaping.aside = false;
          t.schedule = schedule;
        }
        for (const r of rules) expect(r.broken(), showGiveWays(events)).toBeNull();
      },
      { seeds: GIVE_WAY_SEEDS, shrink: (es) => shrinkArray(es), format: showGiveWays },
    );
    // not vacuous: trains kept back, and trains that gave way to the train they had given way to
    // before their last stop, having pulled aside since that stop (`yieldCount` above 1)
    expect(keptBack).toBeGreaterThan(100);
    expect(backAfterStop).toBeGreaterThan(20);
  });
});

/**
 * The terminus scene of `a working train that gave way to a train and has reached a stop since`,
 * generated: the main line along ROW with the quarry at its dead end and a warehouse at the other,
 * one dead-end siding whose throat faces the quarry, a roaming train between the siding and the
 * quarry bound for the quarry and a scheduled train between it and the quarry heading away.
 * Columns are given as on the line whose quarry stands at its east end; `east: false` mirrors
 * them, the quarry at the west end.
 */
interface Revisit {
  east: boolean;
  /** the quarry's platform, at the line's dead end; the warehouse's is at WEST */
  quarry: number;
  /** the switch block's column on the warehouse side */
  switchAt: number;
  /** tiles of dead-end siding */
  siding: number;
  roamWagons: number;
  otherWagons: number;
  /** the roaming train's head, heading for the quarry */
  roamAt: number;
  /** the other train's head, heading away from the quarry */
  otherAt: number;
}
/**
 * Tiles from the switch to the quarry at least: the other train runs that far and back while the
 * roaming train makes way and idles in the siding, so it is still about the quarry, mostly, when
 * the roaming train sets off for the stone.
 */
const REVISIT_REACH = 18;
/**
 * A scene that can be laid: the siding holds the roaming train; the other train standing at the
 * warehouse, the roaming train at the quarry and both where they start stand clear of the switch;
 * the two start apart, both on the line.
 */
function revisitOk(c: Revisit): boolean {
  const roam = tilesOf(c.roamWagons);
  const other = tilesOf(c.otherWagons);
  if (c.quarry < 40 || c.quarry > 58 || c.roamWagons < 1 || c.otherWagons < 1) return false;
  if (c.siding < roam + 1 || c.quarry - c.switchAt < REVISIT_REACH) return false;
  if (c.switchAt < WEST + other + 3 || c.roamAt - roam + 1 < c.switchAt + 3) return false;
  return c.otherAt >= c.roamAt + 2 && c.otherAt + other - 1 <= c.quarry;
}
function revisitCase(rng: Rng): Revisit {
  for (;;) {
    const quarry = rng.int(40, 58);
    const roamWagons = rng.int(1, 2);
    const otherWagons = rng.int(1, 2);
    const switchAt = rng.int(WEST + tilesOf(otherWagons) + 3, quarry - REVISIT_REACH);
    const roamAt = rng.int(switchAt + 2 + tilesOf(roamWagons), quarry - tilesOf(otherWagons) - 3);
    const c: Revisit = {
      east: rng.chance(0.5),
      quarry,
      switchAt,
      siding: tilesOf(roamWagons) + rng.int(1, 3),
      roamWagons,
      otherWagons,
      roamAt,
      otherAt: rng.int(roamAt + 2, quarry - tilesOf(otherWagons) + 1),
    };
    if (revisitOk(c)) return c;
  }
}
/** Smaller scenes still laid: fewer wagons, a shorter siding, the line shorter, the trains nearer. */
function* shrinkRevisit(c: Revisit): Iterable<Revisit> {
  const out: Revisit[] = [];
  if (!c.east) out.push({ ...c, east: true });
  for (const roamWagons of shrinkInt(c.roamWagons, 1)) out.push({ ...c, roamWagons });
  for (const otherWagons of shrinkInt(c.otherWagons, 1)) out.push({ ...c, otherWagons });
  for (const siding of shrinkInt(c.siding, 1)) out.push({ ...c, siding });
  for (const quarry of shrinkInt(c.quarry, 40)) out.push({ ...c, quarry });
  for (const otherAt of shrinkInt(c.otherAt, c.roamAt + 2)) out.push({ ...c, otherAt });
  for (const switchAt of shrinkInt(c.switchAt, WEST)) out.push({ ...c, switchAt });
  for (const o of out) if (revisitOk(o)) yield o;
}
/** Lays a generated scene: `at` maps a column as on the east-facing line to where it lies. */
function revisitLine(c: Revisit) {
  const w = simWorld({ terrain: 'grass', size: 64 });
  const at = (x: number) => (c.east ? x : c.quarry + 4 - x);
  // the switch block's west column; its throat faces the quarry, the siding under its far column
  const x = c.east ? c.switchAt : at(c.switchAt + 1);
  lay(w, x, ROW, 'switch', c.east ? 1 : 7);
  for (let y = ROW + 2; y < ROW + 2 + c.siding; y++) lay(w, c.east ? x : x + 1, y, 'straight', 0);
  line(w, 4, ROW, x - 1);
  line(w, x + 2, ROW, c.quarry);
  const warehouse = station(w, 'warehouse', at(WEST), ROW - 1);
  const quarry = station(w, 'quarry', at(c.quarry), ROW - 1);
  return { w, warehouse, quarry, at };
}
/** Seeds of the generated scenes: each runs four or five minutes of game time. */
const REVISIT_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('a working train that meets the train it gave way to again after its stop, on generated lines', () => {
  // the roaming train backs off for the other, reaches the quarry and finds nothing to haul, makes
  // way for the other coming back and idles in the siding; stone turns up and it sets off for it.
  // Meeting the other again it backs off as before, its make-way since its stop counted in
  // yieldCount, yet it is not kept back: no jam is counted and it says it is pulling aside. Each
  // give-way is held to the rule (`watch`), and every step to what `watch` checks
  it('backs off for it as a train never kept back does, the jam not counted', PROPERTY, () => {
    let met = 0;
    forAll(
      revisitCase,
      (c) => {
        const { w, warehouse, quarry, at } = revisitLine(c);
        const sim = watch(w);
        const roam = consist(w, at(c.roamAt), c.east, c.roamWagons);
        roam.mode = 'production';
        roam.schedule = [defaultStop(quarry.id)];
        const other = consist(w, at(c.otherAt), !c.east, c.otherWagons);
        other.mode = 'schedule';
        other.schedule = [call(warehouse, 'none'), call(quarry, 'none')];
        go(w, roam);
        go(w, other);
        const counted = w.fleet.traffic.counters;
        const stop = () => sim.broken !== null;
        const until = (what: string, done: () => boolean, seconds: number) => {
          const ok = sim.until(() => stop() || done(), seconds);
          expect(sim.broken, story(w, sim)).toBeNull();
          expect(ok, `${what}: ${story(w, sim)}`).toBe(true);
        };
        const backsOff = () => roam.holding && !roam.makingWay;
        until('it never backed off for the other', backsOff, 60);
        expect(counted.deadlocks, story(w, sim)).toBe(0);
        until('it never reached the quarry', () => sim.arrivals(roam) > 0, 200);
        until('it never made way', () => roam.makingWay, 200);
        until(
          'it never idled where it made way',
          () => roam.state === 'idle' && roam.lastMessage === STR.traffic.madeWay,
          60,
        );
        quarry.store('stone', 40);
        // the jams counted before the step it backs off in, which counts one if it is kept back;
        // it may load at the quarry without meeting the other: then there is nothing to check
        let jams = counted.deadlocks;
        until(
          'it neither met the other again nor loaded the stone',
          () => {
            if (backsOff()) return true;
            jams = counted.deadlocks;
            return roam.totalCargo() > 0;
          },
          120,
        );
        if (!backsOff()) return;
        met++;
        expect(sim.arrivals(roam), story(w, sim)).toBe(1);
        expect(roam.yieldCount, story(w, sim)).toBeGreaterThan(1);
        until('its way aside never ended', () => !roam.holding, 60);
        expect([roam.state, roam.lastMessage], story(w, sim)).toEqual([
          'yielding',
          STR.traffic.pullingAside,
        ]);
        expect(counted.deadlocks, story(w, sim)).toBe(jams);
        sim.until(stop, 30);
        expect(sim.broken, story(w, sim)).toBeNull();
        expect(counted.overlaps, story(w, sim)).toBe(0);
      },
      { seeds: REVISIT_SEEDS, shrink: shrinkRevisit },
    );
    // not vacuous: on most lines the two meet again
    expect(met).toBeGreaterThanOrEqual(Math.ceil((REVISIT_SEEDS.length * 3) / 4));
  });
});
