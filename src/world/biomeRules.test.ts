import { describe, it, expect } from 'vitest';
import {
  BEACH_REACH,
  DEFAULT_MAP_PARAMS,
  MOUNTAIN_REACH,
  decorateProps,
  emptyMap,
  generateMap,
  generateMapPlanes,
  placeOilFields,
  type MapGenParams,
  type MapPlanes,
} from './mapgen';
import { Biome, BIOME_NAMES, CLIMATES, Terrain, startRegion, type GameMap } from './tiles';
import { Rng } from '../engine/rng';
import type { SupplyMode } from '../sim/supply';
import { forAll, shrinkInt } from '../testing/property';

// The biome rules of generateMap (#340, #354): after the climate is smoothed, a tile's landform
// relabels it. Water the river pass made of land is River, other water is Lake unless it is sea
// (Water in the Ocean climate that the pass made no river or lake, a rule of reach 0; #341 makes
// lakes in basins, an island's too), sand within BEACH_REACH tiles of sea water
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
  const lake = big.lake;
  const at = (x: number, y: number) =>
    `world tile (${x + B.originX}, ${y + B.originY}), terrain ${terrain[y * w + x]}, ` +
    `biome ${biome[y * w + x]}, climate ${climate[y * w + x]}`;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const isSea = (x: number, y: number) => {
    if (!on(x, y)) return false;
    const i = y * w + x;
    return terrain[i] === Terrain.Water && !river[i] && !lake[i] && climate[i] === Biome.Ocean;
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
      const pass = big.river[j] || big.lake[j];
      if (B.terrain[j] === Terrain.Water && !pass && B.climate![j] === Biome.Ocean) sea++;
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

  // slow because it generates the planes of a 96 x 96 world twice: 0.30 s alone, so a limit of 30 s
  it('give the same planes for the same seed', () => {
    const a = generateMapPlanes(7412, { w: 96, h: 96 });
    const b = generateMapPlanes(7412, { w: 96, h: 96 });
    expect(a.map.biome).toEqual(b.map.biome);
    expect(a.map.climate).toEqual(b.map.climate);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.river).toEqual(b.river);
    expect(a.shore).toEqual(b.shore);
  }, 30_000);
});

/** The four diagonal neighbours: sea there alone is no shore. */
const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * The N4 fields of Rock and Mountain on `m`: each tile's field (-1 on other ground), and for each
 * field whether it holds Mountain terrain.
 */
function stoneFields(m: GameMap) {
  const { w, h, terrain } = m;
  const stone = (i: number) => terrain[i] === Terrain.Rock || terrain[i] === Terrain.Mountain;
  const field = new Int32Array(w * h).fill(-1);
  const holdsMountain: boolean[] = [];
  for (let s = 0; s < w * h; s++) {
    if (field[s] >= 0 || !stone(s)) continue;
    const id = holdsMountain.length;
    let mountain = false;
    field[s] = id;
    for (const stack = [s]; stack.length;) {
      const i = stack.pop()!;
      if (terrain[i] === Terrain.Mountain) mountain = true;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of SIDES) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
        const n = (y + dy) * w + x + dx;
        if (field[n] < 0 && stone(n)) {
          field[n] = id;
          stack.push(n);
        }
      }
    }
    holdsMountain.push(mountain);
  }
  return { field, holdsMountain };
}

/**
 * Each Rock tile's fewest steps across tile sides, over Rock, from a Mountain tile of `m` (0 on
 * Mountain, -1 where none reaches): a breadth-first search from every mountain at once.
 */
function stepsFromMountains(m: GameMap): Int32Array {
  const { w, h, terrain } = m;
  const steps = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (terrain[i] === Terrain.Mountain) {
      steps[i] = 0;
      queue.push(i);
    }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of SIDES) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
      const n = (y + dy) * w + x + dx;
      if (steps[n] < 0 && terrain[n] === Terrain.Rock) {
        steps[n] = steps[i] + 1;
        queue.push(n);
      }
    }
  }
  return steps;
}

describe('the biome rules, read again as the issues word them', () => {
  // A second reading of #340 and #354, written apart from the oracle above: the Mountain biome by
  // whole N4 fields of Rock and Mountain, and each rule at its edge (the shore's four sides, a
  // cliff coast, the corners of the beach's window, sand by a lake or a river, lake water beside
  // the sea, rock one step either side of the reach), each edge met on these worlds and decided as
  // its rule says. Read on the 20 default worlds of the test above, grown by RING.
  const SEEDS_20 = Array.from({ length: 20 }, (_, i) => i + 1);
  const worlds = new Map<number, { small: MapPlanes; big: MapPlanes }>();
  const defaultWorld = (seed: number) => {
    let planes = worlds.get(seed);
    if (!planes) {
      planes = worldPlanes({
        seed,
        full: false,
        w: 160,
        h: 160,
        ox: 0,
        oy: 0,
        sliders: DEFAULT_SLIDERS,
      });
      worlds.set(seed, planes);
    }
    return planes;
  };

  it('name the beach the reach the issue does, and read rock within the ring', () => {
    // "Sand within 2 tiles of sea water" (#340): the oracle above reads the constant, so it is
    // pinned here
    expect(BEACH_REACH).toBe(2);
    // a path a step past MOUNTAIN_REACH from the map stays on the grown world the rules are read on
    expect(RING).toBeGreaterThan(MOUNTAIN_REACH + 1);
  });

  // 20 worlds of 160 x 160, each generated with a ring around it and its stone fields flooded:
  // about 3 s alone
  it('give the Mountain biome to rock of fields holding a mountain, and to no other ground', () => {
    let onMountain = 0;
    let kept = 0;
    let bare = 0;
    for (const seed of SEEDS_20) {
      const B = defaultWorld(seed).big.map;
      const { w, terrain, biome } = B;
      const climate = B.climate!;
      const { field, holdsMountain } = stoneFields(B);
      for (let y = RING; y < RING + 160; y++)
        for (let x = RING; x < RING + 160; x++) {
          const i = y * w + x;
          const t = terrain[i];
          const b = biome[i];
          const where = () =>
            `seed ${seed}, world tile (${x - RING}, ${y - RING}), terrain ${t}, biome ${b}`;
          if (b === Biome.Mountain && t !== Terrain.Rock && t !== Terrain.Mountain)
            throw new Error(`no Grass, Forest, Sand, Hill or Water tile is Mountain: ${where()}`);
          if (t === Terrain.Mountain && b !== Biome.Mountain)
            throw new Error(`a Mountain tile is not in the Mountain biome: ${where()}`);
          if (t !== Terrain.Rock) continue;
          // a field the grown world cuts off holds no mountain within MOUNTAIN_REACH of the map
          if (!holdsMountain[field[i]]) {
            if (b !== climate[i])
              throw new Error(`rock of a field with no mountain is not its climate: ${where()}`);
            bare++;
          } else if (b === Biome.Mountain) onMountain++;
          else if (b === climate[i]) kept++;
          else
            throw new Error(
              `rock of a mountain's field is neither Mountain nor its climate: ${where()}`,
            );
        }
    }
    expect(onMountain).toBeGreaterThan(0);
    expect(bare).toBeGreaterThan(0);
    // The bound (MOUNTAIN_REACH steps, Core 2026-10-12) leaves a field's far rock in its climate:
    // 54 of 3491 tiles (1.5 %) on these worlds when it was set. At most one in twenty.
    expect(kept / (kept + onMountain)).toBeLessThanOrEqual(0.05);
  }, 60_000);

  // the same 20 worlds, generated by the test above when it runs first: up to 3 s alone
  it('decide each rule at its edge as the rule says, and meet every edge', () => {
    const met = {
      cliff: 0,
      shoredGrass: 0,
      shoredForest: 0,
      diagonalOnly: 0,
      beachAt2: 0,
      beachAtCorner: 0,
      sandAt3: 0,
      sandByInlandWater: 0,
      lakeBesideSea: 0,
      riverBesideSea: 0,
      rockAtReach: 0,
      rockPastReach: 0,
    };
    for (const seed of SEEDS_20) {
      const { big } = defaultWorld(seed);
      const B = big.map;
      const { w, h, terrain, biome } = B;
      const climate = B.climate!;
      const { river, lake, shore } = big;
      const sea = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const i = y * w + x;
        return terrain[i] === Terrain.Water && !river[i] && !lake[i] && climate[i] === Biome.Ocean;
      };
      const steps = stepsFromMountains(B);
      for (let y = RING; y < RING + 160; y++)
        for (let x = RING; x < RING + 160; x++) {
          const i = y * w + x;
          const t = terrain[i];
          const b = biome[i];
          const c = climate[i];
          const s = shore[i];
          const fail = (rule: string) => {
            const where =
              `seed ${seed}, world tile (${x - RING}, ${y - RING}), ` +
              `terrain ${t} (${s} before the shore), biome ${b}, climate ${c}`;
            throw new Error(`${rule}: ${where}`);
          };
          const side = SIDES.some(([dx, dy]) => sea(x + dx, y + dy));
          const diagonal = DIAGONALS.some(([dx, dy]) => sea(x + dx, y + dy));
          // the nearest sea water up to 3 tiles out, along either axis and in steps
          let axis = Infinity;
          let walk = Infinity;
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++)
              if (sea(x + dx, y + dy)) {
                axis = Math.min(axis, Math.max(Math.abs(dx), Math.abs(dy)));
                walk = Math.min(walk, Math.abs(dx) + Math.abs(dy));
              }
          // the shore: sea water on one of the 4 sides turns grass, forest and sand to sand
          if (s === Terrain.Hill || s === Terrain.Rock || s === Terrain.Mountain) {
            if (t !== s) fail('a cliff coast changed');
            if (side) met.cliff++;
          }
          if (s === Terrain.Grass || s === Terrain.Forest) {
            if (side) {
              if (t !== Terrain.Sand) fail('land beside the sea is not sand');
              if (s === Terrain.Grass) met.shoredGrass++;
              else met.shoredForest++;
            } else if (diagonal) {
              if (t !== s) fail('land with sea only on a diagonal changed');
              met.diagonalOnly++;
            }
          }
          // the beach: sand within 2 tiles of sea water along either axis, the window's corners too
          if (t === Terrain.Sand) {
            if (axis <= 2) {
              if (b !== Biome.Beach) fail('sand by the sea is no beach');
              if (axis === 2) met.beachAt2++;
              if (walk > 2) met.beachAtCorner++;
            } else {
              if (b !== c) fail('sand away from the sea is not its climate');
              if (axis === 3) met.sandAt3++;
              if (SIDES.some(([dx, dy]) => terrain[(y + dy) * w + x + dx] === Terrain.Water))
                met.sandByInlandWater++;
            }
          }
          // water: the sea rule reads the tile alone, so lake water beside the sea stays Lake
          if (t === Terrain.Water && side) {
            if (river[i]) {
              if (b !== Biome.River) fail('river water beside the sea is not River');
              met.riverBesideSea++;
            } else if (c !== Biome.Ocean) {
              if (b !== Biome.Lake) fail('lake water beside the sea is not Lake');
              met.lakeBesideSea++;
            }
          }
          // rock: the Mountain biome reaches exactly MOUNTAIN_REACH steps
          if (t === Terrain.Rock && steps[i] === MOUNTAIN_REACH) {
            if (b !== Biome.Mountain) fail('rock at the reach is not Mountain');
            met.rockAtReach++;
          }
          if (t === Terrain.Rock && steps[i] === MOUNTAIN_REACH + 1) {
            if (b !== c) fail('rock a step past the reach is not its climate');
            met.rockPastReach++;
          }
        }
    }
    for (const [edge, n] of Object.entries(met)) expect(n, `no case of ${edge}`).toBeGreaterThan(0);
  }, 60_000);

  it('keep river water out of the sea where a river crosses the Ocean climate', () => {
    // The one place the sea rule's river test decides anything: river water in the Ocean climate
    // (an island the river pass cut), found by search; 6 of 600 random worlds hold one. Sand around
    // it is a beach only where sea water is near.
    const c: World = {
      seed: 441112651,
      full: false,
      w: 129,
      h: 79,
      ox: -62,
      oy: -67,
      sliders: DEFAULT_SLIDERS,
    };
    const { small, big } = worldPlanes(c);
    const m = small.map;
    let crossing = 0;
    for (let i = 0; i < m.w * m.h; i++)
      if (small.river[i] && m.terrain[i] === Terrain.Water && m.climate![i] === Biome.Ocean) {
        expect(m.biome[i], `tile ${i}`).toBe(Biome.River);
        crossing++;
      }
    expect(crossing).toBeGreaterThan(0);
    checkRules(small, big, noneSeen());
  });
});

/** The props of tile `i` of `m`, as text. */
const propsAt = (m: GameMap, i: number) => JSON.stringify(m.props.get(i) ?? null);

/**
 * The first tile, in tile order, whose props differ between `a` and `b` (two planes of one map),
 * with both its props; null when none does. `skip` leaves tiles out.
 */
function propsDiff(a: GameMap, b: GameMap, skip: (i: number) => boolean = () => false) {
  const tiles = [...new Set([...a.props.keys(), ...b.props.keys()])].sort((x, y) => x - y);
  for (const i of tiles)
    if (!skip(i) && propsAt(a, i) !== propsAt(b, i))
      return `tile ${i}: ${propsAt(a, i)} against ${propsAt(b, i)}`;
  return null;
}

/** `m` with no landform left to read: its biome is its climate, and it has no props. */
const climateOnly = (m: GameMap): GameMap => ({
  ...m,
  biome: m.climate!.slice(),
  climate: undefined,
  props: new Map(),
});

describe('the decorations and oil fields of a generated map', () => {
  // A landform biome names the ground's shape, not its climate: decorations and oil fields read the
  // climate under it (climateAt), so a beach on an island grows palms and takes no oil, as island
  // sand did before the landforms, and one on a desert coast grows cacti. Each map is checked
  // against itself with its biome set to its climate, which leaves only the climate to read.
  const DECO_SEEDS = [1, 2, 3, 4, 5, 7412, 20260912, 31337];

  // 8 worlds of 160 x 160, each with its own river plan: about 3 s alone
  it('are the decorations its climate gives, on every tile', () => {
    // decorated tiles under each landform biome, so the check cannot pass on maps without one
    const under = new Map<number, number>();
    for (const seed of DECO_SEEDS) {
      const m = generateMap(seed, { w: 160, h: 160 }, 'simple');
      const bare = climateOnly(m);
      decorateProps(bare, seed);
      // a wheat field replaces the decoration of its tiles (src/world/wheat.test.ts)
      const wheat = (i: number) => !!m.props.get(i)?.some((p) => p.kind === 'wheat');
      expect(propsDiff(m, bare, wheat), `seed ${seed}`).toBeNull();
      for (const [i, list] of m.props)
        if (m.biome[i] >= CLIMATES && !wheat(i) && list.length)
          under.set(m.biome[i], (under.get(m.biome[i]) ?? 0) + 1);
    }
    expect(under.get(Biome.Beach) ?? 0).toBeGreaterThan(0);
  }, 60_000);

  // 8 worlds of 160 x 160, each with its own river plan: about 3 s alone
  it('lay oil where the climate takes it, never on ground in the Ocean climate', () => {
    let oil = 0;
    for (const seed of DECO_SEEDS) {
      const m = generateMap(seed, { w: 160, h: 160 }, 'full');
      for (const [i, list] of m.props)
        if (list.some((p) => p.kind === 'oil')) {
          oil++;
          expect(m.climate![i], `seed ${seed}, oil on tile ${i}`).not.toBe(Biome.Ocean);
        }
      const own = { ...m, props: new Map() };
      placeOilFields(own, seed, 'full');
      const bare = climateOnly(m);
      placeOilFields(bare, seed, 'full');
      expect(propsDiff(own, bare), `seed ${seed}`).toBeNull();
    }
    expect(oil).toBeGreaterThan(0);
  }, 60_000);

  it('grow the nature set by climate, and only there', () => {
    /** The kinds on a field of `terrain` in `climate`. */
    const kindsOf = (terrain: Terrain, climate: Biome) => {
      const m = emptyMap(7412, 96, 96, terrain);
      m.biome.fill(climate);
      decorateProps(m, 7412);
      return new Set([...m.props.values()].flat().map((p) => p.kind));
    };
    const has = (kinds: Set<string>, ...want: string[]) =>
      expect(want.filter((k) => !kinds.has(k))).toEqual([]);
    const lacks = (kinds: Set<string>, ...not: string[]) =>
      expect(not.filter((k) => kinds.has(k))).toEqual([]);

    const forest = kindsOf(Terrain.Forest, Biome.Forest);
    has(forest, 'beech', 'maple', 'fern', 'mushrooms', 'log', 'stump', 'oak', 'birch');
    lacks(forest, 'larch', 'acacia', 'apple', 'dryshrub');
    const taiga = kindsOf(Terrain.Forest, Biome.Taiga);
    has(taiga, 'larch', 'spruce', 'pine', 'log', 'heather');
    lacks(taiga, 'beech', 'maple', 'acacia');
    const plains = kindsOf(Terrain.Grass, Biome.Plains);
    has(plains, 'poplar', 'apple', 'heather', 'stump');
    lacks(plains, 'larch', 'acacia', 'dryshrub', 'mushrooms');
    const desert = kindsOf(Terrain.Sand, Biome.Desert);
    has(desert, 'acacia', 'dryshrub');
    lacks(desert, 'beech', 'fern', 'larch');
    const shrubland = kindsOf(Terrain.Grass, Biome.Desert);
    has(shrubland, 'acacia', 'dryshrub');
    lacks(shrubland, 'tree', 'flowers');
    const swamp = kindsOf(Terrain.Forest, Biome.Swamp);
    lacks(swamp, 'beech', 'maple', 'larch', 'poplar');
  });

  it('give an apple tree its orchard: most of the plains have none, an orchard has several', () => {
    const m = emptyMap(7412, 160, 160, Terrain.Grass);
    m.biome.fill(Biome.Plains);
    decorateProps(m, 7412);
    const squares = new Map<number, number>();
    for (const [i, list] of m.props)
      if (list[0].kind === 'apple') {
        const sq = ((i / 160) >> 3) * 20 + ((i % 160) >> 3);
        squares.set(sq, (squares.get(sq) ?? 0) + 1);
      }
    expect(squares.size).toBeGreaterThan(0);
    expect(squares.size).toBeLessThan(40);
    for (const n of squares.values()) expect(n).toBeGreaterThan(1);
  });

  it('read the climate under a beach: palms on an island, cacti in the desert, oil off the sea', () => {
    /** The decoration kinds and the oil tiles of a field of beach sand over `climate`. */
    const beachOf = (climate: Biome) => {
      const m = emptyMap(7412, 64, 64, Terrain.Sand);
      m.biome.fill(Biome.Beach);
      m.climate = new Uint8Array(m.w * m.h).fill(climate);
      decorateProps(m, 7412);
      const kinds = new Set([...m.props.values()].flat().map((p) => p.kind));
      const oil = { ...m, props: new Map() };
      placeOilFields(oil, 7412, 'full');
      return { kinds: [...kinds].sort(), oil: oil.props.size };
    };
    expect(beachOf(Biome.Ocean)).toEqual({ kinds: ['palm'], oil: 0 });
    const desert = beachOf(Biome.Desert);
    expect(desert.kinds).toEqual(['acacia', 'cactus', 'deadtree', 'dryshrub']);
    expect(desert.oil).toBeGreaterThan(0);
    expect(beachOf(Biome.Plains).kinds).toEqual([]);
  });
});
