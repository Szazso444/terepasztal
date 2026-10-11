import { describe, it, expect, afterEach } from 'vitest';
import { generateMap, emptyMap } from './mapgen';
import { levelFromMap, mapFromLevel } from './level';
import { Biome, BIOME_NAMES, climateAt, climateAtIndex, type GameMap } from './tiles';
import { biomeAt } from '../sim/biomes';
import { setSupplyMode } from '../sim/supply';

const SEEDS = [20260912, 1, 7412, 31337];
const SIZES = [
  { w: 32, h: 32 },
  { w: 48, h: 48 },
  { w: 96, h: 64 },
];

/**
 * Tiles where climateAt differs from the biome reader, counted over the map and a two-tile ring
 * around it, plus tiles where the by-index form differs from climateAt.
 */
function climateVsBiome(map: GameMap) {
  let differs = 0;
  let byIndex = 0;
  for (let y = -2; y < map.h + 2; y++)
    for (let x = -2; x < map.w + 2; x++) {
      if (climateAt(map, x, y) !== biomeAt(map, x, y)) differs++;
      const onMap = x >= 0 && y >= 0 && x < map.w && y < map.h;
      if (onMap && climateAtIndex(map, y * map.w + x) !== climateAt(map, x, y)) byIndex++;
    }
  return { differs, byIndex };
}
const AGREE = { differs: 0, byIndex: 0 };
/** How many distinct biomes a map holds, so a case cannot pass on a one-biome map by accident. */
const biomeCount = (map: GameMap) => new Set(map.biome).size;

afterEach(() => {
  setSupplyMode('simple');
});

describe('climateAt on a map with no climate plane', () => {
  for (const seed of SEEDS)
    for (const size of SIZES)
      it(`is the biome on every tile of a generated ${size.w}x${size.h} map (seed ${seed})`, () => {
        const map = generateMap(seed, size);
        // nothing fills the plane yet; the Mountain biome task (#354) is the first to
        expect(map.climate).toBeUndefined();
        expect(climateVsBiome(map)).toEqual(AGREE);
      });

  it('is the biome on every tile of a map grown around its start', () => {
    const map = generateMap(SEEDS[0], { w: 96, h: 96, originX: -32, originY: -32 });
    expect(map.climate).toBeUndefined();
    expect(climateVsBiome(map)).toEqual(AGREE);
  });

  it('is the biome on every tile of a generated map in the full production chain', () => {
    setSupplyMode('full');
    const map = generateMap(7412, { w: 96, h: 96 });
    expect(map.climate).toBeUndefined();
    expect(climateVsBiome(map)).toEqual(AGREE);
  });

  it('is the biome on every tile of a level map', () => {
    const source = generateMap(SEEDS[2], { w: 64, h: 48 });
    expect(biomeCount(source)).toBeGreaterThan(1);
    const level = levelFromMap(source, 'climate', 'lvl_climate');
    expect(level).not.toHaveProperty('climate');
    const map = mapFromLevel(level);
    expect(map.climate).toBeUndefined();
    expect([...map.biome]).toEqual([...source.biome]);
    expect(climateVsBiome(map)).toEqual(AGREE);
  });

  it('is plains on every tile of a level saved without biomes', () => {
    const level = levelFromMap(generateMap(SEEDS[1], { w: 32, h: 32 }), 'old', 'lvl_old');
    delete level.biome;
    const map = mapFromLevel(level);
    expect(map.climate).toBeUndefined();
    expect(climateVsBiome(map)).toEqual(AGREE);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) expect(climateAt(map, x, y)).toBe(Biome.Plains);
  });
});

describe('climateAt on a map with a climate plane', () => {
  /** A 7x5 map whose climate is the next biome after its own on every tile. */
  function fixture() {
    const map = emptyMap(5, 7, 5);
    const kinds = BIOME_NAMES.length;
    map.climate = new Uint8Array(map.w * map.h);
    for (let i = 0; i < map.w * map.h; i++) {
      map.biome[i] = (i * 5) % kinds;
      map.climate[i] = (map.biome[i] + 1) % kinds;
    }
    return map;
  }

  it('reads the plane on every tile, not the biome', () => {
    const map = fixture();
    const climate = map.climate!;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        expect(climateAt(map, x, y), `tile ${x},${y}`).toBe(climate[i]);
        expect(climateAt(map, x, y), `tile ${x},${y}`).not.toBe(map.biome[i]);
        expect(climateAtIndex(map, i), `tile ${i}`).toBe(climate[i]);
      }
  });

  it('leaves the biome to the biome reader', () => {
    const map = fixture();
    const before = [...map.biome];
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) expect(biomeAt(map, x, y)).toBe(map.biome[y * map.w + x]);
    expect([...map.biome]).toEqual(before);
  });

  it('is plains off the map, as the biome is', () => {
    const map = fixture();
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [map.w, 0],
      [0, map.h],
      [-1, map.h - 1],
      [map.w, map.h],
    ])
      expect(climateAt(map, x, y), `tile ${x},${y}`).toBe(Biome.Plains);
  });

  it('reads a copy of the map that carries only the planes it needs', () => {
    const map = fixture();
    const copy = { w: map.w, h: map.h, biome: map.biome, climate: map.climate };
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) expect(climateAt(copy, x, y)).toBe(climateAt(map, x, y));
  });
});
