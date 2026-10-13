import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import { levelAt, levelTarget, tileLevels, MAX_LEVEL } from './elevation';
import { Terrain } from './tiles';

describe('tile elevation', () => {
  // a generated map, each tile's level read on its own: about 0.5 s alone
  it('computes each level locally exactly as the whole-map pass does', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      levels = tileLevels(map);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) expect(levelAt(map, x, y)).toBe(levels[y * map.w + x]);
  }, 10_000);
  it('keeps ordinary ground at sea level and neighbours within one level', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      levels = tileLevels(map);
    let raised = 0;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const k = y * map.w + x,
          t = map.terrain[k];
        if (t === Terrain.Hill || t === Terrain.Mountain) raised++;
        else if (t !== Terrain.Water) expect(levels[k]).toBe(0);
        expect(levels[k]).toBeLessThanOrEqual(MAX_LEVEL);
        if (x) expect(Math.abs(levels[k] - levels[k - 1])).toBeLessThanOrEqual(1);
        if (y) expect(Math.abs(levels[k] - levels[k - map.w])).toBeLessThanOrEqual(1);
      }
    expect(raised).toBeGreaterThan(0);
  });
  it('stands water at its own level, and a map without the plane at level 0', () => {
    // a 5 x 5 plateau of hill with a pool at its middle raised to level 2
    const map = generateMap(1, { w: 32, h: 32 });
    map.terrain.fill(Terrain.Grass);
    for (let y = 10; y < 15; y++)
      for (let x = 10; x < 15; x++) map.terrain[y * 32 + x] = Terrain.Hill;
    const pool = 12 * 32 + 12;
    map.terrain[pool] = Terrain.Water;
    map.waterSurface = new Uint8Array(32 * 32);
    map.waterSurface[pool] = 2;
    expect(levelTarget(map, pool)).toBe(2);
    expect(tileLevels(map)[pool]).toBe(2);
    expect(levelAt(map, 12, 12)).toBe(2);
    // the level is the water's only while the tile is water
    map.terrain[pool] = Terrain.Grass;
    expect(levelTarget(map, pool)).toBe(0);
    map.terrain[pool] = Terrain.Water;
    const bare = { w: map.w, h: map.h, terrain: map.terrain };
    expect(levelTarget(bare, pool)).toBe(0);
    expect(levelAt(bare, 12, 12)).toBe(0);
  });
});
