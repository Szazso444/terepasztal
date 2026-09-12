import { describe, it, expect } from 'vitest';
import { generateMap, emptyMap, DEFAULT_MAP_PARAMS } from './mapgen';
import { Terrain } from './tiles';

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
    expect(fnv(m.terrain)).toBe(643269639);
    expect(fnv(m.biome)).toBe(2631767123);
    expect(fnv(m.variant)).toBe(417171169);
    expect(m.props.size).toBe(354);
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

describe('emptyMap', () => {
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
