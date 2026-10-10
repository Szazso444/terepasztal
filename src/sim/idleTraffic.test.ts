import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import type { TrackKind } from '../world/track';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { sharedTiles } from '../testing/trafficScenario';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
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
const platformsOf = (l: GenLine) => (atEnd(l) ? [WEST, l.quarry] : [WEST, l.quarry, l.end]);
const quarryIdleSpan = (l: GenLine): Span => [l.quarry - tilesOf(l.idleWagons) + 1, l.quarry];
const westIdleSpan = (l: GenLine): Span => [WEST, WEST + tilesOf(l.westIdle) - 1];
const callerSpan = (c: GenCaller): Span => [c.x - tilesOf(c.wagons) + 1, c.x];
const idleSpans = (l: GenLine) => [quarryIdleSpan(l), ...(l.westIdle ? [westIdleSpan(l)] : [])];

/** Track the builder can lay and the idle trains can stand on: switch blocks clear of both. */
function validTrack(l: GenLine): boolean {
  if (l.end < 40 || l.end > 58) return false;
  if (!atEnd(l) && (l.quarry < 22 || l.quarry > l.end - 10)) return false;
  for (const s of l.sidings) {
    const b = blockOf(s);
    if (b[0] < 8 || b[1] > l.end - 2 || s.len < 1) return false;
    if (platformsOf(l).some((p) => meets(b, [p, p], 1))) return false;
    if (idleSpans(l).some((t) => meets(b, t, 1))) return false;
  }
  for (let i = 0; i < l.sidings.length; i++)
    for (let j = i + 1; j < l.sidings.length; j++)
      if (meets(blockOf(l.sidings[i]), blockOf(l.sidings[j]), 2)) return false;
  return true;
}
/** A valid track with at least one caller, each on plain main line clear of every other train. */
function valid(l: GenLine): boolean {
  if (!validTrack(l) || !l.callers.length) return false;
  const taken = idleSpans(l);
  for (const c of l.callers) {
    const span = callerSpan(c);
    if (span[0] < 6 || span[1] > l.end - 1 || c.stops.length < 2) return false;
    if (l.sidings.some((s) => meets(span, blockOf(s)))) return false;
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
 * one caller anywhere on the line, and sometimes a second idle train at the west end. One caller
 * only, so every pair of trains has an idle one in it.
 */
function anyLine(rng: Rng): GenLine {
  for (;;) {
    const end = rng.int(40, 58);
    const l: GenLine = {
      end,
      quarry: rng.chance(0.5) ? end : rng.int(22, end - 10),
      sidings: [],
      idleWagons: rng.int(1, 2),
      westIdle: rng.chance(0.3) ? rng.int(1, 2) : 0,
      callers: [],
    };
    if (!validTrack(l)) continue;
    for (let n = rng.int(0, 2), i = 0; l.sidings.length < n && i < 40; i++) {
      const s = { x: rng.int(8, end - 3), east: rng.chance(0.5), len: rng.int(3, 8) };
      if (validTrack({ ...l, sidings: [...l.sidings, s] })) l.sidings.push(s);
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
 * Smaller lines that are still `ok` (valid by default): fewer sidings and callers, fewer wagons,
 * shorter sidings.
 */
function* shrinkLine(l: GenLine, ok = valid): Iterable<GenLine> {
  const out: GenLine[] = [];
  for (const sidings of shrinkArray(l.sidings)) out.push({ ...l, sidings });
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
  const blocks = [...l.sidings].sort((a, b) => a.x - b.x);
  let from = 4;
  for (const s of blocks) {
    lay(w, s.x, ROW, 'switch', s.east ? 1 : 7);
    for (let y = ROW + 2; y < ROW + 2 + s.len; y++)
      lay(w, s.east ? s.x : s.x + 1, y, 'straight', 0);
    if (s.x - 1 >= from) line(w, from, ROW, s.x - 1);
    from = s.x + 2;
  }
  line(w, from, ROW, l.end);
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

/**
 * Steps the fleet as the game does and checks after every step what must hold whatever the line:
 * no two trains on one tile; no station with more trains on its platforms than it has, nor an idle
 * one among them; an idle train has no path ahead, never moves, and claims no tile but those under
 * its cars; a train making way says so; and an idle train says it is in the way only while another
 * train's route crosses its tiles, and says so within SAY_IN_WAY seconds of standing there.
 */
function watch(w: SimWorld) {
  let now = 0;
  let broken: string | null = null;
  const arrivals = new Map<number, number>();
  const next = w.fleet.onArrive;
  w.fleet.onArrive = (t, s) => {
    arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
    next?.(t, s);
  };
  const inWay = new Map<number, number>();
  const clear = new Map<number, number>();
  const wk = w.track.w;
  const check = (before: Map<number, { state: string; x: number; y: number }>) => {
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
    for (const t of trains) {
      const name = `#${t.id}`;
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
      w.fleet.trains.map((t) => [t.id, { state: t.state, x: t.poses[0].x, y: t.poses[0].y }]),
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

  it(
    'let the train behind run its schedule when there is a way aside without reversing',
    PROPERTY,
    () => {
      forAll(
        clearLine,
        (l) => {
          const { w, sim, callers, idled } = setUp(l);
          expect(idled, 'the idle train never idled').toBe(true);
          const [caller] = callers;
          const ran = sim.until(() => sim.arrivals(caller) >= 3, 300);
          expect(ran, `the caller stopped running: ${story(w, sim)}`).toBe(true);
          expect(sim.broken, story(w, sim)).toBeNull();
        },
        { seeds: LINE_SEEDS, shrink: (l) => shrinkLine(l, hasWayAside) },
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

  it('take up work again from where they made way', PROPERTY, () => {
    forAll(
      clearLine,
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
      { seeds: LINE_SEEDS, shrink: (l) => shrinkLine(l, hasWayAside) },
    );
  });
});
