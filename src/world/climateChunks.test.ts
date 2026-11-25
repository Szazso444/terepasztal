import { describe, it, expect } from 'vitest';
import {
  CHUNK_TILES,
  CHUNK_VERSION,
  buildMap,
  chunkKey,
  chunkOf,
  decodeChunk,
  encodeMap,
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { generateMap, type MapGenParams } from './mapgen';
import { oldChunkText, textOf } from './oldChunkTexts';
import { Biome, CLIMATES, climateAt, type GameMap } from './tiles';

// The climate plane in stored chunks (#354, with #339's chunk rule): chunks stored before the
// plane keep their biomes and read their climate as their biome; chunks generated after store the
// climate under the landform biomes (#340, #354).

/** A generator that must not run. */
const never: MapGenerator = () => {
  throw new Error('generated a chunk that is stored');
};

/**
 * The text chunk text `text` would have had in version 1, before the climate plane: version 1's
 * text of its planes (oldChunkTexts.ts), without the climate, water planes and features.
 */
const asVersion1 = (text: string) => oldChunkText(decodeChunk(text)!, 1);

/** The world as map generation made it before the landform biomes: its biome is its climate. */
const beforeLandforms: MapGenerator = (s, p) => {
  const m = generateMap(s, p);
  return { ...m, biome: m.climate!.slice(), climate: undefined };
};

/** Tiles of `a` where climateAt differs from `b`'s, both read in world tiles, over `a`'s tiles. */
function climateDiff(a: GameMap, b: GameMap, only?: (wx: number, wy: number) => boolean): number {
  let n = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const wx = x + a.originX;
      const wy = y + a.originY;
      if (only && !only(wx, wy)) continue;
      if (climateAt(a, x, y) !== climateAt(b, wx - b.originX, wy - b.originY)) n++;
    }
  return n;
}

describe('a chunk text', () => {
  it('is version 2 or later, with the climate', () => {
    expect(CHUNK_VERSION).toBeGreaterThanOrEqual(2);
  });

  // A chunk text in a save must mean the same to every later version. Version 1, as chunks.ts
  // spells it: header 01 00 00 03 02, terrain one run of six grass (05), biome runs 3 3 5 5 0 9
  // (31 51 00 90), variant 00 00, no props (00).
  it('of version 1 decodes with its climate its biome', () => {
    const c = decodeChunk(textOf([1, 0, 0, 3, 2, 0x05, 0x31, 0x51, 0x00, 0x90, 0, 0, 0]));
    expect(c).not.toBeNull();
    expect(c!.version).toBe(1);
    expect([...c!.biome]).toEqual([3, 3, 5, 5, 0, 9]);
    expect([...c!.climate]).toEqual([3, 3, 5, 5, 0, 9]);
    // the plane is the chunk's own, not the biome's
    expect(c!.climate).not.toBe(c!.biome);
  });

  // Version 2: the same, with the climate runs after the biome's: 3 3 3 3 0 1 (33 00 10).
  it('of version 2 decodes with the climate it holds', () => {
    const bytes = [2, 0, 0, 3, 2, 0x05, 0x31, 0x51, 0x00, 0x90, 0x33, 0x00, 0x10, 0, 0, 0];
    const c = decodeChunk(textOf(bytes));
    expect(c).not.toBeNull();
    expect(c!.version).toBe(2);
    expect([...c!.biome]).toEqual([3, 3, 5, 5, 0, 9]);
    expect([...c!.climate]).toEqual([3, 3, 3, 3, 0, 1]);
    // and a version 1 header on those bytes reads the climate runs as the variant: bytes left over
    expect(decodeChunk(textOf([1, ...bytes.slice(1)]))).toBeNull();
  });

  // Version 1 holding part of its chunk (a map whose edge was off the chunk grid): header
  // 01 02 01 03 02, the 3 x 2 tiles from (2, 1); terrain six grass (05), biome runs 3 3 5 5 1 4
  // (31 51 10 40), variant 00 00, no props (00).
  // slow because it generates a world to fill the rest of the chunk: 0.31 s alone, so a limit
  // of 30 s
  it('of version 1 holding part of its chunk keeps its climate its biome when the rest is generated', () => {
    const text = textOf([1, 2, 1, 3, 2, 0x05, 0x31, 0x51, 0x10, 0x40, 0, 0, 0]);
    const old = [3, 3, 5, 5, 1, 4];
    const stored = (x: number, y: number) => x >= 2 && x < 5 && y >= 1 && y < 3;
    // the rest of the chunk generated with a biome and a climate unlike any stored tile's
    const other: MapGenerator = (s, p) => {
      const m = generateMap(s, p);
      const n = m.w * m.h;
      return {
        ...m,
        biome: new Uint8Array(n).fill(Biome.Lake),
        climate: new Uint8Array(n).fill(Biome.Desert),
      };
    };
    const built = buildMap(1, { w: 32, h: 32 }, { '0,0': text }, other);
    expect(built.added).toEqual(['0,0']);
    const m = built.map;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const was = stored(x, y) ? old[(y - 1) * 3 + x - 2] : null;
        const where = `tile (${x}, ${y})`;
        expect(m.biome[y * 32 + x], where).toBe(was ?? Biome.Lake);
        expect(climateAt(m, x, y), where).toBe(was ?? Biome.Desert);
      }
    // written again whole at today's version, and read from the store alone, the same
    expect(decodeChunk(built.chunks['0,0'])!.version).toBe(CHUNK_VERSION);
    const again = buildMap(1, { w: 32, h: 32 }, built.chunks, never);
    expect([...again.map.biome]).toEqual([...m.biome]);
    expect([...again.map.climate!]).toEqual([...m.climate!]);
  }, 30_000);

  // 4 worlds, each with two start chunks (two river plans) and three maps: about 2 s alone
  it('holds the climate of a generated map, and a map built from it reads it back', () => {
    for (const seed of [1, 7412, 20260912, 31337])
      for (const frame of [
        { w: 96, h: 96 },
        { w: 160, h: 160, originX: -32, originY: -32 },
        { w: 50, h: 70, originX: 13, originY: -7 },
      ]) {
        const at = `seed ${seed}, ${JSON.stringify(frame)}`;
        const generated = generateMap(seed, frame);
        const first = buildMap(seed, frame, {});
        expect(climateDiff(first.map, generated), at).toBe(0);
        const again = buildMap(seed, frame, first.chunks, never);
        expect(climateDiff(again.map, generated), at).toBe(0);
        expect([...again.map.climate!], at).toEqual([...generated.climate!]);
      }
  }, 40_000);

  // a world of 96 tiles built, its rivers planned once (#341), and every chunk read as both
  // versions: about 0.6 s alone
  it('as version 1 wrote it reads back every plane but the climate, which is the biome', () => {
    // the oracle above, checked: a text turned to version 1 keeps everything else
    const store = buildMap(7412, { w: 96, h: 96 }, {}).chunks;
    let differ = 0;
    for (const text of Object.values(store)) {
      const now = decodeChunk(text)!;
      const old = decodeChunk(asVersion1(text))!;
      expect(old).not.toBeNull();
      const water = {
        waterSurface: now.waterSurface,
        flow: now.flow,
        flowDir: now.flowDir,
        feature: now.feature,
      };
      expect({ ...old, version: now.version, climate: now.climate, ...water }).toEqual(now);
      expect([...old.climate]).toEqual([...old.biome]);
      // and no water level, flow, side or waterfall, which version 1 does not hold
      const planes = [old.waterSurface, old.flow, old.flowDir, old.feature];
      expect(planes.every((a) => a.every((v) => v === 0))).toBe(true);
      for (let i = 0; i < now.climate.length; i++) if (now.climate[i] !== now.biome[i]) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  }, 15_000);
});

describe('a world stored before the climate plane', () => {
  // 4 worlds of 96 x 96 stored, read and grown to 160 x 160: about 1 s alone
  it('loads with its old biomes, its climate its biome, and grows new chunks with the landform biomes over their climate', () => {
    let landforms = 0;
    for (const seed of [1, 7412, 20260912, 31337]) {
      const params: Partial<MapGenParams> = { w: 96, h: 96 };
      // the store a save made before the plane: version 1 texts of biomes that are climates
      const made = buildMap(seed, params, {}, beforeLandforms);
      const old: ChunkStore = {};
      for (const [k, text] of Object.entries(made.chunks)) old[k] = asVersion1(text);
      for (const text of Object.values(old)) expect(decodeChunk(text)!.version).toBe(1);
      // loaded, it is the world it was: no chunk generated, the old biomes, the climate the biome
      const loaded = buildMap(seed, params, old, never);
      expect(loaded.added).toEqual([]);
      expect(loaded.chunks).toEqual(old);
      expect([...loaded.map.biome]).toEqual([...made.map.biome]);
      expect(loaded.map.biome.every((b) => b < CLIMATES)).toBe(true);
      expect([...loaded.map.climate!]).toEqual([...loaded.map.biome]);
      // grown by a ring under today's generation: the old chunks as they were, the new ones today's
      const grown = { w: 160, h: 160, originX: -32, originY: -32 };
      const built = buildMap(seed, grown, old, generateMap);
      for (const [k, text] of Object.entries(old)) expect(built.chunks[k], k).toBe(text);
      const today = generateMap(seed, grown);
      const stored = (wx: number, wy: number) =>
        Object.hasOwn(old, chunkKey(chunkOf(wx), chunkOf(wy)));
      const fresh = (wx: number, wy: number) => !stored(wx, wy);
      const m = built.map;
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          const wx = x + m.originX;
          const wy = y + m.originY;
          const where = `seed ${seed}, world tile (${wx}, ${wy})`;
          if (stored(wx, wy)) {
            const j = (wy - made.map.originY) * made.map.w + wx - made.map.originX;
            expect(m.biome[i], where).toBe(made.map.biome[j]);
            expect(climateAt(m, x, y), where).toBe(m.biome[i]);
          } else {
            expect(m.biome[i], where).toBe(today.biome[i]);
            if (m.biome[i] >= CLIMATES) landforms++;
          }
        }
      expect(climateDiff(m, today, fresh), `seed ${seed}`).toBe(0);
      // and read again from its store alone, the same
      const reload = buildMap(seed, grown, built.chunks, never);
      expect([...reload.map.biome]).toEqual([...m.biome]);
      expect([...reload.map.climate!]).toEqual([...m.climate!]);
    }
    // the new chunks did get landform biomes
    expect(landforms).toBeGreaterThan(0);
  }, 30_000);
});

describe('the climate plane in a save', () => {
  // six worlds of 9 and 49 chunks: about 0.6 s alone
  it('takes a small share of the stored text of 9- and 49-chunk worlds', () => {
    // the climate is the biome but under a landform, so it costs little beside the biome: what
    // the store grows by for holding it, against the same map stored with no climate of its own
    // (its climate its biome). Measured for #354 at about 6 % of a version 4 store
    for (const seed of [1, 7412, 20260912])
      for (const [side, at] of [
        [96, -32],
        [224, -96],
      ]) {
        const { map, chunks } = buildMap(seed, { w: side, h: side, originX: at, originY: at }, {});
        expect(Object.keys(chunks)).toHaveLength((side / CHUNK_TILES) ** 2);
        const size = JSON.stringify(chunks).length;
        const none = JSON.stringify(encodeMap({ ...map, climate: undefined })).length;
        const share = ((size - none) / size) * 100;
        expect(share, `seed ${seed}, ${side} tiles`).toBeLessThan(10);
      }
  }, 15_000);

  it('holds no landform: every stored climate is a climate', () => {
    const { chunks } = buildMap(7412, { w: 160, h: 160, originX: -32, originY: -32 }, {});
    let landforms = 0;
    for (const text of Object.values(chunks)) {
      const c = decodeChunk(text)!;
      expect(c.climate.every((v) => v < CLIMATES)).toBe(true);
      landforms += c.biome.filter((b) => b >= Biome.Lake).length;
    }
    // while the biome plane beside it holds landforms
    expect(landforms).toBeGreaterThan(0);
  });
});
