import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import { levelAt, tileLevels, MAX_LEVEL } from './elevation';
import { Terrain } from './tiles';

describe('tile elevation', () => {
  it('computes each level locally exactly as the whole-map pass does', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      levels = tileLevels(map);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) expect(levelAt(map, x, y)).toBe(levels[y * map.w + x]);
  });
  it('keeps ordinary ground at sea level and neighbours within one level', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      levels = tileLevels(map);
    let raised = 0;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const k = y * map.w + x,
          t = map.terrain[k];
        if (t !== Terrain.Hill && t !== Terrain.Mountain) expect(levels[k]).toBe(0);
        else raised++;
        expect(levels[k]).toBeLessThanOrEqual(MAX_LEVEL);
        if (x) expect(Math.abs(levels[k] - levels[k - 1])).toBeLessThanOrEqual(1);
        if (y) expect(Math.abs(levels[k] - levels[k - map.w])).toBeLessThanOrEqual(1);
      }
    expect(raised).toBeGreaterThan(0);
  });
});
