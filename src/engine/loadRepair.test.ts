import { describe, expect, it } from 'vitest';
import { applyTileRepairs, repairBuiltTiles, type BuiltObjects } from './loadRepair';
import type { Rng } from './rng';
import { Terrain, inBounds, type GameMap } from '../world/tiles';
import { DEFAULT_MAP_PARAMS, emptyMap } from '../world/mapgen';
import type { MapGenerator } from '../world/chunks';
import { footprintOf } from '../world/track';
import { stationFootprint } from '../sim/stations';
import { generatorOf, groundOf, type GeneratedWorld } from '../sim/ground';
import type { SaveGame } from '../sim/save';
import { forAll, shrinkArray } from '../testing/property';

const ALL = [
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Hill,
  Terrain.Water,
  Terrain.Rock,
  Terrain.Sand,
  Terrain.Mountain,
] as const;
/** Terrain no platform may stand on (`checkBuilding` in src/sim/build.ts). */
const NO_PLATFORM: readonly Terrain[] = [Terrain.Rock, Terrain.Mountain];
/** Terrain a station, works, decor piece or plain track may not stand on. */
const NO_LAND: readonly Terrain[] = [Terrain.Water, Terrain.Rock, Terrain.Mountain];
const NAMES = ['grass', 'forest', 'hill', 'water', 'rock', 'sand', 'mountain'];
const name = (t: number) => NAMES[t];
/** A world of nine chunks: small enough to generate in a moment, with water and rock in it. */
const PARAMS = { w: 96, h: 96 };

/** A 9 x 9 map of one terrain. */
const flat = (t: Terrain, w = 9, h = 9): GameMap => emptyMap(1, w, h, t);
const at = (m: GameMap, x: number, y: number) => m.terrain[y * m.w + x] as Terrain;
const set = (m: GameMap, x: number, y: number, t: Terrain) => (m.terrain[y * m.w + x] = t);

type Track = BuiltObjects['track'][number];
const straight = (x: number, y: number, kind: Track[2] = 'straight'): Track => [
  x,
  y,
  kind,
  0,
  'regular',
  'regular',
];
const station = (defId: string, x: number, y: number, rot = 0) =>
  ({ defId, x, y, rot }) as unknown as SaveGame['stations'][number];
const works = (x: number, y: number, id: string) =>
  [x, y, id, 0, 1, null, 0] as [number, number, string, number, number, null, number];
const only = (b: Partial<BuiltObjects>): BuiltObjects => ({ track: [], stations: [], ...b });

/** A load: what `Game.fixBuiltTiles` does with the answer, and the answer. */
function repaired(m: GameMap, built: BuiltObjects) {
  const repairs = repairBuiltTiles(m, built);
  applyTileRepairs(m, repairs);
  return repairs;
}

describe('a bridge platform', () => {
  it.each(['bridge_wood', 'bridge_stone'])(
    'keeps the land under a %s that carries a rail across a dip, and the water under one',
    (id) => {
      for (const t of ALL) {
        if (NO_PLATFORM.includes(t)) continue;
        const m = flat(t);
        const repairs = repaired(m, only({ buildings: [works(4, 4, id)] }));
        expect(repairs, name(t)).toEqual([]);
        expect(at(m, 4, 4), name(t)).toBe(t);
      }
    },
  );

  it('keeps its tile when track runs over it, as it does when it stands alone', () => {
    for (const t of ALL) {
      if (NO_PLATFORM.includes(t)) continue;
      const m = flat(t);
      const built = only({
        track: [straight(3, 4), straight(4, 4), straight(5, 4)],
        buildings: [works(3, 4, 'bridge_wood'), works(4, 4, 'bridge_stone')],
      });
      repaired(m, built);
      // the two platforms keep theirs; the rail beyond them (3 and 4 have platforms, 5 does not)
      expect(at(m, 3, 4), name(t)).toBe(t);
      expect(at(m, 4, 4), name(t)).toBe(t);
      expect(at(m, 5, 4), name(t)).toBe(NO_LAND.includes(t) ? Terrain.Grass : t);
    }
  });

  it.each([
    ['rock', Terrain.Rock],
    ['mountain', Terrain.Mountain],
  ])(
    'is still repaired where its tile came back %s and no platform may stand there',
    (_name, t) => {
      const m = flat(t);
      m.props.set(4 * m.w + 4, [{ kind: 'rock', variant: 0, ox: 0, oy: 0 }]);
      const repairs = repaired(m, only({ buildings: [works(4, 4, 'bridge_wood')] }));
      expect(repairs).toEqual([{ x: 4, y: 4, terrain: Terrain.Water }]);
      // standing on water, which any platform may, with the props of the old ground gone
      expect(at(m, 4, 4)).toBe(Terrain.Water);
      expect(m.props.has(4 * m.w + 4)).toBe(false);
      // and the tiles around it were not touched
      expect(at(m, 3, 4)).toBe(t);
      expect(m.props.size).toBe(0);
    },
  );

  it('is repaired under rail as it is alone', () => {
    const m = flat(Terrain.Rock);
    repaired(m, only({ track: [straight(2, 2)], buildings: [works(2, 2, 'bridge_wood')] }));
    expect(at(m, 2, 2)).toBe(Terrain.Water);
  });
});

describe('the ground under everything else a load repairs', () => {
  it('gives track, stations, decor and works grass where they stand on water, rock or mountain', () => {
    for (const t of NO_LAND) {
      const m = flat(t);
      const repairs = repaired(
        m,
        only({
          track: [straight(0, 0)],
          // a depot covers 2 x 2 tiles, from its corner
          stations: [station('depot', 2, 0), station('farm', 5, 0)],
          decor: [[0, 3, 'signal', 0]],
          buildings: [works(2, 3, 'windmill')],
        }),
      );
      const want = [
        [0, 0],
        [2, 0],
        [3, 0],
        [2, 1],
        [3, 1],
        [5, 0],
        [0, 3],
        [2, 3],
      ];
      expect(
        repairs.map((r) => [r.x, r.y]),
        name(t),
      ).toEqual(want);
      for (const [x, y] of want) expect(at(m, x, y), name(t)).toBe(Terrain.Grass);
      // the rest is as it was
      expect(m.terrain.filter((v) => v === t).length, name(t)).toBe(m.terrain.length - want.length);
    }
  });

  it('leaves buildable ground alone', () => {
    for (const t of ALL) {
      if (NO_LAND.includes(t)) continue;
      const m = flat(t);
      const repairs = repaired(
        m,
        only({
          track: [straight(0, 0)],
          stations: [station('depot', 2, 0)],
          decor: [[0, 3, 'signal', 0]],
          buildings: [works(2, 3, 'windmill')],
        }),
      );
      expect(repairs, name(t)).toEqual([]);
    }
  });

  it('turns the retired bridge track kind to water, where it stands on anything else', () => {
    for (const t of ALL) {
      const m = flat(t);
      repaired(m, only({ track: [straight(4, 4, 'bridge')] }));
      expect(at(m, 4, 4), name(t)).toBe(Terrain.Water);
    }
  });

  it('covers every tile of a wide piece', () => {
    const m = flat(Terrain.Grass);
    set(m, 3, 3, Terrain.Water);
    set(m, 4, 4, Terrain.Rock);
    const piece: Track = [3, 3, 'curve', 0, 'regular', 'regular'];
    const tiles = footprintOf(3, 3, 'curve', 0, 'regular');
    expect(tiles).toContainEqual({ x: 3, y: 3 });
    expect(tiles).toContainEqual({ x: 4, y: 4 });
    repaired(m, only({ track: [piece] }));
    for (const f of tiles) expect(at(m, f.x, f.y)).toBe(Terrain.Grass);
  });

  it('skips what lies off the map', () => {
    const m = flat(Terrain.Water, 4, 4);
    const repairs = repaired(
      m,
      only({
        track: [straight(-1, 0), straight(0, 4), straight(3, 3)],
        // a depot at the corner covers one tile of the map
        stations: [station('depot', 3, 3)],
        decor: [[9, 9, 'signal', 0]],
        buildings: [works(-2, 1, 'bridge_wood')],
      }),
    );
    expect(repairs).toEqual([{ x: 3, y: 3, terrain: Terrain.Grass }]);
    expect(m.terrain.filter((v) => v === Terrain.Water).length).toBe(15);
  });
});

// ---------------------------------------------------------------- properties

interface Case {
  /** terrain of a 12 x 12 map */
  terrain: number[];
  built: BuiltObjects;
}
const SIZE = 12;
function genCase(rng: Rng): Case {
  const terrain = Array.from({ length: SIZE * SIZE }, () => rng.pick(ALL));
  const at2 = () => [rng.int(-1, SIZE), rng.int(-1, SIZE)] as const;
  const list = <T>(make: () => T) => Array.from({ length: rng.int(0, 6) }, make);
  const built: BuiltObjects = {
    track: list(() => {
      const [x, y] = at2();
      const kind = rng.pick(['straight', 'curve', 'switch', 'crossing', 'transition'] as const);
      return [x, y, kind, rng.int(0, 3), 'regular', 'regular'] as Track;
    }),
    stations: list(() => {
      const [x, y] = at2();
      return station(rng.pick(['farm', 'depot', 'narrow_depot', 'station']), x, y, rng.int(0, 3));
    }),
    decor: list(() => {
      const [x, y] = at2();
      return [x, y, 'signal', 0] as [number, number, string, number];
    }),
    buildings: list(() => {
      const [x, y] = at2();
      return works(x, y, rng.pick(['windmill', 'bridge_wood', 'bridge_stone', 'bridge_wood']));
    }),
  };
  return { terrain, built };
}
const mapOfCase = (c: Case): GameMap => {
  const m = flat(Terrain.Grass, SIZE, SIZE);
  m.terrain.set(c.terrain);
  return m;
};
function* shrinkCase(c: Case): Iterable<Case> {
  for (const k of ['track', 'stations', 'decor', 'buildings'] as const)
    for (const xs of shrinkArray((c.built[k] ?? []) as unknown[]))
      yield { ...c, built: { ...c.built, [k]: xs } };
  for (let i = 0; i < c.terrain.length; i++)
    if (c.terrain[i] !== Terrain.Grass) {
      const terrain = [...c.terrain];
      terrain[i] = Terrain.Grass;
      yield { ...c, terrain };
    }
}

/** Every tile the objects of `built` stand on, by the kind of ground they need. */
function stood(built: BuiltObjects, w: number) {
  const platforms = new Set<number>(),
    land = new Set<number>(),
    any = new Set<number>();
  const mark = (set: Set<number>, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= w) return;
    set.add(y * w + x);
    any.add(y * w + x);
  };
  for (const [x, y, id] of built.buildings ?? [])
    if (id.startsWith('bridge')) mark(platforms, x, y);
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
      if (!platforms.has(f.y * w + f.x)) mark(land, f.x, f.y);
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) mark(land, f.x, f.y);
  for (const [x, y] of built.decor ?? []) mark(land, x, y);
  for (const [x, y, id] of built.buildings ?? []) if (!id.startsWith('bridge')) mark(land, x, y);
  return { platforms, land, any };
}

describe('the repair', () => {
  it('leaves every object on ground that allows it, touches nothing else and settles in one pass', () => {
    let repairedSome = 0;
    forAll(
      genCase,
      (c) => {
        const m = mapOfCase(c);
        const before = Uint8Array.from(m.terrain);
        const repairs = repairBuiltTiles(m, c.built);
        // pure: the map is as it was, and asking again answers the same
        expect([...m.terrain]).toEqual([...before]);
        expect(repairBuiltTiles(m, c.built)).toEqual(repairs);
        // each answer is a tile on the map, once, whose terrain changes
        const seen = new Set<number>();
        for (const r of repairs) {
          const i = r.y * m.w + r.x;
          expect(inBounds(m, r.x, r.y), 'on the map').toBe(true);
          expect(seen.has(i), 'once').toBe(false);
          seen.add(i);
          expect(r.terrain, 'changes').not.toBe(before[i]);
        }
        applyTileRepairs(m, repairs);
        const { platforms, land, any } = stood(c.built, m.w);
        // nothing stands where it may not
        for (const i of land)
          expect(NO_LAND.includes(at(m, i % m.w, Math.floor(i / m.w)))).toBe(false);
        for (const i of platforms)
          expect(NO_PLATFORM.includes(at(m, i % m.w, Math.floor(i / m.w)))).toBe(false);
        // only tiles something stands on change, and a platform alone changes only off its range
        for (const r of repairs) expect(any.has(r.y * m.w + r.x), 'under an object').toBe(true);
        for (const i of platforms)
          if (!land.has(i) && !NO_PLATFORM.includes(before[i]))
            expect(m.terrain[i], 'platform tile kept').toBe(before[i]);
        // settled: nothing left to repair
        expect(repairBuiltTiles(m, c.built)).toEqual([]);
        if (repairs.length) repairedSome++;
      },
      { shrink: shrinkCase },
    );
    // the seeds reach the repair
    expect(repairedSome).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------- stored ground

const never: MapGenerator = () => {
  throw new Error('generated a chunk that is stored');
};
/** The first tile off the map's edge row and column that `pick` allows. */
function find(m: GameMap, pick: (t: Terrain) => boolean): [number, number] | null {
  for (let y = 1; y < m.h - 1; y++)
    for (let x = 1; x < m.w - 1; x++) if (pick(at(m, x, y))) return [x, y];
  return null;
}

describe('a load with repairs', () => {
  it('repairs the map in memory and leaves the text of every stored chunk as it was', () => {
    const world: GeneratedWorld = {
      kind: 'generated',
      seed: 7412,
      params: { ...DEFAULT_MAP_PARAMS, ...PARAMS },
    };
    // a game's first load stores the ground it made
    const first = groundOf(world, generatorOf('simple'));
    expect(first.added.length).toBeGreaterThan(0);
    const stored = structuredClone(world.chunks);
    const generated = Uint8Array.from(first.map.terrain);

    // the next load builds the map from the stored chunks and generates nothing
    const loaded = groundOf(world, never);
    expect(loaded.added).toEqual([]);
    const m = loaded.map;
    // the player built on it: a platform across grass and one on rock, a station in water
    const grass = find(m, (t) => t === Terrain.Grass);
    const rock = find(m, (t) => NO_PLATFORM.includes(t));
    const water = find(m, (t) => t === Terrain.Water);
    if (!grass || !rock || !water) throw new Error('the world lacks grass, rock or water');
    const repairs = repaired(
      m,
      only({
        stations: [station('farm', water[0], water[1])],
        buildings: [
          works(grass[0], grass[1], 'bridge_wood'),
          works(rock[0], rock[1], 'bridge_stone'),
        ],
      }),
    );
    // the repair was done: the platform on grass kept its grass, the others were given ground
    expect(repairs.length).toBe(2);
    expect(at(m, grass[0], grass[1])).toBe(Terrain.Grass);
    expect(at(m, rock[0], rock[1])).toBe(Terrain.Water);
    expect(at(m, water[0], water[1])).toBe(Terrain.Grass);
    expect([...m.terrain]).not.toEqual([...generated]);

    // the save's store is as it was, to the byte
    expect(world.chunks).toEqual(stored);
    // and the next load reads the ground as generated: the repairs lived in that session only
    const again = groundOf(world, never);
    expect(again.added).toEqual([]);
    expect([...again.map.terrain]).toEqual([...generated]);
    expect(world.chunks).toEqual(stored);
  }, 20_000);
});
