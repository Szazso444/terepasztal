import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateMap, emptyMap } from './mapgen';
import { levelFromMap, mapFromLevel } from './level';
import { Biome, BIOME_NAMES, climateAt, climateAtIndex, type GameMap } from './tiles';
import { biomeAt } from '../sim/biomes';
import { setSupplyMode } from '../sim/supply';
import { Rng } from '../engine/rng';
import { forAll, SEEDS as CASE_SEEDS } from '../testing/property';

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

beforeEach(() => {
  setSupplyMode('simple');
});
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

  it('keeps the climate of every old tile when the map grows by a ring of chunks', () => {
    // grown as expandSave grows a game's map: a chunk more on every side, the old map in the middle
    for (const seed of [SEEDS[0], SEEDS[3]]) {
      const map = generateMap(seed, { w: 48, h: 48 });
      const big = generateMap(seed, { w: 48 + 64, h: 48 + 64, originX: -32, originY: -32 });
      expect(biomeCount(map), `seed ${seed}`).toBeGreaterThan(1);
      let moved = 0;
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++)
          if (climateAt(map, x, y) !== climateAt(big, x + 32, y + 32)) moved++;
      expect(moved, `seed ${seed}`).toBe(0);
    }
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

/** A small map's planes as rows of biome ids; `climate` is null on a map with no climate plane. */
interface Planes {
  biome: number[][];
  climate: number[][] | null;
}
const KINDS = BIOME_NAMES.length;

/** 1 to 9 tiles a side; a quarter have no plane, and half a plane's tiles keep their biome. */
function genPlanes(rng: Rng): Planes {
  const w = rng.int(1, 9);
  const h = rng.int(1, 9);
  const biome = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => rng.int(0, KINDS - 1)),
  );
  const climate = rng.chance(0.25)
    ? null
    : biome.map((row) => row.map((b) => (rng.chance(0.5) ? b : rng.int(0, KINDS - 1))));
  return { biome, climate };
}

/** Smaller planes, simplest first: no plane, a row or column fewer, one tile turned to plains. */
function* shrinkPlanes(p: Planes): Iterable<Planes> {
  const crop = (f: (rows: number[][]) => number[][]) => ({
    biome: f(p.biome),
    climate: p.climate && f(p.climate),
  });
  if (p.climate) yield { ...p, climate: null };
  if (p.biome.length > 1) {
    yield crop((rows) => rows.slice(1));
    yield crop((rows) => rows.slice(0, -1));
  }
  if (p.biome[0].length > 1) {
    yield crop((rows) => rows.map((row) => row.slice(1)));
    yield crop((rows) => rows.map((row) => row.slice(0, -1)));
  }
  for (const plane of ['biome', 'climate'] as const) {
    const rows = p[plane];
    if (!rows) continue;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === 0) continue;
        const at = rows.map((row, j) => (j === y ? row.map((v, i) => (i === x ? 0 : v)) : row));
        yield { ...p, [plane]: at };
      }
  }
}

/** The map the planes describe; it carries a climate plane only when the planes have one. */
function mapOf(p: Planes): GameMap {
  const map = emptyMap(1, p.biome[0].length, p.biome.length);
  map.biome.set(p.biome.flat());
  if (p.climate) map.climate = Uint8Array.from(p.climate.flat());
  return map;
}

/** The oracle, read off the rows: the plane where there is one, else the biome; plains off the map. */
const climateOf = (p: Planes, x: number, y: number): number =>
  (p.climate ?? p.biome)[y]?.[x] ?? Biome.Plains;

/** Both readers, on every tile and on a two-tile ring around the map, agree with the oracle. */
function expectClimate(map: GameMap, p: Planes) {
  for (let y = -2; y < map.h + 2; y++)
    for (let x = -2; x < map.w + 2; x++) {
      expect(climateAt(map, x, y), `climateAt(${x}, ${y})`).toBe(climateOf(p, x, y));
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const i = y * map.w + x;
      expect(climateAtIndex(map, i), `climateAtIndex(${i})`).toBe(climateOf(p, x, y));
    }
}

describe('climateAt on any small map', () => {
  it('draws maps of every kind the properties claim', () => {
    // The generator, checked: without this a narrowed generator would pass the properties vacuously.
    const cases = CASE_SEEDS.map((seed) => genPlanes(new Rng(seed)));
    const someTile = (p: Planes, f: (biome: number, climate: number) => boolean) =>
      p.climate !== null && p.biome.some((row, y) => row.some((b, x) => f(b, p.climate![y][x])));
    expect(cases.some((p) => p.climate === null)).toBe(true);
    // a plane that differs from the biome on some tiles and agrees with it on others
    expect(
      cases.some((p) => someTile(p, (b, c) => b !== c) && someTile(p, (b, c) => b === c)),
    ).toBe(true);
    // plains climate over another biome, which a falsy test on the plane would read past
    expect(cases.some((p) => someTile(p, (b, c) => c === Biome.Plains && b !== c))).toBe(true);
    // one-tile-wide maps, and wider-than-tall and taller-than-wide ones, so x and y cannot swap
    expect(cases.some((p) => p.biome.length === 1 || p.biome[0].length === 1)).toBe(true);
    expect(cases.some((p) => p.biome.length > 1 && p.biome[0].length > p.biome.length)).toBe(true);
    expect(cases.some((p) => p.biome[0].length > 1 && p.biome.length > p.biome[0].length)).toBe(
      true,
    );
  });

  it('reads the climate plane where the map has one and the biome otherwise, plains off it', () => {
    forAll(genPlanes, (p) => expectClimate(mapOf(p), p), { shrink: shrinkPlanes });
  });

  it('leaves both planes as it found them and never adds a climate plane', () => {
    forAll(
      genPlanes,
      (p) => {
        const map = mapOf(p);
        const { biome, climate } = map;
        expectClimate(map, p);
        expect(map.biome).toBe(biome);
        expect(map.climate).toBe(climate);
        expect([...map.biome]).toEqual(p.biome.flat());
        if (p.climate) expect([...map.climate!]).toEqual(p.climate.flat());
      },
      { shrink: shrinkPlanes },
    );
  });

  it('reads the planes as they are: a biome rewritten in place moves only a plane-less climate', () => {
    // the editor's regenerate rewrites the biome plane of the map it already holds (src/game.ts)
    forAll(
      genPlanes,
      (p) => {
        const map = mapOf(p);
        expectClimate(map, p);
        const biome = p.biome.map((row) => row.map((b) => (b + 1) % KINDS));
        map.biome.set(biome.flat());
        expectClimate(map, { ...p, biome });
      },
      { shrink: shrinkPlanes },
    );
  });
});
