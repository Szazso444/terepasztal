import { describe, it, expect } from 'vitest';
import { generateMap } from './mapgen';
import {
  LEGACY_MOUNTAIN_LEVEL,
  levelAt,
  levelTarget,
  maxStep,
  tileLevels,
  MAX_LEVEL,
  NO_LEVEL,
} from './elevation';
import { MAX_WATER_LEVEL } from './waterfalls';
import { Terrain, type GameMap } from './tiles';
import { SEEDS, forAll } from '../testing/property';

/** A map of w x h tiles of ground that sets no level itself (Grass), with the planes it is given. */
function flatMap(
  w: number,
  h: number,
  planes: Pick<Partial<GameMap>, 'generatedLevel' | 'groundLevel'> = {},
) {
  return { w, h, terrain: new Uint8Array(w * h).fill(Terrain.Grass), ...planes };
}

/** A plane of w x h tiles at NO_LEVEL, with the given tiles (x, y, level) set. */
function plane(w: number, h: number, set: [number, number, number][], base = NO_LEVEL) {
  const p = new Uint8Array(w * h).fill(base);
  for (const [x, y, level] of set) p[y * w + x] = level;
  return p;
}

/** A map of the given rows of terrain, no planes. */
function terrainMap(rows: Terrain[][]) {
  const h = rows.length,
    w = rows[0].length;
  return { w, h, terrain: Uint8Array.from(rows.flat()) };
}

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
            if (terrain[i] === Terrain.Water) waterSurface[i] = rng.int(0, MAX_WATER_LEVEL);
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

  it('reads the player plane before the generated one', () => {
    const m = flatMap(7, 7, {
      generatedLevel: plane(7, 7, [], 2),
      groundLevel: plane(7, 7, [[3, 3, 3]]),
    });
    const levels = tileLevels(m);
    expect([levels[3 * 7 + 2], levels[3 * 7 + 3], levels[3 * 7 + 4]]).toEqual([2, 3, 2]);
    expect(levelTarget(m, 3 * 7 + 3)).toBe(3);
    expect(levelTarget(m, 3 * 7 + 2)).toBe(2);
  });
  it('keeps a generated step of 4 and clamps a step of 5', () => {
    for (const [level, want] of [
      [4, 4],
      [5, 4],
    ]) {
      const m = flatMap(9, 9, { generatedLevel: plane(9, 9, [[4, 4, level]], 0) });
      expect(maxStep(m)).toBe(4);
      expect(tileLevels(m)[4 * 9 + 4]).toBe(want);
      expect(levelAt(m, 4, 4)).toBe(want);
    }
  });
  it('keeps the one-level rule without a plane', () => {
    const G = Terrain.Grass,
      M = Terrain.Mountain;
    const m = terrainMap([[G, G, G, G, G, G, G]]);
    expect(maxStep(m)).toBe(1);
    const rows = Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 11 }, (_, x) => (x > 0 && y > 0 && x < 10 && y < 10 ? M : G)),
    );
    const mountain = terrainMap(rows);
    const levels = tileLevels(mountain);
    // a mountain with no plane stops at the old top, however wide the block
    expect(levelAt(mountain, 5, 5)).toBe(levels[5 * 11 + 5]);
    expect(levels[5 * 11 + 5]).toBe(LEGACY_MOUNTAIN_LEVEL);
    expect(Math.max(...levels)).toBe(LEGACY_MOUNTAIN_LEVEL);
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 11; x++) {
        if (x)
          expect(
            Math.abs(levelAt(mountain, x, y) - levelAt(mountain, x - 1, y)),
          ).toBeLessThanOrEqual(1);
        if (y)
          expect(
            Math.abs(levelAt(mountain, x, y) - levelAt(mountain, x, y - 1)),
          ).toBeLessThanOrEqual(1);
      }
  });
  it('agrees with tileLevels on every tile of a map with both planes', () => {
    const palette = [Terrain.Grass, Terrain.Hill, Terrain.Mountain, Terrain.Water];
    forAll(
      (rng) => {
        const w = rng.int(1, 12),
          h = rng.int(1, 12);
        const terrain = new Uint8Array(w * h);
        const waterSurface = new Uint8Array(w * h);
        const raw = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          terrain[i] = rng.pick(palette);
          waterSurface[i] = rng.int(0, MAX_WATER_LEVEL);
          raw[i] = rng.chance(0.3) ? NO_LEVEL : rng.int(0, MAX_LEVEL);
        }
        // the planes a map stores hold settled levels: tileLevels of the raw ones, the player's
        // plane set on some tiles only
        const levels = tileLevels({ w, h, terrain, waterSurface, generatedLevel: raw });
        const groundLevel = new Uint8Array(w * h).fill(NO_LEVEL);
        for (let i = 0; i < w * h; i++) if (rng.chance(0.3)) groundLevel[i] = levels[i];
        return { w, h, terrain, waterSurface, generatedLevel: levels, groundLevel, raw };
      },
      (m) => {
        const settled = tileLevels(m);
        expect([...settled]).toEqual([...m.generatedLevel]);
        for (let y = 0; y < m.h; y++)
          for (let x = 0; x < m.w; x++)
            if (levelAt(m, x, y) !== settled[y * m.w + x])
              throw new Error(
                `levelAt ${levelAt(m, x, y)}, ${settled[y * m.w + x]} at (${x}, ${y})`,
              );
        // a plane that sets nothing falls to the terrain, a step of 4 for tile and tile
        const unset = {
          ...m,
          generatedLevel: new Uint8Array(m.w * m.h).fill(NO_LEVEL),
          groundLevel: undefined,
        };
        const want = tileLevels(unset);
        for (let y = 0; y < m.h; y++)
          for (let x = 0; x < m.w; x++)
            if (levelAt(unset, x, y) !== want[y * m.w + x])
              throw new Error(
                `unset levelAt ${levelAt(unset, x, y)}, ${want[y * m.w + x]} at (${x}, ${y})`,
              );
      },
      {
        seeds: SEEDS.slice(0, 40),
        format: (m) => `${m.w} x ${m.h}: terrain ${m.terrain.join('')}, planes ${m.raw.join(',')}`,
      },
    );
  });
});
