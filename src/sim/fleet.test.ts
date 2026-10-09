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
import {
  Train,
  defaultStop,
  resetTrainIds,
  type RouteMode,
  type StopPlan,
  type TickCtx,
  type TrainState,
} from './trains';
import { findRefugePath } from './recovery';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Inventory } from '../gacha/inventory';
import { locoDef, wagonDef } from '../gacha/items';
import { STR } from '../strings';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  // a warehouse is worth collecting from with what a level 1 store holds
  rules.collectMin = 30;
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
});

const SIZE = 64;
const ROW = 30;
const ISLAND_ROW = 50;
const GDT = 0.05;
const MODES: RouteMode[] = ['schedule', 'production', 'collection', 'transport', 'contract'];
/** Game seconds a train gets, after the switch and the cause of any stop clearing, to get going. */
const HORIZON = 300;

type Kind = 'quarry' | 'warehouse' | 'farm' | 'station' | 'depot';
const KINDS: Kind[] = ['quarry', 'warehouse', 'farm', 'station', 'depot'];
/** A station on the main line: its gate on the line is its platform. */
interface Site {
  kind: Kind;
  x: number;
  /** holds goods (or, for a town, has people around it) */
  stocked: boolean;
}
/** A line, the stations around it, a train on it and how the train was set up. */
interface Layout {
  /** on the main line; the first is a quarry and the second a warehouse */
  sites: Site[];
  /** stations with no rail to them */
  dead: number;
  /** a stocked quarry on a line of its own, with a platform no rail from the main line reaches */
  island: boolean;
  trainX: number;
  east: boolean;
  /** a coach behind the hopper, for passengers */
  coach: boolean;
  /** mode before the switch */
  from: RouteMode;
  /** stops beyond the first in the program the train runs */
  extra: number;
  /** fleet ticks spent in the state before the switch */
  wait: number;
}

function layout(rng: Rng, from: RouteMode): Layout {
  const slots = rng.shuffle(Array.from({ length: 11 }, (_, i) => 6 + 5 * i));
  const n = rng.int(2, 5);
  // the train stands clear of the quarry, which the recipes send it to
  let trainX = rng.int(10, 52);
  if (Math.abs(trainX - slots[0]) < 6) trainX += trainX + 12 <= 52 ? 12 : -12;
  return {
    sites: slots.slice(0, n).map((x, i) => ({
      kind: i === 0 ? 'quarry' : i === 1 ? 'warehouse' : rng.pick(KINDS),
      x,
      stocked: i === 0 || rng.chance(0.6),
    })),
    dead: rng.int(0, 2),
    island: rng.chance(0.3),
    trainX,
    east: rng.chance(0.5),
    coach: rng.chance(0.3),
    from,
    extra: rng.chance(0.6) ? 0 : rng.int(1, 2),
    wait: rng.int(0, 20),
  };
}
function* shrinkLayout(c: Layout): Iterable<Layout> {
  for (const rest of shrinkArray(c.sites.slice(2)))
    yield { ...c, sites: [...c.sites.slice(0, 2), ...rest] };
  for (const dead of shrinkInt(c.dead)) yield { ...c, dead };
  if (c.island) yield { ...c, island: false };
  if (c.coach) yield { ...c, coach: false };
  for (const extra of shrinkInt(c.extra)) yield { ...c, extra };
  for (const wait of shrinkInt(c.wait)) yield { ...c, wait };
  for (let i = 1; i < c.sites.length; i++)
    if (c.sites[i].stocked)
      yield { ...c, sites: c.sites.map((s, j) => (j === i ? { ...s, stocked: false } : s)) };
}

/** A grass map with a straight line along row 30 and, apart from it, a short one along row 50. */
function world(island: boolean) {
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
  for (let x = 2; x < SIZE - 2; x++) track.place(x, ROW, 'straight', 1);
  if (island) for (let x = 10; x < 30; x++) track.place(x, ISLAND_ROW, 'straight', 1);
  return { map, track, stock, economy, inventory, builder, fleet };
}

type Scene = ReturnType<typeof scene>;
function scene(c: Layout, loco: string) {
  const w = world(c.island);
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
  const dead: Station[] = [];
  const addDead = () => dead.push(put('farm', 8 + 6 * dead.length, ROW + 15));
  for (let i = 0; i < c.dead; i++) addDead();
  if (c.island) stockUp(put('quarry', 20, ISLAND_ROW - 1));
  const t = new Train([{ uid: 1, level: 1, def: locoDef(loco) }]);
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
  t.mode = c.from;
  w.fleet.trains.push(t);
  const arrivals: number[] = [];
  w.fleet.onArrive = (tr, s) => {
    if (tr === t) arrivals.push(s.id);
  };
  let now = 0;
  const sc = {
    w,
    t,
    c,
    sites,
    dead,
    arrivals,
    addDead,
    get now() {
      return now;
    },
    ticks(n: number) {
      for (let i = 0; i < n; i++) w.fleet.tick(GDT, (now += GDT));
    },
    /** Tick until `done` holds, for at most `seconds` of game time; returns whether it does. */
    until(done: () => boolean, seconds: number) {
      for (let i = 0; i < seconds / GDT && !done(); i++) w.fleet.tick(GDT, (now += GDT));
      return done();
    },
  };
  return sc;
}
function stockUp(s: Station) {
  if (s.def.id === 'quarry' || s.def.id === 'warehouse') s.storage.set('stone', 40);
  else if (s.def.id === 'farm') s.storage.set('wheat', 30);
  else if (s.def.id === 'station') s.passengerPopulation = 60;
}

const head = (sc: Scene) => sc.t.headTile!;
const byDistance = (sc: Scene) =>
  [...sc.sites].sort((a, b) => Math.abs(a.cx - head(sc).x) - Math.abs(b.cx - head(sc).x));
/** The nearest station the train does not stand over: one under the cars cannot be reached. */
const near = (sc: Scene) =>
  byDistance(sc).find((s) => Math.abs(s.cx - head(sc).x) >= 4) ?? byDistance(sc).at(-1)!;
/** The nearest station far enough off that a train bound there is still under way a second on. */
const ahead = (sc: Scene) =>
  byDistance(sc).find((s) => Math.abs(s.cx - head(sc).x) >= 6) ?? byDistance(sc).at(-1)!;
/** The program a recipe hands the train: `lead` first, at least two stops on schedule. */
function program(sc: Scene, lead: Station, pool: Station[] = sc.sites): StopPlan[] {
  const others = pool.filter((s) => s !== lead);
  const n = Math.max(sc.c.from === 'schedule' ? 1 : 0, sc.c.extra);
  const tail = Array.from({ length: n }, (_, i) =>
    others.length ? others[i % others.length] : lead,
  );
  return [lead, ...tail].map((s) => defaultStop(s.id));
}
/** Head for the current stop as the fleet sends a train off. */
function go(sc: Scene) {
  const { t, w } = sc;
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  t.onPathReady({ builder: w.builder });
}

/**
 * Pull the train aside as the fleet's jam resolution does (`Train.retreat`): a reserved path to a
 * stretch of line a few tiles on, run holding. The fleet builds the tick context it hands
 * its trains privately; the test reaches it through this view, without changing Fleet.
 */
function pullAside(sc: Scene) {
  const { t, w } = sc;
  const h = head(sc);
  const refuge = (x: number, y: number) => y === ROW && Math.abs(x - h.x) >= 2;
  const path = findRefugePath(w.track, t.headSeg!, t.length, () => false, refuge, t.canUse);
  expect(path, 'no refuge ahead').not.toBeNull();
  const fleet = w.fleet as unknown as { ctx(now: number, speedFactor: number): TickCtx };
  const plan = { path: path!, flip: false, group: [t.id], distance: 0 };
  expect(t.retreat(fleet.ctx(sc.now, 1), [t.id], plan)).toBe(true);
}

/**
 * Ways into each state a train can be in when the player switches its mode. Each puts the train
 * there through the simulation and returns what clears the cause of the stop, if anything does.
 */
const RECIPES: Record<string, (sc: Scene) => (() => void) | void> = {
  moving(sc) {
    sc.t.schedule = program(sc, ahead(sc));
    go(sc);
    sc.ticks(sc.c.wait);
    expect(sc.t.state).toBe('moving');
  },
  holding(sc) {
    sc.t.schedule = program(sc, byDistance(sc).at(-1)!);
    go(sc);
    pullAside(sc);
    sc.ticks(sc.c.wait);
    expect(sc.t.state).toBe('moving');
    expect(sc.t.holding).toBe(true);
  },
  yielding(sc) {
    sc.t.schedule = program(sc, byDistance(sc).at(-1)!);
    go(sc);
    pullAside(sc);
    // at the end of the holding path the train waits there for the line to clear
    expect(sc.until(() => sc.t.state === 'yielding', 120)).toBe(true);
  },
  loading(sc) {
    const aim = near(sc);
    sc.t.schedule = program(sc, aim);
    go(sc);
    expect(sc.until(() => sc.t.state === 'loading', 120)).toBe(true);
    expect(sc.t.atStation).toBe(aim);
  },
  waiting(sc) {
    const aim = near(sc);
    // other trains hold every platform
    const others = Array.from({ length: aim.platforms }, (_, i) => 9001 + i);
    for (const id of others) aim.occupants.add(id);
    sc.t.schedule = program(sc, aim);
    go(sc);
    expect(sc.until(() => sc.t.state === 'waiting', 120)).toBe(true);
    return () => {
      for (const id of others) aim.occupants.delete(id);
    };
  },
  idle(sc) {
    // only a roaming train idles: one with nothing worth fetching anywhere
    if (sc.t.mode === 'schedule') sc.t.mode = 'production';
    const kept = sc.w.builder.stations.map((s) => ({
      s,
      storage: new Map(s.storage),
      people: s.passengerPopulation,
    }));
    for (const { s } of kept) {
      s.storage.clear();
      s.passengerPopulation = 0;
    }
    sc.t.schedule = [defaultStop(near(sc).id)];
    go(sc);
    expect(sc.until(() => sc.t.state === 'idle', 120)).toBe(true);
    // then goods turn up
    for (const k of kept) {
      k.s.storage = k.storage;
      k.s.passengerPopulation = k.people;
    }
  },
  noRoute(sc) {
    while (sc.dead.length < 2) sc.addDead();
    sc.t.schedule = program(sc, sc.dead[0], sc.dead);
    sc.ticks(Math.round(5 / GDT));
    expect(sc.t.state).toBe('noRoute');
  },
  stranded(sc) {
    sc.t.schedule = program(sc, ahead(sc));
    go(sc);
    sc.ticks(sc.c.wait);
    // the rail under the head is taken up
    const h = head(sc);
    sc.w.track.remove(h.x, h.y);
    sc.ticks(1);
    expect(sc.t.state).toBe('stranded');
    return () => void sc.w.track.place(h.x, h.y, 'straight', 1);
  },
  noFuel(sc) {
    sc.t.oil = sc.t.oilRate * 1.5;
    sc.t.schedule = program(sc, ahead(sc));
    go(sc);
    expect(sc.until(() => sc.t.state === 'noFuel', 60)).toBe(true);
    return () => void (sc.t.oil = sc.t.oilCap);
  },
  noPower(sc) {
    // the electric engine (see `scene`) on a line with no wire
    sc.t.schedule = program(sc, ahead(sc));
    go(sc);
    expect(sc.until(() => sc.t.state === 'noPower', 10)).toBe(true);
    return () => {
      sc.w.fleet.powered = () => true;
      sc.w.fleet.supplyAt = () => 'catenary';
      sc.w.stock.add('power', 1e9);
    };
  },
  overweight(sc) {
    const quarry = sc.sites[0];
    sc.t.schedule = program(sc, quarry);
    go(sc);
    expect(sc.until(() => sc.t.state === 'loading' && sc.t.atStation === quarry, 120)).toBe(true);
    // more aboard than the engine can pull: it finds out when it sets off
    const hopper = sc.t.wagons[0];
    Object.assign(hopper, { cargo: 'stone', amount: 100, origin: null });
    expect(sc.t.weight).toBeGreaterThan(sc.t.power);
    expect(sc.until(() => sc.t.state === 'overweight', 60)).toBe(true);
    return () => void Object.assign(hopper, { cargo: null, amount: 0 });
  },
  job(sc) {
    startJob(sc);
  },
  jobClosedMoving(sc) {
    startJob(sc);
    // the contract is over while the train runs to it
    sc.t.dropJob(1);
    expect(sc.t.job).toBeNull();
  },
  jobClosedLoading(sc) {
    const dest = startJob(sc);
    expect(sc.until(() => sc.t.state === 'loading' && sc.t.atStation === dest, 200)).toBe(true);
    // the delivery closed the contract; the train is still at the platform
    sc.t.dropJob(1);
    expect(sc.t.job).toBeNull();
  },
  jobClosedNoRoute(sc) {
    // a contract from a station no rail reaches: the train takes it up and finds no route
    while (sc.dead.length < 2) sc.addDead();
    sc.t.schedule = program(sc, ahead(sc));
    sc.t.addJob({
      contractId: 1,
      name: 'stone',
      originId: sc.dead[0].id,
      destId: sc.sites[1].id,
      cargo: 'stone',
    });
    expect(sc.until(() => sc.t.job !== null, 10)).toBe(true);
    sc.ticks(sc.c.wait);
    expect(sc.t.state).toBe('noRoute');
    // the contract closes with the train still unable to get to it
    sc.t.dropJob(1);
    expect(sc.t.job).toBeNull();
  },
  jobClosedStranded(sc) {
    startJob(sc);
    // the rail under the head is taken up, and the contract closes with the train off the rails
    const h = head(sc);
    sc.w.track.remove(h.x, h.y);
    sc.ticks(1);
    expect(sc.t.state).toBe('stranded');
    sc.t.dropJob(1);
    expect(sc.t.job).toBeNull();
    return () => void sc.w.track.place(h.x, h.y, 'straight', 1);
  },
};
/** A train whose own program goes nowhere takes up a contract from the quarry to the warehouse. */
function startJob(sc: Scene) {
  while (sc.dead.length < 2) sc.addDead();
  sc.t.schedule = program(sc, sc.dead[0], sc.dead);
  const [origin, dest] = sc.sites;
  origin.storage.set('stone', 40);
  sc.t.addJob({
    contractId: 1,
    name: 'stone',
    originId: origin.id,
    destId: dest.id,
    cargo: 'stone',
  });
  expect(sc.until(() => sc.t.job !== null && sc.t.state === 'moving', 30)).toBe(true);
  sc.ticks(sc.c.wait);
  return dest;
}

/** The stops a train runs once any contract job is over: the set-aside program, or its own. */
const programOf = (t: Train): StopPlan[] => t.toJSON().suspended?.schedule ?? t.schedule;
/** Who stands on each station's platforms. */
function occupancy(sc: Scene) {
  return sc.w.builder.stations.map((s) => [s.id, [...s.occupants].sort()] as const);
}
/** Does a station have a platform the rails under the train lead to? */
function reachable(sc: Scene, id: number) {
  const s = sc.w.builder.stationById(id);
  if (!s) return false;
  const h = head(sc);
  const reach = sc.w.fleet.reachableTiles([h.y * SIZE + h.x]);
  return sc.w.builder.platformTiles(s).some((p) => reach.has(p.y * SIZE + p.x));
}
/** Neither stands on a platform it is not at, nor leaves one behind. */
function expectOwnPlatformOnly(sc: Scene) {
  for (const s of sc.w.builder.stations)
    if (s !== sc.t.atStation) expect(s.occupants.has(sc.t.id), `holds ${s.name}`).toBe(false);
}

/**
 * Switch the train to `to` from the state `recipe` leaves it in, then let it run: the switch is
 * refused only for a program under two stops and then changes nothing; accepted, it leaves a
 * schedule the train can run. A schedule train has at least two stops, now and once any contract
 * job hands the train back its program; a roaming train heads for what it would pick; and once
 * the cause of any stop clears, the train reaches a station or, roaming with nothing to fetch,
 * waits to choose again, any contract job that closed having handed its program back by then.
 */
function switchFrom(
  recipe: string,
  to: RouteMode,
  c: Layout,
  given: (sc: Scene) => void = () => {},
) {
  const sc = scene(c, recipe === 'noPower' ? 'taurus' : 'f7');
  const { t, w } = sc;
  const release = RECIPES[recipe](sc);
  given(sc);
  const before = {
    mode: t.mode,
    schedule: t.schedule,
    stops: structuredClone(t.schedule),
    routeIndex: t.routeIndex,
    state: t.state as TrainState,
    atStation: t.atStation,
    occupancy: occupancy(sc),
  };
  const ownStops = programOf(t).length;
  const mode = t.mode;
  t.mode = to;
  const pick = to === 'schedule' ? null : w.fleet.chooseNext(t);
  t.mode = mode;

  const r = w.fleet.setMode(t, to);
  if (!r.ok) {
    expect(to).toBe('schedule');
    expect(r.message).toBe(STR.fleet.needTwoStops);
    expect(ownStops, 'refused although the program has two stops').toBeLessThan(2);
    expect(t.mode).toBe(before.mode);
    expect(t.schedule).toBe(before.schedule);
    expect(t.schedule).toEqual(before.stops);
    expect(t.routeIndex).toBe(before.routeIndex);
    expect(t.state).toBe(before.state);
    expect(t.atStation).toBe(before.atStation);
    expect(occupancy(sc)).toEqual(before.occupancy);
    return;
  }
  expect(t.mode).toBe(to);
  expect(t.schedule.length).toBeGreaterThanOrEqual(1);
  expect(t.routeIndex).toBeGreaterThanOrEqual(0);
  expect(t.routeIndex).toBeLessThan(t.schedule.length);
  if (to === 'schedule') {
    expect(ownStops, 'accepted a program of fewer than two stops').toBeGreaterThanOrEqual(2);
    expect(t.schedule).toBe(before.schedule);
    expect(t.routeIndex).toBe(before.routeIndex);
  } else if (!t.job && pick !== null) {
    // the re-plan `create` does: the pick as a one-stop schedule; a train under way that finds no
    // path there carries on with the leg it was on and chooses at the stop
    const kept = t.schedule === before.schedule && !['noRoute', 'idle'].includes(before.state);
    if (!kept) {
      expect(t.route).toEqual([pick]);
      expect(t.routeIndex).toBe(0);
    }
    if (before.state !== 'stranded') expect(reachable(sc, pick)).toBe(true);
  }
  expectOwnPlatformOnly(sc);

  release?.();
  const seen = sc.arrivals.length;
  const live = new Set(sc.w.builder.stations.filter((s) => reachable(sc, s.id)).map((s) => s.id));
  const runnable = () => programOf(t).every((s) => live.has(s.stationId));
  // settled: no contract job closed under the train with its program still to come back
  const settled = () => t.job !== null || !t.toJSON().suspended;
  const arrived = () => sc.arrivals.length > seen;
  sc.until(
    () =>
      settled() &&
      (arrived() || (t.dynamic ? t.state === 'idle' : !runnable() && t.state === 'noRoute')),
    HORIZON,
  );
  expect(settled(), 'a closed contract job still holds its program aside').toBe(true);
  if (t.mode === 'schedule') {
    expect(programOf(t).length, 'a schedule train runs a one-stop program').toBeGreaterThanOrEqual(
      2,
    );
    if (runnable()) expect(arrived(), `no station reached; ${t.state}`).toBe(true);
  } else {
    expect(arrived() || t.state === 'idle', `neither arrived nor waiting; ${t.state}`).toBe(true);
  }
  expectOwnPlatformOnly(sc);
}

describe('Fleet.setMode from every train state', () => {
  // one layout per state, target mode and mode before, each on a seed of its own
  Object.keys(RECIPES).forEach((recipe, i) =>
    describe(`from ${recipe}`, () => {
      MODES.forEach((to, j) =>
        it(`to ${to}`, { timeout: 60_000 }, () => {
          MODES.forEach((from, k) =>
            forAll(
              (rng) => layout(rng, from),
              (c) => switchFrom(recipe, to, c),
              { seeds: [1 + (i * MODES.length + j) * MODES.length + k], shrink: shrinkLayout },
            ),
          );
        }),
      );
    }),
  );

  it('from noRoute standing over the platform of its pick: no path there, so it waits', () => {
    // the quarry's gate is under the train's second car: the stop it picks, and one it cannot
    // reach from where it stands
    const overPick = ({ t, w, sites: [quarry] }: Scene) => {
      t.mode = 'production';
      expect(w.fleet.chooseNext(t)).toBe(quarry.id);
      t.mode = 'schedule';
      const own = { schedule: t.schedule, routeIndex: t.routeIndex };
      t.schedule = [defaultStop(quarry.id)];
      t.routeIndex = 0;
      expect(t.dispatch(w.track, w.builder, w.map)).toBe(false);
      Object.assign(t, own);
    };
    const standing: Layout = {
      sites: [
        { kind: 'quarry', x: 18, stocked: true },
        { kind: 'warehouse', x: 40, stocked: false },
      ],
      dead: 2,
      island: false,
      trainX: 20,
      east: true,
      coach: false,
      from: 'schedule',
      extra: 0,
      wait: 0,
    };
    switchFrom('noRoute', 'production', standing, overPick);
  });
});
