import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateMap, placeOilFields, ensureStartDeposits, DEFAULT_MAP_PARAMS } from './mapgen';
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
import { forAll } from '../testing/property';

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
  }, 20_000);

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
  }, 20_000);

  // The seeps go on every third grass or sand tile of a ring around the start chunk's centre where
  // the ring holds seven such tiles or more, and on the nearest of the whole chunk where it holds
  // fewer (a dense forest or a high Water level), so the claims hold on every slider value (#276).
  // 24 worlds of up to 96 x 96, two maps each: about 0.45 s alone
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
  }, 20_000);

  // 24 worlds of up to 96 x 96: about 0.4 s alone
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
  }, 20_000);
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
