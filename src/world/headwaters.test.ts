import { describe, expect, it } from 'vitest';
import { CHUNK_VERSION, buildMap, decodeChunk, encodeChunk, placeChunk } from './chunks';
import { tileLevels } from './elevation';
import { generateMap } from './mapgen';
import { oldChunkText } from './oldChunkTexts';
import { Biome, Terrain, type GameMap } from './tiles';
import {
  Headwater,
  SPRING_LEVEL,
  headwaterAt,
  headwaterOf,
  isRiverSource,
  markHeadwaters,
} from './waterfalls';

/** Worlds with glaciers and raised rivers: the default sliders, then more stone. */
const WORLDS = [
  ...[15, 16, 19, 45, 46, 64, 79, 82, 91, 93, 99, 110, 118, 132, 133].map((seed) => ({
    seed,
    params: {},
  })),
  ...[2, 3, 5, 8, 10].map((seed) => ({ seed, params: { rockLevel: 0.72 } })),
];

const onMap = (m: GameMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

describe('headwaters in generated worlds', () => {
  it('are river tiles of the kinds the issue words, and every high source has one', () => {
    const met = { melt: 0, spring: 0, sources: 0 };
    for (const { seed, params } of WORLDS) {
      const m = generateMap(seed, { w: 160, h: 160, ...params });
      const levels = tileLevels(m);
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          const at = `seed ${seed}, tile ${x},${y}`;
          const kind = headwaterAt(m, x, y);
          const edge = x < 5 || y < 5 || x >= m.w - 5 || y >= m.h - 5;
          if (kind) {
            expect(m.terrain[i], at).toBe(Terrain.Water);
            expect(m.biome[i], at).toBe(Biome.River);
          }
          const ice = SIDES.some(
            ([dx, dy]) =>
              onMap(m, x + dx, y + dy) && m.terrain[(y + dy) * m.w + x + dx] === Terrain.Ice,
          );
          if (kind === Headwater.Melt) {
            met.melt++;
            if (!edge) expect(ice, at).toBe(true);
          }
          if (kind === Headwater.Spring) {
            met.spring++;
            expect(m.waterSurface![i], at).toBeGreaterThanOrEqual(SPRING_LEVEL);
            expect(ice, at).toBe(false);
          }
          // tiles at the map's edge have their levels held down, and their upstream off the map
          if (!edge && levels[i] >= SPRING_LEVEL && isRiverSource(m, i) && !ice) {
            met.sources++;
            expect(kind, at).toBe(Headwater.Spring);
          }
        }
    }
    expect(met.melt).toBeGreaterThan(0);
    expect(met.spring).toBeGreaterThan(0);
    expect(met.sources).toBeGreaterThan(0);
  }, 60_000);
});

describe('headwaters in stored chunks', () => {
  /** A world with a spring or a melt, and the chunk it lies in. */
  function withHeadwaters() {
    for (const { seed } of WORLDS) {
      const m = generateMap(seed, { w: 160, h: 160 });
      const at = m.feature!.findIndex((f) => headwaterOf(f) !== Headwater.None);
      if (at >= 0)
        return { m, seed, cx: Math.floor((at % m.w) / 32), cy: Math.floor(at / m.w / 32) };
    }
    throw new Error('no world has a headwater');
  }

  it("read back from today's version", () => {
    const { m, seed, cx, cy } = withHeadwaters();
    const c = decodeChunk(encodeChunk(m, cx, cy))!;
    expect(c.version).toBe(CHUNK_VERSION);
    expect(c.feature.some((f) => headwaterOf(f) !== Headwater.None)).toBe(true);
    const back = generateMap(seed, { w: 160, h: 160 });
    back.feature!.fill(0);
    placeChunk(back, cx, cy, c);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = (cy * 32 + y) * m.w + cx * 32 + x;
        expect(back.feature![i]).toBe(m.feature![i]);
      }
  });

  it('are none in a chunk of an older version, and only that plane changes', () => {
    const { m, cx, cy } = withHeadwaters();
    const c = decodeChunk(encodeChunk(m, cx, cy))!;
    for (const version of [1, 2, 3, 4, 5] as const) {
      const old = decodeChunk(oldChunkText(c, version))!;
      expect(old.version).toBe(version);
      expect(old.feature.some((f) => headwaterOf(f) !== Headwater.None)).toBe(false);
      expect(old.terrain).toEqual(c.terrain);
    }
  });

  it('do not come to a world stored before them', () => {
    const { m, seed } = withHeadwaters();
    const frame = { w: 160, h: 160 };
    const store = buildMap(seed, frame, {}).chunks;
    const old: Record<string, string> = {};
    for (const [key, text] of Object.entries(store)) old[key] = oldChunkText(decodeChunk(text)!, 5);
    const back = buildMap(seed, frame, old).map;
    expect(back.feature!.some((f) => headwaterOf(f) !== Headwater.None)).toBe(false);
    expect(m.feature!.some((f) => headwaterOf(f) !== Headwater.None)).toBe(true);
  }, 30_000);
});

describe('markHeadwaters on a hand-made river', () => {
  /** A river down a column of an 8 x 8 map from (3, 1), at level `level`. */
  function river(level: number) {
    const w = 8;
    const h = 8;
    const terrain = new Uint8Array(w * h);
    const waterSurface = new Uint8Array(w * h);
    const flowDir = new Uint8Array(w * h);
    for (let y = 1; y < 7; y++) {
      terrain[y * w + 3] = Terrain.Water;
      waterSurface[y * w + 3] = level;
      flowDir[y * w + 3] = 3;
    }
    return { w, h, terrain, waterSurface, flowDir };
  }
  const all = { x0: 0, y0: 0, x1: 8, y1: 8 };
  const none = new Uint8Array(64);

  it('puts a spring on a high source and nothing on a low one', () => {
    const high = river(2);
    const out = new Uint8Array(64);
    markHeadwaters(high, out, all, none);
    expect(headwaterOf(out[1 * 8 + 3])).toBe(Headwater.Spring);
    expect(out.filter((f) => f).length).toBe(1);
    const low = new Uint8Array(64);
    markHeadwaters(river(1), low, all, none);
    expect(low.some((f) => f)).toBe(false);
  });

  it('puts no spring below a lake, and a melt where the plan says', () => {
    const p = river(2);
    p.terrain[3] = Terrain.Water;
    const out = new Uint8Array(64);
    markHeadwaters(p, out, all, none);
    expect(out.some((f) => f)).toBe(false);
    const melt = new Uint8Array(64);
    melt[4 * 8 + 3] = 1;
    markHeadwaters(p, out, all, melt);
    expect(headwaterOf(out[4 * 8 + 3])).toBe(Headwater.Melt);
  });

  it('keeps the waterfall bits of the tile', () => {
    const out = new Uint8Array(64);
    out[1 * 8 + 3] = 1 | (2 << 3);
    markHeadwaters(river(2), out, all, none);
    expect(out[1 * 8 + 3] & 0b1_1111).toBe(1 | (2 << 3));
    expect(headwaterOf(out[1 * 8 + 3])).toBe(Headwater.Spring);
  });
});
