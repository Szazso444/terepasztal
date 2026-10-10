import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import type { TrackKind } from '../world/track';
import { findPath, type PathSegment } from '../world/pathfinding';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { sharedTiles } from '../testing/trafficScenario';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { blockingGroups } from './recovery';
import { Train, defaultStop, resetTrainIds, type RouteMode, type StopPlan } from './trains';
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
 * The game clock starts at `from`: 0 for a new world, the save's time for a loaded one.
 */
function watch(w: SimWorld, from = 0) {
  let now = from;
  let broken: string | null = null;
  const arrivals = new Map<number, number>();
  const next = w.fleet.onArrive;
  w.fleet.onArrive = (t, s) => {
    arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
    next?.(t, s);
  };
  // every deadlock the jam resolution declares: where each train of it stood, and when one counted
  const traffic = w.fleet.traffic;
  const declare = traffic.deadlock.bind(traffic);
  const declared = new Map<number, { x: number; y: number }>();
  const counted = new Map<number, number>();
  traffic.deadlock = (chain, at) => {
    const was = traffic.counters.deadlocks;
    declare(chain, at);
    for (const t of chain) {
      const p = t.poses[0];
      if (p) declared.set(t.id, { x: p.x, y: p.y });
      if (traffic.counters.deadlocks > was) counted.set(t.id, at);
    }
  };
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
    const way = t.pathAhead();
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
    w.fleet.tick(GDT, (now += GDT));
    broken ??= check(before);
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
 * game time. Trains keep their ids through the load.
 */
function savedAndLoaded(c: SavedLine) {
  const tick = saveTick(c);
  const { w, sim, callers, idled } = setUp(c.line);
  expect(idled, 'the roaming trains never idled').toBe(true);
  for (let i = 0; i <= tick && sim.broken === null; i++) sim.until(() => false, GDT);
  const at = `saved after tick ${tick}`;
  expect(sim.broken, `${at}, before the save: ${story(w, sim)}`).toBeNull();
  const back = reload(w, () => layLine(c.line).w);
  return { back, again: watch(back, sim.now), callers: callers.map((t) => t.id), at };
}

describe('idle trains on generated lines, saved and loaded at any tick', () => {
  // A load forgets what the save does not hold: the path a train under way had planned, the way a
  // train waiting aside or an idle train standing in another's way wants to take (`wantAside`),
  // and when an idle train may look again for a way aside (docs/traffic-current.md §8 and §9). So
  // a loaded line need not run on exactly as it would have (the fixed scenes of
  // src/sim/trainResume.test.ts do), but it runs on soundly.
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
