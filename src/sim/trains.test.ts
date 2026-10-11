import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TrackGraph,
  CLASS_N,
  TRACK_CLASSES,
  isUnitKind,
  makePiece,
  pieceLinks,
  rotationCount,
  type TrackClass,
} from '../world/track';
import { unitDef } from '../world/trackGeom';
import { Dir, DIRS, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { Train, defaultStop, resetTrainIds, type RouteMode } from './trains';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { gaugeOf } from './compat';
import { Polyline, vehicleFronts, vehicleSpec, type BodyFields } from './body';
import { walkBack, type PathSegment } from '../world/pathfinding';
import { content, type Gauge } from '../data/content';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { forAll, shrinkArray, shrinkInt, SEEDS } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  // a warehouse is worth collecting from with what a level 1 store holds
  rules.collectMin = 30;
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
});

const SIZE = 96;
const ROW = 30;
const GDT = 0.05;
/** How long a roaming train keeps away from a stop it found no way to (`Train.depart`). */
const BAD_FOR = 240;
const ROAMING: RouteMode[] = ['production', 'collection', 'transport', 'contract'];
type Kind = 'quarry' | 'warehouse' | 'farm' | 'station' | 'depot';
const KINDS: Kind[] = ['quarry', 'warehouse', 'farm', 'station', 'depot'];

/** A station on the line: its gate on the line is its platform. */
interface Site {
  kind: Kind;
  x: number;
  /** holds goods (or, for a town, has people around it) */
  stocked: boolean;
}
/** A roaming train working a contract, and where on the job the contract closes. */
interface Closing {
  mode: RouteMode;
  /** on the line; the first is the contract's origin quarry, the second its destination warehouse */
  sites: Site[];
  /** the stop the train had before the job: a site by index, or -1 for a station off the rails */
  home: number;
  trainX: number;
  east: boolean;
  /** a coach behind the hopper, for passengers */
  coach: boolean;
  /** the leg of the job the contract closes on */
  leg: 'origin' | 'dest';
  /** fleet ticks into that leg */
  wait: number;
}

function closing(rng: Rng): Closing {
  const slots = rng.shuffle(Array.from({ length: 13 }, (_, i) => 8 + 6 * i));
  const n = rng.int(2, 6);
  return {
    mode: rng.pick(ROAMING),
    sites: slots.slice(0, n).map((x, i) => ({
      kind: i === 0 ? 'quarry' : i === 1 ? 'warehouse' : rng.pick(KINDS),
      x,
      stocked: i === 0 || rng.chance(0.6),
    })),
    home: rng.chance(0.5) ? -1 : rng.int(0, n - 1),
    trainX: rng.int(10, 84),
    east: rng.chance(0.5),
    coach: rng.chance(0.3),
    leg: rng.chance(0.5) ? 'origin' : 'dest',
    wait: rng.int(0, 40),
  };
}
function* shrinkClosing(c: Closing): Iterable<Closing> {
  for (const rest of shrinkArray(c.sites.slice(2))) {
    const sites = [...c.sites.slice(0, 2), ...rest];
    yield { ...c, sites, home: c.home < sites.length ? c.home : -1 };
  }
  if (c.home !== -1) yield { ...c, home: -1 };
  if (c.coach) yield { ...c, coach: false };
  if (c.leg === 'dest') yield { ...c, leg: 'origin' };
  for (const wait of shrinkInt(c.wait)) yield { ...c, wait };
  for (let i = 1; i < c.sites.length; i++)
    if (c.sites[i].stocked)
      yield { ...c, sites: c.sites.map((s, j) => (j === i ? { ...s, stocked: false } : s)) };
}

/** A grass map with one straight line along row 30. */
function world() {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass),
    track = new TrackGraph(SIZE, SIZE),
    stock = new Stockpile(),
    economy = new Economy(),
    inventory = new Inventory();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  for (let x = 2; x < 90; x++) track.place(x, ROW, 'straight', 1);
  return { map, track, builder, fleet };
}
function stockUp(s: Station) {
  if (s.def.id === 'quarry' || s.def.id === 'warehouse') s.storage.set('stone', 40);
  else if (s.def.id === 'farm') s.storage.set('wheat', 30);
  else if (s.def.id === 'station') s.passengerPopulation = 60;
}

/**
 * The case's line and stations, and a diesel on it whose program is the one stop `home` that
 * takes up the contract from the quarry to the warehouse, as a train with no route does.
 */
function scene(c: Closing) {
  const w = world();
  const put = (kind: Kind, x: number, y: number) => {
    const s = new Station(kind, x, y);
    w.builder.stations.push(s);
    return s;
  };
  const sites = c.sites.map((site) => {
    const s = put(site.kind, site.x, ROW - 1);
    if (site.stocked) stockUp(s);
    return s;
  });
  const dead = put('farm', 40, ROW + 20);
  const home = c.home < 0 ? dead : sites[c.home];
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  if (c.coach)
    t.wagons.push({
      uid: 3,
      def: wagonDef('wooden_coach'),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    });
  expect(t.spawnAt(w.track, c.trainX, ROW, c.east ? Dir.W : Dir.E)).not.toBe(false);
  t.oil = t.oilCap;
  t.mode = c.mode;
  t.schedule = [defaultStop(home.id)];
  t.addJob({
    contractId: 1,
    name: 'stone',
    originId: sites[0].id,
    destId: sites[1].id,
    cargo: 'stone',
  });
  w.fleet.trains.push(t);
  const arrivals: number[] = [];
  w.fleet.onArrive = (_t, s) => void arrivals.push(s.id);
  let now = 0;
  return {
    w,
    t,
    sites,
    home,
    arrivals,
    get now() {
      return now;
    },
    tick() {
      w.fleet.tick(GDT, (now += GDT));
    },
    /** Tick until `done` holds, for at most `seconds` of game time; returns whether it does. */
    until(done: () => boolean, seconds: number) {
      for (let i = 0; i < seconds / GDT && !done(); i++) w.fleet.tick(GDT, (now += GDT));
      return done();
    },
  };
}
type Scene = ReturnType<typeof scene>;

const target = (t: Train) => t.route[t.routeIndex % t.route.length];
/**
 * Can the train get to a station's platform from where it stands: `no` when no rail under it
 * leads there, `underfoot` when a platform lies under the train itself (it is there already, or
 * the platform is under its cars where no path reaches), else `yes`.
 */
function reach({ w, t }: Pick<Scene, 'w' | 't'>, s: Station): 'yes' | 'no' | 'underfoot' {
  const keys = w.builder.platformTiles(s).map((p) => p.y * SIZE + p.x);
  const h = t.headTile!;
  const tiles = w.fleet.reachableTiles([h.y * SIZE + h.x]);
  if (!keys.some((k) => tiles.has(k))) return 'no';
  const under = new Set(t.occupancyKeys(SIZE));
  return keys.some((k) => under.has(k)) ? 'underfoot' : 'yes';
}

/**
 * How the contract closes on a train under way: as it runs (`tick`); with the game saved and
 * loaded just before the close (`reloadBefore`, as `ContractDispatch.reconcile` drops a closed
 * contract's job after a load) or just after it, before the next tick (`reloadAfter`: the save
 * keeps the set-aside program but not the pending hand-back); or with the rail under the train's
 * head taken up first, so that it stands stranded until the rail is laid again (`stranded`).
 */
type How = 'tick' | 'reloadBefore' | 'reloadAfter' | 'stranded';
/** The train as saved and loaded again, in its place in the fleet: it carries on as it was. */
function reloaded(w: ReturnType<typeof world>, t: Train): Train {
  const back = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), w.track);
  w.fleet.trains[w.fleet.trains.indexOf(t)] = back;
  expect(back.state).toBe(t.state);
  return back;
}
/** Game seconds a stranded train stands off the rails before they are laid again. */
const OFF_RAILS = 5;
/** Game seconds between a stranded or routeless train's retries (`Train.tick`), plus a tick. */
const RETRY = 4 + 2 * GDT;

/**
 * Close the contract with the train under way on the case's leg of the job. On the fleet tick
 * after, the train is back on its own program and has chosen again: it heads for the fleet's pick,
 * or with nothing worth picking for the stop it had before the job. If it can get there it goes
 * (or, standing on it, is there); if not, it marks that stop bad and waits to choose again. It
 * never stands in `noRoute` retrying a stop it cannot reach, and while the mark lasts it does not
 * head for the marked stop. The same holds on the first tick after a reload on either side of the
 * close, and, for a train stranded when the contract closes, on its first retry once the rail is
 * back (off the rails it waits with the job's stops untouched). Returns whether the contract did
 * close under way, for the coverage count.
 */
function closeUnderWay(c: Closing, how: How = 'tick'): boolean {
  const sc = scene(c);
  const { w } = sc;
  let t = sc.t;
  const leg = () => t.job !== null && t.jobPhase === c.leg && t.state === 'moving' && !t.holding;
  // the job starts once the train finds it has no route; the destination leg after loading
  if (!sc.until(leg, c.leg === 'origin' ? 10 : 300)) return false;
  for (let i = 0; i < c.wait && leg(); i++) sc.tick();
  // stopped on the way, or already there: not a contract closing under way
  if (!leg()) return false;
  let relay = () => {};
  if (how === 'stranded') {
    // the rail under the head is taken up
    const h = t.headTile!;
    w.track.remove(h.x, h.y);
    sc.tick();
    expect(t.state).toBe('stranded');
    relay = () => void w.track.place(h.x, h.y, 'straight', 1);
  }
  const aside = t.toJSON().suspended!;
  expect(aside, 'the program is set aside while the job runs').not.toBeNull();
  const before = aside.schedule[(aside.routeIndex + 1) % aside.schedule.length].stationId;

  // the fleet's own choice, seen as the train asks for it
  const picks: (number | null)[] = [];
  const choose = w.fleet.chooseNext.bind(w.fleet);
  w.fleet.chooseNext = (tr) => {
    const r = choose(tr);
    if (tr === t) picks.push(r);
    return r;
  };
  if (how === 'reloadBefore') t = sc.t = reloaded(w, t);
  t.dropJob(1);
  if (how === 'reloadAfter') t = sc.t = reloaded(w, t);
  if (how === 'stranded') {
    // off the rails it can only wait, the job's stops and its program as they were
    const jobStops = t.route;
    for (let i = 0; i < OFF_RAILS / GDT; i++) {
      sc.tick();
      expect(t.state, `${sc.now.toFixed(2)} s off the rails`).toBe('stranded');
      expect(t.route, `${sc.now.toFixed(2)} s off the rails`).toEqual(jobStops);
    }
    expect(t.toJSON().suspended).toEqual(aside);
    expect(picks).toEqual([]);
    relay();
    const back = sc.until(() => !t.toJSON().suspended, RETRY);
    expect(back, 'its program still set aside on the rails again').toBe(true);
  } else sc.tick();
  expect(t.job).toBeNull();
  expect(t.toJSON().suspended, 'still set aside a tick on').toBeNull();
  expect(t.program).toBe(t.schedule);
  expect(picks, 'chose again how many times').toHaveLength(1);
  const want = picks[0] ?? before;
  expect(t.route).toEqual([want]);
  expect(t.routeIndex).toBe(0);
  expect(t.state).not.toBe('noRoute');
  const stop = w.builder.stationById(want)!;
  const can = reach(sc, stop);
  if (can === 'yes') expect(['moving', 'loading']).toContain(t.state);
  if (can === 'no') expect(t.state).toBe('idle');
  if (t.state === 'moving') {
    const end = t.pathAhead().at(-1)!;
    const plat = w.builder.platformTiles(stop);
    expect(
      plat.some((p) => p.x === end.x && p.y === end.y),
      'path ends elsewhere',
    ).toBe(true);
  } else if (t.state === 'loading') expect(t.atStation).toBe(stop);
  else {
    expect(t.state).toBe('idle');
    expect(t.isBadTarget(want, sc.now), 'idles without marking its stop').toBe(true);
  }

  // and from then on it runs as a roaming train does
  const marked = t.state === 'idle' ? { id: want, until: sc.now + BAD_FOR } : null;
  const seen = sc.arrivals.length;
  for (let i = 0; i < 120 / GDT; i++) {
    sc.tick();
    const at = `${sc.now.toFixed(2)} s`;
    expect(t.state, at).not.toBe('noRoute');
    if (marked && sc.now < marked.until && t.state === 'moving')
      expect(target(t), `${at}: heads for its marked stop`).not.toBe(marked.id);
  }
  expect(sc.arrivals.length > seen || t.state === 'idle', `ends ${t.state}`).toBe(true);
  return true;
}

describe('a roaming train whose contract closes under way', () => {
  it(
    'chooses again, and with no way to its stop marks it bad and waits',
    { timeout: 120_000 },
    () => {
      let underWay = 0;
      forAll(closing, (c) => void (underWay += Number(closeUnderWay(c))), {
        shrink: shrinkClosing,
      });
      // most cases do close the contract under way, so the property is not passed by default
      expect(underWay).toBeGreaterThanOrEqual(SEEDS.length * 0.6);
    },
  );
  it(
    'does the same after a reload on either side of the close, and once the rail is back under it',
    { timeout: 120_000 },
    () => {
      const HOW: How[] = ['reloadBefore', 'reloadAfter', 'stranded'];
      type Case = Closing & { how: How };
      const underWay: Record<How, number> = {
        tick: 0,
        reloadBefore: 0,
        reloadAfter: 0,
        stranded: 0,
      };
      forAll(
        (rng): Case => ({ ...closing(rng), how: rng.pick(HOW) }),
        (c) => void (underWay[c.how] += Number(closeUnderWay(c, c.how))),
        {
          shrink: function* (c) {
            for (const s of shrinkClosing(c)) yield { ...s, how: c.how };
          },
        },
      );
      // each way is tried on enough cases that do close under way
      for (const how of HOW) expect(underWay[how], how).toBeGreaterThanOrEqual(20);
    },
  );
});

describe('a train whose contract closes while it has no route to the job', () => {
  const MODES: RouteMode[] = ['schedule', ...ROAMING];
  /**
   * `dropJob` promises the program back at the next stop, or at once under way. A train that
   * cannot reach the job's origin stands in `noRoute` and has no next stop: once the contract
   * closes, the closed job's stops must not keep it there.
   */
  function closedInNoRoute(mode: RouteMode) {
    const w = world();
    const put = (kind: Kind, x: number, y = ROW - 1) => {
      const s = new Station(kind, x, y);
      w.builder.stations.push(s);
      return s;
    };
    const quarry = put('quarry', 40),
      farm = put('farm', 70),
      warehouse = put('warehouse', 80),
      // the contract's origin: no rail reaches it
      origin = put('quarry', 60, ROW + 20);
    stockUp(quarry);
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    t.wagons = [
      { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
    ];
    t.spawnAt(w.track, 20, ROW, Dir.W);
    t.oil = t.oilCap;
    t.mode = mode;
    t.schedule =
      mode === 'schedule'
        ? [defaultStop(quarry.id), defaultStop(farm.id)]
        : [defaultStop(quarry.id)];
    t.addJob({
      contractId: 1,
      name: 'stone',
      originId: origin.id,
      destId: warehouse.id,
      cargo: 'stone',
    });
    w.fleet.trains.push(t);
    let now = 0;
    const run = (seconds: number) => {
      for (let i = 0; i < seconds / GDT; i++) w.fleet.tick(GDT, (now += GDT));
    };
    run(5);
    expect(t.job?.contractId).toBe(1);
    expect(t.state).toBe('noRoute');
    const own = t.program;
    t.dropJob(1);
    /** Back on its own program, no longer on the closed job's stops, and not stuck there. */
    const expectBack = (tr: Train) => {
      expect(tr.toJSON().suspended, 'its program still set aside').toBeNull();
      expect(tr.route, 'still on the closed job').not.toEqual([origin.id, warehouse.id]);
      if (mode === 'schedule') expect(tr.schedule).toEqual(own);
      expect(tr.state).not.toBe('noRoute');
    };
    return { w, t, own, run, expectBack };
  }
  MODES.forEach((mode) =>
    it(`goes back to its program (${mode})`, () => {
      const { t, own, run, expectBack } = closedInNoRoute(mode);
      run(10);
      expectBack(t);
      if (mode === 'schedule') expect(t.schedule).toBe(own);
    }),
  );
  MODES.forEach((mode) =>
    it(`goes back on the next tick, as under way (${mode})`, () => {
      const { t, run, expectBack } = closedInNoRoute(mode);
      run(GDT);
      expectBack(t);
    }),
  );
  MODES.forEach((mode) =>
    it(`goes back after a reload that falls between the close and the next tick (${mode})`, () => {
      const { w, t, run, expectBack } = closedInNoRoute(mode);
      // the save keeps the set-aside program, not the pending hand-back; the train loads standing
      // without a route, as it was saved
      const back = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), w.track);
      w.fleet.trains[w.fleet.trains.indexOf(t)] = back;
      expect(back.job).toBeNull();
      expect(back.toJSON().suspended).not.toBeNull();
      run(10);
      expectBack(back);
    }),
  );
});

/** A train that took up a contract no rail reaches, and the contract closing as it stands there. */
interface Unreached {
  mode: RouteMode;
  /** on the line; the first is a quarry, the second the contracts' destination warehouse */
  sites: Site[];
  /** the train's own program: a site by index, or -1 and -2 for the two stations off the rails */
  program: number[];
  /** the stop of the program the train was bound for when it took the job up */
  index: number;
  trainX: number;
  east: boolean;
  /** a coach behind the hopper, for passengers */
  coach: boolean;
  /** a second contract queued behind the one that closes: from the line's quarry, or off the rails */
  queued: 'none' | 'line' | 'dead';
  /** fleet ticks in `noRoute` with the job before the contract closes */
  wait: number;
  /** the game saved and loaded just before the close, or just after it */
  reload: 'none' | 'before' | 'after';
}

/** No stop follows itself, the last one included (the first follows it). */
const cyclicDistinct = (xs: number[]) =>
  xs.length < 2 || xs.every((x, i) => x !== xs[(i + 1) % xs.length]);

function unreached(rng: Rng): Unreached {
  const slots = rng.shuffle(Array.from({ length: 13 }, (_, i) => 8 + 6 * i));
  const n = rng.int(2, 6);
  const mode: RouteMode = rng.chance(0.4) ? 'schedule' : rng.pick(ROAMING);
  const len = mode === 'schedule' ? rng.int(2, 4) : 1;
  const stops = [...Array.from({ length: n }, (_, i) => i), -1, -2];
  const program: number[] = [];
  for (let i = 0; i < len; i++) {
    const next = new Set([program[i - 1], i === len - 1 ? program[0] : undefined]);
    program.push(rng.pick(stops.filter((s) => !next.has(s))));
  }
  return {
    mode,
    sites: slots.slice(0, n).map((x, i) => ({
      kind: i === 0 ? 'quarry' : i === 1 ? 'warehouse' : rng.pick(KINDS),
      x,
      stocked: i === 0 || rng.chance(0.6),
    })),
    program,
    index: rng.int(0, len - 1),
    trainX: rng.int(10, 84),
    east: rng.chance(0.5),
    coach: rng.chance(0.3),
    queued: rng.pick(['none', 'none', 'line', 'dead'] as const),
    wait: rng.int(0, 100),
    reload: rng.pick(['none', 'none', 'before', 'after'] as const),
  };
}
function* shrinkUnreached(c: Unreached): Iterable<Unreached> {
  if (c.reload !== 'none') yield { ...c, reload: 'none' };
  if (c.queued !== 'none') yield { ...c, queued: 'none' };
  if (c.coach) yield { ...c, coach: false };
  for (const wait of shrinkInt(c.wait)) yield { ...c, wait };
  if (c.index) yield { ...c, index: 0 };
  if (c.program.length > 2)
    for (let i = 0; i < c.program.length; i++) {
      const program = c.program.filter((_, j) => j !== i);
      if (cyclicDistinct(program))
        yield { ...c, program, index: Math.min(c.index, program.length - 1) };
    }
  // a station beyond the first two that the program does not call at
  for (let i = c.sites.length - 1; i >= 2; i--)
    if (!c.program.includes(i))
      yield {
        ...c,
        sites: c.sites.filter((_, j) => j !== i),
        program: c.program.map((k) => (k > i ? k - 1 : k)),
      };
  for (let i = 1; i < c.sites.length; i++)
    if (c.sites[i].stocked)
      yield { ...c, sites: c.sites.map((s, j) => (j === i ? { ...s, stocked: false } : s)) };
}

/**
 * The train takes up a contract whose origin no rail reaches and stands in `noRoute`; the
 * contract closes there. On the next fleet tick (also when the game was saved and loaded just
 * before or just after the close) it never again works the closed job:
 * - with another contract queued, it takes that one up, its own program still set aside as it
 *   was, and heads for the new origin (or, with no rail there either, stands without a route);
 * - otherwise it is back on its own program: a schedule train at the stop after the one it was
 *   bound for, a roaming train at the fleet's pick (or, with nothing worth picking, its own stop).
 *   It goes there if it can; if not, a schedule train stands without a route to that stop and a
 *   roaming train marks it bad and waits. From then on a schedule train keeps its stops and
 *   calls at them in order from there, and a roaming train never stands without a route.
 */
function closeUnreachable(c: Unreached) {
  const w = world();
  const put = (kind: Kind, x: number, y: number) => {
    const s = new Station(kind, x, y);
    w.builder.stations.push(s);
    return s;
  };
  const sites = c.sites.map((site) => {
    const s = put(site.kind, site.x, ROW - 1);
    if (site.stocked) stockUp(s);
    return s;
  });
  // off the rails: two stations a program may name, the closing contract's origin and another
  const dead = [put('farm', 10, ROW + 20), put('farm', 25, ROW + 20)];
  const origin = put('quarry', 60, ROW + 20);
  const nextOrigin = c.queued === 'dead' ? put('quarry', 75, ROW + 20) : sites[0];
  const own = c.program.map((k) => defaultStop((k >= 0 ? sites[k] : dead[-1 - k]).id));
  let t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  if (c.coach)
    t.wagons.push({
      uid: 3,
      def: wagonDef('wooden_coach'),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    });
  expect(t.spawnAt(w.track, c.trainX, ROW, c.east ? Dir.W : Dir.E)).not.toBe(false);
  t.oil = t.oilCap;
  t.mode = c.mode;
  t.schedule = own;
  t.routeIndex = c.index;
  const dest = sites[1];
  t.addJob({ contractId: 1, name: 'stone', originId: origin.id, destId: dest.id, cargo: 'stone' });
  if (c.queued !== 'none')
    t.addJob({
      contractId: 2,
      name: 'more stone',
      originId: nextOrigin.id,
      destId: dest.id,
      cargo: 'stone',
    });
  w.fleet.trains.push(t);
  // calls at stations, fuel stops on the way left out
  const calls: number[] = [];
  w.fleet.onArrive = (tr, s) => void (tr.detour !== s.id && calls.push(s.id));
  let now = 0;
  const tick = () => w.fleet.tick(GDT, (now += GDT));
  // a new train finds it has no route, takes the contract up and finds none to its origin either
  for (let i = 0; i < 10 / GDT && !t.job; i++) tick();
  for (let i = 0; i < c.wait; i++) tick();
  expect(t.job?.contractId).toBe(1);
  expect(t.state).toBe('noRoute');
  expect(calls).toEqual([]);
  const aside = t.toJSON().suspended;
  expect(aside, 'the program set aside for the job').toEqual({
    schedule: own,
    routeIndex: c.index,
  });

  const picks: (number | null)[] = [];
  const choose = w.fleet.chooseNext.bind(w.fleet);
  w.fleet.chooseNext = (tr) => {
    const r = choose(tr);
    if (tr === t) picks.push(r);
    return r;
  };
  if (c.reload === 'before') t = reloaded(w, t);
  t.dropJob(1);
  if (c.reload === 'after') t = reloaded(w, t);
  tick();
  expect(t.route, 'still on the closed job').not.toEqual([origin.id, dest.id]);
  if (c.queued !== 'none') {
    expect(t.job?.contractId, 'the queued contract').toBe(2);
    expect(t.jobPhase).toBe('origin');
    expect(t.route).toEqual([nextOrigin.id, dest.id]);
    expect(t.routeIndex).toBe(0);
    expect(t.toJSON().suspended, 'its program, set aside').toEqual(aside);
    const can = reach({ w, t }, nextOrigin);
    if (can === 'yes') expect(['moving', 'loading']).toContain(t.state);
    if (can === 'no') expect(t.state).toBe('noRoute');
    for (let i = 0; i < 60 / GDT; i++) {
      tick();
      expect(t.job?.contractId, `${now.toFixed(2)} s`).toBe(2);
      expect(t.route, `${now.toFixed(2)} s`).toEqual([nextOrigin.id, dest.id]);
    }
    expect(t.toJSON().suspended, 'its program, set aside').toEqual(aside);
    return;
  }

  expect(t.job).toBeNull();
  expect(t.toJSON().suspended, 'its program still set aside').toBeNull();
  expect(t.program).toBe(t.schedule);
  const n = own.length;
  const rejoin = (c.index + 1) % n;
  let want: number;
  if (c.mode === 'schedule') {
    expect(t.schedule).toEqual(own);
    expect(t.routeIndex, 'rejoins at the stop after the one it was bound for').toBe(rejoin);
    want = own[rejoin].stationId;
  } else {
    expect(picks, 'chose again how many times').toHaveLength(1);
    want = picks[0] ?? own[0].stationId;
    expect(t.route).toEqual([want]);
    expect(t.routeIndex).toBe(0);
  }
  const stop = w.builder.stationById(want)!;
  const can = reach({ w, t }, stop);
  if (can === 'yes') expect(['moving', 'loading']).toContain(t.state);
  if (can === 'no') expect(t.state).toBe(c.mode === 'schedule' ? 'noRoute' : 'idle');
  if (t.state === 'moving') {
    const end = t.pathAhead().at(-1)!;
    const plat = w.builder.platformTiles(stop);
    expect(
      plat.some((p) => p.x === end.x && p.y === end.y),
      'path ends elsewhere',
    ).toBe(true);
  } else if (t.state === 'loading') expect(t.atStation).toBe(stop);
  else if (t.state === 'idle')
    expect(t.isBadTarget(want, now), 'idles without marking its stop').toBe(true);
  else expect(t.state).toBe('noRoute');
  if (c.mode !== 'schedule') expect(t.state).not.toBe('noRoute');

  const marked = t.state === 'idle' ? { id: want, until: now + BAD_FOR } : null;
  const stops = own.map((s) => s.stationId);
  for (let i = 0; i < 120 / GDT; i++) {
    tick();
    const at = `${now.toFixed(2)} s`;
    if (c.mode === 'schedule') expect(t.route, `${at}: its stops`).toEqual(stops);
    else expect(t.state, at).not.toBe('noRoute');
    if (marked && now < marked.until && t.state === 'moving')
      expect(target(t), `${at}: heads for its marked stop`).not.toBe(marked.id);
  }
  if (c.mode === 'schedule') {
    // in order from where it rejoined, as far as it gets
    expect(calls).toEqual(calls.map((_, i) => stops[(rejoin + i) % n]));
    if (can === 'yes') expect(calls.length, 'calls at no stop').toBeGreaterThan(0);
  } else expect(calls.length > 0 || t.state === 'idle', `ends ${t.state}`).toBe(true);
}

describe('a train whose contract closes while it stands with no route to the job', () => {
  it(
    'never works the closed job again: it takes up the queued contract or its own program at once',
    { timeout: 120_000 },
    () => {
      const seen = { schedule: 0, roaming: 0, queued: 0, reloaded: 0 };
      forAll(
        unreached,
        (c) => {
          closeUnreachable(c);
          seen[c.mode === 'schedule' ? 'schedule' : 'roaming']++;
          if (c.queued !== 'none') seen.queued++;
          if (c.reload !== 'none') seen.reloaded++;
        },
        { shrink: shrinkUnreached },
      );
      // every kind of case is tried often enough to matter
      for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThanOrEqual(15);
    },
  );
});

describe('a schedule train whose contract closes while it stands stranded', () => {
  it('waits off the rails, then on its first retry rejoins its stops after the one it left', () => {
    const w = world();
    const put = (kind: Kind, x: number) => {
      const s = new Station(kind, x, ROW - 1);
      w.builder.stations.push(s);
      return s;
    };
    const quarry = put('quarry', 40),
      farm = put('farm', 60),
      town = put('station', 75),
      warehouse = put('warehouse', 85);
    stockUp(quarry);
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    t.wagons = [
      { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
    ];
    expect(t.spawnAt(w.track, 15, ROW, Dir.W)).not.toBe(false);
    t.oil = t.oilCap;
    const own = [defaultStop(farm.id), defaultStop(town.id)];
    t.schedule = own;
    t.addJob({
      contractId: 1,
      name: 'stone',
      originId: quarry.id,
      destId: warehouse.id,
      cargo: 'stone',
    });
    w.fleet.trains.push(t);
    const calls: number[] = [];
    w.fleet.onArrive = (_t, s) => void calls.push(s.id);
    let now = 0;
    const tick = () => w.fleet.tick(GDT, (now += GDT));
    // it takes the contract up and sets off for the quarry
    for (let i = 0; i < 10 / GDT && !(t.job && t.state === 'moving'); i++) tick();
    for (let i = 0; i < 1 / GDT; i++) tick();
    expect(t.state).toBe('moving');
    expect(target(t)).toBe(quarry.id);
    const h = t.headTile!;
    w.track.remove(h.x, h.y);
    tick();
    expect(t.state).toBe('stranded');
    t.dropJob(1);
    for (let i = 0; i < OFF_RAILS / GDT; i++) tick();
    expect(t.state).toBe('stranded');
    expect(t.toJSON().suspended, 'its program, set aside off the rails').not.toBeNull();
    w.track.place(h.x, h.y, 'straight', 1);
    for (let i = 0; i < RETRY / GDT && t.toJSON().suspended; i++) tick();
    expect(t.toJSON().suspended, 'its program still set aside on the rails again').toBeNull();
    expect(t.schedule).toBe(own);
    expect(t.routeIndex).toBe(1);
    expect(t.state).toBe('moving');
    for (let i = 0; i < 120 / GDT && !calls.length; i++) tick();
    expect(calls, 'its first call after the close').toEqual([town.id]);
  });
});

// ------------------------------------------------------------ placing a train on the track

/** Side of the grid the lines below are laid on, from its middle: room for the longest consist. */
const LINE_SIZE = 72;

/** One piece of a line, and which of the ways it can carry the line on from where it stands. */
interface LineStep {
  kind: 'straight' | 'curve' | 'switch';
  way: number;
}
/** A train stood on a line laid piece by piece from the middle of the grid. */
interface LineCase {
  cls: TrackClass;
  /** the edge the line enters its first tile by */
  entry: Dir;
  steps: LineStep[];
  /** the tile of the line the head stands on, counted from the first */
  head: number | 'last';
  locos: string[];
  wagons: string[];
}
/** A tile the line crosses, and the edge it enters by. */
interface LineTile {
  x: number;
  y: number;
  in: Dir;
}
/** A piece laid to carry the line on: the tiles the line crosses on it, and its way out. */
interface Way {
  lay(g: TrackGraph): void;
  tiles: LineTile[];
  out: Dir;
}

/**
 * Every way a piece of the step's kind can carry a line that enters tile `at` on, over free tiles:
 * each rotation, and on a multi-tile piece each route, either way along, that comes in there.
 */
function waysOn(g: TrackGraph, step: LineStep, cls: TrackClass, at: LineTile): Way[] {
  const free = (x: number, y: number) => g.inBounds(x, y) && !g.has(x, y);
  const { kind } = step;
  const ways: Way[] = [];
  for (let rot = 0; rot < rotationCount(kind); rot++) {
    if (kind === 'straight' || !isUnitKind(kind, cls)) {
      if (!free(at.x, at.y)) return [];
      for (const [a, b] of pieceLinks(kind, rot))
        if (a === at.in || b === at.in)
          ways.push({
            lay: (h) => h.set(at.x, at.y, makePiece(kind, rot, cls)),
            tiles: [at],
            out: a === at.in ? b : a,
          });
      continue;
    }
    const def = unitDef(kind, CLASS_N[cls], rot);
    def.routes.forEach((r, route) => {
      for (const forward of [true, false]) {
        const seq = forward ? r.members : [...r.members].reverse();
        const edges = seq.map((m) => {
          const l = def.members[m].links.find((k) => k.route === route)!;
          return forward ? { in: l.in, out: l.out } : { in: l.out, out: l.in };
        });
        if (edges[0].in !== at.in) continue;
        const ax = at.x - def.members[seq[0]].dx;
        const ay = at.y - def.members[seq[0]].dy;
        if (!def.members.every((m) => free(ax + m.dx, ay + m.dy))) continue;
        ways.push({
          lay: (h) => void h.place(ax, ay, kind, rot, cls),
          tiles: seq.map((m, i) => ({
            x: ax + def.members[m].dx,
            y: ay + def.members[m].dy,
            in: edges[i].in,
          })),
          out: edges[edges.length - 1].out,
        });
      }
    });
  }
  return ways;
}

/**
 * The case's line, laid from the middle of the grid until a piece finds no room. A step takes one
 * of the ways that lead on to a free tile while there is one, so the line seldom winds into itself.
 */
function layLine(c: Pick<LineCase, 'cls' | 'entry' | 'steps'>) {
  const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
  const tiles: LineTile[] = [];
  const next = (way: Way): LineTile => {
    const last = way.tiles[way.tiles.length - 1];
    return { x: last.x + DIR_DX[way.out], y: last.y + DIR_DY[way.out], in: opposite(way.out) };
  };
  let at: LineTile = { x: LINE_SIZE >> 1, y: LINE_SIZE >> 1, in: c.entry };
  for (const step of c.steps) {
    const ways = waysOn(g, step, c.cls, at);
    const on = ways.filter((w) => {
      const n = next(w);
      return g.inBounds(n.x, n.y) && !g.has(n.x, n.y);
    });
    const pick = on.length ? on : ways;
    if (!pick.length) break;
    const way = pick[step.way % pick.length];
    way.lay(g);
    tiles.push(...way.tiles);
    at = next(way);
  }
  return { g, tiles };
}

function stockOf(gauge: Gauge) {
  const ids = (defs: readonly { id: string; gauge?: Gauge }[]) =>
    defs.filter((d) => gaugeOf(d) === gauge).map((d) => d.id);
  return { locos: ids(content.locomotives), wagons: ids(content.wagons) };
}
const STOCK: Record<Gauge, ReturnType<typeof stockOf>> = {
  regular: stockOf('regular'),
  narrow: stockOf('narrow'),
};

/** A consist of the gauge's stock, up to the most units and wagons a train may have, often the most. */
function consistOf(rng: Rng, gauge: Gauge) {
  const stock = STOCK[gauge];
  const locos = rng.chance(0.4) ? MAX_LOCOS : rng.int(1, MAX_LOCOS);
  const wagons = rng.chance(0.4) ? MAX_WAGONS : rng.int(0, MAX_WAGONS);
  return {
    locos: Array.from({ length: locos }, () => rng.pick(stock.locos)),
    wagons: Array.from({ length: wagons }, () => rng.pick(stock.wagons)),
  };
}

/** A line of `cls` (mostly curves when `winding`) and a train of its gauge stood on it. */
function lineCase(rng: Rng, cls: TrackClass, winding: boolean): LineCase {
  const n = rng.int(1, 90);
  const steps = Array.from({ length: n }, (): LineStep => {
    const r = rng.next();
    const kind = r < (winding ? 0.7 : 0.35) ? 'curve' : r < 0.85 ? 'straight' : 'switch';
    return { kind, way: rng.int(0, 15) };
  });
  return {
    cls,
    entry: rng.pick(DIRS),
    steps,
    head: rng.chance(0.6) ? 'last' : rng.int(0, 3 * n),
    ...consistOf(rng, cls === 'narrow' ? 'narrow' : 'regular'),
  };
}

function* shrinkLine(c: LineCase): Iterable<LineCase> {
  for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
  for (const locos of shrinkArray(c.locos)) if (locos.length) yield { ...c, locos };
  for (const steps of shrinkArray(c.steps)) if (steps.length) yield { ...c, steps };
  if (c.head !== 'last') for (const head of shrinkInt(c.head)) yield { ...c, head };
}

function lineTrain(c: Pick<LineCase, 'locos' | 'wagons'>) {
  const t = new Train(
    c.locos.map((id, i) => ({ uid: 1 + i, level: 0, def: locoDef(id) })),
    'Placed',
    1,
  );
  t.wagons = c.wagons.map((id, i) => ({
    uid: 10 + i,
    def: wagonDef(id),
    level: 1,
    cargo: null,
    amount: 0,
    origin: null,
  }));
  return t;
}

/** How much trail a train stands along, measured as the trail measures it: chord by chord. */
function trailUnder(t: Train) {
  const pts = t.toJSON().trail;
  let sum = 0;
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return sum;
}

/**
 * Whether the train has track under every car: the trail it stands along is at least as long as
 * the train, and no car is pushed off the rear end of the trail, where all its bogies would land
 * on the trail's first point.
 */
function expectWhole(t: Train, what: string) {
  expect(trailUnder(t), `${what}: trail under a train ${t.length} long`).toBeGreaterThanOrEqual(
    t.length,
  );
  t.vehiclePoses.forEach((v, car) =>
    v.segments.forEach((s) =>
      s.bogies.forEach((b, i) => {
        const a = s.bogies[i - 1];
        if (a)
          expect(Math.hypot(b.x - a.x, b.y - a.y), `${what}: car ${car}`).toBeGreaterThan(1e-6);
      }),
    ),
  );
}

/**
 * The case's train placed on its line as a depot rolls one out (`spawnAt`), and again as a save
 * without its trail is loaded (`fromJSON`, which places it from its head the same way).
 */
function standsWhole(c: LineCase) {
  const { g, tiles } = layLine(c);
  const head = tiles[c.head === 'last' ? tiles.length - 1 : Math.min(c.head, tiles.length - 1)];
  const t = lineTrain(c);
  expect(t.spawnAt(g, head.x, head.y, head.in), 'placed').toBe(true);
  expectWhole(t, 'rolled out');
  const loaded = Train.fromJSON({ ...t.toJSON(), trail: [] }, g);
  expectWhole(loaded, 'loaded without its trail');
  expect(loaded.vehiclePoses, 'loaded where it was placed').toEqual(t.vehiclePoses);
}

/** A staircase of `n` narrow curves turning north and east by turns, and its last tile. */
function staircase(n: number) {
  const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
  let at: LineTile = { x: 0, y: LINE_SIZE - 1, in: Dir.W };
  let out = Dir.N;
  let last = at;
  for (let i = 0; i < n; i++) {
    const turn = (a: Dir, b: Dir) => (a === at.in && b === out) || (a === out && b === at.in);
    const rot = [0, 1, 2, 3].find((r) => pieceLinks('curve', r).some(([a, b]) => turn(a, b)))!;
    g.set(at.x, at.y, makePiece('curve', rot, 'narrow'));
    last = at;
    at = { x: at.x + DIR_DX[out], y: at.y + DIR_DY[out], in: opposite(out) };
    out = out === Dir.N ? Dir.E : Dir.N;
  }
  return { g, head: last };
}

/**
 * Tiles `trackUnder` asks `walkBack` for: several times what the longest train stands on, round
 * and round a loop.
 */
const WALK_ALL = 300;

/**
 * The track a train whose head stops on tile `at` stands on, found the slow obvious way and read
 * from the head back as a save stores a trail (`[x, y, tile x, tile y, in, out]`): the head's tile
 * up to its middle, going straight on where it can; every tile `walkBack` finds behind it, however
 * many the train needs; and, where the rails end, a straight run `run` long on out of the edge the
 * last of them is entered by. Laid point by point from each tile's geometry as `segGeom` gives it
 * for the tile's edges alone, as `spawnAt` lays it (a switch's throat takes its first route), with
 * a point on a tile border once, on the tile nearer the head.
 */
function trackUnder(g: TrackGraph, at: LineTile, run: number): number[][] {
  const exits = g.exits(at.x, at.y, at.in);
  const head: PathSegment = {
    x: at.x,
    y: at.y,
    in: at.in,
    out: exits.find((e) => e === opposite(at.in)) ?? exits[0],
  };
  const back = walkBack(g, at.x, at.y, at.in, WALK_ALL);
  const rows: number[][] = [];
  const lay = (x: number, y: number, s: PathSegment) => {
    const last = rows[rows.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < 1e-6)
      last.splice(2, 4, s.x, s.y, s.in, s.out);
    else rows.push([x, y, s.x, s.y, s.in, s.out]);
  };
  if (back.length < WALK_ALL) {
    const end = back[0] ?? head;
    const p = g.segGeom(end.x, end.y, end.in, end.out).pts[0];
    for (let d = Math.ceil(run / 0.125); d >= 1; d--)
      lay(end.x + p.x + DIR_DX[end.in] * d * 0.125, end.y + p.y + DIR_DY[end.in] * d * 0.125, end);
  }
  for (const s of [...back, head]) {
    const pts = g.segGeom(s.x, s.y, s.in, s.out).pts;
    const upto = s === head ? Math.floor(pts.length / 2) + 1 : pts.length;
    for (let i = 0; i < upto; i++) lay(s.x + pts[i].x, s.y + pts[i].y, s);
  }
  return rows.reverse();
}

/**
 * Whether the train stands on the track behind its head (`trackUnder`, the oracle): its trail,
 * read from the head back, is that track point for point and at least as long as the train, and
 * every bogie stands on that track at its own distance from the head (its vehicle's front, its
 * segment's place in the body, its place in the segment), so no body is pulled short or pushed
 * off the end of the rails.
 */
function expectOnTrack(t: Train, g: TrackGraph, at: LineTile, what: string) {
  const under = trackUnder(g, at, t.length + 4);
  const trail = t.toJSON().trail.reverse();
  const off = trail.findIndex((p, i) => {
    const q = under[i];
    return (
      !q ||
      Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1e-9 ||
      p.slice(2, 6).join() !== q.slice(2, 6).join()
    );
  });
  expect(
    off < 0 ? null : { point: off, trail: trail[off], track: under[off] ?? 'none' },
    `${what}: the first trail point, from the head back, off the track behind the head`,
  ).toBeNull();
  let laid = 0;
  for (let i = 1; i < trail.length; i++)
    laid += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
  expect(laid, `${what}: trail under a train ${t.length} long`).toBeGreaterThanOrEqual(t.length);
  const track = new Polyline(under.map(([x, y]) => ({ x, y })));
  const fronts = vehicleFronts(t.carLengths);
  const astray: string[] = [];
  t.vehicleSpecs.forEach((spec, car) =>
    spec.segments.forEach((s, j) =>
      t.vehiclePoses[car].segments[j].bogies.forEach((b, k) => {
        const p = track.at(fronts[car] + s.front + (s.L - s.W) / 2 + (s.W / (s.nb - 1)) * k);
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d >= 1e-9) astray.push(`car ${car}, segment ${j}, bogie ${k}: ${d.toFixed(4)} off`);
      }),
    ),
  );
  expect(astray, `${what}: bogies away from their place on the track`).toEqual([]);
}

/** The case's train placed on its line by `spawnAt`, and again by a save without its trail. */
function standsOnTrack(c: LineCase) {
  const { g, tiles } = layLine(c);
  const at = tiles[c.head === 'last' ? tiles.length - 1 : Math.min(c.head, tiles.length - 1)];
  const t = lineTrain(c);
  expect(t.spawnAt(g, at.x, at.y, at.in), 'placed').toBe(true);
  expectOnTrack(t, g, at, 'rolled out');
  expectOnTrack(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), g, at, 'loaded without a trail');
}

/** The longest consist of a gauge: the most units and wagons a train may have, of its longest stock. */
function longestOf(gauge: Gauge) {
  const longest = (ids: string[], def: (id: string) => BodyFields) => {
    const len = (id: string) => vehicleSpec(def(id)).L;
    const most = Math.max(...ids.map(len));
    return ids.find((id) => len(id) === most)!;
  };
  return {
    locos: Array<string>(MAX_LOCOS).fill(longest(STOCK[gauge].locos, locoDef)),
    wagons: Array<string>(MAX_WAGONS).fill(longest(STOCK[gauge].wagons, wagonDef)),
  };
}

/** The tile a line goes on to past the end of a piece laid along it. */
function past(way: Way): LineTile {
  const end = way.tiles[way.tiles.length - 1];
  return { x: end.x + DIR_DX[way.out], y: end.y + DIR_DY[way.out], in: opposite(way.out) };
}

/**
 * A line of nothing but curves of `cls`, turning north and east by turns from the grid's
 * south-west corner for as long as the grid has room, and the tiles it crosses.
 */
function zigzag(cls: TrackClass) {
  const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
  const tiles: LineTile[] = [];
  let at: LineTile = { x: 0, y: LINE_SIZE - 1, in: Dir.W };
  for (let out = Dir.N; ; out = out === Dir.N ? Dir.E : Dir.N) {
    const way = waysOn(g, { kind: 'curve', way: 0 }, cls, at).find((w) => w.out === out);
    if (!way) break;
    way.lay(g);
    tiles.push(...way.tiles);
    at = past(way);
  }
  return { g, tiles };
}

/** A ring of four curves of `cls` around the middle of the grid, and the tiles it crosses. */
function ring(cls: TrackClass) {
  const start: LineTile = { x: LINE_SIZE >> 1, y: LINE_SIZE >> 1, in: Dir.W };
  const close = (laid: Way[], at: LineTile): Way[] | null => {
    const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
    for (const way of laid) way.lay(g);
    if (laid.length === 4)
      return at.x === start.x && at.y === start.y && at.in === start.in ? laid : null;
    for (const way of waysOn(g, { kind: 'curve', way: 0 }, cls, at)) {
      const found = close([...laid, way], past(way));
      if (found) return found;
    }
    return null;
  };
  const ways = close([], start);
  if (!ways) throw new Error(`no ring of four ${cls} curves`);
  const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
  for (const way of ways) way.lay(g);
  return { g, tiles: ways.flatMap((way) => way.tiles) };
}

/** A train stood at the end of a straight line of `cls` that runs `tiles` tiles towards `dir`. */
interface StraightCase {
  cls: TrackClass;
  dir: Dir;
  tiles: number;
  locos: string[];
  wagons: string[];
}

function straightCase(rng: Rng): StraightCase {
  return {
    cls: rng.pick(TRACK_CLASSES),
    dir: rng.pick(DIRS),
    tiles: rng.int(1, 30),
    ...consistOf(rng, rng.pick(['regular', 'narrow'] as const)),
  };
}

function* shrinkStraight(c: StraightCase): Iterable<StraightCase> {
  for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
  for (const locos of shrinkArray(c.locos)) if (locos.length) yield { ...c, locos };
  for (const tiles of shrinkInt(c.tiles, 1)) yield { ...c, tiles };
}

/** The case's line, laid from the middle of the grid, and its last tile, where the head stands. */
function straightLine(c: StraightCase) {
  const g = new TrackGraph(LINE_SIZE, LINE_SIZE);
  const [ux, uy] = [DIR_DX[c.dir], DIR_DY[c.dir]];
  const start = LINE_SIZE >> 1;
  for (let i = 0; i < c.tiles; i++)
    g.set(start + ux * i, start + uy * i, makePiece('straight', c.dir % 2, c.cls));
  const head: LineTile = {
    x: start + ux * (c.tiles - 1),
    y: start + uy * (c.tiles - 1),
    in: opposite(c.dir),
  };
  return { g, head };
}

/**
 * The trail `spawnAt` laid on straight track before it measured what the tiles behind lay (issue
 * #201), read from the head back as a save stores it: the track behind the head (`trackUnder`)
 * for `ceil(length) + 1` tiles past the head's half tile, or where the rails end sooner, on past
 * them in eighths of a tile to `length + 1.5` or just beyond; less what a trail keeps no more of
 * (`pushTrail`), every point more than `length + 2` behind the head but the nearest. How far
 * behind the head a point lies is measured in a straight line, which is the way along the track
 * on straight track alone.
 */
function straightTrailBefore(g: TrackGraph, at: LineTile, length: number) {
  const tiles = Math.ceil(length) + 1;
  const behind = walkBack(g, at.x, at.y, at.in, tiles).length;
  const reach =
    0.5 + behind + (behind < tiles ? Math.ceil((length + 1 - behind) / 0.125) * 0.125 : 0);
  const rows = trackUnder(g, at, reach + 1);
  const back = (r: number[]) => Math.hypot(r[0] - rows[0][0], r[1] - rows[0][1]);
  const laid = rows.filter((r) => back(r) <= reach + 1e-9);
  const beyond = laid.findIndex((r) => back(r) > length + 2);
  return beyond < 0 ? laid : laid.slice(0, beyond + 1);
}

/** Whether the train's trail, read from the head back, is `rows` point for point, tiles and all. */
function expectTrail(t: Train, rows: number[][], what: string) {
  const trail = t.toJSON().trail.reverse();
  const off = Array.from({ length: Math.max(trail.length, rows.length) }, (_, i) => i).find(
    (i) =>
      !trail[i] ||
      !rows[i] ||
      Math.hypot(trail[i][0] - rows[i][0], trail[i][1] - rows[i][1]) >= 1e-9 ||
      trail[i].slice(2, 6).join() !== rows[i].slice(2, 6).join(),
  );
  expect(
    off === undefined
      ? null
      : { point: off, of: [trail.length, rows.length], trail: trail[off], want: rows[off] },
    `${what}: the first trail point, from the head back, unlike the one wanted`,
  ).toBeNull();
}

/**
 * How far past its rear a placed train's trail runs, at the least. On straight track it always
 * ran so far (`straightTrailBefore`), and `spawnAt` keeps it however the line behind it winds.
 */
const REACH = 1.5;

/** Whether the train's trail runs REACH or more past its rear, measured chord by chord. */
function expectReach(t: Train, what: string) {
  expect(
    trailUnder(t) - t.length,
    `${what}: trail past the rear of a train ${t.length} long`,
  ).toBeGreaterThanOrEqual(REACH - 1e-9);
}

/** The case's train placed on its line by `spawnAt`, and again by a save without its trail. */
function reachesPast(c: LineCase) {
  const { g, tiles } = layLine(c);
  const at = tiles[c.head === 'last' ? tiles.length - 1 : Math.min(c.head, tiles.length - 1)];
  const t = lineTrain(c);
  expect(t.spawnAt(g, at.x, at.y, at.in), 'placed').toBe(true);
  expectReach(t, 'rolled out');
  expectReach(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), 'loaded without a trail');
}

describe('a train placed on the track (spawnAt)', () => {
  it('stands whole on a winding narrow line, up to the longest consist a train may have', () => {
    forAll((rng) => lineCase(rng, 'narrow', true), standsWhole, { shrink: shrinkLine });
  });

  it('stands whole on any line: straights, regular and narrow curves, switches', () => {
    forAll((rng) => lineCase(rng, rng.pick(TRACK_CLASSES), rng.chance(0.5)), standsWhole, {
      shrink: shrinkLine,
    });
  });

  it('stands whole at the end of a staircase of narrow curves', () => {
    const { g, head } = staircase(60);
    // a Muki with ten mine tubs, and the most narrow units and wagons a train may have
    for (const c of [
      { locos: ['muki'], wagons: Array<string>(10).fill('mine_tub') },
      {
        locos: Array<string>(MAX_LOCOS).fill('mk48'),
        wagons: Array<string>(MAX_WAGONS).fill('narrow_coach'),
      },
    ]) {
      const t = lineTrain(c);
      expect(t.spawnAt(g, head.x, head.y, head.in)).toBe(true);
      expectWhole(t, `${c.locos.length} units, ${c.wagons.length} wagons`);
    }
  });

  it('stands on straight track as it did: the head at the tile centre, the cars in line behind', () => {
    forAll(straightCase, (c) => {
      const { g, head } = straightLine(c);
      const [ux, uy] = [DIR_DX[c.dir], DIR_DY[c.dir]];
      const [hx, hy] = [head.x, head.y];
      const t = lineTrain(c);
      expect(t.spawnAt(g, hx, hy, head.in)).toBe(true);
      const loaded = Train.fromJSON({ ...t.toJSON(), trail: [] }, g);
      const specs = t.vehicleSpecs;
      const fronts = vehicleFronts(specs.map((s) => s.L));
      // `back` tiles behind the head's centre, along the line and on past where it ends
      const at = (back: number) => ({ x: hx - ux * back, y: hy - uy * back });
      for (const train of [t, loaded]) {
        specs.forEach((spec, i) => {
          const v = train.vehiclePoses[i];
          const mid = at(fronts[i] + spec.L / 2);
          expect(v.x).toBeCloseTo(mid.x, 9);
          expect(v.y).toBeCloseTo(mid.y, 9);
          expect(Math.cos(v.heading)).toBeCloseTo(ux, 9);
          expect(Math.sin(v.heading)).toBeCloseTo(uy, 9);
          spec.segments.forEach((s, j) =>
            v.segments[j].bogies.forEach((b, k) => {
              const p = at(fronts[i] + s.front + (s.L - s.W) / 2 + (s.W / (s.nb - 1)) * k);
              expect(b.x).toBeCloseTo(p.x, 9);
              expect(b.y).toBeCloseTo(p.y, 9);
            }),
          );
        });
      }
    });
  });

  it('lays on straight track the trail it laid before, out past the rear as far as it reached', () => {
    forAll(
      straightCase,
      (c) => {
        const { g, head } = straightLine(c);
        const t = lineTrain(c);
        expect(t.spawnAt(g, head.x, head.y, head.in)).toBe(true);
        const before = straightTrailBefore(g, head, t.length);
        expectTrail(t, before, 'rolled out');
        expectTrail(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), before, 'loaded, no trail');
      },
      { shrink: shrinkStraight },
    );
  });

  it('reaches a tile and a half past its rear however the line behind it winds', () => {
    forAll((rng) => lineCase(rng, 'narrow', true), reachesPast, {
      shrink: shrinkLine,
      seeds: SEEDS.map((s) => 2000 + s),
    });
    forAll((rng) => lineCase(rng, rng.pick(TRACK_CLASSES), rng.chance(0.5)), reachesPast, {
      shrink: shrinkLine,
      seeds: SEEDS.map((s) => 3000 + s),
    });
  });

  it('reaches as far with the longest consist of its gauge on curves and round a ring', () => {
    // its head on every seventh tile of a line of nothing but curves, the rails behind it ending
    // anywhere from under its head to past its rear, and on every other tile of a ring
    for (const cls of TRACK_CLASSES)
      for (const [line, { g, tiles }, every] of [
        ['curves', zigzag(cls), 7],
        ['ring', ring(cls), 2],
      ] as const)
        for (const at of tiles.filter((_, i) => i % every === 0)) {
          const what = `${cls} ${line}, head on ${at.x},${at.y}`;
          const t = lineTrain(longestOf(cls === 'narrow' ? 'narrow' : 'regular'));
          expect(t.spawnAt(g, at.x, at.y, at.in), what).toBe(true);
          expectReach(t, `${what}, rolled out`);
          expectReach(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), `${what}, loaded`);
        }
  });

  it('stands on the track behind its head, every bogie at its own distance along it', () => {
    forAll((rng) => lineCase(rng, 'narrow', true), standsOnTrack, { shrink: shrinkLine });
    forAll((rng) => lineCase(rng, rng.pick(TRACK_CLASSES), rng.chance(0.5)), standsOnTrack, {
      shrink: shrinkLine,
      seeds: SEEDS.map((s) => 1000 + s),
    });
  });

  it('stands on the track with the longest consist of its gauge on a line of nothing but curves', () => {
    for (const cls of TRACK_CLASSES) {
      const { g, tiles } = zigzag(cls);
      const c = longestOf(cls === 'narrow' ? 'narrow' : 'regular');
      // a curve lays less than a tile of trail a tile, but far more than half
      expect(tiles.length, `${cls}: tiles the line crosses`).toBeGreaterThan(
        2 * lineTrain(c).length,
      );
      // rails behind it all the way at the end of the line, and ending under it near the start
      for (const at of [tiles[tiles.length - 1], tiles[tiles.length >> 1], tiles[5]]) {
        const what = `${cls}, head on ${at.x},${at.y}`;
        const t = lineTrain(c);
        expect(t.spawnAt(g, at.x, at.y, at.in), what).toBe(true);
        expectOnTrack(t, g, at, `${what}, rolled out`);
        expectOnTrack(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), g, at, `${what}, loaded`);
      }
    }
  });

  it('stands on a ring shorter than itself, going round it as often as it takes', () => {
    for (const cls of TRACK_CLASSES) {
      const { g, tiles } = ring(cls);
      const c = longestOf(cls === 'narrow' ? 'narrow' : 'regular');
      expect(tiles.length, `${cls}: tiles round the ring`).toBeLessThan(lineTrain(c).length);
      for (const at of tiles) {
        const what = `${cls} ring, head on ${at.x},${at.y}`;
        const t = lineTrain(c);
        expect(t.spawnAt(g, at.x, at.y, at.in), what).toBe(true);
        expectOnTrack(t, g, at, `${what}, rolled out`);
        expectOnTrack(Train.fromJSON({ ...t.toJSON(), trail: [] }, g), g, at, `${what}, loaded`);
      }
    }
  });

  it('rolls out of a depot as it did: the head on the gate, the cars in line behind it', () => {
    const y = 60;
    const depots = [
      { depotId: 'depot', cls: 'regular', train: ['f7', 'wood_hopper'] },
      { depotId: 'narrow_depot', cls: 'narrow', train: ['mk48', 'mine_tub'] },
    ] as const;
    for (const { depotId, cls, train } of depots)
      for (const east of [true, false])
        for (const c of [
          { locos: [train[0]], wagons: [] },
          { locos: [train[0], train[0]], wagons: Array<string>(6).fill(train[1]) },
        ]) {
          const what = `${depotId}, ${east ? 'east' : 'west'} gate, ${c.locos.length}+${c.wagons.length}`;
          const w = world();
          const depot = w.builder.placeStation(east ? 5 : SIZE - 8, y, depotId, 0)!;
          const gate = depot.gateTiles().find((p) => p.y === y && p.x > depot.x === east)!;
          const u = east ? 1 : -1;
          for (let i = 0; i <= 40; i++) w.track.place(gate.x + u * i, y, 'straight', 1, cls);
          for (const k of [12, 24]) w.builder.placeStation(gate.x + u * k, y + 1, 'quarry', 0);
          const inv = w.fleet.inventory;
          const t = w.fleet.create(
            c.locos.map((id) => inv.add(id, 0).uid),
            c.wagons.map((id) => inv.add(id, 0).uid),
            [],
            undefined,
            'schedule',
            depot.id,
          );
          if (typeof t === 'string') throw new Error(`${what}: ${t}`);
          const loaded = Train.fromJSON({ ...t.toJSON(), trail: [] }, w.track);
          const specs = t.vehicleSpecs;
          const fronts = vehicleFronts(specs.map((s) => s.L));
          // `back` tiles behind the gate's centre, along the line and on into the shed
          const at = (back: number) => ({ x: gate.x - u * back, y });
          const entry = t.headSeg!.in;
          const before = straightTrailBefore(w.track, { x: gate.x, y, in: entry }, t.length);
          for (const [train, how] of [
            [t, 'rolled out'],
            [loaded, 'loaded without a trail'],
          ] as const) {
            expectTrail(train, before, `${what}, ${how}: the trail it laid before`);
            const head = train.headPos!;
            expect(Math.hypot(head.x - gate.x, head.y - y), `${what}, ${how}: head`).toBeLessThan(
              1e-9,
            );
            specs.forEach((spec, i) => {
              const v = train.vehiclePoses[i];
              const mid = at(fronts[i] + spec.L / 2);
              expect(
                Math.hypot(v.x - mid.x, v.y - mid.y),
                `${what}, ${how}: car ${i}`,
              ).toBeLessThan(1e-9);
              expect(Math.cos(v.heading), `${what}, ${how}: car ${i} heading`).toBeCloseTo(u, 9);
              spec.segments.forEach((s, j) =>
                v.segments[j].bogies.forEach((b, k) => {
                  const p = at(fronts[i] + s.front + (s.L - s.W) / 2 + (s.W / (s.nb - 1)) * k);
                  expect(
                    Math.hypot(b.x - p.x, b.y - p.y),
                    `${what}, ${how}: car ${i}, segment ${j}, bogie ${k}`,
                  ).toBeLessThan(1e-9);
                }),
              );
            });
          }
        }
  });
});
