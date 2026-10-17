import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateMap,
  emptyMap,
  placeOilFields,
  ensureStartDeposits,
  DEFAULT_MAP_PARAMS,
} from './mapgen';
import { mapFromLevel, levelFromMap } from './level';
import { Terrain, startRegion, type GameMap, type PropInstance } from './tiles';
import { Rng, hash2, hashString } from '../engine/rng';
import {
  DEFAULT_SUPPLY,
  SUPPLY_MODES,
  setSupplyMode,
  supplyMode,
  type SupplyMode,
} from '../sim/supply';
import { RULE_META } from '../sim/rules';
import { forAll, shrinkArray } from '../testing/property';

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
    // a map with no climate plane (a level's) has its biome for its climate
    climate: firstDiff(a.climate ?? a.biome, b.climate ?? b.biome),
    variant: firstDiff(a.variant, b.variant),
  };
}
const SAME_PLANES = { terrain: -1, biome: -1, climate: -1, variant: -1 };
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
/** The start chunk's grass and sand tiles, nearest its centre first, ties in reading order. */
function startGround(m: GameMap) {
  const { rx, ry } = startRegion(m);
  const rs = m.regionSize;
  const cx = rx * rs + rs / 2;
  const cy = ry * rs + rs / 2;
  const out: { i: number; d: number }[] = [];
  for (let y = ry * rs; y < Math.min(m.h, (ry + 1) * rs); y++)
    for (let x = rx * rs; x < Math.min(m.w, (rx + 1) * rs); x++) {
      const t = m.terrain[y * m.w + x];
      if (t === Terrain.Grass || t === Terrain.Sand)
        out.push({ i: y * m.w + x, d: Math.hypot(x - cx, y - cy) });
    }
  return out.sort((a, b) => a.d - b.d || a.i - b.i);
}
/** Of those, the ring 6 to 13 tiles out. */
const startRing = (m: GameMap) => startGround(m).filter((c) => c.d > 6 && c.d < 13);
/**
 * The seeps ensureStartDeposits lays on a start chunk with no oil, by #276's rule, each as the
 * prop it puts on its tile: tiles 0, 3 and 6 of the ring where the ring holds seven or more, else
 * tiles 0, step and 2 x step of the whole chunk's, with step max(1, min(3, floor((n - 1) / 2))).
 */
function ruleSeeps(m: GameMap): Map<number, PropInstance> {
  const ground = startGround(m);
  const ring = startRing(m);
  const short = ring.length < 7;
  const from = short ? ground : ring;
  const step = short ? Math.max(1, Math.min(3, Math.floor((ground.length - 1) / 2))) : 3;
  const out = new Map<number, PropInstance>();
  for (let k = 0; k < 3 * step && k < from.length; k += step) {
    const { i } = from[k];
    const jitter = hash2((i % m.w) + m.originX, Math.floor(i / m.w) + m.originY, m.seed + 15);
    out.set(i, { kind: 'oil', variant: k % 3, ox: (jitter - 0.5) * 0.3, oy: 0 });
  }
  return out;
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

  // each row builds two worlds of up to 96 x 96, and the first pays the generator's warm-up: about
  // 0.35 s alone, so a limit of 30 s
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
    30_000,
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

  it.each(SUPPLY_MODES.flatMap((global) => SUPPLY_MODES.map((chain) => ({ global, chain }))))(
    'generateMap, placeOilFields, ensureStartDeposits and mapFromLevel leave the global as they found it (global $global, chain $chain)',
    ({ global, chain }) => {
      const lv = levelFromMap(generateMap(7, params(48), 'simple'), 'switch');
      setSupplyMode(global);
      const map = generateMap(7, params(48), chain);
      expect(supplyMode(), 'generateMap').toBe(global);
      placeOilFields(map, 7, chain);
      expect(supplyMode(), 'placeOilFields').toBe(global);
      ensureStartDeposits(map, chain);
      expect(supplyMode(), 'ensureStartDeposits').toBe(global);
      mapFromLevel(lv, chain);
      expect(supplyMode(), 'mapFromLevel').toBe(global);
      // and with the chain left out
      generateMap(7, params(48));
      placeOilFields(map, 7);
      ensureStartDeposits(map);
      mapFromLevel(lv);
      expect(supplyMode(), 'chain omitted').toBe(global);
    },
  );
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

describe('the production chain, for any world', () => {
  // The two worlds above are what the issue measured; this is the class they come from: any seed,
  // either size, sliders anywhere on their ranges, and the global at either value.
  interface WorldCase {
    seed: number;
    size: number;
    global: SupplyMode;
    sliders: {
      waterLevel: number;
      hillLevel: number;
      rockLevel: number;
      forestDensity: number;
    };
  }
  const DEFAULT_SLIDERS = {
    waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
    hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
    rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
    forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
  };
  function genWorld(rng: Rng): WorldCase {
    return {
      seed: rng.int(0, 2 ** 31 - 1),
      size: rng.pick([48, 96]),
      global: rng.pick(SUPPLY_MODES),
      sliders: {
        waterLevel: rng.int(10, 60) / 100,
        hillLevel: rng.int(45, 90) / 100,
        rockLevel: rng.int(50, 100) / 100,
        forestDensity: rng.int(30, 90) / 100,
      },
    };
  }
  /** Toward the default sliders, the smaller size and the default global. */
  function* shrinkWorld(c: WorldCase): Iterable<WorldCase> {
    if (c.global !== DEFAULT_SUPPLY) yield { ...c, global: DEFAULT_SUPPLY };
    if (JSON.stringify(c.sliders) !== JSON.stringify(DEFAULT_SLIDERS))
      yield { ...c, sliders: DEFAULT_SLIDERS };
    if (c.size > 48) yield { ...c, size: 48 };
  }
  const paramsOf = (c: WorldCase) => ({ w: c.size, h: c.size, ...c.sliders });
  // 24 worlds of up to 96 x 96, three maps each
  const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
  const run = { seeds: SEEDS, shrink: shrinkWorld };

  it('draws worlds of every kind the property claims', () => {
    // The generator, checked: a narrowed generator would pass the property vacuously.
    const cases = SEEDS.map((s) => genWorld(new Rng(s)));
    expect(new Set(cases.map((c) => c.size))).toEqual(new Set([48, 96]));
    expect(new Set(cases.map((c) => c.global))).toEqual(new Set(SUPPLY_MODES));
    expect(new Set(cases.map((c) => c.seed)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.sliders.waterLevel)).size).toBeGreaterThan(8);
  });

  // 24 worlds of up to 96 x 96, three maps each: about 3 s alone
  it('gives both chains the same world, oil on the full chain only, and the simple chain when none is named', () => {
    forAll(
      genWorld,
      (c) => {
        setSupplyMode(c.global);
        const simple = generateMap(c.seed, paramsOf(c), 'simple');
        const full = generateMap(c.seed, paramsOf(c), 'full');
        const omitted = generateMap(c.seed, paramsOf(c));
        expect(planeDiffs(simple, full)).toEqual(SAME_PLANES);
        expect(oilTiles(simple)).toEqual([]);
        expect(planeDiffs(omitted, simple)).toEqual(SAME_PLANES);
        expect(propHash(omitted)).toBe(propHash(simple));
        // oil goes over the decorations; every other tile holds what the simple chain gave it
        const oil = new Set(oilTiles(full));
        const tiles = new Set([...simple.props.keys(), ...full.props.keys()]);
        for (const i of tiles)
          if (!oil.has(i))
            expect(propText(full.props.get(i)), `tile ${i}`).toBe(propText(simple.props.get(i)));
        // the fields and the start seeps both lie on dry ground
        for (const i of oil)
          expect([Terrain.Grass, Terrain.Sand], `oil on tile ${i}`).toContain(full.terrain[i]);
      },
      run,
    );
  }, 60_000);

  // 24 worlds of up to 96 x 96: about 2.5 s alone
  it('leaves an oil-free map as it is for the simple chain, whatever the global says', () => {
    forAll(
      genWorld,
      (c) => {
        setSupplyMode(c.global);
        const map = generateMap(c.seed, paramsOf(c), 'simple');
        const before = propsOf(map);
        placeOilFields(map, c.seed, 'simple');
        ensureStartDeposits(map, 'simple');
        expect(map.props).toEqual(before);
        placeOilFields(map, c.seed);
        ensureStartDeposits(map);
        expect(map.props).toEqual(before);
      },
      run,
    );
  }, 50_000);

  // The seeps go on every third grass or sand tile of a ring around the start chunk's centre where
  // the ring holds seven such tiles or more, and on the nearest of the whole chunk where it holds
  // fewer (a dense forest or a high Water level), so the claims hold on every slider value (#276).
  // 24 worlds of up to 96 x 96, two maps each: about 2.5 s alone
  it('holds oil in the full chain, three seeps or more in the start chunk, seeded once, on any sliders', () => {
    let short = 0;
    forAll(
      genWorld,
      (c) => {
        setSupplyMode(c.global);
        const full = generateMap(c.seed, paramsOf(c), 'full');
        // the claim is for a start chunk with three grass or sand tiles, which every one has
        expect(startGround(full).length).toBeGreaterThanOrEqual(3);
        expect(oilTiles(full).length).toBeGreaterThanOrEqual(3);
        expect(startOil(full).length).toBeGreaterThanOrEqual(3);
        // seeding an oil-free start chunk by hand reaches the same count, and a second call adds none
        const map = generateMap(c.seed, paramsOf(c), 'simple');
        expect(startOil(map)).toEqual([]);
        if (startRing(map).length < 7) short++;
        ensureStartDeposits(map, 'full');
        expect(startOil(map).length).toBeGreaterThanOrEqual(3);
        const once = propsOf(map);
        ensureStartDeposits(map, 'full');
        expect(map.props).toEqual(once);
      },
      run,
    );
    // some world's ring was short, so the fallback ran
    expect(short).toBeGreaterThan(0);
  }, 50_000);

  // 24 worlds of up to 96 x 96: about 2.5 s alone
  it('lays the seeps on every third tile of the ring, or on the nearest of the chunk at the step where the ring is short', () => {
    let short = 0;
    forAll(
      genWorld,
      (c) => {
        const map = generateMap(c.seed, paramsOf(c), 'simple');
        const before = propsOf(map);
        const want = ruleSeeps(map);
        expect(want.size).toBe(3);
        if (startRing(map).length < 7) short++;
        ensureStartDeposits(map, 'full');
        // the seeps, each on its tile alone, and every other tile as it was
        for (const [i, list] of map.props)
          if (!want.has(i)) expect(list, `tile ${i}`).toEqual(before.get(i));
        for (const [i, prop] of want) expect(map.props.get(i), `tile ${i}`).toEqual([prop]);
        expect([...map.props.keys()].filter((i) => !before.has(i) && !want.has(i))).toEqual([]);
      },
      run,
    );
    // both rules ran: the ring's and, where it was short, the chunk's
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(SEEDS.length);
  }, 50_000);
});

describe('the start seeps where the ring is short (#276)', () => {
  // The two worlds #276 reported: one seep and no seeps where the rule's ring was too short.
  it('a 32 x 32 world at Water level 0.6 (seed 4) gets three seeps in the full chain', () => {
    const map = generateMap(4, { w: 32, h: 32, waterLevel: 0.6 }, 'full');
    expect(startRing(withoutOil(map)).length).toBeLessThan(7);
    expect(startOil(map)).toHaveLength(3);
  });

  it('a 32 x 32 world at forest density 0.3 (seed 1) gets three seeps, and a second call none', () => {
    const map = generateMap(1, { w: 32, h: 32, forestDensity: 0.3 }, 'simple');
    expect(startRing(map).length).toBeLessThan(7);
    ensureStartDeposits(map, 'full');
    expect(startOil(map)).toHaveLength(3);
    const once = propsOf(map);
    ensureStartDeposits(map, 'full');
    expect(map.props).toEqual(once);
  });

  it.each(WORLDS)(
    'seed $seed at $size x $size, a world #235 measured: a ring of seven or more keeps the seeps it had',
    ({ seed, size }) => {
      const map = generateMap(seed, params(size), 'simple');
      const ring = startRing(map);
      expect(ring.length).toBeGreaterThanOrEqual(7);
      ensureStartDeposits(map, 'full');
      // every third tile of the ring, as before the fallback existed
      expect(startOil(map)).toEqual([ring[0].i, ring[3].i, ring[6].i].sort((a, b) => a - b));
    },
  );

  it('a chunk with fewer than three grass or sand tiles gets one on each, and a second call none', () => {
    const map = generateMap(1, { w: 32, h: 32 }, 'simple');
    map.terrain.fill(Terrain.Forest);
    map.props.clear();
    map.terrain[5 * 32 + 7] = Terrain.Sand;
    map.terrain[20 * 32 + 3] = Terrain.Grass;
    ensureStartDeposits(map, 'full');
    expect(oilTiles(map)).toEqual([5 * 32 + 7, 20 * 32 + 3]);
    const once = propsOf(map);
    ensureStartDeposits(map, 'full');
    expect(map.props).toEqual(once);
  });
});

// #276 on start chunks made by hand: generated worlds always hold dozens of grass and sand tiles
// in the start chunk, so the fallback's step is 3 there and a ring at its thresholds is rare. Here
// a forest chunk gets a chosen number of grass and sand tiles on the ring and off it, and some oil
// already laid, so every threshold and step of the rule is reached.
describe('the start seeps on any start chunk (#276)', () => {
  /** The start chunk's centre, in tiles: a 32 x 32 map is its own start chunk. */
  const C = 16;
  const onRing = (x: number, y: number) => {
    const d = Math.hypot(x - C, y - C);
    return d > 6 && d < 13;
  };
  interface SeepCase {
    seed: number;
    /** Grass or sand tiles; the rest of the chunk is forest. */
    ground: { x: number; y: number; sand: boolean; flowers: boolean }[];
    /** Tiles that already hold an oil seep, on the ground or not. */
    oil: { x: number; y: number }[];
  }
  function genSeeps(rng: Rng): SeepCase {
    const ground: SeepCase['ground'] = [];
    const taken = new Set<number>();
    const add = (x: number, y: number) => {
      if (x < 0 || y < 0 || x > 31 || y > 31 || taken.has(y * 32 + x)) return;
      taken.add(y * 32 + x);
      ground.push({ x, y, sand: rng.chance(0.3), flowers: rng.chance(0.3) });
    };
    // around the ring sizes one, two and three seeps need (1, 4 and 7), some in pairs mirrored
    // about the centre, which tie on distance
    const ring = rng.int(0, 9);
    while (ground.length < ring) {
      const x = rng.int(0, 31);
      const y = rng.int(0, 31);
      if (!onRing(x, y)) continue;
      add(x, y);
      if (ground.length < ring && rng.chance(0.3)) {
        if (rng.chance(0.5)) add(2 * C - x, y);
        else add(x, 2 * C - y);
      }
    }
    const off = rng.pick([0, 0, 1, 1, 2, 3, 4, 6, 9]);
    while (ground.length < ring + off) {
      const x = rng.int(0, 31);
      const y = rng.int(0, 31);
      if (!onRing(x, y)) add(x, y);
    }
    // seeps already there: often none or one, on a ground tile now and then
    const oil: SeepCase['oil'] = [];
    for (let k = rng.pick([0, 0, 0, 1, 1, 1, 2, 2, 3, 4]); k > 0; k--) {
      if (ground.length && rng.chance(0.3)) {
        const { x, y } = rng.pick(ground);
        oil.push({ x, y });
      } else oil.push({ x: rng.int(0, 31), y: rng.int(0, 31) });
    }
    return { seed: rng.int(0, 2 ** 31 - 1), ground, oil };
  }
  function* shrinkSeeps(c: SeepCase): Iterable<SeepCase> {
    for (const oil of shrinkArray(c.oil)) yield { ...c, oil };
    for (const ground of shrinkArray(c.ground)) yield { ...c, ground };
  }
  function seepMap(c: SeepCase): GameMap {
    const m = emptyMap(c.seed, 32, 32, Terrain.Forest);
    for (const g of c.ground) {
      const i = g.y * 32 + g.x;
      m.terrain[i] = g.sand ? Terrain.Sand : Terrain.Grass;
      if (g.flowers) m.props.set(i, [{ kind: 'flowers', variant: 1, ox: 0.1, oy: -0.1 }]);
    }
    for (const { x, y } of c.oil)
      m.props.set(y * 32 + x, [{ kind: 'oil', variant: 2, ox: 0, oy: 0 }]);
    return m;
  }
  /** The seep ensureStartDeposits lays at the `k`th place of its list on tile `i`. */
  const seep = (m: GameMap, i: number, k: number): PropInstance => {
    const jitter = hash2((i % 32) + m.originX, Math.floor(i / 32) + m.originY, m.seed + 15);
    return { kind: 'oil', variant: k % 3, ox: (jitter - 0.5) * 0.3, oy: 0 };
  };
  /**
   * #276's rule, read from the issue: the rule before it (every third grass or sand tile of the
   * ring, nearest first) where that reaches three seeps; else the nearest grass or sand tiles of
   * the whole chunk at step max(1, min(3, floor((n - 1) / (need - 1)))). Tiles holding oil count
   * toward the three and take no seep.
   */
  function rule(m: GameMap) {
    const oil = (i: number) => !!m.props.get(i)?.some((p) => p.kind === 'oil');
    let have = 0;
    for (let i = 0; i < 32 * 32; i++) if (oil(i)) have++;
    const need = Math.max(0, 3 - have);
    const free: { i: number; d: number }[] = [];
    for (let i = 0; i < 32 * 32; i++) {
      const t = m.terrain[i];
      if (!oil(i) && (t === Terrain.Grass || t === Terrain.Sand))
        free.push({ i, d: Math.hypot((i % 32) - C, Math.floor(i / 32) - C) });
    }
    free.sort((a, b) => a.d - b.d || a.i - b.i);
    const ring = free.filter((t) => t.d > 6 && t.d < 13);
    const everyThird = ring.filter((_, k) => k % 3 === 0).slice(0, need);
    const short = everyThird.length < need;
    const step =
      need > 1 ? Math.max(1, Math.min(3, Math.floor((free.length - 1) / (need - 1)))) : 1;
    const from = short ? free : ring;
    const at = short ? step : 3;
    const want = new Map<number, PropInstance>();
    for (let k = 0; want.size < need && k < from.length; k += at)
      want.set(from[k].i, seep(m, from[k].i, k));
    return { have, need, free: free.length, ring: ring.length, short, step, want };
  }

  // 300 chunks of 32 x 32, each seeded twice: about 0.1 s alone. Two seeps to lay on three free
  // tiles (step 2) is rare in a draw, so the run is longer than forAll's default.
  const SEEP_SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
  it('lay the rule’s seeps, reach three wherever three tiles are free, and a second call lays none', () => {
    const seen = new Set<string>();
    forAll(
      genSeeps,
      (c) => {
        const m = seepMap(c);
        const before = propsOf(m);
        const r = rule(m);
        seen.add(r.need === 0 ? 'full' : `need ${r.need}, ${r.short ? `step ${r.step}` : 'ring'}`);
        // the thresholds, with ground off the ring, where the two rules pick different tiles
        const off = r.free > r.ring;
        if (r.need === 3 && r.ring === 7 && off) seen.add('a ring of exactly seven');
        if (r.need === 3 && r.ring === 6 && off) seen.add('a ring of six');
        if (r.need === 2 && r.ring === 4 && off) seen.add('two to lay on a ring of four');
        if (r.need === 2 && r.ring === 3 && off) seen.add('two to lay on a ring of three');
        ensureStartDeposits(m, 'full');
        // the seeps on their tiles, alone, and every other tile as it was
        const wrong: string[] = [];
        for (let i = 0; i < 32 * 32; i++) {
          const want = r.want.get(i);
          const got = JSON.stringify(m.props.get(i));
          const expected = JSON.stringify(want ? [want] : before.get(i));
          if (got !== expected)
            wrong.push(`tile (${i % 32}, ${Math.floor(i / 32)}): ${got}, not ${expected}`);
        }
        expect(wrong).toEqual([]);
        // three wherever the chunk had room for them
        expect(startOil(m)).toHaveLength(Math.max(r.have, Math.min(3, r.have + r.free)));
        const once = propsOf(m);
        ensureStartDeposits(m, 'full');
        expect(m.props).toEqual(once);
      },
      { seeds: SEEP_SEEDS, shrink: shrinkSeeps },
    );
    // every branch of the rule ran, at the thresholds the ring keeps the old rule from
    expect([...seen].sort()).toEqual(
      [
        'full',
        'need 1, ring',
        'need 1, step 1',
        'need 2, ring',
        'need 2, step 1',
        'need 2, step 2',
        'need 2, step 3',
        'need 3, ring',
        'need 3, step 1',
        'need 3, step 2',
        'need 3, step 3',
        'a ring of exactly seven',
        'a ring of six',
        'two to lay on a ring of four',
        'two to lay on a ring of three',
      ].sort(),
    );
  });

  // 16 combinations of the Map sliders' ends, two worlds each at 32 and 96 tiles, both chains:
  // about 3.5 s alone
  it('reach three at every end of the Map sliders, and a second call lays none', () => {
    const keys = ['waterLevel', 'hillLevel', 'rockLevel', 'forestDensity'] as const;
    const ends = keys.map((key) => {
      const meta = RULE_META.find((m) => m.key === key)!;
      return [meta.min, meta.max];
    });
    for (let k = 0; k < 2 ** keys.length; k++) {
      const sliders = Object.fromEntries(keys.map((key, b) => [key, ends[b][(k >> b) & 1]]));
      for (const [seed, w] of [
        [1, 32],
        [2, 96],
      ]) {
        const at = `${JSON.stringify(sliders)}, seed ${seed}`;
        const full = generateMap(seed, { ...sliders, w, h: w }, 'full');
        const simple = generateMap(seed, { ...sliders, w, h: w }, 'simple');
        for (const [map, chain] of [
          [full, 'generated'],
          [simple, 'seeded by hand'],
        ] as const) {
          if (map === simple) ensureStartDeposits(map, 'full');
          const want = Math.min(3, startGround(map).length);
          expect(startOil(map).length, `${at}, ${chain}`).toBeGreaterThanOrEqual(want);
          const once = propsOf(map);
          ensureStartDeposits(map, 'full');
          expect(map.props, `${at}, ${chain}`).toEqual(once);
        }
      }
    }
  }, 70_000);
});
