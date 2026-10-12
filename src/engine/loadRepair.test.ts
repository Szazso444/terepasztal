import { describe, expect, it, vi } from 'vitest';
import { applyTileRepairs, repairBuiltTiles, type BuiltObjects } from './loadRepair';
import type { Rng } from './rng';
import { Terrain, inBounds, type GameMap, type PropInstance } from '../world/tiles';
import { DEFAULT_MAP_PARAMS, emptyMap } from '../world/mapgen';
import type { MapGenerator } from '../world/chunks';
import { RegionState } from '../world/regions';
import {
  CLASS_N,
  TRACK_CLASSES,
  TrackGraph,
  footprintOf,
  rotationCount,
  type TrackClass,
  type TrackKind,
} from '../world/track';
import { stationFootprint } from '../sim/stations';
import { buildingDef, buildingToJSON } from '../sim/buildings';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { Stockpile } from '../sim/stockpile';
import { STR } from '../strings';
import { generatorOf, groundOf, type GeneratedWorld } from '../sim/ground';
import type { SaveGame } from '../sim/save';
import { forAll, shrinkArray } from '../testing/property';

// the builder plays a sound when it lays something; the context that plays it is a browser's
vi.mock('./audio', () => ({ sfx: vi.fn() }));

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
      // land stays land: the tile becomes grass, which a platform may stand on, never water
      expect(repairs).toEqual([{ x: 4, y: 4, terrain: Terrain.Grass }]);
      // with the props of the old ground gone
      expect(at(m, 4, 4)).toBe(Terrain.Grass);
      expect(m.props.has(4 * m.w + 4)).toBe(false);
      // and the tiles around it were not touched
      expect(at(m, 3, 4)).toBe(t);
      expect(m.props.size).toBe(0);
    },
  );

  it('is repaired under rail as it is alone', () => {
    const m = flat(Terrain.Rock);
    repaired(m, only({ track: [straight(2, 2)], buildings: [works(2, 2, 'bridge_wood')] }));
    expect(at(m, 2, 2)).toBe(Terrain.Grass);
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

  // AGENTS.md: curve and switch footprint is n x n, with n 2 for regular and high speed, 1 for narrow
  it.each(TRACK_CLASSES)(
    'covers the n x n footprint of a %s curve and switch in every turn, and no tile more',
    (cls) => {
      for (const kind of ['curve', 'switch'] as const)
        for (let rot = 0; rot < rotationCount(kind); rot++) {
          const m = flat(Terrain.Rock);
          const repairs = repaired(m, only({ track: [[3, 3, kind, rot, cls, cls]] }));
          const tiles = footprintOf(3, 3, kind, rot, cls);
          const where = `${kind} turn ${rot}`;
          expect(tiles.length, where).toBe(CLASS_N[cls] ** 2);
          expect(repairs.map((r) => `${r.x},${r.y}`).sort(), where).toEqual(
            tiles.map((t) => `${t.x},${t.y}`).sort(),
          );
        }
    },
  );

  it('answers nothing for a tile the objects turn to water and then to grass again', () => {
    // the retired bridge track kind lays water; a station met after it gives the tile grass back
    const m = flat(Terrain.Grass);
    const repairs = repaired(
      m,
      only({ track: [straight(4, 4, 'bridge')], stations: [station('farm', 4, 4)] }),
    );
    expect(repairs).toEqual([]);
    expect(at(m, 4, 4)).toBe(Terrain.Grass);
  });

  it('takes the props off the tiles it repairs and off no others', () => {
    const m = flat(Terrain.Rock);
    const prop = (): PropInstance[] => [{ kind: 'rock', variant: 0, ox: 0, oy: 0 }];
    // a prop under the repaired station, one beside it, and one on a platform that keeps its grass
    set(m, 6, 6, Terrain.Grass);
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [6, 6],
    ])
      m.props.set(y * m.w + x, prop());
    repaired(
      m,
      only({
        stations: [station('farm', 4, 4)],
        buildings: [works(6, 6, 'bridge_wood')],
      }),
    );
    expect(m.props.has(4 * m.w + 4), 'under the station').toBe(false);
    expect(m.props.has(4 * m.w + 5), 'beside it').toBe(true);
    expect(m.props.has(6 * m.w + 6), 'on the platform that kept its grass').toBe(true);
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
          // the cases hold no retired bridge track, the one kind that lays water: the repair
          // never creates water where the player had none, under a platform or anything else
          expect(r.terrain, 'no new water').not.toBe(Terrain.Water);
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
          if (!land.has(i))
            expect(m.terrain[i], 'platform tile').toBe(
              NO_PLATFORM.includes(before[i]) ? Terrain.Grass : before[i],
            );
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

// ---------------------------------------------------------------- against the sequential repair

/**
 * The repair done the obvious way, as `Game.fixBuiltTiles` did before it was pulled out of the
 * game: object by object, tile by tile, on the map itself, a tile changing the moment an object
 * needs it (track, then stations, decor, works). That body forced every tile under a bridge
 * platform, and under the retired bridge track kind, to water; `platform` is the one rule that
 * differs by decision, the ground a tile under a bridge platform ends up with.
 */
function sequential(m: GameMap, built: BuiltObjects, platform: (t: Terrain) => Terrain) {
  const platforms = new Set<number>();
  for (const [x, y, id] of built.buildings ?? [])
    if (buildingDef(id).bridge) platforms.add(y * m.w + x);
  const stats = { platformRepaired: 0, platformKept: 0 };
  const fix = (x: number, y: number, standing: 'land' | 'platform' | 'water') => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
    const i = y * m.w + x;
    const t = m.terrain[i] as Terrain;
    const to =
      standing === 'water'
        ? Terrain.Water
        : standing === 'platform'
          ? platform(t)
          : NO_LAND.includes(t)
            ? Terrain.Grass
            : t;
    if (standing === 'platform') stats[to === t ? 'platformKept' : 'platformRepaired']++;
    m.terrain[i] = to;
  };
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
      fix(
        f.x,
        f.y,
        kind === 'bridge' ? 'water' : platforms.has(f.y * m.w + f.x) ? 'platform' : 'land',
      );
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) fix(f.x, f.y, 'land');
  for (const [x, y] of built.decor ?? []) fix(x, y, 'land');
  for (const [x, y, id] of built.buildings ?? [])
    fix(x, y, buildingDef(id).bridge ? 'platform' : 'land');
  return stats;
}
/** What the decision gives a tile under a platform: land stays land, a tile no platform may use grass. */
const platformGround = (t: Terrain) => (NO_PLATFORM.includes(t) ? Terrain.Grass : t);

/** A case with every track class, the retired bridge kind, props on the ground, and a small map. */
interface WideCase {
  terrain: number[];
  /** the tiles that carry a prop */
  props: number[];
  built: BuiltObjects;
}
const WIDE = 8;
function genWide(rng: Rng): WideCase {
  const terrain = Array.from({ length: WIDE * WIDE }, () => rng.pick(ALL));
  const props = Array.from({ length: WIDE * WIDE }, (_, i) => i).filter(() => rng.chance(0.3));
  // the map's edge row and column, and one beyond them, so objects overlap and spill off the map
  const at2 = () => [rng.int(-1, WIDE), rng.int(-1, WIDE)] as const;
  const list = <T>(make: () => T) => Array.from({ length: rng.int(0, 5) }, make);
  const built: BuiltObjects = {
    track: list(() => {
      const [x, y] = at2();
      const kind = rng.pick(['straight', 'curve', 'switch', 'crossing', 'bridge'] as const);
      const cls = rng.pick(TRACK_CLASSES);
      return [x, y, kind, rng.int(0, rotationCount(kind) - 1), cls, cls] as Track;
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
  return { terrain, props, built };
}
function mapOfWide(c: WideCase): GameMap {
  const m = flat(Terrain.Grass, WIDE, WIDE);
  m.terrain.set(c.terrain);
  for (const i of c.props) m.props.set(i, [{ kind: 'rock', variant: 0, ox: 0, oy: 0 }]);
  return m;
}
function* shrinkWide(c: WideCase): Iterable<WideCase> {
  for (const k of ['track', 'stations', 'decor', 'buildings'] as const)
    for (const xs of shrinkArray((c.built[k] ?? []) as unknown[]))
      yield { ...c, built: { ...c.built, [k]: xs } };
  for (const props of shrinkArray(c.props)) yield { ...c, props };
  for (let i = 0; i < c.terrain.length; i++)
    if (c.terrain[i] !== Terrain.Grass) {
      const terrain = [...c.terrain];
      terrain[i] = Terrain.Grass;
      yield { ...c, terrain };
    }
}
/** The first tile where two terrain planes differ, named; 'same' when none. */
function firstDifference(got: ArrayLike<number>, want: ArrayLike<number>, w: number) {
  for (let i = 0; i < got.length; i++)
    if (got[i] !== want[i])
      return `tile ${i % w},${Math.floor(i / w)}: got ${name(got[i])}, want ${name(want[i])}`;
  return 'same';
}

describe('the repair against the sequential repair', () => {
  it('gives every tile the terrain the objects met in order leave it, and takes props off the changed ones', () => {
    const reached = { platformRepaired: 0, platformKept: 0, tilesRepaired: 0 };
    forAll(
      genWide,
      (c) => {
        const initial = Uint8Array.from(c.terrain);
        const want = mapOfWide(c);
        const stats = sequential(want, c.built, platformGround);
        for (const k of ['platformRepaired', 'platformKept'] as const) reached[k] += stats[k];
        const m = mapOfWide(c);
        const repairs = repairBuiltTiles(m, c.built);
        applyTileRepairs(m, repairs);
        expect(firstDifference(m.terrain, want.terrain, WIDE), 'terrain').toBe('same');
        // the answer: the tiles whose terrain ended up different, each once, with that terrain
        const differ: number[] = [];
        for (let i = 0; i < initial.length; i++) if (initial[i] !== want.terrain[i]) differ.push(i);
        expect(repairs.map((r) => r.y * WIDE + r.x).sort((a, b) => a - b)).toEqual(differ);
        for (const r of repairs) expect(r.terrain).toBe(want.terrain[r.y * WIDE + r.x]);
        reached.tilesRepaired += repairs.length;
        // the props: gone from the tiles that were repaired and from no others
        const had = new Set(c.props);
        for (let i = 0; i < initial.length; i++)
          expect(m.props.has(i), `prop at tile ${i % WIDE},${Math.floor(i / WIDE)}`).toBe(
            had.has(i) && initial[i] === want.terrain[i],
          );
        // and a load that repaired has nothing left to repair
        expect(repairBuiltTiles(m, c.built)).toEqual([]);
      },
      { shrink: shrinkWide },
    );
    // the seeds reach a platform kept on land, one given grass, and track of every class
    expect(reached.platformKept).toBeGreaterThan(20);
    expect(reached.platformRepaired).toBeGreaterThan(10);
    expect(reached.tilesRepaired).toBeGreaterThan(100);
  });

  it('is what the game did before, wherever no bridge platform stands', () => {
    // the only change of the pull-out is the ground under a platform: with none on the map, the old
    // rule (water) and the new one (grass for rock and mountain) are never asked
    forAll(
      genWide,
      (c) => {
        const noPlatforms: WideCase = {
          ...c,
          built: {
            ...c.built,
            buildings: (c.built.buildings ?? []).filter(([, , id]) => !buildingDef(id).bridge),
          },
        };
        const old = mapOfWide(noPlatforms);
        sequential(old, noPlatforms.built, () => Terrain.Water);
        const now = mapOfWide(noPlatforms);
        applyTileRepairs(now, repairBuiltTiles(now, noPlatforms.built));
        expect(firstDifference(now.terrain, old.terrain, WIDE), 'terrain').toBe('same');
      },
      { shrink: shrinkWide },
    );
  });
});

// ---------------------------------------------------------------- against the builder

/** A builder in editor mode (no cost, no lock) on a `size` x `size` map of one terrain. */
function builderOn(t: Terrain, size = 9) {
  const map = flat(t, size, size);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(size, size),
    new Economy(),
    new Stockpile(),
  );
  builder.free = true;
  return { map, builder };
}
/** What a builder holds, as a save holds it. */
function builtOf(b: Builder): BuiltObjects {
  const track: BuiltObjects['track'] = [];
  for (const a of b.track.anchors())
    track.push([a.x, a.y, a.piece.kind, a.piece.rot, a.piece.cls, a.piece.cls2]);
  return {
    track,
    stations: b.stations.map((s) => s.toJSON()) as unknown as SaveGame['stations'],
    decor: [...b.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
    buildings: [...b.buildings.values()].map(buildingToJSON),
  };
}

describe('the repair and the builder', () => {
  it('refuse the same ground for each kind of object', () => {
    // the sets this file uses (NO_LAND, NO_PLATFORM) are the builder's: a tile is repaired exactly
    // where the builder would have refused what stands on it
    for (const t of ALL) {
      const { builder } = builderOn(t);
      const reasons = (list: (string | undefined)[]) =>
        list.every((r) => r === STR.build.badTerrain);
      const land = [
        builder.checkStation(4, 4, 'farm').reason,
        builder.checkBuilding(4, 4, 'windmill').reason,
        builder.checkDecor(4, 4, 'townhouse').reason,
      ];
      expect(reasons(land), `land on ${name(t)}`).toBe(NO_LAND.includes(t));
      const platforms = ['bridge_wood', 'bridge_stone'].map((id) =>
        builder.checkBuilding(4, 4, id),
      );
      expect(reasons(platforms.map((c) => c.reason)), `platform on ${name(t)}`).toBe(
        NO_PLATFORM.includes(t),
      );
      // track: rock and mountain are in its way, and water until a platform carries it
      const rail = builder.checkTrack(4, 4, { kind: 'straight', cls: 'regular' }, 0);
      expect(
        rail.reason === STR.build.rock || rail.reason === STR.build.needBridge,
        `track on ${name(t)}`,
      ).toBe(NO_LAND.includes(t));
    }
  });

  /** One thing the player does with the builder, in the order the case lists them. */
  type Move =
    | { do: 'track'; x: number; y: number; kind: TrackKind; rot: number; cls: TrackClass }
    | { do: 'works'; x: number; y: number; id: string }
    | { do: 'station'; x: number; y: number; id: string; rot: number }
    | { do: 'decor'; x: number; y: number; id: string; rot: number }
    | { do: 'bridge'; x: number; y: number; id: string };
  interface Scene {
    terrain: number[];
    moves: Move[];
  }
  const SPAN = 12;
  const TRACK_KINDS = ['straight', 'curve', 'switch', 'crossing', 'transition'] as const;
  function genScene(rng: Rng): Scene {
    const terrain = Array.from({ length: SPAN * SPAN }, () => rng.pick(ALL));
    const moves = Array.from({ length: rng.int(10, 60) }, (): Move => {
      const x = rng.int(0, SPAN - 1);
      const y = rng.int(0, SPAN - 1);
      switch (
        rng.pick(['track', 'track', 'works', 'station', 'decor', 'bridge', 'bridge'] as const)
      ) {
        case 'track': {
          const kind = rng.pick(TRACK_KINDS);
          const rot = rng.int(0, rotationCount(kind) - 1);
          return { do: 'track', x, y, kind, rot, cls: rng.pick(TRACK_CLASSES) };
        }
        case 'works':
          return { do: 'works', x, y, id: rng.pick(['windmill', 'bridge_wood', 'bridge_stone']) };
        case 'station':
          return {
            do: 'station',
            x,
            y,
            id: rng.pick(['farm', 'depot', 'narrow_depot', 'station']),
            rot: rng.int(0, 3),
          };
        case 'decor':
          return {
            do: 'decor',
            x,
            y,
            id: rng.pick(['signal', 'power_line', 'water_tower', 'townhouse']),
            rot: rng.int(0, 3),
          };
        case 'bridge':
          return { do: 'bridge', x, y, id: rng.pick(['bridge_wood', 'bridge_stone']) };
      }
    });
    return { terrain, moves };
  }
  function* shrinkScene(c: Scene): Iterable<Scene> {
    for (const moves of shrinkArray(c.moves)) yield { ...c, moves };
    for (let i = 0; i < c.terrain.length; i++)
      if (c.terrain[i] !== Terrain.Grass) {
        const terrain = [...c.terrain];
        terrain[i] = Terrain.Grass;
        yield { ...c, terrain };
      }
  }
  /** Do the moves; the builder refuses what it refuses, and the scene is what it let through. */
  function play(c: Scene) {
    const { map, builder } = builderOn(Terrain.Grass, SPAN);
    map.terrain.set(c.terrain);
    for (const m of c.moves) {
      if (m.do === 'track') builder.placeTrack(m.x, m.y, { kind: m.kind, cls: m.cls }, m.rot);
      else if (m.do === 'works') builder.placeBuilding(m.x, m.y, m.id);
      else if (m.do === 'station') builder.placeStation(m.x, m.y, m.id, m.rot);
      else if (m.do === 'decor') builder.placeDecor(m.x, m.y, m.id, m.rot);
      // a bridge: the platform, then the rail on it
      else if (builder.placeBuilding(m.x, m.y, m.id))
        builder.placeTrack(m.x, m.y, { kind: 'straight', cls: 'regular' }, 1);
    }
    return { map, builder };
  }

  it('leaves everything the builder let the player place exactly where it stands', () => {
    // a repair that changes ground the builder allowed would break what the player built: this is
    // the failure #288 found (a platform on land, forced to water), for every object and terrain
    const seen = { onWater: 0, onLand: 0, railedOnWater: 0, railedOnLand: 0, other: 0 };
    forAll(
      genScene,
      (c) => {
        const { map, builder } = play(c);
        const built = builtOf(builder);
        const repairs = repairBuiltTiles(map, built);
        expect(repairs.map((r) => `${r.x},${r.y}=${name(r.terrain)}`)).toEqual([]);
        for (const [x, y, id] of built.buildings ?? []) {
          if (!buildingDef(id).bridge) {
            seen.other++;
            continue;
          }
          const water = at(map, x, y) === Terrain.Water;
          const railed = builder.track.has(x, y);
          if (water) seen[railed ? 'railedOnWater' : 'onWater']++;
          else seen[railed ? 'railedOnLand' : 'onLand']++;
        }
      },
      { shrink: shrinkScene },
    );
    // the seeds reach platforms across a dip in the land and over water, with and without a rail,
    // and the other things a builder places
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
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
    expect(at(m, rock[0], rock[1])).toBe(Terrain.Grass);
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
