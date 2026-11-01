import { describe, expect, it } from 'vitest';
import { LEVEL_CAP, STAT_PER_LEVEL, levelMul } from './items';

describe('vehicle levels', () => {
  // these two came from the gacha table when it left: a train's speed and haul read them, so a
  // change here moves trains
  it('keep the cap and the gain per level they always had', () => {
    expect(LEVEL_CAP).toBe(5);
    expect(STAT_PER_LEVEL).toBe(0.08);
  });

  it('multiply stats from 1 at the first level', () => {
    expect(levelMul(1)).toBe(1);
    expect(levelMul(2)).toBeCloseTo(1.08, 10);
    expect(levelMul(LEVEL_CAP)).toBeCloseTo(1.32, 10);
  });
});
