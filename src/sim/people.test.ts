import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds, type Station } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { PeopleSim, type PeopleJSON } from './people';
import { forAll, shrinkArray, shrinkInt, SEEDS } from '../testing/property';

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
