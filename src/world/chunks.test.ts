import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CHUNK_TILES,
  CHUNK_VERSION,
  PROP_KINDS,
  buildMap,
  chunkKey,
  chunkOf,
  decodeChunk,
  encodeChunk,
  encodeMap,
  isChunkStore,
  mapChunks,
  parseChunkKey,
  placeChunk,
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from './mapgen';
import { levelAt, tileLevels } from './elevation';
import { Biome, Terrain, climateAtIndex, type GameMap, type PropInstance } from './tiles';
import { Rng, hash2 } from '../engine/rng';
import {
  DEFAULT_SUPPLY,
  SUPPLY_MODES,
  setSupplyMode,
  supplyMode,
  type SupplyMode,
} from '../sim/supply';
import { forAll, shrinkInt } from '../testing/property';
import { FLOW_CAP } from './rivers';

/** A frame of a map: its size and where its tile (0, 0) lies in the world. */
type Frame = Pick<MapGenParams, 'w' | 'h' | 'originX' | 'originY'>;

/** `p` grown by `ring` chunks on every side, as expandSave grows a game's world. */
const grow = (p: Frame, ring = 1): Frame => ({
  w: p.w + 2 * CHUNK_TILES * ring,
  h: p.h + 2 * CHUNK_TILES * ring,
  originX: (p.originX ?? 0) - CHUNK_TILES * ring,
  originY: (p.originY ?? 0) - CHUNK_TILES * ring,
});

/** A production chain by whether it is the full one. */
const chainOf = (full: boolean): SupplyMode => (full ? 'full' : 'simple');
/** generateMap of one production chain: the generator a game gives buildMap with its save's chain. */
const generateChain =
  (chain: SupplyMode): MapGenerator =>
  (s, p) =>
    generateMap(s, p, chain);
/** Whether any tile of `m` holds an oil prop, which only the full chain lays. */
const hasOil = (m: GameMap) =>
  [...m.props.values()].some((list) => list.some((p) => p.kind === 'oil'));

/** A generator that must not run. */
const never: MapGenerator = () => {
  throw new Error('generated a chunk that is stored');
};

/** Where a chunk stores an offset: the nearest 256th of a tile. */
const stored = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 256))) / 256;

/**
 * The first world tile where `a` and `b` differ, both read in world tiles, over the tiles of `a`
 * that `b` also has (and `only` allows); null when none does. Props compare exactly, or, with
 * `near`, kind and variant exactly and offsets once rounded as a chunk stores them.
 */
function firstDifference(
  a: GameMap,
  b: GameMap,
  { near = false, only }: { near?: boolean; only?: (wx: number, wy: number) => boolean } = {},
): string | null {
  const sameProp = (p: PropInstance, q: PropInstance) =>
    p.kind === q.kind &&
    p.variant === q.variant &&
    (near ? stored(p.ox) === stored(q.ox) : p.ox === q.ox) &&
    (near ? stored(p.oy) === stored(q.oy) : p.oy === q.oy);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const bx = x + a.originX - b.originX;
      const by = y + a.originY - b.originY;
      if (bx < 0 || by < 0 || bx >= b.w || by >= b.h) continue;
      if (only && !only(x + a.originX, y + a.originY)) continue;
      const i = y * a.w + x;
      const j = by * b.w + bx;
      const pa = a.props.get(i) ?? [];
      const pb = b.props.get(j) ?? [];
      const where = `world tile (${x + a.originX}, ${y + a.originY})`;
      if (a.terrain[i] !== b.terrain[j]) return `terrain at ${where}`;
      if (a.biome[i] !== b.biome[j]) return `biome at ${where}`;
      if (climateAtIndex(a, i) !== climateAtIndex(b, j)) return `climate at ${where}`;
      if (a.variant[i] !== b.variant[j]) return `variant at ${where}`;
      if (pa.length !== pb.length || pa.some((p, k) => !sameProp(p, pb[k])))
        return `props at ${where}: ${JSON.stringify(pa)} against ${JSON.stringify(pb)}`;
    }
  return null;
}

/** Whether world tile (`wx`, `wy`) lies in one of the chunks of `store`. */
const inStore = (store: ChunkStore, wx: number, wy: number) =>
  Object.hasOwn(store, chunkKey(chunkOf(wx), chunkOf(wy)));
/**
 * Whether world tile (`wx`, `wy`) has a side on a tile `stored` says is stored: where the seam
 * may end a new river in a pond (#341, buildMap's seam), so the tile is not the generator's.
 */
const besideStored = (stored: (wx: number, wy: number) => boolean, wx: number, wy: number) =>
  stored(wx + 1, wy) || stored(wx - 1, wy) || stored(wx, wy + 1) || stored(wx, wy - 1);

/** A map's frame and seed, any size and origin, either production chain. */
interface Case {
  seed: number;
  full: boolean;
  w: number;
  h: number;
  ox: number;
  oy: number;
}
const genCase = (rng: Rng): Case => ({
  seed: rng.int(0, 2 ** 31 - 1),
  full: rng.chance(0.5),
  w: rng.int(1, 4 * CHUNK_TILES),
  h: rng.int(1, 4 * CHUNK_TILES),
  ox: rng.chance(0.5) ? -CHUNK_TILES * rng.int(0, 3) : rng.int(-100, 100),
  oy: rng.chance(0.5) ? -CHUNK_TILES * rng.int(0, 3) : rng.int(-100, 100),
});
function* shrinkCase(c: Case): Iterable<Case> {
  if (c.full) yield { ...c, full: false };
  for (const w of shrinkInt(c.w, 1)) yield { ...c, w };
  for (const h of shrinkInt(c.h, 1)) yield { ...c, h };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
}
const caseMap = (c: Case) =>
  generateMap(c.seed, { w: c.w, h: c.h, originX: c.ox, originY: c.oy }, chainOf(c.full));

describe('chunk keys', () => {
  it('are chunks of 32 world tiles, the region size', () => {
    expect(CHUNK_TILES).toBe(32);
    expect(emptyMap(1, 64, 64).regionSize).toBe(CHUNK_TILES);
  });

  it('name the world chunk of a tile, floor((originX + x) / 32), whatever the origin', () => {
    forAll(
      (rng) => ({
        w: rng.int(1, 100),
        h: rng.int(1, 100),
        ox: rng.int(-99, 99),
        oy: rng.int(-99, 99),
      }),
      ({ w, h, ox, oy }) => {
        const keys = new Set(
          mapChunks({ w, h, originX: ox, originY: oy }).map((c) => chunkKey(c.cx, c.cy)),
        );
        const seen = new Set<string>();
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const k = chunkKey(Math.floor((ox + x) / 32), Math.floor((oy + y) / 32));
            if (!keys.has(k)) throw new Error(`tile (${x}, ${y}) lies in ${k}, not listed`);
            seen.add(k);
          }
        // every chunk listed has a tile of the map
        expect(seen.size).toBe(keys.size);
      },
    );
  });

  it('read back as the chunk they name', () => {
    for (const [cx, cy] of [
      [0, 0],
      [-1, 0],
      [3, -12],
      [-40, -40],
    ])
      expect(parseChunkKey(chunkKey(cx, cy))).toEqual({ cx, cy });
    for (const bad of ['', '1', '1,', 'a,b', '1.5,2', ' 1,2', '1,2,3', '-0,0', '01,2', '1e3,0'])
      expect(parseChunkKey(bad)).toBeNull();
  });

  it('make a store of key and text and nothing else', () => {
    expect(isChunkStore({})).toBe(true);
    expect(isChunkStore({ '0,0': 'AQ==', '-1,2': '' })).toBe(true);
    for (const bad of [null, [], 'x', { '0,0': 3 }, { zero: 'AQ==' }])
      expect(isChunkStore(bad)).toBe(false);
  });
});

describe('a chunk text', () => {
  // A chunk text in a save must mean the same to every later version. These bytes are version 1,
  // as the encoding's description in chunks.ts spells it out: header 01 01 02 03 02, terrain runs
  // 01 10 61 30, biome 05, variant C1 0E, then two tiles of props (the reeds' variant escaped).
  it('of version 1 decodes as it always has', () => {
    const c = decodeChunk('AQECAwIBEGEwBcEOAglFQLIuAAAJDEJCHwsJgH8=');
    expect(c).not.toBeNull();
    expect(c!.version).toBe(1);
    expect([c!.x0, c!.y0, c!.w, c!.h]).toEqual([1, 2, 3, 2]);
    expect([...c!.terrain]).toEqual([0, 0, 1, 6, 6, 3]);
    expect([...c!.biome]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...c!.variant]).toEqual([1, 0, 0, 3, 2, 3]);
    expect([...c!.props]).toEqual([
      [
        2,
        [
          { kind: 'spruce', variant: 2, ox: 0.25, oy: -0.3046875 },
          { kind: 'oil', variant: 1, ox: 0, oy: 0 },
        ],
      ],
      [
        5,
        [
          { kind: 'boulder', variant: 0, ox: 0.2578125, oy: 0.2578125 },
          { kind: 'reeds', variant: 9, ox: -0.5, oy: 0.49609375 },
        ],
      ],
    ]);
  });

  it('stores every prop kind under the index it always had (new kinds are appended)', () => {
    expect(PROP_KINDS.slice(0, 16)).toEqual([
      'tree',
      'pine',
      'rock',
      'bush',
      'birch',
      'spruce',
      'oak',
      'palm',
      'cactus',
      'deadtree',
      'flowers',
      'reeds',
      'boulder',
      'coal',
      'oil',
      'wheat',
    ]);
    // each kind under an index of its own, with none left out between them
    for (const kind of PROP_KINDS) {
      const map = emptyMap(1, 1, 1);
      map.props.set(0, [{ kind, variant: 1, ox: 0, oy: 0 }]);
      expect(decodeChunk(encodeChunk(map, 0, 0))!.props.get(0)![0].kind).toBe(kind);
    }
  });

  // 24 generated maps up to 128 tiles a side, each read back and stored again: about 4.5 s alone
  it('comes back byte for byte, its planes as the map has them, over seeds and sizes', () => {
    let oil = 0;
    forAll(
      genCase,
      (c) => {
        const map = caseMap(c);
        // the case's chain reached generation: oil only in the full chain
        if (hasOil(map)) {
          expect(c.full, 'oil in the simple chain').toBe(true);
          oil++;
        }
        const store = encodeMap(map);
        expect(Object.keys(store)).toEqual(mapChunks(map).map((k) => chunkKey(k.cx, k.cy)));
        // through the save's text, read back from the store alone and stored again: the same text
        const saved = JSON.parse(JSON.stringify(store)) as ChunkStore;
        const frame = { w: c.w, h: c.h, originX: c.ox, originY: c.oy };
        const back = buildMap(c.seed, frame, saved, never);
        expect(back.added).toEqual([]);
        expect(back.unreadable).toEqual([]);
        expect(back.chunks).toEqual(store);
        expect(encodeMap(back.map)).toEqual(store);
        // terrain, biome and variant exact, props within a 512th of a tile
        const where = firstDifference(back.map, map, { near: true });
        if (where) throw new Error(where);
        for (const [i, list] of map.props)
          back.map.props.get(i)!.forEach((p, k) => {
            const off = Math.max(Math.abs(p.ox - list[k].ox), Math.abs(p.oy - list[k].oy));
            if (off > 1 / 512) throw new Error(`a prop of tile ${i} moved ${off} of a tile`);
          });
      },
      { seeds: Array.from({ length: 24 }, (_, i) => i + 1), shrink: shrinkCase, shrinkBudget: 80 },
    );
    // full-chain cases with their oil ran
    expect(oil).toBeGreaterThan(0);
  }, 90_000);

  it('holds any value it allows, in tiles as odd as it allows', () => {
    // every terrain and biome id 0 to 15, every variant, long and single runs, props by the
    // dozen and with escaped kinds and variants, on a part of a chunk off the grid
    forAll(
      (rng) => {
        const w = rng.int(1, 32);
        const h = rng.int(1, 32);
        const map = emptyMap(
          rng.int(0, 1000),
          w,
          h,
          Terrain.Grass,
          rng.int(-50, 50),
          rng.int(-50, 50),
        );
        const runs = rng.chance(0.5);
        for (let i = 0; i < w * h; i++) {
          map.terrain[i] = runs && i > 0 && rng.chance(0.9) ? map.terrain[i - 1] : rng.int(0, 15);
          map.biome[i] = runs && i > 0 && rng.chance(0.97) ? map.biome[i - 1] : rng.int(0, 15);
          map.variant[i] = rng.int(0, 3);
          if (rng.chance(0.4)) {
            const list: PropInstance[] = [];
            for (let k = rng.chance(0.1) ? rng.int(4, 12) : rng.int(1, 3); k > 0; k--)
              list.push({
                kind: PROP_KINDS[rng.int(0, PROP_KINDS.length - 1)],
                variant: rng.chance(0.1) ? rng.int(8, 300) : rng.int(0, 7),
                ox: rng.int(-128, 127) / 256,
                oy: rng.int(-128, 127) / 256,
              });
            map.props.set(i, list);
          }
        }
        return map;
      },
      (map) => {
        const frame = { w: map.w, h: map.h, originX: map.originX, originY: map.originY };
        for (const { cx, cy } of mapChunks(map)) {
          const text = encodeChunk(map, cx, cy);
          const into = emptyMap(map.seed, map.w, map.h, Terrain.Water, map.originX, map.originY);
          const c = decodeChunk(text);
          expect(c).not.toBeNull();
          expect(c!.version).toBe(CHUNK_VERSION);
          const back = buildMap(map.seed, frame, { [chunkKey(cx, cy)]: text }, () => into);
          expect(encodeChunk(back.map, cx, cy)).toBe(text);
        }
        const store = encodeMap(map);
        const back = buildMap(map.seed, frame, store, never);
        const where = firstDifference(back.map, map);
        if (where) throw new Error(where);
      },
      { format: (m) => `${m.w} x ${m.h} at (${m.originX}, ${m.originY}), seed ${m.seed}` },
    );
  });

  it('refuses a value it cannot hold rather than store another', () => {
    const map = emptyMap(1, 32, 32);
    map.terrain[5] = 16;
    expect(() => encodeChunk(map, 0, 0)).toThrow(/terrain/);
    map.terrain[5] = 0;
    map.biome[7] = 16;
    expect(() => encodeChunk(map, 0, 0)).toThrow(/biome/);
    map.biome[7] = 0;
    // the climate, a plane of its own from version 2, is held to the biome's bound
    map.climate = new Uint8Array(32 * 32);
    map.climate[11] = 16;
    expect(() => encodeChunk(map, 0, 0)).toThrow(/climate/);
    map.climate[11] = 0;
    map.variant[9] = 4;
    expect(() => encodeChunk(map, 0, 0)).toThrow(/variant/);
    map.variant[9] = 0;
    map.props.set(3, [{ kind: 'barley' as PropInstance['kind'], variant: 0, ox: 0, oy: 0 }]);
    expect(() => encodeChunk(map, 0, 0)).toThrow(/kind/);
    map.props.set(3, [{ kind: 'oak', variant: -1, ox: 0, oy: 0 }]);
    expect(() => encodeChunk(map, 0, 0)).toThrow(/variant/);
    expect(() => encodeChunk(map, 1, 0)).toThrow(/cover/);
  });

  it('holds any water level, flow and side it allows, and reads them back as they were', () => {
    // the water planes of version 3 (#341): levels 0 to 15 in runs, and a flow up to FLOW_CAP with
    // a side 1 to 4 on any tile, flow 0 included, on parts of chunks off the grid
    let rivers = 0;
    forAll(
      (rng) => {
        const w = rng.int(1, 40);
        const h = rng.int(1, 40);
        const map = emptyMap(
          rng.int(0, 1000),
          w,
          h,
          Terrain.Grass,
          rng.int(-50, 50),
          rng.int(-50, 50),
        );
        map.waterSurface = new Uint8Array(w * h);
        map.flow = new Uint16Array(w * h);
        map.flowDir = new Uint8Array(w * h);
        const runs = rng.chance(0.5);
        const share = rng.pick([0, 0.02, 0.3, 1]);
        for (let i = 0; i < w * h; i++) {
          map.waterSurface[i] =
            runs && i > 0 && rng.chance(0.9) ? map.waterSurface[i - 1] : rng.int(0, 15);
          if (!rng.chance(share)) continue;
          map.flowDir[i] = rng.int(1, 4);
          map.flow[i] = rng.pick([0, 1, FLOW_CAP, rng.int(1, FLOW_CAP)]);
        }
        return map;
      },
      (map) => {
        const frame = { w: map.w, h: map.h, originX: map.originX, originY: map.originY };
        for (const { cx, cy } of mapChunks(map)) {
          const c = decodeChunk(encodeChunk(map, cx, cy))!;
          expect(c).not.toBeNull();
          rivers += c.flowDir.filter((d) => d).length;
        }
        const back = buildMap(map.seed, frame, encodeMap(map), never).map;
        for (const [name, a, b] of [
          ['water level', back.waterSurface!, map.waterSurface!],
          ['flow', back.flow!, map.flow!],
          ['side', back.flowDir!, map.flowDir!],
        ] as const)
          for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i])
              throw new Error(`${name} ${a[i]} read back, ${b[i]} stored, at tile ${i}`);
      },
      { format: (m) => `${m.w} x ${m.h} at (${m.originX}, ${m.originY}), seed ${m.seed}` },
    );
    expect(rivers).toBeGreaterThan(0);
  });

  it('refuses a water level, flow or side it cannot hold', () => {
    const map = () => {
      const m = emptyMap(1, 32, 32);
      m.waterSurface = new Uint8Array(32 * 32);
      m.flow = new Uint16Array(32 * 32);
      m.flowDir = new Uint8Array(32 * 32);
      return m;
    };
    const level = map();
    level.waterSurface![4] = 16;
    expect(() => encodeChunk(level, 0, 0)).toThrow(/water level/);
    const side = map();
    side.flowDir![4] = 5;
    expect(() => encodeChunk(side, 0, 0)).toThrow(/sides/);
    const flow = map();
    flow.flowDir![4] = 1;
    flow.flow![4] = FLOW_CAP + 1;
    expect(() => encodeChunk(flow, 0, 0)).toThrow(/flow/);
    const loose = map();
    loose.flow![4] = 7;
    expect(() => encodeChunk(loose, 0, 0)).toThrow(/river tile/);
    // and the most it holds, at the last tile
    const most = map();
    most.flowDir![32 * 32 - 1] = 4;
    most.flow![32 * 32 - 1] = FLOW_CAP;
    most.waterSurface![32 * 32 - 1] = 15;
    const c = decodeChunk(encodeChunk(most, 0, 0))!;
    expect([c.flow[32 * 32 - 1], c.flowDir[32 * 32 - 1], c.waterSurface[32 * 32 - 1]]).toEqual([
      FLOW_CAP,
      4,
      15,
    ]);
  });

  it('that is not one encodeChunk writes reads as nothing', () => {
    const map = generateMap(7412, { w: 32, h: 32 });
    const text = encodeChunk(map, 0, 0);
    const bytes = Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    expect(decodeChunk(text)).not.toBeNull();
    // a newer encoding, an unknown one, a rectangle outside the chunk
    for (const [at, v] of [
      [0, CHUNK_VERSION + 1],
      [0, 0],
      [3, 0],
      [1, 31],
    ]) {
      const b = bytes.slice();
      b[at] = v;
      expect(decodeChunk(b64(b))).toBeNull();
    }
    // cut short anywhere, or with a byte too many
    for (let n = 0; n < bytes.length; n += 7)
      expect(decodeChunk(b64(bytes.subarray(0, n)))).toBeNull();
    expect(decodeChunk(b64(bytes.subarray(0, bytes.length - 1)))).toBeNull();
    expect(decodeChunk(b64(Uint8Array.from([...bytes, 0])))).toBeNull();
    for (const junk of ['', '%%%', 'not base64!', 'AQ=='] as const)
      expect(decodeChunk(junk)).toBeNull();
  });
});

describe('a map built from stored chunks', () => {
  // a world of 96 tiles built, read back and generated, its rivers planned once (#341): about
  // 0.5 s alone
  it('is generated whole when nothing is stored, and read whole once everything is', () => {
    const params = { w: 96, h: 96 };
    const first = buildMap(31337, params, {});
    expect(first.added).toEqual(mapChunks(params).map((c) => chunkKey(c.cx, c.cy)));
    expect(first.chunks).toEqual(encodeMap(first.map));
    const again = buildMap(31337, params, first.chunks, never);
    expect(again.added).toEqual([]);
    expect(again.chunks).toEqual(first.chunks);
    expect(firstDifference(again.map, first.map)).toBeNull();
    // generation's own map, up to where props are stored
    expect(firstDifference(first.map, generateMap(31337, params), { near: true })).toBeNull();
  }, 10_000);

  // Generates a few maps up to 288 tiles a side per seed: about 2 s alone
  it('of a grown world is generateMap of the grown parameters, tile for tile', () => {
    let oil = 0;
    forAll(
      (rng) => ({
        seed: rng.int(0, 2 ** 31 - 1),
        full: rng.chance(0.5),
        size: CHUNK_TILES * rng.int(1, 5),
        earlier: rng.int(0, 2),
        rings: rng.int(1, 2),
      }),
      ({ seed, full, size, earlier, rings }) => {
        const chain = chainOf(full);
        const gen = generateChain(chain);
        const at = -CHUNK_TILES * earlier;
        let params: Frame = { w: size, h: size, originX: at, originY: at };
        let store = buildMap(seed, params, {}, gen).chunks;
        for (let r = 0; r < rings; r++) {
          const before = store;
          params = grow(params);
          const built = buildMap(seed, params, store, gen);
          // oil only in the full chain
          if (hasOil(built.map)) {
            expect(full, 'oil in the simple chain').toBe(true);
            oil++;
          }
          // only the new ring is generated, and every stored text is kept as it was
          const ring = mapChunks(params)
            .map((c) => chunkKey(c.cx, c.cy))
            .filter((k) => !Object.hasOwn(before, k));
          expect(built.added).toEqual(ring);
          for (const k of Object.keys(before)) expect(built.chunks[k]).toBe(before[k]);
          const fresh = buildMap(seed, params, {}, gen);
          const exact = firstDifference(built.map, fresh.map);
          if (exact) throw new Error(`against the grown world stored at once: ${exact}`);
          const diff = firstDifference(built.map, generateMap(seed, params, chain), { near: true });
          if (diff) throw new Error(`against generateMap: ${diff}`);
          store = built.chunks;
        }
      },
      { seeds: Array.from({ length: 10 }, (_, i) => i + 1) },
    );
    // full-chain worlds with their oil ran
    expect(oil).toBeGreaterThan(0);
  }, 60_000);

  // three worlds of 48 tiles grown to 96, each built four times: about 0.7 s alone
  it('keeps a part of a chunk it stored when the map grows over the rest of it', () => {
    // 48 tiles hold chunk 1 in part; grown by a chunk before it the start chunk stays chunk 0
    for (const seed of [1, 7412, 20260912]) {
      const small = { w: 48, h: 48 };
      const big = { w: 96, h: 96, originX: -32, originY: -32 };
      const first = buildMap(seed, small, {});
      expect(decodeChunk(first.chunks['1,1'])).toMatchObject({ x0: 0, y0: 0, w: 16, h: 16 });
      const other: MapGenerator = (s, p) => ({ ...generateMap(s + 1, p), seed: s });
      const grown = buildMap(seed, big, first.chunks, other);
      // the part stored stays; the rest of the chunk is generated and the whole stored
      expect(decodeChunk(grown.chunks['1,1'])).toMatchObject({ x0: 0, y0: 0, w: 32, h: 32 });
      expect(grown.added).toContain('1,1');
      expect(firstDifference(first.map, grown.map)).toBeNull();
      const rest = buildMap(seed, big, {}, other).map;
      const inside = (wx: number, wy: number) => wx >= 0 && wy >= 0 && wx < 48 && wy < 48;
      // the rest as generated, but where a river runs into the stored part and ends at the seam
      const outside = (wx: number, wy: number) => !inside(wx, wy) && !besideStored(inside, wx, wy);
      expect(firstDifference(grown.map, rest, { only: outside })).toBeNull();
      // and with the generator unchanged it is the grown world
      expect(
        firstDifference(buildMap(seed, big, first.chunks).map, buildMap(seed, big, {}).map),
      ).toBeNull();
    }
  }, 15_000);

  // Eight worlds grown from 64 to 192 tiles a side, each generated twice: about 0.7 s alone
  it('never changes a stored chunk, whatever the generator makes now', () => {
    const generators: [string, MapGenerator][] = [
      ['another seed', (s, p) => ({ ...generateMap(s + 1, p), seed: s })],
      [
        'all mountain, a boulder on every tile',
        (s, p) => {
          const m = emptyMap(s, p.w!, p.h!, Terrain.Mountain, p.originX, p.originY);
          m.biome.fill(Biome.Swamp);
          m.variant.fill(3);
          for (let i = 0; i < m.w * m.h; i++)
            m.props.set(i, [{ kind: 'boulder', variant: 1, ox: 0.1, oy: -0.1 }]);
          return m;
        },
      ],
    ];
    for (const seed of [1, 31337])
      for (const [name, gen] of generators)
        for (const full of [false, true]) {
          const params: Frame = { w: 64, h: 64 };
          const old = buildMap(seed, params, {}, generateChain(chainOf(full)));
          // the stored world is of its chain: the full one's oil, the simple one's none
          expect(hasOil(old.map), `${name}: oil in the stored world`).toBe(full);
          const grownParams = grow(params, 2);
          const built = buildMap(seed, grownParams, old.chunks, gen);
          const now = gen(seed, grownParams);
          // the generator would make other ground where the chunks are stored
          expect(firstDifference(old.map, now), name).not.toBeNull();
          for (const [k, text] of Object.entries(old.chunks)) {
            const { cx, cy } = parseChunkKey(k)!;
            expect(built.chunks[k], `${name}: chunk ${k}`).toBe(text);
            expect(encodeChunk(built.map, cx, cy), `${name}: chunk ${k}`).toBe(text);
          }
          expect(firstDifference(old.map, built.map), name).toBeNull();
          // the new chunks are the generator's, but where a river runs into a stored chunk and ends
          // at the seam
          const kept = (wx: number, wy: number) => inStore(old.chunks, wx, wy);
          const fresh = (wx: number, wy: number) => !kept(wx, wy) && !besideStored(kept, wx, wy);
          expect(firstDifference(built.map, now, { near: true, only: fresh }), name).toBeNull();
        }
  }, 20_000);

  it('keeps the ground as generated, whatever is built on the map or repaired under it', () => {
    const params = { w: 96, h: 96 };
    const built = buildMap(7412, params, {});
    const before = JSON.stringify(built.chunks);
    // a load repair and a renderer pushing props aside both work on the map itself
    built.map.terrain.fill(Terrain.Grass, 0, 500);
    for (const list of built.map.props.values()) for (const p of list) p.ox = 0.4;
    built.map.props.clear();
    expect(JSON.stringify(built.chunks)).toBe(before);
    const again = buildMap(7412, params, built.chunks, never);
    expect(firstDifference(again.map, buildMap(7412, params, {}).map)).toBeNull();
  });

  it('reports a chunk it cannot read and keeps its text', () => {
    const params = { w: 64, h: 64 };
    const store = { ...buildMap(1, params, {}).chunks, '0,0': 'garbage' };
    const built = buildMap(1, params, store);
    expect(built.unreadable).toEqual(['0,0']);
    expect(built.added).toEqual([]);
    expect(built.chunks).toEqual(store);
    // the chunk is generated for this map in the meantime
    expect(firstDifference(built.map, buildMap(1, params, {}).map)).toBeNull();
  });

  it('keeps the stored chunks of tiles the map no longer covers', () => {
    const store = buildMap(1, { w: 96, h: 96 }, {}).chunks;
    const built = buildMap(1, { w: 32, h: 32, originX: 32, originY: 32 }, store, never);
    expect(built.chunks).toEqual(store);
  });

  it('has the climate the generator gives it, stored and read back', () => {
    const climate: MapGenerator = (s, p) => {
      const m = generateMap(s, p);
      return { ...m, climate: new Uint8Array(m.w * m.h).fill(Biome.Desert) };
    };
    const built = buildMap(1, { w: 64, h: 64 }, {}, climate);
    expect(new Set(built.map.climate)).toEqual(new Set([Biome.Desert]));
    const again = buildMap(1, { w: 64, h: 64 }, built.chunks, never);
    expect(new Set(again.map.climate)).toEqual(new Set([Biome.Desert]));
  });

  it('refuses a generator that makes a map of another size', () => {
    expect(() =>
      buildMap(1, { w: 64, h: 64 }, {}, (s) => generateMap(s, { w: 32, h: 32 })),
    ).toThrow(/generator/);
  });

  // five worlds of 49 chunks: about 0.6 s alone
  it('adds at most about 150 KB to the save for a 49-chunk world', () => {
    for (const seed of [1, 7412, 20260912, 31337, 987654321]) {
      const { chunks } = buildMap(seed, { w: 224, h: 224, originX: -64, originY: -64 }, {});
      expect(Object.keys(chunks)).toHaveLength(49);
      expect(JSON.stringify(chunks).length).toBeLessThanOrEqual(150_000);
    }
  }, 15_000);

  // five worlds of 49 chunks in the full chain: about 0.8 s alone
  it('adds at most about 150 KB for a 49-chunk world in the full production chain too', () => {
    // the full chain's oil fields and start seeps are props of their own
    let oil = 0;
    for (const seed of [1, 7412, 20260912, 31337, 987654321]) {
      const params = { w: 224, h: 224, originX: -64, originY: -64 };
      const { map, chunks } = buildMap(seed, params, {}, generateChain('full'));
      expect(hasOil(map), `seed ${seed}: oil`).toBe(true);
      for (const list of map.props.values()) if (list.some((p) => p.kind === 'oil')) oil++;
      expect(Object.keys(chunks)).toHaveLength(49);
      expect(JSON.stringify(chunks).length, `seed ${seed}`).toBeLessThanOrEqual(150_000);
    }
    expect(oil).toBeGreaterThan(0);
  }, 15_000);
});

describe('the production chain of a built map', () => {
  // The chain is an argument of generation (#280), not the game-wide switch. The switch is module
  // state shared with every other test in the worker, so each case starts and ends with the default.
  beforeEach(() => setSupplyMode(DEFAULT_SUPPLY));
  afterEach(() => setSupplyMode(DEFAULT_SUPPLY));

  // 18 worlds 96 tiles a side generated, 6 more read back: about 0.5 s alone
  it('is the default one unless the generator brings another, whatever the game-wide switch says', () => {
    const params: Frame = { w: 96, h: 96, originX: -32, originY: -32 };
    for (const seed of [1, 7412, 31337]) {
      const simple = buildMap(seed, params, {}, generateChain(DEFAULT_SUPPLY)).chunks;
      const full = buildMap(seed, params, {}, generateChain('full')).chunks;
      // the full chain's oil is in its store: a load of the store alone has it
      const loadsOil = (store: ChunkStore) => hasOil(buildMap(seed, params, store, never).map);
      expect(loadsOil(full), `seed ${seed}: full`).toBe(true);
      expect(loadsOil(simple), `seed ${seed}: default`).toBe(false);
      for (const global of SUPPLY_MODES) {
        setSupplyMode(global);
        const at = `seed ${seed}, switch ${global}`;
        // no generator given: the default chain, never the switch
        expect(buildMap(seed, params, {}).chunks, at).toEqual(simple);
        // a generator with the full chain: its chain, whatever the switch
        expect(buildMap(seed, params, {}, generateChain('full')).chunks, at).toEqual(full);
        // and the switch is left as it was
        expect(supplyMode(), at).toBe(global);
      }
    }
  }, 10_000);
});

// Properties over any generator, frame and text. Each is checked against an oracle written apart
// from chunks.ts: which tiles are stored is read off the frames, never off the store.

/**
 * A generator nothing like generateMap: every plane hashed from the world tile and `salt`, over all
 * that encoding 2 holds (terrain, biome and climate ids 0 to 15 in 4 x 4 patches so that runs
 * form, the climate its own plane, variants 0 to 3, up to nine props a tile of any kind, variants
 * past the one-byte escape, offsets up to 0.45 of a tile). A function of world tiles, so two
 * frames of one salt agree where they overlap. The params of every call go into `calls`.
 */
function hashed(salt: number, calls: Partial<MapGenParams>[] = []): MapGenerator {
  return (seed, p) => {
    calls.push(p);
    const m = emptyMap(seed, p.w!, p.h!, Terrain.Grass, p.originX, p.originY);
    const climate = (m.climate = new Uint8Array(m.w * m.h));
    const at = (wx: number, wy: number, k: number) => hash2(wx, wy, salt * 32 + k);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const wx = x + m.originX;
        const wy = y + m.originY;
        const i = y * m.w + x;
        m.terrain[i] = Math.floor(at(wx >> 2, wy >> 2, 0) * 16);
        m.biome[i] = Math.floor(at(wx >> 2, wy >> 2, 1) * 16);
        climate[i] = Math.floor(at(wx >> 2, wy >> 2, 10) * 16);
        m.variant[i] = Math.floor(at(wx, wy, 2) * 4);
        const r = at(wx, wy, 3);
        if (r >= 0.35) continue;
        const n = r < 0.03 ? 4 + Math.floor(at(wx, wy, 4) * 6) : 1 + Math.floor(at(wx, wy, 4) * 3);
        const list: PropInstance[] = [];
        for (let k = 0; k < n; k++) {
          const u = wx * 16 + k;
          list.push({
            kind: PROP_KINDS[Math.floor(at(u, wy, 5) * PROP_KINDS.length)],
            variant:
              at(u, wy, 6) < 0.1
                ? 8 + Math.floor(at(u, wy, 7) * 500)
                : Math.floor(at(u, wy, 7) * 8),
            ox: (at(u, wy, 8) - 0.5) * 0.9,
            oy: (at(u, wy, 9) - 0.5) * 0.9,
          });
        }
        m.props.set(i, list);
      }
    return m;
  };
}

/** Whether world tile (`wx`, `wy`) lies in frame `f`. */
const covers = (f: Frame, wx: number, wy: number) => {
  const ox = f.originX ?? 0;
  const oy = f.originY ?? 0;
  return wx >= ox && wy >= oy && wx < ox + f.w && wy < oy + f.h;
};

/** On one axis: the tiles [from, to) of chunk `c`, from its corner, that `n` tiles from `o` cover. */
const span = (o: number, n: number, c: number) => [
  Math.max(o, 32 * c) - 32 * c,
  Math.min(o + n, 32 * c + 32) - 32 * c,
];

/**
 * The keys of the chunks `after` covers a tile of that `before` does not cover all of, in rows: the
 * chunks a map of `after` built on a store of `before` has to generate.
 */
function grownChunks(before: Frame, after: Frame): string[] {
  const out: string[] = [];
  const [ax, ay] = [after.originX ?? 0, after.originY ?? 0];
  const [bx, by] = [before.originX ?? 0, before.originY ?? 0];
  for (let cy = Math.floor(ay / 32); cy <= Math.floor((ay + after.h - 1) / 32); cy++)
    for (let cx = Math.floor(ax / 32); cx <= Math.floor((ax + after.w - 1) / 32); cx++) {
      const [nx0, nx1] = span(ax, after.w, cx);
      const [ny0, ny1] = span(ay, after.h, cy);
      const [sx0, sx1] = span(bx, before.w, cx);
      const [sy0, sy1] = span(by, before.h, cy);
      const held = sx0 < sx1 && sy0 < sy1 && sx0 <= nx0 && sx1 >= nx1 && sy0 <= ny0 && sy1 >= ny1;
      if (!held) out.push(chunkKey(cx, cy));
    }
  return out;
}

/** A stored world of any frame and the frame it grows to, by any tiles on each side. */
interface Growth {
  seed: number;
  salt: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** tiles added before and after the stored frame along x, then along y */
  grow: number[];
  /** a slider the generator has to be given along with the frame */
  waterLevel: number;
}
const genGrowth = (rng: Rng): Growth => {
  const g: Growth = {
    seed: rng.int(0, 2 ** 31 - 1),
    salt: rng.int(1, 999_999),
    w: rng.int(1, 80),
    h: rng.int(1, 80),
    ox: rng.int(-80, 80),
    oy: rng.int(-80, 80),
    grow: [0, 0, 0, 0],
    waterLevel: rng.int(10, 60) / 100,
  };
  // one case in ten does not grow, so every chunk is stored
  if (rng.chance(0.9)) g.grow = g.grow.map(() => (rng.chance(0.3) ? 0 : rng.int(1, 70)));
  return g;
};
function* shrinkGrowth(g: Growth): Iterable<Growth> {
  for (let s = 0; s < 4; s++)
    for (const v of shrinkInt(g.grow[s]))
      yield { ...g, grow: g.grow.map((d, k) => (k === s ? v : d)) };
  for (const w of shrinkInt(g.w, 1)) yield { ...g, w };
  for (const h of shrinkInt(g.h, 1)) yield { ...g, h };
  for (const ox of shrinkInt(g.ox)) yield { ...g, ox };
  for (const oy of shrinkInt(g.oy)) yield { ...g, oy };
}
const storedFrame = (g: Growth): Frame => ({ w: g.w, h: g.h, originX: g.ox, originY: g.oy });
const grownFrame = (g: Growth) => ({
  w: g.w + g.grow[0] + g.grow[1],
  h: g.h + g.grow[2] + g.grow[3],
  originX: g.ox - g.grow[0],
  originY: g.oy - g.grow[2],
  waterLevel: g.waterLevel,
});

/** One axis of a growth that keeps the start chunk on its world tiles (as in mapgen.test.ts). */
interface Axis {
  len: number;
  before: number;
  big: number;
}
const startChunk = (len: number) => Math.floor((Math.ceil(len / 32) - 1) / 2);
const keepsStart = (a: Axis) =>
  a.len >= 32 &&
  a.before >= 0 &&
  a.big > a.len &&
  a.big >= 32 * a.before + a.len &&
  startChunk(a.big) === startChunk(a.len) + a.before;
function genAxis(rng: Rng): Axis {
  const len = rng.int(32, 128);
  for (;;) {
    const before = rng.int(0, 2);
    const a = { len, before, big: 32 * before + len + rng.int(0, 64) };
    if (keepsStart(a)) return a;
  }
}
function* shrinkAxis(a: Axis): Iterable<Axis> {
  const all = function* () {
    if (a.before > 0) yield { ...a, before: a.before - 1, big: a.big - 32 };
    for (const len of shrinkInt(a.len, 32)) yield { ...a, len, big: a.big - (a.len - len) };
    for (const big of shrinkInt(a.big, 32 * a.before + a.len)) yield { ...a, big };
  };
  for (const b of all()) if (keepsStart(b)) yield b;
}

type Sliders = Pick<MapGenParams, 'waterLevel' | 'hillLevel' | 'rockLevel' | 'forestDensity'>;
const DEFAULT_SLIDERS: Sliders = {
  waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
  hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
  rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
  forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
};
/** A world grown with generateMap unchanged: any origin, sliders and chain, the start kept. */
interface RealGrowth {
  seed: number;
  full: boolean;
  sliders: Sliders;
  ox: number;
  oy: number;
  x: Axis;
  y: Axis;
}
const genRealGrowth = (rng: Rng): RealGrowth => ({
  seed: rng.int(0, 2 ** 31 - 1),
  full: rng.chance(0.5),
  sliders: {
    waterLevel: rng.int(10, 60) / 100,
    hillLevel: rng.int(45, 90) / 100,
    rockLevel: rng.int(50, 100) / 100,
    forestDensity: rng.int(30, 90) / 100,
  },
  ox: rng.chance(0.3) ? -32 * rng.int(0, 2) : rng.int(-128, 128),
  oy: rng.chance(0.3) ? -32 * rng.int(0, 2) : rng.int(-128, 128),
  x: genAxis(rng),
  y: genAxis(rng),
});
function* shrinkRealGrowth(c: RealGrowth): Iterable<RealGrowth> {
  if (c.full) yield { ...c, full: false };
  if (JSON.stringify(c.sliders) !== JSON.stringify(DEFAULT_SLIDERS))
    yield { ...c, sliders: DEFAULT_SLIDERS };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
  for (const x of shrinkAxis(c.x)) yield { ...c, x };
  for (const y of shrinkAxis(c.y)) yield { ...c, y };
}

/** The ways garble breaks a chunk's text, or makes one of its own. */
const GARBLES = [
  'bytes changed',
  'cut short',
  'bytes put in',
  'bytes taken out',
  'noise',
  'not base64',
  'props written by hand',
] as const;

/**
 * A text for decodeChunk, as a recipe: the text encodeChunk writes for the rectangle (`x0`, `y0`,
 * `w`, `h`) of chunk (0, 0) with `hashed(salt)`'s planes, broken as `how` says with the stream of
 * `Rng(edit)`. Shrinking the rectangle keeps the recipe, so a failure shrinks to a small chunk
 * broken the same way.
 */
interface Garbled {
  how: (typeof GARBLES)[number];
  x0: number;
  y0: number;
  w: number;
  h: number;
  salt: number;
  edit: number;
}
const genGarbled = (rng: Rng): Garbled => {
  const w = rng.int(1, 32);
  const h = rng.int(1, 32);
  return {
    how: rng.pick(GARBLES),
    x0: rng.int(0, 32 - w),
    y0: rng.int(0, 32 - h),
    w,
    h,
    salt: rng.int(1, 999_999),
    edit: rng.int(0, 2 ** 31 - 1),
  };
};
function* shrinkGarbled(g: Garbled): Iterable<Garbled> {
  for (const w of shrinkInt(g.w, 1)) yield { ...g, w };
  for (const h of shrinkInt(g.h, 1)) yield { ...g, h };
  for (const x0 of shrinkInt(g.x0)) yield { ...g, x0 };
  for (const y0 of shrinkInt(g.y0)) yield { ...g, y0 };
}
/** The text a recipe makes. */
function garble(g: Garbled): string {
  const rng = new Rng(g.edit);
  const map = hashed(g.salt)(0, { w: g.w, h: g.h, originX: g.x0, originY: g.y0 });
  if (g.how === 'props written by hand') map.props.clear();
  const bytes = Array.from(atob(encodeChunk(map, 0, 0)), (ch) => ch.charCodeAt(0));
  const at = () => rng.int(0, bytes.length - 1);
  const b64 = (b: number[]) => btoa(String.fromCharCode(...b));
  switch (g.how) {
    case 'bytes changed':
      for (let k = rng.int(1, 3); k > 0; k--) bytes[at()] = rng.int(0, 255);
      return b64(bytes);
    case 'cut short':
      return b64(bytes.slice(0, at()));
    case 'bytes put in':
      for (let k = rng.int(1, 3); k > 0; k--) bytes.splice(at(), 0, rng.int(0, 255));
      return b64(bytes);
    case 'bytes taken out':
      for (let k = rng.int(1, 3); k > 0; k--) bytes.splice(at(), 1);
      return b64(bytes);
    case 'noise': {
      const noise = Array.from({ length: rng.int(0, 80) }, () => rng.int(0, 255));
      if (noise.length && rng.chance(0.5)) noise[0] = CHUNK_VERSION;
      return b64(noise);
    }
    case 'not base64': {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/= %!-_';
      return Array.from({ length: rng.int(0, 40) }, () => rng.pick([...chars])).join('');
    }
    case 'props written by hand': {
      // the planes as written, then a props section of its own: tiles anywhere, the rectangle's
      // last and those past it included, any count, kind byte, escape and offset
      bytes.pop(); // the count of tiles with props, 0
      const varint = (v: number) => {
        for (; v >= 0x80; v = Math.floor(v / 0x80)) bytes.push((v % 0x80) | 0x80);
        bytes.push(v);
      };
      const n = g.w * g.h;
      const tiles = rng.int(0, 4);
      varint(tiles);
      for (let t = 0; t < tiles; t++) {
        const more = rng.int(0, 3);
        const gap = rng.chance(0.3) ? rng.int(n - 1, n + 1) : rng.int(0, Math.ceil(n / tiles));
        varint(gap * 4 + more);
        const extra = rng.int(0, 3);
        if (more === 3) varint(extra);
        for (let k = more < 3 ? more + 1 : 4 + extra; k > 0; k--) {
          if (rng.chance(0.15)) {
            bytes.push(31);
            varint(rng.int(0, PROP_KINDS.length + 2));
            varint(rng.int(0, 1000));
          } else if (rng.chance(0.8))
            bytes.push(rng.int(0, PROP_KINDS.length - 1) | (rng.int(0, 7) << 5));
          else bytes.push(rng.int(0, 255));
          bytes.push(rng.int(0, 255), rng.int(0, 255));
        }
      }
      return b64(bytes);
    }
  }
}

describe('stored chunks, over any generator, frame and text', () => {
  // 40 worlds up to 220 tiles a side, each built, grown and read back: about 0.7 s alone
  it('keep every stored tile and take the rest from the generator, whatever it makes', () => {
    let grown = 0;
    let still = 0;
    let overruled = 0;
    forAll(
      genGrowth,
      (g) => {
        const before = storedFrame(g);
        const after = grownFrame(g);
        const old = buildMap(g.seed, before, {}, hashed(g.salt));
        const store = Object.freeze({ ...old.chunks });
        const snapshot = JSON.stringify(store);
        const calls: Partial<MapGenParams>[] = [];
        const built = buildMap(g.seed, after, store, hashed(g.salt + 1, calls));
        const expected = grownChunks(before, after);
        expect(JSON.stringify(store)).toBe(snapshot);
        expect(built.added).toEqual(expected);
        expect(built.unreadable).toEqual([]);
        // the generator runs once, on the whole of the params, and only when a chunk is missing
        expect(calls).toEqual(expected.length ? [{ ...DEFAULT_MAP_PARAMS, ...after }] : []);
        if (expected.length) grown++;
        else still++;
        // every stored text is kept but those of part-chunks the map grew over, which now hold
        // all of the chunk the map covers
        expect(Object.keys(built.chunks).sort()).toEqual(
          [...new Set([...Object.keys(store), ...expected])].sort(),
        );
        for (const [k, text] of Object.entries(store))
          if (!expected.includes(k)) expect(built.chunks[k], `chunk ${k}`).toBe(text);
        for (const k of expected) {
          const { cx, cy } = parseChunkKey(k)!;
          const c = decodeChunk(built.chunks[k])!;
          const [x0, x1] = span(after.originX, after.w, cx);
          const [y0, y1] = span(after.originY, after.h, cy);
          expect([c.x0, c.y0, c.w, c.h], `chunk ${k}`).toEqual([x0, y0, x1 - x0, y1 - y0]);
        }
        // stored tiles exactly as stored; the rest the generator's, as a chunk stores them
        const kept = firstDifference(built.map, old.map);
        if (kept) throw new Error(`stored ground changed: ${kept}`);
        const now = hashed(g.salt + 1)(g.seed, { ...DEFAULT_MAP_PARAMS, ...after });
        if (firstDifference(old.map, now, { near: true })) overruled++;
        const fresh = (wx: number, wy: number) => !covers(before, wx, wy);
        const made = firstDifference(built.map, now, { near: true, only: fresh });
        if (made) throw new Error(`a new tile is not the generator's: ${made}`);
        // the store it returns is whole: a reload reads it alone, to the same map and store
        const again = buildMap(g.seed, after, built.chunks, never);
        expect(again.added).toEqual([]);
        expect(again.chunks).toEqual(built.chunks);
        const reload = firstDifference(again.map, built.map);
        if (reload) throw new Error(`a reload differs: ${reload}`);
      },
      {
        seeds: Array.from({ length: 40 }, (_, i) => i + 1),
        shrink: shrinkGrowth,
        shrinkBudget: 200,
      },
    );
    // both kinds of case ran, and the generator would have made other ground where it is stored
    expect(grown).toBeGreaterThan(0);
    expect(still).toBeGreaterThan(0);
    expect(overruled).toBeGreaterThan(0);
  }, 30_000);

  it('read any map inside the stored ground from the store alone', () => {
    forAll(
      (rng) => {
        const w = rng.int(1, 100);
        const h = rng.int(1, 100);
        const sw = rng.int(1, w);
        const sh = rng.int(1, h);
        return {
          seed: rng.int(0, 2 ** 31 - 1),
          salt: rng.int(1, 999_999),
          w,
          h,
          ox: rng.int(-80, 80),
          oy: rng.int(-80, 80),
          dx: rng.int(0, w - sw),
          dy: rng.int(0, h - sh),
          sw,
          sh,
        };
      },
      (c) => {
        const frame = { w: c.w, h: c.h, originX: c.ox, originY: c.oy };
        const base = buildMap(c.seed, frame, {}, hashed(c.salt));
        const store = Object.freeze({ ...base.chunks });
        const inner = { w: c.sw, h: c.sh, originX: c.ox + c.dx, originY: c.oy + c.dy };
        const built = buildMap(c.seed, inner, store, never);
        expect(built.added).toEqual([]);
        expect(built.unreadable).toEqual([]);
        expect(built.chunks).toEqual(store);
        expect([built.map.w, built.map.h, built.map.originX, built.map.originY]).toEqual([
          c.sw,
          c.sh,
          c.ox + c.dx,
          c.oy + c.dy,
        ]);
        const where = firstDifference(built.map, base.map);
        if (where) throw new Error(where);
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1) },
    );
  });

  // 16 worlds up to 256 tiles a side, each generated three times: about 1.2 s alone
  it('grown under generateMap unchanged are the store of the grown world, text for text', () => {
    let oil = 0;
    forAll(
      genRealGrowth,
      (c) => {
        const chain = chainOf(c.full);
        const gen = generateChain(chain);
        const before = { ...c.sliders, w: c.x.len, h: c.y.len, originX: c.ox, originY: c.oy };
        const after = {
          ...c.sliders,
          w: c.x.big,
          h: c.y.big,
          originX: c.ox - 32 * c.x.before,
          originY: c.oy - 32 * c.y.before,
        };
        const old = buildMap(c.seed, before, {}, gen);
        const built = buildMap(c.seed, after, old.chunks, gen);
        const g = generateMap(c.seed, after, chain);
        // oil only in the full chain
        if (hasOil(g)) {
          expect(c.full, 'oil in the simple chain').toBe(true);
          oil++;
        }
        const fresh = encodeMap(g);
        expect(Object.keys(built.chunks).sort()).toEqual(Object.keys(fresh).sort());
        for (const k of Object.keys(fresh))
          if (built.chunks[k] !== fresh[k]) throw new Error(`chunk ${k} is not the grown world's`);
        expect(built.added).toEqual(grownChunks(before, after));
        const where = firstDifference(built.map, g, { near: true });
        if (where) throw new Error(`against generateMap: ${where}`);
        const kept = firstDifference(old.map, built.map);
        if (kept) throw new Error(`stored ground changed: ${kept}`);
      },
      {
        seeds: Array.from({ length: 16 }, (_, i) => i + 1),
        shrink: shrinkRealGrowth,
        shrinkBudget: 40,
      },
    );
    // full-chain worlds with their oil ran
    expect(oil).toBeGreaterThan(0);
  }, 60_000);

  // 300 texts, each read and built into a map of its chunk: about 0.7 s alone
  it('read any text as a chunk or as nothing, never throwing, and write back what they read', () => {
    const seen = new Set<string>();
    forAll(
      genGarbled,
      (g) => {
        const text = garble(g);
        const c = decodeChunk(text);
        seen.add(`${g.how}: ${c ? 'read' : 'refused'}`);
        // a load never throws on it: the text is kept and reported, or its planes placed
        const built = buildMap(1, { w: 32, h: 32 }, { '0,0': text }, hashed(7));
        if (!c) {
          expect(built.unreadable).toEqual(['0,0']);
          expect(built.chunks['0,0']).toBe(text);
          return;
        }
        expect(built.unreadable).toEqual([]);
        // what it reads is a chunk encodeChunk can write
        const n = c.w * c.h;
        expect(c.version >= 1 && c.version <= CHUNK_VERSION).toBe(true);
        expect(c.w >= 1 && c.h >= 1 && c.x0 + c.w <= 32 && c.y0 + c.h <= 32).toBe(true);
        expect([c.terrain.length, c.biome.length, c.climate.length, c.variant.length]).toEqual([
          n,
          n,
          n,
          n,
        ]);
        expect(c.terrain.every((v) => v <= 15) && c.biome.every((v) => v <= 15)).toBe(true);
        expect(c.climate.every((v) => v <= 15)).toBe(true);
        // a chunk stored before the climate plane has its biome for its climate
        if (c.version < 2) expect([...c.climate]).toEqual([...c.biome]);
        expect(c.variant.every((v) => v <= 3)).toBe(true);
        for (const [i, list] of c.props) {
          expect(Number.isInteger(i) && i >= 0 && i < n, `prop tile ${i} of ${n}`).toBe(true);
          expect(list.length).toBeGreaterThan(0);
          for (const p of list) {
            expect(PROP_KINDS).toContain(p.kind);
            expect(Number.isSafeInteger(p.variant) && p.variant >= 0).toBe(true);
            for (const o of [p.ox, p.oy])
              expect(Number.isInteger(o * 256) && o >= -0.5 && o < 0.5, `offset ${o}`).toBe(true);
          }
        }
        // the map has its planes where the text puts them
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const i = (c.y0 + y) * 32 + c.x0 + x;
            const j = y * c.w + x;
            const tile = [
              built.map.terrain[i],
              built.map.biome[i],
              built.map.climate![i],
              built.map.variant[i],
            ];
            expect(tile, `tile (${x}, ${y})`).toEqual([
              c.terrain[j],
              c.biome[j],
              c.climate[j],
              c.variant[j],
            ]);
            expect(built.map.props.get(i)).toEqual(c.props.get(j));
          }
        // and its planes, put on a map and written again, read the same
        const m = emptyMap(0, c.w, c.h, Terrain.Grass, c.x0, c.y0);
        placeChunk(m, 0, 0, c);
        expect(decodeChunk(encodeChunk(m, 0, 0))).toEqual({ ...c, version: CHUNK_VERSION });
      },
      {
        seeds: Array.from({ length: 300 }, (_, i) => i + 1),
        shrink: shrinkGarbled,
        format: (g) => `${JSON.stringify(g)}, text ${garble(g)}`,
        shrinkBudget: 500,
      },
    );
    // both ways out were taken, a hand-written props section read and refused among them
    for (const way of [
      'bytes changed: read',
      'bytes changed: refused',
      'props written by hand: read',
      'props written by hand: refused',
      'noise: refused',
      'not base64: refused',
    ])
      expect(seen).toContain(way);
  }, 30_000);
});

describe('the seam between a stored chunk and a new one', () => {
  // Levels are not stored: they are read from the terrain of the map as built, which caps every
  // tile at one level above its neighbours, so the seam needs no easing of its own.

  /** The level terrain `t` rises to on open ground (elevation.ts). */
  const peak = (t: number) => (t === Terrain.Hill ? 2 : t === Terrain.Mountain ? 4 : 0);
  // a ring made by another generator meets the stored chunks along the old edge of the map
  const rings: [string, (i: number) => Terrain][] = [
    ['mountain', () => Terrain.Mountain],
    ['water', () => Terrain.Water],
    ['hill and mountain stripes', (i) => (i % 2 ? Terrain.Hill : Terrain.Mountain)],
  ];

  // three worlds of 96 tiles grown to 160, each planning its rivers once (#341), every tile's
  // level read: about 0.9 s alone for each ring
  it.each(rings)(
    'keeps neighbouring levels within one step against a ring of %s',
    (_, fill) => {
      let steep = 0;
      for (const seed of [1, 7412, 20260912]) {
        const params: Frame = { w: 96, h: 96 };
        const old = buildMap(seed, params, {});
        const ring: MapGenerator = (s, p) => {
          const m = emptyMap(s, p.w!, p.h!, Terrain.Grass, p.originX, p.originY);
          for (let i = 0; i < m.w * m.h; i++) m.terrain[i] = fill(i);
          return m;
        };
        const map = buildMap(seed, grow(params), old.chunks, ring).map;
        const levels = tileLevels(map);
        const oldLevels = tileLevels(old.map);
        const stored = (x: number, y: number) =>
          x >= CHUNK_TILES && y >= CHUNK_TILES && x < CHUNK_TILES + 96 && y < CHUNK_TILES + 96;
        for (let y = 0; y < map.h; y++)
          for (let x = 0; x < map.w; x++) {
            const k = y * map.w + x;
            const at = `seed ${seed}, tile (${x}, ${y})`;
            for (const [nx, ny] of [
              [x - 1, y],
              [x, y - 1],
            ]) {
              if (nx < 0 || ny < 0) continue;
              const n = ny * map.w + nx;
              if (Math.abs(levels[k] - levels[n]) > 1) throw new Error(`a step of two at ${at}`);
              // a pair across the seam whose terrains would stand more than a level apart
              if (stored(x, y) !== stored(nx, ny))
                if (Math.abs(peak(map.terrain[k]) - peak(map.terrain[n])) > 1) steep++;
            }
            // the local reading agrees with the whole-map one, across the seam too
            if (levelAt(map, x, y) !== levels[k]) throw new Error(`levelAt disagrees at ${at}`);
            // the new ring never lowers stored ground: what it held at the old edge it holds or more
            if (stored(x, y)) {
              const was = oldLevels[(y - CHUNK_TILES) * 96 + x - CHUNK_TILES];
              if (levels[k] < was) throw new Error(`stored ground sank from ${was} at ${at}`);
            }
          }
      }
      if (fill(0) !== Terrain.Water) expect(steep).toBeGreaterThan(0);
    },
    20_000,
  );

  // 40 worlds up to 220 tiles a side, each tile's level read twice: about 0.3 s alone
  it('keeps levels within one step and never lowers stored ground, for any growth and generator', () => {
    let steep = 0;
    forAll(
      genGrowth,
      (g) => {
        const before = storedFrame(g);
        const after = grownFrame(g);
        const old = buildMap(g.seed, before, {}, hashed(g.salt));
        const map = buildMap(g.seed, after, old.chunks, hashed(g.salt + 1)).map;
        const levels = tileLevels(map);
        const oldLevels = tileLevels(old.map);
        const stored = (x: number, y: number) => covers(before, x + map.originX, y + map.originY);
        for (let y = 0; y < map.h; y++)
          for (let x = 0; x < map.w; x++) {
            const k = y * map.w + x;
            const at = `world tile (${x + map.originX}, ${y + map.originY})`;
            for (const [nx, ny] of [
              [x - 1, y],
              [x, y - 1],
            ]) {
              if (nx < 0 || ny < 0) continue;
              const n = ny * map.w + nx;
              if (Math.abs(levels[k] - levels[n]) > 1) throw new Error(`a step of two at ${at}`);
              if (stored(x, y) !== stored(nx, ny))
                if (Math.abs(peak(map.terrain[k]) - peak(map.terrain[n])) > 1) steep++;
            }
            if (levelAt(map, x, y) !== levels[k]) throw new Error(`levelAt disagrees at ${at}`);
            if (stored(x, y)) {
              const ox = x + map.originX - old.map.originX;
              const oy = y + map.originY - old.map.originY;
              const was = oldLevels[oy * old.map.w + ox];
              if (levels[k] < was) throw new Error(`stored ground sank from ${was} at ${at}`);
            }
          }
      },
      {
        seeds: Array.from({ length: 40 }, (_, i) => i + 1),
        shrink: shrinkGrowth,
        shrinkBudget: 200,
      },
    );
    // pairs across the seam whose terrains would stand more than a level apart did occur
    expect(steep).toBeGreaterThan(0);
  }, 30_000);
});
