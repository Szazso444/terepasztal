import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder, decorDef } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { buildingDef, type Building } from './buildings';
import { rules, DEFAULT_RULES } from './rules';
import {
  PeopleSim,
  findWalk,
  type PeopleJSON,
  type Person,
  type PersonState,
  type Place,
} from './people';
import { startWork } from './upgrade';
import { forAll, shrinkArray, shrinkInt, SEEDS } from '../testing/property';
import { simWorld, line, station as placeStation } from '../testing/simWorld';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** A line with a passenger station on it and two crewed buildings within walking distance. */
function world(seed = 4242) {
  const map = emptyMap(seed, 64, 64, Terrain.Grass),
    track = new TrackGraph(64, 64),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, new Stockpile());
  builder.free = true;
  for (let x = 2; x < 60; x++) track.place(x, 30, 'straight', 1);
  const station = builder.placeStation(30, 31, 'station')!;
  expect(station).not.toBeNull();
  expect(builder.placeBuilding(27, 34, 'windmill')).not.toBeNull();
  expect(builder.placeBuilding(33, 34, 'kiln')).not.toBeNull();
  return { map, builder, station };
}

const POPULATION = 12;
const DT = 1;
const MIDDAY = 0.5;

/** Who waits at the station after each tick, with where everyone is. */
function run(people: PeopleSim, station: Station, ticks: number) {
  const trace: string[] = [];
  for (let i = 0; i < ticks; i++) {
    people.tick(DT, POPULATION, MIDDAY);
    const waiting = people.waitingAt(station.id).length;
    const where = people.persons.map((p) => `${p.state}@${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    trace.push(`${waiting}|${where.join(';')}`);
  }
  return trace;
}
const waitingCounts = (trace: string[]) => trace.map((t) => Number(t.split('|')[0]));
const isU32 = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 32;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('PeopleSim randomness', () => {
  it('gives the same walkers from the same map seed, without Math.random', () => {
    const { map, builder, station } = world();
    const a = run(new PeopleSim(map, builder), station, 400);
    const b = run(new PeopleSim(map, builder), station, 400);
    expect(b).toEqual(a);
    // the trace is worth comparing: travellers do reach the platform
    expect(Math.max(...waitingCounts(a))).toBeGreaterThan(0);
  });

  it('gives the same walkers from the same injected seed', () => {
    const { map, builder, station } = world();
    const a = run(new PeopleSim(map, builder, new Rng(77)), station, 400);
    const b = run(new PeopleSim(map, builder, new Rng(77)), station, 400);
    expect(b).toEqual(a);
    expect(Math.max(...waitingCounts(a))).toBeGreaterThan(0);
  });

  it('seeds from the map when no stream is given', () => {
    const { map, builder } = world(4242);
    const other = world(4243);
    const draws = (people: PeopleSim) => {
      const rng = new Rng(0);
      rng.state = people.toJSON().rng;
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(draws(new PeopleSim(map, builder))).toEqual(draws(new PeopleSim(map, builder)));
    expect(draws(new PeopleSim(other.map, other.builder))).not.toEqual(
      draws(new PeopleSim(map, builder)),
    );
  });

  it('continues the same draws after a load at any tick', () => {
    const { map, builder, station } = world();
    for (const at of [0, 1, 37, 200]) {
      const ra = new Rng(map.seed ^ 0x51);
      const a = new PeopleSim(map, builder, ra);
      run(a, station, at);
      const save = JSON.parse(JSON.stringify(a.toJSON())) as unknown;
      const rc = new Rng(12345);
      const c = new PeopleSim(map, builder, rc);
      c.load(save);
      const next = (rng: Rng) => Array.from({ length: 32 }, () => rng.next());
      expect(next(rc)).toEqual(next(ra));
    }
  });

  it('plays the same from the same save, persons starting over', () => {
    const { map, builder, station } = world();
    const a = new PeopleSim(map, builder, new Rng(9));
    run(a, station, 150);
    const save = a.toJSON();
    const c1 = new PeopleSim(map, builder);
    const c2 = new PeopleSim(map, builder, new Rng(1));
    c1.load(save);
    c2.load(save);
    const t1 = run(c1, station, 250);
    expect(run(c2, station, 250)).toEqual(t1);
    // a fresh sim with no persons, on the original's stream, is what a load restores
    a.persons.length = 0;
    expect(run(a, station, 250)).toEqual(t1);
  });

  it('resumes a stream saved millions of draws in', () => {
    // Rng(0x5eed)'s state once outgrew exact float addition at draw 4,917,759, and from there a
    // saved stream resumed differently from the live one; these walkers are saved past that point.
    const { map, builder, station } = world();
    const rng = new Rng(0x5eed);
    for (let i = 0; i < 4_917_800; i++) rng.next();
    const a = new PeopleSim(map, builder, rng);
    run(a, station, 100);
    const save = JSON.parse(JSON.stringify(a.toJSON())) as PeopleJSON;
    expect(isU32(save.rng)).toBe(true);
    const b = new PeopleSim(map, builder, new Rng(1));
    b.load(save);
    b.persons = structuredClone(a.persons);
    const want = run(a, station, 200);
    expect(run(b, station, 200)).toEqual(want);
    expect(Math.max(...waitingCounts(want))).toBeGreaterThan(0);
    expect(b.toJSON()).toEqual(a.toJSON());
  });

  it('keeps the seeded stream when a save carries none', () => {
    const { map, builder } = world();
    const seeded = new PeopleSim(map, builder).toJSON();
    for (const j of [undefined, null, {}, { rng: '17' }, { rng: null }, 5]) {
      const people = new PeopleSim(map, builder);
      people.load(j);
      expect(people.toJSON()).toEqual(seeded);
    }
  });
});

describe('walkers and a works closed for its upgrade', () => {
  it('neither live at it nor walk home to it until it opens again', () => {
    const { map, builder, station } = world();
    const mill = builder.buildingAt(27, 34)!;
    const key = `b${mill.x},${mill.y}`;
    const people = new PeopleSim(map, builder, new Rng(3));
    run(people, station, 1);
    const lived = people.persons.filter((p) => p.home === key);
    expect(lived.length).toBeGreaterThan(0);
    // one of them on its way home to the works, a few tiles off
    const walker = lived[0];
    const path = findWalk(map, { x: 27, y: 40 }, mill)!;
    Object.assign(walker, { state: 'return', path, step: 0, x: 27, y: 40, timer: 0 });

    mill.work = startWork(2)!;
    expect(people.places().map((p) => p.key)).not.toContain(key);
    people.tick(DT, POPULATION, MIDDAY);
    // the walker turned for its new home where it stood
    expect(walker.state).toBe('return');
    expect(walker.home).not.toBe(key);
    const home = people.places().find((p) => p.key === walker.home)!;
    expect(walker.path.at(-1)).toEqual({ x: home.x, y: home.y });
    expect(walker.y).toBeGreaterThan(38);
    for (let i = 0; i < 400; i++) {
      for (const p of people.persons) {
        expect(p.home, `tick ${i}`).not.toBe(key);
        if (p.state === 'return' || p.state === 'walk')
          expect(p.path.at(-1), `tick ${i}`).not.toEqual({ x: mill.x, y: mill.y });
      }
      people.tick(DT, POPULATION, MIDDAY);
    }

    delete mill.work;
    expect(people.places().map((p) => p.key)).toContain(key);
  });
});

// ------------------------------------------------------------------ properties over layouts
//
// Seeded layouts: a line with passenger and resource stations on either side, crewed works,
// patches of forest, hill, water and rock, a population, a day running past dawn and dusk, and
// trains boarding and alighting at given ticks. Math.random throws throughout (beforeEach).

type StationKind = 'station' | 'farm' | 'lumber' | 'quarry' | 'pump';
const RESOURCE_KINDS: readonly StationKind[] = ['farm', 'lumber', 'quarry', 'pump'];
const GROUNDS: readonly Terrain[] = [Terrain.Forest, Terrain.Hill, Terrain.Water, Terrain.Rock];
const SIZE = 40;
const LINE = 20;

interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
  ground: Terrain;
}
/** A station on the tile above (side -1) or below (side 1) the line at column x. */
interface Spot {
  x: number;
  side: -1 | 1;
  kind: StationKind;
}
interface Works {
  x: number;
  y: number;
  id: 'windmill' | 'kiln';
}
/** Before tick `at`, a train boards or lets off `n` at placed station `station` (mod count). */
interface TrainCall {
  at: number;
  boards: boolean;
  station: number;
  n: number;
}
interface Case {
  mapSeed: number;
  /** null: PeopleSim seeds its own stream from the map; otherwise it is given Rng(stream) */
  stream: number | null;
  patches: Patch[];
  stations: Spot[];
  works: Works[];
  population: number;
  gdt: number;
  /** day fraction at tick 0, and how far it moves each tick */
  day0: number;
  dayStep: number;
  ticks: number;
  /** the save is taken after this many ticks, 0..ticks */
  saveAt: number;
  calls: TrainCall[];
}

function genCase(rng: Rng): Case {
  const ticks = rng.int(40, 240);
  const side = (): -1 | 1 => (rng.chance(0.5) ? -1 : 1);
  const stations: Spot[] = [{ x: rng.int(4, SIZE - 5), side: side(), kind: 'station' }];
  for (let i = rng.int(0, 4); i > 0; i--)
    stations.push({
      x: rng.int(3, SIZE - 4),
      side: side(),
      kind: rng.chance(0.25) ? 'station' : rng.pick(RESOURCE_KINDS),
    });
  const patches: Patch[] = [];
  for (let i = rng.int(0, 5); i > 0; i--) {
    // above or below the line, clear of the station rows
    const y = rng.chance(0.5) ? rng.int(2, LINE - 7) : rng.int(LINE + 3, SIZE - 6);
    patches.push({
      x: rng.int(0, SIZE - 6),
      y,
      w: rng.int(1, 6),
      h: rng.int(1, 5),
      ground: rng.pick(GROUNDS),
    });
  }
  const works: Works[] = [];
  for (let i = rng.int(0, 3); i > 0; i--)
    works.push({
      x: rng.int(2, SIZE - 3),
      y: LINE + side() * rng.int(3, 8),
      id: rng.chance(0.5) ? 'windmill' : 'kiln',
    });
  const calls: TrainCall[] = [];
  for (let i = rng.int(0, 6); i > 0; i--)
    calls.push({
      at: rng.int(0, ticks - 1),
      boards: rng.chance(0.5),
      station: rng.int(0, 4),
      n: rng.int(0, 8),
    });
  return {
    mapSeed: rng.int(0, 0x7fffffff),
    stream: rng.chance(0.5) ? null : rng.int(0, 0xffffffff),
    patches,
    stations,
    works,
    population: rng.int(0, 48),
    gdt: rng.pick([0.25, 0.5, 1, 2.5]),
    day0: rng.next(),
    dayStep: rng.pick([0, 0.001, 0.004, 0.02]),
    ticks,
    saveAt: rng.int(0, ticks),
    calls,
  };
}

/** Fewer ticks, an earlier save, then fewer calls, patches, works, stations and walkers. */
function* shrinkCase(c: Case): Iterable<Case> {
  for (const ticks of shrinkInt(c.ticks, 1))
    yield {
      ...c,
      ticks,
      saveAt: Math.min(c.saveAt, ticks),
      calls: c.calls.filter((k) => k.at < ticks),
    };
  for (const saveAt of shrinkInt(c.saveAt)) yield { ...c, saveAt };
  for (const calls of shrinkArray(c.calls)) yield { ...c, calls };
  for (const patches of shrinkArray(c.patches)) yield { ...c, patches };
  for (const works of shrinkArray(c.works)) yield { ...c, works };
  for (const stations of shrinkArray(c.stations)) if (stations.length) yield { ...c, stations };
  for (const population of shrinkInt(c.population)) yield { ...c, population };
}

function layout(c: Case) {
  resetStationIds(1);
  const map = emptyMap(c.mapSeed, SIZE, SIZE, Terrain.Grass);
  for (const p of c.patches)
    for (let y = p.y; y < Math.min(SIZE, p.y + p.h); y++)
      for (let x = p.x; x < Math.min(SIZE, p.x + p.w); x++) map.terrain[y * SIZE + x] = p.ground;
  const track = new TrackGraph(SIZE, SIZE);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  for (let x = 2; x < SIZE - 2; x++) track.place(x, LINE, 'straight', 1);
  const stations: Station[] = [];
  for (const s of c.stations) {
    const st = builder.placeStation(s.x, LINE + s.side, s.kind);
    if (st) stations.push(st);
  }
  for (const w of c.works) builder.placeBuilding(w.x, w.y, w.id);
  return { map, builder, stations };
}
type Layout = ReturnType<typeof layout>;

/** The sim the case asks for: seeded from the map, or on an injected stream. */
const sim = (f: Layout, c: Case) =>
  c.stream === null
    ? new PeopleSim(f.map, f.builder)
    : new PeopleSim(f.map, f.builder, new Rng(c.stream));
/** A sim on a stream other than the case's, so a load that keeps nothing shows. */
const elsewhere = (f: Layout, c: Case) =>
  new PeopleSim(f.map, f.builder, new Rng(((c.stream ?? c.mapSeed) ^ 0x5a5a5a5a) >>> 0));

/**
 * Ticks [from, to) of the case: the train calls due, one tick, then what everyone is doing. Ids
 * are left out: a loaded sim numbers its walkers anew.
 */
function play(people: PeopleSim, f: Layout, c: Case, from: number, to: number) {
  const trace: string[] = [];
  for (let t = from; t < to; t++) {
    for (const k of c.calls) {
      const st = f.stations[k.station % f.stations.length];
      if (k.at !== t || !st) continue;
      if (k.boards) people.board(st, k.n);
      else people.alight(st, k.n);
    }
    people.tick(c.gdt, c.population, (c.day0 + t * c.dayStep) % 1);
    const waiting = f.stations.map((s) => people.waitingAt(s.id).length).join(',');
    const who = people.persons.map((p) =>
      [p.state, p.x, p.y, p.timer, p.home, p.outfit, p.stationId, p.step, p.path.length].join(' '),
    );
    trace.push(`${waiting}|${who.join(';')}`);
  }
  return trace;
}

/** Throws at the first tick where two traces part, naming it and both sides. */
function sameTrace(what: string, want: string[], got: string[], from: number) {
  const clip = (s: string | undefined) => (s === undefined ? '(none)' : s.slice(0, 240));
  for (let i = 0; i < Math.max(want.length, got.length); i++)
    if (want[i] !== got[i])
      throw new Error(
        `${what}: the traces part at tick ${from + i}\n  want ${clip(want[i])}\n  got  ${clip(got[i])}`,
      );
}

/** The walkers had something to do: someone waited on a platform while the trace ran. */
const someoneWaited = (trace: string[]) =>
  trace.some((t) =>
    t
      .split('|')[0]
      .split(',')
      .some((n) => Number(n) > 0),
  );

/** A sim on an empty map of the given seed and side. */
function bare(seed: number, side = 8) {
  const map = emptyMap(seed, side, side, Terrain.Grass);
  const builder = new Builder(
    map,
    new RegionState(map),
    new TrackGraph(side, side),
    new Economy(),
    new Stockpile(),
  );
  return { map, builder };
}

describe('PeopleSim randomness, over seeded layouts', () => {
  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('plays the same walkers from the same seed', { timeout: 20_000 }, () => {
    let busy = 0;
    forAll(
      genCase,
      (c) => {
        const f = layout(c);
        const a = play(sim(f, c), f, c, 0, c.ticks);
        sameTrace('two sims from one seed', a, play(sim(f, c), f, c, 0, c.ticks), 0);
        if (someoneWaited(a)) busy++;
      },
      { shrink: shrinkCase },
    );
    // the traces are worth comparing: in many layouts travellers reach a platform
    expect(busy).toBeGreaterThan(SEEDS.length / 4);
    expect(Math.random).not.toHaveBeenCalled();
  });

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('carries on the same draws after a save taken at any tick', { timeout: 20_000 }, () => {
    let busy = 0;
    forAll(
      genCase,
      (c) => {
        const f = layout(c);
        const a = sim(f, c);
        play(a, f, c, 0, c.saveAt);
        const save = JSON.stringify(a.toJSON());
        const outAtSave = a.persons.some((p) => p.state !== 'inside');

        // loaded on another stream, with the walkers handed over as they were
        const b = elsewhere(f, c);
        b.load(JSON.parse(save));
        b.persons = structuredClone(a.persons);
        // a twin of a that reloads its own save in place
        const twin = sim(f, c);
        play(twin, f, c, 0, c.saveAt);
        twin.load(JSON.parse(JSON.stringify(twin.toJSON())));
        // what a load does in the game: a fresh sim, the walkers starting over
        const cleared = sim(f, c);
        play(cleared, f, c, 0, c.saveAt);
        cleared.persons = [];
        const fresh = elsewhere(f, c);
        fresh.load(JSON.parse(save));

        const rest = (people: PeopleSim) => play(people, f, c, c.saveAt, c.ticks);
        const want = rest(a);
        sameTrace('loaded with the walkers', want, rest(b), c.saveAt);
        sameTrace('reloaded in place', want, rest(twin), c.saveAt);
        sameTrace('loaded, the walkers starting over', rest(cleared), rest(fresh), c.saveAt);
        // the save fell mid-activity and travellers reached a platform after it
        if (outAtSave && someoneWaited(want)) busy++;
      },
      { shrink: shrinkCase },
    );
    expect(busy).toBeGreaterThan(SEEDS.length / 4);
    expect(Math.random).not.toHaveBeenCalled();
  });

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it(
    'saves its stream as a 32-bit integer at any tick, and loads it back unchanged',
    { timeout: 20_000 },
    () => {
      let moved = 0;
      forAll(
        genCase,
        (c) => {
          const f = layout(c);
          const a = sim(f, c);
          const b = elsewhere(f, c);
          const seeded = a.toJSON().rng;
          for (let t = 0; t < c.ticks; t++) {
            play(a, f, c, t, t + 1);
            const save = JSON.parse(JSON.stringify(a.toJSON())) as PeopleJSON;
            if (!isU32(save.rng))
              throw new Error(`after tick ${t} the stream saved as ${save.rng}`);
            b.load(save);
            expect(b.toJSON()).toEqual(save);
          }
          if (a.toJSON().rng !== seeded) moved++;
        },
        { shrink: shrinkCase },
      );
      // the walkers drew: most streams moved from where they were seeded
      expect(moved).toBeGreaterThan(SEEDS.length / 2);
      expect(Math.random).not.toHaveBeenCalled();
    },
  );

  it('seeds its own stream from the map seed alone', () => {
    const firstDraws = (people: PeopleSim) => {
      const rng = new Rng(0);
      rng.state = people.toJSON().rng;
      return JSON.stringify(Array.from({ length: 8 }, () => rng.next()));
    };
    const own = (seed: number, side: number) => {
      const { map, builder } = bare(seed, side);
      return new PeopleSim(map, builder);
    };
    forAll(
      (rng) => {
        const a = rng.int(0, 0x7fffffff);
        return { a, b: rng.chance(0.3) ? a : rng.int(0, 0x7fffffff), side: rng.int(4, 24) };
      },
      // the map's size does not enter it, only its seed
      ({ a, b, side }) => (firstDraws(own(a, side)) === firstDraws(own(b, 8))) === (a === b),
    );
  });

  it('keeps the stream seeded from the map when a save has no number for it', () => {
    const junk: ((rng: Rng) => unknown)[] = [
      () => undefined,
      () => null,
      (rng) => rng.int(0, 1000),
      (rng) => String(rng.int(0, 1000)),
      () => true,
      (rng) => [rng.int(0, 1000)],
      () => ({}),
      (rng) => ({ rng: String(rng.int(0, 1000)) }),
      () => ({ rng: null }),
      () => ({ rng: true }),
      (rng) => ({ rng: [rng.int(0, 1000)] }),
      (rng) => ({ rng: { state: rng.int(0, 1000) } }),
      (rng) => ({ seed: rng.int(0, 1000) }),
    ];
    forAll(
      (rng) => ({ mapSeed: rng.int(0, 0x7fffffff), save: rng.pick(junk)(rng) }),
      ({ mapSeed, save }) => {
        const { map, builder } = bare(mapSeed);
        const seeded = new PeopleSim(map, builder).toJSON();
        const people = new PeopleSim(map, builder);
        people.load(save);
        expect(people.toJSON()).toEqual(seeded);
      },
    );
  });
});

// ------------------------------------------------------------------ homes that close

/** The key `places()` gives a station, a works and a decor place. */
const stationKey = (s: { id: number }) => `s${s.id}`;
const worksKey = (b: { x: number; y: number }) => `b${b.x},${b.y}`;
const decorKey = (d: { x: number; y: number }) => `d${d.x},${d.y}`;
const keysOf = (people: PeopleSim) => people.places().map((p) => p.key);

/** Close a station or works for an upgrade to its next level, or open it again. */
function setClosed(x: Station | Building, closed: boolean) {
  if (x instanceof Station) x.work = closed ? startWork(x.level + 1) : null;
  else if (closed) x.work = startWork(2)!;
  else delete x.work;
}

/** The rule's oracle: of the places, the first listed of those nearest (x, y) by |dx| + |dy|. */
function nearestOf(places: readonly Place[], x: number, y: number): Place | undefined {
  const dist = (pl: Place) => Math.abs(pl.x - x) + Math.abs(pl.y - y);
  const least = Math.min(...places.map(dist));
  return places.find((pl) => dist(pl) === least);
}

/** Every walker's state, to tell afterwards who set out on a walk in a tick. */
const statesOf = (people: PeopleSim) => new Map(people.persons.map((p) => [p, p.state]));
/** The walkers who set out to gather in the last tick, given their states before it. */
const setOutToGather = (people: PeopleSim, before: Map<Person, PersonState>) =>
  people.persons.filter((p) => p.state === 'gather' && before.get(p) !== 'gather');

/** Before tick `at`, a station or works (by index, modulo their count) closes, opens or goes. */
interface Shut {
  at: number;
  what: 'station' | 'works';
  index: number;
  act: 'close' | 'open' | 'remove';
}
type DecorKind = 'water_tower' | 'fuel_stop' | 'townhouse' | 'power_line';
const DECOR_KINDS: readonly DecorKind[] = ['water_tower', 'fuel_stop', 'townhouse', 'power_line'];
/** A seeded layout with a depot, decor, and stations and works closing, opening and going. */
interface ShutCase extends Case {
  /** a depot standing apart, low on the map at this column, or none */
  depot: number | null;
  /** service stops and houses, which are places, and power poles, which are not */
  decor: { x: number; y: number; id: DecorKind }[];
  shuts: Shut[];
  /** for `places()` alone: which stations and works are closed, in the order they stand */
  closed: boolean[];
}

function genShutCase(rng: Rng): ShutCase {
  const c = genCase(rng);
  return {
    ...c,
    depot: rng.chance(0.6) ? rng.int(2, SIZE - 4) : null,
    decor: Array.from({ length: rng.int(0, 4) }, () => ({
      x: rng.int(1, SIZE - 2),
      y: LINE + (rng.chance(0.5) ? -1 : 1) * rng.int(2, 9),
      id: rng.pick(DECOR_KINDS),
    })),
    shuts: Array.from({ length: rng.int(1, 6) }, () => ({
      at: rng.int(0, c.ticks - 1),
      what: rng.chance(0.6) ? ('station' as const) : ('works' as const),
      index: rng.int(0, 5),
      act: rng.pick(['close', 'close', 'close', 'open', 'remove'] as const),
    })),
    closed: Array.from({ length: 12 }, () => rng.chance(0.5)),
  };
}

/** Fewer closings, decor and no depot, then the layout itself smaller (`shrinkCase`). */
function* shrinkShutCase(c: ShutCase): Iterable<ShutCase> {
  for (const shuts of shrinkArray(c.shuts)) yield { ...c, shuts };
  for (const decor of shrinkArray(c.decor)) yield { ...c, decor };
  if (c.depot !== null) yield { ...c, depot: null };
  for (const smaller of shrinkCase(c))
    yield { ...c, ...smaller, shuts: c.shuts.filter((s) => s.at < smaller.ticks) };
}

/** The case's layout with its depot and decor. */
function shutLayout(c: ShutCase) {
  const f = layout(c);
  if (c.depot !== null) f.builder.stations.push(new Station('depot', c.depot, SIZE - 3));
  for (const d of c.decor) f.builder.spawnDecor(d.x, d.y, d.id, 0);
  return f;
}

/** Every station and works, in the order they stand. */
const sites = (f: Layout): (Station | Building)[] => [
  ...f.builder.stations,
  ...f.builder.buildings.values(),
];

function applyShut(f: Layout, s: Shut) {
  const list = s.what === 'station' ? f.builder.stations : [...f.builder.buildings.values()];
  const x = list[s.index % Math.max(1, list.length)];
  if (!x) return;
  if (s.act === 'remove') {
    if (x instanceof Station) f.builder.removeStation(x);
    else f.builder.removeBuilding(x.x, x.y);
  } else setClosed(x, s.act === 'close');
}

/**
 * The sim as it would stand had each walker in `homes` lived at the place given for it all along,
 * one on its way home ('return') walking there from the tile it stands on: the same stream and
 * walkers otherwise. Ticked beside the real sim, it shows what re-homing changes besides the home.
 */
function rehomedTwin(
  people: PeopleSim,
  f: Pick<Layout, 'map' | 'builder'>,
  homes: Map<Person, Place>,
) {
  const twin = new PeopleSim(f.map, f.builder, new Rng(0));
  twin.load(people.toJSON());
  twin.persons = people.persons.map((p) => {
    const q = structuredClone(p);
    const home = homes.get(p);
    if (!home) return q;
    q.home = home.key;
    if (q.state === 'return') {
      const back = findWalk(f.map, { x: Math.round(q.x), y: Math.round(q.y) }, home);
      if (back && back.length >= 2) Object.assign(q, { path: back, step: 0 });
    }
    return q;
  });
  return twin;
}

/** Where two sims part, ids aside (a twin numbers new walkers anew), or null when they do not. */
function parting(a: PeopleSim, b: PeopleSim): string | null {
  const [ra, rb] = [a.toJSON().rng, b.toJSON().rng];
  if (ra !== rb) return `the streams part, ${ra} against ${rb}`;
  if (a.persons.length !== b.persons.length)
    return `${a.persons.length} walkers against ${b.persons.length}`;
  for (let i = 0; i < a.persons.length; i++) {
    const x = JSON.stringify({ ...a.persons[i], id: 0 });
    const y = JSON.stringify({ ...b.persons[i], id: 0 });
    if (x !== y)
      return `walker ${a.persons[i].id}\n  got  ${x.slice(0, 240)}\n  want ${y.slice(0, 240)}`;
  }
  return null;
}

/**
 * Plays the case with its closings, checking every tick: a walker whose home is not among the
 * places has, after the tick, the first listed of the open places nearest to where it stood; a
 * walker whose home is among them keeps it; while any place is open every walker lives at one
 * and there are as many as the population; a walk out to gather starts at the walker's own open
 * home; and with no place open the walkers stay as they are. With `twin`, the tick also equals a
 * `rehomedTwin`'s: re-homing changes the home, and the way home of a walker on it, and nothing
 * else, drawing nothing. Returns how many walkers were re-homed, and in which states.
 */
function playShut(people: PeopleSim, f: Layout, c: ShutCase, twin = false) {
  let moved = 0;
  const states = new Set<PersonState>();
  const regular = () => people.persons.filter((p) => !p.transient);
  for (let t = 0; t < c.ticks; t++) {
    for (const s of c.shuts) if (s.at === t) applyShut(f, s);
    for (const k of c.calls) {
      const st = f.stations[k.station % f.stations.length];
      if (k.at !== t || !st) continue;
      if (k.boards) people.board(st, k.n);
      else people.alight(st, k.n);
    }
    const places = people.places();
    const open = new Set(places.map((p) => p.key));
    const want = new Map<Person, { home: Place; from: string }>();
    for (const p of regular())
      if (places.length && !open.has(p.home))
        want.set(p, { home: nearestOf(places, p.x, p.y)!, from: `${p.home} at ${p.x},${p.y}` });
    const homes = new Map(regular().map((p) => [p, p.home]));
    const before = statesOf(people);
    const still = structuredClone(regular());
    const day = (c.day0 + t * c.dayStep) % 1;
    const other = twin
      ? rehomedTwin(people, f, new Map([...want].map(([p, w]) => [p, w.home])))
      : null;
    people.tick(c.gdt, c.population, day);
    other?.tick(c.gdt, c.population, day);
    const at = `tick ${t}`;
    if (!places.length) {
      expect(regular(), `${at}: no place open`).toEqual(still);
      continue;
    }
    for (const [p, { home, from }] of want) {
      if (p.home !== home.key)
        throw new Error(`${at}: walker ${p.id} of ${from} went to ${p.home}, not ${home.key}`);
      moved++;
      states.add(before.get(p)!);
    }
    for (const p of regular()) {
      const had = homes.get(p);
      if (had !== undefined && open.has(had) && p.home !== had)
        throw new Error(`${at}: walker ${p.id} moved from ${had}, which is open, to ${p.home}`);
    }
    expect(regular().length, at).toBe(c.population);
    const homeless = regular().find((p) => !open.has(p.home));
    if (homeless) throw new Error(`${at}: walker ${homeless.id} lives at ${homeless.home}`);
    for (const p of setOutToGather(people, before)) {
      const home = places.find((pl) => pl.key === p.home);
      if (!home || p.path[0].x !== home.x || p.path[0].y !== home.y)
        throw new Error(`${at}: walker ${p.id} of ${p.home} set out to gather from elsewhere`);
    }
    const parted = other && parting(people, other);
    if (parted) throw new Error(`${at}: re-homing changed more than the home: ${parted}`);
  }
  return { moved, states };
}

describe('PeopleSim.places(), over seeded layouts', () => {
  it('lists exactly the open stations and works and the decor with crew or residents', () => {
    let closed = 0,
      depots = 0,
      decor = 0;
    forAll(
      genShutCase,
      (c) => {
        const f = shutLayout(c);
        const people = new PeopleSim(f.map, f.builder, new Rng(1));
        const all = sites(f);
        all.forEach((x, i) => setClosed(x, c.closed[i % c.closed.length]));
        const keys = keysOf(people);
        const want = [
          ...f.builder.stations.filter((s) => !s.closed).map(stationKey),
          ...[...f.builder.buildings.values()]
            .filter((b) => !b.work && buildingDef(b.id).crew > 0)
            .map(worksKey),
          ...[...f.builder.decor.values()]
            .filter((d) => decorDef(d.id).crew > 0 || !!decorDef(d.id).residents)
            .map(decorKey),
        ];
        expect([...keys].sort()).toEqual([...want].sort());
        expect(new Set(keys).size, 'listed twice').toBe(keys.length);
        for (const s of f.builder.stations) expect(keys.includes(stationKey(s))).toBe(!s.closed);
        for (const b of f.builder.buildings.values())
          if (b.work) expect(keys).not.toContain(worksKey(b));
        // each where it stands
        const things = [...f.builder.buildings.values(), ...f.builder.decor.values()];
        for (const pl of people.places()) {
          const at =
            f.builder.stations.find((s) => stationKey(s) === pl.key) ??
            things.find((x) => worksKey(x) === pl.key || decorKey(x) === pl.key);
          expect(at && [at.x, at.y], pl.key).toEqual([pl.x, pl.y]);
        }
        closed += all.filter((x) => (x instanceof Station ? x.closed : !!x.work)).length;
        if (f.builder.stations.some((s) => s.def.depot && !s.closed)) depots++;
        if (want.some((k) => k.startsWith('d'))) decor++;
      },
      { shrink: shrinkShutCase },
    );
    // the layouts are worth checking: things closed, an open depot and decor places in many
    expect(closed).toBeGreaterThan(SEEDS.length);
    expect(depots).toBeGreaterThan(SEEDS.length / 5);
    expect(decor).toBeGreaterThan(SEEDS.length / 5);
  });

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it(
    'gives a walker whose home closed or went the nearest open place, leaving nobody homeless',
    { timeout: 20_000 },
    () => {
      let moved = 0;
      forAll(
        genShutCase,
        (c) => {
          const f = shutLayout(c);
          moved += playShut(sim(f, c), f, c).moved;
        },
        { shrink: shrinkShutCase },
      );
      // the property is worth checking: walkers lost their homes in many layouts
      expect(moved).toBeGreaterThan(SEEDS.length);
      expect(Math.random).not.toHaveBeenCalled();
    },
  );

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it(
    'changes nothing but the home, and a way home, of a walker whose home closed or went',
    { timeout: 20_000 },
    () => {
      // Beside each tick runs a twin in which every displaced walker already lived at its new
      // home, one on its way home already walking there from where it stands: after the tick the
      // two match walker for walker and stream for stream: whatever the walker was doing, it
      // carries on as it was, and no timer, place or draw moves.
      const states = new Set<PersonState>();
      forAll(
        genShutCase,
        (c) => {
          const f = shutLayout(c);
          for (const s of playShut(sim(f, c), f, c, true).states) states.add(s);
        },
        { shrink: shrinkShutCase },
      );
      // the twins are worth comparing: walkers were re-homed inside, idling, bound for a train
      // and waiting for one ('re-homing a walker whose home closed' takes every state in turn)
      for (const s of ['inside', 'idle', 'toStation', 'waiting'] as const)
        expect([...states], `nobody re-homed while ${s}`).toContain(s);
      expect(Math.random).not.toHaveBeenCalled();
    },
  );

  it('gives a new walker a random first home among the open places', () => {
    // A layout with a random set of its stations and works closed fills up with as many walkers
    // as a town has: each new walker's home is an open place, every open place gets some, and
    // which goes where follows the stream, so another stream homes them otherwise.
    let several = 0;
    forAll(
      genShutCase,
      (c) => {
        const f = shutLayout(c);
        sites(f).forEach((x, i) => setClosed(x, c.closed[i % c.closed.length]));
        const homesOn = (people: PeopleSim) => {
          people.tick(DT, 160, MIDDAY);
          return people.persons.filter((p) => !p.transient).map((p) => p.home);
        };
        const people = sim(f, c);
        const places = people.places();
        const stream = people.toJSON().rng;
        const homes = homesOn(people);
        if (!places.length) {
          expect(homes).toEqual([]);
          return;
        }
        expect(homes.length).toBe(160);
        const open = new Set(places.map((p) => p.key));
        expect(
          homes.filter((h) => !open.has(h)),
          'homed at no open place',
        ).toEqual([]);
        expect(new Set(homes), 'an open place nobody was homed at').toEqual(open);
        expect(people.toJSON().rng, 'the stream did not move').not.toBe(stream);
        if (places.length < 2) return;
        expect(homesOn(elsewhere(f, c)), 'another stream homed them the same').not.toEqual(homes);
        several++;
      },
      { shrink: shrinkShutCase },
    );
    // the property is worth checking: most layouts had more than one open place to pick from
    expect(several).toBeGreaterThan(SEEDS.length / 2);
    expect(Math.random).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ a home closing, case by case

/** The ground each resource station's walkers go out to gather. */
const GATHER_GROUND: Record<string, Terrain> = {
  farm: Terrain.Grass,
  lumber: Terrain.Forest,
  quarry: Terrain.Hill,
  pump: Terrain.Water,
};

/** A grass map of the seed with straight track along row `row`, and a builder that builds free. */
function flat(seed: number, w: number, h: number, row: number) {
  const map = emptyMap(seed, w, h, Terrain.Grass);
  const track = new TrackGraph(w, h);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  for (let x = 2; x < w - 2; x++) track.place(x, row, 'straight', 1);
  return { map, builder };
}

/**
 * The walkers' first tick, after which everyone lives at the place under `key` at (x, y) and is
 * inside it, as if it had been each one's first home.
 */
function moveIn(people: PeopleSim, key: string, at: { x: number; y: number }) {
  people.tick(DT, POPULATION, MIDDAY);
  expect(keysOf(people)).toContain(key);
  for (const p of people.persons) {
    expect(p.state).toBe('inside');
    Object.assign(p, { home: key, x: at.x, y: at.y });
  }
}

describe('walkers and a station closed for its upgrade', () => {
  // each case runs a thousand ticks or so; the margin keeps a loaded CI runner green
  it(
    'neither live at it nor set out from it to gather, and do again once it opens',
    { timeout: 20_000 },
    () => {
      forAll(
        (rng) => ({
          kind: rng.pick(RESOURCE_KINDS),
          mapSeed: rng.int(0, 0x7fffffff),
          stream: rng.int(0, 0xffffffff),
          settle: rng.int(0, 120),
        }),
        (c) => {
          // a resource station above a patch of its ground, a windmill and a passenger station
          const { map, builder } = flat(c.mapSeed, 48, 48, 20);
          for (let y = 24; y < 28; y++)
            for (let x = 10; x < 19; x++) map.terrain[y * 48 + x] = GATHER_GROUND[c.kind];
          const site = builder.placeStation(14, 21, c.kind)!;
          const mill = builder.placeBuilding(24, 24, 'windmill')!;
          const town = builder.placeStation(30, 21, 'station')!;
          expect([site, mill, town].every(Boolean)).toBe(true);
          const key = stationKey(site);
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          moveIn(people, key, site);
          // the day goes on: some step out to idle by the door or to gather
          for (let i = 0; i < c.settle; i++) people.tick(DT, POPULATION, MIDDAY);
          const lived = people.persons.filter((p) => p.home === key);

          setClosed(site, true);
          const places = people.places();
          expect(places.map((p) => p.key)).not.toContain(key);
          const want = lived.map((p) => nearestOf(places, p.x, p.y)!.key);
          people.tick(DT, POPULATION, MIDDAY);
          expect(lived.map((p) => p.home)).toEqual(want);
          for (let i = 0; i < 400; i++) {
            const before = statesOf(people);
            people.tick(DT, POPULATION, MIDDAY);
            const lives = people.persons.find((p) => p.home === key);
            if (lives) throw new Error(`tick ${i}: walker ${lives.id} lives at the closed station`);
            const out = setOutToGather(people, before).find(
              (p) => p.path[0].x === site.x && p.path[0].y === site.y,
            );
            if (out) throw new Error(`tick ${i}: walker ${out.id} set out from it to gather`);
          }

          // the work done, it is a place again, and walkers newly homed there go gathering
          setClosed(site, false);
          expect(keysOf(people)).toContain(key);
          const old = new Set(people.persons);
          let gathered = false;
          for (let i = 0; i < 600 && !gathered; i++) {
            const before = statesOf(people);
            people.tick(DT, 3 * POPULATION, MIDDAY);
            gathered = setOutToGather(people, before).some(
              (p) =>
                !old.has(p) && p.home === key && p.path[0].x === site.x && p.path[0].y === site.y,
            );
          }
          expect(gathered, 'nobody newly homed there went gathering').toBe(true);
        },
      );
    },
  );

  it('turns a walker on its way home to it where it stands, for the nearest open place', () => {
    forAll(
      (rng) => ({
        x: rng.int(18, 42) + rng.pick([0, 0.25, 0.5, 0.75]),
        y: rng.int(37, 46) + rng.pick([0, 0.4]),
        stream: rng.int(0, 0xffffffff),
      }),
      (c) => {
        const { map, builder, station } = world();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        const from = { x: Math.round(c.x), y: Math.round(c.y) };
        const path = findWalk(map, from, station)!;
        Object.assign(p, {
          home: stationKey(station),
          state: 'return',
          path,
          step: 0,
          x: c.x,
          y: c.y,
          timer: 0,
        });
        setClosed(station, true);
        const home = nearestOf(people.places(), c.x, c.y)!;
        people.tick(DT, 1, MIDDAY);
        expect(p.state).toBe('return');
        expect(p.home).toBe(home.key);
        expect(p.path[0]).toEqual(from);
        expect(p.path.at(-1)).toEqual({ x: home.x, y: home.y });
      },
    );
  });
});

describe('walkers and a house being upgraded', () => {
  it('keep living there: only a station or works under upgrade stops being a home', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 2, 30, 40);
    const town = placeStation(w, 'station', 20, 31);
    w.builder.free = true;
    const mill = w.builder.placeBuilding(26, 34, 'windmill')!;
    expect(w.builder.spawnDecor(20, 25, 'townhouse', 0)).not.toBeNull();
    w.builder.free = false;
    w.houses.finishAll();
    const house = w.houses.at(20, 25)!;
    const key = decorKey(house);
    const people = new PeopleSim(w.map, w.builder, new Rng(5));
    moveIn(people, key, house);
    const ids = people.persons.map((p) => p.id);

    // with the station and works open to go to, the walkers stay
    house.work = startWork(2)!;
    expect(keysOf(people)).toEqual([stationKey(town), worksKey(mill), key]);
    for (let i = 0; i < 400; i++) {
      people.tick(DT, POPULATION, MIDDAY);
      const regular = people.persons.filter((p) => !p.transient);
      expect(
        regular.map((p) => [p.id, p.home]),
        `tick ${i}`,
      ).toEqual(ids.map((id) => [id, key]));
    }
    expect(house.work).toBeDefined();
    // the station and works being upgraded too leave the list; the house stays on it
    setClosed(town, true);
    setClosed(mill, true);
    expect(keysOf(people)).toEqual([key]);
  });
});

describe('re-homing a walker whose home closed', () => {
  const STATES: readonly PersonState[] = [
    'inside',
    'idle',
    'walk',
    'gather',
    'toStation',
    'waiting',
    'return',
  ];

  it('draws no random number, whatever the walker is doing', () => {
    forAll(
      (rng) => ({
        state: rng.pick(STATES),
        closes: rng.pick(['station', 'works'] as const),
        stream: rng.int(0, 0xffffffff),
        x: rng.int(4, 12),
        y: rng.int(38, 46),
      }),
      (c) => {
        const { map, builder, station } = world();
        const mill = builder.buildingAt(27, 34)!;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        // far from the end of a long walk to its home, every timer far from running out
        const home = c.closes === 'station' ? station : mill;
        Object.assign(p, {
          home: c.closes === 'station' ? stationKey(station) : worksKey(mill),
          state: c.state,
          path: findWalk(map, { x: c.x, y: c.y }, home)!,
          step: 0,
          x: c.x,
          y: c.y,
          timer: 1000,
          stationId: station.id,
        });
        setClosed(home, true);
        const want = nearestOf(people.places(), c.x, c.y)!;
        const stream = people.toJSON().rng;
        people.tick(DT, 1, MIDDAY);
        expect(people.toJSON().rng, 'the stream moved').toBe(stream);
        expect(people.persons).toEqual([p]);
        expect(p.home).toBe(want.key);
      },
    );
  });

  it('changes nothing else, whatever the walker is doing, as its walks and timers run out', () => {
    // One walker in any state, anywhere along a walk to its home, with any time left in its
    // state, by day, at dusk or at night, loses its home. A twin that already lived at the new
    // home (one on its way home walking there from where it stands) plays the same, tick for
    // tick, walker and stream: a gatherer, idler or traveller carries on as it was.
    let ranOut = 0;
    forAll(
      (rng) => ({
        state: rng.pick(STATES),
        closes: rng.pick(['station', 'works'] as const),
        stream: rng.int(0, 0xffffffff),
        x: rng.int(4, 40),
        y: rng.int(36, 46),
        along: rng.next(),
        timer: rng.pick([0.5, 5, 30, 1000]),
        day: rng.pick([MIDDAY, 0.84, 0.95]),
        ticks: rng.int(1, 60),
      }),
      (c) => {
        const { map, builder, station } = world();
        const mill = builder.buildingAt(27, 34)!;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        const home = c.closes === 'station' ? station : mill;
        const path = findWalk(map, { x: c.x, y: c.y }, home)!;
        const step = Math.floor(c.along * (path.length - 1));
        Object.assign(p, {
          home: c.closes === 'station' ? stationKey(station) : worksKey(mill),
          state: c.state,
          path,
          step,
          x: path[step].x,
          y: path[step].y,
          timer: c.timer,
          stationId: station.id,
        });
        setClosed(home, true);
        const want = nearestOf(people.places(), p.x, p.y)!;
        const twin = rehomedTwin(people, { map, builder }, new Map([[p, want]]));
        for (let i = 0; i < c.ticks; i++) {
          const day = (c.day + i * 0.002) % 1;
          people.tick(DT, 1, day);
          twin.tick(DT, 1, day);
          const parted = parting(people, twin);
          if (parted) throw new Error(`tick ${i}: ${parted}`);
        }
        expect(p.home).toBe(want.key);
        if (p.state !== c.state) ranOut++;
      },
    );
    // the twins are worth comparing: in many cases a walk or a timer ran out along the way
    expect(ranOut).toBeGreaterThan(SEEDS.length / 4);
  });

  it('leaves a traveller bound for or waiting at a station that closes as it was', () => {
    // A traveller walking to the platform or waiting on it plays the same with the station
    // closed as open, tick for tick, walker and stream; one that lived at the station has the
    // nearest open place for a home and is otherwise the same.
    forAll(
      (rng) => ({
        state: rng.pick(['toStation', 'waiting'] as const),
        livesThere: rng.chance(0.3),
        stream: rng.int(0, 0xffffffff),
        x: rng.int(20, 40),
        y: rng.int(36, 44),
        ticks: rng.int(1, 40),
      }),
      (c) => {
        const { map, builder, station } = world();
        const mill = builder.buildingAt(27, 34)!;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        const waits = c.state === 'waiting';
        Object.assign(p, {
          home: c.livesThere ? stationKey(station) : worksKey(mill),
          state: c.state,
          path: waits ? [] : findWalk(map, { x: c.x, y: c.y }, station)!,
          step: 0,
          x: waits ? station.x : c.x,
          y: waits ? station.y : c.y,
          timer: waits ? 1000 : 0,
          stationId: station.id,
        });
        // the same walker and stream played with the station open, then with it closed
        const play = (closed: boolean) => {
          const q = new PeopleSim(map, builder, new Rng(0));
          q.load(people.toJSON());
          q.persons = structuredClone(people.persons);
          setClosed(station, closed);
          const home = closed && c.livesThere ? nearestOf(q.places(), p.x, p.y)!.key : p.home;
          for (let i = 0; i < c.ticks; i++) q.tick(DT, 1, MIDDAY);
          setClosed(station, false);
          const [r] = q.persons;
          expect(r.home, closed ? 'closed' : 'open').toBe(home);
          return { ...r, home: '', stream: q.toJSON().rng };
        };
        const open = play(false);
        expect(play(true)).toEqual(open);
        // the comparison is worth making: it is still bound for the platform or waiting on it
        expect(['toStation', 'waiting']).toContain(open.state);
        expect(open.stationId).toBe(station.id);
      },
    );
  });

  it("gives the nearest open place however far, past a traveller's reach", () => {
    // the place that closes and a passenger station 15 to 48 tiles along the line, the only
    // other place: every walker that lived at the first goes to it, none is dropped, and one on
    // its way home turns for it
    let turned = 0;
    forAll(
      (rng) => ({
        far: rng.int(15, 48),
        closes: rng.pick(['station', 'works'] as const),
        mapSeed: rng.int(0, 0x7fffffff),
        stream: rng.int(0, 0xffffffff),
        settle: rng.int(0, 200),
      }),
      (c) => {
        const { map, builder } = flat(c.mapSeed, 64, 40, 20);
        const gone =
          c.closes === 'station'
            ? builder.placeStation(8, 21, 'farm')!
            : builder.placeBuilding(8, 24, 'windmill')!;
        const far = builder.placeStation(8 + c.far, 21, 'station')!;
        expect([gone, far].every(Boolean)).toBe(true);
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        moveIn(people, gone instanceof Station ? stationKey(gone) : worksKey(gone), gone);
        for (let i = 0; i < c.settle; i++) people.tick(DT, POPULATION, MIDDAY);
        const displaced = people.persons.filter((p) => !p.transient);
        const returning = displaced.filter((p) => p.state === 'return');
        setClosed(gone, true);
        expect(keysOf(people)).toEqual([stationKey(far)]);
        people.tick(DT, POPULATION, MIDDAY);
        expect(people.persons.filter((p) => !p.transient)).toEqual(displaced);
        expect(displaced.map((p) => p.home)).toEqual(displaced.map(() => stationKey(far)));
        for (const p of returning)
          if (p.state === 'return') {
            expect(p.path.at(-1)).toEqual({ x: far.x, y: far.y });
            turned++;
          }
      },
    );
    // the case is worth making: walkers were on their way home when it closed
    expect(turned).toBeGreaterThan(0);
  });

  // each case runs a few hundred ticks; the margin keeps a loaded CI runner green
  it('keeps it local: never the open place 30 or more tiles off', { timeout: 20_000 }, () => {
    forAll(
      (rng) => ({
        far: rng.int(30, 44),
        closes: rng.pick(['station', 'works'] as const),
        mapSeed: rng.int(0, 0x7fffffff),
        stream: rng.int(0, 0xffffffff),
        settle: rng.int(0, 200),
      }),
      (c) => {
        // the place that closes, a kiln a few tiles off and a passenger station far along the line
        const { map, builder } = flat(c.mapSeed, 64, 40, 20);
        const gone =
          c.closes === 'station'
            ? builder.placeStation(8, 21, 'farm')!
            : builder.placeBuilding(8, 24, 'windmill')!;
        const near = builder.placeBuilding(12, 24, 'kiln')!;
        const far = builder.placeStation(8 + c.far, 21, 'station')!;
        expect([gone, near, far].every(Boolean)).toBe(true);
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        moveIn(people, gone instanceof Station ? stationKey(gone) : worksKey(gone), gone);
        for (let i = 0; i < c.settle; i++) people.tick(DT, POPULATION, MIDDAY);
        const displaced = [...people.persons];

        setClosed(gone, true);
        const farKey = stationKey(far);
        for (let i = 0; i < 400; i++) {
          people.tick(DT, POPULATION, MIDDAY);
          for (const p of displaced) {
            const end = p.path.at(-1);
            if (p.home === farKey || (end && end.x === far.x && end.y === far.y))
              throw new Error(
                `tick ${i}: walker ${p.id} ${p.state} home ${p.home}, bound for the far station`,
              );
          }
        }
      },
    );
  });

  it('leaves the walkers as they are when no place is open', () => {
    forAll(
      (rng) => ({
        mapSeed: rng.int(0, 0x7fffffff),
        stream: rng.int(0, 0xffffffff),
        population: rng.int(1, 30),
        settle: rng.int(1, 200),
      }),
      (c) => {
        const { map, builder } = flat(c.mapSeed, 32, 32, 16);
        const only = builder.placeStation(14, 17, 'farm')!;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        for (let i = 0; i < c.settle; i++) people.tick(DT, c.population, MIDDAY);
        setClosed(only, true);
        expect(people.places()).toEqual([]);
        const before = structuredClone(people.persons);
        const stream = people.toJSON().rng;
        for (let i = 0; i < 50; i++) people.tick(DT, c.population, MIDDAY);
        expect(people.persons).toEqual(before);
        expect(people.toJSON().rng).toBe(stream);
      },
    );
  });
});
