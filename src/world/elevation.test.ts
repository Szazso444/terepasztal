import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import {
  levelAt,
  tileLevels,
  gradeFactor,
  CLIMB_SPEED,
  DESCENT_SPEED,
  MAX_LEVEL,
} from './elevation';
import { emptyMap } from './mapgen';
import { Dir } from '../engine/iso';
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
  it('slows trains climbing a hill and speeds them coming down, both ways consistently', () => {
    const m = emptyMap(3, 16, 16);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) m.terrain[y * 16 + x] = Terrain.Hill;
    // Eastbound along row 8: the hill rises from x = 4, levels off, and falls after x = 11.
    const east = (x: number) => gradeFactor(m, x, 8, Dir.W, Dir.E),
      west = (x: number) => gradeFactor(m, x, 8, Dir.E, Dir.W);
    expect(east(4)).toBe(CLIMB_SPEED);
    expect(west(4)).toBe(DESCENT_SPEED);
    expect(east(11)).toBe(DESCENT_SPEED);
    expect(east(1)).toBe(1);
    for (let x = 1; x < 15; x++) expect(east(x) === CLIMB_SPEED).toBe(west(x) === DESCENT_SPEED);
  });
});
