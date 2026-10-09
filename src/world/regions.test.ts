import { describe, it, expect } from 'vitest';
import { emptyMap } from './mapgen';
import { RegionState, regionTierMap } from './regions';

/** Every map size a new game offers (`rules.mapSize`: 32 to 480 in steps of 32), and one between. */
const SIZES = [48, ...Array.from({ length: 15 }, (_, k) => 32 * (k + 1))];

describe('the start chunk', () => {
  it.each(SIZES)('is the one chunk a new %i-tile map owns', (s) => {
    const map = emptyMap(1, s, s);
    const regions = new RegionState(map, 0);
    const start =
      Math.floor((map.regionsY - 1) / 2) * map.regionsX + Math.floor((map.regionsX - 1) / 2);
    expect(regions.ownedCount()).toBe(1);
    expect(regions.unlocked[start]).toBe(true);
  });

  it.each(SIZES)('is ring 0 and every ring is a whole number of chunks (%i tiles)', (s) => {
    const tiers = regionTierMap(emptyMap(1, s, s));
    expect(tiers.filter((t) => t === 0)).toHaveLength(1);
    for (const t of tiers) expect(Number.isInteger(t)).toBe(true);
  });

  it.each(SIZES)('keeps every chunk in its ring when a %i-tile map grows by one ring', (s) => {
    const small = emptyMap(1, s, s);
    const big = emptyMap(1, s + 64, s + 64);
    const before = regionTierMap(small);
    const after = regionTierMap(big);
    before.forEach((t, i) => {
      const rx = (i % small.regionsX) + 1;
      const ry = Math.floor(i / small.regionsX) + 1;
      expect(after[ry * big.regionsX + rx]).toBe(t);
    });
  });
});
