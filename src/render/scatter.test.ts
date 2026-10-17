import { describe, it, expect } from 'vitest';
import { generateMap } from '../world/mapgen';
import { Biome, Terrain } from '../world/tiles';
import { clearedByPaving, propsShown, scatterFor, type ScatterContext } from './scatter';
import { isTree } from './assetScale';
import { TownPaving } from './townPaving';

describe('visual scatter', () => {
  // slow because it generates a 96 x 96 map and scatters nature over all of it: 0.52 s alone, so a
  // limit of 30 s
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
  }, 30_000);

  it('clears the bushes, flowers and rocks of paved tiles and nothing else, and leaves the rest as it was', () => {
    const map = generateMap(7412, { w: 96, h: 96 }),
      tiles = new Set<number>();
    for (let k = 5; k < map.w * map.h; k += 7) tiles.add(k);
    // the painter's own test, built from the same tiles the renderer hands the landscape
    const paving = new TownPaving(map.w, map.h, map.originX, map.originY, tiles),
      none = new TownPaving(map.w, map.h, map.originX, map.originY, []);
    const ctx = (city: (k: number) => boolean): ScatterContext => ({
      occupied: () => false,
      city: (x, y) => city(y * map.w + x),
      steep: (x, y) => (x * 7 + y * 3) % 5 === 0,
    });
    const withPaving = ctx((k) => paving.paved(k)),
      without = ctx((k) => none.paved(k));
    const seen = new Set<string>();
    let kept = 0,
      cleared = 0;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const k = y * map.w + x,
          generated = map.props.get(k) ?? [],
          list = [...generated, ...scatterFor(map, x, y, without)];
        expect(paving.paved(k)).toBe(tiles.has(k));
        const shown = propsShown(list, paving.paved(k));
        if (!paving.paved(k)) {
          // an unpaved tile gives what it gave with no paving at all
          expect(shown).toEqual(propsShown(list, none.paved(k)));
          expect(shown).toEqual(list);
          // and scatter there does not depend on which other tiles are paved
          expect(scatterFor(map, x, y, withPaving)).toEqual(scatterFor(map, x, y, without));
          continue;
        }
        for (const p of list) seen.add(p.kind);
        for (const p of shown) expect(clearedByPaving(p.kind)).toBe(false);
        for (const p of list)
          if (clearedByPaving(p.kind)) cleared++;
          else {
            kept++;
            expect(shown).toContain(p);
          }
        // the generated props are only filtered, never changed
        expect(map.props.get(k) ?? []).toEqual(generated);
      }
    // paved ground gave nothing to the scatter, so only the map's own props were in play
    expect(cleared).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
    // the rule: trees, wheat and deposits stay, the rest gives way
    for (const kind of seen) {
      const stays = isTree(kind) || kind === 'wheat' || kind === 'coal' || kind === 'oil';
      expect(clearedByPaving(kind as never), kind).toBe(!stays);
    }
  }, 30_000);
});
