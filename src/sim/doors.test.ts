import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem } from '../world/track';
import { Rng } from '../engine/rng';
import { DIR_DX, DIR_DY, Dir, opposite, rotateDir } from '../engine/iso';
import {
  DEFAULT_CONTENT,
  content,
  validateContent,
  type BuildingDef,
  type ContentBundle,
  type DecorDef,
  type StationDef,
} from '../data/content';
import { Builder, decorDef } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, stationGates, stationSpan } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { BUILDING_ROTATIONS, rotationAxis } from './rotation';
import { PeopleSim, SLEEP, WAKE, doorstep, type Person, type PersonState } from './people';
import {
  defDoors,
  doorProblems,
  doorsOf,
  placeSpan,
  streetDoor,
  type Door,
  type PlaceDef,
} from './doors';
import { forAll } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** Every rotation, r0 to r3. */
const ROTATIONS = Array.from({ length: BUILDING_ROTATIONS }, (_, r) => r);
/** The side the front faces at r0 to r3 (src/sim/rotation.ts). */
const FRONT = [Dir.S, Dir.W, Dir.N, Dir.E];
/** Corners to stand a place at: the map's own, and one inside it. */
const CORNERS = [
  { x: 0, y: 0 },
  { x: 10, y: 7 },
];
const DT = 1;
const MIDDAY = 0.5;
const NIGHT = 0.05;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

/** A grass map of this side and a builder with nothing on it. */
function bare(side: number, seed = 7) {
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

const isStation = (def: PlaceDef): def is StationDef => 'accepts' in def;

/** The tiles a place of `def` covers with its corner at (x, y), turned to `rot`. */
function footprint(def: PlaceDef, x: number, y: number, rot: number) {
  const { w, h } = isStation(def) ? stationSpan(def, rot) : { w: 1, h: 1 };
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}
const covers = (tiles: { x: number; y: number }[], t: { x: number; y: number }) =>
  tiles.some((f) => f.x === t.x && f.y === t.y);

/**
 * Every kind of station, works and decor of the loaded content put on a builder's lists, each on a
 * tile of its own and turned to `rot` (placement rules are not under test), and the places
 * `PeopleSim.places` makes of them, each with its def and where it stands.
 */
function everyPlace(rot = 0) {
  const side = 64;
  const { map, builder } = bare(side);
  const stood = new Map<string, { def: PlaceDef; x: number; y: number }>();
  let n = 0;
  const spot = () => {
    const i = n++;
    return { x: 2 + 4 * (i % 15), y: 2 + 4 * Math.floor(i / 15) };
  };
  for (const def of content.stations.defs) {
    const { x, y } = spot();
    const s = new Station(def.id, x, y);
    s.rot = rot;
    builder.stations.push(s);
    stood.set(`s${s.id}`, { def, x, y });
  }
  for (const def of content.buildings) {
    const { x, y } = spot();
    builder.buildings.set(y * side + x, { id: def.id, x, y, acc: 0, rot, active: false, rate: 0 });
    stood.set(`b${x},${y}`, { def, x, y });
  }
  for (const def of content.decor) {
    const { x, y } = spot();
    builder.decor.set(y * side + x, { id: def.id, x, y, rot });
    stood.set(`d${x},${y}`, { def, x, y });
  }
  const places = new PeopleSim(map, builder).places();
  return places.map((place) => ({ place, ...stood.get(place.key)! }));
}

/** The def of every place there is: every kind `PeopleSim.places` lists. */
const placeDefs = () => everyPlace().map((p) => p.def);

// ------------------------------------------------------------------ the doors of the content

describe('the doors of every place', () => {
  it('are the stations, the works with a crew, and the houses and service stops', () => {
    // not vacuous: every kind of place the walkers have is among them
    const defs = placeDefs();
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(content.stations.defs.map((d) => d.id)));
    expect(ids).toEqual(expect.arrayContaining(['windmill', 'townhouse', 'water_tower']));
    expect(defs.some(isStation) && defs.some((d) => !isStation(d))).toBe(true);
  });

  it('include a street door of its own data for every place def, in the shipped content', () => {
    // a new place def without one fails here: the kind's default stands in for it in play, but
    // the data is where the art and the road rule read the door from
    const shipped = new Map<string, PlaceDef>(
      [
        ...DEFAULT_CONTENT.stations.defs,
        ...DEFAULT_CONTENT.buildings,
        ...DEFAULT_CONTENT.decor,
      ].map((d) => [d.id, d]),
    );
    for (const def of placeDefs()) {
      const own = shipped.get(def.id)!;
      expect(
        own.doors?.some((d) => d.kind === 'street'),
        def.id,
      ).toBe(true);
      expect(doorProblems(own), def.id).toEqual([]);
    }
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]);
  });

  it('sit on the footprint and face out of it, turned with the place, at every rotation', () => {
    for (const def of placeDefs())
      for (const { x, y } of CORNERS) {
        const base = doorsOf(def, x, y, 0);
        expect(base.length, def.id).toBe(defDoors(def).length);
        // the front door: the one facing S at r0
        const front = base.findIndex((d) => d.side === Dir.S);
        expect(front, `${def.id} has a door on its front`).toBeGreaterThanOrEqual(0);
        for (const rot of ROTATIONS) {
          const label = `${def.id} r${rot} at ${x},${y}`;
          const tiles = footprint(def, x, y, rot);
          const doors = doorsOf(def, x, y, rot);
          const back = doorsOf(def, x, y, rot + 2);
          expect(
            doors.map((d) => d.kind),
            label,
          ).toEqual(base.map((d) => d.kind));
          doors.forEach((d, i) => {
            expect(covers(tiles, d.tile), `${label} door ${i} on the footprint`).toBe(true);
            expect(covers(tiles, d.reach), `${label} door ${i} reaches out of it`).toBe(false);
            // orthogonally beside the door's tile, across its side
            expect(d.reach, label).toEqual({
              x: d.tile.x + DIR_DX[d.side],
              y: d.tile.y + DIR_DY[d.side],
            });
            expect(d.side, label).toBe(rotateDir(base[i].side, rot));
            expect(back[i].side, `${label} against r${rot + 2}`).toBe(opposite(d.side));
          });
          expect(doors[front].side, label).toBe(FRONT[rot]);
          // its street door is a street door, the first of them
          expect(streetDoor(def, x, y, rot), label).toEqual(doors.find((d) => d.kind === 'street'));
        }
      }
  });

  it('move with the place, and are the same for a turn and four more', () => {
    for (const def of placeDefs())
      for (const rot of ROTATIONS) {
        const here = doorsOf(def, 10, 7, rot);
        const shift = (t: { x: number; y: number }) => ({ x: t.x + 3, y: t.y - 2 });
        expect(doorsOf(def, 13, 5, rot), def.id).toEqual(
          here.map((d) => ({ ...d, tile: shift(d.tile), reach: shift(d.reach) })),
        );
        expect(doorsOf(def, 10, 7, rot + 4), def.id).toEqual(here);
        expect(doorsOf(def, 10, 7, rot - 4), def.id).toEqual(here);
      }
  });

  it('give a station its street door on the side away from its platform, at every rotation', () => {
    // D1 (the author, 2026-10-12): a road ends at the street door and never meets platform track
    let stations = 0;
    let depots = 0;
    for (const def of content.stations.defs)
      for (const rot of ROTATIONS) {
        const label = `${def.id} r${rot}`;
        const doors = doorsOf(def, 10, 7, rot);
        const street = streetDoor(def, 10, 7, rot);
        const platforms = doors.filter((d) => d.kind === 'platform');
        if (def.depot) {
          // portals for trains and no platform door: the street door faces across the track
          // through it, onto none of its gates
          expect(platforms, label).toEqual([]);
          expect(street.side === Dir.N || street.side === Dir.S, label).toBe(
            rotationAxis(rot) === 0,
          );
          expect(covers(stationGates(def.id, 10, 7, rot), street.reach), label).toBe(false);
          depots++;
        } else {
          // the platform door on the front, where the platform track runs, the street door behind
          expect(platforms.length, label).toBe(1);
          expect(platforms[0].side, label).toBe(FRONT[rot]);
          expect(street.side, label).toBe(opposite(platforms[0].side));
          stations++;
        }
      }
    expect(stations).toBeGreaterThan(0);
    expect(depots).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ a def without doors

describe('a def without doors', () => {
  /** Every place def with its doors taken off, and stations of every footprint there may be. */
  function doorless(): PlaceDef[] {
    const strip = <T extends PlaceDef>(d: T): T => {
      const out = structuredClone(d);
      delete out.doors;
      return out;
    };
    const station = strip(content.stations.defs.find((d) => d.id === 'station')!);
    const depot = strip(content.stations.defs.find((d) => d.id === 'depot')!);
    return [
      ...placeDefs().map(strip),
      { ...station, id: 'wide', size: 2 },
      { ...station, id: 'wider', size: 3 },
      { ...station, id: 'long', long: true },
      { ...depot, id: 'shed', size: 3 },
    ];
  }

  it('gets those of its kind, which are valid content and keep every rule of the doors', () => {
    for (const def of doorless()) {
      const doors = defDoors(def);
      expect(doorProblems({ ...def, doors: [...doors] }), def.id).toEqual([]);
      for (const rot of ROTATIONS) {
        const label = `${def.id} r${rot}`;
        const tiles = footprint(def, 10, 7, rot);
        const turned = doorsOf(def, 10, 7, rot);
        for (const d of turned) {
          expect(covers(tiles, d.tile), label).toBe(true);
          expect(covers(tiles, d.reach), label).toBe(false);
        }
        const street = streetDoor(def, 10, 7, rot);
        expect(street.kind, label).toBe('street');
        if (!isStation(def) || def.depot) {
          // on the front: S, W, N and E at r0 to r3, and no other door
          expect(turned, label).toEqual([street]);
          expect(street.side, label).toBe(FRONT[rot]);
        } else {
          const platform = turned.find((d) => d.kind === 'platform')!;
          expect(platform.side, label).toBe(FRONT[rot]);
          expect(street.side, label).toBe(opposite(platform.side));
        }
      }
    }
  });

  it('is, for a works or a decor, one street door on the front of its tile', () => {
    const works = structuredClone(content.buildings[0]) as BuildingDef;
    const decor = structuredClone(decorDef('townhouse')) as DecorDef;
    delete works.doors;
    delete decor.doors;
    for (const def of [works, decor]) {
      expect(placeSpan(def)).toEqual({ w: 1, h: 1 });
      expect(defDoors(def)).toEqual([{ kind: 'street', tile: [0, 0], side: 'S' }]);
    }
  });

  it('gets them too when the doors it has hold no street door', () => {
    const def = {
      ...structuredClone(decorDef('townhouse')),
      doors: [{ kind: 'platform' as const, tile: [0, 0] as [number, number], side: 'N' as const }],
    };
    expect(defDoors(def)).toEqual([{ kind: 'street', tile: [0, 0], side: 'S' }]);
  });
});

// ------------------------------------------------------------------ the content check

describe('the content check of doors', () => {
  const depot = () => structuredClone(content.stations.defs.find((d) => d.id === 'depot')!);
  const BAD: [string, unknown, RegExp][] = [
    ['an empty list', [], /list of doors/],
    ['no list', 'S', /list of doors/],
    ['no object', [null], /must be an object/],
    ['a kind of door there is not', [{ kind: 'back', tile: [0, 1], side: 'S' }], /kind/],
    ['a side there is not', [{ kind: 'street', tile: [0, 1], side: 'down' }], /side must/],
    ['a tile between tiles', [{ kind: 'street', tile: [0.5, 1], side: 'S' }], /tile/],
    ['a tile off the footprint', [{ kind: 'street', tile: [2, 1], side: 'S' }], /tile/],
    ['no tile', [{ kind: 'street', side: 'S' }], /tile/],
    ['a door facing into the footprint', [{ kind: 'street', tile: [0, 0], side: 'S' }], /into/],
    ['no street door', [{ kind: 'platform', tile: [0, 1], side: 'S' }], /street door/],
  ];

  it.each(BAD)('finds %s, and sets the table aside', (_what, doors, problem) => {
    const def = { ...depot(), doors } as unknown as StationDef;
    expect(doorProblems(def).join('; ')).toMatch(problem);
    const bundle = structuredClone(DEFAULT_CONTENT) as ContentBundle;
    const at = bundle.stations.defs.findIndex((d) => d.id === 'depot');
    bundle.stations.defs[at] = def;
    expect(validateContent(bundle).join('; ')).toMatch(
      new RegExp(`station depot: .*${problem.source}`),
    );
  });

  it('checks the doors of works and decor against their one tile', () => {
    const bundle = structuredClone(DEFAULT_CONTENT) as ContentBundle;
    const off = [{ kind: 'street' as const, tile: [1, 0] as [number, number], side: 'S' as const }];
    bundle.buildings.find((b) => b.id === 'windmill')!.doors = off;
    bundle.decor.find((d) => d.id === 'townhouse')!.doors = off;
    const problems = validateContent(bundle).join('; ');
    expect(problems).toMatch(/building windmill: door 1: tile/);
    expect(problems).toMatch(/decor townhouse: door 1: tile/);
  });

  it('takes a def without doors', () => {
    const bundle = structuredClone(DEFAULT_CONTENT) as ContentBundle;
    for (const d of bundle.stations.defs) delete d.doors;
    for (const d of bundle.buildings) delete d.doors;
    for (const d of bundle.decor) delete d.doors;
    expect(validateContent(bundle)).toEqual([]);
  });
});

// ------------------------------------------------------------------ walkers

const SIDE = 48;

/**
 * Places of every sort on grass, each turned to `rot`, with forest for the lumber yard: with
 * `walks`, two gatherers and a passenger station among them; without, only places whose walkers
 * do nothing but idle by the door. Every door reaches out onto ground a walker stands on, with no
 * road anywhere, and the stations are numbered from 1.
 */
function turnedTown(rot: number, walks: boolean) {
  // the stations numbered alike in every town, so their walkers' homes have the same keys
  resetStationIds(1);
  const { map, builder } = bare(SIDE);
  for (let y = 30; y < 34; y++)
    for (let x = 6; x < 12; x++) map.terrain[y * SIDE + x] = Terrain.Forest;
  const station = (id: string, x: number, y: number) => {
    const s = new Station(id, x, y);
    s.rot = rot;
    builder.stations.push(s);
  };
  if (walks) {
    station('farm', 18, 20);
    station('lumber', 12, 27);
    station('station', 24, 24);
  }
  station('depot', 30, 14);
  station('narrow_depot', 14, 14);
  station('warehouse', 20, 10);
  for (const [id, x, y] of [
    ['windmill', 22, 30],
    ['kiln', 30, 28],
  ] as const)
    builder.buildings.set(y * SIDE + x, { id, x, y, acc: 0, rot, active: false, rate: 0 });
  for (const [id, x, y] of [
    ['townhouse', 17, 25],
    ['water_tower', 26, 18],
  ] as const)
    builder.decor.set(y * SIDE + x, { id, x, y, rot });
  const people = (stream: number) => new PeopleSim(map, builder, new Rng(stream));
  return { map, builder, people };
}

/** Each place's street door by its key, as `places()` gives it. */
const doorsBy = (people: PeopleSim) => new Map(people.places().map((pl) => [pl.key, pl.door]));
/** How far `p` stands from the door's tile out across its side, and along it. */
function offset(p: { x: number; y: number }, d: Door) {
  const [nx, ny] = [DIR_DX[d.side], DIR_DY[d.side]];
  const [ox, oy] = [p.x - d.tile.x, p.y - d.tile.y];
  return { out: ox * nx + oy * ny, along: ox * ny - oy * nx };
}
const at = (p: Person) => ({ x: p.x, y: p.y });

describe('walkers and the street door', () => {
  it('belongs to each place: places() carries the street door of its def, turned with it', () => {
    for (const rot of ROTATIONS)
      for (const { place, def, x, y } of everyPlace(rot))
        expect(place.door, `${def.id} r${rot}`).toEqual(streetDoor(def, x, y, rot));
  });

  it('is where a walker stepping out idles, in front of it, at every rotation', () => {
    let idled = 0;
    forAll(
      (rng) => ({ rot: rng.int(0, 3), stream: rng.int(0, 0xffffffff), ticks: rng.int(40, 160) }),
      (c) => {
        const { people } = turnedTown(c.rot, true);
        const sim = people(c.stream);
        const doors = doorsBy(sim);
        const before = new Map<Person, PersonState>();
        for (let t = 0; t < c.ticks; t++) {
          sim.tick(DT, 40, MIDDAY);
          for (const p of sim.persons) {
            if (before.get(p) === 'inside' && p.state === 'idle') {
              // from 0.3 to 0.7 of a tile out of the door's tile, at most 0.4 to either side
              const { out, along } = offset(p, doors.get(p.home)!);
              expect(out, `walker ${p.id} of ${p.home}`).toBeGreaterThanOrEqual(0.3 - 1e-9);
              expect(out, `walker ${p.id} of ${p.home}`).toBeLessThan(0.7 + 1e-9);
              expect(Math.abs(along), `walker ${p.id} of ${p.home}`).toBeLessThanOrEqual(
                0.4 + 1e-9,
              );
              idled++;
            }
            before.set(p, p.state);
          }
        }
      },
    );
    expect(idled).toBeGreaterThan(1000);
  });

  it(
    'is where walks out of a place start and walks back end, a station’s too, at every rotation',
    { timeout: 90_000 },
    () => {
      const seen = { gather: 0, toStation: 0, waited: 0, home: 0 };
      forAll(
        (rng) => ({ rot: rng.int(0, 3), stream: rng.int(0, 0xffffffff), ticks: rng.int(200, 500) }),
        (c) => {
          const { map, builder, people } = turnedTown(c.rot, true);
          const sim = people(c.stream);
          const doors = doorsBy(sim);
          // the town's doors all reach out onto ground a walker stands on, so a walk starts and
          // ends on that tile
          for (const d of doors.values()) expect(doorstep(map, d, () => false)).toEqual(d.reach);
          const stationReach = (id: number | null) => {
            const st = builder.stationById(id ?? -1)!;
            return streetDoor(st.def, st.x, st.y, st.rot).reach;
          };
          const before = new Map<Person, PersonState>();
          for (let t = 0; t < c.ticks; t++) {
            sim.tick(DT, 40, MIDDAY);
            for (const p of sim.persons) {
              const was = before.get(p);
              before.set(p, p.state);
              if (p.transient || was === undefined || was === p.state) continue;
              const home = doors.get(p.home)!.reach;
              const label = `walker ${p.id} of ${p.home}, ${was} to ${p.state}, tick ${t}`;
              if (was === 'inside' && (p.state === 'gather' || p.state === 'toStation')) {
                expect(p.path[0], label).toEqual(home);
                expect(at(p), label).toEqual(home);
                if (p.state === 'toStation')
                  expect(p.path.at(-1), label).toEqual(stationReach(p.stationId));
                seen[p.state]++;
              }
              if (was === 'toStation' && p.state === 'waiting') {
                expect(at(p), label).toEqual(stationReach(p.stationId));
                seen.waited++;
              }
              if (was === 'waiting' && p.state === 'return')
                expect(p.path[0], label).toEqual(stationReach(p.stationId));
              if (p.state === 'return') expect(p.path.at(-1), label).toEqual(home);
              if (was === 'return' && p.state === 'inside') {
                expect(at(p), label).toEqual(home);
                seen.home++;
              }
            }
          }
        },
      );
      // not vacuous: walkers went gathering, to the station and waited there, and came home
      for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
    },
  );

  it(
    'turns nothing but the idle spot: the same draws, states and timers at every rotation',
    { timeout: 90_000 },
    () => {
      let idle = 0;
      forAll(
        (rng) => ({
          stream: rng.int(0, 0xffffffff),
          population: rng.int(1, 40),
          ticks: rng.int(20, 200),
          gdt: rng.pick([0.5, 1, 2.5]),
        }),
        (c) => {
          // only places whose walkers do nothing but idle by the door: the walk length of a turned
          // place cannot tell the plays apart, so they are one play, turned
          const sims = ROTATIONS.map((rot) => turnedTown(rot, false).people(c.stream));
          const doors = sims.map(doorsBy);
          for (let t = 0; t < c.ticks; t++) {
            for (const s of sims) s.tick(c.gdt, c.population, MIDDAY);
            const [base] = sims;
            for (const rot of ROTATIONS.slice(1)) {
              const s = sims[rot];
              expect(s.toJSON(), `r${rot} tick ${t}`).toEqual(base.toJSON());
              expect(s.persons.length).toBe(base.persons.length);
              s.persons.forEach((p, i) => {
                const q = base.persons[i];
                const label = `r${rot} tick ${t} walker ${i}`;
                expect([p.state, p.timer, p.home, p.outfit], label).toEqual([
                  q.state,
                  q.timer,
                  q.home,
                  q.outfit,
                ]);
                if (p.state !== 'idle') return;
                // where it idles about its door is where it idles at r0, turned with the door
                const mine = offset(p, doors[rot].get(p.home)!);
                const was = offset(q, doors[0].get(q.home)!);
                expect(mine.out, label).toBeCloseTo(was.out, 9);
                expect(mine.along, label).toBeCloseTo(was.along, 9);
                idle++;
              });
            }
          }
        },
      );
      expect(idle).toBeGreaterThan(1000);
    },
  );

  it('costs a walker stepping out the draws it always cost, at every rotation', () => {
    let gathered = 0;
    let travelled = 0;
    forAll(
      (rng) => ({ stream: rng.int(0, 0xffffffff), population: rng.int(1, 60) }),
      (c) => {
        const streams = ROTATIONS.map((rot) => {
          const sim = turnedTown(rot, true).people(c.stream);
          // at night nobody steps out: then every walker steps out at once
          sim.tick(DT, c.population, NIGHT);
          for (const p of sim.persons) p.timer = 0;
          sim.tick(DT, c.population, MIDDAY);
          if (rot === 0) {
            gathered += sim.persons.filter((p) => p.state === 'gather').length;
            travelled += sim.persons.filter((p) => p.state === 'toStation').length;
          }
          return sim.toJSON().rng;
        });
        expect(new Set(streams).size).toBe(1);
      },
    );
    expect(gathered).toBeGreaterThan(0);
    expect(travelled).toBeGreaterThan(0);
  });

  it('keeps the idle spot of a door facing S, turned with the door, on four draws', () => {
    let idled = 0;
    let stayed = 0;
    forAll(
      (rng) => ({ stream: rng.int(0, 0xffffffff), rot: rng.int(0, 3) }),
      (c) => {
        const { map, builder } = bare(16);
        builder.decor.set(8 * 16 + 8, { id: 'townhouse', x: 8, y: 8, rot: c.rot });
        const sim = new PeopleSim(map, builder, new Rng(c.stream));
        sim.tick(DT, 1, NIGHT);
        const [p] = sim.persons;
        p.timer = 0;
        const twin = new Rng(0);
        twin.state = sim.toJSON().rng;
        sim.tick(DT, 1, MIDDAY);
        if (twin.next() >= 0.65) {
          // nothing to gather and no station: it stays in, on the one draw
          expect(p.state).toBe('inside');
          expect(sim.toJSON().rng).toBe(twin.state);
          stayed++;
          return;
        }
        const along = twin.next();
        const out = twin.next();
        const timer = twin.next();
        expect(sim.toJSON().rng).toBe(twin.state);
        expect(p.state).toBe('idle');
        expect(p.timer).toBe(6 + timer * 14);
        // the spot before there were doors, in front of the S side of its tile
        const [x0, y0] = [8 + (along - 0.5) * 0.8, 8 + 0.3 + out * 0.4];
        if (c.rot === 0) expect(at(p)).toEqual({ x: x0, y: y0 });
        let [ox, oy] = [x0 - 8, y0 - 8];
        for (let r = 0; r < c.rot; r++) [ox, oy] = [-oy, ox];
        expect(p.x - 8).toBeCloseTo(ox, 12);
        expect(p.y - 8).toBeCloseTo(oy, 12);
        idled++;
      },
    );
    expect(idled).toBeGreaterThan(20);
    expect(stayed).toBeGreaterThan(5);
  });

  it('sets out from the door’s own tile where nobody stands outside it', () => {
    const { map } = bare(8);
    map.terrain[3 * 8 + 4] = Terrain.Water;
    map.terrain[5 * 8 + 4] = Terrain.Rock;
    map.terrain[4 * 8 + 5] = Terrain.Mountain;
    const door = (side: Dir, tile = { x: 4, y: 4 }): Door => ({
      kind: 'street',
      tile,
      side,
      reach: { x: tile.x + DIR_DX[side], y: tile.y + DIR_DY[side] },
    });
    const none = () => false;
    expect(doorstep(map, door(Dir.W), none)).toEqual({ x: 3, y: 4 });
    for (const side of [Dir.N, Dir.S, Dir.E])
      expect(doorstep(map, door(side), none), `onto ${side}`).toEqual({ x: 4, y: 4 });
    // off the map, and onto a level crossing
    expect(doorstep(map, door(Dir.N, { x: 2, y: 0 }), none)).toEqual({ x: 2, y: 0 });
    expect(doorstep(map, door(Dir.W, { x: 0, y: 2 }), none)).toEqual({ x: 0, y: 2 });
    expect(doorstep(map, door(Dir.W), (x, y) => x === 3 && y === 4)).toEqual({ x: 4, y: 4 });
  });
});

// ------------------------------------------------------------------ the footprint, read apart

describe('the footprint a door is checked against', () => {
  it('is the span a station always had, a long one 2 x 1 and any other its size square, and one tile for a works or a decor, turned on the odd rotations', () => {
    // read apart from placeSpan and stationSpan, which now share it: what stationSpan returned
    // before doors, for every rotation a caller may pass
    const literal = (def: PlaceDef, rot: number) => {
      const odd = Math.abs(rot) % 2 === 1;
      if (!isStation(def)) return { w: 1, h: 1 };
      if (def.long) return odd ? { w: 1, h: 2 } : { w: 2, h: 1 };
      const n = def.size ?? 1;
      return { w: n, h: n };
    };
    // a passenger station of every footprint, with the doors of its kind
    const plain = structuredClone(content.stations.defs.find((d) => d.id === 'station')!);
    delete plain.doors;
    const defs: PlaceDef[] = [
      ...placeDefs(),
      ...[1, 2, 3].map((n) => ({ ...plain, id: `size ${n}`, size: n })),
      { ...plain, id: 'long', long: true },
    ];
    for (const def of defs) {
      expect(placeSpan(def), def.id).toEqual(literal(def, 0));
      if (isStation(def))
        for (let rot = -4; rot < 8; rot++)
          expect(stationSpan(def, rot), `${def.id} r${rot}`).toEqual(literal(def, rot));
      // every door on that footprint, facing off it
      for (const rot of ROTATIONS) {
        const { w, h } = literal(def, rot);
        const inside = (t: { x: number; y: number }) =>
          t.x >= 10 && t.y >= 7 && t.x < 10 + w && t.y < 7 + h;
        for (const d of doorsOf(def, 10, 7, rot)) {
          expect(inside(d.tile), `${def.id} r${rot} ${d.kind} door`).toBe(true);
          expect(inside(d.reach), `${def.id} r${rot} ${d.kind} door`).toBe(false);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ the draws a walker takes

/** Where the lumber yard of `ledgerTown` stands. */
const LUMBER_AT = { x: 6, y: 40 };
/**
 * The forest of `ledgerTown`: six tiles three and four east of the lumber yard, inside the box its
 * lumberjacks look for a spot in and two tiles off every tile beside the yard, so a walk to any of
 * them from any of its doorsteps is at least a step long.
 */
const LEDGER_FOREST = [9, 10].flatMap((x) => [39, 40, 41].map((y) => ({ x, y })));

/**
 * A town with every place turned to `rot`, on grass, with no road, crossing or train: a passenger
 * station with a depot, a warehouse, a works, two houses and a service stop round it, all within a
 * traveller's reach of it, and far from them a lumber yard by LEDGER_FOREST, out of reach of any
 * station that takes passengers. So a walker stepping out idles, goes to the station or finds no
 * way and stays in, and only a lumberjack gathers, always finding a spot among the forest's tiles.
 * `stop` is the passenger station.
 */
function ledgerTown(rot: number) {
  const { map, builder } = bare(SIDE);
  for (const t of LEDGER_FOREST) map.terrain[t.y * SIDE + t.x] = Terrain.Forest;
  const station = (id: string, x: number, y: number) => {
    const s = new Station(id, x, y);
    s.rot = rot;
    builder.stations.push(s);
    return s;
  };
  const lumber = station('lumber', LUMBER_AT.x, LUMBER_AT.y);
  const stop = station('station', 30, 12);
  station('depot', 34, 16);
  station('warehouse', 25, 8);
  builder.buildings.set(15 * SIDE + 27, {
    id: 'windmill',
    x: 27,
    y: 15,
    acc: 0,
    rot,
    active: false,
    rate: 0,
  });
  for (const [id, x, y] of [
    ['townhouse', 24, 14],
    ['townhouse', 33, 8],
    ['water_tower', 29, 18],
  ] as const)
    builder.decor.set(y * SIDE + x, { id, x, y, rot });
  return { map, builder, lumber: `s${lumber.id}`, stop };
}

/** How many draws take a stream from state `from` to state `to`; -1 when more than `limit`. */
function drawsBetween(from: number, to: number, limit: number): number {
  const twin = new Rng(0);
  twin.state = from;
  for (let n = 0; n <= limit; n++) {
    if (twin.state === to) return n;
    twin.next();
  }
  return -1;
}

describe('the draws walkers take', () => {
  // slow: some 400 steps of a town of up to sixty walkers, for each of 100 seeds
  it(
    'are, every tick and at every rotation, exactly what the walkers that moved on cost before there were doors',
    { timeout: 120_000 },
    () => {
      // what each change of state draws: a new walker its home, outfit and timer; stepping out
      // its choice, then four in all to idle, one more for each forest tile in reach to gather,
      // none more to set off for a station or to find nowhere to go; arriving anywhere and an
      // idle walker going in, its next timer; anything else nothing. These are the draws
      // people.ts took before doors (#406): this test passes on that code too.
      const COST: Record<string, number> = {
        'inside>idle': 4,
        'inside>gather': 1 + LEDGER_FOREST.length,
        'inside>toStation': 1,
        'idle>inside': 1,
        'gather>idle': 1,
        'gather>return': 1,
        'toStation>waiting': 1,
        'return>inside': 1,
        'idle>idle': 0,
        'gather>gather': 0,
        'toStation>toStation': 0,
        'toStation>return': 0,
        'waiting>waiting': 0,
        'waiting>return': 0,
        'waiting>inside': 0,
        'return>return': 0,
      };
      const seen: Record<string, number> = { spawned: 0, stayedIn: 0 };
      forAll(
        (rng) => ({
          rot: rng.int(0, 3),
          stream: rng.int(0, 0xffffffff),
          ticks: rng.int(250, 550),
          gdt: rng.pick([0.5, 1, 2.5]),
          first: rng.int(1, 60),
          then: rng.int(0, 60),
          change: rng.int(0, 550),
          dawn: rng.range(0, 1),
          // the tick the passenger station is taken down, past the end in about half the runs
          demolish: rng.int(100, 1000),
        }),
        (c) => {
          const { map, builder, lumber, stop } = ledgerTown(c.rot);
          const sim = new PeopleSim(map, builder, new Rng(c.stream));
          for (let t = 0; t < c.ticks; t++) {
            // its walkers move to the nearest place, those waiting at it go in, with no draw
            if (t === c.demolish) builder.stations.splice(builder.stations.indexOf(stop), 1);
            // a day every 250 ticks, so walkers are caught out by nightfall too
            const frac = (c.dawn + t * 0.004) % 1;
            const daytime = frac > WAKE && frac < SLEEP;
            const from = sim.toJSON().rng;
            const was = new Map(sim.persons.map((p) => [p.id, { state: p.state, timer: p.timer }]));
            sim.tick(c.gdt, t < c.change ? c.first : c.then, frac);
            let cost = 0;
            for (const p of sim.persons) {
              const b = was.get(p.id);
              if (!b) {
                cost += 3;
                seen.spawned++;
                continue;
              }
              const move = `${b.state}>${p.state}`;
              const label = `r${c.rot} tick ${t}: walker ${p.id} of ${p.home}, ${move}`;
              if (move === 'inside>inside') {
                // due by day and still in: it stepped out and found nowhere to go, for 10 s
                const due = b.timer - c.gdt <= 0 && daytime;
                expect(p.timer, label).toBe(due ? 10 : b.timer - c.gdt);
                if (due) seen.stayedIn++;
                cost += due ? 1 : 0;
                continue;
              }
              if (!(move in COST)) expect.fail(`${label}: a change of state no walker makes`);
              if (move === 'inside>gather') expect(p.home, label).toBe(lumber);
              cost += COST[move];
              seen[move] = (seen[move] ?? 0) + 1;
            }
            const to = sim.toJSON().rng;
            expect(drawsBetween(from, to, cost + 10_000), `r${c.rot} tick ${t}`).toBe(cost);
          }
        },
      );
      // not vacuous: every change of state came up, by day and by night, and with the station gone
      for (const move of [
        'spawned',
        'stayedIn',
        'inside>idle',
        'inside>gather',
        'inside>toStation',
        'idle>inside',
        'gather>return',
        'toStation>waiting',
        'toStation>return',
        'waiting>return',
        'waiting>inside',
        'return>inside',
      ])
        expect(seen[move] ?? 0, move).toBeGreaterThan(20);
    },
  );
});

// ------------------------------------------------------------------ a doorstep nobody stands on

/** Where the house of `houseByLine` stands, and the passenger station its walkers go to. */
const HOUSE = { x: 20, y: 20 };
const STOP = { x: 26, y: 21 };
/** A walker at `p` stands on tile `t`: inside its edge. */
const onTile = (p: { x: number; y: number }, t: { x: number; y: number }) =>
  Math.max(Math.abs(p.x - t.x), Math.abs(p.y - t.y)) < 0.5;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'regular' };

/**
 * A townhouse at HOUSE turned to `rot`, a straight of regular track on the tile outside its street
 * door running along its front, and with `road` a road over that straight: a level crossing on its
 * doorstep. Nothing else: its walkers only ever idle by the door, or find no station to go to.
 */
function houseByLine(rot: number, road: boolean) {
  const { map, builder } = bare(SIDE);
  builder.decor.set(HOUSE.y * SIDE + HOUSE.x, { id: 'townhouse', ...HOUSE, rot });
  const door = streetDoor(decorDef('townhouse'), HOUSE.x, HOUSE.y, rot);
  const { x, y } = door.reach;
  builder.free = true;
  // a straight's turn: 0 runs north to south, 1 east to west
  const along = door.side === Dir.N || door.side === Dir.S ? 1 : 0;
  expect(builder.placeTrack(x, y, STRAIGHT, along), `track at ${x},${y}`).toBe(true);
  if (road) expect(builder.placeRoad(x, y), `road at ${x},${y}`).toBe(true);
  builder.free = false;
  expect(builder.roads.isCrossing(x, y)).toBe(road);
  return { map, builder, door };
}

describe('a door with nowhere to stand outside it', () => {
  // slow: up to 400 steps of two walker sims side by side, compared each step, for 100 seeds
  it(
    'keeps one idling in front of it off a level crossing there, with the draws it had, at every rotation',
    { timeout: 60_000 },
    () => {
      let idle = 0;
      let beyond = 0;
      forAll(
        (rng) => ({
          rot: rng.int(0, 3),
          stream: rng.int(0, 0xffffffff),
          population: rng.int(1, 8),
          ticks: rng.int(100, 400),
        }),
        (c) => {
          // the same house twice, with the crossing on its doorstep and with the bare track there
          const [crossing, plain] = [true, false].map((road) => {
            const { map, builder, door } = houseByLine(c.rot, road);
            return { sim: new PeopleSim(map, builder, new Rng(c.stream)), door };
          });
          const { door } = crossing;
          for (let t = 0; t < c.ticks; t++) {
            crossing.sim.tick(DT, c.population, MIDDAY);
            plain.sim.tick(DT, c.population, MIDDAY);
            expect(crossing.sim.toJSON(), `r${c.rot} tick ${t}`).toEqual(plain.sim.toJSON());
            expect(crossing.sim.persons.length).toBe(plain.sim.persons.length);
            crossing.sim.persons.forEach((p, i) => {
              const q = plain.sim.persons[i];
              const label = `r${c.rot} tick ${t} walker ${p.id} at ${p.x}, ${p.y}`;
              expect([p.id, p.state, p.timer, p.outfit], label).toEqual([
                q.id,
                q.state,
                q.timer,
                q.outfit,
              ]);
              expect(onTile(p, door.reach), label).toBe(false);
              if (p.state !== 'idle') return;
              // the same spot along the door, and out from it the same draw spread over half the
              // way: inside the door's own tile
              const mine = offset(p, door);
              const without = offset(q, door);
              expect(mine.along, label).toBeCloseTo(without.along, 9);
              expect(mine.out - 0.3, label).toBeCloseTo((without.out - 0.3) / 2, 9);
              expect(onTile(p, door.tile), label).toBe(true);
              idle++;
              if (onTile(q, door.reach)) beyond++;
            });
          }
        },
      );
      // not vacuous: with bare track there, walkers stood out on that tile now and then
      expect(idle).toBeGreaterThan(1000);
      expect(beyond).toBeGreaterThan(200);
    },
  );

  // slow: up to 700 steps of a house and a station's walkers, for 100 seeds
  it(
    'starts and ends walks on the door’s own tile when a level crossing or water is outside it, and sets nobody down on the crossing, at every rotation',
    { timeout: 90_000 },
    () => {
      const seen = { toStation: 0, waited: 0, home: 0 };
      forAll(
        (rng) => ({
          rot: rng.int(0, 3),
          stopRot: rng.int(0, 3),
          stream: rng.int(0, 0xffffffff),
          ticks: rng.int(300, 700),
        }),
        (c) => {
          const { map, builder, door } = houseByLine(c.rot, true);
          const stop = new Station('station', STOP.x, STOP.y);
          stop.rot = c.stopRot;
          builder.stations.push(stop);
          const stopDoor = streetDoor(stop.def, stop.x, stop.y, stop.rot);
          map.terrain[stopDoor.reach.y * SIDE + stopDoor.reach.x] = Terrain.Water;
          const sim = new PeopleSim(map, builder, new Rng(c.stream));
          const house = `d${HOUSE.x},${HOUSE.y}`;
          const crossingAt = (x: number, y: number) => builder.roads.isCrossing(x, y);
          // not vacuous: neither door has a doorstep but its own tile
          expect(doorstep(map, door, crossingAt)).toEqual(door.tile);
          expect(doorstep(map, stopDoor, crossingAt)).toEqual(stopDoor.tile);
          const before = new Map<Person, PersonState>();
          for (let t = 0; t < c.ticks; t++) {
            sim.tick(DT, 12, MIDDAY);
            for (const p of sim.persons) {
              const was = before.get(p);
              before.set(p, p.state);
              const label = `r${c.rot} stop r${c.stopRot} tick ${t}: walker ${p.id} of ${p.home}, ${was} to ${p.state}`;
              // anyone not under way stands off the crossing
              if (p.state === 'inside' || p.state === 'idle' || p.state === 'waiting')
                expect(onTile(p, door.reach), `${label} at ${p.x}, ${p.y}`).toBe(false);
              if (was === undefined || was === p.state) continue;
              const home = p.home === house ? door.tile : stopDoor.tile;
              if (was === 'inside' && (p.state === 'toStation' || p.state === 'gather')) {
                expect(p.path[0], label).toEqual(home);
                expect(at(p), label).toEqual(home);
                if (p.home === house) seen.toStation++;
              }
              if (p.state === 'toStation') expect(p.path.at(-1), label).toEqual(stopDoor.tile);
              if (was === 'toStation' && p.state === 'waiting') {
                expect(at(p), label).toEqual(stopDoor.tile);
                seen.waited++;
              }
              if (was === 'waiting' && p.state === 'return')
                expect(p.path[0], label).toEqual(stopDoor.tile);
              if (p.state === 'return') expect(p.path.at(-1), label).toEqual(home);
              if (was === 'return' && p.state === 'inside') {
                expect(at(p), label).toEqual(home);
                if (p.home === house) seen.home++;
              }
            }
          }
        },
      );
      // not vacuous: the house's walkers set off for the station from their door's tile, waited
      // on the station's door tile and came home to their own
      for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
    },
  );
});
