import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { content } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
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
  findWalk,
  stationProfession,
  walkSpeed,
  type Person,
  type PersonState,
  type Profession,
} from './people';
import { forAll } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const DT = 1;
const MIDDAY = 0.5;
const GATHERERS: readonly Profession[] = ['lumberjack', 'stone_mason', 'farmer', 'pump_hand'];
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

  it("never outpaces a train: the fastest walker is at most half the slowest engine's top speed", () => {
    // read as 'at most' because 0.2 x 1.5 is exactly half of the slowest engine's 0.6
    const fastest = Math.max(walkSpeed({ transient: false }), walkSpeed({ transient: true }));
    expect(content.locomotives.length).toBeGreaterThan(0);
    expect(fastest).toBeLessThanOrEqual(halfSlowestEngine() + 1e-9);
    // the plain walker is a good way under it
    expect(WALK_SPEED).toBeLessThan(halfSlowestEngine());
  });

  it('is what a walker covers in a tick, in every profession and on every ground', () => {
    forAll(
      (rng) => ({
        ground: rng.pick(GROUNDS),
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
          Object.assign(p, { state: 'return', path, step: 0, x: 6, y, timer: 0 });
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
          expect(p.state, `${p.profession} on ${c.ground}`).toBe('return');
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
    );
  });
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
  });

  // seeded layouts run for a second or two; the margin keeps a loaded CI runner green
  it('are the profession of the home of every walker, at every tick', { timeout: 90_000 }, () => {
    forAll(
      (rng) => ({
        stream: rng.int(0, 0xffffffff),
        population: rng.int(1, 60),
        gdt: rng.pick([0.25, 1, 2.5]),
        day0: rng.next(),
        ticks: rng.int(50, 300),
      }),
      (c) => {
        const { map, builder } = town();
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        for (let t = 0; t < c.ticks; t++) {
          if (t % 40 === 0) people.alight(builder.stations.at(-1)!, 2);
          people.tick(c.gdt, c.population, (c.day0 + (t * c.gdt) / daySeconds()) % 1);
          const profession = new Map(people.places().map((pl) => [pl.key, pl.profession]));
          for (const p of people.persons) {
            if (p.transient) expect(p.profession).toBe('passenger');
            else expect(p.profession, `walker ${p.id} at ${p.home}`).toBe(profession.get(p.home));
          }
        }
      },
    );
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
      },
    );
    // the plays are worth comparing: in many of them someone came back from gathering
    expect(someoneCarried).toBeGreaterThan(0);
    expect(Math.random).not.toHaveBeenCalled();
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
    );
    expect(returned).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ station trips

/** A windmill `dx` and `dy` tiles from a passenger station on a long line; the only places. */
function trip(seed: number, dx: number, dy: number) {
  const { map, builder } = flat(seed, 64, 48, 20);
  const station = builder.placeStation(32, 21, 'station')!;
  const mill = builder.placeBuilding(32 + dx, 21 + dy, 'windmill')!;
  expect([station, mill].every(Boolean)).toBe(true);
  return { map, builder, station, mill, home: `b${mill.x},${mill.y}` };
}

const daytime = (day: number) => day > WAKE && day < SLEEP;
/** Tiles along a walk, diagonals counting root two. */
const lengthOf = (path: { x: number; y: number }[]) =>
  path.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - path[i].x, q.y - path[i].y), 0);

describe('a walker bound for a station', () => {
  // the longest a walker may be out: to the farthest station and back, and the wait there
  const STRANDED = (2 * STATION_REACH * Math.SQRT2) / WALK_SPEED + 150 + 30;

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
        }),
        (c) => {
          expect(Math.abs(c.dx) + c.dy).toBeLessThanOrEqual(STATION_REACH);
          const { map, builder, station, mill } = trip(c.mapSeed, c.dx, c.dy);
          const people = new PeopleSim(map, builder, new Rng(c.stream));
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
              if (p.state === 'toStation' && was !== 'toStation') {
                // it set off for the station
                expect(daytime(day), `walker ${p.id} set off at night`).toBe(true);
                expect(p.stationId).toBe(station.id);
              }
              if (was === 'toStation' && p.state !== 'toStation') {
                if (p.state === 'waiting') {
                  // got there
                  expect([p.x, p.y]).toEqual([station.x, station.y]);
                  arrived++;
                } else {
                  // turned home, which only night does
                  expect(p.state, `walker ${p.id} left its way to the station`).toBe('return');
                  expect(daytime(day), `walker ${p.id} turned back by day`).toBe(false);
                  expect(p.path.at(-1)).toEqual({ x: mill.x, y: mill.y });
                  turned++;
                }
              }
              if (p.state === 'inside') since.delete(p);
              else if (!since.has(p)) since.set(p, now);
              before.set(p, p.state);
            }
            // nobody is out for longer than the longest trip there is
            for (const [p, from] of since)
              if (now - from > STRANDED)
                throw new Error(
                  `t=${now}: walker ${p.id} out since ${from}, now ${p.state} at ${p.x},${p.y}`,
                );
          }
        },
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
        night: rng.pick([0.1, 0.5 * (1 + SLEEP), 0.9, 0.99]),
      }),
      (c) => {
        const { map, builder, station, mill, home } = trip(c.mapSeed, c.dx, c.dy);
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(DT, 1, MIDDAY);
        const [p] = people.persons;
        // make it a mill walker mid-way to the station
        const path = findWalk(map, mill, station)!;
        expect(path.length).toBeGreaterThanOrEqual(3);
        const step = 1 + Math.floor(c.along * (path.length - 2));
        Object.assign(p, {
          home,
          state: 'toStation',
          stationId: station.id,
          path,
          step,
          x: path[step].x,
          y: path[step].y,
          timer: 0,
        });
        const at = { x: p.x, y: p.y };
        const stream = people.toJSON().rng;
        people.tick(DT, 1, c.night);
        expect(daytime(c.night)).toBe(false);
        expect(p.state).toBe('return');
        expect({ x: p.x, y: p.y }).toEqual(at);
        expect(p.path.at(-1)).toEqual({ x: mill.x, y: mill.y });
        expect(p.carrying).toBe(false);
        expect(people.toJSON().rng).toBe(stream);
        // and gets home
        let t = 0;
        while (p.state !== 'inside' && t++ < 1000) people.tick(DT, 1, c.night);
        expect(p.state).toBe('inside');
        // by the shortest way back, which is no longer than the way out
        expect(t * WALK_SPEED).toBeLessThanOrEqual(lengthOf(path) * Math.SQRT2 + 2);
      },
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
