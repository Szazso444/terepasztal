import { describe, it, expect } from 'vitest';
import {
  dimensions,
  rotatePoint,
  footprint,
  canPlace,
} from '../scratchpad/grid-buildings/footprint.mjs';
describe('one/two cell building study', () => {
  it('keeps cell count and rotates every point inside the same footprint', () => {
    for (const tiles of [1, 2])
      for (let r = 0; r < 4; r++) {
        const [w, h] = dimensions(tiles, r);
        expect(footprint(2, 2, tiles, r)).toHaveLength(tiles);
        for (const [x, y] of [
          [0, 0],
          [tiles, 0],
          [tiles, 1],
          [0, 1],
        ]) {
          const [a, b] = rotatePoint(x, y, tiles, r);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(w);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(h);
        }
      }
  });
  it('checks the second tile after rotation, including map bounds', () => {
    expect(canPlace(2, 2, 2, 0, new Set(['2,3']))).toBe(true);
    expect(canPlace(2, 2, 2, 1, new Set(['2,3']))).toBe(false);
    expect(canPlace(4, 4, 2, 0, new Set())).toBe(false);
    expect(canPlace(4, 4, 1, 3, new Set())).toBe(true);
  });
});
