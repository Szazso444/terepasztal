import { describe, it, expect } from 'vitest';
import { generateMap, emptyMap, DEFAULT_MAP_PARAMS } from './mapgen';
import { Terrain, type GameMap, type PropInstance } from './tiles';
import { hashString } from '../engine/rng';
import { setSupplyMode } from '../sim/supply';

/** Stable FNV-1a over a tile plane, so a generation change shows up as one number. */
function fnv(a: Uint8Array) {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const count = (a: Uint8Array, t: Terrain) => a.reduce((n, v) => n + (v === t ? 1 : 0), 0);

/** One tile's props as text: every field, numbers exact. */
const propText = (list: PropInstance[] | undefined) =>
  (list ?? []).map((p) => `${p.kind},${p.variant},${p.ox},${p.oy}`).join(';');
/** FNV-1a over every tile's props in tile order, so a moved, added or changed prop shows. */
function propHash(m: GameMap) {
  const parts: string[] = [];
  for (let i = 0; i < m.w * m.h; i++)
    if (m.props.has(i)) parts.push(`${i}:${propText(m.props.get(i))}`);
  return hashString(parts.join('|'));
}

/**
 * Tiles of `small` that differ from the same world tiles of `big`, per plane. `big` must contain
 * `small` (its origin at or before small's and its far edge at or after).
 */
function overlapDiff(small: GameMap, big: GameMap) {
  const dx = small.originX - big.originX;
  const dy = small.originY - big.originY;
  const diff = { terrain: 0, biome: 0, variant: 0, props: 0 };
  for (let y = 0; y < small.h; y++)
    for (let x = 0; x < small.w; x++) {
      const i = y * small.w + x;
      const j = (y + dy) * big.w + x + dx;
      if (small.terrain[i] !== big.terrain[j]) diff.terrain++;
      if (small.biome[i] !== big.biome[j]) diff.biome++;
      if (small.variant[i] !== big.variant[j]) diff.variant++;
      if (propText(small.props.get(i)) !== propText(big.props.get(j))) diff.props++;
    }
  return diff;
}
const SAME = { terrain: 0, biome: 0, variant: 0, props: 0 };
/** A generated map of `w` x `w` grown by one ring of 32-tile chunks, as `expandSave` grows it. */
const grown = (seed: number, w: number) =>
  generateMap(seed, { w: w + 64, h: w + 64, originX: -32, originY: -32 });

const SEED = 20260912;
const SMALL = { w: 48, h: 48 };

describe('generateMap', () => {
  it('gives the same world for the same seed', () => {
    const a = generateMap(SEED, SMALL);
    const b = generateMap(SEED, SMALL);
    expect(fnv(a.terrain)).toBe(fnv(b.terrain));
    expect(fnv(a.biome)).toBe(fnv(b.biome));
    expect(fnv(a.variant)).toBe(fnv(b.variant));
    expect(a.props.size).toBe(b.props.size);
  });

  it('gives a different world for a different seed', () => {
    expect(fnv(generateMap(SEED, SMALL).terrain)).not.toBe(
      fnv(generateMap(SEED + 1, SMALL).terrain),
    );
  });

  it('generates the world these numbers describe', () => {
    // A tripwire, not a specification: any deliberate change to map generation invalidates
    // every existing seed, so re-bless these numbers on purpose or not at all.
    const m = generateMap(SEED, SMALL);
    expect(fnv(m.terrain)).toBe(2330203531);
    expect(fnv(m.biome)).toBe(4076181840);
    expect(fnv(m.variant)).toBe(417171169);
    expect(m.props.size).toBe(361);
  });

  it('fills the plane it was asked for', () => {
    const m = generateMap(SEED, SMALL);
    expect(m.w).toBe(SMALL.w);
    expect(m.h).toBe(SMALL.h);
    expect(m.terrain).toHaveLength(SMALL.w * SMALL.h);
    expect(m.biome).toHaveLength(SMALL.w * SMALL.h);
    expect(m.variant).toHaveLength(SMALL.w * SMALL.h);
    expect(m.seed).toBe(SEED);
  });

  it('raises the water line with waterLevel', () => {
    const dry = generateMap(SEED, { ...SMALL, waterLevel: 0.2 });
    const mid = generateMap(SEED, SMALL);
    const wet = generateMap(SEED, { ...SMALL, waterLevel: 0.5 });
    expect(count(dry.terrain, Terrain.Water)).toBeLessThan(count(mid.terrain, Terrain.Water));
    expect(count(mid.terrain, Terrain.Water)).toBeLessThan(count(wet.terrain, Terrain.Water));
  });

  it('thins the forest as forestDensity rises', () => {
    // Despite the name it is a moisture threshold, as the tuning slider says: lower = more
    // forest. Above the default the threshold stops biting and only the forest biome is left,
    // so the count floors rather than falling further.
    const at = (v: number) =>
      count(generateMap(SEED, { ...SMALL, forestDensity: v }).terrain, Terrain.Forest);
    const sweep = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(at);
    for (let i = 1; i < sweep.length; i++) expect(sweep[i]).toBeLessThanOrEqual(sweep[i - 1]);
    expect(sweep[0]).toBeGreaterThan(sweep[sweep.length - 1]);
  });

  it('defaults to the documented parameters', () => {
    const m = generateMap(SEED);
    expect(m.w).toBe(DEFAULT_MAP_PARAMS.w);
    expect(m.h).toBe(DEFAULT_MAP_PARAMS.h);
  });
});

describe('a grown map', () => {
  const SEEDS = [SEED, 1, 7412, 31337, 987654321];

  it.each(SEEDS)('keeps every old tile when 96 grows to 160 (seed %i)', (seed) => {
    expect(overlapDiff(generateMap(seed, { w: 96, h: 96 }), grown(seed, 96))).toEqual(SAME);
  });

  it.each(SEEDS)('keeps every old tile when 160 grows to 224 (seed %i)', (seed) => {
    expect(overlapDiff(generateMap(seed, { w: 160, h: 160 }), grown(seed, 160))).toEqual(SAME);
  });

  it.each([32, 64, 128])('keeps every old tile when %i grows by a ring', (w) => {
    expect(overlapDiff(generateMap(SEED, { w, h: w }), grown(SEED, w))).toEqual(SAME);
  });

  it('keeps every old tile, oil fields and start seeps included, in the full production chain', () => {
    setSupplyMode('full');
    try {
      const seed = 7412;
      const small = generateMap(seed, { w: 96, h: 96 });
      expect([...small.props.values()].some((l) => l[0].kind === 'oil')).toBe(true);
      expect(overlapDiff(small, grown(seed, 96))).toEqual(SAME);
      expect(overlapDiff(generateMap(seed, { w: 160, h: 160 }), grown(seed, 160))).toEqual(SAME);
    } finally {
      setSupplyMode('simple');
    }
  });

  it('generates the worlds these numbers describe', () => {
    // Tripwires like the one above, at the default map size and that map grown by one ring.
    const m = generateMap(SEED, { w: 160, h: 160 });
    expect([fnv(m.terrain), fnv(m.biome), fnv(m.variant), propHash(m)]).toEqual([
      2688962428, 1335671557, 1813736059, 4170314098,
    ]);
    const g = grown(SEED, 160);
    expect([fnv(g.terrain), fnv(g.biome), fnv(g.variant), propHash(g)]).toEqual([
      814356426, 211014301, 1107381422, 3078554006,
    ]);
  });
});

describe('emptyMap', () => {
  it('hashes the variant plane on world coordinates', () => {
    const small = emptyMap(7, 16, 16, Terrain.Grass, -4, 3);
    const big = emptyMap(7, 40, 40, Terrain.Grass, -20, -20);
    expect(overlapDiff(small, big).variant).toBe(0);
  });

  it('is one terrain, no props, and remembers where it starts', () => {
    const m = emptyMap(7, 10, 12, Terrain.Sand, -4, 5);
    expect(m.terrain).toHaveLength(120);
    expect([...new Set(m.terrain)]).toEqual([Terrain.Sand]);
    expect(m.props.size).toBe(0);
    expect(m.originX).toBe(-4);
    expect(m.originY).toBe(5);
    expect(m.seed).toBe(7);
  });

  it('covers every tile with regions', () => {
    const m = emptyMap(1, 40, 24);
    expect(m.regionsX * m.regionSize).toBeGreaterThanOrEqual(m.w);
    expect(m.regionsY * m.regionSize).toBeGreaterThanOrEqual(m.h);
  });
});
