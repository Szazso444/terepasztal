import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';
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
import { generateMap } from '../world/mapgen';
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
  // Not in the issue's criteria: its forest and sand rules read the biome, and only the snow line and
  // the ground between stones read the climate. #354 may decide otherwise for a mountain biome tile
  // of forest or sand terrain; then this and the mixed-map test below change with that decision.
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

describe('the material table against the surface sheet', () => {
  it('names the cells the packed sheet holds, in the order it holds them', () => {
    // The sheet's own manifest, written by tools/terrain-surfaces.mjs next to the pixels.
    const sheet = JSON.parse(readFileSync('public/assets/terrain-surfaces.json', 'utf8')) as {
      materials: string[];
    };
    expect(Object.keys(Material)).toHaveLength(sheet.materials.length);
    for (const [name, cell] of Object.entries(Material))
      expect(sheet.materials[cell], `Material.${name}`).toBe(name.toLowerCase());
  });
  it('never gives a biome the city or mountain cell, which the painter sets from the map', () => {
    for (let id = 0; id < 256; id++) {
      expect(biomeMaterial(id), `biome ${id}`).not.toBe(Material.City);
      expect(biomeMaterial(id), `biome ${id}`).not.toBe(Material.Mountain);
      expect(groundMaterial(id), `biome ${id}`).not.toBe(Material.City);
      expect(groundMaterial(id), `biome ${id}`).not.toBe(Material.Mountain);
    }
  });
  it('keeps the first five biomes on their own cell and ocean on plains grass', () => {
    expect(BIOME_MATERIAL.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(BIOME_MATERIAL.slice(6)).toEqual([5, 5, 6, 7]);
  });
});

/** A small map as plain arrays, so that a failing case prints and shrinks. */
interface Mixed {
  w: number;
  h: number;
  terrain: number[];
  biome: number[];
  climate?: number[];
}
/** A map to look at at `x`, `y` (tile units, fractional, on the map or beyond its edge). */
interface Look {
  map: Mixed;
  x: number;
  y: number;
}
const build = (m: Mixed): LandscapeMap => ({
  w: m.w,
  h: m.h,
  seed: 9,
  originX: 0,
  originY: 0,
  terrain: Uint8Array.from(m.terrain),
  biome: Uint8Array.from(m.biome),
  ...(m.climate ? { climate: Uint8Array.from(m.climate) } : {}),
});
/** Seeds 1 to 400: a case is a handful of tiles, cheap enough to run hundreds. */
const MIXED_SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
/** Biome ids the content does not define, which a map from a later version could still hold. */
const STRAY_IDS = [10, 11, 99, 255];

/** Tiles of random terrain and biome (a stray id now and then), and a climate plane half the time. */
function genMixed(rng: Rng, strays: boolean): Mixed {
  const w = rng.int(1, 5),
    h = rng.int(1, 5),
    n = w * h,
    id = () => (strays && rng.chance(0.1) ? rng.pick(STRAY_IDS) : rng.int(0, 9));
  const terrain = Array.from({ length: n }, () => rng.int(0, 6)),
    biome = Array.from({ length: n }, id);
  return rng.chance(0.5)
    ? { w, h, terrain, biome, climate: Array.from({ length: n }, id) }
    : { w, h, terrain, biome };
}
/** A point near tile centres, up to two tiles beyond the edge, never on the line between tiles. */
function genLook(rng: Rng): Look {
  const map = genMixed(rng, true);
  return {
    map,
    x: rng.int(-2, map.w + 1) + rng.range(-0.49, 0.49),
    y: rng.int(-2, map.h + 1) + rng.range(-0.49, 0.49),
  };
}
/** The tile whose centre is nearest `x`, `y`, by trying every tile: the edge tile beyond the edge. */
function nearestTile(m: Mixed, x: number, y: number) {
  let best = 0,
    nearest = Infinity;
  for (let ty = 0; ty < m.h; ty++)
    for (let tx = 0; tx < m.w; tx++) {
      const d = (tx - x) ** 2 + (ty - y) ** 2;
      if (d < nearest) [best, nearest] = [ty * m.w + tx, d];
    }
  return best;
}
/** The material of a tile, as a case list of the rules in the issue rather than as the table. */
function materialFor(terrain: number, biome: number): number {
  switch (terrain) {
    case Terrain.Water:
      return 5;
    case Terrain.Sand:
      return biome === 2 ? 2 : 6;
    case Terrain.Rock:
    case Terrain.Mountain:
      return 7;
    case Terrain.Forest:
      return biome === 4 ? 4 : biome === 3 ? 3 : 1;
    default:
      // Grass and hill: the biome's ground. Lake, river, mountain and ocean have none of their own.
      switch (biome) {
        case 1:
        case 2:
        case 3:
        case 4:
          return biome;
        case 8:
          return 6;
        default:
          return 0;
      }
  }
}
/** The ground between the stones for a climate id, as a case list. */
function stoneFor(climate: number): number {
  switch (climate) {
    case 1:
    case 2:
    case 3:
    case 4:
      return climate;
    case 8:
      return 6;
    default:
      return 0;
  }
}
const planeOf = (m: Mixed) => m.climate ?? m.biome;

/** Fewer tiles first: blank every tile but the one looked at, then simpler ids on that tile. */
function* shrinkLook(c: Look): Iterable<Look> {
  const k = nearestTile(c.map, c.x, c.y),
    m = c.map;
  const only = (a: number[]) => a.map((v, i) => (i === k ? v : 0));
  const blank: Mixed = {
    ...m,
    terrain: only(m.terrain),
    biome: only(m.biome),
    ...(m.climate ? { climate: only(m.climate) } : {}),
  };
  if (JSON.stringify(blank) !== JSON.stringify(m)) yield { ...c, map: blank };
  if (m.climate) yield { ...c, map: { w: m.w, h: m.h, terrain: m.terrain, biome: m.biome } };
  const set = (key: 'terrain' | 'biome' | 'climate', v: number): Look => {
    const plane = [...(m[key] as number[])];
    plane[k] = v;
    return { ...c, map: { ...m, [key]: plane } };
  };
  for (const v of shrinkInt(m.terrain[k], 0)) yield set('terrain', v);
  for (const v of shrinkInt(m.biome[k], 0)) yield set('biome', v);
  if (m.climate) for (const v of shrinkInt(m.climate[k], 0)) yield set('climate', v);
}

describe('materialAt on maps of mixed tiles', () => {
  it('reads the nearest tile and gives its terrain and biome the material the rules name', () => {
    forAll(
      genLook,
      ({ map, x, y }) => {
        const k = nearestTile(map, x, y),
          got = materialAt(build(map), x, y),
          want = materialFor(map.terrain[k], map.biome[k]);
        expect(got, `tile ${k}: terrain ${map.terrain[k]} biome ${map.biome[k]}`).toBe(want);
        // The colour table has a cell for it, and a biome that existed before cannot have moved.
        expect(got).toBeLessThan(MATERIAL_COLORS.length);
        if (map.biome[k] <= 5) expect(got).toBe(materialBefore(map.terrain[k], map.biome[k]));
      },
      { seeds: MIXED_SEEDS, shrink: shrinkLook },
    );
  });
  it('does not look at the climate plane, whatever it holds', () => {
    forAll(
      genLook,
      ({ map, x, y }) => {
        const bare = build({ ...map, climate: undefined }),
          shifted = build({ ...map, climate: map.biome.map((b) => (b + 3) % 10) });
        expect(materialAt(shifted, x, y)).toBe(materialAt(bare, x, y));
      },
      { seeds: MIXED_SEEDS, shrink: shrinkLook },
    );
  });
  it('lets landscapeColor give a finite colour wherever it looks', () => {
    forAll(
      genLook,
      ({ map, x, y }) => {
        for (const channel of landscapeColor(build(map), x, y))
          expect(Number.isFinite(channel)).toBe(true);
      },
      { seeds: MIXED_SEEDS, shrink: shrinkLook },
    );
  });
});

describe('the snow line and stone ground on maps of mixed tiles', () => {
  /** A tile of a map with no stray id, so the fallback for an id beyond the table is not repeated. */
  const genCovered = (rng: Rng): Look => {
    const map = genMixed(rng, false);
    return { map, x: rng.int(0, map.w - 1), y: rng.int(0, map.h - 1) };
  };
  const tileOf = ({ map, x, y }: Look) => nearestTile(map, x, y);

  it('read the climate where the map has the plane and the biome where it has not', () => {
    forAll(
      genCovered,
      (look) => {
        const k = tileOf(look),
          id = planeOf(look.map)[k],
          map = build(look.map);
        expect(snowLineAt(map, SNOW_LEVELS, k), `tile ${k}, climate ${id}`).toBe(SNOW_LEVELS[id]);
        expect(stoneGroundAt(map, k), `tile ${k}, climate ${id}`).toBe(stoneFor(id));
        // Unchanged for the biomes that existed before the climate did.
        if (id <= 5) {
          expect(snowLineAt(map, SNOW_LEVELS, k)).toBe(snowLineBefore(id));
          expect(stoneGroundAt(map, k)).toBe(stoneGroundBefore(id));
        }
      },
      { seeds: MIXED_SEEDS, shrink: shrinkLook },
    );
  });
  it('make a tile look as one would that had its climate for a biome and no plane', () => {
    forAll(
      genCovered,
      (look) => {
        const k = tileOf(look),
          m = look.map,
          swapped = build({ ...m, biome: planeOf(m), climate: undefined });
        expect(snowLineAt(build(m), SNOW_LEVELS, k)).toBe(snowLineAt(swapped, SNOW_LEVELS, k));
        expect(stoneGroundAt(build(m), k)).toBe(stoneGroundAt(swapped, k));
      },
      { seeds: MIXED_SEEDS, shrink: shrinkLook },
    );
  });
  it('take the level from the table they are given, by the climate id', () => {
    forAll(
      (rng) => ({ look: genCovered(rng), levels: Array.from({ length: 10 }, () => rng.int(1, 9)) }),
      ({ look, levels }) => {
        const k = tileOf(look);
        expect(snowLineAt(build(look.map), levels, k)).toBe(levels[planeOf(look.map)[k]]);
      },
      { seeds: MIXED_SEEDS },
    );
  });
  it('give plains snow and plains grass for a climate beyond the table, never undefined', () => {
    forAll(
      (rng) => genMixed(rng, true),
      (m) => {
        const map = build(m);
        planeOf(m).forEach((id, k) => {
          const level = snowLineAt(map, SNOW_LEVELS, k),
            ground = stoneGroundAt(map, k);
          expect(Number.isInteger(level), `tile ${k}, climate ${id}`).toBe(true);
          expect(Number.isInteger(ground), `tile ${k}, climate ${id}`).toBe(true);
          if (id >= BIOME_DEFS.length) {
            expect(level, `tile ${k}, climate ${id}`).toBe(SNOW_LEVELS[0]);
            expect(ground, `tile ${k}, climate ${id}`).toBe(Material.Grass);
          }
        });
      },
      { seeds: MIXED_SEEDS },
    );
  });
  it('give a taiga mountain tile snow from level 3 and a desert one from level 5', () => {
    // The issue's fixture: biome 9 over a climate, side by side with other climates.
    const m: Mixed = {
      w: 3,
      h: 1,
      terrain: [Terrain.Mountain, Terrain.Mountain, Terrain.Mountain],
      biome: [MOUNTAIN, MOUNTAIN, MOUNTAIN],
      climate: [3, 2, 0],
    };
    const map = build(m);
    expect([0, 1, 2].map((k) => snowLineAt(map, SNOW_LEVELS, k))).toEqual([3, 5, 4]);
    expect([0, 1, 2].map((k) => stoneGroundAt(map, k))).toEqual([
      Material.Taiga,
      Material.Desert,
      Material.Grass,
    ]);
  });
});

describe('on generated worlds', () => {
  // Real terrain, biome and climate combinations, as the first chunks of a new game hold them. A
  // tile whose biome is a climate (ids 0 to 5) paints as it did before the table existed, with the
  // climate plane or without it; a tile with a later id is held to the rules in the issue, and its
  // snow line and stone ground are its climate's. A world as a chunk stored before the landform
  // ids holds it (its biome its climate, no climate plane) paints every tile as before. Three
  // worlds, which between them hold every tile the check below asks for: each new world plans the
  // rivers of the chunks around its start (#341), most of a tenth of a second.
  const WORLD_SEEDS = [20260912, 1, 7];
  const SIZE = { w: 48, h: 48 };

  // three generated worlds, every tile painted five ways: about 1.2 s alone
  it('paint every tile as they did before the table, and as the rules name for the later ids', () => {
    const seen = new Set<string>();
    for (const seed of WORLD_SEEDS) {
      const world = generateMap(seed, SIZE),
        // As a chunk saved before the climate plane: the biome is all there is.
        bare = { ...world, climate: undefined },
        // As a chunk saved before the landform ids: its biome is its climate, and it has no plane.
        swapped = { ...world, biome: world.climate!, climate: undefined };
      for (let k = 0; k < world.terrain.length; k++) {
        const terrain = world.terrain[k],
          biome = world.biome[k],
          climate = world.climate![k],
          x = k % world.w,
          y = Math.floor(k / world.w),
          where = `seed ${seed} tile ${x},${y}: terrain ${terrain} biome ${biome} climate ${climate}`;
        expect(materialAt(world, x, y), where).toBe(materialFor(terrain, biome));
        // The snow line and the stone ground are the climate's, as they were before the table.
        expect(snowLineAt(world, SNOW_LEVELS, k), where).toBe(snowLineBefore(climate));
        expect(stoneGroundAt(world, k), where).toBe(stoneGroundBefore(climate));
        expect(snowLineAt(swapped, SNOW_LEVELS, k), where).toBe(snowLineAt(world, SNOW_LEVELS, k));
        expect(stoneGroundAt(swapped, k), where).toBe(stoneGroundAt(world, k));
        expect(materialAt(swapped, x, y), where).toBe(materialBefore(terrain, climate));
        if (biome <= 5) {
          expect(materialAt(bare, x, y), where).toBe(materialAt(world, x, y));
          expect(snowLineAt(bare, SNOW_LEVELS, k), where).toBe(snowLineAt(world, SNOW_LEVELS, k));
          expect(stoneGroundAt(bare, k), where).toBe(stoneGroundAt(world, k));
          expect(materialAt(world, x, y), where).toBe(materialBefore(terrain, biome));
          expect(snowLineAt(world, SNOW_LEVELS, k), where).toBe(snowLineBefore(biome));
          expect(stoneGroundAt(world, k), where).toBe(stoneGroundBefore(biome));
        }
        seen.add(`${terrain}:${biome}:${climate}`);
      }
    }
    // The worlds are varied enough to mean something: the tiles the old rules told apart are there,
    // and a mountain over the taiga climate, whose snow starts at taiga's level 3.
    for (const triple of [
      [Terrain.Forest, 3, 3],
      [Terrain.Forest, 4, 4],
      [Terrain.Sand, 2, 2],
      [Terrain.Sand, 0, 0],
      [Terrain.Hill, 2, 2],
      [Terrain.Rock, 3, 3],
      [Terrain.Mountain, MOUNTAIN, 3],
    ])
      expect(
        seen.has(triple.join(':')),
        `no tile of terrain:biome:climate ${triple.join(':')}`,
      ).toBe(true);
  }, 20_000);
});
