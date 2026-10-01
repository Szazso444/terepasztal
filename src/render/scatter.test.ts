import { describe, it, expect } from 'vitest';
import { generateMap } from '../world/mapgen';
import { Biome, Terrain } from '../world/tiles';
import { scatterFor, type ScatterContext } from './scatter';

describe('visual scatter', () => {
  it('puts nature only where it belongs and never on built or paved ground', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      occupied = new Set<number>(),
      city = new Set<number>();
    for (let k = 0; k < map.w * map.h; k += 97) occupied.add(k);
    for (let k = 13; k < map.w * map.h; k += 211) city.add(k);
    const steep = (x: number, y: number) => (x * 7 + y * 3) % 5 === 0;
    const ctx: ScatterContext = {
      occupied: (x, y) => occupied.has(y * map.w + x),
      city: (x, y) => city.has(y * map.w + x),
      steep,
    };
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= map.w || y >= map.h ? -1 : map.terrain[y * map.w + x];
    const near = (x: number, y: number, ...ts: Terrain[]) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => ts.includes(at(x + dx, y + dy)));
    let placed = 0,
      eligible = 0;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const k = y * map.w + x,
          t = map.terrain[k],
          list = scatterFor(map, x, y, ctx);
        expect(scatterFor(map, x, y, ctx)).toEqual(list);
        if (map.props.has(k) || occupied.has(k) || city.has(k)) {
          expect(list).toEqual([]);
          continue;
        }
        if (t === Terrain.Grass || t === Terrain.Hill) eligible++;
        if (list.length) placed++;
        for (const p of list) {
          expect([Terrain.Grass, Terrain.Hill, Terrain.Sand]).toContain(t);
          expect(Math.abs(p.ox)).toBeLessThanOrEqual(0.42);
          expect(Math.abs(p.oy)).toBeLessThanOrEqual(0.42);
          if (p.kind === 'reeds' && map.biome[k] !== Biome.Swamp)
            expect(near(x, y, Terrain.Water)).toBe(true);
          if (p.kind === 'rock' || p.kind === 'boulder')
            expect(
              steep(x, y) ||
                near(x, y, Terrain.Mountain, Terrain.Rock) ||
                map.biome[k] === Biome.Desert ||
                map.biome[k] === Biome.Taiga,
            ).toBe(true);
          if (p.kind === 'flowers')
            expect([Biome.Plains, Biome.Forest]).toContain(map.biome[k] as Biome);
        }
      }
    // Lively but not sprinkled everywhere.
    expect(placed / eligible).toBeGreaterThan(0.03);
    expect(placed / eligible).toBeLessThan(0.4);
  });
});
