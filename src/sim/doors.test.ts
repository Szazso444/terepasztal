import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
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
import { PeopleSim, doorstep, type Person, type PersonState } from './people';
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
