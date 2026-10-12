import { describe, it, expect } from 'vitest';
import { generateMap, DEFAULT_MAP_PARAMS, type MapGenParams } from './mapgen';
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
import { forAll, shrinkInt } from '../testing/property';

// Wheat fields (#310): generateMap grows them on plains grass, about 1 % of it, at most two to a
// world chunk and never across a chunk's edge, out of the start chunk's centre, in world space;
// a world stored before they existed keeps its chunks without them.

const isWheat = (list: PropInstance[] | undefined) => !!list?.some((p) => p.kind === 'wheat');
/** Map tile indices of the wheat tiles, in tile order. */
const wheatOf = (m: GameMap) =>
  [...m.props]
    .filter(([, list]) => isWheat(list))
    .map(([i]) => i)
    .sort((a, b) => a - b);
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
      const seed = DENSITY_SEEDS[k];
      wheat += wheatOf(m).length;
      grass += plainsGrass(m);
      const fields = new Map<string, number>();
      for (const piece of wheatPieces(m)) {
        const chunks = new Set(piece.map((i) => chunkOfTile(m, i)));
        const at = `seed ${seed}, a field at tile ${piece[0]}`;
        // a field never crosses a chunk's edge
        expect(chunks.size, at).toBe(1);
        // 4 to 9 tiles, or two such fields that touch
        expect(piece.length, at).toBeGreaterThanOrEqual(4);
        expect(piece.length, at).toBeLessThanOrEqual(18);
        const [chunk] = chunks;
        fields.set(chunk, (fields.get(chunk) ?? 0) + 1);
      }
      for (const [chunk, n] of fields)
        expect(n, `seed ${seed}, chunk ${chunk}`).toBeLessThanOrEqual(2);
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
            const here = isWheat(a.props.get(y * a.w + x));
            const there = isWheat(b.props.get((y + dy) * b.w + x + dx));
            const at = `world tile (${x + a.originX}, ${y + a.originY})`;
            expect(here, at).toBe(there);
            if (!here) continue;
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
