import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateMap, placeOilFields, ensureStartDeposits, DEFAULT_MAP_PARAMS } from './mapgen';
import { mapFromLevel, levelFromMap } from './level';
import { Terrain, startRegion, type GameMap, type PropInstance } from './tiles';
import { hashString } from '../engine/rng';
import { DEFAULT_SUPPLY, SUPPLY_MODES, setSupplyMode } from '../sim/supply';

// The production chain is an argument of map generation, not the game-wide switch: the same call
// gives the same map whatever the switch says. The switch is module state shared with every other
// test in the worker, so each case starts and ends with the default.
beforeEach(() => setSupplyMode(DEFAULT_SUPPLY));
afterEach(() => setSupplyMode(DEFAULT_SUPPLY));

/** The two worlds the issue measured: mapgen's golden seed small, and the oil-rich 96x96 one. */
const WORLDS = [
  { seed: 20260912, size: 48 },
  { seed: 7412, size: 96 },
] as const;
const params = (size: number) => ({ w: size, h: size });

/** One tile's props as text: every field, numbers exact. */
const propText = (list: PropInstance[] | undefined) =>
  (list ?? []).map((p) => `${p.kind},${p.variant},${p.ox},${p.oy}`).join(';');
/** FNV-1a over every tile's props in tile order, so a moved, added or changed prop shows. */
function propHash(m: GameMap) {
  const parts: string[] = [];
  for (let i = 0; i < m.w * m.h; i++)
    if (m.props.has(i)) parts.push(`${i}:${propText(m.props.get(i))}`);
  return hashString(parts.join('|'));
}
/** Index of the first tile where two planes differ; -1 when they are equal. */
function firstDiff(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}
/** Every plane the generator fills, as the index of its first difference (-1: equal). */
function planeDiffs(a: GameMap, b: GameMap) {
  return {
    terrain: firstDiff(a.terrain, b.terrain),
    biome: firstDiff(a.biome, b.biome),
    variant: firstDiff(a.variant, b.variant),
  };
}
const SAME_PLANES = { terrain: -1, biome: -1, variant: -1 };
/** Tiles holding an oil prop; the indices, in tile order. */
const oilTiles = (m: GameMap) =>
  [...m.props]
    .filter(([, list]) => list.some((p) => p.kind === 'oil'))
    .map(([i]) => i)
    .sort((x, y) => x - y);
/** Oil props in the start chunk. */
function startOil(m: GameMap) {
  const { rx, ry } = startRegion(m);
  const rs = m.regionSize;
  return oilTiles(m).filter((i) => {
    const x = i % m.w;
    const y = Math.floor(i / m.w);
    return Math.floor(x / rs) === rx && Math.floor(y / rs) === ry;
  });
}
/** A copy of the map's props, so a call can be compared with what it started from. */
const propsOf = (m: GameMap) =>
  new Map([...m.props].map(([i, list]) => [i, list.map((p) => ({ ...p }))]));
/** The same map with every oil prop taken off, as a simple-chain map. */
function withoutOil(m: GameMap): GameMap {
  const props = new Map<number, PropInstance[]>();
  for (const [i, list] of m.props) {
    const rest = list.filter((p) => p.kind !== 'oil');
    if (rest.length) props.set(i, rest);
  }
  return { ...m, props };
}

describe('generateMap takes the production chain as an argument', () => {
  it('keeps the chain out of the map parameters', () => {
    expect(Object.keys(DEFAULT_MAP_PARAMS).sort()).toEqual(
      ['forestDensity', 'h', 'hillLevel', 'rockLevel', 'w', 'waterLevel'].sort(),
    );
  });

  it.each(WORLDS.flatMap((w) => SUPPLY_MODES.map((chain) => ({ ...w, chain }))))(
    'seed $seed at $size x $size, $chain chain: the same map whether the global says simple or full',
    ({ seed, size, chain }) => {
      setSupplyMode('simple');
      const asSimple = generateMap(seed, params(size), chain);
      setSupplyMode('full');
      const asFull = generateMap(seed, params(size), chain);
      expect(planeDiffs(asSimple, asFull)).toEqual(SAME_PLANES);
      expect(propHash(asFull)).toBe(propHash(asSimple));
      expect(asFull.props.size).toBe(asSimple.props.size);
    },
  );

  it.each(WORLDS)(
    'seed $seed at $size x $size: the chains differ in oil props only',
    ({ seed, size }) => {
      const simple = generateMap(seed, params(size), 'simple');
      const full = generateMap(seed, params(size), 'full');
      expect(planeDiffs(simple, full)).toEqual(SAME_PLANES);
      expect(oilTiles(simple)).toEqual([]);
      expect(oilTiles(full).length).toBeGreaterThan(0);
      expect(propHash(full)).not.toBe(propHash(simple));
      // oil goes over the decorations; every other tile holds what the simple chain gave it
      const oil = new Set(oilTiles(full));
      const tiles = new Set([...simple.props.keys(), ...full.props.keys()]);
      for (const i of tiles)
        if (!oil.has(i))
          expect(propText(full.props.get(i)), `tile ${i}`).toBe(propText(simple.props.get(i)));
    },
  );

  it.each(WORLDS)(
    'seed $seed at $size x $size: omitting the chain is the simple chain, whatever the global says',
    ({ seed, size }) => {
      for (const global of SUPPLY_MODES) {
        setSupplyMode(global);
        const omitted = generateMap(seed, params(size));
        const simple = generateMap(seed, params(size), 'simple');
        expect(planeDiffs(omitted, simple), `global ${global}`).toEqual(SAME_PLANES);
        expect(propHash(omitted), `global ${global}`).toBe(propHash(simple));
        expect(oilTiles(omitted), `global ${global}`).toEqual([]);
      }
      expect(DEFAULT_SUPPLY).toBe('simple');
    },
  );

  it('omitting the parameters too is the simple chain', () => {
    setSupplyMode('full');
    const bare = generateMap(7);
    const simple = generateMap(7, {}, 'simple');
    expect(planeDiffs(bare, simple)).toEqual(SAME_PLANES);
    expect(propHash(bare)).toBe(propHash(simple));
    expect(oilTiles(bare)).toEqual([]);
  });
});

describe('placeOilFields and ensureStartDeposits take the chain', () => {
  /** A 96x96 world's terrain and decorations with no oil on it, the way the simple chain lays it. */
  const oilFree = () => generateMap(7412, params(96), 'simple');

  it.each(SUPPLY_MODES)(
    'the simple chain leaves the props exactly as they were, with the global at %s',
    (global) => {
      setSupplyMode(global);
      const map = oilFree();
      const before = propsOf(map);
      placeOilFields(map, map.seed, 'simple');
      ensureStartDeposits(map, 'simple');
      expect(map.props).toEqual(before);
      // and it is the default
      placeOilFields(map, map.seed);
      ensureStartDeposits(map);
      expect(map.props).toEqual(before);
    },
  );

  it('the simple chain leaves a map that already has oil as it is', () => {
    const map = generateMap(7412, params(96), 'full');
    const before = propsOf(map);
    expect(oilTiles(map).length).toBeGreaterThan(0);
    placeOilFields(map, map.seed, 'simple');
    ensureStartDeposits(map, 'simple');
    expect(map.props).toEqual(before);
  });

  it.each(SUPPLY_MODES)(
    'the full chain adds oil fields to an oil-free map on grass and sand, with the global at %s',
    (global) => {
      setSupplyMode(global);
      const map = oilFree();
      expect(oilTiles(map)).toEqual([]);
      const planes = { terrain: map.terrain.slice(), variant: map.variant.slice() };
      placeOilFields(map, map.seed, 'full');
      const oil = oilTiles(map);
      expect(oil.length).toBeGreaterThan(0);
      for (const i of oil) expect([Terrain.Grass, Terrain.Sand]).toContain(map.terrain[i]);
      expect(firstDiff(map.terrain, planes.terrain)).toBe(-1);
      expect(firstDiff(map.variant, planes.variant)).toBe(-1);
    },
  );

  it.each(SUPPLY_MODES)(
    'the full chain leaves at least three oil tiles in the start chunk, and a second call changes nothing (global %s)',
    (global) => {
      setSupplyMode(global);
      const map = oilFree();
      expect(startOil(map)).toEqual([]);
      ensureStartDeposits(map, 'full');
      expect(startOil(map).length).toBeGreaterThanOrEqual(3);
      const once = propsOf(map);
      const hash = propHash(map);
      ensureStartDeposits(map, 'full');
      expect(propHash(map)).toBe(hash);
      expect(map.props).toEqual(once);
    },
  );

  it('the full chain finds the oil generateMap laid in the middle of the map', () => {
    // generateMap lays the fields over the decorations as the passes do on a finished map; they
    // differ only near the edge, where a field centre just outside the map reaches in.
    const seed = 7412;
    const full = generateMap(seed, params(96), 'full');
    const map = withoutOil(full);
    placeOilFields(map, seed, 'full');
    ensureStartDeposits(map, 'full');
    const inner = (m: GameMap) =>
      oilTiles(m).filter((i) => {
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        return x >= 4 && y >= 4 && x < m.w - 4 && y < m.h - 4;
      });
    expect(inner(map)).toEqual(inner(full));
  });
});

describe('mapFromLevel takes the chain', () => {
  const level = () => levelFromMap(generateMap(7412, params(96), 'simple'), 'supply');

  it('has the same terrain, variant and biome for both chains, and oil only in the full one', () => {
    const lv = level();
    const simple = mapFromLevel(lv, 'simple');
    const full = mapFromLevel(lv, 'full');
    expect(planeDiffs(simple, full)).toEqual(SAME_PLANES);
    expect(oilTiles(simple)).toEqual([]);
    expect(oilTiles(full).length).toBeGreaterThan(0);
    // the level's own planes, whichever chain
    expect(firstDiff(simple.terrain, generateMap(7412, params(96)).terrain)).toBe(-1);
  });

  it.each(SUPPLY_MODES)('does not depend on the global (%s)', (chain) => {
    const lv = level();
    setSupplyMode('simple');
    const a = mapFromLevel(lv, chain);
    setSupplyMode('full');
    const b = mapFromLevel(lv, chain);
    expect(planeDiffs(a, b)).toEqual(SAME_PLANES);
    expect(propHash(b)).toBe(propHash(a));
  });

  it('omitting the chain is the simple chain, whatever the global says', () => {
    const lv = level();
    const simple = mapFromLevel(lv, 'simple');
    for (const global of SUPPLY_MODES) {
      setSupplyMode(global);
      const omitted = mapFromLevel(lv);
      expect(planeDiffs(omitted, simple), `global ${global}`).toEqual(SAME_PLANES);
      expect(propHash(omitted), `global ${global}`).toBe(propHash(simple));
      expect(oilTiles(omitted), `global ${global}`).toEqual([]);
    }
  });
});
