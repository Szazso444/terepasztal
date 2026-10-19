import { describe, expect, it, vi } from 'vitest';
import {
  applyTileRepairs,
  repairBuiltRoads,
  repairBuiltTiles,
  type BuiltObjects,
} from './loadRepair';
import type { Rng } from './rng';
import { Terrain, TERRAIN_NAMES, inBounds, type GameMap, type PropInstance } from '../world/tiles';
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
import { DIR_DX, DIR_DY, opposite } from './iso';
import { stationFootprint } from '../sim/stations';
import { buildingDef, buildingToJSON } from '../sim/buildings';
import { Builder, DECOR_DEFS, unbuildable } from '../sim/build';
import { Roads } from '../sim/roads';
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
/** Terrain a station, works or decor piece off the rails may not stand on (`unbuildable`). */
const NO_LAND: readonly Terrain[] = [Terrain.Water, Terrain.Rock, Terrain.Mountain];
/**
 * Terrain plain track, and a signal on it, may not stand on without a platform: water. A line runs
 * on across rock and a mountain (#322); that a piece there must continue a line is a rule of how
 * it is drawn, and a piece stays where it stands when the track around it goes.
 */
const NO_RAILS: readonly Terrain[] = [Terrain.Water];
const STONE: readonly Terrain[] = [Terrain.Rock, Terrain.Mountain];
const NAMES = ['grass', 'forest', 'hill', 'water', 'rock', 'sand', 'mountain'];
const name = (t: number) => NAMES[t];
/** Decor that stands on the rails: it needs track under it and asks nothing of the ground. */
const railDecor = (id: string) => DECOR_DEFS.some((d) => d.id === id && d.onTrack && !d.anyTile);
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
      expect(at(m, 5, 4), name(t)).toBe(NO_RAILS.includes(t) ? Terrain.Grass : t);
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

  it('stands on no tile when it lies off the map, even where its index lands on one', () => {
    // the finding (#322): on a 12 x 12 map, (-1, 9) has the index of the tile (11, 8), which a
    // curve covers; the repair took the platform to stand there, giving the mountain under the
    // rails grass and leaving water under them
    const curve: Track = [11, 7, 'curve', 1, 'regular', 'regular'];
    expect(footprintOf(11, 7, 'curve', 1, 'regular')).toContainEqual({ x: 11, y: 8 });
    const finding = (t: Terrain) => {
      const m = flat(Terrain.Grass, 12, 12);
      set(m, 11, 8, t);
      return repairBuiltTiles(
        m,
        only({ track: [curve], buildings: [works(-1, 9, 'bridge_wood')] }),
      );
    };
    expect(finding(Terrain.Mountain)).toEqual([]);
    expect(finding(Terrain.Water)).toEqual([{ x: 11, y: 8, terrain: Terrain.Grass }]);
    // and from every place off a 4 x 4 map, two rings out, whose index lands on a tile of it, over
    // every ground, with a straight and a signal on that tile: the answer is the one with no
    // platform at all
    let aliased = 0;
    for (let y = -2; y < 6; y++)
      for (let x = -2; x < 6; x++) {
        const i = y * 4 + x;
        if ((x >= 0 && y >= 0 && x < 4 && y < 4) || i < 0 || i >= 16) continue;
        aliased++;
        const tx = i % 4,
          ty = Math.floor(i / 4);
        const built = only({ track: [straight(tx, ty)], decor: [[tx, ty, 'signal', 0]] });
        for (const id of ['bridge_wood', 'bridge_stone'])
          for (const t of ALL) {
            const m = flat(t, 4, 4);
            const where = `${id} at ${x},${y} over ${name(t)} at ${tx},${ty}`;
            expect(repairBuiltTiles(m, { ...built, buildings: [works(x, y, id)] }), where).toEqual(
              repairBuiltTiles(m, built),
            );
          }
      }
    expect(aliased).toBeGreaterThan(15);
  });
});

describe('the ground under everything else a load repairs', () => {
  it('gives stations, decor off the rails and works grass where they stand on water, rock or mountain', () => {
    for (const t of NO_LAND) {
      const m = flat(t);
      const repairs = repaired(
        m,
        only({
          // a depot covers 2 x 2 tiles, from its corner, and a Big Farm Halt 1 x 2
          stations: [station('depot', 2, 0), station('big_farm', 5, 0)],
          // a signal with no track under it, a power pole, which asks the ground even on track,
          // and a house
          decor: [
            [0, 3, 'signal', 0],
            [7, 3, 'power_line', 0],
            [7, 7, 'townhouse', 0],
          ],
          buildings: [works(2, 3, 'windmill')],
        }),
      );
      const want = [
        [2, 0],
        [3, 0],
        [2, 1],
        [3, 1],
        [5, 0],
        [5, 1],
        [0, 3],
        [7, 3],
        [7, 7],
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

  it('gives track, and a signal on it, grass on water and keeps every other ground under them', () => {
    const track: Track[] = [
      straight(0, 0),
      [2, 0, 'crossing', 0, 'regular', 'regular'],
      [4, 0, 'transition', 1, 'regular', 'high_speed'],
      [0, 3, 'curve', 0, 'regular', 'regular'],
      [3, 3, 'switch', 1, 'high_speed', 'high_speed'],
      [6, 3, 'curve', 2, 'narrow', 'narrow'],
    ];
    const tiles = track.flatMap(([x, y, kind, rot, cls]) => footprintOf(x, y, kind, rot, cls));
    // a signal on the straight and one on a member of the curve
    const decor: BuiltObjects['decor'] = [
      [0, 0, 'signal', 0],
      [1, 4, 'signal', 0],
    ];
    expect(tiles).toContainEqual({ x: 1, y: 4 });
    for (const t of ALL) {
      const m = flat(t);
      const repairs = repaired(m, only({ track, decor }));
      if (NO_RAILS.includes(t)) {
        // on water, every tile of every piece, once each, in the order the pieces are met
        expect(
          repairs.map((r) => `${r.x},${r.y}`),
          name(t),
        ).toEqual(tiles.map((f) => `${f.x},${f.y}`));
        expect(m.terrain.filter((v) => v === Terrain.Grass).length).toBe(tiles.length);
      } else {
        // rock and mountain included: the line ran on across them, and keeps them on a load
        expect(repairs, name(t)).toEqual([]);
        expect(m.terrain.every((v) => v === t)).toBe(true);
      }
    }
  });

  it('gives grass under a power pole on mountain track, which the builder refuses there', () => {
    for (const t of STONE) {
      const m = flat(t);
      const repairs = repaired(
        m,
        only({
          track: [straight(3, 4), straight(4, 4), straight(5, 4)],
          decor: [
            [3, 4, 'signal', 0],
            [4, 4, 'power_line', 0],
          ],
        }),
      );
      expect(repairs, name(t)).toEqual([{ x: 4, y: 4, terrain: Terrain.Grass }]);
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
    const piece: Track = [3, 3, 'curve', 0, 'regular', 'regular'];
    const tiles = footprintOf(3, 3, 'curve', 0, 'regular');
    expect(tiles).toContainEqual({ x: 3, y: 3 });
    expect(tiles).toContainEqual({ x: 4, y: 4 });
    // water under the anchor and the far corner, rock and a mountain under the other two
    let k = 0;
    const under = tiles.map((f) => (f.x - 3 === f.y - 3 ? Terrain.Water : STONE[k++]));
    expect([...under].sort()).toEqual(
      [Terrain.Water, Terrain.Water, Terrain.Rock, Terrain.Mountain].sort(),
    );
    tiles.forEach((f, i) => set(m, f.x, f.y, under[i]));
    repaired(m, only({ track: [piece] }));
    tiles.forEach((f, i) =>
      expect(at(m, f.x, f.y), `${f.x},${f.y}`).toBe(
        under[i] === Terrain.Water ? Terrain.Grass : under[i],
      ),
    );
  });

  // AGENTS.md: curve and switch footprint is n x n, with n 2 for regular and high speed, 1 for narrow
  it.each(TRACK_CLASSES)(
    'covers the n x n footprint of a %s curve and switch in every turn, and no tile more',
    (cls) => {
      for (const kind of ['curve', 'switch'] as const)
        for (let rot = 0; rot < rotationCount(kind); rot++) {
          const tiles = footprintOf(3, 3, kind, rot, cls);
          const where = `${kind} turn ${rot}`;
          expect(tiles.length, where).toBe(CLASS_N[cls] ** 2);
          const m = flat(Terrain.Water);
          const repairs = repaired(m, only({ track: [[3, 3, kind, rot, cls, cls]] }));
          expect(repairs.map((r) => `${r.x},${r.y}`).sort(), where).toEqual(
            tiles.map((t) => `${t.x},${t.y}`).sort(),
          );
          // and keeps rock and a mountain under all of it
          for (const t of STONE)
            expect(
              repairBuiltTiles(flat(t), only({ track: [[3, 3, kind, rot, cls, cls]] })),
              `${where} on ${name(t)}`,
            ).toEqual([]);
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

  it('stands a signal on the ground where the only track is off the map', () => {
    // off a 4 x 4 map, (-1, 1) and (4, 0) have the indices of the tiles (3, 0) and (0, 1)
    const m = flat(Terrain.Rock, 4, 4);
    const repairs = repaired(
      m,
      only({
        track: [straight(-1, 1), straight(4, 0)],
        decor: [
          [3, 0, 'signal', 0],
          [0, 1, 'signal', 0],
        ],
      }),
    );
    expect(repairs).toEqual([
      { x: 3, y: 0, terrain: Terrain.Grass },
      { x: 0, y: 1, terrain: Terrain.Grass },
    ]);
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
    decor: [],
    buildings: list(() => {
      const [x, y] = at2();
      return works(x, y, rng.pick(['windmill', 'bridge_wood', 'bridge_stone', 'bridge_wood']));
    }),
  };
  built.decor = decorOf(rng, built.track, at2);
  addOffMapPlatformOverRails(rng, built, SIZE);
  return { terrain, built };
}
/** Signals, power poles and houses, most of them on a tile of a track piece where there is one. */
function decorOf(
  rng: Rng,
  track: readonly Track[],
  at2: () => readonly [number, number],
): NonNullable<BuiltObjects['decor']> {
  return Array.from({ length: rng.int(0, 6) }, () => {
    let [x, y] = at2();
    if (track.length && rng.chance(0.7)) {
      const [ax, ay, kind, rot, cls] = rng.pick(track);
      ({ x, y } = rng.pick(footprintOf(ax, ay, kind, rot, cls ?? 'regular')));
    }
    const id = rng.pick(['signal', 'signal', 'signal', 'power_line', 'townhouse']);
    return [x, y, id, 0] as [number, number, string, number];
  });
}
/**
 * The tiles of a `w` x `w` map whose index `y * w + x` a bridge platform off the map has. The old
 * repair read such a platform as standing there; the cases count the rails it meets, so the seeds
 * are seen to reach it.
 */
function aliasedPlatforms(built: BuiltObjects, w: number): Set<number> {
  const out = new Set<number>();
  for (const [x, y, id] of built.buildings ?? []) {
    const i = y * w + x;
    if (buildingDef(id).bridge && (x < 0 || y < 0 || x >= w || y >= w) && i >= 0 && i < w * w)
      out.add(i);
  }
  return out;
}
/**
 * Now and then, add to `built` a bridge platform off the `w` x `w` map whose index lands on a tile
 * of plain track on it: a row up and a map's width right of the tile, or a row down and a map's
 * width left. The edge ring of the cases reaches this only rarely.
 */
function addOffMapPlatformOverRails(rng: Rng, built: BuiltObjects, w: number) {
  const tiles = built.track
    .filter(([, , kind]) => kind !== 'bridge')
    .flatMap(([x, y, kind, rot, cls]) => footprintOf(x, y, kind, rot, cls ?? 'regular'))
    .filter((f) => f.x >= 0 && f.y >= 0 && f.x < w && f.y < w);
  if (!tiles.length || !rng.chance(0.3)) return;
  const { x, y } = rng.pick(tiles);
  const [px, py] = y > 0 ? [x + w, y - 1] : [x - w, y + 1];
  built.buildings = [
    ...(built.buildings ?? []),
    works(px, py, rng.pick(['bridge_wood', 'bridge_stone'])),
  ];
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

/** A case with fewer roads saved, then one `shrinkCase` makes smaller. */
function* shrinkRoadCase(c: Case): Iterable<Case> {
  for (const xs of shrinkArray((c.built.roads ?? []) as unknown[]))
    yield { ...c, built: { ...c.built, roads: xs as BuiltObjects['roads'] } };
  yield* shrinkCase(c);
}

/**
 * Every tile the objects of `built` stand on, by the kind of ground they need: a platform, land,
 * or rails (plain track off a platform, and a signal on such a tile). The cases hold no retired
 * bridge track.
 */
function stood(built: BuiltObjects, w: number) {
  const platforms = new Set<number>(),
    land = new Set<number>(),
    rails = new Set<number>(),
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
      if (!platforms.has(f.y * w + f.x)) mark(rails, f.x, f.y);
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) mark(land, f.x, f.y);
  // a signal stands as the track under it does; one off the rails, and any other decor, on land
  for (const [x, y, id] of built.decor ?? [])
    if (!(railDecor(id) && rails.has(y * w + x))) mark(land, x, y);
  for (const [x, y, id] of built.buildings ?? []) if (!id.startsWith('bridge')) mark(land, x, y);
  return { platforms, land, rails, any };
}

describe('the repair', () => {
  it('leaves every object on ground that allows it, touches nothing else and settles in one pass', () => {
    let repairedSome = 0;
    // the seeds reach rails kept on rock and mountain, with a signal on them, rails on water, and
    // rails on a tile whose index a platform off the map has
    const reached = {
      railsKeptOnStone: 0,
      signalKeptOnStone: 0,
      railsOffWater: 0,
      railsUnderOffMapPlatform: 0,
    };
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
        const { platforms, land, rails, any } = stood(c.built, m.w);
        const tile = (i: number) => `tile ${i % m.w},${Math.floor(i / m.w)}`;
        // nothing stands where it may not
        for (const i of land) expect(NO_LAND, `land ${tile(i)}`).not.toContain(m.terrain[i]);
        for (const i of rails) expect(NO_RAILS, `rails ${tile(i)}`).not.toContain(m.terrain[i]);
        for (const i of platforms)
          expect(NO_PLATFORM, `platform ${tile(i)}`).not.toContain(m.terrain[i]);
        // only tiles something stands on change, and a platform or rails alone change only off
        // their range
        for (const r of repairs) expect(any.has(r.y * m.w + r.x), 'under an object').toBe(true);
        for (const i of platforms)
          if (!land.has(i))
            expect(m.terrain[i], `platform ${tile(i)}`).toBe(
              NO_PLATFORM.includes(before[i]) ? Terrain.Grass : before[i],
            );
        const aliased = aliasedPlatforms(c.built, m.w);
        for (const i of rails) {
          if (land.has(i) || platforms.has(i)) continue;
          expect(m.terrain[i], `rails ${tile(i)}`).toBe(
            NO_RAILS.includes(before[i]) ? Terrain.Grass : before[i],
          );
          if (STONE.includes(before[i])) reached.railsKeptOnStone++;
          if (before[i] === Terrain.Water) reached.railsOffWater++;
          if (aliased.has(i) && NO_LAND.includes(before[i])) reached.railsUnderOffMapPlatform++;
        }
        for (const [x, y, id] of c.built.decor ?? []) {
          if (!inBounds(m, x, y)) continue;
          const i = y * m.w + x;
          if (railDecor(id) && rails.has(i) && !land.has(i) && STONE.includes(before[i]))
            reached.signalKeptOnStone++;
        }
        // settled: nothing left to repair
        expect(repairBuiltTiles(m, c.built)).toEqual([]);
        if (repairs.length) repairedSome++;
      },
      { shrink: shrinkCase },
    );
    // the seeds reach the repair
    expect(repairedSome).toBeGreaterThan(20);
    expect(reached.railsKeptOnStone).toBeGreaterThan(60);
    expect(reached.railsOffWater).toBeGreaterThan(30);
    expect(reached.signalKeptOnStone).toBeGreaterThan(10);
    expect(reached.railsUnderOffMapPlatform).toBeGreaterThan(6);
  });
});

// ---------------------------------------------------------------- against the sequential repair

/** The ground each decision gives a tile, by what stands on it. */
interface Decisions {
  /** under a bridge platform */
  platform: (t: Terrain) => Terrain;
  /** under plain track off a platform */
  rails: (t: Terrain) => Terrain;
  /** does a signal on such track stand as the track does, or on land */
  signalOnRails: boolean;
  /**
   * does a platform off the map stand on the tile its index `y * w + x` lands on (the old body
   * keyed platforms so), or on none
   */
  offMapPlatformOnTile: boolean;
}
/**
 * The repair done the obvious way, as `Game.fixBuiltTiles` did before it was pulled out of the
 * game: object by object, tile by tile, on the map itself, a tile changing the moment an object
 * needs it (track, then stations, decor, works). That body forced every tile under a bridge
 * platform, and under the retired bridge track kind, to water, and gave every tile under plain
 * track, and under a signal, grass in place of water, rock and mountain. What differs by decision
 * is in `decide`: the ground under a platform (#288), under plain track and a signal on it (#322),
 * and whether a platform off the map stands on the tile its index lands on (#322 too).
 */
function sequential(m: GameMap, built: BuiltObjects, decide: Decisions) {
  const platforms = new Set<number>();
  for (const [x, y, id] of built.buildings ?? [])
    if (buildingDef(id).bridge && (decide.offMapPlatformOnTile || inBounds(m, x, y)))
      platforms.add(y * m.w + x);
  const rails = new Set<number>();
  const stats = {
    platformRepaired: 0,
    platformKept: 0,
    railsKeptOnStone: 0,
    signalKeptOnStone: 0,
  };
  const fix = (x: number, y: number, standing: 'land' | 'rails' | 'platform' | 'water') => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
    const i = y * m.w + x;
    const t = m.terrain[i] as Terrain;
    const to =
      standing === 'water'
        ? Terrain.Water
        : standing === 'platform'
          ? decide.platform(t)
          : standing === 'rails'
            ? decide.rails(t)
            : NO_LAND.includes(t)
              ? Terrain.Grass
              : t;
    if (standing === 'platform') stats[to === t ? 'platformKept' : 'platformRepaired']++;
    if (standing === 'rails' && to === t && STONE.includes(t)) stats.railsKeptOnStone++;
    m.terrain[i] = to;
    return to === t && STONE.includes(t);
  };
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular')) {
      const i = f.y * m.w + f.x;
      const standing = kind === 'bridge' ? 'water' : platforms.has(i) ? 'platform' : 'rails';
      if (standing === 'rails' && inBounds(m, f.x, f.y)) rails.add(i);
      fix(f.x, f.y, standing);
    }
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) fix(f.x, f.y, 'land');
  for (const [x, y, id] of built.decor ?? []) {
    const onRails =
      decide.signalOnRails && railDecor(id) && inBounds(m, x, y) && rails.has(y * m.w + x);
    if (fix(x, y, onRails ? 'rails' : 'land') && onRails) stats.signalKeptOnStone++;
  }
  for (const [x, y, id] of built.buildings ?? [])
    fix(x, y, buildingDef(id).bridge ? 'platform' : 'land');
  return stats;
}
/**
 * The rules before #288 and #322: water under a platform, track and signals on land, and a platform
 * off the map standing on the tile its index lands on.
 */
const BEFORE: Decisions = {
  platform: () => Terrain.Water,
  rails: (t) => (NO_LAND.includes(t) ? Terrain.Grass : t),
  signalOnRails: false,
  offMapPlatformOnTile: true,
};
/**
 * The rules now: under a platform land stays land and a tile no platform may use gets grass;
 * plain track, and a signal on it, keep any ground but water, which gets grass; a platform off the
 * map stands on no tile, as nothing else off it does.
 */
const NOW: Decisions = {
  platform: (t) => (NO_PLATFORM.includes(t) ? Terrain.Grass : t),
  rails: (t) => (NO_RAILS.includes(t) ? Terrain.Grass : t),
  signalOnRails: true,
  offMapPlatformOnTile: false,
};

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
    decor: [],
    buildings: list(() => {
      const [x, y] = at2();
      return works(x, y, rng.pick(['windmill', 'bridge_wood', 'bridge_stone', 'bridge_wood']));
    }),
  };
  built.decor = decorOf(rng, built.track, at2);
  addOffMapPlatformOverRails(rng, built, WIDE);
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
    const reached = {
      platformRepaired: 0,
      platformKept: 0,
      railsKeptOnStone: 0,
      signalKeptOnStone: 0,
      tilesRepaired: 0,
      railsUnderOffMapPlatform: 0,
    };
    forAll(
      genWide,
      (c) => {
        const initial = Uint8Array.from(c.terrain);
        const want = mapOfWide(c);
        const stats = sequential(want, c.built, NOW);
        for (const [k, n] of Object.entries(stats)) reached[k as keyof typeof stats] += n;
        // track on water, rock or a mountain whose index a platform off the map has: the tiles the
        // old body gave a platform's ground
        const aliased = aliasedPlatforms(c.built, WIDE);
        for (const [x, y, kind, rot, cls] of c.built.track)
          if (kind !== 'bridge')
            for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
              if (inBounds(want, f.x, f.y) && aliased.has(f.y * WIDE + f.x))
                if (NO_LAND.includes(initial[f.y * WIDE + f.x])) reached.railsUnderOffMapPlatform++;
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
    // the seeds reach a platform kept on land, one given grass, rock and mountain kept under track
    // and under a signal on it, track on a tile whose index a platform off the map has, and track
    // of every class
    expect(reached.platformKept).toBeGreaterThan(20);
    expect(reached.platformRepaired).toBeGreaterThan(10);
    expect(reached.railsKeptOnStone).toBeGreaterThan(40);
    expect(reached.signalKeptOnStone).toBeGreaterThan(7);
    expect(reached.tilesRepaired).toBeGreaterThan(100);
    expect(reached.railsUnderOffMapPlatform).toBeGreaterThan(3);
  });

  it('is what the game did before, wherever no bridge platform stands and no track on rock or mountain', () => {
    // the pull-out and #322 changed only the ground under a platform and under plain track on rock
    // or a mountain: with neither on the map, the old rules (water under a platform, grass under
    // track) and the new ones are never told apart
    forAll(
      genWide,
      (c) => {
        const terrain = [...c.terrain];
        for (const [x, y, kind, rot, cls] of c.built.track)
          if (kind !== 'bridge')
            for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
              if (f.x >= 0 && f.y >= 0 && f.x < WIDE && f.y < WIDE)
                if (STONE.includes(terrain[f.y * WIDE + f.x]))
                  terrain[f.y * WIDE + f.x] = Terrain.Grass;
        const neither: WideCase = {
          ...c,
          terrain,
          built: {
            ...c.built,
            buildings: (c.built.buildings ?? []).filter(([, , id]) => !buildingDef(id).bridge),
          },
        };
        const old = mapOfWide(neither);
        sequential(old, neither.built, BEFORE);
        const now = mapOfWide(neither);
        applyTileRepairs(now, repairBuiltTiles(now, neither.built));
        expect(firstDifference(now.terrain, old.terrain, WIDE), 'terrain').toBe('same');
      },
      { shrink: shrinkWide },
    );
  });

  it('differs from what the game did before only under a platform, under track on stone, and under track where a platform off the map has its index', () => {
    // and on such a tile, the old rules gave it water or grass
    forAll(
      genWide,
      (c) => {
        const old = mapOfWide(c);
        sequential(old, c.built, BEFORE);
        const now = mapOfWide(c);
        applyTileRepairs(now, repairBuiltTiles(now, c.built));
        const platforms = new Set<number>();
        for (const [x, y, id] of c.built.buildings ?? [])
          if (buildingDef(id).bridge && x >= 0 && y >= 0 && x < WIDE && y < WIDE)
            platforms.add(y * WIDE + x);
        // track on stone, and track on a tile whose index a platform off the map has, which the
        // old body took for a platform's tile
        const aliased = aliasedPlatforms(c.built, WIDE);
        const stoneRails = new Set<number>(),
          aliasedRails = new Set<number>();
        for (const [x, y, kind, rot, cls] of c.built.track)
          if (kind !== 'bridge')
            for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
              if (f.x >= 0 && f.y >= 0 && f.x < WIDE && f.y < WIDE) {
                const i = f.y * WIDE + f.x;
                if (STONE.includes(c.terrain[i])) stoneRails.add(i);
                if (aliased.has(i)) aliasedRails.add(i);
              }
        for (let i = 0; i < WIDE * WIDE; i++) {
          if (now.terrain[i] === old.terrain[i]) continue;
          const where = `tile ${i % WIDE},${Math.floor(i / WIDE)}`;
          expect(platforms.has(i) || stoneRails.has(i) || aliasedRails.has(i), where).toBe(true);
          expect([Terrain.Water, Terrain.Grass], where).toContain(old.terrain[i]);
        }
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
    roads: b.roads.toJSON(),
  };
}

describe('the repair and the builder', () => {
  it('refuse the same ground for each kind of object', () => {
    // the sets this file uses (NO_LAND, NO_PLATFORM) are the builder's: a tile is repaired exactly
    // where the builder would have refused what stands on it. The builder's refusal for the ground
    // names it, one line per terrain (`unbuildable` in src/sim/build.ts); every other reason is one
    // the repair has nothing to do with
    const groundRefusals: readonly string[] = Object.values(STR.build.nothingOn);
    for (const t of ALL) {
      const { map, builder } = builderOn(t);
      const named = (STR.build.nothingOn as Record<string, string | undefined>)[name(t)];
      // every one refused for the ground, with this ground named, or none of them
      const reasons = (list: (string | undefined)[]) => {
        const ground = list.map((r) => r !== undefined && groundRefusals.includes(r));
        expect(new Set(ground).size, `${name(t)}: ${list.join(' | ')}`).toBe(1);
        if (ground[0])
          expect(list, `the ground named on ${name(t)}`).toEqual(list.map(() => named));
        return ground[0];
      };
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
      // track: water is in its way until a platform carries it. A lone straight on rock or a
      // mountain is refused for how it is drawn, which is not the ground's: continuing a line, it
      // is taken there (#322)
      const along = { kind: 'straight', cls: 'regular' } as const;
      const lone = builder.checkTrack(4, 4, along, 1).reason;
      expect(lone, `a lone straight on ${name(t)}`).toBe(
        t === Terrain.Water
          ? STR.build.needBridge
          : STONE.includes(t)
            ? STR.build.mountainLine
            : undefined,
      );
      expect(groundRefusals, `a lone straight on ${name(t)}`).not.toContain(lone);
      map.terrain[4 * map.w + 3] = Terrain.Grass;
      expect(builder.placeTrack(3, 4, along, 1), `the line's end beside ${name(t)}`).toBe(true);
      const rail = builder.checkTrack(4, 4, along, 1);
      expect(rail.reason === STR.build.needBridge, `track on ${name(t)}`).toBe(
        NO_RAILS.includes(t),
      );
      expect(rail.ok, `track on ${name(t)}`).toBe(!NO_RAILS.includes(t));
      if (!rail.ok) continue;
      // a signal stands on it wherever it stands, and a power pole only where land does
      expect(builder.placeTrack(4, 4, along, 1)).toBe(true);
      expect(builder.checkDecor(4, 4, 'signal').ok, `signal on ${name(t)}`).toBe(true);
      const pole = builder.checkDecor(4, 4, 'power_line').reason;
      expect(reasons([pole]), `power pole on the track on ${name(t)}`).toBe(NO_LAND.includes(t));
    }
  });

  /** One thing the player does with the builder, in the order the case lists them. */
  type Move =
    | { do: 'track'; x: number; y: number; kind: TrackKind; rot: number; cls: TrackClass }
    | { do: 'works'; x: number; y: number; id: string }
    | { do: 'station'; x: number; y: number; id: string; rot: number }
    | { do: 'decor'; x: number; y: number; id: string; rot: number }
    | { do: 'bridge'; x: number; y: number; id: string }
    // straights one after another from (x, y), along x (rot 1) or y (rot 0), forward or back
    | {
        do: 'line';
        x: number;
        y: number;
        rot: 0 | 1;
        step: 1 | -1;
        length: number;
        cls: TrackClass;
      }
    // a signal on, or the removal of the piece on, the track tile the builder holds `pick`-th
    // (counted round its tiles), if it holds any
    | { do: 'signal'; pick: number; rot: number }
    | { do: 'remove'; pick: number };
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
        rng.pick([
          'track',
          'track',
          'works',
          'station',
          'decor',
          'bridge',
          'bridge',
          'line',
          'line',
          'signal',
          'signal',
          'remove',
          'remove',
        ] as const)
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
        case 'line':
          return {
            do: 'line',
            x,
            y,
            rot: rng.pick([0, 1] as const),
            step: rng.pick([1, -1] as const),
            length: rng.int(2, 8),
            cls: rng.pick(TRACK_CLASSES),
          };
        case 'signal':
          return { do: 'signal', pick: rng.int(0, 1000), rot: rng.int(0, 3) };
        case 'remove':
          return { do: 'remove', pick: rng.int(0, 1000) };
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
    const held = (pick: number) => {
      const tiles = [...builder.track.tiles()];
      return tiles.length ? tiles[pick % tiles.length] : null;
    };
    for (const m of c.moves) {
      if (m.do === 'track') builder.placeTrack(m.x, m.y, { kind: m.kind, cls: m.cls }, m.rot);
      else if (m.do === 'works') builder.placeBuilding(m.x, m.y, m.id);
      else if (m.do === 'station') builder.placeStation(m.x, m.y, m.id, m.rot);
      else if (m.do === 'decor') builder.placeDecor(m.x, m.y, m.id, m.rot);
      else if (m.do === 'line')
        for (let k = 0; k < m.length; k++) {
          const d = k * m.step;
          builder.placeTrack(
            m.x + (m.rot === 1 ? d : 0),
            m.y + (m.rot === 0 ? d : 0),
            { kind: 'straight', cls: m.cls },
            m.rot,
          );
        }
      else if (m.do === 'signal') {
        const t = held(m.pick);
        if (t) builder.placeDecor(t.x, t.y, 'signal', m.rot);
      } else if (m.do === 'remove') {
        const t = held(m.pick);
        if (t) builder.removeTrack(t.x, t.y);
      }
      // a bridge: the platform, then the rail on it
      else if (builder.placeBuilding(m.x, m.y, m.id))
        builder.placeTrack(m.x, m.y, { kind: 'straight', cls: 'regular' }, 1);
    }
    return { map, builder };
  }
  /** Does the piece covering (x, y) open onto a neighbour that opens back toward it? */
  function joined(track: TrackGraph, x: number, y: number) {
    const tiles = track.unitTiles(x, y);
    return tiles.some((t) =>
      (track.get(t.x, t.y)?.links ?? []).some((link) =>
        link.some((d) => {
          const nx = t.x + DIR_DX[d],
            ny = t.y + DIR_DY[d];
          if (tiles.some((q) => q.x === nx && q.y === ny)) return false;
          return track.opensTo(nx, ny, opposite(d));
        }),
      ),
    );
  }

  it('leaves everything the builder let the player place exactly where it stands', () => {
    // a repair that changes ground the builder allowed would break what the player built: this is
    // the failure #288 found (a platform on land, forced to water), for every object and terrain,
    // and mountain track (#322): a line run on across rock and a mountain, a signal on it, and a
    // piece whose line was taken away or rebuilt around it, which the builder would not lay there
    // again but leaves standing
    const seen = { onWater: 0, onLand: 0, railedOnWater: 0, railedOnLand: 0, other: 0 };
    const stone = { rails: 0, signals: 0, alone: 0 };
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
        for (const { x, y } of builder.track.tiles())
          if (STONE.includes(at(map, x, y))) {
            stone.rails++;
            if (!joined(builder.track, x, y)) stone.alone++;
            if (builder.decorAt(x, y)?.id === 'signal') stone.signals++;
          }
      },
      { shrink: shrinkScene },
    );
    // the seeds reach platforms across a dip in the land and over water, with and without a rail,
    // and the other things a builder places
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
    // and track on rock and a mountain, signals on it, and stone pieces joined to no line
    expect(stone.rails, 'stone rails').toBeGreaterThan(100);
    expect(stone.signals, 'signals on stone').toBeGreaterThan(20);
    expect(stone.alone, 'stone pieces alone').toBeGreaterThan(15);
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
    // the halt covers two tiles, the second one south of the first
    const secondBad = NO_LAND.includes(at(m, water[0], water[1] + 1));
    const repairs = repaired(
      m,
      only({
        stations: [station('big_farm', water[0], water[1])],
        buildings: [
          works(grass[0], grass[1], 'bridge_wood'),
          works(rock[0], rock[1], 'bridge_stone'),
        ],
      }),
    );
    // the repair was done: the platform on grass kept its grass, the others were given ground (the
    // halt's second tile too, when it stood on water, rock or mountain as well)
    expect(repairs.length).toBe(secondBad ? 3 : 2);
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

// ---------------------------------------------------------------- roads

/** A road tile as a save holds it. */
const road = (x: number, y: number): [number, number] => [x, y];
const keys = (list: readonly { x: number; y: number }[]) => list.map((r) => `${r.x},${r.y}`);
/** The roads of a save as a test makes it up, whatever shape: a corrupt file holds odd entries. */
const roadsOf = (list: unknown): BuiltObjects['roads'] => list as BuiltObjects['roads'];

describe('a road on ground that cannot hold one', () => {
  it('is tried on every ground there is', () => {
    // a ground added to the game is one more for the tests below to try, not one they miss
    expect([...ALL].sort()).toEqual(TERRAIN_NAMES.map((_, t) => t));
    expect(NO_LAND.every((t) => ALL.includes(t as (typeof ALL)[number]))).toBe(true);
  });

  it('is taken off exactly where the ground is water, rock or a mountain', () => {
    for (const t of ALL) {
      const m = flat(t);
      const built = only({ roads: [road(4, 4)] });
      expect(keys(repairBuiltRoads(m, built)), name(t)).toEqual(NO_LAND.includes(t) ? ['4,4'] : []);
      // the ground is not bent for a road: it goes instead
      expect(repairBuiltTiles(m, built), name(t)).toEqual([]);
    }
  });

  it('is taken off where the builder would not lay a road, and kept where it would', () => {
    for (const t of ALL) {
      const { map, builder } = builderOn(t);
      const refusal = builder.checkRoad(4, 4);
      const lost = repairBuiltRoads(map, only({ roads: [road(4, 4)] })).length > 0;
      expect(lost, `${name(t)}: ${refusal.reason}`).toBe(!refusal.ok);
      if (lost)
        expect(refusal.reason, name(t)).toBe(
          (STR.build.nothingOn as Record<string, string | undefined>)[name(t)],
        );
      else {
        // and a road the builder laid is a road the repair leaves
        expect(builder.placeRoad(4, 4), name(t)).toBe(true);
        expect(repairBuiltRoads(map, builtOf(builder)), name(t)).toEqual([]);
      }
    }
  });

  it('is the only road to go: every other stays, and those that go are listed once, in the order saved', () => {
    const m = flat(Terrain.Grass);
    // row 2: water, rock and a mountain among the land a road may stand on
    set(m, 1, 2, Terrain.Water);
    set(m, 3, 2, Terrain.Water);
    set(m, 5, 2, Terrain.Rock);
    set(m, 7, 2, Terrain.Mountain);
    set(m, 2, 2, Terrain.Hill);
    set(m, 4, 2, Terrain.Forest);
    set(m, 6, 2, Terrain.Sand);
    set(m, 8, 5, Terrain.Water); // no road is saved here
    const row = Array.from({ length: m.w }, (_, x) => road(x, 2)).reverse();
    const built = only({ roads: [...row, road(5, 2), road(1, 2), road(0, 5)] });
    expect(keys(repairBuiltRoads(m, built))).toEqual(['7,2', '5,2', '3,2', '1,2']);
    // the map was only read
    expect(at(m, 5, 2)).toBe(Terrain.Rock);
    expect(at(m, 1, 2)).toBe(Terrain.Water);
    // asked of the map the repair has been applied to, it answers the same
    repaired(m, built);
    expect(keys(repairBuiltRoads(m, built))).toEqual(['7,2', '5,2', '3,2', '1,2']);
  });

  it('is judged on the ground the repair leaves under it, where other things were built', () => {
    // a line of track over water: the repair makes its tiles land, a level crossing's among them,
    // and a signal's tile too; the water beside them stays water
    const m = flat(Terrain.Water);
    const built = only({
      track: [straight(3, 4), straight(4, 4), straight(5, 4)],
      decor: [[2, 6, 'signal', 0]],
      roads: [road(4, 4), road(4, 3), road(4, 5), road(2, 6)],
    });
    expect(keys(repairBuiltRoads(m, built))).toEqual(['4,3', '4,5']);
    expect(keys(repairBuiltTiles(m, built))).toEqual(['3,4', '4,4', '5,4', '2,6']);
    // and a line on rock or a mountain keeps its ground, so a road across it goes
    for (const t of STONE) {
      const stone = flat(t);
      for (const x of [3, 5]) set(stone, x, 4, Terrain.Grass);
      const crossing = only({
        track: [straight(3, 4), straight(4, 4), straight(5, 4)],
        roads: [road(4, 4)],
      });
      expect(repairBuiltTiles(stone, crossing), name(t)).toEqual([]);
      expect(keys(repairBuiltRoads(stone, crossing)), name(t)).toEqual(['4,4']);
      // the builder agrees: it lays no road there
      const { map, builder } = builderOn(t);
      set(map, 3, 4, Terrain.Grass);
      set(map, 5, 4, Terrain.Grass);
      const along = { kind: 'straight', cls: 'regular' } as const;
      for (const x of [3, 4, 5])
        expect(builder.placeTrack(x, 4, along, 1), `${name(t)} ${x}`).toBe(true);
      expect(builder.checkRoad(4, 4).ok, name(t)).toBe(false);
    }
  });

  it('keeps a level crossing on land, as the builder lays one there', () => {
    const { map, builder } = builderOn(Terrain.Grass);
    const along = { kind: 'straight', cls: 'regular' } as const;
    for (const x of [3, 4, 5]) expect(builder.placeTrack(x, 4, along, 1)).toBe(true);
    expect(builder.placeRoad(4, 4)).toBe(true);
    expect(builder.roads.crossingKeys().size).toBe(1);
    expect(repairBuiltRoads(map, builtOf(builder))).toEqual([]);
  });

  it('stays on a bridge platform with no rail, on water as on land, and goes off one with rail (#493)', () => {
    for (const t of [Terrain.Water, Terrain.Grass, ...STONE]) {
      const m = flat(t);
      const built = only({
        track: [straight(6, 4)],
        buildings: [works(4, 4, 'bridge_wood'), works(6, 4, 'bridge_stone')],
        roads: [road(4, 4), road(6, 4)],
      });
      expect(keys(repairBuiltRoads(m, built)), name(t)).toEqual(['6,4']);
      // a road on the same ground with no platform under it goes by the ground alone
      const bare = only({ roads: [road(4, 4)] });
      expect(keys(repairBuiltRoads(m, bare)), name(t)).toEqual(NO_LAND.includes(t) ? ['4,4'] : []);
    }
    // a road the builder laid on a platform over water is a road the repair leaves
    const { map, builder } = builderOn(Terrain.Water);
    expect(builder.placeBuilding(4, 4, 'bridge_wood')).not.toBeNull();
    expect(builder.placeRoad(4, 4)).toBe(true);
    expect(repairBuiltRoads(map, builtOf(builder))).toEqual([]);
    expect(repairBuiltTiles(map, builtOf(builder))).toEqual([]);
  });

  it('skips what a load skips, and answers nothing for a save with no road list', () => {
    const m = flat(Terrain.Rock);
    const odd = roadsOf([
      road(9, 9),
      road(-1, 0),
      // off the side of a 9 wide map, where the index `y * w + x` lands on a tile of the next row
      // or the one before: a check on the index alone would take them for roads on 0,1 and 8,0
      road(9, 0),
      road(-1, 1),
      [1.5, 2],
      // two halves that add up to a whole index on a 9 wide map (0.5 * 9 + 0.5 = 5, a rock tile):
      // a check on the index alone would take this for a road on tile 5,0
      [0.5, 0.5],
      [Number.NaN, 4],
      [4, Number.POSITIVE_INFINITY],
      ['3', 4],
      [5],
      [],
      null,
      { x: 1 },
      'road',
      road(4, 4),
      [4, 4, 9],
      road(4, 4),
    ]);
    expect(keys(repairBuiltRoads(m, only({ roads: odd })))).toEqual(['4,4']);
    // what a load skips is what `Roads.load` skips: the one road it keeps is the one that goes
    const kept = new Roads(new TrackGraph(m.w, m.h));
    kept.load(odd);
    expect(keys(kept.list())).toEqual(['4,4']);
    for (const none of [undefined, null, 5, 'roads', { 0: [4, 4] }, []])
      expect(repairBuiltRoads(m, only({ roads: roadsOf(none) })), String(none)).toEqual([]);
    expect(repairBuiltRoads(m, only({}))).toEqual([]);
  });

  it('goes, in any scene, exactly where the ground the repair leaves refuses a road', () => {
    const seen = { gone: 0, kept: 0, landMade: 0, keptOnDeck: 0, goneOffRail: 0 };
    forAll(
      (rng) => {
        const c = genCase(rng);
        const tiles = c.built.track.flatMap(([x, y, kind, rot, cls]) =>
          footprintOf(x, y, kind, rot, cls ?? 'regular'),
        );
        const decks = (c.built.buildings ?? [])
          .filter(([, , id]) => buildingDef(id).bridge)
          .map(([x, y]) => ({ x, y }));
        // roads on the track's tiles (crossings) and on bridge platforms as well as anywhere, and
        // a corrupt entry now and then
        const roads: unknown[] = Array.from({ length: rng.int(0, 16) }, () => {
          const at2 = { x: rng.int(-1, SIZE), y: rng.int(-1, SIZE) };
          const { x, y } =
            rng.chance(0.4) && tiles.length
              ? rng.pick(tiles)
              : rng.chance(0.5) && decks.length
                ? rng.pick(decks)
                : at2;
          return rng.chance(0.1) ? [x + 0.5, y] : [x, y];
        });
        if (roads.length && rng.chance(0.3)) roads.push(rng.pick(roads));
        return { ...c, built: { ...c.built, roads: roadsOf(roads) } };
      },
      (c) => {
        const m = flat(Terrain.Grass, SIZE, SIZE);
        m.terrain.set(c.terrain);
        const was = Uint8Array.from(m.terrain);
        const builtWas = structuredClone(c.built);
        const lost = repairBuiltRoads(m, c.built);
        // asking reads the map and the save and changes neither
        expect([...m.terrain]).toEqual([...was]);
        expect(c.built).toEqual(builtWas);
        // the roads do not change the ground the repair gives the other things built
        const tiles = repairBuiltTiles(m, c.built);
        expect(repairBuiltTiles(m, { ...c.built, roads: [] })).toEqual(tiles);
        applyTileRepairs(m, tiles);
        // asked again, of the repaired map, it answers the same
        expect(repairBuiltRoads(m, c.built)).toEqual(lost);

        // the roads a load keeps: whole tiles on the map, once each, in the order saved
        const loaded = new Roads(new TrackGraph(SIZE, SIZE));
        loaded.load(c.built.roads);
        const saved = loaded.list();
        // a bridge platform carries a road where it carries no rail (#493), whatever the ground
        const on = (list: readonly { x: number; y: number }[], x: number, y: number) =>
          list.some((t) => t.x === x && t.y === y);
        const rails = c.built.track.flatMap(([x, y, kind, rot, cls]) =>
          footprintOf(x, y, kind, rot, cls ?? 'regular'),
        );
        const decks = (c.built.buildings ?? [])
          .filter(([, , id]) => buildingDef(id).bridge)
          .map(([x, y]) => ({ x, y }));
        const goes = (x: number, y: number) =>
          on(decks, x, y) ? on(rails, x, y) : unbuildable(at(m, x, y)) !== null;
        for (const { x, y } of saved)
          if (on(decks, x, y)) seen[on(rails, x, y) ? 'goneOffRail' : 'keptOnDeck']++;
          else if (goes(x, y)) seen.gone++;
          else {
            seen.kept++;
            if (NO_LAND.includes(c.terrain[y * SIZE + x])) seen.landMade++;
          }
        // the ones that go are those the builder would refuse for the ground they stand on now,
        // or for the rail on their platform, each once and in the order saved, and no other
        const refused = saved.filter(({ x, y }) => goes(x, y));
        expect(keys(lost)).toEqual(keys(refused));
      },
      { shrink: shrinkRoadCase },
    );
    // the seeds reach roads taken off, roads left, roads left on ground made land for another, and
    // roads on platforms, kept where no rail is and taken off the rail; a platform with rail under
    // a saved road is the rarest of them
    const { goneOffRail, ...rest } = seen;
    for (const [what, n] of Object.entries(rest)) expect(n, what).toBeGreaterThan(10);
    expect(goneOffRail, 'goneOffRail').toBeGreaterThan(3);
  });
});
