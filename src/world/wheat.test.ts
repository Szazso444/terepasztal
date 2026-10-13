import { describe, it, expect } from 'vitest';
import {
  generateMap,
  decorateProps,
  placeOilFields,
  ensureStartDeposits,
  DEFAULT_MAP_PARAMS,
  type MapGenParams,
} from './mapgen';
import {
  CHUNK_TILES,
  buildMap,
  chunkKey,
  chunkOf,
  mapChunks,
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { Biome, Terrain, startRegion, type GameMap, type PropInstance } from './tiles';
import { Rng } from '../engine/rng';
import type { SupplyMode } from '../sim/supply';
import { RULE_META } from '../sim/rules';
import { forAll, shrinkInt } from '../testing/property';

// Wheat fields (#310): generateMap grows them on plains grass, about 1 % of it, at most two to a
// world chunk and never across a chunk's edge, out of the start chunk's centre and out from under
// the full chain's oil, in world space; a world stored before they existed keeps its chunks
// without them.

const isWheat = (list: PropInstance[] | undefined) => !!list?.some((p) => p.kind === 'wheat');
/** The variant of the wheat on map tile `i`, or 'none'. */
const wheatAt = (m: GameMap, i: number) =>
  m.props.get(i)?.find((p) => p.kind === 'wheat')?.variant ?? 'none';
/** Map tile indices of the wheat tiles, in tile order. */
const wheatOf = (m: GameMap) =>
  [...m.props]
    .filter(([, list]) => isWheat(list))
    .map(([i]) => i)
    .sort((a, b) => a - b);
/** The oil tiles with their props, in tile order. */
const oilOf = (m: GameMap) =>
  [...m.props].filter(([, list]) => list.some((p) => p.kind === 'oil')).sort(([a], [b]) => a - b);
/** The wheat tiles with their variants, in tile order. */
const wheatWithVariants = (m: GameMap) => wheatOf(m).map((i) => [i, wheatAt(m, i)]);
/** Tiles of Grass in the Plains biome, wheat tiles included. */
function plainsGrass(m: GameMap) {
  let n = 0;
  for (let i = 0; i < m.w * m.h; i++)
    if (m.terrain[i] === Terrain.Grass && m.biome[i] === Biome.Plains) n++;
  return n;
}
/** The 4-connected pieces of wheat, each as its map tile indices. */
function wheatPieces(m: GameMap): number[][] {
  const seen = new Set<number>();
  const pieces: number[][] = [];
  for (const start of wheatOf(m)) {
    if (seen.has(start)) continue;
    const piece = [start];
    seen.add(start);
    for (let k = 0; k < piece.length; k++) {
      const x = piece[k] % m.w;
      const y = Math.floor(piece[k] / m.w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (!seen.has(j) && isWheat(m.props.get(j))) {
          seen.add(j);
          piece.push(j);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}
/** The world chunk of map tile `i`, as its key. */
const chunkOfTile = (m: GameMap, i: number) =>
  chunkKey(chunkOf(m.originX + (i % m.w)), chunkOf(m.originY + Math.floor(i / m.w)));
/**
 * The fields of `m` as a player sees them, the 4-connected pieces of wheat: each in one chunk, of
 * 4 to 9 tiles (or two such fields that touch), and at most two to a chunk.
 */
function expectFields(m: GameMap, at: string) {
  const fields = new Map<string, number>();
  for (const piece of wheatPieces(m)) {
    const chunks = new Set(piece.map((i) => chunkOfTile(m, i)));
    const where = `${at}, a field at tile ${piece[0]}`;
    // a field never crosses a chunk's edge
    expect(chunks.size, where).toBe(1);
    // 4 to 9 tiles, or two such fields that touch
    expect(piece.length, where).toBeGreaterThanOrEqual(4);
    expect(piece.length, where).toBeLessThanOrEqual(18);
    const [chunk] = chunks;
    fields.set(chunk, (fields.get(chunk) ?? 0) + 1);
  }
  for (const [chunk, n] of fields) expect(n, `${at}, chunk ${chunk}`).toBeLessThanOrEqual(2);
}
/** Whether map tile `i` lies in the start chunk, where the seeps go. */
function inStartChunk(m: GameMap, i: number) {
  const { rx, ry } = startRegion(m);
  return Math.floor((i % m.w) / m.regionSize) === rx && Math.floor(i / m.w / m.regionSize) === ry;
}
/** Whether map tile `i` has oil on one of its 4 sides. */
const besideOil = (m: GameMap, i: number) =>
  [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => {
    const x = (i % m.w) + dx;
    const y = Math.floor(i / m.w) + dy;
    return (
      x >= 0 &&
      y >= 0 &&
      x < m.w &&
      y < m.h &&
      !!m.props.get(y * m.w + x)?.some((p) => p.kind === 'oil')
    );
  });

/** A map's frame, sliders and chain: any size from a chunk up, any origin, either chain. */
interface WorldCase {
  seed: number;
  full: boolean;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sliders: Pick<MapGenParams, 'waterLevel' | 'hillLevel' | 'rockLevel' | 'forestDensity'>;
}
const DEFAULT_SLIDERS = {
  waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
  hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
  rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
  forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
};
function genWorld(rng: Rng): WorldCase {
  return {
    seed: rng.int(0, 2 ** 31 - 1),
    full: rng.chance(0.5),
    w: rng.int(CHUNK_TILES, 4 * CHUNK_TILES),
    h: rng.int(CHUNK_TILES, 4 * CHUNK_TILES),
    ox: rng.chance(0.5) ? -CHUNK_TILES * rng.int(0, 2) : rng.int(-100, 100),
    oy: rng.chance(0.5) ? -CHUNK_TILES * rng.int(0, 2) : rng.int(-100, 100),
    sliders: {
      waterLevel: rng.int(10, 60) / 100,
      hillLevel: rng.int(45, 90) / 100,
      rockLevel: rng.int(50, 100) / 100,
      forestDensity: rng.int(30, 90) / 100,
    },
  };
}
/** Toward the simple chain, default sliders, origin 0 and the smallest map. */
function* shrinkWorld(c: WorldCase): Iterable<WorldCase> {
  if (c.full) yield { ...c, full: false };
  if (JSON.stringify(c.sliders) !== JSON.stringify(DEFAULT_SLIDERS))
    yield { ...c, sliders: DEFAULT_SLIDERS };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
  for (const w of shrinkInt(c.w, CHUNK_TILES)) yield { ...c, w };
  for (const h of shrinkInt(c.h, CHUNK_TILES)) yield { ...c, h };
}
const chainOf = (full: boolean): SupplyMode => (full ? 'full' : 'simple');
const worldMap = (c: WorldCase) =>
  generateMap(
    c.seed,
    { ...c.sliders, w: c.w, h: c.h, originX: c.ox, originY: c.oy },
    chainOf(c.full),
  );
const WORLD_SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

const SLIDERS = ['waterLevel', 'hillLevel', 'rockLevel', 'forestDensity'] as const;
/** Every combination of the Map sliders' ends, as the tuning screen bounds them: 16 of them. */
function sliderEnds() {
  const ends = SLIDERS.map((key) => {
    const meta = RULE_META.find((m) => m.key === key)!;
    return [meta.min, meta.max];
  });
  return Array.from(
    { length: 2 ** SLIDERS.length },
    (_, k) =>
      Object.fromEntries(SLIDERS.map((key, b) => [key, ends[b][(k >> b) & 1]])) as Record<
        (typeof SLIDERS)[number],
        number
      >,
  );
}

/** The 20 worlds the acceptance criteria measure: 160 x 160, default sliders, simple chain. */
const DENSITY_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
let densityWorlds: GameMap[] | null = null;
const defaultWorlds = () =>
  (densityWorlds ??= DENSITY_SEEDS.map((s) => generateMap(s, { w: 160, h: 160 }, 'simple')));

describe('wheat fields', () => {
  // 24 maps up to 128 tiles a side: about 0.4 s alone
  it('grow on Grass in the Plains biome only, as the tile’s only prop, in variants 0 to 2', () => {
    let wheat = 0;
    let otherGrass = 0;
    forAll(
      genWorld,
      (c) => {
        const m = worldMap(c);
        for (let i = 0; i < m.w * m.h; i++)
          if (m.terrain[i] === Terrain.Grass && m.biome[i] !== Biome.Plains) otherGrass++;
        for (const i of wheatOf(m)) {
          wheat++;
          const where = `tile (${i % m.w}, ${Math.floor(i / m.w)})`;
          expect(m.terrain[i], where).toBe(Terrain.Grass);
          expect(m.biome[i], where).toBe(Biome.Plains);
          const list = m.props.get(i)!;
          expect(list, where).toHaveLength(1);
          expect([0, 1, 2], where).toContain(list[0].variant);
          expect([list[0].ox, list[0].oy], where).toEqual([0, 0]);
        }
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld },
    );
    // fields grew, and grass of the other biomes was there to refuse them
    expect(wheat).toBeGreaterThan(0);
    expect(otherGrass).toBeGreaterThan(0);
  }, 20_000);

  // 20 maps of 160 x 160: about 0.6 s alone
  it('cover 0.5 to 1.5 % of plains grass over 20 worlds at 160 x 160, at most two fields a chunk', () => {
    let wheat = 0;
    let grass = 0;
    for (const [k, m] of defaultWorlds().entries()) {
      wheat += wheatOf(m).length;
      grass += plainsGrass(m);
      expectFields(m, `seed ${DENSITY_SEEDS[k]}`);
    }
    expect(wheat / grass).toBeGreaterThanOrEqual(0.005);
    expect(wheat / grass).toBeLessThanOrEqual(0.015);
  }, 15_000);

  // the 20 maps above, generated here when this test runs alone: about 0.6 s
  it('keep out of the start chunk’s centre, where the first buildings go', () => {
    let startWheat = 0;
    for (const [k, m] of defaultWorlds().entries()) {
      const { rx, ry } = startRegion(m);
      const cx = rx * m.regionSize + m.regionSize / 2;
      const cy = ry * m.regionSize + m.regionSize / 2;
      for (const i of wheatOf(m)) {
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        if (chunkOfTile(m, i) === chunkKey(rx, ry)) startWheat++;
        expect(
          Math.hypot(x - cx, y - cy),
          `seed ${DENSITY_SEEDS[k]}, tile (${x}, ${y})`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
    // the start chunk itself grows fields, away from its centre
    expect(startWheat).toBeGreaterThan(0);
  }, 15_000);

  // 16 pairs of maps up to 256 tiles a side: about 1 s alone
  it('are the same wherever the map ends: a grown or wider map keeps every field', () => {
    let edge = 0;
    let wheat = 0;
    forAll(
      (rng) => {
        const small = genWorld(rng);
        // the big map holds the small one and keeps its start chunk on the same world tiles
        const ring = rng.int(1, 2);
        return { small, ring };
      },
      ({ small, ring }) => {
        const a = worldMap(small);
        const b = worldMap({
          ...small,
          w: small.w + 2 * CHUNK_TILES * ring,
          h: small.h + 2 * CHUNK_TILES * ring,
          ox: small.ox - CHUNK_TILES * ring,
          oy: small.oy - CHUNK_TILES * ring,
        });
        const dx = a.originX - b.originX;
        const dy = a.originY - b.originY;
        for (let y = 0; y < a.h; y++)
          for (let x = 0; x < a.w; x++) {
            const here = wheatAt(a, y * a.w + x);
            const there = wheatAt(b, (y + dy) * b.w + x + dx);
            const at = `world tile (${x + a.originX}, ${y + a.originY})`;
            expect(here, at).toBe(there);
            if (here === 'none') continue;
            wheat++;
            // within a field's reach of the small map's edge
            if (Math.min(x, y, a.w - 1 - x, a.h - 1 - y) < 2) edge++;
          }
      },
      {
        seeds: Array.from({ length: 16 }, (_, i) => i + 1),
        shrink: function* (c) {
          for (const small of shrinkWorld(c.small)) yield { ...c, small };
          if (c.ring > 1) yield { ...c, ring: 1 };
        },
      },
    );
    // fields grew, some of them at the small map's edge, where a field can reach in from outside
    expect(wheat).toBeGreaterThan(0);
    expect(edge).toBeGreaterThan(0);
  }, 30_000);

  // In these worlds a field reaches in across the small map's edge beside where an oil field
  // could lie, out beyond the tiles the small map generates oil on: the field must keep off it in
  // both maps. They are the pairs a search of random frames found where fields kept off only the
  // oil a map generates; the first, since the rivers of #341 changed the worlds, is one a search
  // found with a field at the small map's edge and oil of the full chain within 2 tiles of it,
  // outside the map. 3 pairs of maps: about 0.2 s alone.
  it.each([
    { seed: 1637860701, w: 42, h: 71, ox: 36, oy: -2 },
    { seed: 1383765659, w: 78, h: 58, ox: 8, oy: -97 },
    { seed: 50341479, w: 67, h: 60, ox: 24, oy: 42 },
  ])(
    'are the same wherever the map ends, by oil just outside it (seed $seed, $w x $h at $ox, $oy)',
    ({ seed, w, h, ox, oy }) => {
      const small = { seed, full: false, w, h, ox, oy, sliders: DEFAULT_SLIDERS };
      const a = worldMap(small);
      const b = worldMap({ ...small, w: w + 64, h: h + 64, ox: ox - 32, oy: oy - 32 });
      let edge = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const here = wheatAt(a, y * w + x);
          expect(here, `world tile (${x + ox}, ${y + oy})`).toBe(
            wheatAt(b, (y + 32) * b.w + x + 32),
          );
          if (here !== 'none' && Math.min(x, y, w - 1 - x, h - 1 - y) < 2) edge++;
        }
      // a field lies within a field's reach of the small map's edge
      expect(edge).toBeGreaterThan(0);
    },
  );
});

describe('wheat fields and stored chunks', () => {
  /** generateMap of a chain as it was before the fields: the same map with the wheat taken off. */
  const withoutWheat =
    (chain: SupplyMode): MapGenerator =>
    (s, p) => {
      const m = generateMap(s, p, chain);
      for (const i of wheatOf(m)) m.props.delete(i);
      return m;
    };
  const generateChain =
    (chain: SupplyMode): MapGenerator =>
    (s, p) =>
      generateMap(s, p, chain);
  /** Whether world tile (`wx`, `wy`) lies in a chunk of `store`. */
  const inStore = (store: ChunkStore, wx: number, wy: number) =>
    Object.hasOwn(store, chunkKey(chunkOf(wx), chunkOf(wy)));

  // 6 worlds stored at 96 x 96 and grown to 160 x 160, each built three times: about 1.1 s alone
  it('loads a world stored before the fields without them, and grows them only in chunks generated later', () => {
    let grown = 0;
    for (const seed of [1, 7412, 20260912])
      for (const chain of ['simple', 'full'] as const) {
        const at = `seed ${seed}, ${chain} chain`;
        const params = { w: 96, h: 96 };
        const old = buildMap(seed, params, {}, withoutWheat(chain));
        expect(wheatOf(old.map), at).toEqual([]);
        // the stored world loads as it was stored: no chunk generated, no field anywhere
        const loaded = buildMap(seed, params, old.chunks, generateChain(chain));
        expect(loaded.added, at).toEqual([]);
        expect(wheatOf(loaded.map), at).toEqual([]);
        // grown by a ring: the stored chunks keep their text and stay bare, the new ring is
        // today's generation, wheat included
        const big = { w: 160, h: 160, originX: -32, originY: -32 };
        const built = buildMap(seed, big, old.chunks, generateChain(chain));
        for (const [k, text] of Object.entries(old.chunks)) expect(built.chunks[k], at).toBe(text);
        expect(built.added, at).toEqual(
          mapChunks(big)
            .map((c) => chunkKey(c.cx, c.cy))
            .filter((k) => !Object.hasOwn(old.chunks, k)),
        );
        const now = generateMap(seed, big, chain);
        for (let i = 0; i < built.map.w * built.map.h; i++) {
          const wx = built.map.originX + (i % built.map.w);
          const wy = built.map.originY + Math.floor(i / built.map.w);
          const here = isWheat(built.map.props.get(i));
          if (inStore(old.chunks, wx, wy))
            expect(here, `${at}: stored tile (${wx}, ${wy})`).toBe(false);
          else {
            expect(here, `${at}: new tile (${wx}, ${wy})`).toBe(isWheat(now.props.get(i)));
            if (here) grown++;
          }
        }
      }
    // the new chunks did grow fields
    expect(grown).toBeGreaterThan(0);
  }, 25_000);
});

describe('wheat fields, more widely', () => {
  // 24 maps up to 128 tiles a side, decorated a second time: about 1.1 s alone
  it('take the decoration off their own tiles only: every other tile keeps decorateProps’ or oil', () => {
    let wheat = 0;
    let replaced = 0;
    forAll(
      genWorld,
      (c) => {
        const m = worldMap(c);
        // the decorations alone, as decorateProps lays them on the map's own ground
        const bare: GameMap = { ...m, props: new Map() };
        decorateProps(bare, c.seed);
        for (let i = 0; i < m.w * m.h; i++) {
          const list = m.props.get(i);
          if (isWheat(list)) {
            wheat++;
            if (bare.props.has(i)) replaced++;
          } else if (!list?.some((p) => p.kind === 'oil'))
            expect(list, `tile (${i % m.w}, ${Math.floor(i / m.w)})`).toEqual(bare.props.get(i));
        }
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld },
    );
    // fields grew, some over a flower patch, a bush or an oak
    expect(wheat).toBeGreaterThan(0);
    expect(replaced).toBeGreaterThan(0);
  }, 25_000);

  // 24 maps up to 128 tiles a side: about 0.2 s alone
  it('keep out of the start chunk’s centre on any map size, origin, sliders and chain', () => {
    let near = 0;
    forAll(
      genWorld,
      (c) => {
        const m = worldMap(c);
        const { rx, ry } = startRegion(m);
        const cx = rx * m.regionSize + m.regionSize / 2;
        const cy = ry * m.regionSize + m.regionSize / 2;
        for (const i of wheatOf(m)) {
          const d = Math.hypot((i % m.w) - cx, Math.floor(i / m.w) - cy);
          expect(d, `tile (${i % m.w}, ${Math.floor(i / m.w)})`).toBeGreaterThanOrEqual(8);
          if (d < 16) near++;
        }
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld },
    );
    // fields grew close to the clearance, where a misplaced centre would let them in
    expect(near).toBeGreaterThan(0);
  }, 20_000);

  // the 20 maps the density test reads, generated here when this test runs alone: about 0.5 s
  it('draw all three variants, each on a fifth of the wheat tiles or more', () => {
    const variants = [0, 0, 0];
    for (const m of defaultWorlds())
      for (const i of wheatOf(m)) variants[m.props.get(i)![0].variant]++;
    const all = variants[0] + variants[1] + variants[2];
    for (const n of variants) expect(n / all).toBeGreaterThanOrEqual(0.2);
  }, 15_000);

  // 20 maps of 160 x 160: about 0.4 s alone
  it('cover 0.5 to 1.5 % of plains grass in the full chain too, at most two whole fields a chunk', () => {
    let wheat = 0;
    let grass = 0;
    let beside = 0;
    for (const seed of DENSITY_SEEDS) {
      const m = generateMap(seed, { w: 160, h: 160 }, 'full');
      wheat += wheatOf(m).length;
      grass += plainsGrass(m);
      // the fields the player sees, oil around them: none cut into pieces, none under 4 tiles
      expectFields(m, `seed ${seed}, full chain`);
      beside += wheatOf(m).filter((i) => besideOil(m, i)).length;
    }
    expect(wheat / grass).toBeGreaterThanOrEqual(0.005);
    expect(wheat / grass).toBeLessThanOrEqual(0.015);
    // oil lay right beside some fields, where it could have cut them
    expect(beside).toBeGreaterThan(0);
  }, 15_000);

  // 24 worlds up to 128 tiles a side, each in both chains: about 0.5 s alone
  it('never lie under oil: the full chain grows the simple chain’s fields, around its oil fields and start seeps', () => {
    let beside = 0;
    let besideStart = 0;
    forAll(
      genWorld,
      (c) => {
        const simple = worldMap({ ...c, full: false });
        const full = worldMap({ ...c, full: true });
        expect(wheatWithVariants(full)).toEqual(wheatWithVariants(simple));
        for (const i of wheatOf(full))
          if (besideOil(full, i)) {
            beside++;
            if (inStartChunk(full, i)) besideStart++;
          }
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld },
    );
    // oil lay right beside some fields, where it could have cut them, in a start chunk too
    expect(beside).toBeGreaterThan(0);
    expect(besideStart).toBeGreaterThan(0);
  }, 20_000);

  // The oil is laid as if the wheat were not there: the oil fields of every centre that reaches
  // the map, worked out here on the world a ring of chunks wider (placeOilFields on its ground,
  // its props taken off), then the start seeps on the map (ensureStartDeposits). No field lies on
  // that oil in either chain, the fields laid by centres beyond the map's edge included.
  // 24 worlds up to 128 tiles a side, each in both chains and a ring wider: about 1 s alone
  it('move no oil: the full chain lays the oil fields and start seeps of the world without wheat, and no field lies on them', () => {
    let outside = 0;
    let startFields = 0;
    let beside = 0;
    forAll(
      genWorld,
      (c) => {
        const simple = worldMap({ ...c, full: false });
        const full = worldMap({ ...c, full: true });
        const ring = worldMap({
          ...c,
          full: false,
          w: c.w + 2 * CHUNK_TILES,
          h: c.h + 2 * CHUNK_TILES,
          ox: c.ox - CHUNK_TILES,
          oy: c.oy - CHUNK_TILES,
        });
        const world: GameMap = { ...ring, props: new Map() };
        placeOilFields(world, c.seed, 'full');
        const want: GameMap = { ...simple, props: new Map() };
        for (const [j, list] of world.props) {
          const x = (j % world.w) - CHUNK_TILES;
          const y = Math.floor(j / world.w) - CHUNK_TILES;
          if (x >= 0 && y >= 0 && x < want.w && y < want.h) want.props.set(y * want.w + x, list);
        }
        // what a pass over the map alone lays, its centres 2 tiles or more inside the edge, to
        // count the oil of centres nearer the edge or beyond it
        const own: GameMap = { ...simple, props: new Map() };
        placeOilFields(own, c.seed, 'full');
        for (const i of want.props.keys()) {
          if (!own.props.has(i)) outside++;
          if (inStartChunk(want, i)) startFields++;
        }
        ensureStartDeposits(want, 'full');
        expect(oilOf(full)).toEqual(oilOf(want));
        for (const i of wheatOf(simple)) {
          expect(want.props.has(i), `tile (${i % want.w}, ${Math.floor(i / want.w)})`).toBe(false);
          if (besideOil(want, i)) beside++;
        }
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld },
    );
    // centres at or beyond the map's edge laid oil on it, oil fields lay in start chunks before
    // the seeps were counted, and fields grew right beside the oil, where they could lie on it
    expect(outside).toBeGreaterThan(0);
    expect(startFields).toBeGreaterThan(0);
    expect(beside).toBeGreaterThan(0);
  }, 20_000);

  // In these worlds the Water slider at its top leaves the start chunk's ring short of ground, so
  // the seeps reach out past it (#276) to where a field grows. 3 pairs of maps: about 0.1 s alone
  it.each([
    { seed: 14, size: 96 },
    { seed: 132, size: 96 },
    { seed: 209, size: 160 },
  ])(
    'never lie under a start seep that reaches past the ring (seed $seed at $size x $size, Water at its top)',
    ({ seed, size }) => {
      const water = RULE_META.find((m) => m.key === 'waterLevel')!.max;
      const params = { w: size, h: size, waterLevel: water };
      const simple = generateMap(seed, params, 'simple');
      const full = generateMap(seed, params, 'full');
      expect(wheatWithVariants(full)).toEqual(wheatWithVariants(simple));
      expectFields(full, `seed ${seed}, full chain`);
      // oil lies right beside a field of the start chunk, where a seep would have cut the field
      expect(wheatOf(full).some((i) => inStartChunk(full, i) && besideOil(full, i))).toBe(true);
    },
  );

  // 16 combinations of the Map sliders' ends, two worlds of 96 x 96 each: about 0.25 s alone
  it('grow on plains grass only, alone on their tiles, at every end of the Map sliders', () => {
    let wheat = 0;
    for (const sliders of sliderEnds())
      for (const seed of [1, 2]) {
        const m = generateMap(seed, { ...sliders, w: 96, h: 96 }, seed === 1 ? 'simple' : 'full');
        for (const i of wheatOf(m)) {
          wheat++;
          const at = `${JSON.stringify(sliders)}, seed ${seed}, tile ${i}`;
          expect([m.terrain[i], m.biome[i]], at).toEqual([Terrain.Grass, Biome.Plains]);
          expect(m.props.get(i), at).toHaveLength(1);
        }
      }
    expect(wheat).toBeGreaterThan(0);
  }, 15_000);
});
