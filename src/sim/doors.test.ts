import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
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
import { buildingDef } from './buildings';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, stationDef, stationGates, stationSpan } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { BUILDING_ROTATIONS, rotationAxis } from './rotation';
import {
  PeopleSim,
  SLEEP,
  WAKE,
  WALK_MARGIN,
  doorstep,
  walkable,
  type Person,
  type PersonState,
} from './people';
import {
  defDoors,
  doorProblems,
  doorsOf,
  placeSpan,
  spanProblems,
  streetDoor,
  type Door,
  type PlaceDef,
} from './doors';
import { forAll, shrinkArray } from '../testing/property';

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

/** A span turned to `rot`: width and depth swapped on the odd rotations. */
const turned = (s: { w: number; h: number }, rot: number) =>
  Math.abs(rot) % 2 === 1 ? { w: s.h, h: s.w } : s;

/** The tiles a place of `def` covers with its corner at (x, y), turned to `rot`. */
function footprint(def: PlaceDef, x: number, y: number, rot: number) {
  const { w, h } = isStation(def) ? stationSpan(def, rot) : turned(placeSpan(def), rot);
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
      { ...station, id: 'span 2 x 1', span: { w: 2, h: 1 } },
      { ...station, id: 'span 1 x 2', span: { w: 1, h: 2 } },
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

  it('checks the doors of a station against its span, and refuses a span of three tiles or more', () => {
    const base = { ...depot(), id: 'spanned' } as StationDef;
    const doors = (tile: [number, number], side: 'N' | 'S' | 'E' | 'W') => [
      { kind: 'street' as const, tile, side },
    ];
    const span21 = { ...base, span: { w: 2, h: 1 } };
    // a door on the second tile of the pair, off its end, is on the footprint and faces out
    expect(doorProblems({ ...span21, doors: doors([1, 0], 'E') })).toEqual([]);
    expect(doorProblems({ ...span21, doors: doors([0, 0], 'S') })).toEqual([]);
    // the tile below it is off the 2 x 1 footprint, and a door facing along it faces into it
    expect(doorProblems({ ...span21, doors: doors([0, 1], 'S') }).join('; ')).toMatch(/tile/);
    expect(doorProblems({ ...span21, doors: doors([0, 0], 'E') }).join('; ')).toMatch(/into/);
    const span12 = { ...base, span: { w: 1, h: 2 } };
    expect(doorProblems({ ...span12, doors: doors([0, 1], 'S') })).toEqual([]);
    expect(doorProblems({ ...span12, doors: doors([0, 0], 'S') }).join('; ')).toMatch(/into/);
    expect(spanProblems(span21)).toEqual([]);
    expect(spanProblems(span12)).toEqual([]);
    expect(spanProblems(base)).toEqual([]);
    for (const span of [{ w: 4, h: 1 }, { w: 1, h: 4 }, { w: 0.5, h: 1 }, { w: 1 }, 'x'])
      expect(
        spanProblems({ ...base, span } as unknown as StationDef).join('; '),
        JSON.stringify(span),
      ).toMatch(/span/);
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

  // slow because each seeded town is run for 40 to 160 ticks at a turn: 0.35 s alone, so a limit of
  // 30 s
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
  }, 30_000);

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
  it('is the span a def declares, else what a station always had, a long one 2 x 1 and any other its size square, and one tile for a works or a decor, turned on the odd rotations', () => {
    // read apart from placeSpan and stationSpan, which now share it: what stationSpan returned
    // before doors, for every rotation a caller may pass
    const literal = (def: PlaceDef, rot: number) => {
      const odd = Math.abs(rot) % 2 === 1;
      // a span comes first (a station's or a works'), then `long`, then the `size` square
      const sp = 'span' in def ? def.span : undefined;
      if (
        sp &&
        sp.w >= 1 &&
        sp.h >= 1 &&
        Number.isInteger(sp.w) &&
        Number.isInteger(sp.h) &&
        sp.w <= 3 &&
        sp.h <= 3
      )
        return odd ? { w: sp.h, h: sp.w } : { w: sp.w, h: sp.h };
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
      { ...plain, id: 'span 2 x 1', span: { w: 2, h: 1 } },
      { ...plain, id: 'span 1 x 2', span: { w: 1, h: 2 } },
      { ...plain, id: 'span before long', span: { w: 1, h: 2 }, long: true },
      { ...plain, id: 'span before size', span: { w: 2, h: 1 }, size: 3 },
      // a span the content check refuses is not read: the footprint the def had
      { ...plain, id: 'span too big', span: { w: 4, h: 1 }, size: 3 },
      { ...plain, id: 'span odd', span: { w: 1.5, h: 1 }, long: true },
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
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };

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

// ------------------------------------------------------------------ two doors facing one tile

/** Where the station of `facingStation` and `campOnForest` stands. */
const FACED = { x: 20, y: 20 };
/** A house, a works and a service stop: places whose walkers go to a station, and gather nothing. */
const FACERS = ['townhouse', 'windmill', 'water_tower'] as const;
type Facer = (typeof FACERS)[number];

/**
 * A passenger station at FACED turned to `stopRot`, and a `kind` of place turned to `rot` standing
 * where its street door faces the tile the station's street door faces, `reach`, so the two
 * doorsteps are that tile: across it from the station or beside it. Null where that place would
 * stand on the station. Nothing else, on grass.
 */
function facingStation(stopRot: number, rot: number, kind: Facer) {
  resetStationIds(1);
  const { map, builder } = bare(SIDE);
  const stop = new Station('station', FACED.x, FACED.y);
  stop.rot = stopRot;
  builder.stations.push(stop);
  const { reach } = streetDoor(stop.def, stop.x, stop.y, stopRot);
  const works = kind === 'windmill';
  const own = streetDoor(works ? buildingDef(kind) : decorDef(kind), 0, 0, rot);
  const x = reach.x - DIR_DX[own.side] - own.tile.x;
  const y = reach.y - DIR_DY[own.side] - own.tile.y;
  if (covers(footprint(stop.def, stop.x, stop.y, stopRot), { x, y })) return null;
  if (works)
    builder.buildings.set(y * SIDE + x, { id: kind, x, y, acc: 0, rot, active: false, rate: 0 });
  else builder.decor.set(y * SIDE + x, { id: kind, x, y, rot });
  return { map, builder, stop, key: works ? `b${x},${y}` : `d${x},${y}`, reach };
}

/**
 * The draws one tick took, as 'the draws walkers take' counts them: a new walker three, a change
 * of state what `cost` says it draws, and a walker due by day that stays in one. Fails on a change
 * of state `cost` does not name.
 */
function tickDraws(
  sim: PeopleSim,
  was: Map<number, { state: PersonState; timer: number }>,
  cost: Record<string, number>,
  label: string,
) {
  let n = 0;
  for (const p of sim.persons) {
    const b = was.get(p.id);
    if (!b) {
      n += 3;
      continue;
    }
    const move = `${b.state}>${p.state}`;
    if (move === 'inside>inside') {
      const due = b.timer - DT <= 0;
      expect(p.timer, `${label} walker ${p.id}`).toBe(due ? 10 : b.timer - DT);
      n += due ? 1 : 0;
    } else if (!(move in cost))
      expect.fail(`${label} walker ${p.id}: ${move}, which no walker makes`);
    else n += cost[move];
  }
  return n;
}

describe('two doors facing one tile', () => {
  // slow: 400 steps of ten walkers, three times over, for each of 36 pairs of places
  it(
    'take a traveller from a house, a works or a service stop facing a station’s street door to it at once, where it waits and boards or walks back in, with the draws any trip takes, at every rotation of both',
    { timeout: 60_000 },
    () => {
      // as in 'the draws walkers take': these places gather nothing, and the station stays
      const COST: Record<string, number> = {
        'inside>idle': 4,
        'inside>toStation': 1,
        'idle>inside': 1,
        'toStation>waiting': 1,
        'waiting>return': 0,
        'return>inside': 1,
        'idle>idle': 0,
        'waiting>waiting': 0,
      };
      let returned = 0;
      let pairs = 0;
      for (const kind of FACERS)
        for (const stopRot of ROTATIONS)
          for (const rot of ROTATIONS) {
            const town = facingStation(stopRot, rot, kind);
            if (!town) continue;
            pairs++;
            const { map, builder, stop, key, reach } = town;
            const pair = `${kind} r${rot} facing the station r${stopRot}`;
            const crossingAt = (x: number, y: number) => builder.roads.isCrossing(x, y);
            // not vacuous: both doorsteps are the one tile
            const doors = doorsBy(new PeopleSim(map, builder));
            expect(doors.get(key), pair).toBeDefined();
            expect(doorstep(map, doors.get(key)!, crossingAt), pair).toEqual(reach);
            expect(doorstep(map, doors.get(`s${stop.id}`)!, crossingAt), pair).toEqual(reach);
            let waited = 0;
            let boarded = 0;
            for (const stream of [1, 2, 3]) {
              const sim = new PeopleSim(map, builder, new Rng(stream));
              for (let t = 0; t < 400; t++) {
                const label = `${pair}, stream ${stream} tick ${t}`;
                const from = sim.toJSON().rng;
                const was = new Map(
                  sim.persons.map((p) => [p.id, { state: p.state, timer: p.timer }]),
                );
                sim.tick(DT, 10, MIDDAY);
                const cost = tickDraws(sim, was, COST, label);
                expect(drawsBetween(from, sim.toJSON().rng, cost + 10_000), label).toBe(cost);
                for (const p of sim.persons) {
                  const b = was.get(p.id)?.state;
                  const move = `${b}>${p.state}`;
                  const who = `${label}: walker ${p.id} of ${p.home}, ${move}`;
                  if (move === 'inside>toStation') {
                    // only the facing place's walkers travel: the station's own never did
                    expect(p.home, who).toBe(key);
                    expect(p.stationId, who).toBe(stop.id);
                    expect(p.path, who).toEqual([reach]);
                    expect(at(p), who).toEqual(reach);
                  }
                  // there at once, it arrives on its next step, and home again on the one after
                  if (b === 'toStation') expect(p.state, who).toBe('waiting');
                  if (b === 'return') expect(p.state, who).toBe('inside');
                  if (move === 'toStation>waiting') {
                    expect(at(p), who).toEqual(reach);
                    waited++;
                  }
                  if (move === 'waiting>return') {
                    expect(p.path, who).toEqual([reach]);
                    returned++;
                  }
                }
                // a train with a coach calls now and then; one waiting the longest boards
                if (t % 90 === 89 && sim.waitingAt(stop.id).length) {
                  const before = sim.persons.length;
                  sim.board(stop, 1);
                  boarded += before - sim.persons.length;
                }
              }
            }
            expect(waited, pair).toBeGreaterThan(0);
            expect(boarded, pair).toBeGreaterThan(0);
          }
      // every place stood both across the tile from the station and beside it
      expect(pairs).toBe(FACERS.length * 12);
      expect(returned).toBeGreaterThan(20);
    },
  );

  it('let a gatherer whose one tile to gather is its own doorstep gather there and carry it in, with the draws it takes elsewhere, at every rotation', () => {
    // as in 'the draws walkers take', with the one forest tile in reach
    const COST: Record<string, number> = {
      'inside>idle': 4,
      'inside>gather': 2,
      'idle>inside': 1,
      'gather>return': 1,
      'return>inside': 1,
      'idle>idle': 0,
    };
    for (const rot of ROTATIONS) {
      resetStationIds(1);
      const { map, builder } = bare(SIDE);
      const camp = new Station('lumber', FACED.x, FACED.y);
      camp.rot = rot;
      builder.stations.push(camp);
      const { reach } = streetDoor(camp.def, camp.x, camp.y, rot);
      map.terrain[reach.y * SIDE + reach.x] = Terrain.Forest;
      let gathered = 0;
      for (const stream of [1, 2, 3]) {
        const sim = new PeopleSim(map, builder, new Rng(stream));
        for (let t = 0; t < 300; t++) {
          const label = `r${rot}, stream ${stream} tick ${t}`;
          const from = sim.toJSON().rng;
          const was = new Map(sim.persons.map((p) => [p.id, { state: p.state, timer: p.timer }]));
          sim.tick(DT, 6, MIDDAY);
          const cost = tickDraws(sim, was, COST, label);
          expect(drawsBetween(from, sim.toJSON().rng, cost + 10_000), label).toBe(cost);
          for (const p of sim.persons) {
            const b = was.get(p.id)?.state;
            const who = `${label}: walker ${p.id}, ${b}>${p.state}`;
            if (b === 'inside' && p.state === 'gather') {
              expect(p.path, who).toEqual([reach]);
              expect(at(p), who).toEqual(reach);
              gathered++;
            }
            // it gathers on its next step and turns in carrying it, and is in on the one after
            if (b === 'gather') {
              expect(p.state, who).toBe('return');
              expect(p.path, who).toEqual([reach]);
              expect(p.carrying, who).toBe(true);
            }
            if (b === 'return') {
              expect(p.state, who).toBe('inside');
              expect(p.carrying, who).toBe(false);
            }
          }
        }
      }
      expect(gathered, `r${rot}`).toBeGreaterThan(5);
    }
  });
});

// ------------------------------------------------------------------ a walk however short

type Tile = { x: number; y: number };
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;
/** Each step of the walk is one of the eight to a tile beside it. */
const stepwise = (path: Tile[]) =>
  path.every(
    (t, i) =>
      i === 0 || Math.max(Math.abs(t.x - path[i - 1].x), Math.abs(t.y - path[i - 1].y)) === 1,
  );

/**
 * Whether a walk joins `from` to `to`: 8-way steps over ground a walker stands on, but for `to`,
 * inside the box the two ends span and WALK_MARGIN round it, by a plain flood. The slow obvious
 * oracle of `findWalk` finding a walk at all, however long or short.
 */
function joined(map: GameMap, from: Tile, to: Tile): boolean {
  const x0 = Math.max(0, Math.min(from.x, to.x) - WALK_MARGIN);
  const y0 = Math.max(0, Math.min(from.y, to.y) - WALK_MARGIN);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + WALK_MARGIN);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + WALK_MARGIN);
  const seen = new Set([`${from.x},${from.y}`]);
  const open = [from];
  while (open.length) {
    const t = open.pop()!;
    if (same(t, to)) return true;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: t.x + dx, y: t.y + dy };
        if (n.x < x0 || n.y < y0 || n.x > x1 || n.y > y1 || seen.has(`${n.x},${n.y}`)) continue;
        if (!walkable(map, n.x, n.y) && !same(n, to)) continue;
        seen.add(`${n.x},${n.y}`);
        open.push(n);
      }
  }
  return false;
}

/**
 * Point the walkers' stream at the next state whose first draw `want` takes: the draw a walker
 * due to step out decides by. The stream is the one a save resumes (`PeopleSim.load`), so this is
 * a resumed game, not a change to the walkers.
 */
function steer(sim: PeopleSim, want: (r: number) => boolean) {
  const twin = new Rng(0);
  twin.state = sim.toJSON().rng;
  for (;;) {
    const from = twin.state;
    if (want(twin.next())) return sim.load({ rng: from });
  }
}

/** The side of the map of `smallTown`, and where its passenger station stands. */
const TOWN = 24;
const STOP_AT = { x: 12, y: 12 };
/** A kind of place the walkers live at, by the list `PeopleSim.places` reads it from. */
interface HomeKind {
  group: 'station' | 'building' | 'decor';
  id: string;
}
/**
 * How the home of `smallTown` stands to its passenger station: `apart`, its corner `off` from the
 * station's; `facing`, its street door facing the tile the station's faces; `intoStop`, its street
 * door facing the station's door tile, with nowhere to stand outside the station's door;
 * `intoHome`, the station's street door facing the home's door tile, with nowhere to stand outside
 * the home's; `self`, the home is the station. The last four make the two doorsteps one tile, but
 * where a door blocked besides moves one of them.
 */
const STANDS = ['apart', 'facing', 'intoStop', 'intoHome', 'self'] as const;
interface TownCase {
  home: HomeKind;
  rot: number;
  stopRot: number;
  stand: (typeof STANDS)[number];
  off: Tile;
  /** a level crossing, rather than water, where nobody stands outside a door */
  crossing: boolean;
  /** nobody stands outside the home's street door, or the station's, besides what `stand` says */
  blockHome: boolean;
  blockStop: boolean;
  /** water, by y * TOWN + x; none on a footprint or where a door is blocked */
  water: number[];
  /** and a ring of water two tiles round the station, but where something stands */
  moat: boolean;
  stream: number;
  /** the walker's wait at the station ends at nightfall rather than with its timer */
  night: boolean;
  /** the home is taken down while its walker waits at the station */
  closeHome: boolean;
  /** night falls on the step after it sets out for the station */
  dusk: boolean;
}

const homeDef = (k: HomeKind): PlaceDef =>
  k.group === 'station'
    ? stationDef(k.id)
    : k.group === 'building'
      ? buildingDef(k.id)
      : decorDef(k.id);

/**
 * Where everything of a `TownCase` stands; null where the home would stand on the station, off the
 * map, or with a blocked doorstep on a footprint or off the map.
 */
function townLayout(c: TownCase) {
  const stopDef = stationDef('station');
  const stopTiles = footprint(stopDef, STOP_AT.x, STOP_AT.y, c.stopRot);
  const stopDoor = streetDoor(stopDef, STOP_AT.x, STOP_AT.y, c.stopRot);
  const def = c.stand === 'self' ? stopDef : homeDef(c.home);
  const rot = c.stand === 'self' ? c.stopRot : c.rot;
  const at0 = streetDoor(def, 0, 0, rot);
  const corner = {
    apart: { x: STOP_AT.x + c.off.x, y: STOP_AT.y + c.off.y },
    facing: {
      x: stopDoor.reach.x - DIR_DX[at0.side] - at0.tile.x,
      y: stopDoor.reach.y - DIR_DY[at0.side] - at0.tile.y,
    },
    intoStop: {
      x: stopDoor.tile.x - DIR_DX[at0.side] - at0.tile.x,
      y: stopDoor.tile.y - DIR_DY[at0.side] - at0.tile.y,
    },
    intoHome: { x: stopDoor.reach.x - at0.tile.x, y: stopDoor.reach.y - at0.tile.y },
    self: STOP_AT,
  }[c.stand];
  const homeTiles = footprint(def, corner.x, corner.y, rot);
  const homeDoor = streetDoor(def, corner.x, corner.y, rot);
  const inMap = (t: Tile) => t.x >= 0 && t.y >= 0 && t.x < TOWN && t.y < TOWN;
  const on = (t: Tile) => covers(stopTiles, t) || covers(homeTiles, t);
  const blocked: (Tile & { side: Dir })[] = [];
  const block = (d: Door) => {
    if (!blocked.some((b) => same(b, d.reach))) blocked.push({ ...d.reach, side: d.side });
  };
  if (c.blockStop || c.stand === 'intoStop') block(stopDoor);
  if (c.blockHome || c.stand === 'intoHome') block(homeDoor);
  const apart = c.stand === 'self' || !homeTiles.some((t) => covers(stopTiles, t));
  if (!homeTiles.every(inMap) || !apart || !blocked.every((b) => inMap(b) && !on(b))) return null;
  return { corner, homeDoor, stopDoor, blocked, on };
}

/**
 * A passenger station at STOP_AT and, as the case stands it, a home of a kind the walkers live at,
 * on grass with the case's water, and a level crossing or water on each blocked doorstep. `close`
 * takes the home down.
 */
function smallTown(c: TownCase) {
  const lay = townLayout(c)!;
  resetStationIds(1);
  const { map, builder } = bare(TOWN);
  const stop = new Station('station', STOP_AT.x, STOP_AT.y);
  stop.rot = c.stopRot;
  builder.stations.push(stop);
  const { x, y } = lay.corner;
  let key = `s${stop.id}`;
  let close = () => {};
  if (c.stand !== 'self' && c.home.group === 'station') {
    const s = new Station(c.home.id, x, y);
    s.rot = c.rot;
    builder.stations.push(s);
    key = `s${s.id}`;
    close = () => void builder.stations.splice(builder.stations.indexOf(s), 1);
  } else if (c.stand !== 'self' && c.home.group === 'building') {
    const b = { id: c.home.id, x, y, acc: 0, rot: c.rot, active: false, rate: 0 };
    builder.buildings.set(y * TOWN + x, b);
    key = `b${x},${y}`;
    close = () => void builder.buildings.delete(y * TOWN + x);
  } else if (c.stand !== 'self') {
    builder.decor.set(y * TOWN + x, { id: c.home.id, x, y, rot: c.rot });
    key = `d${x},${y}`;
    close = () => void builder.decor.delete(y * TOWN + x);
  }
  const ring = (i: number) =>
    Math.max(Math.abs((i % TOWN) - STOP_AT.x), Math.abs(Math.floor(i / TOWN) - STOP_AT.y)) === 2;
  const moat = Array.from({ length: TOWN * TOWN }, (_, i) => i).filter(ring);
  const water = c.moat ? [...c.water, ...moat] : c.water;
  for (const i of water) {
    const t = { x: i % TOWN, y: Math.floor(i / TOWN) };
    if (!lay.on(t) && !lay.blocked.some((b) => same(b, t))) map.terrain[i] = Terrain.Water;
  }
  builder.free = true;
  for (const b of lay.blocked) {
    // a straight across the way out of the door, and a road over it along that way
    const along = b.side === Dir.N || b.side === Dir.S ? 1 : 0;
    if (c.crossing) {
      expect(builder.placeTrack(b.x, b.y, STRAIGHT, along), `track at ${b.x},${b.y}`).toBe(true);
      expect(builder.placeRoad(b.x, b.y), `road at ${b.x},${b.y}`).toBe(true);
    } else map.terrain[b.y * TOWN + b.x] = Terrain.Water;
  }
  builder.free = false;
  return { map, builder, stop, key, close, lay };
}

/** Seeds for the towns: three hundred, as each home kind stands each way only now and then. */
const TOWN_SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

function* shrinkTown(c: TownCase): Iterable<TownCase> {
  for (const water of shrinkArray(c.water)) yield { ...c, water };
  const flags = [
    'moat',
    'dusk',
    'closeHome',
    'night',
    'blockHome',
    'blockStop',
    'crossing',
  ] as const;
  for (const flag of flags) if (c[flag]) yield { ...c, [flag]: false };
  if (c.rot) yield { ...c, rot: 0 };
  if (c.stopRot) yield { ...c, stopRot: 0 };
}

/** Every kind of place the walkers live at, by the list `PeopleSim.places` finds it in. */
const homeKinds = (): HomeKind[] =>
  placeDefs().map((def) => ({
    group: isStation(def)
      ? 'station'
      : content.buildings.some((b) => b.id === def.id)
        ? 'building'
        : 'decor',
    id: def.id,
  }));

/** The gatherers' yards, and the ground each one's walkers gather (`gatherTerrain` in people.ts). */
const YARDS = ['farm', 'lumber', 'quarry', 'pump'] as const;
const GROUND: Record<(typeof YARDS)[number], readonly Terrain[]> = {
  farm: [Terrain.Grass],
  lumber: [Terrain.Forest],
  quarry: [Terrain.Hill, Terrain.Rock],
  pump: [Terrain.Water],
};
/** Where the yard of `yardTown` stands. */
const YARD = { x: 12, y: 12 };
interface YardCase {
  id: (typeof YARDS)[number];
  rot: number;
  /** tiles of its ground, off the yard by (dx, dy), each of GROUND[id][t] */
  ground: { dx: number; dy: number; t: number }[];
  /** what is outside its street door: whatever the ground there is, water, or a level crossing */
  outside: 'open' | 'water' | 'crossing';
  stream: number;
}

/**
 * A gatherer's yard at YARD turned to `rot`, alone on sand, with the case's tiles of its ground
 * round it, all within three tiles of it, and outside its street door what the case says. The yard
 * stands on ground a walker stands on.
 */
function yardTown(c: YardCase) {
  resetStationIds(1);
  const { map, builder } = bare(TOWN);
  map.terrain.fill(Terrain.Sand);
  const yard = new Station(c.id, YARD.x, YARD.y);
  yard.rot = c.rot;
  builder.stations.push(yard);
  const door = streetDoor(yard.def, YARD.x, YARD.y, c.rot);
  for (const g of c.ground) {
    const t = GROUND[c.id][g.t];
    const under = g.dx === 0 && g.dy === 0;
    if (!under || (t !== Terrain.Water && t !== Terrain.Rock))
      map.terrain[(YARD.y + g.dy) * TOWN + YARD.x + g.dx] = t;
  }
  const { x, y } = door.reach;
  if (c.outside === 'water') map.terrain[y * TOWN + x] = Terrain.Water;
  if (c.outside === 'crossing') {
    map.terrain[y * TOWN + x] = Terrain.Sand;
    builder.free = true;
    const along = door.side === Dir.N || door.side === Dir.S ? 1 : 0;
    expect(builder.placeTrack(x, y, STRAIGHT, along), `track at ${x},${y}`).toBe(true);
    expect(builder.placeRoad(x, y), `road at ${x},${y}`).toBe(true);
    builder.free = false;
  }
  return { map, builder, door };
}

/**
 * The tile a gatherer at YARD goes to, as it has always been chosen: of the tiles of its ground,
 * all in reach here, the nearest by |dx| + |dy| plus up to 2 drawn at random, one draw for each in
 * rows from the top, the first among equals; for ground nobody stands on, the first of its
 * neighbours E, W, S and N that a walker stands on, or none.
 */
function nearestGround(map: GameMap, ground: readonly Terrain[], twin: Rng) {
  let best: (Tile & { d: number }) | null = null;
  let draws = 0;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      if (!ground.includes(map.terrain[y * map.w + x])) continue;
      const d = Math.abs(x - YARD.x) + Math.abs(y - YARD.y) + twin.next() * 2;
      draws++;
      if (!best || d < best.d) best = { x, y, d };
    }
  if (!best || walkable(map, best.x, best.y))
    return { spot: best && { x: best.x, y: best.y }, draws };
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    if (walkable(map, best.x + dx, best.y + dy))
      return { spot: { x: best.x + dx, y: best.y + dy }, draws };
  return { spot: null, draws };
}

function* shrinkYard(c: YardCase): Iterable<YardCase> {
  for (const ground of shrinkArray(c.ground)) if (ground.length) yield { ...c, ground };
  if (c.outside !== 'open') yield { ...c, outside: 'open' };
  if (c.rot) yield { ...c, rot: 0 };
}

describe('a walk between two doorsteps, however short', () => {
  it('takes a traveller to its station whenever a walk joins the two doorsteps, of one tile or many, and home again, but never from a station to itself, at every rotation', () => {
    const kinds = homeKinds();
    const seen = {
      ...{ outside: 0, onDoorTile: 0, many: 0, noWalk: 0, own: 0 },
      ...{ dusk: 0, nowStation: 0, home: 0, homeAtOnce: 0 },
    };
    forAll(
      (rng): TownCase => {
        for (;;) {
          const c: TownCase = {
            home: rng.pick(kinds),
            rot: rng.int(0, 3),
            stopRot: rng.int(0, 3),
            stand: rng.pick(STANDS),
            off: { x: rng.int(-6, 6), y: rng.int(-6, 6) },
            crossing: rng.chance(0.5),
            blockHome: rng.chance(0.2),
            blockStop: rng.chance(0.2),
            water: Array.from(
              { length: rng.int(0, 70) },
              () => rng.int(5, 19) * TOWN + rng.int(5, 19),
            ),
            moat: rng.chance(0.3),
            stream: rng.int(0, 0xffffffff),
            night: rng.chance(0.3),
            closeHome: rng.chance(0.3),
            dusk: rng.chance(0.15),
          };
          if (townLayout(c)) return c;
        }
      },
      (c) => {
        if (!townLayout(c)) return true;
        const { map, builder, stop, key, close, lay } = smallTown(c);
        const crossingAt = (x: number, y: number) => builder.roads.isCrossing(x, y);
        const sim = new PeopleSim(map, builder, new Rng(c.stream));
        // one walker, living at the home and due to step out as the day starts
        sim.tick(DT, 1, NIGHT);
        const [p] = sim.persons;
        Object.assign(p, { home: key, x: lay.corner.x, y: lay.corner.y, timer: 0 });
        // it steps out for a train trip
        steer(sim, (r) => r >= 0.92);
        const from = doorstep(map, lay.homeDoor, crossingAt);
        const to = doorstep(map, lay.stopDoor, crossingAt);
        // the nearest station taking passengers is its home, where its home is one
        const own =
          c.stand === 'self' ||
          (c.home.group === 'station' && stationDef(c.home.id).accepts.includes('passengers'));
        let rng = sim.toJSON().rng;
        sim.tick(DT, 1, MIDDAY);
        expect(drawsBetween(rng, sim.toJSON().rng, 1000), 'stepping out').toBe(1);
        if (own || !joined(map, from, to)) {
          expect([p.state, p.timer]).toEqual(['inside', 10]);
          seen[own ? 'own' : 'noWalk']++;
          return;
        }
        expect(p.state).toBe('toStation');
        expect(p.stationId).toBe(stop.id);
        expect(at(p)).toEqual(from);
        expect(p.path[0]).toEqual(from);
        expect(p.path.at(-1)).toEqual(to);
        expect(stepwise(p.path)).toBe(true);
        // the tile alone where the doorsteps are one, and never where they are not
        const length = p.path.length;
        expect(length === 1).toBe(same(from, to));
        const onDoor = same(from, lay.homeDoor.tile) || same(from, lay.stopDoor.tile);
        seen[length > 1 ? 'many' : onDoor ? 'onDoorTile' : 'outside']++;
        if (c.dusk) {
          // night falls as it sets out: on its doorstep still, it has no walk home to turn for and
          // goes on, as one on its home's tile always did
          rng = sim.toJSON().rng;
          sim.tick(DT, 1, NIGHT);
          expect(p.state).toBe(length === 1 ? 'waiting' : 'toStation');
          expect(drawsBetween(rng, sim.toJSON().rng, 1000)).toBe(length === 1 ? 1 : 0);
          seen.dusk++;
          return;
        }
        // there at the end of the walk: on the next step, for a walk of one tile
        let steps = 0;
        while (p.state === 'toStation') {
          rng = sim.toJSON().rng;
          sim.tick(DT, 1, MIDDAY);
          steps++;
          expect(steps).toBeLessThanOrEqual(8 * length);
          const arrived = p.state === 'toStation' ? 0 : 1;
          expect(drawsBetween(rng, sim.toJSON().rng, 1000), `step ${steps}`).toBe(arrived);
        }
        if (length === 1) expect(steps).toBe(1);
        expect(p.state).toBe('waiting');
        expect(at(p)).toEqual(to);
        // no train comes; with its home taken down, the station is the one place left
        if (c.closeHome) close();
        p.timer = c.night ? 99 : 0;
        rng = sim.toJSON().rng;
        sim.tick(DT, 1, c.night ? NIGHT : MIDDAY);
        expect(drawsBetween(rng, sim.toJSON().rng, 1000), 'the wait ends').toBe(0);
        if (c.closeHome) {
          // a walk from the station to itself is none: it goes in at once, as it always has
          expect(p.home).toBe(`s${stop.id}`);
          expect([p.state, p.timer]).toEqual(['inside', 30]);
          seen.nowStation++;
          return;
        }
        expect(p.home).toBe(key);
        // the same ground both ways
        expect(joined(map, to, from)).toBe(true);
        expect(p.state).toBe('return');
        expect(p.path[0]).toEqual(to);
        expect(p.path.at(-1)).toEqual(from);
        expect(stepwise(p.path)).toBe(true);
        const back = p.path.length;
        expect(back === 1).toBe(same(from, to));
        steps = 0;
        while (p.state === 'return') {
          rng = sim.toJSON().rng;
          sim.tick(DT, 1, MIDDAY);
          steps++;
          expect(steps).toBeLessThanOrEqual(8 * back);
          const arrived = p.state === 'return' ? 0 : 1;
          expect(drawsBetween(rng, sim.toJSON().rng, 1000), `step ${steps} home`).toBe(arrived);
        }
        if (back === 1) expect(steps).toBe(1);
        expect(p.state).toBe('inside');
        expect(at(p)).toEqual(from);
        seen[back === 1 ? 'homeAtOnce' : 'home']++;
      },
      { shrink: shrinkTown, seeds: TOWN_SEEDS },
    );
    // not vacuous: trips of one tile, outside both doors or on one's own tile, and of many, and
    // home again from each, homes with no walk to the station, stations' own walkers, walkers
    // caught by nightfall on their doorstep, and walkers whose home became the station
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(10);
  });

  it('takes a gatherer to the nearest tile of its ground and home with it whenever a walk joins it to its doorstep, there at once where that is the doorstep, and keeps it in where that is under its yard, at every rotation', () => {
    const seen = { underYard: 0, onDoorstep: 0, beyond: 0, carried: 0 };
    forAll(
      (rng): YardCase => {
        const id = rng.pick(YARDS);
        const rot = rng.int(0, 3);
        const { reach } = streetDoor(stationDef(id), 0, 0, rot);
        return {
          id,
          rot,
          ground: Array.from({ length: rng.int(1, 4) }, () => {
            const where = rng.next();
            const at = where < 0.3 ? reach : where < 0.5 ? { x: 0, y: 0 } : null;
            return {
              dx: at ? at.x : rng.int(-3, 3),
              dy: at ? at.y : rng.int(-3, 3),
              t: rng.int(0, GROUND[id].length - 1),
            };
          }),
          outside: rng.pick(['open', 'open', 'water', 'crossing'] as const),
          stream: rng.int(0, 0xffffffff),
        };
      },
      (c) => {
        const { map, builder, door } = yardTown(c);
        const crossingAt = (x: number, y: number) => builder.roads.isCrossing(x, y);
        const sim = new PeopleSim(map, builder, new Rng(c.stream));
        // one walker, living at the yard and due to step out as the day starts
        sim.tick(DT, 1, NIGHT);
        const [p] = sim.persons;
        Object.assign(p, { home: 's1', x: YARD.x, y: YARD.y, timer: 0 });
        // it steps out to gather
        steer(sim, (r) => r >= 0.65 && r < 0.92);
        let rng = sim.toJSON().rng;
        const twin = new Rng(0);
        twin.state = rng;
        twin.next();
        const { spot, draws } = nearestGround(map, GROUND[c.id], twin);
        const from = doorstep(map, door, crossingAt);
        sim.tick(DT, 1, MIDDAY);
        expect(drawsBetween(rng, sim.toJSON().rng, 1000), 'stepping out').toBe(1 + draws);
        // no spot, the spot under its own yard, or no walk to it: it stays in, as it always has
        if (!spot || same(spot, YARD) || !joined(map, from, spot)) {
          expect([p.state, p.timer]).toEqual(['inside', 10]);
          if (spot && same(spot, YARD)) seen.underYard++;
          return;
        }
        expect(p.state).toBe('gather');
        expect(at(p)).toEqual(from);
        expect(p.path[0]).toEqual(from);
        expect(p.path.at(-1)).toEqual(spot);
        expect(stepwise(p.path)).toBe(true);
        const length = p.path.length;
        expect(length === 1).toBe(same(from, spot));
        seen[length === 1 ? 'onDoorstep' : 'beyond']++;
        // there at the end of the walk: on the next step, for a walk of one tile
        let steps = 0;
        while (p.state === 'gather') {
          rng = sim.toJSON().rng;
          sim.tick(DT, 1, MIDDAY);
          steps++;
          expect(steps).toBeLessThanOrEqual(8 * length);
          const arrived = p.state === 'gather' ? 0 : 1;
          expect(drawsBetween(rng, sim.toJSON().rng, 1000), `step ${steps}`).toBe(arrived);
        }
        if (length === 1) expect(steps).toBe(1);
        expect(at(p)).toEqual(spot);
        // it turns for home with what it gathered, where a walk joins the spot to its doorstep
        if (!joined(map, spot, from)) {
          expect([p.state, p.carrying]).toEqual(['idle', false]);
          return;
        }
        expect([p.state, p.carrying]).toEqual(['return', true]);
        expect(p.path[0]).toEqual(spot);
        expect(p.path.at(-1)).toEqual(from);
        expect(stepwise(p.path)).toBe(true);
        expect(p.path.length === 1).toBe(same(from, spot));
        const back = p.path.length;
        steps = 0;
        while (p.state === 'return') {
          rng = sim.toJSON().rng;
          sim.tick(DT, 1, MIDDAY);
          steps++;
          expect(steps).toBeLessThanOrEqual(8 * back);
          const arrived = p.state === 'return' ? 0 : 1;
          expect(drawsBetween(rng, sim.toJSON().rng, 1000), `step ${steps} home`).toBe(arrived);
        }
        if (back === 1) expect(steps).toBe(1);
        expect([p.state, p.carrying]).toEqual(['inside', false]);
        expect(at(p)).toEqual(from);
        seen.carried++;
      },
      { shrink: shrinkYard },
    );
    // not vacuous: gatherers stayed in over their yard, gathered on their doorstep and beyond it,
    // and carried it home
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(10);
  });
});
