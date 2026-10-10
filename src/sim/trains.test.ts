import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { Train, defaultStop, resetTrainIds, type RouteMode } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
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
