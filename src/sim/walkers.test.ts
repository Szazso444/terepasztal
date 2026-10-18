import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { content } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { startWork } from './upgrade';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import {
  BOARDING_SPEED_MUL,
  PROFESSIONS,
  PeopleSim,
  SLEEP,
  STATION_REACH,
  WAKE,
  WALK_SPEED,
  doorstep,
  findWalk,
  stationProfession,
  walkSpeed,
  type Person,
  type PersonState,
  type Profession,
} from './people';
import { forAll, shrinkInt, SEEDS } from '../testing/property';
import { streetDoor } from './doors';
import { buildingDef } from './buildings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const DT = 1;
const MIDDAY = 0.5;
const NIGHT = 0.05;

/** Tiles along a walk, diagonals counting root two. */
const lengthOf = (path: { x: number; y: number }[]) =>
  path.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - path[i].x, q.y - path[i].y), 0);

const MOVES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
/** `moves` unit steps, straight or diagonal, from open ground south of the line; seeded. */
function wander(seed: number, moves: number) {
  const rng = new Rng(seed);
  const path = [{ x: 30, y: 38 }];
  for (let i = 0; i < moves; i++) {
    const [dx, dy] = rng.pick(MOVES);
    const at = path[i];
    // turn about at the edge of the open ground rather than leave it
    path.push({
      x: at.x + dx < 3 || at.x + dx > 60 ? at.x - dx : at.x + dx,
      y: at.y + dy < 27 || at.y + dy > 45 ? at.y - dy : at.y + dy,
    });
  }
  return path;
}

/** Smaller cases for forAll: each named count cut toward its floor, first the floor itself. */
function* shrinkCounts<T>(c: T, floors: { [K in keyof T]?: number }): Iterable<T> {
  for (const k of Object.keys(floors) as (keyof T)[])
    for (const v of shrinkInt(c[k] as number, floors[k] as number)) yield { ...c, [k]: v };
}

const GATHERERS: readonly Profession[] = ['lumberjack', 'stone_mason', 'farmer', 'pump_hand'];
/** The states a walker is walking in; a boarding or alighting figure's own is 'walk'. */
const WALKING: readonly PersonState[] = ['gather', 'toStation', 'return'];
const GROUNDS: readonly Terrain[] = [
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Hill,
  Terrain.Water,
  Terrain.Rock,
  Terrain.Sand,
  Terrain.Mountain,
];

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

/** A grass map with straight track along `row` and a builder that builds free. */
function flat(seed: number, w: number, h: number, row: number) {
  const map = emptyMap(seed, w, h, Terrain.Grass);
  const track = new TrackGraph(w, h);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  for (let x = 2; x < w - 2; x++) track.place(x, row, 'straight', 1);
  return { map, builder };
}

const W = 64;
/**
 * A little of everything to live at: the four gatherers' yards, a passenger station, a works, a
 * house and a water tower, each its own place.
 */
function town(seed = 7) {
  const { map, builder } = flat(seed, W, 48, 20);
  // a pump stands only with water right beside it
  map.terrain[22 * W + 26] = Terrain.Water;
  const at = (x: number, id: string) => {
    const s = builder.placeStation(x, 21, id);
    expect(s, id).not.toBeNull();
    return s!;
  };
  const sites = {
    farm: at(8, 'farm'),
    lumber: at(14, 'lumber'),
    quarry: at(20, 'quarry'),
    pump: at(26, 'pump'),
    station: at(32, 'station'),
  };
  const mill = builder.placeBuilding(38, 24, 'windmill');
  expect(mill).not.toBeNull();
  const house = builder.spawnDecor(44, 24, 'townhouse', 0);
  expect(house).not.toBeNull();
  const tower = builder.spawnDecor(50, 24, 'water_tower', 0);
  expect(tower).not.toBeNull();
  const keys = {
    farm: `s${sites.farm.id}`,
    lumber: `s${sites.lumber.id}`,
    quarry: `s${sites.quarry.id}`,
    pump: `s${sites.pump.id}`,
    station: `s${sites.station.id}`,
    mill: `b${mill!.x},${mill!.y}`,
    house: `d${house!.x},${house!.y}`,
    tower: `d${tower!.x},${tower!.y}`,
  };
  return { map, builder, sites, keys };
}

/** The profession each place of the town gives, as the issue lays it down. */
const TOWN_PROFESSIONS = {
  farm: 'farmer',
  lumber: 'lumberjack',
  quarry: 'stone_mason',
  pump: 'pump_hand',
  station: 'passenger',
  mill: 'railway_worker',
  house: 'passenger',
  tower: 'railway_worker',
} as const satisfies Record<string, Profession>;

// ------------------------------------------------------------------ speed

/** Half the top speed of the slowest engine there is, retired ones included. */
const halfSlowestEngine = () => Math.min(...content.locomotives.map((l) => l.speed)) / 2;

describe('walking speed', () => {
  it('is 0.2 tiles a second, and boarding figures hurry by half as much again', () => {
    expect(WALK_SPEED).toBe(0.2);
    expect(BOARDING_SPEED_MUL).toBe(1.5);
    expect(walkSpeed({ transient: false })).toBe(WALK_SPEED);
    expect(walkSpeed({ transient: true })).toBe(WALK_SPEED * BOARDING_SPEED_MUL);
  });

  it('never outpaces a train: the fastest walker, on a road, is slower than the slowest engine', () => {
    // Roads (#318) give every walker twice its pace along them, a boarding figure no more than
    // any other, so the bound of #297 (at most half the slowest engine) holds off a road only. On
    // one the fastest walker is still slower than any engine. walkSpeed() with the road is the
    // whole of a walker's pace. It is read at the tuning the game ships with (beforeEach restores
    // it): the Game tuning slider 'Train speed x' runs down to 0.2 and would take every engine
    // below a walker, which the player chose.
    const pace = (transient: boolean, onRoad: boolean) => walkSpeed({ transient }, onRoad);
    const fastest = Math.max(pace(false, true), pace(true, true));
    expect(content.locomotives.length).toBeGreaterThan(0);
    expect(fastest).toBeLessThan(2 * halfSlowestEngine());
    // off a road: at most half, read as 'at most' because 0.2 x 1.5 is exactly half of the slowest
    // engine's 0.6
    expect(Math.max(pace(false, false), pace(true, false))).toBeLessThanOrEqual(
      halfSlowestEngine() + 1e-9,
    );
    // the plain walker is a good way under it
    expect(WALK_SPEED).toBeLessThan(halfSlowestEngine());
  });

  it('is what a walker covers in a tick, in every profession, state and ground', () => {
    forAll(
      (rng) => ({
        ground: rng.pick(GROUNDS),
        state: rng.pick(WALKING),
        carrying: rng.chance(0.5),
        gdt: rng.pick([0.05, 0.25, 0.5, 1, 2.5, 5]),
        stream: rng.int(0, 0xffffffff),
      }),
      (c) => {
        const { map, builder, keys } = town();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const homes = Object.values(keys);
        people.tick(DT, 4 * homes.length, MIDDAY);
        people.persons.forEach((p, i) => (p.home = homes[i % homes.length]));
        // one more tick gives each walker its home's profession
        people.tick(DT, 4 * homes.length, MIDDAY);
        const professions = new Set(people.persons.map((p) => p.profession));
        expect([...professions].sort()).toEqual([...PROFESSIONS].sort());

        // a long straight walk over the ground, one tile to the west of nothing
        const y = 40;
        for (let x = 6; x <= 40; x++) map.terrain[y * W + x] = c.ground;
        const path = [
          { x: 6, y },
          { x: 40, y },
        ];
        const walkers = [...people.persons];
        const population = walkers.length;
        for (const p of walkers)
          Object.assign(p, {
            state: c.state,
            carrying: c.carrying,
            stationId: builder.stations.at(-1)!.id,
            path,
            step: 0,
            x: 6,
            y,
            timer: 0,
          });
        // boarding figures: no home, a path of their own
        const boarders: Person[] = walkers.map((p, i) => ({
          ...p,
          id: 1000 + i,
          home: '',
          transient: true,
          state: 'walk',
          profession: 'passenger',
          path,
          step: 0,
          x: 6,
          y,
        }));
        people.persons.push(...boarders);

        people.tick(c.gdt, population, MIDDAY);
        for (const p of walkers) {
          expect(p.state, `${p.profession} on ${c.ground}`).toBe(c.state);
          expect(Math.hypot(p.x - 6, p.y - y)).toBeCloseTo(WALK_SPEED * c.gdt, 9);
        }
        for (const p of boarders)
          expect(Math.hypot(p.x - 6, p.y - y)).toBeCloseTo(
            WALK_SPEED * BOARDING_SPEED_MUL * c.gdt,
            9,
          );
      },
    );
  });

  it('takes the same distance in many small steps as in one big one', () => {
    forAll(
      (rng) => ({ steps: rng.int(1, 200), gdt: rng.pick([0.05, 0.1, 0.5]) }),
      ({ steps, gdt }) => {
        const { map, builder, keys } = town();
        const people = new PeopleSim(map, builder, new Rng(5));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        const path = [
          { x: 6, y: 40 },
          { x: 60, y: 40 },
        ];
        Object.assign(p, { home: keys.mill, state: 'return', path, step: 0, x: 6, y: 40 });
        for (let i = 0; i < steps; i++) people.tick(gdt, 1, MIDDAY);
        expect(p.x - 6).toBeCloseTo(WALK_SPEED * gdt * steps, 6);
      },
      { shrink: (c) => shrinkCounts(c, { steps: 1 }) },
    );
  });

  // walks whole paths tick by tick, 0.7 s alone; the margin keeps a loaded CI runner green
  it(
    'gets along a path in its length over the pace, a tick a corner more at most, never faster',
    { timeout: 30_000 },
    () => {
      forAll(
        (rng) => ({
          shape: rng.int(0, 0xffffffff),
          moves: rng.int(1, 40),
          gdt: rng.pick([0.05, 0.1, 0.5, 1, 2.5]),
          boarding: rng.chance(0.5),
          state: rng.pick(WALKING),
          carrying: rng.chance(0.5),
          home: rng.int(0, 7),
          stream: rng.int(0, 0xffffffff),
        }),
        (c) => {
          const { map, builder, keys } = town();
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          const path = wander(c.shape, c.moves);
          let p: Person;
          if (c.boarding) {
            // a figure the sim itself sends from the platform to the station door
            people.alight(builder.stations.at(-1)!, 1);
            p = people.persons[0];
            expect(p.transient).toBe(true);
          } else {
            people.tick(DT, 1, MIDDAY);
            p = people.persons[0];
            p.home = Object.values(keys)[c.home];
            p.state = c.state;
          }
          const door = builder.stations.at(-1)!;
          Object.assign(p, {
            carrying: c.carrying,
            stationId: door.id,
            path,
            step: 0,
            x: path[0].x,
            y: path[0].y,
            timer: 0,
          });
          const pace = walkSpeed(p);
          // a walker is done on the tick after it reaches the end, when it takes up the next state,
          // or is gone if it was boarding
          const done = () => (c.boarding ? !people.persons.includes(p) : p.state !== c.state);
          let ticks = 0;
          const stream = people.toJSON().rng;
          while (!done() && ticks < 100_000) {
            const was = { x: p.x, y: p.y };
            people.tick(c.gdt, c.boarding ? 0 : 1, MIDDAY);
            ticks++;
            if (done()) break;
            expect(Math.hypot(p.x - was.x, p.y - was.y), `tick ${ticks}`).toBeLessThanOrEqual(
              pace * c.gdt + 1e-9,
            );
            // a step is the walker's state and the time: it takes no draw (a crossing can hook in)
            expect(people.toJSON().rng, `tick ${ticks}`).toBe(stream);
          }
          expect(done(), 'it got to the end of the path').toBe(true);
          const walking = (ticks - 1) * c.gdt;
          expect(walking).toBeGreaterThanOrEqual(lengthOf(path) / pace - 1e-9);
          expect(walking).toBeLessThanOrEqual(lengthOf(path) / pace + c.moves * c.gdt + 1e-9);
        },
        { shrink: (c) => shrinkCounts(c, { moves: 1 }) },
      );
    },
  );
});

// ------------------------------------------------------------------ professions

describe('professions', () => {
  it('are the six of the design, each an id the art can key a figure by', () => {
    expect([...PROFESSIONS]).toEqual([
      'passenger',
      'lumberjack',
      'stone_mason',
      'farmer',
      'pump_hand',
      'railway_worker',
    ]);
    expect(new Set(PROFESSIONS).size).toBe(PROFESSIONS.length);
    for (const id of PROFESSIONS) expect(id).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('follow from the kind of place a walker lives at', () => {
    const { map, builder, keys } = town();
    const people = new PeopleSim(map, builder);
    const places = people.places();
    expect(places.map((pl) => pl.key).sort()).toEqual(Object.values(keys).sort());
    for (const [name, key] of Object.entries(keys)) {
      const want = TOWN_PROFESSIONS[name as keyof typeof TOWN_PROFESSIONS];
      expect(places.find((pl) => pl.key === key)!.profession, name).toBe(want);
    }
    // the four gatherers are the places that send a walker out to gather
    expect(
      places
        .filter((pl) => pl.gathers !== null)
        .map((pl) => pl.profession)
        .sort(),
    ).toEqual([...GATHERERS].sort());
  });

  it('give every kind of station a profession: gatherers, passengers, and railway workers for the rest', () => {
    const want: Record<string, Profession> = {
      farm: 'farmer',
      lumber: 'lumberjack',
      quarry: 'stone_mason',
      pump: 'pump_hand',
      station: 'passenger',
    };
    const defs = content.stations.defs;
    expect(defs.map((d) => d.id)).toEqual(expect.arrayContaining(Object.keys(want)));
    for (const def of defs)
      expect(stationProfession(def), def.id).toBe(want[def.id] ?? 'railway_worker');
    // the civic town station is no house and takes no passengers: its walkers are railway workers
    const civic = defs.find((d) => d.id === 'town')!;
    expect(civic.accepts).not.toContain('passengers');
    expect(stationProfession(civic)).toBe('railway_worker');
  });

  it('are the issue’s for every station, works and decor in the content that is a home', () => {
    // each kind on a tile of its own, put on the builder's lists as the world would: placement
    // rules are not what is under test, and some kinds need a deposit, a hillside or a water edge
    const { map, builder } = flat(1, W, 48, 20);
    const want = new Map<string, Profession>();
    let n = 0;
    const spot = () => {
      const i = n++;
      return { x: 2 + (i % 58), y: 26 + 4 * Math.floor(i / 58) };
    };
    const byKind: Record<string, Profession> = {
      farm: 'farmer',
      lumber: 'lumberjack',
      quarry: 'stone_mason',
      pump: 'pump_hand',
    };
    for (const def of content.stations.defs) {
      const { x, y } = spot();
      const s = new Station(def.id, x, y);
      builder.stations.push(s);
      want.set(
        `s${s.id}`,
        byKind[def.id] ?? (def.accepts.includes('passengers') ? 'passenger' : 'railway_worker'),
      );
    }
    for (const def of content.buildings) {
      const { x, y } = spot();
      builder.buildings.set(y * W + x, {
        id: def.id,
        x,
        y,
        acc: 0,
        rot: 0,
        active: false,
        rate: 0,
      });
      if (def.crew > 0) want.set(`b${x},${y}`, 'railway_worker');
    }
    for (const def of content.decor) {
      const { x, y } = spot();
      builder.decor.set(y * W + x, { id: def.id, x, y, rot: 0 });
      if (def.residents) want.set(`d${x},${y}`, 'passenger');
      else if (def.crew > 0) want.set(`d${x},${y}`, 'railway_worker');
    }
    const places = new PeopleSim(map, builder).places();
    expect(places.map((pl) => pl.key).sort()).toEqual([...want.keys()].sort());
    for (const pl of places) expect(pl.profession, pl.key).toBe(want.get(pl.key));
    // and each of the six is the profession of some place there is
    expect(new Set(places.map((pl) => pl.profession))).toEqual(new Set(PROFESSIONS));
  });

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('are the profession of the home of every walker, at every tick', { timeout: 90_000 }, () => {
    let rehomed = 0;
    forAll(
      (rng) => ({
        stream: rng.int(0, 0xffffffff),
        closings: rng.int(0, 0xffffffff),
        population: rng.int(1, 60),
        gdt: rng.pick([0.25, 1, 2.5]),
        day0: rng.next(),
        ticks: rng.int(50, 300),
      }),
      (c) => {
        const { map, builder } = town();
        const mill = builder.buildingAt(38, 24)!;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const shutter = new Rng(c.closings);
        // everything but the house may be closed for an upgrade now and then, and opens again
        const closable = [...builder.stations, mill];
        for (let t = 0; t < c.ticks; t++) {
          if (shutter.chance(0.04)) {
            const x = shutter.pick(closable);
            if (x instanceof Station) x.work = x.work ? null : startWork(x.level + 1);
            else if (x.work) delete x.work;
            else x.work = startWork(2)!;
          }
          if (t % 40 === 0) people.alight(builder.stations.at(-1)!, 2);
          const before = new Map(people.persons.map((p) => [p, p.home]));
          people.tick(c.gdt, c.population, (c.day0 + (t * c.gdt) / daySeconds()) % 1);
          const profession = new Map(people.places().map((pl) => [pl.key, pl.profession]));
          for (const p of people.persons) {
            if (p.transient) {
              expect(p.profession, `boarding walker ${p.id}`).toBe('passenger');
              continue;
            }
            expect(profession.has(p.home), `walker ${p.id} lives at ${p.home}, which is shut`).toBe(
              true,
            );
            expect(p.profession, `walker ${p.id} at ${p.home}`).toBe(profession.get(p.home));
            if (before.has(p) && before.get(p) !== p.home) rehomed++;
          }
        }
      },
      { shrink: (c) => shrinkCounts(c, { ticks: 1, population: 1 }) },
    );
    // the plays are worth checking: walkers were moved from a home that shut to another
    expect(rehomed).toBeGreaterThan(0);
  });

  it('go with a walker whose home closes to the home it is given, drawing nothing', () => {
    const { map, builder, sites, keys } = town();
    const people = new PeopleSim(map, builder, new Rng(11));
    people.tick(DT, 30, MIDDAY);
    const farmers = people.persons.filter((p) => p.home === keys.farm);
    expect(farmers.length).toBeGreaterThan(0);
    for (const p of farmers) expect(p.profession).toBe('farmer');

    // the farm halt is closed for its upgrade: its walkers go to the nearest open place
    sites.farm.work = startWork(sites.farm.level + 1);
    expect(people.places().map((pl) => pl.key)).not.toContain(keys.farm);
    const stream = people.toJSON().rng;
    const near = people
      .places()
      .map((pl) => ({ pl, d: Math.abs(pl.x - 8) + Math.abs(pl.y - 21) }))
      .sort((a, b) => a.d - b.d)[0].pl;
    people.tick(DT, 30, MIDDAY);
    expect(people.toJSON().rng).toBe(stream);
    for (const p of farmers) {
      expect(p.home).toBe(near.key);
      expect(p.profession).toBe(near.profession);
    }
  });

  it('take nothing from the random stream to work out, and none to read', () => {
    const { map, builder } = town();
    const people = new PeopleSim(map, builder, new Rng(3));
    const stream = people.toJSON().rng;
    people.places();
    expect(people.toJSON().rng).toBe(stream);
  });
});

/** Everything about every walker, to tell two plays apart; ids left out as a load numbers anew. */
function trace(people: PeopleSim) {
  return people.persons
    .map((p) =>
      [p.profession, p.carrying, p.state, p.x, p.y, p.timer, p.home, p.outfit, p.stationId].join(
        ' ',
      ),
    )
    .join(';');
}

describe('professions and carrying, from the same seed', () => {
  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('play out the same, walker for walker, with no Math.random', { timeout: 90_000 }, () => {
    let someoneCarried = 0;
    const endings = new Set<string>();
    forAll(
      (rng) => ({
        stream: rng.int(0, 0xffffffff),
        population: rng.int(1, 60),
        gdt: rng.pick([0.25, 1, 2.5]),
        day0: rng.next(),
        ticks: rng.int(100, 400),
      }),
      (c) => {
        const play = () => {
          resetStationIds(1);
          const { map, builder } = town();
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          const out: string[] = [];
          for (let t = 0; t < c.ticks; t++) {
            people.tick(c.gdt, c.population, (c.day0 + (t * c.gdt) / daySeconds()) % 1);
            out.push(trace(people));
          }
          return out;
        };
        const a = play();
        expect(play()).toEqual(a);
        if (a.some((row) => row.includes(' true '))) someoneCarried++;
        endings.add(a.at(-1)!);
      },
      { shrink: (c) => shrinkCounts(c, { ticks: 1, population: 1 }) },
    );
    // the plays are worth comparing: in many of them someone came back from gathering, and the
    // seeds give plays of their own rather than one play over and over
    expect(someoneCarried).toBeGreaterThan(0);
    expect(endings.size).toBeGreaterThan(SEEDS.length / 2);
    expect(Math.random).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ the people stream and the save

describe('the walkers and the save', () => {
  it('draw nothing for a profession: a new walker costs its home, outfit and first timer', () => {
    forAll(
      (rng) => ({ stream: rng.int(0, 0xffffffff), population: rng.int(1, 120) }),
      (c) => {
        const { map, builder } = town();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        // at night nobody steps out, so the spawn is all that draws from the stream
        people.tick(DT, c.population, NIGHT);
        expect(people.persons).toHaveLength(c.population);
        const twin = new Rng(c.stream);
        for (let i = 0; i < 3 * c.population; i++) twin.next();
        expect(people.toJSON().rng).toBe(twin.state);
      },
      { shrink: (c) => shrinkCounts(c, { population: 1 }) },
    );
  });

  it('save their stream and no more, and start over with professions on a load', () => {
    const { map, builder } = town();
    const people = new PeopleSim(map, builder, new Rng(9));
    for (let t = 0; t < 600; t++) people.tick(DT, 40, (t / daySeconds()) % 1);
    // the play was worth saving: walkers of several professions, some of them out
    expect(new Set(people.persons.map((p) => p.profession)).size).toBeGreaterThan(1);
    expect(people.outside).toBeGreaterThan(0);

    const save = people.toJSON();
    expect(Object.keys(save)).toEqual(['rng']);
    expect(JSON.stringify(save)).not.toMatch(/profession|carrying/);

    resetStationIds(1);
    const world = town();
    const fresh = new PeopleSim(world.map, world.builder, new Rng(1));
    fresh.load(JSON.parse(JSON.stringify(save)));
    expect(fresh.persons).toEqual([]);
    fresh.tick(DT, 60, MIDDAY);
    expect(fresh.persons).toHaveLength(60);
    const professions = new Map(fresh.places().map((pl) => [pl.key, pl.profession]));
    for (const p of fresh.persons)
      expect(p.profession, `walker ${p.id}`).toBe(professions.get(p.home));
    expect(new Set(fresh.persons.map((p) => p.profession)).size).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------ carrying

describe('carrying', () => {
  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('is set on the way home from a gather tile, and at no other time', { timeout: 90_000 }, () => {
    let returned = 0;
    forAll(
      (rng) => ({
        stream: rng.int(0, 0xffffffff),
        population: rng.int(10, 80),
        ticks: rng.int(200, 600),
      }),
      (c) => {
        const { map, builder } = town();
        // forest, hill, water and grass for the gatherers to walk to
        for (let y = 24; y < 30; y++)
          for (let x = 6; x < 30; x++)
            map.terrain[y * W + x] = [Terrain.Grass, Terrain.Forest, Terrain.Hill, Terrain.Grass][
              Math.floor((x - 6) / 6)
            ];
        map.terrain[30 * W + 26] = Terrain.Water;
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        const before = new Map<Person, PersonState>();
        for (let t = 0; t < c.ticks; t++) {
          people.tick(DT, c.population, MIDDAY);
          for (const p of people.persons) {
            const was = before.get(p);
            if (was === 'gather' && p.state === 'return') {
              expect(p.carrying, `walker ${p.id} turned back from its gather tile`).toBe(true);
              returned++;
            }
            if (p.carrying) {
              expect(p.state, `walker ${p.id} carries`).toBe('return');
              expect(GATHERERS, `walker ${p.id} carries as a ${p.profession}`).toContain(
                p.profession,
              );
            }
            if (was === 'return' && p.state === 'inside')
              expect(p.carrying, `walker ${p.id} got home`).toBe(false);
            if (was === 'waiting' && p.state === 'return')
              expect(p.carrying, `walker ${p.id} left the platform`).toBe(false);
            before.set(p, p.state);
          }
        }
      },
      { shrink: (c) => shrinkCounts(c, { ticks: 1, population: 1 }) },
    );
    expect(returned).toBeGreaterThan(0);
  });
});

describe('a gatherer with no way home', () => {
  it('carries nothing: carrying is for the way home, and there is none', () => {
    forAll(
      (rng) => ({ stream: rng.int(0, 0xffffffff) }),
      (c) => {
        const { map, builder, sites, keys } = town();
        // a pocket of two tiles in a ring of water: the gather tile and the one before it
        for (let y = 36; y <= 39; y++)
          for (let x = 29; x <= 31; x++) map.terrain[y * W + x] = Terrain.Water;
        for (const y of [37, 38]) map.terrain[y * W + 30] = Terrain.Grass;
        const path = [
          { x: 30, y: 37 },
          { x: 30, y: 38 },
        ];
        expect(findWalk(map, path[1], sites.farm)).toBeNull();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        Object.assign(p, { home: keys.farm, state: 'gather', path, step: 0, x: 30, y: 37 });
        // from the walk to the tile, through the stand there, to going in: no haul on the way
        let idled = false;
        for (let t = 0; t < 200 && p.state !== 'inside'; t++) {
          people.tick(DT, 1, MIDDAY);
          expect(p.carrying, `tick ${t}, ${p.state}`).toBe(false);
          expect(p.state, `tick ${t}`).not.toBe('return');
          if (p.state === 'idle') idled = true;
        }
        expect(idled, 'it got to the gather tile').toBe(true);
        expect(p.state).toBe('inside');
      },
    );
  });
});

// ------------------------------------------------------------------ station trips

/**
 * A windmill `dx` and `dy` tiles from a passenger station on a long line; the only places. Walks
 * out of each and back to it start and end outside its street door (`doorstep`): the station's
 * and the mill's.
 */
function trip(seed: number, dx: number, dy: number) {
  const { map, builder } = flat(seed, 64, 48, 20);
  const station = builder.placeStation(32, 21, 'station')!;
  const mill = builder.placeBuilding(32 + dx, 21 + dy, 'windmill')!;
  expect([station, mill].every(Boolean)).toBe(true);
  const crossing = (x: number, y: number) => builder.roads.isCrossing(x, y);
  return {
    map,
    builder,
    station,
    mill,
    home: `b${mill.x},${mill.y}`,
    stationStep: doorstep(
      map,
      streetDoor(station.def, station.x, station.y, station.rot),
      crossing,
    ),
    millStep: doorstep(
      map,
      streetDoor(buildingDef(mill.id), mill.x, mill.y, mill.rot ?? 0),
      crossing,
    ),
  };
}

const daytime = (day: number) => day > WAKE && day < SLEEP;

describe('a walker bound for a station', () => {
  // a traveller waits at a platform 60 to 150 s for a train (people.ts) before it walks home
  const LONGEST_WAIT = 150;
  /**
   * The longest a walker of this layout may be out: the way to the station, the longest wait, the
   * way back, and a tick for every corner of either way (a tick that ends a leg wastes the rest of
   * its step). An idle by the door, 20 s at most, is a good way under it.
   */
  function stranded(
    map: GameMap,
    from: { x: number; y: number },
    to: { x: number; y: number },
    gdt: number,
  ) {
    const out = findWalk(map, from, to)!;
    const back = findWalk(map, to, from)!;
    expect(out, 'a way to the station').not.toBeNull();
    expect(back, 'a way back').not.toBeNull();
    return (
      (lengthOf(out) + lengthOf(back)) / WALK_SPEED +
      (out.length + back.length + 2) * gdt +
      LONGEST_WAIT
    );
  }

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it(
    'gets there, or turns home when night falls; it is never stranded',
    { timeout: 90_000 },
    () => {
      let arrived = 0;
      let turned = 0;
      forAll(
        (rng) => ({
          mapSeed: rng.int(0, 0x7fffffff),
          stream: rng.int(0, 0xffffffff),
          // |dx| + |dy| runs from 2 to STATION_REACH, the furthest a traveller sets off from
          dx: rng.int(-8, 8),
          dy: rng.int(2, 6),
          gdt: rng.pick([0.5, 1, 2.5]),
          day0: rng.next(),
          // the Game tuning slider runs from 30 s to 1200 s; a short day leaves little to walk in
          daySeconds: rng.pick([30, 90, 240, 600]),
        }),
        (c) => {
          expect(Math.abs(c.dx) + c.dy).toBeLessThanOrEqual(STATION_REACH);
          rules.daySeconds = c.daySeconds;
          const { map, builder, station, stationStep, millStep } = trip(c.mapSeed, c.dx, c.dy);
          const people = new PeopleSim(map, builder, new Rng(c.stream));
          const longest = stranded(map, millStep, stationStep, c.gdt);
          const days = 3;
          const ticks = Math.ceil((days * daySeconds()) / c.gdt);
          // when each walker who is outside stepped out
          const since = new Map<Person, number>();
          const before = new Map<Person, PersonState>();
          for (let t = 0; t < ticks; t++) {
            const now = t * c.gdt;
            const day = (c.day0 + now / daySeconds()) % 1;
            people.tick(c.gdt, 20, day);
            for (const p of people.persons) {
              const was = before.get(p);
              if (was === 'inside' && p.state !== 'inside')
                expect(daytime(day), `walker ${p.id} stepped out at night`).toBe(true);
              if (p.state === 'toStation' && was !== 'toStation') {
                // it set off for the station
                expect(daytime(day), `walker ${p.id} set off at night`).toBe(true);
                expect(p.stationId).toBe(station.id);
              }
              if (was === 'toStation' && p.state !== 'toStation') {
                if (p.state === 'waiting') {
                  // got there, outside its street door
                  expect([p.x, p.y]).toEqual([stationStep.x, stationStep.y]);
                  arrived++;
                } else {
                  // turned home, which only night does
                  expect(p.state, `walker ${p.id} left its way to the station`).toBe('return');
                  expect(daytime(day), `walker ${p.id} turned back by day`).toBe(false);
                  expect(p.path.at(-1)).toEqual(millStep);
                  turned++;
                }
              }
              if (p.state === 'inside') since.delete(p);
              else if (!since.has(p)) since.set(p, now);
              before.set(p, p.state);
            }
            // nobody is out for longer than the longest trip there is
            for (const [p, from] of since)
              if (now - from > longest)
                throw new Error(
                  `t=${now}: walker ${p.id} out since ${from} (longest trip ${longest}), now ${p.state} at ${p.x},${p.y}`,
                );
          }
        },
        { shrink: (c) => shrinkCounts(c, { dx: 0, dy: 2, daySeconds: 240 }) },
      );
      // the property is worth checking: walkers do get there, and others are caught by night
      expect(arrived).toBeGreaterThan(0);
      expect(turned).toBeGreaterThan(0);
    },
  );

  it('turns for home where it stands the moment night falls, without a step or a draw', () => {
    forAll(
      (rng) => ({
        mapSeed: rng.int(0, 0x7fffffff),
        stream: rng.int(0, 0xffffffff),
        dx: rng.int(-6, 6),
        dy: rng.int(3, 8),
        along: rng.next(),
        // how far between one tile of the way and the next
        between: rng.next(),
        night: rng.pick([0.1, 0.5 * (1 + SLEEP), 0.9, 0.99]),
      }),
      (c) => {
        const { map, builder, station, home, stationStep, millStep } = trip(c.mapSeed, c.dx, c.dy);
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        // make it a mill walker part of the way to the station, between two tiles
        const path = findWalk(map, millStep, stationStep)!;
        expect(path.length).toBeGreaterThanOrEqual(3);
        const step = 1 + Math.floor(c.along * (path.length - 2));
        const [a, b] = [path[step], path[step + 1]];
        Object.assign(p, {
          home,
          state: 'toStation',
          stationId: station.id,
          path,
          step,
          x: a.x + c.between * (b.x - a.x),
          y: a.y + c.between * (b.y - a.y),
          timer: 0,
        });
        const at = { x: p.x, y: p.y };
        const stream = people.toJSON().rng;
        people.tick(DT, 1, c.night);
        expect(daytime(c.night)).toBe(false);
        expect(p.state).toBe('return');
        expect({ x: p.x, y: p.y }).toEqual(at);
        // the way home starts at the tile it stands on and ends at its door
        expect(p.path[0]).toEqual({ x: Math.round(at.x), y: Math.round(at.y) });
        expect(p.path.at(-1)).toEqual(millStep);
        expect(p.carrying).toBe(false);
        expect(people.toJSON().rng).toBe(stream);
        // the way back is no longer than the way out, and is walked at the pace
        const back = p.path;
        expect(back.length).toBeLessThanOrEqual(path.length);
        let t = 0;
        while (p.state !== 'inside' && t < 1000) {
          people.tick(DT, 1, c.night);
          t++;
        }
        expect(p.state).toBe('inside');
        expect(t).toBeGreaterThanOrEqual((lengthOf(back) - 1) / WALK_SPEED);
        expect(t).toBeLessThanOrEqual((lengthOf(back) + 1) / WALK_SPEED + back.length + 1);
      },
      { shrink: (c) => shrinkCounts(c, { dx: 0, dy: 3 }) },
    );
  });

  it('waits out its timer on the platform by day, and walks home the moment night falls', () => {
    forAll(
      (rng) => ({
        mapSeed: rng.int(0, 0x7fffffff),
        stream: rng.int(0, 0xffffffff),
        dx: rng.int(-6, 6),
        dy: rng.int(3, 8),
        // whole seconds left to wait, so the timer counts down exactly
        left: rng.int(2, 150),
        night: rng.pick([0.1, 0.5 * (1 + SLEEP), 0.9, 0.99]),
      }),
      (c) => {
        const waiter = () => {
          const f = trip(c.mapSeed, c.dx, c.dy);
          const people = new PeopleSim(f.map, f.builder, new Rng(c.stream));
          people.tick(DT, 1, MIDDAY);
          const [p] = people.persons;
          Object.assign(p, {
            home: f.home,
            state: 'waiting',
            stationId: f.station.id,
            path: [],
            step: 0,
            x: f.stationStep.x,
            y: f.stationStep.y,
            timer: c.left,
          });
          return { ...f, people, p };
        };

        // by day it keeps waiting for a train until the timer is out, and then walks home
        const day = waiter();
        for (let t = 1; t < c.left; t++) {
          day.people.tick(DT, 1, MIDDAY);
          expect(day.p.state, `tick ${t} of ${c.left}`).toBe('waiting');
          expect(day.people.waitingAt(day.station.id)).toEqual([day.p]);
        }
        day.people.tick(DT, 1, MIDDAY);
        expect(day.p.state, `tick ${c.left}`).toBe('return');

        // at night it does not wait on: it turns for home at once, and draws nothing to do it
        const dusk = waiter();
        const stream = dusk.people.toJSON().rng;
        dusk.people.tick(DT, 1, c.night);
        expect(daytime(c.night)).toBe(false);
        expect(dusk.p.state).toBe('return');
        expect(dusk.people.toJSON().rng).toBe(stream);
        for (const w of [day, dusk]) {
          const { p, stationStep, millStep } = w;
          // out of the station's street door, and in by the mill's
          expect(p.path[0]).toEqual(stationStep);
          expect(p.path.at(-1)).toEqual(millStep);
          expect(p.carrying).toBe(false);
        }
        // and gets there at the pace
        const way = dusk.p.path;
        let t = 0;
        while (dusk.p.state !== 'inside' && t < 2000) {
          dusk.people.tick(DT, 1, c.night);
          t++;
        }
        expect(dusk.p.state).toBe('inside');
        expect(t).toBeGreaterThanOrEqual((lengthOf(way) - 1) / WALK_SPEED);
        expect(t).toBeLessThanOrEqual((lengthOf(way) + 1) / WALK_SPEED + way.length + 1);
      },
      { shrink: (c) => shrinkCounts(c, { dx: 0, dy: 3, left: 2 }) },
    );
  });

  it('goes on to the station by day, and waits there until a train comes or night falls', () => {
    const { map, builder, station, home } = trip(5, 6, 5);
    const people = new PeopleSim(map, builder, new Rng(2));
    people.tick(DT, 1, MIDDAY);
    const [p] = people.persons;
    Object.assign(p, {
      home,
      state: 'toStation',
      stationId: station.id,
      path: findWalk(map, builder.buildingAt(38, 26)!, station)!,
      step: 0,
      x: 38,
      y: 26,
    });
    for (let i = 0; i < 400 && p.state === 'toStation'; i++) people.tick(DT, 1, MIDDAY);
    expect(p.state).toBe('waiting');
    expect(people.waitingAt(station.id)).toEqual([p]);
  });
});
