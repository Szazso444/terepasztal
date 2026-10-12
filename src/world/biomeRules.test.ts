import { describe, it, expect } from 'vitest';
import {
  BEACH_REACH,
  DEFAULT_MAP_PARAMS,
  MOUNTAIN_REACH,
  generateMapPlanes,
  type MapGenParams,
  type MapPlanes,
} from './mapgen';
import { Biome, BIOME_NAMES, CLIMATES, Terrain, startRegion } from './tiles';
import { Rng } from '../engine/rng';
import type { SupplyMode } from '../sim/supply';
import { forAll, shrinkInt } from '../testing/property';

// The biome rules of generateMap (#340, #354): after the climate is smoothed, a tile's landform
// relabels it. Water the river pass cut through land is River, other water is Lake unless it is
// sea (Water in the Ocean climate, a rule of reach 0), sand within BEACH_REACH tiles of sea water
// is Beach (grass, forest and sand beside the sea turn to sand first), and Mountain terrain is
// Mountain, with every Rock tile that reaches it in MOUNTAIN_REACH steps over Rock. Every other
// tile keeps its climate, which the map keeps in its own plane.
//
// Each world is checked against an oracle written apart from mapgen.ts: the rules restated over
// the planes the map comes with, read on the same world grown by a ring of chunks, so a rule that
// reads past the map's edge (a sea beside it, a mountain behind it) is read in full. The grown
// world holds the map tile for tile (generation is in world space), which the first check pins
// for the planes the rules read.

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The biomes a landform relabels a tile's climate to. */
const LANDFORMS: readonly number[] = [Biome.Lake, Biome.River, Biome.Beach, Biome.Mountain];

type Sliders = Pick<MapGenParams, 'waterLevel' | 'hillLevel' | 'rockLevel' | 'forestDensity'>;
const DEFAULT_SLIDERS: Sliders = {
  waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
  hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
  rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
  forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
};

/** A world: a map of any size from 32 tiles, any origin, any sliders, either production chain. */
interface World {
  seed: number;
  full: boolean;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sliders: Sliders;
}

const genWorld = (rng: Rng): World => ({
  seed: rng.int(0, 2 ** 31 - 1),
  full: rng.chance(0.5),
  w: rng.int(32, 160),
  h: rng.int(32, 160),
  ox: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
  oy: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
  sliders: rng.chance(0.3)
    ? DEFAULT_SLIDERS
    : {
        waterLevel: rng.int(10, 60) / 100,
        hillLevel: rng.int(45, 90) / 100,
        rockLevel: rng.int(50, 100) / 100,
        forestDensity: rng.int(30, 90) / 100,
      },
});

/** The seeds of the property over any world. */
const WORLD_SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

function* shrinkWorld(c: World): Iterable<World> {
  if (c.full) yield { ...c, full: false };
  if (JSON.stringify(c.sliders) !== JSON.stringify(DEFAULT_SLIDERS))
    yield { ...c, sliders: DEFAULT_SLIDERS };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
  for (const w of shrinkInt(c.w, 32)) yield { ...c, w };
  for (const h of shrinkInt(c.h, 32)) yield { ...c, h };
}

/** The ring of chunks the context world adds on every side: wider than any rule reads. */
const RING = 32;

/** The world's map, and the same world grown by a ring of chunks, as expandSave grows it. */
function worldPlanes(c: World) {
  const chain: SupplyMode = c.full ? 'full' : 'simple';
  const small = generateMapPlanes(
    c.seed,
    { ...c.sliders, w: c.w, h: c.h, originX: c.ox, originY: c.oy },
    chain,
  );
  const big = generateMapPlanes(
    c.seed,
    {
      ...c.sliders,
      w: c.w + 2 * RING,
      h: c.h + 2 * RING,
      originX: c.ox - RING,
      originY: c.oy - RING,
    },
    chain,
  );
  return { small, big };
}

/** What a world showed, summed over cases, so a run that never meets a rule cannot pass. */
interface Seen {
  river: number;
  lake: number;
  sea: number;
  beach: number;
  /** grass or forest the shore turned to sand */
  shored: number;
  mountain: number;
  /** rock in the Mountain biome reached in more than one step */
  rockFar: number;
  /** rock reached in exactly MOUNTAIN_REACH steps */
  rockAtReach: number;
  /** rock that keeps its climate */
  rockClimate: number;
  /** tiles whose landform biome lies over a climate */
  relabelled: number;
}
const noneSeen = (): Seen => ({
  river: 0,
  lake: 0,
  sea: 0,
  beach: 0,
  shored: 0,
  mountain: 0,
  rockFar: 0,
  rockAtReach: 0,
  rockClimate: 0,
  relabelled: 0,
});

/**
 * Checks the map `small` against the rules, read on `big`, which holds it RING tiles in from
 * every side; throws at the first tile that breaks one. Adds what it saw to `seen`.
 */
function checkRules(small: MapPlanes, big: MapPlanes, seen: Seen) {
  const B = big.map;
  const { w, h, terrain, biome } = B;
  const climate = B.climate!;
  const river = big.river;
  const at = (x: number, y: number) =>
    `world tile (${x + B.originX}, ${y + B.originY}), terrain ${terrain[y * w + x]}, ` +
    `biome ${biome[y * w + x]}, climate ${climate[y * w + x]}`;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const isSea = (x: number, y: number) => {
    if (!on(x, y)) return false;
    const i = y * w + x;
    return terrain[i] === Terrain.Water && !river[i] && climate[i] === Biome.Ocean;
  };
  /** The fewest steps from (x, y) over Rock and Mountain to a Mountain tile, up to `limit`. */
  const stepsToMountain = (x: number, y: number, limit: number): number => {
    const seenAt = new Map<number, number>([[y * w + x, 0]]);
    let ring = [[x, y]];
    for (let d = 1; d <= limit && ring.length; d++) {
      const next: number[][] = [];
      for (const [px, py] of ring)
        for (const [dx, dy] of SIDES) {
          const nx = px + dx;
          const ny = py + dy;
          const n = ny * w + nx;
          if (!on(nx, ny) || seenAt.has(n)) continue;
          const t = terrain[n];
          if (t === Terrain.Mountain) return d;
          if (t !== Terrain.Rock) continue;
          seenAt.set(n, d);
          next.push([nx, ny]);
        }
      ring = next;
    }
    return Infinity;
  };

  // the map is the grown world's middle, in the planes the rules read and write
  const S = small.map;
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const i = y * S.w + x;
      const j = (y + RING) * w + x + RING;
      const planes: [string, number, number][] = [
        ['terrain', S.terrain[i], terrain[j]],
        ['biome', S.biome[i], biome[j]],
        ['climate', S.climate![i], climate[j]],
        ['river', small.river[i], river[j]],
        ['shore', small.shore[i], big.shore[j]],
      ];
      for (const [name, a, b] of planes)
        if (a !== b)
          throw new Error(`${name} ${a} on the map, ${b} grown, at ${at(x + RING, y + RING)}`);
    }

  for (let y = RING; y < RING + S.h; y++)
    for (let x = RING; x < RING + S.w; x++) {
      const i = y * w + x;
      const t = terrain[i];
      const c = climate[i];
      const b = biome[i];
      if (c >= CLIMATES) throw new Error(`climate is no climate at ${at(x, y)}`);
      if (b >= BIOME_NAMES.length) throw new Error(`biome has no name at ${at(x, y)}`);
      if (b !== c) {
        if (!LANDFORMS.includes(b))
          throw new Error(`a climate biome is not the climate at ${at(x, y)}`);
        seen.relabelled++;
      }
      // the sea shore: grass, forest and sand with sea water on a side turned sand, nothing else
      const s = big.shore[i];
      const beside = SIDES.some(([dx, dy]) => isSea(x + dx, y + dy));
      const shore = s === Terrain.Grass || s === Terrain.Forest || s === Terrain.Sand;
      const want = shore && beside ? Terrain.Sand : s;
      if (t !== want) throw new Error(`terrain ${t}, not ${want}, after the shore at ${at(x, y)}`);
      if (t !== s) seen.shored++;
      // the biome
      let expected: number;
      if (t === Terrain.Water) {
        if (river[i]) expected = Biome.River;
        else expected = isSea(x, y) ? c : Biome.Lake;
      } else if (t === Terrain.Mountain) expected = Biome.Mountain;
      else if (t === Terrain.Rock) {
        const d = stepsToMountain(x, y, MOUNTAIN_REACH);
        expected = d <= MOUNTAIN_REACH ? Biome.Mountain : c;
        if (d === MOUNTAIN_REACH) seen.rockAtReach++;
        if (d > 1 && d <= MOUNTAIN_REACH) seen.rockFar++;
        if (d > MOUNTAIN_REACH) seen.rockClimate++;
      } else if (t === Terrain.Sand) {
        let near = false;
        for (let dy = -BEACH_REACH; dy <= BEACH_REACH; dy++)
          for (let dx = -BEACH_REACH; dx <= BEACH_REACH; dx++) near ||= isSea(x + dx, y + dy);
        expected = near ? Biome.Beach : c;
      } else expected = c;
      if (b !== expected) throw new Error(`biome ${b}, not ${expected}, at ${at(x, y)}`);
      if (b === Biome.River) seen.river++;
      if (b === Biome.Lake) seen.lake++;
      if (b === Biome.Beach) seen.beach++;
      if (b === Biome.Mountain) seen.mountain++;
      if (t === Terrain.Water && b === Biome.Ocean) seen.sea++;
    }
}

/** Sea water in the start chunk of `small`, or on a side of it; read on `big` around it. */
function seaAtStart(small: MapPlanes, big: MapPlanes): number {
  const S = small.map;
  const B = big.map;
  const { rx, ry } = startRegion(S);
  const rs = S.regionSize;
  let sea = 0;
  for (let y = ry * rs - 1; y <= Math.min(S.h, (ry + 1) * rs); y++)
    for (let x = rx * rs - 1; x <= Math.min(S.w, (rx + 1) * rs); x++) {
      const j = (y + RING) * B.w + x + RING;
      if (B.terrain[j] === Terrain.Water && !big.river[j] && B.climate![j] === Biome.Ocean) sea++;
    }
  return sea;
}

describe('the biome ids', () => {
  it('append Lake, River, Beach and Mountain after the six climates, renumbering none', () => {
    expect(BIOME_NAMES).toEqual([
      'plains',
      'forest',
      'desert',
      'taiga',
      'swamp',
      'ocean',
      'lake',
      'river',
      'beach',
      'mountain',
    ]);
    expect([
      Biome.Plains,
      Biome.Forest,
      Biome.Desert,
      Biome.Taiga,
      Biome.Swamp,
      Biome.Ocean,
    ]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([Biome.Lake, Biome.River, Biome.Beach, Biome.Mountain]).toEqual([6, 7, 8, 9]);
    expect(CLIMATES).toBe(6);
  });
});

describe('the biome rules', () => {
  // 20 worlds of 160 x 160, the default size and sliders, each generated with a ring around it:
  // about 3 s alone
  it('hold on 20 worlds at the default size and sliders', () => {
    const seen = noneSeen();
    for (let seed = 1; seed <= 20; seed++) {
      const { small, big } = worldPlanes({
        seed,
        full: false,
        w: 160,
        h: 160,
        ox: 0,
        oy: 0,
        sliders: DEFAULT_SLIDERS,
      });
      try {
        checkRules(small, big, seen);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
      }
      expect(seaAtStart(small, big), `seed ${seed}: sea water at the start chunk`).toBe(0);
    }
    // every rule met tiles it relabels, and the shore turned land to sand
    for (const k of ['river', 'lake', 'sea', 'beach', 'shored', 'mountain', 'rockFar'] as const)
      expect(seen[k], k).toBeGreaterThan(0);
    expect(seen.relabelled).toBeGreaterThan(0);
  }, 60_000);

  it('draws worlds of every kind the property below claims', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = WORLD_SEEDS.map((s) => genWorld(new Rng(s)));
    for (const full of [true, false]) expect(cases.some((c) => c.full === full)).toBe(true);
    expect(cases.some((c) => c.sliders === DEFAULT_SLIDERS)).toBe(true);
    // a low Rock level, where stone fields run on far past the reach
    expect(cases.some((c) => c.sliders.rockLevel <= 0.6)).toBe(true);
    expect(cases.some((c) => c.sliders.waterLevel >= 0.5)).toBe(true);
    // small maps and large ones, sizes off the chunk grid, origins on it and off it
    expect(cases.some((c) => Math.min(c.w, c.h) < 64)).toBe(true);
    expect(cases.some((c) => Math.max(c.w, c.h) >= 128)).toBe(true);
    expect(cases.some((c) => c.w % 32 !== 0 && c.h % 32 !== 0)).toBe(true);
    expect(cases.some((c) => c.ox % 32 === 0 && c.ox < 0)).toBe(true);
    expect(cases.some((c) => c.ox % 32 !== 0 && c.oy % 32 !== 0)).toBe(true);
  });

  // 24 worlds up to 160 tiles a side, each generated with a ring around it: about 3 s alone
  it('hold on worlds of any size, origin, sliders and chain, and keep the sea off the start chunk', () => {
    const seen = noneSeen();
    forAll(
      genWorld,
      (c) => {
        const { small, big } = worldPlanes(c);
        checkRules(small, big, seen);
        // generateMap lays the shore after the start chunk's patches and its pump tile, on ground
        // the shore never reaches: no sea water in the chunk or on a side of it
        expect(seaAtStart(small, big), 'sea water at the start chunk').toBe(0);
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorld, shrinkBudget: 40 },
    );
    for (const k of Object.keys(seen) as (keyof Seen)[]) expect(seen[k], k).toBeGreaterThan(0);
  }, 60_000);

  it('give the same planes for the same seed', () => {
    const a = generateMapPlanes(7412, { w: 96, h: 96 });
    const b = generateMapPlanes(7412, { w: 96, h: 96 });
    expect(a.map.biome).toEqual(b.map.biome);
    expect(a.map.climate).toEqual(b.map.climate);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.river).toEqual(b.river);
    expect(a.shore).toEqual(b.shore);
  });
});
