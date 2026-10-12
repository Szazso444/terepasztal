import { describe, expect, it } from 'vitest';
import {
  BIOME_MATERIAL,
  Material,
  MATERIAL_COLORS,
  biomeMaterial,
  groundMaterial,
  heightAt,
  landscapeColor,
  landscapeHeights,
  materialAt,
  snowLineAt,
  stoneGroundAt,
  type LandscapeMap,
} from './landscapeModel';
import { BIOME_DEFS } from '../sim/biomes';
import { Terrain } from '../world/tiles';

function map(): LandscapeMap {
  return {
    w: 24,
    h: 24,
    seed: 71,
    originX: 0,
    originY: 0,
    terrain: new Uint8Array(576),
    biome: new Uint8Array(576),
  };
}
describe('continuous landscape invariants', () => {
  it('makes dense hills higher than isolated hills without changing the map', () => {
    const isolated = map();
    isolated.terrain[12 * 24 + 12] = Terrain.Hill;
    const dense = map();
    for (let y = 5; y < 20; y++)
      for (let x = 5; x < 20; x++) dense.terrain[y * 24 + x] = Terrain.Hill;
    const before = dense.terrain.slice();
    expect(landscapeHeights(dense, new Set())[300]).toBeGreaterThan(
      landscapeHeights(isolated, new Set())[300] * 2,
    );
    expect(dense.terrain).toEqual(before);
  });
  it('keeps excavation flat and bounds every slope so projected surfaces cannot fold', () => {
    const m = map();
    m.terrain.fill(Terrain.Mountain);
    const heights = landscapeHeights(m, new Set([300]));
    expect(heightAt(m, heights, 12, 12)).toBe(0);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const k = y * m.w + x;
        if (x) expect(Math.abs(heights[k] - heights[k - 1])).toBeLessThanOrEqual(9.001);
        if (y) expect(Math.abs(heights[k] - heights[k - m.w])).toBeLessThanOrEqual(9.001);
      }
  });
  it('anchors texture to world coordinates across map expansion and avoids tile repetition', () => {
    const m = map(),
      expanded = { ...map(), originX: -5, originY: -7 };
    const before = landscapeColor(m, 8.25, 9.1),
      after = landscapeColor(expanded, 13.25, 16.1);
    before.forEach((channel, i) => expect(channel).toBeCloseTo(after[i], 10));
    const samples = Array.from({ length: 12 }, (_, x) =>
      landscapeColor(m, x + 0.25, 7.2)
        .map(Math.round)
        .join(','),
    );
    expect(new Set(samples).size).toBeGreaterThan(8);
  });
});

/** The biome ids #340 and #354 add after ocean. */
const LAKE = 6,
  RIVER = 7,
  BEACH = 8,
  MOUNTAIN = 9;
const TERRAINS = [0, 1, 2, 3, 4, 5, 6];
const OLD_BIOMES = [0, 1, 2, 3, 4, 5];
const NEW_BIOMES = [LAKE, RIVER, BEACH, MOUNTAIN];
const ALL_BIOMES = OLD_BIOMES.concat(NEW_BIOMES);
/** The level where snow starts for each biome id, as the data gives it to the landscape. */
const SNOW_LEVELS = BIOME_DEFS.map((def) => def.snowLevel);

/** A 3 x 3 map of one terrain and biome, with a climate where one is given. */
function ground(terrain: number, biome: number, climate?: number): LandscapeMap {
  const m: LandscapeMap = {
    w: 3,
    h: 3,
    seed: 5,
    originX: 0,
    originY: 0,
    terrain: new Uint8Array(9).fill(terrain),
    biome: new Uint8Array(9).fill(biome),
  };
  if (climate !== undefined) m.climate = new Uint8Array(9).fill(climate);
  return m;
}
const materialOf = (terrain: number, biome: number) => materialAt(ground(terrain, biome), 1, 1);

/** The rules as they stood when biome ids 0 to 5 were all there were: what must not move. */
function materialBefore(terrain: number, biome: number) {
  if (terrain === Terrain.Water) return 5;
  if (terrain === Terrain.Sand) return biome === 2 ? 2 : 6;
  if (terrain === Terrain.Rock || terrain === Terrain.Mountain) return 7;
  if (terrain === Terrain.Forest) return biome === 4 ? 4 : biome === 3 ? 3 : 1;
  return biome === 5 ? 0 : biome;
}
const snowLineBefore = (biome: number) => (biome === 3 ? 3 : biome === 2 ? 5 : 4);
const stoneGroundBefore = (biome: number) => (biome === 5 ? 0 : biome);

describe('the biome to material table', () => {
  it('has an entry for every biome the content defines, in id order', () => {
    expect(BIOME_MATERIAL).toHaveLength(BIOME_DEFS.length);
    expect(BIOME_DEFS.slice(LAKE).map((def) => def.id)).toEqual([
      'lake',
      'river',
      'beach',
      'mountain',
    ]);
  });
  it('maps lake and river to water, beach to sand and mountain to rock', () => {
    expect(biomeMaterial(LAKE)).toBe(Material.Water);
    expect(biomeMaterial(RIVER)).toBe(Material.Water);
    expect(biomeMaterial(BEACH)).toBe(Material.Sand);
    expect(biomeMaterial(MOUNTAIN)).toBe(Material.Rock);
    expect([Material.Water, Material.Sand, Material.Rock]).toEqual([5, 6, 7]);
  });
  it('gives an id it does not know plains grass, not the material with the same number', () => {
    for (const id of [10, 11, 99, 255, -1, 0.5, NaN]) {
      expect(biomeMaterial(id)).toBe(Material.Grass);
      expect(groundMaterial(id)).toBe(Material.Grass);
    }
  });
  it('lays grass under water and mountain biomes and its own material under the rest', () => {
    for (const id of [LAKE, RIVER, MOUNTAIN]) expect(groundMaterial(id)).toBe(Material.Grass);
    expect(groundMaterial(BEACH)).toBe(Material.Sand);
    for (const id of OLD_BIOMES) expect(groundMaterial(id)).toBe(stoneGroundBefore(id));
  });
});

describe('materialAt', () => {
  it('is what it was for biome ids 0 to 5, on every terrain', () => {
    for (const terrain of TERRAINS)
      for (const biome of OLD_BIOMES)
        expect(materialOf(terrain, biome), `terrain ${terrain} biome ${biome}`).toBe(
          materialBefore(terrain, biome),
        );
  });
  it('is never a material the colour table lacks, whatever the biome id', () => {
    for (const terrain of TERRAINS)
      for (let biome = 0; biome < 256; biome++) {
        const material = materialOf(terrain, biome);
        expect(material, `terrain ${terrain} biome ${biome}`).toBeGreaterThanOrEqual(0);
        expect(material, `terrain ${terrain} biome ${biome}`).toBeLessThan(MATERIAL_COLORS.length);
      }
  });
  it('never maps ids 6 to 9 to city or mountain, on any terrain', () => {
    for (const terrain of TERRAINS)
      for (const biome of NEW_BIOMES) {
        expect(materialOf(terrain, biome)).not.toBe(Material.City);
        expect(materialOf(terrain, biome)).not.toBe(Material.Mountain);
      }
  });
  it('paints water in a lake and a river, sand on a beach and rock on a mountain', () => {
    expect(materialOf(Terrain.Water, LAKE)).toBe(5);
    expect(materialOf(Terrain.Water, RIVER)).toBe(5);
    expect(materialOf(Terrain.Sand, BEACH)).toBe(6);
    for (const terrain of [Terrain.Mountain, Terrain.Rock])
      expect(materialOf(terrain, MOUNTAIN)).toBe(7);
    // The terrain decides these, so no biome repaints them.
    for (const biome of ALL_BIOMES) {
      expect(materialOf(Terrain.Water, biome)).toBe(5);
      expect(materialOf(Terrain.Mountain, biome)).toBe(7);
      expect(materialOf(Terrain.Rock, biome)).toBe(7);
    }
  });
  it('paints plains grass for grass or hill in a water or mountain biome', () => {
    for (const biome of [LAKE, RIVER, MOUNTAIN])
      for (const terrain of [Terrain.Grass, Terrain.Hill])
        expect(materialOf(terrain, biome), `terrain ${terrain} biome ${biome}`).toBe(0);
  });
  it('paints sand for grass or hill on a beach, as the table says', () => {
    for (const terrain of [Terrain.Grass, Terrain.Hill]) expect(materialOf(terrain, BEACH)).toBe(6);
  });
  it('follows the tile biome, not its climate', () => {
    for (const terrain of TERRAINS)
      for (const biome of ALL_BIOMES)
        for (const climate of OLD_BIOMES)
          expect(materialAt(ground(terrain, biome, climate), 1, 1)).toBe(
            materialOf(terrain, biome),
          );
  });
  it('gives landscapeColor a finite colour for every biome the table covers', () => {
    for (const terrain of TERRAINS)
      for (const biome of ALL_BIOMES)
        for (const channel of landscapeColor(ground(terrain, biome), 1.3, 1.2))
          expect(Number.isFinite(channel), `terrain ${terrain} biome ${biome}`).toBe(true);
  });
});

describe('the snow line and the ground between stones', () => {
  it('are what they were for biome ids 0 to 5 on a map with no climate plane', () => {
    for (const biome of OLD_BIOMES) {
      const m = ground(Terrain.Mountain, biome);
      expect(snowLineAt(m, SNOW_LEVELS, 4), `snow line, biome ${biome}`).toBe(
        snowLineBefore(biome),
      );
      expect(stoneGroundAt(m, 4), `stone ground, biome ${biome}`).toBe(stoneGroundBefore(biome));
    }
  });
  it('are what they were when the climate plane holds the biome', () => {
    for (const biome of OLD_BIOMES) {
      const m = ground(Terrain.Mountain, biome, biome);
      expect(snowLineAt(m, SNOW_LEVELS, 4)).toBe(snowLineBefore(biome));
      expect(stoneGroundAt(m, 4)).toBe(stoneGroundBefore(biome));
    }
  });
  it('read the climate under a mountain biome: taiga snows from level 3 over its own ground', () => {
    const taiga = ground(Terrain.Mountain, MOUNTAIN, 3);
    expect(snowLineAt(taiga, SNOW_LEVELS, 4)).toBe(3);
    expect(stoneGroundAt(taiga, 4)).toBe(Material.Taiga);
  });
  it('read the climate under a mountain biome: desert stays bare over sand', () => {
    const desert = ground(Terrain.Mountain, MOUNTAIN, 2);
    expect(snowLineAt(desert, SNOW_LEVELS, 4)).toBe(5);
    expect(stoneGroundAt(desert, 4)).toBe(Material.Desert);
  });
  it('make a mountain look as it does in its climate, whichever biome it carries', () => {
    for (const climate of OLD_BIOMES)
      for (const biome of ALL_BIOMES) {
        const m = ground(Terrain.Mountain, biome, climate);
        expect(snowLineAt(m, SNOW_LEVELS, 4)).toBe(snowLineBefore(climate));
        expect(stoneGroundAt(m, 4)).toBe(stoneGroundBefore(climate));
      }
  });
  it('read each tile at its own index', () => {
    const m: LandscapeMap = {
      w: 3,
      h: 2,
      seed: 5,
      originX: 0,
      originY: 0,
      terrain: new Uint8Array(6).fill(Terrain.Mountain),
      biome: new Uint8Array(6).fill(MOUNTAIN),
      climate: Uint8Array.of(0, 1, 2, 3, 4, 5),
    };
    const at = (read: (i: number) => number) => Array.from({ length: 6 }, (_, i) => read(i));
    expect(at((i) => snowLineAt(m, SNOW_LEVELS, i))).toEqual([4, 4, 5, 3, 4, 4]);
    expect(at((i) => stoneGroundAt(m, i))).toEqual([0, 1, 2, 3, 4, 0]);
  });
  it('take the snow line from the table they are given', () => {
    expect(snowLineAt(ground(Terrain.Mountain, MOUNTAIN, 3), [7, 7, 7, 6, 7, 7], 0)).toBe(6);
    // A climate beyond the table falls back to the first entry, plains.
    expect(snowLineAt(ground(Terrain.Mountain, MOUNTAIN, 20), [7, 8], 0)).toBe(7);
  });
  it('start from the snow levels the content had when this was written', () => {
    expect(SNOW_LEVELS.slice(0, 6)).toEqual([4, 4, 5, 3, 4, 4]);
    expect(SNOW_LEVELS.slice(6)).toEqual([4, 4, 4, 4]);
  });
});
