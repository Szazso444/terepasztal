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
  type ChunkPlanes,
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from './mapgen';
import { levelAt, tileLevels } from './elevation';
import { bytesOf, oldChunkText, textOf, type OldVersion } from './oldChunkTexts';
import { MAX_DROP, fallFeature } from './waterfalls';
import { Dir } from '../engine/iso';
import { generatorOf, groundOf, type GeneratedWorld } from '../sim/ground';
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

  // slow because each of 100 maps up to 32 x 32 tiles is stored and built back whole: 0.4 s alone,
  // so a limit of 30 s
  it('holds any value it allows, in tiles as odd as it allows', () => {
    // every terrain and biome id 0 to 15, every variant, long and single runs, props by the
    // dozen and with escaped kinds and variants, on a part of a chunk off the grid; variants
    // emptyMap's own or any, of seeds of every kind (integers small and large, and no integer)
    forAll(
      (rng) => {
        const w = rng.int(1, 32);
        const h = rng.int(1, 32);
        const map = emptyMap(
          rng.pick([rng.int(0, 1000), rng.int(0, 2 ** 31 - 1), -7, 0.5, 2 ** 45, -(2 ** 41)]),
          w,
          h,
          Terrain.Grass,
          rng.int(-50, 50),
          rng.int(-50, 50),
        );
        const runs = rng.chance(0.5);
        const own = rng.chance(0.3);
        for (let i = 0; i < w * h; i++) {
          map.terrain[i] = runs && i > 0 && rng.chance(0.9) ? map.terrain[i - 1] : rng.int(0, 15);
          map.biome[i] = runs && i > 0 && rng.chance(0.97) ? map.biome[i - 1] : rng.int(0, 15);
          if (!own || rng.chance(0.05)) map.variant[i] = rng.int(0, 3);
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
  }, 30_000);

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
 * A text for decodeChunk, as a recipe: the text of `version` for the rectangle (`x0`, `y0`, `w`,
 * `h`) of chunk (0, 0) with `hashed(salt)`'s planes (encodeChunk's for today's version, version
 * `version`'s from oldChunkTexts.ts for an older one), broken as `how` says with the stream of
 * `Rng(edit)`. Shrinking the rectangle keeps the recipe, so a failure shrinks to a small chunk
 * broken the same way.
 */
interface Garbled {
  how: (typeof GARBLES)[number];
  version: number;
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
  const how = rng.pick(GARBLES);
  return {
    how,
    // a props section by hand goes last, where versions 1 and 2 have theirs
    version: how === 'props written by hand' ? rng.int(1, 2) : rng.int(1, CHUNK_VERSION),
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
  const text = encodeChunk(map, 0, 0);
  const written =
    g.version === CHUNK_VERSION ? text : oldChunkText(decodeChunk(text)!, g.version as OldVersion);
  const bytes = Array.from(atob(written), (ch) => ch.charCodeAt(0));
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
        seen.add(`${g.how}, version ${g.version}: ${c ? 'read' : 'refused'}`);
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
    // both ways out were taken, a hand-written props section read and refused among them, and
    // texts of today's version broken each way were refused. Not every one is: a text with bytes
    // changed, put in or taken out may read, to other planes (no version checks its bytes); only
    // one cut short or run on never does (tested below)
    for (const way of [
      'bytes changed: read',
      'bytes changed: refused',
      'props written by hand: read',
      'props written by hand: refused',
      'noise: refused',
      'not base64: refused',
      `bytes changed, version ${CHUNK_VERSION}: refused`,
      `cut short, version ${CHUNK_VERSION}: refused`,
      `bytes put in, version ${CHUNK_VERSION}: refused`,
      `bytes taken out, version ${CHUNK_VERSION}: refused`,
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

// Stored ground compact enough for browser storage (#392): version 5 holds what version 4 held in
// a fraction of its text, and a text of every earlier version reads as it always has. The texts
// of earlier versions come from oldChunkTexts.ts, an oracle written apart from chunks.ts.

/** A chunk's planes as plain arrays, so that a difference shows tile by tile. */
const plain = (c: ChunkPlanes) => ({
  ...c,
  terrain: [...c.terrain],
  biome: [...c.biome],
  climate: [...c.climate],
  variant: [...c.variant],
  waterSurface: [...c.waterSurface],
  flow: [...c.flow],
  flowDir: [...c.flowDir],
  feature: [...c.feature],
  props: [...c.props].sort((a, b) => a[0] - b[0]),
});

/** The first thing chunk planes `a` and `b` differ in, or null: quicker than toEqual on planes. */
function planesDiffer(a: ChunkPlanes, b: ChunkPlanes): string | null {
  for (const k of ['version', 'x0', 'y0', 'w', 'h'] as const)
    if (a[k] !== b[k]) return `${k} ${a[k]}, not ${b[k]}`;
  for (const k of [
    'terrain',
    'biome',
    'climate',
    'variant',
    'waterSurface',
    'flow',
    'flowDir',
    'feature',
  ] as const) {
    if (a[k].constructor !== b[k].constructor || a[k].length !== b[k].length) return `${k}'s plane`;
    for (let i = 0; i < a[k].length; i++)
      if (a[k][i] !== b[k][i]) return `${k} ${a[k][i]}, not ${b[k][i]}, at tile ${i}`;
  }
  const props = (c: ChunkPlanes) => JSON.stringify([...c.props].sort((p, q) => p[0] - q[0]));
  return props(a) === props(b) ? null : `props ${props(a)}, not ${props(b)}`;
}

/**
 * What a text of `version` holds of chunk planes `c`: all of them but those the version came
 * before, which read empty (its climate its biome before 2, no water planes before 3, no water
 * features before 4).
 */
function heldBy(c: ChunkPlanes, version: number): ChunkPlanes {
  const n = c.w * c.h;
  return {
    ...c,
    version,
    climate: version >= 2 ? c.climate : c.biome,
    waterSurface: version >= 3 ? c.waterSurface : new Uint8Array(n),
    flow: version >= 3 ? c.flow : new Uint16Array(n),
    flowDir: version >= 3 ? c.flowDir : new Uint8Array(n),
    feature: version >= 4 ? c.feature : new Uint8Array(n),
  };
}

/** Each text of `chunks` as version `version` writes its planes. */
const inVersion = (chunks: ChunkStore, version: OldVersion): ChunkStore =>
  Object.fromEntries(
    Object.entries(chunks).map(([k, t]) => [k, oldChunkText(decodeChunk(t)!, version)]),
  );

/** Whether the water planes and features of maps `a` and `b` of one frame are the same. */
function sameWater(a: GameMap, b: GameMap): boolean {
  const planes = (m: GameMap) => [m.waterSurface!, m.flow!, m.flowDir!, m.feature!];
  return planes(a).every((p, k) => p.every((v, i) => v === planes(b)[k][i]));
}

describe('chunk texts of every version (#392)', () => {
  // Versions 3 and 4 as chunks.ts spells them out, for the 3 x 2 tiles from (1, 2): header 0V 01
  // 02 03 02; terrain water, water, grass, grass, water, water (31 01 31); biome river, river,
  // plains, plains, lake, lake (71 01 61); climate six plains (05); variant 1 0 0 3 2 3 (C1 0E);
  // props on one tile, the third: a skip of 2 with one prop (08), flowers of variant 3 (6A) at 64
  // and -32 256ths of a tile (40 E0); water levels 2 2 0 0 1 1 (21 01 11); two river tiles, both
  // running east: a skip of 0 and flow 5 (00 15), a skip of 0 and flow 7 (00 1D); and in version 4
  // one feature, a skip of 1 and a waterfall of 1 over the east edge (01 01 09).
  const head = [1, 2, 3, 2];
  const planes = [0x31, 0x01, 0x31, 0x71, 0x01, 0x61, 0x05, 0xc1, 0x0e];
  const props = [0x01, 0x08, 0x6a, 0x40, 0xe0];
  const water = [0x21, 0x01, 0x11, 0x02, 0x00, 0x15, 0x00, 0x1d];
  const features = [0x01, 0x01, 0x09];
  const spelled: ChunkPlanes = {
    version: 4,
    x0: 1,
    y0: 2,
    w: 3,
    h: 2,
    terrain: Uint8Array.of(3, 3, 0, 0, 3, 3),
    biome: Uint8Array.of(7, 7, 0, 0, 6, 6),
    climate: new Uint8Array(6),
    variant: Uint8Array.of(1, 0, 0, 3, 2, 3),
    props: new Map([[2, [{ kind: 'flowers', variant: 3, ox: 0.25, oy: -0.125 }]]]),
    waterSurface: Uint8Array.of(2, 2, 0, 0, 1, 1),
    flow: Uint16Array.of(5, 7, 0, 0, 0, 0),
    flowDir: Uint8Array.of(Dir.E + 1, Dir.E + 1, 0, 0, 0, 0),
    feature: Uint8Array.of(0, fallFeature(1, Dir.E), 0, 0, 0, 0),
  };

  it('of versions 3 and 4 decodes as it always has', () => {
    const v3 = textOf([3, ...head, ...planes, ...props, ...water]);
    const v4 = textOf([4, ...head, ...planes, ...props, ...water, ...features]);
    expect(decodeChunk(v4)).toEqual(spelled);
    expect(decodeChunk(v3)).toEqual(heldBy(spelled, 3));
    // the oracle the other tests take older texts from writes these very bytes
    expect(oldChunkText(spelled, 4)).toBe(v4);
    expect(oldChunkText(spelled, 3)).toBe(v3);
  });

  // Version 5's texts pinned the same way: the planes above as chunk (-1, 2) of a world of seed
  // 7412; and the 12 x 10 tiles from (0, 0) that generateMap made for seed 7412 in the full chain,
  // as version 4 and version 5 store them. A change to version 5's model reads them otherwise, so
  // it needs a version of its own.
  const V5_SPELLED = 'BQECAwLocwEEOAHBhXgCXXpQWJ6XfMJBx1qzwAAA';
  const V4_GENERATED =
    'BAAADAoxUQVRMFEGUTBQCTBQCTBQECIFMBEiBTARIgUwEgc0BhMwBmEJYApwCnAQCXARCHASB3ASB3ASB3QGE3AGDwgQ' +
    'ChEJEggTB0ASB0ASB0ATBhQGU5OQZSfuZNXjzplKSdgG7IQjgJjKIPShq+aAUXjnGkhDWFMoI8S3AAMQFgBq/M0sCirt' +
    'GEE5VQxqvr4EKiNLAEYOUw5AzApEvsQkrbMAQS0wFEOtSxEGCypAzwUBBL4pRiCwEAofOwgKBv8IQVG+AAYg7QAA4TBE' +
    'DvQACUE6JkYIwQIg8SQA0FcA9iAAQPbSAkE380YawUFJFRQO/AAEDvgAD2gMGJQEC5AEC4wEC4gEC4QEC4AEC/wDAPMD' +
    'AOcDAN8DANcDC8gDAA==';
  const V5_GENERATED =
    'BQAADArocwAAOUQvcR4Qb3RdCjxBkI+u6PfnF9PI9ntMvf+nyPkEohffnQoZpCeKLRzE/NrlWJpVpPRtghPqIswmBOaB' +
    'cBxtcckNMBR2NUsM4r8vAg==';

  it('of version 5 decodes as it always has, and is written so again', () => {
    expect(decodeChunk(V5_SPELLED)).toEqual({ ...spelled, version: 5 });
    const m = emptyMap(7412, 3, 2, Terrain.Grass, -CHUNK_TILES + 1, 2 * CHUNK_TILES + 2);
    placeChunk(m, -1, 2, decodeChunk(V5_SPELLED)!);
    expect(encodeChunk(m, -1, 2)).toBe(V5_SPELLED);
    // the generated tiles: rivers, oil and five kinds of tree among them, the same in both texts
    const v4 = decodeChunk(V4_GENERATED)!;
    expect(v4.flowDir.filter((d) => d).length).toBeGreaterThan(0);
    expect(new Set([...v4.props.values()].flat().map((p) => p.kind)).size).toBeGreaterThan(5);
    expect(plain(decodeChunk(V5_GENERATED)!)).toEqual(plain({ ...v4, version: 5 }));
    const g = emptyMap(7412, 12, 10);
    placeChunk(g, 0, 0, v4);
    expect(encodeChunk(g, 0, 0)).toBe(V5_GENERATED);
    expect(V5_GENERATED.length).toBeLessThan(V4_GENERATED.length / 2);
  });

  // six worlds of 49 chunks, each chunk read from a text of every version and written again:
  // about 4 s alone
  it('reads every chunk of a world to the same planes from the text of every version', () => {
    const params = { w: 224, h: 224, originX: -96, originY: -96 };
    for (const seed of [1, 7412, 20260912])
      for (const full of [false, true]) {
        const chain = chainOf(full);
        const { map, chunks } = buildMap(seed, params, {}, generateChain(chain));
        // through today's text the map is generation's, its props at the nearest 256th of a tile
        const generated = generateMap(seed, params, chain);
        const where = firstDifference(map, generated, { near: true });
        if (where) throw new Error(`seed ${seed}, ${chain}: ${where}`);
        expect(sameWater(map, generated), `seed ${seed}, ${chain}: water`).toBe(true);
        for (const [key, text] of Object.entries(chunks)) {
          const { cx, cy } = parseChunkKey(key)!;
          const at = `seed ${seed}, ${chain}, chunk ${key}`;
          const now = decodeChunk(text)!;
          expect(now.version, at).toBe(CHUNK_VERSION);
          for (const list of now.props.values())
            for (const p of list)
              if (!Number.isInteger(p.ox * 256) || !Number.isInteger(p.oy * 256))
                throw new Error(`${at}: a prop at (${p.ox}, ${p.oy}), not on a 256th of a tile`);
          for (const version of [1, 2, 3, 4] as const) {
            const old = decodeChunk(oldChunkText(now, version))!;
            const read = planesDiffer(old, heldBy(now, version));
            if (read) throw new Error(`${at}, version ${version}: ${read}`);
            // written again, as a chunk is once the map grows over it, it reads as it did
            const wx = cx * CHUNK_TILES + old.x0;
            const m = emptyMap(seed, old.w, old.h, Terrain.Grass, wx, cy * CHUNK_TILES + old.y0);
            placeChunk(m, cx, cy, old);
            const again = decodeChunk(encodeChunk(m, cx, cy))!;
            const written = planesDiffer(again, { ...old, version: CHUNK_VERSION });
            if (written) throw new Error(`${at}, version ${version} written again: ${written}`);
          }
        }
      }
  }, 30_000);

  // six worlds of 49 chunks and two of 784, each stored in both versions: about 4 s alone
  it('stores a world in at most half the text version 4 took, a 784-chunk world too', () => {
    const worlds: [number, SupplyMode, Frame][] = [];
    for (const chain of SUPPLY_MODES) {
      for (const seed of [1, 7412, 20260912])
        worlds.push([seed, chain, { w: 224, h: 224, originX: -96, originY: -96 }]);
      worlds.push([1, chain, { w: 896, h: 896, originX: -416, originY: -416 }]);
    }
    for (const [seed, chain, params] of worlds) {
      const { chunks } = buildMap(seed, params, {}, generateChain(chain));
      const at = `seed ${seed}, ${chain}, ${Object.keys(chunks).length} chunks`;
      expect(Object.keys(chunks)).toHaveLength((params.w / CHUNK_TILES) * (params.h / CHUNK_TILES));
      const now = JSON.stringify(chunks).length;
      const before = JSON.stringify(inVersion(chunks, 4)).length;
      expect(now / before, at).toBeLessThanOrEqual(0.5);
    }
  }, 60_000);

  it("guesses a chunk's variants from its world's seed, whatever number the seed is", () => {
    // the head spelled out: version 5 and the rectangle; the seed as a zigzagged varint (7412: E8
    // 73), or as the varint 2^53 - 1 (FF seven times, 0F) and its float64, the lowest byte first
    // (0.5: 00 six times, E0 3F); then cx and cy zigzagged (-3: 05, 2: 04)
    const head = (seed: number) =>
      bytesOf(encodeChunk(emptyMap(seed, 1, 1, Terrain.Grass, -3 * CHUNK_TILES, 64), -3, 2));
    expect(head(7412).slice(0, 9)).toEqual([5, 0, 0, 1, 1, 0xe8, 0x73, 5, 4]);
    const float = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0, 0, 0, 0, 0, 0, 0xe0, 0x3f];
    expect(head(0.5).slice(0, 23)).toEqual([5, 0, 0, 1, 1, ...float, 5, 4]);
    // emptyMap's variants are map generation's: guessed from the seed, a chunk of them costs a bit
    // a row; missed, two bits a tile, 256 bytes for the chunk
    for (const seed of [...ANY_SEEDS, -0, -Infinity, NaN, Number.MAX_VALUE, -Number.MIN_VALUE])
      for (const [cx, cy] of [
        [0, 0],
        [-3, 2],
      ]) {
        const m = emptyMap(seed, 32, 32, Terrain.Grass, cx * CHUNK_TILES, cy * CHUNK_TILES);
        const text = encodeChunk(m, cx, cy);
        const at = `seed ${seed}, chunk ${cx},${cy}`;
        expect(bytesOf(text).length, at).toBeLessThanOrEqual(48);
        expect(decodeChunk(text)!.variant, at).toEqual(m.variant);
      }
  });

  // a world of 49 chunks stored in every version, loaded twice and grown a ring: about 0.4 s alone
  it("loads a store holding chunks of every version unchanged, and grows it in today's", () => {
    const params = { w: 224, h: 224, originX: -96, originY: -96 };
    const made = buildMap(7412, params, {});
    // each chunk in a version 1 to CHUNK_VERSION by where it lies
    const versionAt = (cx: number, cy: number) =>
      ((((cx + 2 * cy) % CHUNK_VERSION) + CHUNK_VERSION) % CHUNK_VERSION) + 1;
    const store: ChunkStore = {};
    // the map as each chunk's own version reads it
    const want = emptyMap(7412, params.w, params.h, Terrain.Grass, params.originX, params.originY);
    for (const [key, text] of Object.entries(made.chunks)) {
      const { cx, cy } = parseChunkKey(key)!;
      const v = versionAt(cx, cy);
      store[key] = v === CHUNK_VERSION ? text : oldChunkText(decodeChunk(text)!, v as OldVersion);
      placeChunk(want, cx, cy, heldBy(decodeChunk(text)!, v));
    }
    const versions = new Set(Object.values(store).map((t) => decodeChunk(t)!.version));
    expect([...versions].sort()).toEqual(Array.from({ length: CHUNK_VERSION }, (_, k) => k + 1));
    // loaded as a game loads its ground: nothing generated, every text kept as it was
    const world: GeneratedWorld = {
      kind: 'generated',
      seed: 7412,
      params: { ...DEFAULT_MAP_PARAMS, ...params },
      chunks: { ...store },
    };
    const loaded = groundOf(world, never);
    expect(loaded.added).toEqual([]);
    expect(loaded.unreadable).toEqual([]);
    expect(world.chunks).toEqual(store);
    expect(firstDifference(loaded.map, want)).toBeNull();
    expect(sameWater(loaded.map, want)).toBe(true);
    // the save written from it reads the same again
    const saved = JSON.parse(JSON.stringify(world)) as GeneratedWorld;
    const again = groundOf(saved, never);
    expect(saved.chunks).toEqual(store);
    expect(firstDifference(again.map, loaded.map)).toBeNull();
    expect(sameWater(again.map, loaded.map)).toBe(true);
    // grown by a ring: every stored text as it was, and the new chunks in today's version
    const bigger: GeneratedWorld = { ...saved, params: { ...saved.params, ...grow(params) } };
    const grown = groundOf(bigger, generatorOf('simple'));
    for (const [k, t] of Object.entries(store)) expect(grown.chunks[k], k).toBe(t);
    expect(grown.added).toHaveLength(81 - 49);
    for (const k of grown.added) expect(decodeChunk(grown.chunks[k])!.version).toBe(CHUNK_VERSION);
    expect(firstDifference(want, grown.map)).toBeNull();
  }, 15_000);

  // a world of 48 tiles stored in each older version and grown to 96: about 0.1 s alone
  it('writes a part of a chunk stored in an older version again only when the map grows over it', () => {
    const small = { w: 48, h: 48 };
    const big = { w: 96, h: 96, originX: -32, originY: -32 };
    const first = buildMap(1, small, {});
    for (const version of [1, 2, 3, 4] as const) {
      const old = inVersion(first.chunks, version);
      // read on the frame it was stored on, every text stays as it is
      const read = buildMap(1, small, old, never);
      expect(read.chunks).toEqual(old);
      const grown = buildMap(1, big, old);
      // chunk 0,0 was whole and stays; 1,1 held a part and is written again, whole, in today's
      // version, its stored tiles as its old text reads them
      expect(grown.chunks['0,0']).toBe(old['0,0']);
      const c = decodeChunk(grown.chunks['1,1'])!;
      expect([c.version, c.x0, c.y0, c.w, c.h]).toEqual([CHUNK_VERSION, 0, 0, 32, 32]);
      expect(firstDifference(read.map, grown.map), `version ${version}`).toBeNull();
    }
  }, 15_000);
});

// Stored chunks checked apart from #392's own tests: version 5 holds any planes the encoding
// allows, all of them at once, in any chunk of a world of any seed, as every older version reads
// them; a chunk's text is a function of the chunk alone; no text of any version reads once cut
// short or run on; no text holds more props than its bytes pay for; and texts that the encoders of
// versions 1 to 4 wrote read as they did.

/**
 * Seeds of every kind a map may carry: integers version 5's head holds as a varint, the largest
 * and smallest among them, and numbers it holds as their float64 (no integer, or 2^52 or more in
 * size, as a player who types a long seed gets).
 */
const ANY_SEEDS = [
  0,
  1,
  7412,
  2 ** 31 - 1,
  2 ** 32 - 1,
  -7,
  -(2 ** 31),
  0.5,
  2 ** 40 - 1,
  2 ** 40,
  -(2 ** 40),
  12345678901234,
  2 ** 52 - 1,
  -(2 ** 52 - 1),
  2 ** 52,
  -(2 ** 52),
  2 ** 53 + 2,
  1e20,
  Infinity,
];

/**
 * A chunk part of every plane, drawn by `Rng(salt)`: the `w` x `h` tiles from (`x0`, `y0`) of chunk
 * (`cx`, `cy`) of a world of `seed`. A recipe, so a failure shrinks to a smaller part drawn alike.
 */
interface AnyPlanes {
  w: number;
  h: number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  seed: number;
  /** 0: every value at random; 1: in patches and runs; 2: also variants and props as generated */
  style: number;
  salt: number;
}
const genAnyPlanes = (rng: Rng): AnyPlanes => {
  const w = rng.int(1, 32);
  const h = rng.int(1, 32);
  // chunks near the start, and far enough out that version 5 has no guess for them
  const far = () => rng.pick([2 ** 40 - 1, 2 ** 40, 2 ** 45]) * (rng.chance(0.5) ? 1 : -1);
  return {
    w,
    h,
    x0: rng.int(0, 32 - w),
    y0: rng.int(0, 32 - h),
    cx: rng.chance(0.85) ? rng.int(-40, 40) : far(),
    cy: rng.chance(0.85) ? rng.int(-40, 40) : far(),
    seed: rng.chance(0.4) ? rng.int(0, 2 ** 31 - 1) : rng.pick(ANY_SEEDS),
    style: rng.int(0, 2),
    salt: rng.int(1, 2 ** 31 - 1),
  };
};
function* shrinkAnyPlanes(c: AnyPlanes): Iterable<AnyPlanes> {
  for (const w of shrinkInt(c.w, 1)) yield { ...c, w };
  for (const h of shrinkInt(c.h, 1)) yield { ...c, h };
  for (const x0 of shrinkInt(c.x0)) yield { ...c, x0 };
  for (const y0 of shrinkInt(c.y0)) yield { ...c, y0 };
  for (const cx of shrinkInt(c.cx)) yield { ...c, cx };
  for (const cy of shrinkInt(c.cy)) yield { ...c, cy };
}
const formatAnyPlanes = (c: AnyPlanes) => JSON.stringify(c);

/** The variants versions 1 to 4 hold: a varint of seven bytes at most. */
const OLD_VARIANTS = 2 ** 49;

/** A prop list of any kinds, variants and offsets; with `style` 2, mostly as generation lays it. */
function anyProps(rng: Rng, style: number, seed: number, wx: number, wy: number): PropInstance[] {
  const list: PropInstance[] = [];
  for (let k = 0, n = rng.chance(0.1) ? rng.int(4, 12) : rng.int(1, 3); k < n; k++) {
    const kind = PROP_KINDS[rng.int(0, PROP_KINDS.length - 1)];
    // decorateProps' variant and offsets of prop k (mapgen.ts)
    const generated = style === 2 && k < 3 && rng.chance(0.7);
    const variant = generated
      ? Math.floor(hash2(wx + k, wy - k, seed + 9) * rng.pick([2, 3, 4]))
      : rng.pick([
          rng.int(0, 7),
          rng.int(0, 7),
          rng.int(8, 1000),
          rng.int(2 ** 31, 2 ** 48),
          rng.chance(0.2) ? Number.MAX_SAFE_INTEGER : rng.int(0, 3),
        ]);
    const offset = (guess: number) =>
      generated && rng.chance(0.8)
        ? guess
        : rng.chance(0.2)
          ? rng.range(-1, 1) // off the 256ths and past the tile, which a chunk rounds and clamps
          : rng.int(-128, 127) / 256;
    list.push({
      kind,
      variant,
      ox: offset((hash2(wx * 3 + k, wy, seed + 7) - 0.5) * 0.7),
      oy: offset((hash2(wx, wy * 3 + k, seed + 8) - 0.5) * 0.7),
    });
  }
  return list;
}

/** The map of an AnyPlanes case: just its part of the chunk, with every plane drawn. */
function anyPlanesMap(c: AnyPlanes): GameMap {
  const rng = new Rng(c.salt);
  const { w, h } = c;
  const n = w * h;
  const ox = c.cx * CHUNK_TILES + c.x0;
  const oy = c.cy * CHUNK_TILES + c.y0;
  const map = emptyMap(c.seed, w, h, Terrain.Grass, ox, oy);
  const climate = (map.climate = new Uint8Array(n));
  const surface = (map.waterSurface = new Uint8Array(n));
  const flow = (map.flow = new Uint16Array(n));
  const flowDir = (map.flowDir = new Uint8Array(n));
  const feature = (map.feature = new Uint8Array(n));
  // an id 0 to 15: at random, or in patches, mostly the tile's left or upper neighbour's
  const id = (plane: Uint8Array, i: number) =>
    c.style > 0 && i > 0 && rng.chance(0.85)
      ? plane[i < w || rng.chance(0.7) ? i - 1 : i - w]
      : rng.int(0, 15);
  const rivers = rng.pick([0, 0.05, 0.3, 1]);
  const falls = rng.pick([0, 0.1, 0.6]);
  const props = rng.pick([0, 0.1, 0.5]);
  for (let i = 0; i < n; i++) {
    const x = i % w;
    map.terrain[i] = id(map.terrain, i);
    climate[i] = id(climate, i);
    map.biome[i] = c.style > 0 && rng.chance(0.6) ? climate[i] : id(map.biome, i);
    surface[i] = id(surface, i);
    // with style 2 the variant stays emptyMap's, generation's own, on most tiles
    if (c.style < 2 || rng.chance(0.05)) map.variant[i] = rng.int(0, 3);
    if (rng.chance(rivers)) {
      flowDir[i] = rng.int(1, 4);
      // along a river the flow is near its neighbour's
      const near =
        x > 0 && flowDir[i - 1] ? flow[i - 1] : i >= w && flowDir[i - w] ? flow[i - w] : -1;
      flow[i] =
        near >= 0 && rng.chance(0.5)
          ? Math.max(0, Math.min(FLOW_CAP, near + rng.int(-3, 3)))
          : rng.pick([0, 1, FLOW_CAP, rng.int(0, FLOW_CAP)]);
    }
    // a waterfall over its river's side or any other edge, or on a tile with no side at all
    if (rng.chance(falls)) {
      const edge = flowDir[i] && rng.chance(0.6) ? flowDir[i] - 1 : rng.int(0, 3);
      feature[i] = fallFeature(rng.int(1, MAX_DROP), edge as Dir);
    }
    if (rng.chance(props))
      map.props.set(i, anyProps(rng, c.style, c.seed, ox + x, oy + (i - x) / w));
  }
  return map;
}

/** Chunk planes of `version` holding all of `map`, a map of one chunk part from (`x0`, `y0`). */
function planesOfMap(map: GameMap, x0: number, y0: number, version: number): ChunkPlanes {
  const n = map.w * map.h;
  const props = new Map<number, PropInstance[]>();
  for (const [i, list] of map.props)
    if (list.length)
      props.set(
        i,
        list.map((p) => ({ kind: p.kind, variant: p.variant, ox: stored(p.ox), oy: stored(p.oy) })),
      );
  return {
    version,
    x0,
    y0,
    w: map.w,
    h: map.h,
    terrain: map.terrain,
    biome: map.biome,
    climate: map.climate ?? map.biome,
    variant: map.variant,
    props,
    waterSurface: map.waterSurface ?? new Uint8Array(n),
    flow: map.flow ?? new Uint16Array(n),
    flowDir: map.flowDir ?? new Uint8Array(n),
    feature: map.feature ?? new Uint8Array(n),
  };
}
/** Whether versions 1 to 4 can hold the variants of every prop of `map`. */
const oldVersionsHold = (map: GameMap) =>
  [...map.props.values()].every((list) => list.every((p) => p.variant < OLD_VARIANTS));

/**
 * A chunk part with something of everything, spelled out: forest, hills, rock, mountain, sand and
 * a lake under a river; a climate apart from the biome; rivers running every way with a flow of 0,
 * of a two-byte varint and FLOW_CAP; waterfalls over their river's side, over another edge and on a
 * tile with no side; props by the one, three and five, an escaped variant, offsets at both ends.
 * The 6 x 4 tiles from (5, 9) of chunk (-3, 2) of a world of seed 7412, ids in hex, in rows.
 */
function fixtureMap(): GameMap {
  const plane = (s: string) => Uint8Array.from(s.replace(/ /g, ''), (ch) => parseInt(ch, 16));
  const m = emptyMap(7412, 6, 4, Terrain.Grass, -3 * CHUNK_TILES + 5, 2 * CHUNK_TILES + 9);
  m.terrain = plane('110033 100333 220335 644335');
  m.biome = plane('110077 100776 330768 999768');
  m.climate = plane('110000 110000 333002 333002');
  m.variant = plane('012301 230123 333300 123012');
  m.waterSurface = plane('000033 000322 000220 000110');
  m.flowDir = new Uint8Array(24);
  m.flow = new Uint16Array(24);
  m.feature = new Uint8Array(24);
  for (const [i, side, flow] of [
    [4, Dir.S, 200],
    [5, Dir.N, 1],
    [9, Dir.S, 5],
    [15, Dir.S, FLOW_CAP],
    [21, Dir.W, 0],
  ]) {
    m.flowDir[i] = side + 1;
    m.flow[i] = flow;
  }
  m.feature[4] = fallFeature(1, Dir.S);
  m.feature[9] = fallFeature(4, Dir.E);
  m.feature[18] = fallFeature(2, Dir.W);
  const p = (kind: PropInstance['kind'], variant: number, ox: number, oy: number) => ({
    kind,
    variant,
    ox: ox / 256,
    oy: oy / 256,
  });
  m.props.set(0, [p('tree', 0, 64, -32)]);
  m.props.set(1, [p('pine', 2, 0, 0), p('spruce', 7, -128, 127), p('oak', 8, 1, -1)]);
  m.props.set(6, [
    p('birch', 0, 10, 20),
    p('flowers', 1, -10, -20),
    p('reeds', 300, 90, -90),
    p('boulder', 3, 0, 127),
    p('wheat', 4, -128, 0),
  ]);
  m.props.set(13, [p('rock', 1, 33, 44)]);
  m.props.set(18, [p('oil', 2, 0, 0)]);
  m.props.set(23, [p('palm', 3, -77, 55)]);
  return m;
}

/**
 * fixtureMap's chunk as the encoders of versions 1 to 4 wrote it, each run from the commit that
 * made it (32fdc93, version 1 with wheat; 37a0048; a588d0d; 3d24617, develop's before #392). The
 * bytes of saves already made: never re-blessed.
 */
const WRITTEN: Record<OldVersion, string> = {
  1:
    'AQUJBgQRATEQATIhADFQYEExUBEBcRABcWAxAHBggJJwYIDk5OT/kJMGAABA4AJBAADlgH8fBggB/xMBBAoUKvbsHwus' +
    'AlqmbAB/j4AAGCIhLBBOAAAQZ7M3',
  2:
    'AgUJBgQRATEQATIhADFQYEExUBEBcRABcWAxAHBggJJwYIARAxEDMgEgMgEg5OTk/5CTBgAAQOACQQAA5YB/HwYIAf8T' +
    'AQQKFCr27B8LrAJapmwAf4+AABgiISwQTgAAEGezNw==',
  3:
    'AwUJBgQRATEQATIhADFQYEExUBEBcRABcWAxAHBggJJwYIARAxEDMgEgMgEg5OTk/5CTBgAAQOACQQAA5YB/HwYIAf8T' +
    'AQQKFCr27B8LrAJapmwAf4+AABgiISwQTgAAEGezNwMxAjAhAiEDEQAFBKIGAAQDFgX+fwUD',
  4:
    'BAUJBgQRATEQATIhADFQYEExUBEBcRABcWAxAHBggJJwYIARAxEDMgEgMgEg5OTk/5CTBgAAQOACQQAA5YB/HwYIAf8T' +
    'AQQKFCr27B8LrAJapmwAf4+AABgiISwQTgAAEGezNwMxAjAhAiEDEQAFBKIGAAQDFgX+fwUDAwQRBAwIGg==',
};

describe('stored chunk texts, checked apart (#392)', () => {
  // 150 chunk parts, each written in version 5, read, written again and read in versions 1 to 4:
  // about 1 s alone
  it('hold every plane at once, any value in any chunk of any seed, and read so in every version', () => {
    let far = 0;
    let floats = 0;
    let huge = 0;
    forAll(
      genAnyPlanes,
      (c) => {
        const map = anyPlanesMap(c);
        const want = planesOfMap(map, c.x0, c.y0, CHUNK_VERSION);
        const text = encodeChunk(map, c.cx, c.cy);
        const read = decodeChunk(text);
        expect(read, 'refused its own text').not.toBeNull();
        const lost = planesDiffer(read!, want);
        if (lost) throw new Error(`read back otherwise: ${lost}`);
        // the planes read, on a map of the same world, are written to the same text again
        const again = emptyMap(c.seed, c.w, c.h, Terrain.Water, map.originX, map.originY);
        placeChunk(again, c.cx, c.cy, read!);
        expect(encodeChunk(again, c.cx, c.cy), 'written again').toBe(text);
        // and every older version, of what it holds, reads the same planes
        if (oldVersionsHold(map))
          for (const version of [1, 2, 3, 4] as const) {
            const old = decodeChunk(oldChunkText(read!, version));
            expect(old, `version ${version} refused`).not.toBeNull();
            const differ = planesDiffer(old!, heldBy(read!, version));
            if (differ) throw new Error(`version ${version} reads otherwise: ${differ}`);
          }
        else huge++;
        if (Math.abs(c.cx) >= 2 ** 40 || Math.abs(c.cy) >= 2 ** 40) far++;
        if (!Number.isInteger(c.seed) || Math.abs(c.seed) >= 2 ** 52) floats++;
      },
      {
        seeds: Array.from({ length: 150 }, (_, i) => i + 1),
        shrink: shrinkAnyPlanes,
        format: formatAnyPlanes,
        shrinkBudget: 300,
      },
    );
    // chunks version 5 has no guess for ran, seeds its head holds as their float64, and variants
    // no older version holds
    expect(far).toBeGreaterThan(0);
    expect(floats).toBeGreaterThan(0);
    expect(huge).toBeGreaterThan(0);
  }, 30_000);

  // four maps of up to 12 chunks, each written again around reads that fail: about 1 s alone
  it('give a chunk the same text whatever was read or written before, and encodeMap the same', () => {
    const maps = [
      generateMap(7412, { w: 70, h: 45, originX: -40, originY: 9 }, 'full'),
      generateMap(20260912, { w: 64, h: 64, originX: -32, originY: -32 }),
      anyPlanesMap({ w: 32, h: 32, x0: 0, y0: 0, cx: 3, cy: -2, seed: 1, style: 2, salt: 5 }),
      anyPlanesMap({ w: 20, h: 9, x0: 7, y0: 23, cx: -1, cy: 0, seed: 0.5, style: 0, salt: 6 }),
    ];
    // what a map's props may hold that no tile of it is: before, past and between its tiles, and
    // an empty list on its last tile
    for (const m of maps) {
      for (const i of [-1, m.w * m.h, 0.5])
        m.props.set(i, [{ kind: 'oak', variant: 0, ox: 0, oy: 0 }]);
      m.props.set(m.w * m.h - 1, []);
    }
    const texts = maps.map((m) => mapChunks(m).map(({ cx, cy }) => encodeChunk(m, cx, cy)));
    // texts cut short, whose reads stop part way through the planes or the props
    const broken = texts.flat().flatMap((t) => {
      const b = bytesOf(t);
      return [0.3, 0.6, 0.95].map((share) => textOf(b.slice(0, Math.floor(b.length * share))));
    });
    // written again in the other order, after those reads and a whole one
    for (let k = maps.length - 1; k >= 0; k--) {
      const chunks = mapChunks(maps[k]);
      for (let j = chunks.length - 1; j >= 0; j--) {
        for (const t of broken.slice(j, j + 3)) expect(decodeChunk(t)).toBeNull();
        expect(decodeChunk(texts[(k + 1) % maps.length][0])).not.toBeNull();
        const { cx, cy } = chunks[j];
        expect(encodeChunk(maps[k], cx, cy), `map ${k}, chunk ${cx},${cy}`).toBe(texts[k][j]);
      }
      const store = encodeMap(maps[k]);
      expect(Object.keys(store)).toEqual(chunks.map(({ cx, cy }) => chunkKey(cx, cy)));
      expect(Object.values(store), `map ${k}`).toEqual(texts[k]);
    }
  }, 20_000);

  // texts of 5 chunks in up to 5 versions, read cut at every byte: about 1 s alone
  it('of any version read as nothing cut short at any byte, or with a byte after them', () => {
    const sources: [GameMap, number, number][] = [
      [fixtureMap(), -3, 2],
      [generateMap(7412, { w: 32, h: 32 }, 'full'), 0, 0],
    ];
    for (const salt of [1, 2, 3]) {
      const c = genAnyPlanes(new Rng(salt));
      const small = { ...c, w: Math.min(c.w, 12), h: Math.min(c.h, 12) };
      sources.push([anyPlanesMap(small), c.cx, c.cy]);
    }
    let texts = 0;
    for (const [map, cx, cy] of sources) {
      const now = encodeChunk(map, cx, cy);
      const planes = decodeChunk(now)!;
      const all: [number, string][] = [[CHUNK_VERSION, now]];
      if (oldVersionsHold(map))
        for (const v of [1, 2, 3, 4] as const) all.push([v, oldChunkText(planes, v)]);
      for (const [version, text] of all) {
        const bytes = bytesOf(text);
        const at = `version ${version}, chunk ${cx},${cy} of ${bytes.length} bytes`;
        expect(decodeChunk(text), at).not.toBeNull();
        for (let n = 0; n < bytes.length; n++)
          if (decodeChunk(textOf(bytes.slice(0, n))))
            throw new Error(`${at}: its first ${n} bytes read as a chunk`);
        for (const b of [0, 1, 0x80, 0xff])
          expect(decodeChunk(textOf([...bytes, b])), `${at}, then ${b}`).toBeNull();
        texts++;
      }
    }
    // every version of the fixture and the generated chunk ran, and today's of the rest
    expect(texts).toBeGreaterThanOrEqual(2 * 5 + 3);
  }, 20_000);

  it('hold no more props past the third on a tile than 22 bits of text pay for each', () => {
    // version 5 writes a tile's fourth prop and later at even odds, 22 bits or more each, so that
    // a count no text backs cannot make a read go on: the cheapest props there are, all alike on
    // one tile, still take that much text, and the text cut short anywhere in them reads as nothing
    const past = (c: ChunkPlanes) =>
      [...c.props.values()].reduce((sum, list) => sum + Math.max(0, list.length - 3), 0);
    for (const n of [4, 40, 3000]) {
      const m = emptyMap(1, 3, 2);
      m.props.set(
        4,
        Array.from({ length: n }, () => ({ kind: 'tree' as const, variant: 0, ox: 0, oy: 0 })),
      );
      const text = encodeChunk(m, 0, 0);
      const bytes = bytesOf(text);
      const c = decodeChunk(text)!;
      expect(c.props.get(4)).toHaveLength(n);
      expect(past(c) * 22, `${n} props in ${bytes.length} bytes`).toBeLessThanOrEqual(
        bytes.length * 8,
      );
      for (const cut of [bytes.length - 1, bytes.length >> 1, 12, 9])
        expect(decodeChunk(textOf(bytes.slice(0, cut))), `${n} props cut at ${cut}`).toBeNull();
    }
    // and any other chunk's text, props by the dozen included
    forAll(
      genAnyPlanes,
      (g) => {
        const text = encodeChunk(anyPlanesMap(g), g.cx, g.cy);
        expect(past(decodeChunk(text)!) * 22).toBeLessThanOrEqual(bytesOf(text).length * 8);
      },
      { seeds: Array.from({ length: 40 }, (_, i) => i + 1), format: formatAnyPlanes },
    );
  });

  it('that the encoders of versions 1 to 4 wrote read as they did, and load unchanged', () => {
    const m = fixtureMap();
    const want = planesOfMap(m, 5, 9, CHUNK_VERSION);
    expect(planesDiffer(decodeChunk(encodeChunk(m, -3, 2))!, want)).toBeNull();
    const frame = { w: 6, h: 4, originX: m.originX, originY: m.originY };
    for (const version of [1, 2, 3, 4] as const) {
      const text = WRITTEN[version];
      const read = decodeChunk(text);
      expect(read, `version ${version}`).not.toBeNull();
      const differ = planesDiffer(read!, heldBy(want, version));
      if (differ) throw new Error(`version ${version}: ${differ}`);
      // the oracle the other tests take older texts from writes these very bytes
      expect(oldChunkText(want, version), `version ${version}`).toBe(text);
      // a save holding it loads it as it reads, generates nothing and keeps the text
      const store = { '-3,2': text };
      const built = buildMap(7412, frame, store, never);
      expect(built.chunks).toEqual(store);
      expect(built.added).toEqual([]);
      const placed = emptyMap(7412, 6, 4, Terrain.Water, m.originX, m.originY);
      placeChunk(placed, -3, 2, heldBy(want, version));
      expect(firstDifference(built.map, placed), `version ${version}`).toBeNull();
      expect(sameWater(built.map, placed), `version ${version}`).toBe(true);
    }
  });

  // fourteen worlds of 9 chunks, each stored in versions 4 and 5: about 2 s alone
  it('store a world of any seed a game draws or a player types in half the text', () => {
    // the largest seed Math.random draws for a new game and the largest hashSeed makes of a word;
    // and seeds a player types as digits (parseSeed), of 13 digits and more, up to numbers the
    // head holds as their float64
    for (const seed of [
      2 ** 31 - 1,
      2 ** 32 - 1,
      2 ** 40 - 1,
      2 ** 40,
      12345678901234,
      1e20,
      2 ** 53 + 2,
    ])
      for (const chain of SUPPLY_MODES) {
        const params = { w: 96, h: 96, originX: -32, originY: -32 };
        const { chunks } = buildMap(seed, params, {}, generateChain(chain));
        const now = JSON.stringify(chunks).length;
        const before = JSON.stringify(inVersion(chunks, 4)).length;
        expect(now / before, `seed ${seed}, ${chain}`).toBeLessThanOrEqual(0.5);
      }
  }, 30_000);
});

// The seed a text of version 5 holds, checked apart: its head is read here as chunks.ts describes
// it, not by chunks.ts, so a head that holds another number than the map's seed, or holds it in
// another form, fails even where its chunk still reads back.

/** The varint after which version 5's head holds the seed as its float64. */
const SEED_FLOAT = 2 ** 53 - 1;
/** An integer as version 5's head zigzags it: 2v for v of 0 or more, -2v - 1 below. */
const zigzagged = (v: number) => (v < 0 ? -2 * v - 1 : 2 * v);
/** The bytes of `v` (a safe integer, 0 or more) as an unsigned LEB128 varint. */
function varintBytes(v: number): number[] {
  const out: number[] = [];
  for (; v >= 0x80; v = Math.floor(v / 0x80)) out.push((v % 0x80) | 0x80);
  out.push(v);
  return out;
}
/** The eight bytes of `v`'s float64, the lowest first. */
function float64Bytes(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
}

/**
 * Version 5's head, read as chunks.ts describes it: after the version and the rectangle, the seed
 * as a zigzagged varint, or as the varint 2^53 - 1 and the eight bytes of its float64, the lowest
 * first; then cx and cy, zigzagged. `seedEnd` is the byte after the seed, `stream` the first byte
 * of the range coder's stream.
 */
function readHead(bytes: number[]) {
  let at = 5;
  const varint = () => {
    let v = 0;
    for (let scale = 1; ; scale *= 0x80) {
      const b = bytes[at++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
    }
  };
  const unzigzag = (u: number) => (u % 2 ? -(u + 1) / 2 : u / 2);
  const first = varint();
  const float = first === SEED_FLOAT;
  let seed = unzigzag(first);
  if (float) {
    seed = new DataView(Uint8Array.from(bytes.slice(at, at + 8)).buffer).getFloat64(0, true);
    at += 8;
  }
  const seedEnd = at;
  const cx = unzigzag(varint());
  const cy = unzigzag(varint());
  return { float, seed, seedEnd, cx, cy, stream: at };
}

/**
 * Any number a map's seed may be: integers of any size below 2^52, those around 2^31, 2^32, 2^40,
 * 2^52 and 2^53, numbers that are no integer, and any float64 at all from its 64 bits (infinities,
 * NaNs and subnormals among them), each of either sign.
 */
function anySeed(rng: Rng): number {
  const sign = rng.chance(0.5) ? 1 : -1;
  switch (rng.int(0, 5)) {
    case 0:
      return sign * rng.int(0, 2 ** 31);
    case 1:
      return sign * (rng.int(0, 2 ** 20 - 1) * 2 ** 32 + rng.int(0, 2 ** 32 - 1));
    case 2:
      return sign * (rng.pick([2 ** 31, 2 ** 32, 2 ** 40, 2 ** 52, 2 ** 53]) + rng.int(-2, 2));
    case 3:
      return sign * rng.range(0, rng.pick([1, 1e6]));
    case 4: {
      const b = new DataView(new ArrayBuffer(8));
      b.setUint32(0, rng.int(0, 2 ** 32 - 1));
      b.setUint32(4, rng.int(0, 2 ** 32 - 1));
      return b.getFloat64(0);
    }
    default:
      return rng.pick([
        0,
        -0,
        NaN,
        Infinity,
        -Infinity,
        Number.MIN_VALUE,
        -Number.MAX_VALUE,
        Number.MAX_SAFE_INTEGER,
        -(2 ** 52 - 1),
        2 ** 52 - 0.5,
        1e20,
        2 ** 53 + 2,
      ]);
  }
}
/** A seed as a failure message spells it, -0 and NaN included, exactly enough to replay. */
const seedText = (s: number) => (Object.is(s, -0) ? '-0' : String(s));
/** Whether version 5's head holds `seed` as a varint: an integer below 2^52 in size. */
const heldAsVarint = (seed: number) => Number.isInteger(seed) && Math.abs(seed) < 2 ** 52;
/** A chunk part of every plane (AnyPlanes) in a world of any seed at all. */
const genSeedCase = (rng: Rng): AnyPlanes => ({ ...genAnyPlanes(rng), seed: anySeed(rng) });
const formatSeedCase = (c: AnyPlanes) => JSON.stringify({ ...c, seed: seedText(c.seed) });

describe("the seed in a chunk text's head (#392)", () => {
  // 200 chunk parts, each written, read and written again, and a chunk of generation's variants
  // written: about 1 s alone
  it('is the map seed exactly, in the form its kind of number takes, and reads the same ground', () => {
    const seen = { varint: 0, float: 0, special: 0, far: 0 };
    forAll(
      genSeedCase,
      (c) => {
        const map = anyPlanesMap(c);
        const text = encodeChunk(map, c.cx, c.cy);
        const bytes = bytesOf(text);
        const head = readHead(bytes);
        // an integer below 2^52 in size as its zigzagged varint (-0 as 0, which every hash takes
        // alike), any other number as its float64: NaN as a NaN, the rest the very number
        expect(head.float, 'held as its float64').toBe(!heldAsVarint(c.seed));
        if (heldAsVarint(c.seed)) {
          const seed = c.seed === 0 ? 0 : c.seed;
          expect(head.seed, 'the seed').toBe(seed);
          expect(bytes.slice(5, head.seedEnd), 'its varint').toEqual(varintBytes(zigzagged(seed)));
        } else if (Number.isNaN(c.seed)) expect(head.seed, 'the seed').toBeNaN();
        else expect(head.seed, 'the seed').toBe(c.seed);
        // then the chunk's place, or 0 where it lies 2^40 or more out
        const place = (v: number) => (Math.abs(v) < 2 ** 40 ? v : 0);
        expect([head.cx, head.cy], 'cx and cy').toEqual([place(c.cx), place(c.cy)]);
        // the planes read back as written, and are written again the same
        const read = decodeChunk(text);
        expect(read, 'refused its own text').not.toBeNull();
        const lost = planesDiffer(read!, planesOfMap(map, c.x0, c.y0, CHUNK_VERSION));
        if (lost) throw new Error(`read back otherwise: ${lost}`);
        const again = emptyMap(c.seed, c.w, c.h, Terrain.Water, map.originX, map.originY);
        placeChunk(again, c.cx, c.cy, read!);
        expect(encodeChunk(again, c.cx, c.cy), 'written again').toBe(text);
        // a whole chunk of generation's variants, guessed from the seed the head holds, takes a
        // few bytes after the head; a missed guess takes two bits a tile, 256 bytes
        if (place(c.cx) === c.cx && place(c.cy) === c.cy) {
          const m = emptyMap(c.seed, 32, 32, Terrain.Grass, c.cx * CHUNK_TILES, c.cy * CHUNK_TILES);
          const empty = bytesOf(encodeChunk(m, c.cx, c.cy));
          expect(empty.length - readHead(empty).stream, 'guessed').toBeLessThanOrEqual(32);
        } else seen.far++;
        if (heldAsVarint(c.seed)) seen.varint++;
        else seen.float++;
        if (!Number.isFinite(c.seed) || Object.is(c.seed, -0)) seen.special++;
      },
      {
        seeds: Array.from({ length: 200 }, (_, i) => i + 1),
        shrink: shrinkAnyPlanes,
        format: formatSeedCase,
        shrinkBudget: 300,
      },
    );
    // both forms ran, the infinities, NaNs or -0 among them, and chunks too far out to guess
    expect(seen.varint).toBeGreaterThan(20);
    expect(seen.float).toBeGreaterThan(20);
    expect(seen.special).toBeGreaterThan(0);
    expect(seen.far).toBeGreaterThan(0);
  }, 30_000);

  it('reads a seed spelled as its float64 as it reads the same seed as a varint', () => {
    // a text whose head holds an integer seed below 2^52 as the escape and its float64, which
    // encodeChunk never writes, reads to the planes of the text it wrote: the float64 is read as
    // the very number, and the guesses are made from it alike
    let cases = 0;
    forAll(
      (rng) => {
        const c = genAnyPlanes(rng);
        let seed = anySeed(rng);
        if (!heldAsVarint(seed)) seed = rng.pick([0, -0, 2 ** 52 - 1, -(2 ** 52 - 1), 7412]);
        return { ...c, seed };
      },
      (c) => {
        const bytes = bytesOf(encodeChunk(anyPlanesMap(c), c.cx, c.cy));
        const head = readHead(bytes);
        expect(head.float).toBe(false);
        const spelled = [
          ...bytes.slice(0, 5),
          ...varintBytes(SEED_FLOAT),
          ...float64Bytes(c.seed),
          ...bytes.slice(head.seedEnd),
        ];
        const want = decodeChunk(textOf(bytes))!;
        const read = decodeChunk(textOf(spelled));
        expect(read, 'refused').not.toBeNull();
        const differ = planesDiffer(read!, want);
        if (differ) throw new Error(`read otherwise: ${differ}`);
        cases++;
      },
      {
        seeds: Array.from({ length: 60 }, (_, i) => i + 1),
        shrink: shrinkAnyPlanes,
        format: formatSeedCase,
        shrinkBudget: 300,
      },
    );
    expect(cases).toBe(60);
  });

  it('reads any head as a chunk or as nothing, never throwing, and refuses one no chunk holds', () => {
    // a real text's stream behind a head made up: a seed of any 64 bits, a varint at the limit, one
    // of 2^53 or more (2^60 in nine bytes), or the escape and fewer than eight bytes, the text's end
    const HEADS = ['any float64', 'at the limit', 'past the limit', 'cut short'];
    const seen = new Set<string>();
    forAll(
      (rng) => {
        const c = genAnyPlanes(rng);
        const small = { ...c, w: Math.min(c.w, 8), h: Math.min(c.h, 8), seed: anySeed(rng) };
        return { c: small, how: rng.pick(HEADS), edit: rng.int(1, 2 ** 31 - 1) };
      },
      ({ c, how, edit }) => {
        const rng = new Rng(edit);
        const bytes = bytesOf(encodeChunk(anyPlanesMap(c), c.cx, c.cy));
        const rest = bytes.slice(readHead(bytes).seedEnd);
        const seed =
          how === 'any float64'
            ? [...varintBytes(SEED_FLOAT), ...Array.from({ length: 8 }, () => rng.int(0, 255))]
            : how === 'at the limit'
              ? varintBytes(SEED_FLOAT - rng.int(1, 3))
              : how === 'past the limit'
                ? varintBytes(rng.pick([2 ** 53, 2 ** 53 + 2, 2 ** 55, 2 ** 56 - 1, 2 ** 60]))
                : [...varintBytes(SEED_FLOAT), ...rest.slice(0, rng.int(0, 7))];
        const text = textOf([...bytes.slice(0, 5), ...seed, ...(how === 'cut short' ? [] : rest)]);
        const read = decodeChunk(text);
        seen.add(`${how}: ${read ? 'read' : 'refused'}`);
        // a head no chunk holds is refused: a seed's varint past 2^53 - 1, and a float64 the text
        // ends inside
        if (how === 'past the limit' || how === 'cut short') expect(read, how).toBeNull();
        if (!read) return;
        // what it reads is a chunk encodeChunk writes, and reads so again
        const m = emptyMap(0, read.w, read.h, Terrain.Grass, read.x0, read.y0);
        placeChunk(m, 0, 0, read);
        expect(planesDiffer(decodeChunk(encodeChunk(m, 0, 0))!, read)).toBeNull();
      },
      {
        seeds: Array.from({ length: 150 }, (_, i) => i + 1),
        format: (g) => JSON.stringify({ ...g, c: { ...g.c, seed: seedText(g.c.seed) } }),
      },
    );
    // every head ran: those of any 64 bits and at the limit were read, the others refused
    for (const way of ['any float64', 'at the limit']) expect(seen).toContain(`${way}: read`);
    for (const way of ['past the limit', 'cut short']) expect(seen).toContain(`${way}: refused`);
  });

  it('holding a float64 seed, reads as nothing cut short at any byte or with a byte after it', () => {
    for (const seed of [0.5, 1e20, NaN, -Infinity, 2 ** 52, -(2 ** 53 + 2)]) {
      const c = { w: 7, h: 5, x0: 3, y0: 20, cx: -2, cy: 5, seed, style: 2, salt: 11 };
      const bytes = bytesOf(encodeChunk(anyPlanesMap(c), c.cx, c.cy));
      const at = `seed ${seedText(seed)}, ${bytes.length} bytes`;
      expect(readHead(bytes).float, at).toBe(true);
      expect(decodeChunk(textOf(bytes)), at).not.toBeNull();
      for (let n = 0; n < bytes.length; n++)
        if (decodeChunk(textOf(bytes.slice(0, n))))
          throw new Error(`${at}: its first ${n} bytes read as a chunk`);
      for (const b of [0, 1, 0x80, 0xff])
        expect(decodeChunk(textOf([...bytes, b])), `${at}, then ${b}`).toBeNull();
    }
  });

  // five worlds of 4 chunks generated, each loaded eight ways: about 1.3 s alone
  it("gives a stored world the ground its texts hold, whatever seed the world's save carries", () => {
    // the text holds its own seed, so the ground of a stored chunk does not hang on the save's:
    // not after a save's JSON writes an infinite seed as null, nor for any other seed
    const params = { w: 64, h: 64, originX: -32, originY: -32 };
    for (const seed of [1e20, 2 ** 53 + 2, 12345678901234, 0.5, Infinity]) {
      const made = buildMap(seed, params, {});
      const at = `seed ${seedText(seed)}`;
      expect(made.added, at).toHaveLength(4);
      const world: GeneratedWorld = {
        kind: 'generated',
        seed,
        params: { ...DEFAULT_MAP_PARAMS, ...params },
        chunks: made.chunks,
      };
      const saved = JSON.parse(JSON.stringify(world)) as GeneratedWorld;
      const loads: [string, ReturnType<typeof buildMap>][] = [
        [`${at}, saved`, groundOf(saved, never)],
      ];
      for (const other of [seed, 0, -0, NaN, Infinity, -1, 7412])
        loads.push([
          `${at}, read as ${seedText(other)}`,
          buildMap(other, params, made.chunks, never),
        ]);
      for (const [where, load] of loads) {
        expect(load.added, where).toEqual([]);
        expect(load.unreadable, where).toEqual([]);
        expect(load.chunks, where).toEqual(made.chunks);
        expect(firstDifference(load.map, made.map), where).toBeNull();
        expect(sameWater(load.map, made.map), where).toBe(true);
      }
    }
  }, 30_000);

  // slow because 120 chunk parts under seeds of every kind are each written twice and read: 0.33 s
  // alone, so a limit of 30 s
  it('holds the number a seed of another kind stands for, and reads back as written', () => {
    // a save's JSON may carry a world seed that is no number (a hand-edited or foreign save: the
    // load checks the save's own seed, not its world's), and groundOf hands it to buildMap. The
    // head holds Number(seed) and every guess is made from that number, so '7412' is not 7412 in
    // the head and '74125' in the scatter hash's seed + 5
    const OTHER_SEEDS: unknown[] = [
      '1',
      '7412',
      '20260912',
      '-3',
      ' 7412 ',
      '2.5',
      '1e20',
      '0x10',
      '',
      'abc',
      null,
      true,
      false,
      [7412],
      [],
      {},
      undefined,
    ];
    const spelled = (v: unknown) => (v === undefined ? 'undefined' : JSON.stringify(v));
    type OtherCase = AnyPlanes & { other: number };
    const seen = new Set<number>();
    forAll(
      (rng): OtherCase => ({
        ...genAnyPlanes(rng),
        style: rng.int(1, 2),
        other: rng.int(0, OTHER_SEEDS.length - 1),
      }),
      (c) => {
        const seed = OTHER_SEEDS[c.other];
        const map = anyPlanesMap({ ...c, seed: seed as number });
        const text = encodeChunk(map, c.cx, c.cy);
        const read = decodeChunk(text);
        expect(read, 'refused its own text').not.toBeNull();
        const lost = planesDiffer(read!, planesOfMap(map, c.x0, c.y0, CHUNK_VERSION));
        if (lost) throw new Error(`read back otherwise: ${lost}`);
        const asNumber = encodeChunk({ ...map, seed: Number(seed) }, c.cx, c.cy);
        expect(text, 'the text of its number').toBe(asNumber);
        if (map.props.size) seen.add(c.other);
      },
      {
        seeds: Array.from({ length: 120 }, (_, i) => i + 1),
        shrink: function* (c) {
          for (const s of shrinkAnyPlanes(c)) yield { ...s, other: c.other };
        },
        format: (c) => JSON.stringify({ ...c, seed: spelled(OTHER_SEEDS[c.other]) }),
        shrinkBudget: 300,
      },
    );
    // most kinds ran on a chunk with props, whose guesses come from seed + 5 to seed + 9
    expect(seen.size).toBeGreaterThan(OTHER_SEEDS.length / 2);

    // the smallest case: one tree on one tile of a world of seed '1', and the two tiles beside it
    for (const w of [1, 2]) {
      const m = emptyMap('1' as unknown as number, w, 1);
      m.props.set(0, [{ kind: 'tree', variant: 0, ox: 0, oy: 0 }]);
      const read = decodeChunk(encodeChunk(m, 0, 0));
      expect(read, `${w} x 1 refused`).not.toBeNull();
      expect(read!.props.get(0), `${w} x 1`).toEqual([{ kind: 'tree', variant: 0, ox: 0, oy: 0 }]);
    }
  }, 30_000);

  // a world of 4 chunks generated and loaded: about 0.3 s alone
  it('builds and loads a world whose save carries its seed as a numeric string', () => {
    const seed = '7412' as unknown as number;
    const params = { w: 64, h: 64 };
    const made = buildMap(seed, params, {});
    expect(made.added).toHaveLength(4);
    expect(made.unreadable).toEqual([]);
    // the ground as generated, up to where props are stored
    expect(firstDifference(made.map, generateMap(seed, params), { near: true })).toBeNull();
    const world: GeneratedWorld = {
      kind: 'generated',
      seed,
      params: { ...DEFAULT_MAP_PARAMS, ...params },
      chunks: made.chunks,
    };
    const load = groundOf(JSON.parse(JSON.stringify(world)) as GeneratedWorld, never);
    expect(load.added).toEqual([]);
    expect(load.unreadable).toEqual([]);
    expect(load.chunks).toEqual(made.chunks);
    expect(firstDifference(load.map, made.map)).toBeNull();
    expect(sameWater(load.map, made.map)).toBe(true);
  }, 10_000);

  // 150 chunk parts, each written four times and read: about 0.6 s alone
  it("holds Number(seed) for any value a save's JSON gives in a seed's place, read back as written", () => {
    // checked apart from the fixed list above: values drawn at random of every kind JSON holds, and
    // the head read as chunks.ts describes it, not by chunks.ts
    const seen = new Set<string>();
    forAll(
      (rng): JsonSeedCase => ({ ...genAnyPlanes(rng), json: anyJsonSeed(rng) }),
      (c) => {
        const value = jsonSeed(c.json);
        const number = Number(value);
        const map = anyPlanesMap({ ...c, seed: value as number });
        const text = encodeChunk(map, c.cx, c.cy);
        // the head holds the number, in the form that number takes
        const head = readHead(bytesOf(text));
        expect(head.float, 'held as its float64').toBe(!heldAsVarint(number));
        if (Number.isNaN(number)) expect(head.seed, 'the seed').toBeNaN();
        else expect(head.seed, 'the seed').toBe(number === 0 ? 0 : number);
        // the planes read back as written, are written again the same from a map of the same
        // world, and are the text of the number itself
        const read = decodeChunk(text);
        expect(read, 'refused its own text').not.toBeNull();
        const lost = planesDiffer(read!, planesOfMap(map, c.x0, c.y0, CHUNK_VERSION));
        if (lost) throw new Error(`read back otherwise: ${lost}`);
        const again = emptyMap(value as number, c.w, c.h, Terrain.Water, map.originX, map.originY);
        placeChunk(again, c.cx, c.cy, read!);
        expect(encodeChunk(again, c.cx, c.cy), 'written again').toBe(text);
        expect(text, 'the text of its number').toBe(
          encodeChunk({ ...map, seed: number }, c.cx, c.cy),
        );
        seen.add(jsonKind(c.json));
        // the case of #392's finding: props, guessed from seed + 5 to + 9, of a value whose own
        // seed + 5 is another number ('7412' + 5 is '74125')
        if (map.props.size && !Object.is(Number((value as number) + 5), number + 5))
          seen.add('props whose generation seed + 5 is not the number + 5');
      },
      {
        seeds: Array.from({ length: 150 }, (_, i) => i + 1),
        shrink: shrinkJsonSeedCase,
        format: (c) => JSON.stringify({ ...c, seed: undefined }),
        shrinkBudget: 300,
      },
    );
    // every kind ran, and chunks with props whose seed + 5 a save's value spells otherwise
    for (const kind of JSON_KINDS) expect(seen, kind).toContain(kind);
    expect(seen).toContain('props whose generation seed + 5 is not the number + 5');
  }, 30_000);

  // ten worlds of 4 chunk parts generated, grown to 6 chunks and each loaded twice: about 2 s alone
  it('builds, grows and loads a world whose save carries a seed of any other kind', () => {
    // a world's seed as a hand-edited or foreign save may carry it (the load checks only the save's
    // own seed), handed by groundOf to buildMap: the first build, the parts of chunks a growth
    // writes again, and the loads of both all read and write the one number
    const values: unknown[] = ['7412', ' 20260912 ', [7412], '1e20', '-3', null, true, 'abc', {}];
    const small = { w: 20, h: 20, originX: -10, originY: -10 };
    const big = { w: 60, h: 40, originX: -22, originY: -10 };
    const saved = (w: GeneratedWorld) => JSON.parse(JSON.stringify(w)) as GeneratedWorld;
    const keys = (p: Frame) => mapChunks(p).map(({ cx, cy }) => chunkKey(cx, cy));
    for (const value of [...values, undefined]) {
      const at = value === undefined ? 'no seed' : `seed ${JSON.stringify(value)}`;
      const number = Number(value);
      // a load of the world as its save's JSON gives it, the seed's value named if it throws
      const load = (w: GeneratedWorld, generate: MapGenerator, what: string) => {
        try {
          return groundOf(saved(w), generate);
        } catch (e) {
          throw new Error(`${at}, ${what}: ${String(e)}`, { cause: e });
        }
      };
      const world: GeneratedWorld = {
        kind: 'generated',
        seed: value as number,
        params: { ...DEFAULT_MAP_PARAMS, ...small },
        chunks: {},
      };
      const made = load(world, generatorOf('simple'), 'built');
      expect(made.unreadable, at).toEqual([]);
      expect(made.added, at).toEqual(keys(small));
      for (const text of Object.values(made.chunks)) {
        const head = readHead(bytesOf(text));
        expect(decodeChunk(text)?.version, at).toBe(CHUNK_VERSION);
        if (Number.isNaN(number)) expect(head.seed, `${at}: head`).toBeNaN();
        else expect(head.seed, `${at}: head`).toBe(number);
      }
      // the ground as generated from the value as the save carries it, up to where props are
      // stored
      const generated = generateMap(value as number, small, 'simple');
      expect(firstDifference(made.map, generated, { near: true }), at).toBeNull();
      expect(sameWater(made.map, generated), at).toBe(true);
      const loaded = load({ ...world, chunks: made.chunks }, never, 'loaded');
      expect([loaded.added, loaded.unreadable], `${at}: loaded`).toEqual([[], []]);
      expect(loaded.chunks, `${at}: loaded`).toEqual(made.chunks);
      expect(firstDifference(loaded.map, made.map), `${at}: loaded`).toBeNull();
      expect(sameWater(loaded.map, made.map), `${at}: loaded`).toBe(true);
      // grown: each stored part is kept and written again whole, its rest generated, and the new
      // chunks join, all of them as the generator made them but where the seam ends a river
      const bigWorld = { ...world, params: { ...DEFAULT_MAP_PARAMS, ...big }, chunks: made.chunks };
      const grown = load(bigWorld, generatorOf('simple'), 'grown');
      expect(grown.unreadable, `${at}: grown`).toEqual([]);
      expect(grown.added, `${at}: grown`).toEqual(keys(big));
      expect(firstDifference(made.map, grown.map), `${at}: grown, the stored tiles`).toBeNull();
      for (let y = 0; y < small.h; y++)
        for (let x = 0; x < small.w; x++) {
          const i = y * small.w + x;
          const j = (y + small.originY - big.originY) * big.w + x + small.originX - big.originX;
          const water = (m: GameMap, k: number) =>
            [m.waterSurface![k], m.flow![k], m.flowDir![k], m.feature![k]].join();
          if (water(made.map, i) !== water(grown.map, j))
            throw new Error(`${at}: grown, the stored water at map tile (${x}, ${y})`);
        }
      const inside = (wx: number, wy: number) => wx >= -10 && wy >= -10 && wx < 10 && wy < 10;
      const outside = (wx: number, wy: number) => !inside(wx, wy) && !besideStored(inside, wx, wy);
      const rest = generateMap(value as number, big, 'simple');
      const fresh = firstDifference(grown.map, rest, { near: true, only: outside });
      expect(fresh, `${at}: grown, the tiles generated`).toBeNull();
      const reload = load({ ...bigWorld, chunks: grown.chunks }, never, 'reloaded');
      expect([reload.added, reload.unreadable], `${at}: reload`).toEqual([[], []]);
      expect(reload.chunks, `${at}: reload`).toEqual(grown.chunks);
      expect(firstDifference(reload.map, grown.map), `${at}: reload`).toBeNull();
      expect(sameWater(reload.map, grown.map), `${at}: reload`).toBe(true);
    }
  }, 60_000);
});

/** A chunk part (AnyPlanes) of a world whose seed a save's JSON holds as `json`. */
type JsonSeedCase = AnyPlanes & { json: string | null };
/** The kinds anyJsonSeed draws, by jsonKind. */
const JSON_KINDS = [
  'number',
  'string read as an integer',
  'string read as another number',
  'string read as NaN',
  'null or a boolean',
  'array',
  'object',
  'no seed',
];
/** The value a save's JSON text `json` gives a world's seed; null for a world without one. */
const jsonSeed = (json: string | null): unknown => (json === null ? undefined : JSON.parse(json));
/** What kind of value `json` holds (JSON_KINDS). */
function jsonKind(json: string | null): string {
  const v = jsonSeed(json);
  if (v === undefined) return 'no seed';
  if (v === null || typeof v === 'boolean') return 'null or a boolean';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number') return 'number';
  const n = Number(v);
  if (Number.isNaN(n)) return 'string read as NaN';
  return heldAsVarint(n) ? 'string read as an integer' : 'string read as another number';
}
/**
 * Any value a save's JSON may hold where a world's seed belongs, as its JSON text, or null for no
 * seed at all: numbers (NaN and the infinities as JSON writes them, null); strings Number reads as
 * a number, as String spells one, padded, signed, in another radix or cut at the point; strings it
 * reads as NaN; null and booleans; arrays and objects of any of these. No object holds a key
 * toString: Number throws on one whose toString is no function, and so does map generation, first.
 */
function anyJsonSeed(rng: Rng): string | null {
  return rng.chance(0.05) ? null : JSON.stringify(anyJsonValue(rng, 0));
}
function anyJsonValue(rng: Rng, depth: number): unknown {
  const n = rng.int(0, 2 ** 31 - 1);
  switch (rng.int(0, depth < 2 ? 7 : 5)) {
    case 0:
      return anySeed(rng);
    case 1:
      return String(anySeed(rng));
    case 2: {
      const pad = () => rng.pick(['', ' ', '\t', '\n', '\r\n', ' ', '﻿', ' ']);
      const body = rng.pick([
        `${n}`,
        `+${n}`,
        `-${n}`,
        `0x${n.toString(16)}`,
        `0X${n.toString(16).toUpperCase()}`,
        `0b${n.toString(2)}`,
        `0o${n.toString(8)}`,
        `${n}.`,
        `.${n}`,
        `${n}e0`,
        `${n}E-3`,
        `000${n}`,
        '-0',
        '+0',
        '',
        'Infinity',
        '-Infinity',
        `${n}${n}${n}`,
      ]);
      return pad() + body + pad();
    }
    case 3:
      return rng.pick([
        'abc',
        `${n}abc`,
        '1_000',
        'NaN',
        'infinity',
        '1e',
        '--1',
        '0x',
        `${n},${n}`,
        `-0x${n.toString(16)}`,
        `${n} ${n}`,
        '١٢',
      ]);
    case 4:
    case 5:
      return rng.pick([null, true, false]);
    case 6:
      // of one element Number reads as that element's, of none as 0, of more as NaN
      return Array.from({ length: rng.pick([0, 1, 1, 1, 2]) }, () => anyJsonValue(rng, depth + 1));
    default:
      return rng.chance(0.3)
        ? {}
        : { [rng.pick(['seed', 'valueOf', 'value', '0'])]: anyJsonValue(rng, depth + 1) };
  }
}
/** Smaller cases: a smaller chunk part, then an array of one element as that element. */
function* shrinkJsonSeedCase(c: JsonSeedCase): Iterable<JsonSeedCase> {
  for (const s of shrinkAnyPlanes(c)) yield { ...s, json: c.json };
  const v = jsonSeed(c.json);
  if (Array.isArray(v) && v.length === 1) yield { ...c, json: JSON.stringify(v[0]) };
}
