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
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { emptyMap, generateMap, type MapGenParams } from './mapgen';
import { levelAt, tileLevels } from './elevation';
import { Biome, Terrain, type GameMap, type PropInstance } from './tiles';
import type { Rng } from '../engine/rng';
import { setSupplyMode } from '../sim/supply';
import { forAll, shrinkInt } from '../testing/property';

beforeEach(() => setSupplyMode('simple'));
afterEach(() => setSupplyMode('simple'));

/** A frame of a map: its size and where its tile (0, 0) lies in the world. */
type Frame = Pick<MapGenParams, 'w' | 'h' | 'originX' | 'originY'>;

/** `p` grown by `ring` chunks on every side, as expandSave grows a game's world. */
const grow = (p: Frame, ring = 1): Frame => ({
  w: p.w + 2 * CHUNK_TILES * ring,
  h: p.h + 2 * CHUNK_TILES * ring,
  originX: (p.originX ?? 0) - CHUNK_TILES * ring,
  originY: (p.originY ?? 0) - CHUNK_TILES * ring,
});

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
      if (a.variant[i] !== b.variant[j]) return `variant at ${where}`;
      if (pa.length !== pb.length || pa.some((p, k) => !sameProp(p, pb[k])))
        return `props at ${where}: ${JSON.stringify(pa)} against ${JSON.stringify(pb)}`;
    }
  return null;
}

/** Whether world tile (`wx`, `wy`) lies in one of the chunks of `store`. */
const inStore = (store: ChunkStore, wx: number, wy: number) =>
  Object.hasOwn(store, chunkKey(chunkOf(wx), chunkOf(wy)));

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
const caseMap = (c: Case) => {
  setSupplyMode(c.full ? 'full' : 'simple');
  return generateMap(c.seed, { w: c.w, h: c.h, originX: c.ox, originY: c.oy });
};

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
    expect(PROP_KINDS.slice(0, 15)).toEqual([
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
    ]);
    // each kind under an index of its own, with none left out between them
    for (const kind of PROP_KINDS) {
      const map = emptyMap(1, 1, 1);
      map.props.set(0, [{ kind, variant: 1, ox: 0, oy: 0 }]);
      expect(decodeChunk(encodeChunk(map, 0, 0))!.props.get(0)![0].kind).toBe(kind);
    }
  });

  // 24 generated maps up to 128 tiles a side, each read back and stored again: about 0.8 s alone
  it('comes back byte for byte, its planes as the map has them, over seeds and sizes', () => {
    forAll(
      genCase,
      (c) => {
        const map = caseMap(c);
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
  }, 30_000);

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
    map.variant[9] = 4;
    expect(() => encodeChunk(map, 0, 0)).toThrow(/variant/);
    map.variant[9] = 0;
    map.props.set(3, [{ kind: 'wheat' as PropInstance['kind'], variant: 0, ox: 0, oy: 0 }]);
    expect(() => encodeChunk(map, 0, 0)).toThrow(/kind/);
    map.props.set(3, [{ kind: 'oak', variant: -1, ox: 0, oy: 0 }]);
    expect(() => encodeChunk(map, 0, 0)).toThrow(/variant/);
    expect(() => encodeChunk(map, 1, 0)).toThrow(/cover/);
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
  });

  // Generates a few maps up to 288 tiles a side per seed: about 2 s alone
  it('of a grown world is generateMap of the grown parameters, tile for tile', () => {
    forAll(
      (rng) => ({
        seed: rng.int(0, 2 ** 31 - 1),
        full: rng.chance(0.5),
        size: CHUNK_TILES * rng.int(1, 5),
        earlier: rng.int(0, 2),
        rings: rng.int(1, 2),
      }),
      ({ seed, full, size, earlier, rings }) => {
        setSupplyMode(full ? 'full' : 'simple');
        const at = -CHUNK_TILES * earlier;
        let params: Frame = { w: size, h: size, originX: at, originY: at };
        let store = buildMap(seed, params, {}).chunks;
        for (let r = 0; r < rings; r++) {
          const before = store;
          params = grow(params);
          const built = buildMap(seed, params, store);
          // only the new ring is generated, and every stored text is kept as it was
          const ring = mapChunks(params)
            .map((c) => chunkKey(c.cx, c.cy))
            .filter((k) => !Object.hasOwn(before, k));
          expect(built.added).toEqual(ring);
          for (const k of Object.keys(before)) expect(built.chunks[k]).toBe(before[k]);
          const fresh = buildMap(seed, params, {});
          const exact = firstDifference(built.map, fresh.map);
          if (exact) throw new Error(`against the grown world stored at once: ${exact}`);
          const gen = firstDifference(built.map, generateMap(seed, params), { near: true });
          if (gen) throw new Error(`against generateMap: ${gen}`);
          store = built.chunks;
        }
      },
      { seeds: Array.from({ length: 10 }, (_, i) => i + 1) },
    );
  }, 60_000);

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
      const outside = (wx: number, wy: number) => wx < 0 || wy < 0 || wx >= 48 || wy >= 48;
      expect(firstDifference(grown.map, rest, { only: outside })).toBeNull();
      // and with the generator unchanged it is the grown world
      expect(
        firstDifference(buildMap(seed, big, first.chunks).map, buildMap(seed, big, {}).map),
      ).toBeNull();
    }
  });

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
          setSupplyMode(full ? 'full' : 'simple');
          const params: Frame = { w: 64, h: 64 };
          const old = buildMap(seed, params, {});
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
          // the new chunks are the generator's
          const fresh = (wx: number, wy: number) => !inStore(old.chunks, wx, wy);
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

  it('has no climate of its own: a stored chunk has the climate of its biome', () => {
    const climate: MapGenerator = (s, p) => {
      const m = generateMap(s, p);
      return { ...m, climate: new Uint8Array(m.w * m.h).fill(Biome.Desert) };
    };
    const built = buildMap(1, { w: 64, h: 64 }, {}, climate);
    expect([...built.map.climate!]).toEqual([...built.map.biome]);
  });

  it('refuses a generator that makes a map of another size', () => {
    expect(() =>
      buildMap(1, { w: 64, h: 64 }, {}, (s) => generateMap(s, { w: 32, h: 32 })),
    ).toThrow(/generator/);
  });

  it('adds at most about 150 KB to the save for a 49-chunk world', () => {
    for (const seed of [1, 7412, 20260912, 31337, 987654321]) {
      const { chunks } = buildMap(seed, { w: 224, h: 224, originX: -64, originY: -64 }, {});
      expect(Object.keys(chunks)).toHaveLength(49);
      expect(JSON.stringify(chunks).length).toBeLessThanOrEqual(150_000);
    }
  });
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

  it.each(rings)('keeps neighbouring levels within one step against a ring of %s', (_, fill) => {
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
  });
});
