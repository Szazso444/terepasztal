import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import { levelAt, levelTarget, tileLevels, MAX_LEVEL } from './elevation';
import { Terrain } from './tiles';
import { forAll } from '../testing/property';

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

  // Against the closed form: a tile stands at the least of every tile's levelTarget plus the steps
  // to it, and of one plus the steps to the map's border. Maps up to 20 x 20 of any terrain, water
  // at any level up to MAX_LEVEL, with and without the plane.
  it('reads every level, raised water included, as the least target plus distance', () => {
    const palette = [
      Terrain.Grass,
      Terrain.Forest,
      Terrain.Sand,
      Terrain.Rock,
      Terrain.Hill,
      Terrain.Mountain,
      Terrain.Water,
    ];
    let raised = 0;
    forAll(
      (rng) => {
        const w = rng.int(1, 20);
        const h = rng.int(1, 20);
        const terrain = new Uint8Array(w * h);
        const lumps = rng.chance(0.5);
        for (let i = 0; i < w * h; i++)
          terrain[i] = lumps && i > 0 && rng.chance(0.7) ? terrain[i - 1] : rng.pick(palette);
        const plane = rng.chance(0.8);
        const waterSurface = plane ? new Uint8Array(w * h) : undefined;
        if (waterSurface)
          for (let i = 0; i < w * h; i++)
            if (terrain[i] === Terrain.Water) waterSurface[i] = rng.int(0, MAX_LEVEL);
        return { w, h, terrain, waterSurface };
      },
      (m) => {
        const levels = tileLevels(m);
        for (let y = 0; y < m.h; y++)
          for (let x = 0; x < m.w; x++) {
            let want = 1 + Math.min(x, y, m.w - 1 - x, m.h - 1 - y);
            for (let j = 0; j < m.w * m.h; j++) {
              const d = Math.abs((j % m.w) - x) + Math.abs(Math.floor(j / m.w) - y);
              want = Math.min(want, levelTarget(m, j) + d);
            }
            const i = y * m.w + x;
            if (levels[i] !== want)
              throw new Error(`tileLevels ${levels[i]}, ${want} at (${x}, ${y})`);
            if (levelAt(m, x, y) !== want)
              throw new Error(`levelAt ${levelAt(m, x, y)}, ${want} at (${x}, ${y})`);
            if (m.terrain[i] === Terrain.Water && levels[i] > 1) raised++;
          }
      },
      {
        format: (m) =>
          `${m.w} x ${m.h}: terrain ${m.terrain.join('')}, ` +
          `water levels ${m.waterSurface ? m.waterSurface.join('') : 'none'}`,
      },
    );
    // water above level 1 stood at its own level somewhere
    expect(raised).toBeGreaterThan(0);
  });
});
