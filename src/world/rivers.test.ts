import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAP_PARAMS,
  generateMap,
  generateMapPlanes,
  type MapGenParams,
  type MapPlanes,
} from './mapgen';
import { levelTarget, maxStep, tileLevels } from './elevation';
import { Biome, Terrain, startRegion, type GameMap } from './tiles';
import {
  CHUNK_TILES,
  CHUNK_VERSION,
  buildMap,
  chunkKey,
  decodeChunk,
  encodeChunk,
  type ChunkStore,
} from './chunks';
import { oldChunkText } from './oldChunkTexts';
import {
  DRY,
  FLOW_CAP,
  HIGH_RIVER_FLOW,
  KEEP_OUT,
  LAKE_CLEARANCE,
  LAKE_TILES,
  LOW,
  RIVER_FLOW,
  SIDE_STREAM_FLOW,
  WIDE_FLOW,
  WaterKind,
  drain,
  levelSteps,
  type DrainInput,
} from './rivers';
import { DIR_DX, DIR_DY, Dir } from '../engine/iso';
import { Rng, hash2 } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';

// Rivers and lakes (#341): the drainage of the river region around the start, read off the maps
// generateMap makes. Every property is checked on a map grown by a ring of chunks around the one
// asked for, which holds it tile for tile, so a lake or a river beside the map's edge is read in
// full.

type Sliders = Pick<MapGenParams, 'waterLevel' | 'hillLevel' | 'rockLevel' | 'forestDensity'>;
const DEFAULTS: Sliders = {
  waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
  hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
  rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
  forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
};
/** Another setting of the Map sliders: lower water and lower hills, so more of the land is high. */
const LOW_LAND: Sliders = { waterLevel: 0.3, hillLevel: 0.58, rockLevel: 0.7, forestDensity: 0.5 };

/** The ring the checks read around a map. */
const RING = CHUNK_TILES;

/**
 * A map of `size` tiles a side at (`ox`, `oy`), and the same world grown by RING on every side,
 * which keeps its start chunk.
 */
function world(seed: number, size: number, sliders: Sliders, ox = 0, oy = 0) {
  const small = generateMapPlanes(seed, { ...sliders, w: size, h: size, originX: ox, originY: oy });
  const big = generateMapPlanes(seed, {
    ...sliders,
    w: size + 2 * RING,
    h: size + 2 * RING,
    originX: ox - RING,
    originY: oy - RING,
  });
  return { small, big };
}

/** What the checks met, summed over the worlds, so a run that never meets a case cannot pass. */
interface Seen {
  river: number;
  wide: number;
  raised: number;
  drop: number;
  intoLake: number;
  intoSea: number;
  lake: number;
  outlet: number;
  /** a river running out of a lake beside it */
  lakeOutlet: number;
}
const noneSeen = (): Seen => ({
  river: 0,
  wide: 0,
  raised: 0,
  drop: 0,
  intoLake: 0,
  intoSea: 0,
  lake: 0,
  outlet: 0,
  lakeOutlet: 0,
});

/** The tile river tile `i` of `m` runs into, or -1 off the map. */
function downstream(m: GameMap, i: number): number {
  const d = m.flowDir![i] - 1;
  const x = (i % m.w) + DIR_DX[d];
  const y = Math.floor(i / m.w) + DIR_DY[d];
  return x < 0 || y < 0 || x >= m.w || y >= m.h ? -1 : y * m.w + x;
}

/**
 * Checks the water of `small` (its tiles RING in from every side of `big`) and throws at the
 * first tile that breaks a rule; adds what it met to `seen`.
 */
function checkWater(small: MapPlanes, big: MapPlanes, seen: Seen) {
  const m = big.map;
  const { w, h, terrain, biome } = m;
  const surface = m.waterSurface!;
  const flow = m.flow!;
  const levels = tileLevels(m);
  const { river, lake } = big;
  const inner = (x: number, y: number) =>
    x >= RING && y >= RING && x < RING + small.map.w && y < RING + small.map.h;
  const at = (i: number) => `world tile (${(i % w) + m.originX}, ${Math.floor(i / w) + m.originY})`;
  // the map is the grown world's middle, in every water plane
  const S = small.map;
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const i = y * S.w + x;
      const j = (y + RING) * w + x + RING;
      const planes: [string, number, number][] = [
        ['terrain', S.terrain[i], terrain[j]],
        ['biome', S.biome[i], biome[j]],
        ['water level', S.waterSurface![i], surface[j]],
        ['flow', S.flow![i], flow[j]],
        ['side', S.flowDir![i], m.flowDir![j]],
        ['river', small.river[i], river[j]],
        ['lake', small.lake[i], lake[j]],
      ];
      for (const [name, a, b] of planes)
        if (a !== b) throw new Error(`${name} ${a} on the map, ${b} grown, at ${at(j)}`);
    }
  for (let y = RING; y < RING + S.h; y++)
    for (let x = RING; x < RING + S.w; x++) {
      const i = y * w + x;
      // neighbouring levels within a step, and water at its own level
      const step = maxStep(m);
      if (Math.abs(levels[i] - levels[i - 1]) > step || Math.abs(levels[i] - levels[i - w]) > step)
        throw new Error(`too steep a step at ${at(i)}`);
      if (terrain[i] === Terrain.Water && levels[i] !== surface[i])
        throw new Error(`water at level ${levels[i]}, its own ${surface[i]}, at ${at(i)}`);
      if (terrain[i] !== Terrain.Water && surface[i])
        throw new Error(`a water level on land at ${at(i)}`);
      // River and Lake as #340 assigns them, read off the pass's own flow planes rather than the
      // river plane biomeRules is given: River where the pass laid a river (a side to run to),
      // Lake on any other water but the sea (Water in the Ocean climate the pass made no lake)
      const laid = m.flowDir![i] !== 0;
      if (laid !== (biome[i] === Biome.River))
        throw new Error(`River not where a river runs at ${at(i)}`);
      if (laid !== flow[i] > 0)
        throw new Error(`flow ${flow[i]} and side ${m.flowDir![i]} at ${at(i)}`);
      const still =
        terrain[i] === Terrain.Water && !laid && (lake[i] === 1 || m.climate![i] !== Biome.Ocean);
      if (still !== (biome[i] === Biome.Lake))
        throw new Error(`Lake not on still water at ${at(i)}`);
      if (surface[i]) seen.raised++;
      if (river[i]) {
        seen.river++;
        if (terrain[i] !== Terrain.Water || biome[i] !== Biome.River)
          throw new Error(`river not River water at ${at(i)}`);
        if (flow[i] < 1 || flow[i] > FLOW_CAP) throw new Error(`flow ${flow[i]} at ${at(i)}`);
        const n = downstream(m, i);
        // no river ends on dry land, and none runs uphill
        if (n < 0) throw new Error(`a river leaves the grown world at ${at(i)}`);
        if (terrain[n] !== Terrain.Water) throw new Error(`a river ends on land at ${at(i)}`);
        if (surface[n] > surface[i]) throw new Error(`water rises downstream at ${at(i)}`);
        if (surface[n] < surface[i]) seen.drop++;
        if (lake[n]) seen.intoLake++;
        else if (!river[n]) seen.intoSea++;
      } else if (flow[i] || m.flowDir![i])
        throw new Error(`flow or a side off a river at ${at(i)}`);
      if (lake[i]) {
        if (terrain[i] !== Terrain.Water || biome[i] !== Biome.Lake)
          throw new Error(`lake not Lake water at ${at(i)}`);
        // only on the lowest ground: nothing at level 2 or more within 2 tiles
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (levels[i + dy * w + dx] >= 2)
              throw new Error(`a lake tile near level ${levels[i + dy * w + dx]} at ${at(i)}`);
      }
      // a river is one channel on high ground: no 2 x 2 block of river with a tile at level 2+
      const block = [i, i + 1, i + w, i + w + 1];
      if (block.every((k) => river[k])) {
        seen.wide++;
        if (block.some((k) => levels[k] >= 2)) throw new Error(`a wide river high up at ${at(i)}`);
      }
    }
  // every lake that lies wholly in the grown world: three tiles or more, and an outlet, a river
  // running from it, or the sea beside it
  const group = new Int32Array(w * h).fill(-1);
  for (let s = 0; s < w * h; s++) {
    if (!lake[s] || group[s] >= 0) continue;
    const members = [s];
    group[s] = s;
    let whole = true;
    let mine = false;
    let outlet = false;
    for (let k = 0; k < members.length; k++) {
      const i = members[k];
      const x = i % w;
      const y = (i - x) / w;
      if (inner(x, y)) mine = true;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d];
        const ny = y + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          whole = false;
          continue;
        }
        const n = ny * w + nx;
        if (lake[n]) {
          if (group[n] < 0) {
            group[n] = s;
            members.push(n);
          }
        } else if (river[n]) {
          // a river beside the lake that does not run into it runs out of it, and stands no higher
          // than the lake: water never rises downstream
          const into = downstream(m, n);
          if (into < 0 || group[into] !== s) {
            outlet = true;
            if (mine) seen.lakeOutlet++;
            if (surface[n] > surface[i])
              throw new Error(`a river at level ${surface[n]} runs out of a lake at ${at(n)}`);
          }
        } else if (terrain[n] === Terrain.Water) outlet = true;
      }
    }
    if (!whole || !mine) continue;
    seen.lake++;
    if (members.length < 3) throw new Error(`a lake of ${members.length} tiles at ${at(s)}`);
    if (!outlet) throw new Error(`a lake of ${members.length} tiles with no outlet at ${at(s)}`);
    seen.outlet++;
  }
}

/**
 * The start chunk of `small` stays buildable and gets a river nearby, read on `big` (which holds
 * it RING tiles in): no river within 13 tiles of the chunk's centre but one that runs out of a
 * lake (the ground's own water there is a lake that overflows outwards), and a river in the 3 x 3
 * chunks around it.
 */
function checkStart(small: MapPlanes, big: MapPlanes) {
  const m = big.map;
  const { rx, ry } = startRegion(small.map);
  const cx = rx * CHUNK_TILES + CHUNK_TILES / 2 + RING;
  const cy = ry * CHUNK_TILES + CHUNK_TILES / 2 + RING;
  let near = 0;
  for (let y = Math.max(0, cy - 48); y < Math.min(m.h, cy + 48); y++)
    for (let x = Math.max(0, cx - 48); x < Math.min(m.w, cx + 48); x++) {
      const i = y * m.w + x;
      if (!big.river[i]) continue;
      near++;
      const d = Math.hypot(x - cx, y - cy);
      if (d < 13 && !fromLake(big, i))
        throw new Error(
          `a river ${d.toFixed(1)} tiles from the start at map tile (${x - RING}, ${y - RING})`,
        );
    }
  if (!near) throw new Error('no river in the 3 x 3 chunks around the start');
}
/**
 * Whether river tile `i` runs out of a lake: it, or a river tile upstream of it, lies beside a lake
 * tile it does not run into.
 */
function fromLake(p: MapPlanes, i: number) {
  const m = p.map;
  const upstream = [i];
  const met = new Set(upstream);
  for (let k = 0; k < upstream.length; k++) {
    const t = upstream[k];
    const x = t % m.w;
    const y = Math.floor(t / m.w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const n = ny * m.w + nx;
      if (p.lake[n] && downstream(m, t) !== n) return true;
      if (p.river[n] && !met.has(n) && downstream(m, n) === t) {
        met.add(n);
        upstream.push(n);
      }
    }
  }
  return false;
}

/** A world for the checks: its seed, its map's size and origin, and which sliders it has. */
interface WorldCase {
  seed: number;
  size: number;
  ox: number;
  oy: number;
}
/** Several sizes, the default 160 the most often, on the chunk grid and off it, at any origin. */
const genWorldCase = (rng: Rng): WorldCase => ({
  seed: rng.int(1, 2 ** 31 - 1),
  size: rng.chance(0.3) ? 160 : rng.chance(0.5) ? rng.pick([96, 128, 192, 224]) : rng.int(64, 224),
  ox: rng.chance(0.5) ? 0 : rng.int(-100, 100),
  oy: rng.chance(0.5) ? 0 : rng.int(-100, 100),
});
/** Smaller maps first, then the origin toward 0. */
function* shrinkWorldCase(c: WorldCase): Iterable<WorldCase> {
  for (const size of shrinkInt(c.size, 64)) yield { ...c, size };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
}
const WORLD_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('rivers and lakes of a generated map', () => {
  it('are checked on worlds of several sizes and origins', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = WORLD_SEEDS.map((s) => genWorldCase(new Rng(s)));
    expect(cases.filter((c) => c.size === 160).length).toBeGreaterThanOrEqual(3);
    expect(cases.some((c) => c.size < 128)).toBe(true);
    expect(cases.some((c) => c.size > 160)).toBe(true);
    expect(cases.some((c) => c.size % 32 !== 0)).toBe(true);
    expect(cases.some((c) => c.ox !== 0 && c.oy !== 0)).toBe(true);
  });

  // 20 worlds up to 224 tiles a side at the default sliders, each with a ring around it: one
  // river plan a world, about 5 s alone, and a failure shrinks through up to 30 more
  it('hold on 20 worlds of several sizes at the default sliders', () => {
    const seen = noneSeen();
    forAll(
      genWorldCase,
      (c) => {
        const { small, big } = world(c.seed, c.size, DEFAULTS, c.ox, c.oy);
        checkWater(small, big, seen);
        checkStart(small, big);
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorldCase, shrinkBudget: 30 },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  }, 120_000);

  // 10 worlds at other sliders: about 1.5 s alone
  it('hold at another setting of the Map sliders', () => {
    const seen = noneSeen();
    forAll(
      genWorldCase,
      (c) => {
        const { small, big } = world(c.seed, c.size, LOW_LAND, c.ox, c.oy);
        checkWater(small, big, seen);
        checkStart(small, big);
      },
      { seeds: WORLD_SEEDS.slice(0, 10), shrink: shrinkWorldCase, shrinkBudget: 30 },
    );
    for (const k of ['river', 'raised', 'drop', 'lake', 'outlet', 'lakeOutlet'] as const)
      expect(seen[k], k).toBeGreaterThan(0);
  }, 120_000);
});

describe('the river region', () => {
  // A chunk of the region is the same whichever map holds it, generated before its neighbours
  // or after them: stored with a map of 3 x 3 chunks and grown, against the grown map at once.
  // 4 worlds, one river plan each: about 1.5 s alone
  it('gives a chunk the same water generated before its neighbours or after them', () => {
    for (const seed of [1, 7412, 20260912, 31337]) {
      const small = { w: 96, h: 96 };
      const grown = { w: 160, h: 160, originX: -32, originY: -32 };
      const stored = buildMap(seed, small, {});
      const later = buildMap(seed, grown, stored.chunks).map;
      const once = buildMap(seed, grown, {}).map;
      for (const [name, a, b] of [
        ['terrain', later.terrain, once.terrain],
        ['biome', later.biome, once.biome],
        ['water level', later.waterSurface!, once.waterSurface!],
        ['flow', later.flow!, once.flow!],
        ['side', later.flowDir!, once.flowDir!],
      ] as const)
        expect([...a], `seed ${seed}: ${name}`).toEqual([...b]);
      // and the map as generated is the stored one
      expect([...once.flowDir!]).toEqual([...generateMap(seed, grown).flowDir!]);
    }
  }, 60_000);

  // Beyond the region, short streams: a default world grown four rings, one past the region on
  // every side. One plan: about 1 s alone
  it('runs short streams beyond it that end in water or a pond, at level 0', () => {
    const seed = 7;
    const p = generateMapPlanes(seed, { w: 416, h: 416, originX: -128, originY: -128 });
    const m = p.map;
    // the region is the 11 x 11 chunks around the start chunk (world tiles 64 to 95, as a new
    // world of 160 tiles has it): world tiles -96 to 255, here map tiles 32 to 383
    const beyond = (x: number, y: number) => x < 32 || y < 32 || x >= 384 || y >= 384;
    let streams = 0;
    for (let y = 1; y < m.h - 1; y++)
      for (let x = 1; x < m.w - 1; x++) {
        const i = y * m.w + x;
        if (!p.river[i] || !beyond(x, y)) continue;
        streams++;
        expect(m.waterSurface![i]).toBe(0);
        const n = downstream(m, i);
        if (n >= 0) expect(m.terrain[n], `stream at (${x}, ${y})`).toBe(Terrain.Water);
      }
    expect(streams).toBeGreaterThan(0);
  }, 60_000);

  it('draws pairs of maps of every kind the world-space property claims', () => {
    const cases = PAIR_SEEDS.map((s) => genStripPair(new Rng(s)));
    // past the region on either side, and wholly in it; cut off the chunk grid; grown by 1 and 2
    expect(cases.some((c) => c.along.chunks > 2 * REGION + 1)).toBe(true);
    expect(cases.some((c) => c.along.chunks <= 2 * REGION + 1)).toBe(true);
    expect(cases.some((c) => c.along.cut > 0 && c.across.cut > 0)).toBe(true);
    expect(cases.some((c) => c.along.grow === 2 || c.across.grow === 2)).toBe(true);
    expect(cases.some((c) => c.alongX) && cases.some((c) => !c.alongX)).toBe(true);
    expect(cases.some((c) => c.low) && cases.some((c) => !c.low)).toBe(true);
  });

  // A tile's water is a function of its world tile, the seed, the sliders and the start chunk,
  // whatever map holds it: in the region and beyond it, where streams run. Strips through the
  // start chunk up to 15 chunks long against the same world grown around them. And on the big
  // map no river ends on land, a stream past the region included.
  // 12 pairs, one river plan each: about 3 s alone, and a failure shrinks through up to 30 more
  it('gives two maps of one world the same water where they overlap, past the region too', () => {
    let beyond = 0;
    forAll(
      genStripPair,
      (c) => {
        const { small, big } = stripMaps(c);
        const dx = small.originX - big.originX;
        const dy = small.originY - big.originY;
        for (let y = 0; y < small.h; y++)
          for (let x = 0; x < small.w; x++) {
            const i = y * small.w + x;
            const j = (y + dy) * big.w + x + dx;
            const wx = x + small.originX;
            const wy = y + small.originY;
            const out = (v: number, s: number) => v < s - REGION * 32 || v >= s + (REGION + 1) * 32;
            if (small.flowDir![i] && (out(wx, c.startX) || out(wy, c.startY))) beyond++;
            for (const [name, a, b] of [
              ['terrain', small.terrain, big.terrain],
              ['biome', small.biome, big.biome],
              ['water level', small.waterSurface!, big.waterSurface!],
              ['flow', small.flow!, big.flow!],
              ['side', small.flowDir!, big.flowDir!],
            ] as const)
              if (a[i] !== b[j])
                throw new Error(
                  `${name} ${a[i]} on the small map, ${b[j]} on the big one, at (${wx}, ${wy})`,
                );
          }
        for (let i = 0; i < big.w * big.h; i++) {
          const n = big.flowDir![i] ? downstream(big, i) : -1;
          const wx = (i % big.w) + big.originX;
          const wy = Math.floor(i / big.w) + big.originY;
          if (n >= 0 && big.terrain[n] !== Terrain.Water)
            throw new Error(`a river ends on land at (${wx}, ${wy})`);
        }
      },
      { seeds: PAIR_SEEDS, shrink: shrinkStripPair, shrinkBudget: 30 },
    );
    // rivers past the region were compared
    expect(beyond).toBeGreaterThan(0);
  }, 90_000);

  // A world's plan is kept for its next maps (PLAN_CACHE), with the ground it generated while it
  // is the latest; a map must not depend on whether either was there. The map is wide enough for
  // the ground it generates to reach past the plan's. 2 worlds, 6 maps of 240 x 40 tiles and 12
  // more river plans: about 1.5 s alone
  it('gives a world the same map whatever was generated before it', () => {
    const frame = { w: 240, h: 40, originX: 13, originY: -21 };
    const planes = (m: GameMap) =>
      [m.terrain, m.biome, m.variant, m.climate!, m.waterSurface!, m.flow!, m.flowDir!].map((a) =>
        Array.from(a),
      );
    const props = (m: GameMap) => JSON.stringify([...m.props]);
    for (const seed of [3, 7412]) {
      // five other worlds first: no plan of this one is kept
      for (let k = 1; k <= 5; k++) generateMap(seed + 1000 * k, { w: 32, h: 32 });
      const cold = generateMap(seed, frame);
      // its plan and the ground it generated
      const warm = generateMap(seed, frame);
      // its plan, the ground dropped for another world's
      generateMap(seed + 7, { w: 32, h: 32 });
      const kept = generateMap(seed, frame);
      for (const m of [warm, kept]) {
        expect(planes(m), `seed ${seed}`).toEqual(planes(cold));
        expect(props(m), `seed ${seed}`).toBe(props(cold));
      }
    }
  }, 40_000);
});

/** The river region's reach from the start chunk, in chunks along either axis (mapgen.ts). */
const REGION = 5;
const PAIR_SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * One axis of a pair: the small map is `chunks` chunks long less `cut` tiles at its far end, and
 * the big one `grow` chunks longer at both ends; both have their start chunk where the axis says.
 */
interface StripAxis {
  chunks: number;
  cut: number;
  grow: number;
}
/** Two maps of one world: a strip through its start chunk, long along an axis, and a bigger one. */
interface StripPair {
  seed: number;
  low: boolean;
  alongX: boolean;
  along: StripAxis;
  across: StripAxis;
  /** world tile of the start chunk's corner */
  startX: number;
  startY: number;
}

/** An axis of `chunks` chunks; one chunk wide, a map keeps it whole (no game clips its start). */
const genAxis = (rng: Rng, chunks: number): StripAxis => ({
  chunks,
  cut: chunks === 1 || rng.chance(0.5) ? 0 : rng.int(1, 31),
  grow: rng.int(1, 2),
});
const genStripPair = (rng: Rng): StripPair => ({
  seed: rng.int(1, 2 ** 31 - 1),
  low: rng.chance(0.3),
  alongX: rng.chance(0.5),
  along: genAxis(
    rng,
    rng.chance(0.75) ? rng.int(2 * REGION + 2, 2 * REGION + 5) : rng.int(3, 2 * REGION + 1),
  ),
  across: genAxis(rng, rng.int(1, 3)),
  startX: 32 * rng.int(-3, 3),
  startY: 32 * rng.int(-3, 3),
});

function* shrinkStripPair(c: StripPair): Iterable<StripPair> {
  if (c.low) yield { ...c, low: false };
  for (const k of ['along', 'across'] as const) {
    const a = c[k];
    if (a.grow > 1) yield { ...c, [k]: { ...a, grow: 1 } };
    if (a.cut) yield { ...c, [k]: { ...a, cut: 0 } };
    for (const chunks of shrinkInt(a.chunks, 1))
      if (chunks > 1 || !a.cut) yield { ...c, [k]: { ...a, chunks } };
  }
}

/** The pair's maps: their start chunk at (startX, startY), the big one around the small one. */
function stripMaps(c: StripPair) {
  const frame = (a: StripAxis, start: number, ring: number) => {
    const n = a.chunks + 2 * ring;
    // the start chunk is the middle chunk, the nearer one when even (startRegion)
    return { len: 32 * n - (ring ? 0 : a.cut), origin: start - 32 * Math.floor((n - 1) / 2) };
  };
  const [ax, ay] = c.alongX ? [c.along, c.across] : [c.across, c.along];
  const sliders = c.low ? LOW_LAND : DEFAULTS;
  const map = (gx: number, gy: number) => {
    const x = frame(ax, c.startX, gx);
    const y = frame(ay, c.startY, gy);
    return generateMap(c.seed, {
      ...sliders,
      w: x.len,
      h: y.len,
      originX: x.origin,
      originY: y.origin,
    });
  };
  return { small: map(0, 0), big: map(ax.grow, ay.grow) };
}

describe('the water planes in stored chunks', () => {
  it('round-trip in a chunk text of this version', () => {
    const built = buildMap(7412, { w: 96, h: 96 }, {});
    let rivers = 0;
    for (const text of Object.values(built.chunks)) {
      const c = decodeChunk(text)!;
      expect(c.version).toBe(CHUNK_VERSION);
      rivers += c.flowDir.filter((d) => d).length;
    }
    expect(rivers).toBeGreaterThan(0);
    // the map built from the store alone has every plane as generated
    const again = buildMap(7412, { w: 96, h: 96 }, built.chunks, () => {
      throw new Error('generated a stored chunk');
    }).map;
    const m = generateMap(7412, { w: 96, h: 96 });
    expect([...again.waterSurface!]).toEqual([...m.waterSurface!]);
    expect([...again.flow!]).toEqual([...m.flow!]);
    expect([...again.flowDir!]).toEqual([...m.flowDir!]);
  });

  it('read as level 0, no flow and no side from a chunk of version 2', () => {
    // a version 2 text of the same planes (oldChunkTexts.ts): without the water planes of version
    // 3 and the features of version 4
    const m = generateMap(7412, { w: 96, h: 96 });
    const text = encodeChunk(m, 1, 1);
    const now = decodeChunk(text)!;
    expect(now.flowDir.some((d) => d)).toBe(true);
    const v2 = oldChunkText(now, 2);
    const old = decodeChunk(v2)!;
    expect(old.version).toBe(2);
    expect([...old.terrain]).toEqual([...now.terrain]);
    expect([...old.biome]).toEqual([...now.biome]);
    for (const plane of [old.waterSurface, old.flow, old.flowDir, old.feature])
      expect(plane.every((v) => v === 0)).toBe(true);
    // a map built from it has its water at level 0
    const built = buildMap(7412, { w: 32, h: 32, originX: 32, originY: 32 }, { '1,1': v2 }, () => {
      throw new Error('generated a stored chunk');
    }).map;
    for (let i = 0; i < 32 * 32; i++)
      if (built.terrain[i] === Terrain.Water) expect(levelTarget(built, i)).toBe(0);
  });

  it('end a new river that runs into a stored chunk in a pond on the new side', () => {
    // a 160-tile world with one chunk stored as an old generator left it: all grass. The chunk is
    // the first in reading order that a river of the fresh world runs into from another chunk.
    // Every new river that ran into it ends in a pond at the seam.
    for (const seed of [1, 2, 3, 4]) {
      const params = { w: 160, h: 160 };
      const fresh = buildMap(seed, params, {});
      const chunkOf = (i: number) =>
        Math.floor(i / 160 / CHUNK_TILES) * 5 + Math.floor((i % 160) / CHUNK_TILES);
      let target = -1;
      for (let i = 0; i < 160 * 160; i++) {
        if (!fresh.map.flowDir![i]) continue;
        const n = downstream(fresh.map, i);
        if (n < 0 || chunkOf(n) === chunkOf(i) || fresh.map.terrain[n] !== Terrain.Water) continue;
        if (target < 0 || chunkOf(n) < target) target = chunkOf(n);
      }
      expect(target, `seed ${seed}: no river runs from chunk to chunk`).toBeGreaterThanOrEqual(0);
      const cx = target % 5;
      const cy = Math.floor(target / 5);
      // the stored chunk: a stub of plain grass, no water in it
      const stub = generateMap(seed, params);
      stub.terrain.fill(Terrain.Grass);
      stub.biome.fill(Biome.Plains);
      stub.climate!.fill(Biome.Plains);
      stub.waterSurface!.fill(0);
      stub.flow!.fill(0);
      stub.flowDir!.fill(0);
      stub.props.clear();
      const store: ChunkStore = { [chunkKey(cx, cy)]: encodeChunk(stub, cx, cy) };
      const built = buildMap(seed, params, store).map;
      const stored = (x: number, y: number) =>
        Math.floor(x / CHUNK_TILES) === cx && Math.floor(y / CHUNK_TILES) === cy;
      let ponds = 0;
      for (let y = 0; y < 160; y++)
        for (let x = 0; x < 160; x++) {
          const i = y * 160 + x;
          if (stored(x, y)) continue;
          if (built.flowDir![i]) {
            // no new river runs into the stored chunk
            const n = downstream(built, i);
            if (n >= 0) expect(built.terrain[n], `seed ${seed}, (${x}, ${y})`).toBe(Terrain.Water);
          }
          // a river that ran into it in the fresh world ends at the seam in a pond
          const f = fresh.map.flowDir![i];
          if (!f) continue;
          const n = downstream(fresh.map, i);
          if (n < 0 || !stored(n % 160, Math.floor(n / 160))) continue;
          expect(built.terrain[i]).toBe(Terrain.Water);
          expect(built.biome[i]).toBe(Biome.Lake);
          expect(built.flowDir![i]).toBe(0);
          expect(built.flow![i]).toBe(0);
          ponds++;
        }
      expect(ponds, `seed ${seed}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('draws seams of every kind the seam property claims', () => {
    const cases = SEAM_SEEDS.map((s) => genSeam(new Rng(s)));
    for (const ground of STUB_GROUNDS)
      expect(
        cases.some((c) => c.ground === ground),
        ground,
      ).toBe(true);
    for (const near of ['any', 'river', 'raised'] as const)
      expect(
        cases.some((c) => c.near === near),
        near,
      ).toBe(true);
  });

  // #339's seam rule, for any stored chunk of a 160-tile world: whatever ground an older
  // generator left in it, no new river ends on its land, new water stands at most a level above
  // it and never rises downstream, and the new side is the generator's but at the seam.
  // 16 worlds, each generated twice: about 4 s alone, and a failure shrinks through up to 20 more
  it('fits the new side to a stored chunk of any ground, and changes it only at the seam', () => {
    const seen = { ponds: 0, lowered: 0, intoStored: 0 };
    forAll(
      genSeam,
      (c) => {
        const params = { w: 160, h: 160 };
        const fresh = buildMap(c.seed, params, {}).map;
        let { cx, cy } = c;
        if (c.near !== 'any') {
          // the first chunk in reading order that a river of the fresh world runs into, or that
          // raised water stands beside
          const chunk = (i: number) =>
            Math.floor(i / 160 / CHUNK_TILES) * 5 + Math.floor((i % 160) / CHUNK_TILES);
          let first = -1;
          for (let i = 0; i < 160 * 160; i++) {
            const into = fresh.flowDir![i] ? [downstream(fresh, i)] : [];
            const beside = fresh.waterSurface![i] >= 2 ? [i - 160, i + 160, i - 1, i + 1] : [];
            for (const n of c.near === 'river' ? into : beside) {
              if (n < 0 || n >= 160 * 160 || Math.abs((n % 160) - (i % 160)) > 1) continue;
              if (chunk(n) !== chunk(i) && (first < 0 || chunk(n) < first)) first = chunk(n);
            }
          }
          if (first >= 0) [cx, cy] = [first % 5, Math.floor(first / 5)];
        }
        const store: ChunkStore = { [chunkKey(cx, cy)]: encodeChunk(stubChunk(c, fresh), cx, cy) };
        const m = buildMap(c.seed, params, store).map;
        const levels = tileLevels(m);
        const stored = (i: number) =>
          Math.floor((i % 160) / CHUNK_TILES) === cx && Math.floor(i / 160 / CHUNK_TILES) === cy;
        const sides = (i: number) =>
          [-160, 1, 160, -1]
            .map((d) => i + d)
            .filter(
              (n, k) =>
                n >= 0 &&
                n < 160 * 160 &&
                (k % 2 === 0 || Math.floor(n / 160) === Math.floor(i / 160)),
            );
        const at = (i: number) => `(${i % 160}, ${Math.floor(i / 160)})`;
        for (let i = 0; i < 160 * 160; i++) {
          if (stored(i)) continue;
          const water = m.terrain[i] === Terrain.Water;
          if (m.flowDir![i]) {
            const n = downstream(m, i);
            if (n >= 0 && m.terrain[n] !== Terrain.Water)
              throw new Error(`a new river ends on land at ${at(i)}`);
            if (n >= 0 && stored(n)) seen.intoStored++;
            if (n >= 0 && !stored(n) && m.waterSurface![n] > m.waterSurface![i])
              throw new Error(`water rises downstream at ${at(i)}`);
          }
          if (water)
            for (const n of sides(i))
              if (stored(n) && m.waterSurface![i] > levelTarget(m, n) + 1)
                throw new Error(
                  `new water ${m.waterSurface![i]} beside stored ${levelTarget(m, n)} at ${at(i)}`,
                );
          // water at its own level, away from the map's border
          const x = i % 160;
          const y = Math.floor(i / 160);
          if (water && x && y && x < 159 && y < 159 && levels[i] !== m.waterSurface![i])
            throw new Error(
              `water at level ${levels[i]}, its own ${m.waterSurface![i]}, at ${at(i)}`,
            );
          // the generator's, but a pond where a river ran on into stored land, and water levels
          // lowered
          const ranInto = fresh.flowDir![i] ? downstream(fresh, i) : -1;
          if (ranInto >= 0 && stored(ranInto) && m.terrain[ranInto] !== Terrain.Water) {
            if (m.biome[i] !== Biome.Lake || !water || m.flowDir![i] || m.flow![i])
              throw new Error(`no pond at ${at(i)}`);
            seen.ponds++;
          } else
            for (const [name, a, b] of [
              ['terrain', m.terrain, fresh.terrain],
              ['biome', m.biome, fresh.biome],
              ['flow', m.flow!, fresh.flow!],
              ['side', m.flowDir!, fresh.flowDir!],
            ] as const)
              if (a[i] !== b[i]) throw new Error(`${name} ${a[i]}, generated ${b[i]}, at ${at(i)}`);
          if (m.waterSurface![i] > fresh.waterSurface![i])
            throw new Error(`water raised at ${at(i)}`);
          if (m.waterSurface![i] < fresh.waterSurface![i]) seen.lowered++;
        }
      },
      { seeds: SEAM_SEEDS, shrink: shrinkSeam, shrinkBudget: 20 },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  }, 90_000);
});

const SEAM_SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
/** What an older generator may have left in a stored chunk. */
const STUB_GROUNDS = ['grass', 'water', 'raised', 'hill', 'mountain', 'mixed'] as const;
interface Seam {
  seed: number;
  /**
   * the stored chunk; unless `near` is 'any', the first a fresh river runs into or the first
   * beside raised water instead, where the world has one
   */
  cx: number;
  cy: number;
  near: 'any' | 'river' | 'raised';
  ground: (typeof STUB_GROUNDS)[number];
}
/**
 * Worlds whose 160-tile map has water at level 2 beside another chunk, so a stored chunk there
 * lowers it: found by scanning seeds 1 to 100. Should generation change and leave none, the seam
 * property fails on `lowered` and these want picking again.
 */
const RAISED_WORLDS = [5, 36, 38, 61, 82, 95, 100];
const genSeam = (rng: Rng): Seam => {
  const near = rng.pick(['any', 'river', 'raised'] as const);
  const raised = near === 'raised';
  return {
    seed: raised ? rng.pick(RAISED_WORLDS) : rng.int(1, 2 ** 31 - 1),
    cx: rng.int(0, 4),
    cy: rng.int(0, 4),
    near,
    // beside raised water, ground that holds it lower: grass, level-0 water or a mix
    ground: raised ? rng.pick(['grass', 'water', 'mixed'] as const) : rng.pick(STUB_GROUNDS),
  };
};
function* shrinkSeam(c: Seam): Iterable<Seam> {
  if (c.ground !== 'grass') yield { ...c, ground: 'grass' };
  if (c.near !== 'any') yield { ...c, near: 'any' };
  for (const cx of shrinkInt(c.cx)) yield { ...c, cx };
  for (const cy of shrinkInt(c.cy)) yield { ...c, cy };
}
/** The world's map as an older generator might have left it, to store a chunk of. */
function stubChunk(c: Seam, like: GameMap): GameMap {
  const m = generateMap(c.seed, { w: like.w, h: like.h });
  delete m.generatedLevel;
  m.props.clear();
  m.flow!.fill(0);
  m.flowDir!.fill(0);
  const rng = new Rng(c.seed);
  for (let i = 0; i < m.w * m.h; i++) {
    const t =
      c.ground === 'mixed'
        ? rng.pick([Terrain.Grass, Terrain.Hill, Terrain.Water, Terrain.Rock, Terrain.Mountain])
        : {
            grass: Terrain.Grass,
            water: Terrain.Water,
            raised: Terrain.Water,
            hill: Terrain.Hill,
            mountain: Terrain.Mountain,
          }[c.ground];
    m.terrain[i] = t;
    m.biome[i] =
      t === Terrain.Water ? Biome.Lake : t === Terrain.Mountain ? Biome.Mountain : Biome.Plains;
    m.climate![i] = Biome.Plains;
    m.waterSurface![i] =
      t !== Terrain.Water
        ? 0
        : c.ground === 'raised'
          ? 2
          : c.ground === 'mixed'
            ? rng.int(0, 2)
            : 0;
  }
  return m;
}

describe('the drainage', () => {
  /** Planes of `size` x `size` tiles for drain, its core all but 2 tiles around. */
  function planes(size: number, elev: (x: number, y: number) => number, ground = Terrain.Grass) {
    const n = size * size;
    const p: DrainInput = {
      waterLevel: 0.36,
      hillLevel: 0.64,
      rockLevel: 0.76,
      w: size,
      h: size,
      core: { x0: 2, y0: 2, x1: size - 2, y1: size - 2 },
      elev: new Float32Array(n),
      ground: new Uint8Array(n).fill(ground),
      land: new Uint8Array(n).fill(ground),
      sea: new Uint8Array(n),
      mark: new Uint8Array(n),
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) p.elev[y * size + x] = elev(x, y);
    return p;
  }
  /** The tiles of a river from `i` down to the water it ends in or the core's edge. */
  const course = (p: DrainInput, d: ReturnType<typeof drain>, i: number) => {
    const out = [i];
    for (let k = i; d.kind[k] === WaterKind.River && d.dir[k];) {
      const x = (k % p.w) + DIR_DX[d.dir[k] - 1];
      const y = Math.floor(k / p.w) + DIR_DY[d.dir[k] - 1];
      if (x < p.core.x0 || y < p.core.y0 || x >= p.core.x1 || y >= p.core.y1) break;
      k = y * p.w + x;
      out.push(k);
    }
    return out;
  };

  it('reads the demo thresholds in level steps of the Map sliders', () => {
    const s = { waterLevel: 0.36, hillLevel: 0.64, rockLevel: 0.76 };
    expect(levelSteps(s, 0.36)).toBeCloseTo(0);
    expect(levelSteps(s, 0.64)).toBeCloseTo(3);
    expect(levelSteps(s, 0.76)).toBeCloseTo(4);
    // a step is a third of the way from the water to the hills below them
    expect(levelSteps(s, 0.36 + 0.28 / 3)).toBeCloseTo(1);
    expect(levelSteps(s, 0.7)).toBeCloseTo(3.5);
  });

  it('fills a basin on low ground to a lake that overflows into a river to the edge', () => {
    // a bowl at 0.40 rising gently to 0.43 and more at the edge: its rim is below a level step
    const p = planes(24, (x, y) => 0.4 + 0.0005 * ((x - 12) ** 2 + (y - 12) ** 2));
    const d = drain(p);
    const lake = [...d.kind.keys()].filter((i) => d.kind[i] === WaterKind.Lake);
    expect(lake.length).toBeGreaterThan(20);
    expect(d.kind[12 * 24 + 12]).toBe(WaterKind.Lake);
    for (const i of lake) expect(d.surface[i]).toBe(0);
    // a river leaves it and runs to the edge of the core
    const out = [...d.kind.keys()].filter(
      (i) =>
        d.kind[i] === WaterKind.River &&
        [1, -1, 24, -24].some((k) => d.kind[i + k] === WaterKind.Lake),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(d.exits.length).toBeGreaterThan(0);
    // and the same input gives the same water
    const again = drain(p);
    expect([...again.kind]).toEqual([...d.kind]);
    expect([...again.dir]).toEqual([...d.dir]);
  });

  it('runs a river on high ground at level 2, one level down at a time, never up', () => {
    // a valley in a hill, sloping down along x to its foot: every tile Hill ground, step 3 and more
    const p = planes(40, (x, y) => 0.72 - 0.001 * x + 0.003 * Math.abs(y - 20), Terrain.Hill);
    const d = drain(p);
    let raised = 0;
    let rivers = 0;
    for (let i = 0; i < d.kind.length; i++) {
      if (d.kind[i] !== WaterKind.River) continue;
      rivers++;
      if (d.surface[i] === 2) raised++;
      const c = course(p, d, i);
      for (let k = 1; k < c.length; k++) {
        expect(d.surface[c[k]]).toBeLessThanOrEqual(d.surface[c[k - 1]]);
        expect(d.surface[c[k - 1]] - d.surface[c[k]]).toBeLessThanOrEqual(1);
      }
    }
    expect(rivers).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  it('needs more rain for a river on high ground than below it', () => {
    // a plane sloping down along x, the same in every row, below the hills and then above them;
    // each row gathers more than HIGH_RIVER_FLOW tiles of rain by the core's far edge
    const size = HIGH_RIVER_FLOW + 40;
    const low = drain(planes(size, (x) => 0.5 - 0.0005 * x));
    const high = drain(planes(size, (x) => 0.7 - 0.0005 * x));
    const count = (d: ReturnType<typeof drain>) =>
      d.kind.filter((k) => k === WaterKind.River).length;
    expect(RIVER_FLOW).toBeLessThan(HIGH_RIVER_FLOW);
    expect(count(high)).toBeLessThan(count(low));
  });

  it('keeps rain and rivers off ground kept out, and the land there drains away', () => {
    const p = planes(30, (x, y) => 0.45 + 0.001 * Math.hypot(x - 15, y - 15));
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 30; x++)
        if (Math.hypot(x - 15, y - 15) < 6) p.mark[y * 30 + x] = KEEP_OUT;
    const d = drain(p);
    for (let i = 0; i < 900; i++)
      if (p.mark[i] & KEEP_OUT) expect(d.kind[i]).not.toBe(WaterKind.River);
  });

  it('ends a river in the sea, its last tile a plain river tile', () => {
    // land sloping down to a sea along the bottom rows, in a valley that gathers it into one river
    const p = planes(30, (x, y) => 0.6 - 0.002 * y + 0.006 * Math.abs(x - 15));
    for (let y = 24; y < 30; y++) for (let x = 0; x < 30; x++) p.sea[y * 30 + x] = 1;
    const d = drain(p);
    let mouths = 0;
    for (let i = 0; i < 900; i++) {
      if (d.kind[i] !== WaterKind.River) continue;
      const x = (i % 30) + DIR_DX[d.dir[i] - 1];
      const y = Math.floor(i / 30) + DIR_DY[d.dir[i] - 1];
      if (d.kind[y * 30 + x] === WaterKind.Sea) {
        mouths++;
        expect(d.flow[i]).toBeGreaterThanOrEqual(RIVER_FLOW);
      }
    }
    expect(mouths).toBeGreaterThan(0);
  });
});

// The drainage against a slow, obvious one. slowDrain follows drain's documented steps with
// nothing clever in them: the flood scans every tile it has reached for the lowest (ties to the
// lower tile index) instead of keeping a heap, the clearance reads the whole 5 x 5 square instead
// of a sliding count, the main inflow is searched over every tile, the rivers run on down the
// flood until nothing changes, the way a removed side stream ran on goes until nothing changes,
// and the levels are the greatest every rule allows, pulled from upstream instead of pushed down.
// On small planes drawn from a seed, drain gives the same water tile for tile.

/** Rain grows from this many level steps above the sea, RAIN_PER_STEP a step (the demo's 0.55). */
const RAIN_FROM = (0.55 - 0.24) / 0.11;
const RAIN_PER_STEP = 2 * 0.11;
/** A basin's water stands more than this many level steps over its ground (the demo's 0.015). */
const LAKE_DEPTH = 0.015 / 0.11;

/** drain's output as slowDrain makes it, and the flood it read it from. */
interface Slow {
  kind: Uint8Array;
  surface: Uint8Array;
  flow: Uint16Array;
  dir: Uint8Array;
  exits: { tile: number; dir: number; flow: number }[];
  /** the tile each core tile drains into; -1 where the flood starts (the sea, the core's edge) */
  down: Int32Array;
  /** the highest ground on each core tile's way out */
  spill: Float32Array;
  acc: Float32Array;
  /** river tiles the one-channel rule took away (some may be river again, a lake's outlet) */
  pruned: Uint8Array;
  /** the rivers the one-channel rule left, before any lake overflowed (step 6) */
  channel: Uint8Array;
  /** each lake's tiles, and the tile its outlet starts on (-1: none, or across the core's edge) */
  lakes: { tiles: number[]; outlet: number }[];
  /** the river tile each widened tile was laid beside; -1 elsewhere */
  wide: Int32Array;
}

function slowDrain(p: DrainInput): Slow {
  const { w, core, elev, ground, land, sea, mark } = p;
  const n = w * p.h;
  const steps = (e: number) => levelSteps(p, e);
  const inCore = (x: number, y: number) =>
    x >= core.x0 && y >= core.y0 && x < core.x1 && y < core.y1;
  const xy = (i: number): [number, number] => [i % w, Math.floor(i / w)];
  const sides = (i: number) => {
    const [x, y] = xy(i);
    const out: number[] = [];
    for (let d = 0; d < 4; d++)
      if (inCore(x + DIR_DX[d], y + DIR_DY[d])) out.push((y + DIR_DY[d]) * w + x + DIR_DX[d]);
    return out;
  };
  const tiles: number[] = [];
  for (let y = core.y0; y < core.y1; y++)
    for (let x = core.x0; x < core.x1; x++) tiles.push(y * w + x);
  const onEdge = (i: number) => {
    const [x, y] = xy(i);
    return x === core.x0 || y === core.y0 || x === core.x1 - 1 || y === core.y1 - 1;
  };

  // 1. the flood: the sea first, in reading order, then always the lowest tile reached, ties to
  // the lower index; ground kept out counts 1000 higher, so it drains last
  const key = (i: number) => (mark[i] & KEEP_OUT ? elev[i] + 1e3 : elev[i]);
  const down = new Int32Array(n).fill(-2);
  const spill = new Float32Array(n);
  const order: number[] = [];
  const reached = new Set<number>();
  for (const i of tiles)
    if (sea[i]) {
      down[i] = -1;
      spill[i] = p.waterLevel;
    } else if (onEdge(i)) {
      down[i] = -1;
      spill[i] = elev[i];
      reached.add(i);
    }
  const visit = (i: number) => {
    order.push(i);
    for (const j of sides(i))
      if (down[j] === -2) {
        down[j] = i;
        spill[j] = Math.max(elev[j], spill[i]);
        reached.add(j);
      }
  };
  for (const i of tiles) if (sea[i]) visit(i);
  while (reached.size) {
    let next = -1;
    for (const t of reached)
      if (next < 0 || key(t) < key(next) || (key(t) === key(next) && t < next)) next = t;
    reached.delete(next);
    visit(next);
  }

  // 2. lakes: low basins and the ground's own water, with nothing high within LAKE_CLEARANCE
  const high = (i: number) =>
    ground[i] === Terrain.Hill || ground[i] === Terrain.Rock || steps(elev[i]) >= 2;
  const clear = (i: number) => {
    const [x, y] = xy(i);
    for (let dy = -LAKE_CLEARANCE; dy <= LAKE_CLEARANCE; dy++)
      for (let dx = -LAKE_CLEARANCE; dx <= LAKE_CLEARANCE; dx++)
        if (high((y + dy) * w + x + dx)) return false;
    return true;
  };
  const kind = new Uint8Array(n);
  const candidate = new Uint8Array(n);
  for (const i of tiles) {
    if (sea[i]) {
      kind[i] = WaterKind.Sea;
      continue;
    }
    const wet = ground[i] === Terrain.Water;
    if (wet) kind[i] = WaterKind.Dry;
    if (mark[i] & DRY) continue;
    const basin =
      !(mark[i] & KEEP_OUT) &&
      spill[i] > elev[i] &&
      steps(spill[i]) - steps(elev[i]) > LAKE_DEPTH &&
      Math.floor(steps(spill[i])) <= 0;
    if ((wet || basin) && clear(i)) candidate[i] = 1;
  }
  const lakeOf = new Int32Array(n).fill(-1);
  const lakes: Slow['lakes'] = [];
  for (const s of tiles) {
    if (!candidate[s] || lakeOf[s] !== -1) continue;
    const group = [s];
    lakeOf[s] = -2;
    for (let k = 0; k < group.length; k++)
      for (const j of sides(group[k]))
        if (candidate[j] && lakeOf[j] === -1) {
          lakeOf[j] = -2;
          group.push(j);
        }
    if (group.length < LAKE_TILES) continue;
    for (const i of group) {
      kind[i] = WaterKind.Lake;
      lakeOf[i] = lakes.length;
    }
    lakes.push({ tiles: group.sort((a, b) => a - b), outlet: -1 });
  }

  // 3. rain, gathered down the flood from its last tile to its first
  const acc = new Float32Array(n);
  for (const i of tiles)
    acc[i] = mark[i] & KEEP_OUT ? 0 : 1 + RAIN_PER_STEP * Math.max(0, steps(elev[i]) - RAIN_FROM);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (down[i] >= 0) acc[down[i]] += acc[i];
  }

  // 4. rivers where enough rain gathered on land, more from level step 2 up, and every river runs
  // on down the flood until it meets water or the core's edge
  const isLand = (i: number) => kind[i] === WaterKind.Land || kind[i] === WaterKind.Dry;
  const rises = (i: number) =>
    !(mark[i] & KEEP_OUT) && acc[i] >= (steps(elev[i]) >= 2 ? HIGH_RIVER_FLOW : RIVER_FLOW);
  for (const i of tiles) if (isLand(i) && rises(i)) kind[i] = WaterKind.River;
  const runDown = (from: number) => {
    for (let i = from; i >= 0 && isLand(i); i = down[i]) kind[i] = WaterKind.River;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const i of tiles)
      if (kind[i] === WaterKind.River && down[i] >= 0 && isLand(down[i])) {
        runDown(down[i]);
        grew = true;
      }
  }
  // 5. one channel: a river that is not the fullest inflow of the river it joins and gathers less
  // than SIDE_STREAM_FLOW is land again, and so is the river above it, downstream first
  const fullest = (into: number) => {
    let m = -1;
    for (const i of tiles)
      if (down[i] === into && (m < 0 || acc[i] > acc[m] || (acc[i] === acc[m] && i < m))) m = i;
    return m;
  };
  const pruned = new Uint8Array(n);
  for (const c of order) {
    const d = down[c];
    if (kind[c] !== WaterKind.River || d < 0) continue;
    const side = kind[d] === WaterKind.River && fullest(d) !== c && acc[c] < SIDE_STREAM_FLOW;
    if (pruned[d] || side) {
      pruned[c] = 1;
      kind[c] = ground[c] === Terrain.Water ? WaterKind.Dry : WaterKind.Land;
    }
  }
  // and the way a removed river ran on below it: a river tile that gathered too little to rise
  // and has no river running into it is land again, until there is none
  for (let gone = true; gone;) {
    gone = false;
    for (const i of tiles)
      if (
        kind[i] === WaterKind.River &&
        !rises(i) &&
        !sides(i).some((j) => down[j] === i && kind[j] === WaterKind.River)
      ) {
        pruned[i] = 1;
        kind[i] = ground[i] === Terrain.Water ? WaterKind.Dry : WaterKind.Land;
        gone = true;
      }
  }
  const channel = kind.map((k) => (k === WaterKind.River ? 1 : 0));
  // 6. outlets: each lake overflows from its fullest tile that drains out of it, and the way from
  // there runs on down the flood until it meets water or the core's edge
  const lakeExits: number[] = [];
  lakes.forEach((lake, l) => {
    let best = -1;
    for (const t of lake.tiles) {
      if (down[t] >= 0 && lakeOf[down[t]] === l) continue;
      if (best < 0 || acc[t] > acc[best] || (acc[t] === acc[best] && t < best)) best = t;
    }
    if (best < 0) return;
    if (down[best] < 0) lakeExits.push(best);
    else {
      lake.outlet = down[best];
      runDown(down[best]);
    }
  });

  // 7. width: a full river below the hills takes the tile across its way, south of a river along
  // x and east of one along y
  const raised = (i: number) => land[i] === Terrain.Hill && !(mark[i] & LOW);
  const wide = new Int32Array(n).fill(-1);
  for (const i of tiles) {
    if (kind[i] !== WaterKind.River || acc[i] < WIDE_FLOW || raised(i)) continue;
    const [x, y] = xy(i);
    const d = down[i];
    const alongX = d >= 0 ? Math.abs(d - i) === 1 : x === core.x0 || x === core.x1 - 1;
    const [sx, sy] = alongX ? [x, y + 1] : [x + 1, y];
    const s = sy * w + sx;
    if (!inCore(sx, sy) || !isLand(s) || raised(s) || mark[s] & KEEP_OUT) continue;
    kind[s] = WaterKind.River;
    wide[s] = i;
  }

  // 8. levels: the greatest every rule allows. A river on hill ground at most 2, any other water 0;
  // at most one over each side (0 beside the core's edge), 1 in a 2 x 2 block of river, and never
  // above the river it receives from.
  const wet = (i: number) => !isLand(i);
  const rivers = tiles.filter((i) => kind[i] === WaterKind.River);
  const into = new Int32Array(n).fill(-1);
  for (const i of rivers) {
    const m = wide[i];
    if (m < 0) into[i] = down[i];
    else {
      const next = down[m] >= 0 ? down[m] + (i - m) : -1;
      into[i] = next >= 0 && inCore(...xy(next)) && wet(next) ? next : m;
    }
  }
  const river = (x: number, y: number) => inCore(x, y) && kind[y * w + x] === WaterKind.River;
  const inBlock = (i: number) => {
    const [x, y] = xy(i);
    return [-1, 1].some((dx) =>
      [-1, 1].some((dy) => river(x + dx, y) && river(x, y + dy) && river(x + dx, y + dy)),
    );
  };
  const surface = new Uint8Array(n);
  for (const i of rivers) if (raised(i)) surface[i] = 2;
  const target = (i: number) =>
    wet(i) ? surface[i] : land[i] === Terrain.Hill ? 2 : land[i] === Terrain.Mountain ? 4 : 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const i of rivers) {
      const [x, y] = xy(i);
      let v = surface[i];
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d];
        const ny = y + DIR_DY[d];
        v = inCore(nx, ny) ? Math.min(v, target(ny * w + nx) + 1) : 0;
      }
      if (inBlock(i)) v = Math.min(v, 1);
      for (const j of rivers) if (into[j] === i) v = Math.min(v, surface[j]);
      if (v !== surface[i]) {
        surface[i] = v;
        changed = true;
      }
    }
  }

  // flow, side and where water leaves the core
  const rain = (i: number) => Math.min(FLOW_CAP, Math.max(1, Math.round(acc[i])));
  const outward = (i: number) => {
    const [x, y] = xy(i);
    return (x === core.x0 ? Dir.W : x === core.x1 - 1 ? Dir.E : y === core.y0 ? Dir.N : Dir.S) + 1;
  };
  const flow = new Uint16Array(n);
  const dir = new Uint8Array(n);
  const exits = lakeExits.map((i) => ({ tile: i, dir: outward(i), flow: rain(i) }));
  for (const i of rivers) {
    flow[i] = rain(wide[i] >= 0 ? wide[i] : i);
    const j = into[i];
    if (j < 0) {
      dir[i] = outward(i);
      exits.push({ tile: i, dir: dir[i], flow: flow[i] });
    } else dir[i] = (j === i - w ? Dir.N : j === i + 1 ? Dir.E : j === i + w ? Dir.S : Dir.W) + 1;
  }
  exits.sort((a, b) => a.tile - b.tile);
  return { kind, surface, flow, dir, exits, down, spill, acc, pruned, channel, lakes, wide };
}

/**
 * A plane for drain, by the numbers that shape it, so a failing one can shrink: a tilted bowl with
 * position-fixed noise, its ground read off its height by the sliders, then ponds and hills laid
 * anywhere, and the marks mapgen gives the start.
 */
interface PlaneCase {
  /** the seed of its per-tile noise and scatter */
  seed: number;
  /** core tiles a side; the plane holds LAKE_CLEARANCE more on every side */
  size: number;
  /**
   * where the plane lies on the ground the numbers describe, and the middle of that ground (the
   * bowl's centre, the valley's line, the mirror), so a smaller plane is a part of a larger one
   */
  ox: number;
  oy: number;
  centre: number;
  /** the LOW_LAND sliders instead of the defaults */
  low: boolean;
  base: number;
  tiltX: number;
  tiltY: number;
  bowl: number;
  /** a valley's slope up from its floor, a line through the middle along x or y */
  valley: number;
  valleyAlongX: boolean;
  noise: number;
  /** elevation rounded to steps of this, so the flood meets ties; 0 for none */
  quant: number;
  /** the plane mirrored across its middle column, so inflows from either side tie */
  mirror: boolean;
  /** water below the water line is the sea, not the ground's own */
  seaSide: boolean;
  /** share of tiles that are a pond of the ground's own water, and that are Hill (1: all) */
  ponds: number;
  hills: number;
  /** a disc of KEEP_OUT | LOW, its centre and radius in core tiles; radius 0 for none */
  keep: [number, number, number];
  /** share of tiles marked DRY, and LOW */
  dry: number;
  lowMarks: number;
}

const DEFAULT_SCALE = { waterLevel: 0.36, hillLevel: 0.64, rockLevel: 0.76 };
const LOW_SCALE = { waterLevel: 0.3, hillLevel: 0.58, rockLevel: 0.7 };

const genPlane = (rng: Rng): PlaneCase => {
  const size = rng.int(3, 20);
  return {
    seed: rng.int(0, 2 ** 31 - 1),
    size,
    ox: 0,
    oy: 0,
    centre: (size - 1) / 2 + LAKE_CLEARANCE,
    low: rng.chance(0.5),
    base: rng.range(0.25, 0.85),
    tiltX: rng.chance(0.3) ? 0 : rng.range(-0.02, 0.02),
    tiltY: rng.chance(0.3) ? 0 : rng.range(-0.02, 0.02),
    bowl: rng.chance(0.3) ? 0 : rng.range(-0.002, 0.004),
    valley: rng.chance(0.5) ? 0 : rng.range(0, 0.03),
    valleyAlongX: rng.chance(0.5),
    noise: rng.chance(0.2) ? 0 : rng.range(0, 0.06),
    quant: rng.chance(0.4) ? rng.pick([0.005, 0.01, 0.02]) : 0,
    mirror: rng.chance(0.25),
    seaSide: rng.chance(0.4),
    ponds: rng.chance(0.3) ? rng.range(0, 0.2) : 0,
    hills: rng.chance(0.3) ? (rng.chance(0.4) ? 1 : rng.range(0, 0.3)) : 0,
    keep: rng.chance(0.3) ? [rng.int(0, 19), rng.int(0, 19), rng.int(1, 6)] : [0, 0, 0],
    dry: rng.chance(0.2) ? rng.range(0, 0.3) : 0,
    lowMarks: rng.chance(0.2) ? rng.range(0, 0.5) : 0,
  };
};

/** Simpler planes first: smaller, then without each feature. */
function* shrinkPlane(c: PlaneCase): Iterable<PlaneCase> {
  // a part of the plane: cut from its far sides, its near sides or both
  for (const size of shrinkInt(c.size, 3)) {
    const k = c.size - size;
    yield { ...c, size };
    yield { ...c, size, ox: c.ox + k };
    yield { ...c, size, oy: c.oy + k };
    yield { ...c, size, ox: c.ox + k, oy: c.oy + k };
  }
  for (const k of [
    'noise',
    'ponds',
    'hills',
    'dry',
    'lowMarks',
    'quant',
    'bowl',
    'valley',
  ] as const)
    if (c[k]) yield { ...c, [k]: 0 };
  if (c.tiltX) yield { ...c, tiltX: 0 };
  if (c.tiltY) yield { ...c, tiltY: 0 };
  if (c.keep[2]) yield { ...c, keep: [0, 0, 0] };
  if (c.seaSide) yield { ...c, seaSide: false };
  if (c.mirror) yield { ...c, mirror: false };
  if (c.low) yield { ...c, low: false };
}

function planeInput(c: PlaneCase): DrainInput {
  const r = LAKE_CLEARANCE;
  const W = c.size + 2 * r;
  const n = W * W;
  const scale = c.low ? LOW_SCALE : DEFAULT_SCALE;
  const p: DrainInput = {
    ...scale,
    w: W,
    h: W,
    core: { x0: r, y0: r, x1: r + c.size, y1: r + c.size },
    elev: new Float32Array(n),
    ground: new Uint8Array(n),
    land: new Uint8Array(n),
    sea: new Uint8Array(n),
    mark: new Uint8Array(n),
  };
  const cx = c.centre;
  // per-tile draws by position (mirrored across the middle column if the case says)
  const draw = (x: number, y: number, k: number) =>
    hash2(c.mirror ? cx - Math.abs(x - cx) : x, y, c.seed + k);
  for (let py = 0; py < W; py++)
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      // the plane's tile on the ground the numbers describe
      const x = px + c.ox;
      const y = py + c.oy;
      let e =
        c.base +
        c.tiltX * (c.mirror ? Math.abs(x - cx) : x) +
        c.tiltY * y +
        c.bowl * ((x - cx) ** 2 + (y - cx) ** 2) +
        c.valley * Math.abs((c.valleyAlongX ? y : x) - cx) +
        c.noise * (2 * draw(x, y, 1) - 1);
      if (c.quant) e = Math.round(e / c.quant) * c.quant;
      p.elev[i] = Math.max(0, Math.min(1, e));
      const t =
        e < scale.waterLevel
          ? Terrain.Water
          : e > scale.rockLevel
            ? Terrain.Rock
            : e > scale.hillLevel
              ? Terrain.Hill
              : draw(x, y, 2) < 0.3
                ? Terrain.Forest
                : Terrain.Grass;
      p.ground[i] = t;
      if (t === Terrain.Water && c.seaSide) p.sea[i] = 1;
      else if (draw(x, y, 3) < c.ponds) p.ground[i] = Terrain.Water;
      else if (draw(x, y, 4) < c.hills) p.ground[i] = Terrain.Hill;
      // what a tile of water would be dry: sand at its shore, or the hill it lies in
      p.land[i] =
        p.ground[i] !== Terrain.Water
          ? p.ground[i]
          : draw(x, y, 5) < 0.3
            ? Terrain.Hill
            : Terrain.Sand;
      const [kx, ky, kr] = c.keep;
      if ((x - r - kx) ** 2 + (y - r - ky) ** 2 < kr * kr) p.mark[i] |= KEEP_OUT | LOW;
      if (draw(x, y, 6) < c.dry) p.mark[i] |= DRY;
      if (draw(x, y, 7) < c.lowMarks) p.mark[i] |= LOW;
    }
  return p;
}

/**
 * Where the drainage `d` of `p` breaks "a river rises where enough rain gathered and ends in
 * water": the first river tile in the core whose course runs onto land, or else the first that
 * gathered less rain than a river needs at its height (any, kept out), with no river's course and
 * no lake's flood way running into it. A tile laid beside a full river (step 7) is left out.
 * Undefined where there is none. `s` gives the flood and the rain, which no rule here changes.
 */
function riverWithoutSource(
  p: DrainInput,
  d: ReturnType<typeof drain>,
  s: Slow,
): string | undefined {
  const { w, core } = p;
  const at = (i: number) => `(${i % w}, ${Math.floor(i / w)})`;
  const fed = new Uint8Array(d.kind.length);
  for (let i = 0; i < d.kind.length; i++) {
    if (d.kind[i] === WaterKind.Lake && s.down[i] >= 0) fed[s.down[i]] = 1;
    if (d.kind[i] !== WaterKind.River) continue;
    const x = (i % w) + DIR_DX[d.dir[i] - 1];
    const y = Math.floor(i / w) + DIR_DY[d.dir[i] - 1];
    if (x < core.x0 || y < core.y0 || x >= core.x1 || y >= core.y1) continue;
    const j = y * w + x;
    const k = d.kind[j];
    if (k !== WaterKind.River && k !== WaterKind.Lake && k !== WaterKind.Sea)
      return `the river at ${at(i)} ends on land at ${at(j)}`;
    fed[j] = 1;
  }
  for (let i = 0; i < d.kind.length; i++) {
    if (d.kind[i] !== WaterKind.River || s.wide[i] >= 0 || fed[i]) continue;
    const steps = levelSteps(p, p.elev[i]);
    const need = steps >= 2 ? HIGH_RIVER_FLOW : RIVER_FLOW;
    if (!(p.mark[i] & KEEP_OUT) && s.acc[i] >= need) continue;
    return (
      `a river rises at ${at(i)} with ${s.acc[i].toFixed(1)} tiles of rain at level step ` +
      `${steps.toFixed(2)}${p.mark[i] & KEEP_OUT ? ', kept out' : ''}, where it needs ${need}, ` +
      'and nothing runs into it'
    );
  }
  return undefined;
}

/**
 * Where the drainage `d` of `p` joins a side stream below SIDE_STREAM_FLOW to a river: the first
 * river tile that runs into a river tile whose fullest inflow (of any kind) is another, gathering
 * less than SIDE_STREAM_FLOW, and is no lake's outlet. Else how many river tiles join a river as
 * a side stream. `s` gives the flood, the rain and the lakes' outlets.
 */
function sideStreamJoins(p: DrainInput, d: ReturnType<typeof drain>, s: Slow): number | string {
  const n = d.kind.length;
  // a lake's outlet runs down the flood until it meets a river or other water
  const outlet = new Uint8Array(n);
  for (const l of s.lakes)
    for (let i = l.outlet; i >= 0 && d.kind[i] === WaterKind.River && !s.channel[i];) {
      outlet[i] = 1;
      i = s.down[i];
    }
  let joins = 0;
  for (let i = 0; i < n; i++) {
    const j = s.down[i];
    if (d.kind[i] !== WaterKind.River || s.wide[i] >= 0 || j < 0) continue;
    if (d.kind[j] !== WaterKind.River) continue;
    let main = -1;
    for (let k = 0; k < n; k++)
      if (s.down[k] === j && (main < 0 || s.acc[k] > s.acc[main])) main = k;
    if (main === i) continue;
    joins++;
    if (s.acc[i] < SIDE_STREAM_FLOW && !outlet[i])
      return (
        `a side stream of ${s.acc[i].toFixed(1)} at (${i % p.w}, ${Math.floor(i / p.w)}) ` +
        `joins the river at (${j % p.w}, ${Math.floor(j / p.w)}), ` +
        `whose fullest inflow gathers ${s.acc[main].toFixed(1)}`
      );
  }
  return joins;
}

/** Throws at the first tile where `a` and `b` differ, naming it on the plane `w` tiles wide. */
function samePlane(name: string, a: ArrayLike<number>, b: ArrayLike<number>, w: number) {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i])
      throw new Error(
        `${name} ${a[i]} from drain, ${b[i]} slow, at (${i % w}, ${Math.floor(i / w)})`,
      );
}

/**
 * The highest ground on the lowest way from each core tile out of the core (to the sea, at the
 * water line, or off an edge tile), by relaxing every tile until none changes: no flood order.
 */
function lowestRim(p: DrainInput): Float64Array {
  const { w, core, elev, sea } = p;
  const rim = new Float64Array(w * p.h).fill(Infinity);
  for (let y = core.y0; y < core.y1; y++)
    for (let x = core.x0; x < core.x1; x++) {
      const i = y * w + x;
      if (sea[i]) rim[i] = Math.fround(p.waterLevel);
      else if (x === core.x0 || y === core.y0 || x === core.x1 - 1 || y === core.y1 - 1)
        rim[i] = elev[i];
    }
  for (let changed = true; changed;) {
    changed = false;
    for (let y = core.y0; y < core.y1; y++)
      for (let x = core.x0; x < core.x1; x++) {
        const i = y * w + x;
        let best = rim[i];
        for (let d = 0; d < 4; d++) {
          const nx = x + DIR_DX[d];
          const ny = y + DIR_DY[d];
          if (nx < core.x0 || ny < core.y0 || nx >= core.x1 || ny >= core.y1) continue;
          best = Math.min(best, Math.max(elev[i], rim[ny * w + nx]));
        }
        if (best < rim[i]) {
          rim[i] = best;
          changed = true;
        }
      }
  }
  return rim;
}

describe('the drainage, against a slow one', () => {
  const PLANE_SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  it('draws planes of every kind the property claims', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = PLANE_SEEDS.map((s) => genPlane(new Rng(s)));
    expect(cases.some((c) => c.size <= 4)).toBe(true);
    expect(cases.some((c) => c.size >= 16)).toBe(true);
    for (const k of ['low', 'seaSide'] as const) {
      expect(cases.some((c) => c[k])).toBe(true);
      expect(cases.some((c) => !c[k])).toBe(true);
    }
    for (const k of [
      'quant',
      'ponds',
      'hills',
      'dry',
      'lowMarks',
      'noise',
      'bowl',
      'valley',
    ] as const)
      expect(cases.some((c) => c[k] !== 0)).toBe(true);
    expect(cases.some((c) => c.keep[2] > 0)).toBe(true);
    expect(cases.some((c) => c.mirror)).toBe(true);
    expect(cases.some((c) => c.hills === 1)).toBe(true);
  });

  // 200 planes up to 24 tiles a side, each drained twice, the slow way quadratic: under 1 s alone
  it('gives the water of a slow drainage, tile for tile, on any small plane', () => {
    const seen = {
      river: 0,
      lake: 0,
      dry: 0,
      sea: 0,
      pruned: 0,
      outlet: 0,
      lakeExit: 0,
      wide: 0,
      raised: 0,
      drop: 0,
      exit: 0,
      kept: 0,
      tie: 0,
      /** raised river tiles in a 2 x 2 block of river */
      block: 0,
    };
    forAll(
      genPlane,
      (c) => {
        const p = planeInput(c);
        const d = drain(p);
        const s = slowDrain(p);
        samePlane('kind', d.kind, s.kind, p.w);
        samePlane('water level', d.surface, s.surface, p.w);
        samePlane('flow', d.flow, s.flow, p.w);
        samePlane('side', d.dir, s.dir, p.w);
        expect(d.exits).toEqual(s.exits);
        expect(d.pond).toBe(false);
        // what the case met
        const count = (k: WaterKind) => d.kind.filter((v) => v === k).length;
        seen.river += count(WaterKind.River);
        seen.lake += count(WaterKind.Lake);
        seen.dry += count(WaterKind.Dry);
        seen.sea += count(WaterKind.Sea);
        seen.pruned += s.pruned.filter((v, i) => v && d.kind[i] !== WaterKind.River).length;
        seen.outlet += s.lakes.filter((l) => l.outlet >= 0).length;
        seen.lakeExit += d.exits.filter((e) => d.kind[e.tile] === WaterKind.Lake).length;
        seen.wide += s.wide.filter((m) => m >= 0).length;
        seen.raised += d.surface.filter((v) => v === 2).length;
        seen.exit += d.exits.length;
        seen.kept +=
          p.mark.some((m) => m & KEEP_OUT) && d.kind.some((k) => k === WaterKind.River) ? 1 : 0;
        if (c.quant) seen.tie++;
        for (let i = 0; i < d.kind.length; i++) {
          if (d.kind[i] !== WaterKind.River || p.land[i] !== Terrain.Hill || p.mark[i] & LOW)
            continue;
          const x = i % p.w;
          const y = Math.floor(i / p.w);
          const at = (dx: number, dy: number) =>
            d.kind[(y + dy) * p.w + x + dx] === WaterKind.River;
          if ([-1, 1].some((dx) => [-1, 1].some((dy) => at(dx, 0) && at(0, dy) && at(dx, dy))))
            seen.block++;
        }
        for (let i = 0; i < d.kind.length; i++) {
          if (d.kind[i] !== WaterKind.River || s.wide[i] >= 0 || s.down[i] < 0) continue;
          if (d.kind[s.down[i]] === WaterKind.River && d.surface[s.down[i]] < d.surface[i])
            seen.drop++;
        }
      },
      {
        seeds: PLANE_SEEDS,
        shrink: shrinkPlane,
        shrinkBudget: 2000,
      },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  }, 30_000);

  // the same 200 planes, drained quickly and slowly and relaxed to their lowest rims: about 0.5 s
  it('runs every river over the lowest rim out of the land it drains', () => {
    // "A river follows the slope": along a river the highest ground still to cross on the lowest
    // way out never rises. Ground kept out drains last on purpose, so those planes are left out.
    let rivers = 0;
    let over = 0;
    forAll(
      genPlane,
      (c) => {
        const p = planeInput(c);
        if (p.mark.some((m) => m & KEEP_OUT)) return;
        const d = drain(p);
        const rim = lowestRim(p);
        const s = slowDrain(p);
        // the slow flood finds the lowest rim of every tile
        for (let i = 0; i < rim.length; i++)
          if (rim[i] !== Infinity && rim[i] !== s.spill[i])
            throw new Error(`rim ${rim[i]}, flood ${s.spill[i]}, at tile ${i}`);
        for (let i = 0; i < d.kind.length; i++) {
          if (d.kind[i] !== WaterKind.River || s.wide[i] >= 0) continue;
          const x = (i % p.w) + DIR_DX[d.dir[i] - 1];
          const y = Math.floor(i / p.w) + DIR_DY[d.dir[i] - 1];
          const { core } = p;
          if (x < core.x0 || y < core.y0 || x >= core.x1 || y >= core.y1) continue;
          const j = y * p.w + x;
          rivers++;
          if (rim[j] > rim[i])
            throw new Error(`a river runs from rim ${rim[i]} up to ${rim[j]} at tile ${i}`);
          // over the rim: the river climbs ground on its way out of a basin
          if (p.elev[j] > p.elev[i]) over++;
        }
      },
      { seeds: PLANE_SEEDS, shrink: shrinkPlane, shrinkBudget: 2000 },
    );
    expect(rivers).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(0);
  }, 30_000);

  /**
   * A core of `cw` x `ch` tiles (in a plane LAKE_CLEARANCE wider on every side) on `land`, whose
   * height is `e` of core tiles; the core's edge stands 0.1 higher, but its middle tile on top,
   * where the land drains out. `keep` marks tiles of the core KEEP_OUT.
   */
  function corePlane(
    cw: number,
    ch: number,
    e: (x: number, y: number) => number,
    land = Terrain.Grass,
    keep: (x: number, y: number) => boolean = () => false,
  ) {
    const r = LAKE_CLEARANCE;
    const w = cw + 2 * r;
    const h = ch + 2 * r;
    const p: DrainInput = {
      ...DEFAULT_SCALE,
      w,
      h,
      core: { x0: r, y0: r, x1: r + cw, y1: r + ch },
      elev: new Float32Array(w * h).fill(0.6),
      ground: new Uint8Array(w * h).fill(land),
      land: new Uint8Array(w * h).fill(land),
      sea: new Uint8Array(w * h),
      mark: new Uint8Array(w * h),
    };
    const mid = Math.floor(cw / 2);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const i = (y + r) * w + x + r;
        const edge = x === 0 || y === 0 || x === cw - 1 || y === ch - 1;
        p.elev[i] = e(x, y) + (edge && !(x === mid && y === 0) ? 0.1 : 0);
        if (keep(x, y)) p.mark[i] = KEEP_OUT;
      }
    const at = (x: number, y: number) => (y + r) * w + x + r;
    return { p, at, mid };
  }

  it('breaks a tie between two inflows toward the lower tile index', () => {
    // two halves mirrored across a kept-out middle column, each gathering 70 tiles of rain into a
    // stream that joins the other at the middle tile of row 1: the same rain, so the west stream,
    // the lower index, is the main inflow and the east one, below SIDE_STREAM_FLOW, goes
    const { p, at, mid } = corePlane(
      13,
      16,
      (x, y) => 0.4 + 0.002 * Math.abs(x - 6) + 0.001 * y,
      Terrain.Grass,
      (x, y) => x === 6 && y >= 2,
    );
    const d = drain(p);
    const s = slowDrain(p);
    expect(s.acc[at(mid - 1, 1)]).toBe(70);
    expect(s.acc[at(mid + 1, 1)]).toBe(70);
    for (let y = 1; y <= 3; y++) {
      expect(d.kind[at(mid - 1, y)], `west, row ${y}`).toBe(WaterKind.River);
      expect(d.kind[at(mid + 1, y)], `east, row ${y}`).toBe(WaterKind.Land);
    }
    expect(d.kind[at(mid, 1)]).toBe(WaterKind.River);
    expect(d.dir[at(mid - 1, 1)]).toBe(Dir.E + 1);
  });

  it('stands a river in a 2 x 2 block at level 1 on hill ground, and alone at level 2', () => {
    // two halves draining into the two middle columns, each gathering more than SIDE_STREAM_FLOW,
    // run up side by side to row 1: a channel two tiles wide on hill ground, a block at every row
    const ridge = (x: number) => (x <= 6 ? 6 - x : x - 7);
    const { p, at } = corePlane(14, 22, (x, y) => 0.4 + 0.002 * ridge(x) + 0.001 * y, Terrain.Hill);
    const d = drain(p);
    let blocks = 0;
    for (let y = 2; y <= 9; y++)
      for (const x of [6, 7]) {
        expect(d.kind[at(x, y)], `(${x}, ${y})`).toBe(WaterKind.River);
        expect(d.surface[at(x, y)], `(${x}, ${y})`).toBe(1);
        blocks++;
      }
    expect(blocks).toBeGreaterThan(0);
    // the same ground with one half kept out: one channel, at level 2 away from its ends
    const one = corePlane(
      14,
      22,
      (x, y) => 0.4 + 0.002 * ridge(x) + 0.001 * y,
      Terrain.Hill,
      (x) => x >= 7,
    );
    const single = drain(one.p);
    for (let y = 3; y <= 9; y++) {
      expect(single.kind[one.at(6, y)]).toBe(WaterKind.River);
      expect(single.surface[one.at(6, y)], `(6, ${y})`).toBe(2);
    }
  });

  it('removes a side stream below SIDE_STREAM_FLOW that crosses a rim on high ground', () => {
    // Two streams meet at the middle tile of row 1, either side of a kept-out ridge: the east one
    // gathers 84 tiles of rain, the west one 77 (its bottom row is kept out too), so the west one
    // is the side stream and, below SIDE_STREAM_FLOW, goes with every river tile above it. Its
    // last tile is a rim at level step 2.1, where a river needs HIGH_RIVER_FLOW; above the rim,
    // below step 2, RIVER_FLOW is enough.
    const edge = (x: number, y: number) => x === 0 || y === 0 || x === 16 || y === 13;
    const plane = (rim: number) =>
      corePlane(
        17,
        14,
        (x, y) =>
          x === 8 && y === 0
            ? 0.39
            : edge(x, y)
              ? 0.6
              : x === 8
                ? y === 1
                  ? 0.4
                  : 0.6
                : x === 7 && y === 1
                  ? rim
                  : 0.4 + 0.002 * Math.abs(x - 8) + 0.001 * y,
        Terrain.Grass,
        (x, y) => (x === 8 && y >= 2) || (x < 8 && y === 12),
      );
    // with the rim as low as the land around it the west stream goes, as the rule says
    const low = plane(0.402);
    const without = drain(low.p);
    expect(without.kind[low.at(7, 1)]).toBe(WaterKind.Land);
    expect(without.kind[low.at(7, 2)]).toBe(WaterKind.Land);
    expect(without.kind[low.at(9, 1)]).toBe(WaterKind.River);
    const { p, at, mid } = plane(0.56);
    const s = slowDrain(p);
    expect(levelSteps(p, p.elev[at(mid - 1, 1)])).toBeGreaterThan(2);
    expect(levelSteps(p, p.elev[at(mid - 1, 2)])).toBeLessThan(2);
    for (const [x, y, into, rain] of [
      [mid + 1, 1, at(mid, 1), 84],
      [mid - 1, 1, at(mid, 1), 77],
      [mid - 1, 2, at(mid - 1, 1), 70],
    ]) {
      expect(s.down[at(x, y)], `(${x}, ${y})`).toBe(into);
      expect(s.acc[at(x, y)], `(${x}, ${y})`).toBe(rain);
    }
    const d = drain(p);
    expect(d.kind[at(mid + 1, 1)]).toBe(WaterKind.River);
    expect(d.kind[at(mid, 1)]).toBe(WaterKind.River);
    // the west stream is no river, at the rim or above it
    expect(d.kind[at(mid - 1, 1)], 'the rim').toBe(WaterKind.Land);
    expect(d.kind[at(mid - 1, 2)], 'above the rim').toBe(WaterKind.Land);
  });

  // 2000 planes, each drained once and slowly: about 2 s alone
  it('joins no side stream below SIDE_STREAM_FLOW to a river, but a lake outlet', () => {
    // "One channel, not a braid": a river that is not the fullest inflow of the river it joins
    // and gathers less than SIDE_STREAM_FLOW is removed, and with it the river above it. Only a
    // lake's outlet runs on whatever it gathers.
    let joins = 0;
    forAll(
      genPlane,
      (c) => {
        const p = planeInput(c);
        const d = drain(p);
        const joined = sideStreamJoins(p, d, slowDrain(p));
        if (typeof joined === 'string') throw new Error(joined);
        joins += joined;
      },
      {
        seeds: Array.from({ length: 2000 }, (_, i) => i + 1),
        shrink: shrinkPlane,
        shrinkBudget: 2000,
      },
    );
    expect(joins).toBeGreaterThan(0);
  }, 40_000);

  // 2000 planes, each drained once and slowly: about 2 s alone
  it('raises every river where enough rain gathered or water runs in, and ends it in water', () => {
    // "Rivers thinner on slopes" and "no river ends on dry land": a river tile gathered RIVER_FLOW,
    // HIGH_RIVER_FLOW from level step 2 up, or a river or a lake runs into it; and its course runs
    // into water or off the core. The slow drainage follows the same steps, so this holds the steps
    // themselves to the rules.
    let sources = 0;
    let high = 0;
    forAll(
      genPlane,
      (c) => {
        const p = planeInput(c);
        const d = drain(p);
        const s = slowDrain(p);
        const broken = riverWithoutSource(p, d, s);
        if (broken) throw new Error(broken);
        // what the case met: rivers that rise, no river running into them
        const into = new Uint8Array(d.kind.length);
        for (let k = 0; k < d.kind.length; k++)
          if (d.kind[k] === WaterKind.River && s.wide[k] < 0 && s.down[k] >= 0) into[s.down[k]] = 1;
        for (let i = 0; i < d.kind.length; i++) {
          if (d.kind[i] !== WaterKind.River || s.wide[i] >= 0 || into[i]) continue;
          sources++;
          if (levelSteps(p, p.elev[i]) >= 2) high++;
        }
      },
      {
        seeds: Array.from({ length: 2000 }, (_, i) => i + 1),
        shrink: shrinkPlane,
        shrinkBudget: 2000,
      },
    );
    // rivers rose, on high ground too
    expect(sources).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
  }, 40_000);

  it('leaves no river on a rim a removed side stream ran on over', () => {
    // A stream on low ground gathers 62 tiles of rain, a river below level step 2, and runs on over
    // a rim at step 2.14 to the core's edge. Beside it a slope at step 2 and more gathers 63 into
    // the rim, no river there; together 126, less than HIGH_RIVER_FLOW, so the rim is no river of
    // its own. The stream is not the rim's fullest inflow and gathers less than SIDE_STREAM_FLOW;
    // whether it goes or stays, no river may rise on the rim from nothing.
    const edge = (x: number, y: number) => x === 0 || y === 0 || x === 16 || y === 13;
    const { p, at, mid } = corePlane(
      17,
      14,
      (x, y) =>
        x === 8 && y === 0
          ? 0.39
          : edge(x, y)
            ? 0.6
            : x === 8
              ? y === 1
                ? 0.56
                : 0.6
              : x < 8
                ? 0.4 + 0.002 * (8 - x) + 0.001 * y
                : 0.57 + 0.002 * (x - 8) + 0.001 * y,
      Terrain.Grass,
      // the ridge between the halves, the rows below 10, and one more tile in the west
      (x, y) => (x === 8 && y >= 2) || (!edge(x, y) && y >= 10) || (x === 1 && y === 9),
    );
    const s = slowDrain(p);
    const rim = at(mid, 1);
    expect(levelSteps(p, p.elev[rim])).toBeGreaterThan(2);
    expect(levelSteps(p, p.elev[at(mid - 1, 1)])).toBeLessThan(2);
    expect(levelSteps(p, p.elev[at(mid + 1, 1)])).toBeGreaterThan(2);
    for (const [x, y, into, rain] of [
      [mid - 1, 1, rim, 62],
      [mid + 1, 1, rim, 63],
      [mid, 1, at(mid, 0), 126],
    ]) {
      expect(s.down[at(x, y)], `(${x}, ${y})`).toBe(into);
      expect(s.acc[at(x, y)], `(${x}, ${y})`).toBe(rain);
    }
    const d = drain(p);
    // the edge tile below the rim gathers enough below step 2: a river either way
    expect(d.kind[at(mid, 0)]).toBe(WaterKind.River);
    expect(riverWithoutSource(p, d, s)).toBeUndefined();
  });
});

// The one-channel rule against what the issue says it removes, read off the flood and the rain
// rather than drain's steps. Before the rule a river runs on every land tile where one rises and on
// every land tile a river runs on over to water (the issue's "no river ends on dry land"). The rule
// takes a river that rises from its own rain away only as a side stream (not the fullest inflow of
// the river it joins, under SIDE_STREAM_FLOW) or above one. The way a removed stream ran on goes
// with it, as far as no other river runs in and no river rises of its own, and riverWithoutSource
// holds what is left to that. Such a run-on goes only where a stream runs into it beside a fuller
// dry slope, on ground where no river rises of its own (high ground short of HIGH_RIVER_FLOW, or
// kept out); random planes almost never draw that, so the rule is also checked on mazes, whose
// corridors gather any rain.

/** The rivers before the one-channel rule, read off the flood and the rain of `s` alone. */
interface Before {
  /** the core's tiles, in index order */
  tiles: number[];
  /** whether a river rises on tile `i`: the rain its height needs, and not kept out */
  rises: (i: number) => boolean;
  /** whether tile `i` is a lake or the sea */
  water: (i: number) => boolean;
  /** 1 on every land tile where a river rises or a river runs on over */
  river: Uint8Array;
  /** each tile's fullest inflow of any kind, ties to the lower index; -1 for none */
  fullest: Int32Array;
  /**
   * whether a side stream lies on the way down from river tile `i` while a river runs there: a
   * tile that is not the fullest inflow of the river it joins and gathers less than
   * SIDE_STREAM_FLOW, which the rule takes away with every river above it
   */
  side: (i: number) => boolean;
}

function riversBefore(p: DrainInput, d: ReturnType<typeof drain>, s: Slow): Before {
  const { w, core } = p;
  const n = d.kind.length;
  const tiles: number[] = [];
  for (let y = core.y0; y < core.y1; y++)
    for (let x = core.x0; x < core.x1; x++) tiles.push(y * w + x);
  const water = (i: number) => d.kind[i] === WaterKind.Lake || d.kind[i] === WaterKind.Sea;
  const rises = (i: number) =>
    !(p.mark[i] & KEEP_OUT) &&
    s.acc[i] >= (levelSteps(p, p.elev[i]) >= 2 ? HIGH_RIVER_FLOW : RIVER_FLOW);
  const river = new Uint8Array(n);
  for (const i of tiles) if (!water(i) && rises(i)) river[i] = 1;
  for (let grew = true; grew;) {
    grew = false;
    for (const i of tiles) {
      const j = s.down[i];
      if (river[i] && j >= 0 && !water(j) && !river[j]) {
        river[j] = 1;
        grew = true;
      }
    }
  }
  const fullest = new Int32Array(n).fill(-1);
  for (const i of tiles) {
    const j = s.down[i];
    if (j >= 0 && (fullest[j] < 0 || s.acc[i] > s.acc[fullest[j]])) fullest[j] = i;
  }
  const side = (i: number) => {
    for (let c = i; c >= 0 && river[c]; c = s.down[c]) {
      const j = s.down[c];
      if (j >= 0 && river[j] && fullest[j] !== c && s.acc[c] < SIDE_STREAM_FLOW) return true;
    }
    return false;
  };
  return { tiles, rises, water, river, fullest, side };
}

/**
 * Where the drainage `d` of `p` takes away a river the rule keeps: the first core tile where a
 * river rises that is no river, though no side stream lies on its way down while a river runs
 * there before the rule. Undefined where there is none. `s` gives the flood and the rain.
 */
function riverTakenWithoutCause(
  p: DrainInput,
  d: ReturnType<typeof drain>,
  s: Slow,
): string | undefined {
  const at = (i: number) => `(${i % p.w}, ${Math.floor(i / p.w)})`;
  const b = riversBefore(p, d, s);
  for (const i of b.tiles) {
    if (!b.river[i] || !b.rises(i) || d.kind[i] === WaterKind.River || b.side(i)) continue;
    const j = s.down[i];
    const into = j >= 0 && b.water(j) ? (d.kind[j] === WaterKind.Sea ? 'the sea' : 'a lake') : '';
    return (
      `the river rising at ${at(i)} with ${s.acc[i].toFixed(1)} tiles of rain is gone, though no ` +
      `side stream lies on its way down${into ? `; it ran into ${into} at ${at(j)}` : ''}`
    );
  }
  return undefined;
}

/** A maze of corridors that drain as a tree: the numbers that shape it, so a failing one shrinks. */
interface MazeCase {
  seed: number;
  /** maze cells a side: the core is 2 * cells + 1 tiles wide and two more high */
  cells: number;
  low: boolean;
  /** what the tree drains into: off the core's edge, the sea, or a lake of the ground's water */
  mouth: 'edge' | 'sea' | 'lake';
  /** the chance the maze grows on from its newest cell rather than any: long streams, or many */
  wind: number;
  /** the chance a cell's height class differs from that of the cell it drains into */
  flip: number;
  /**
   * where the tree allows, a stream that rises meets a fuller dry slope on ground where no river
   * rises (high, or kept out), some of it the ground's own water; and runs on kept out to where a
   * river of its own runs in, or up to 8 tiles more like it
   */
  plant: boolean;
  /** shares of corridor tiles kept out (no rain, no river rises) and of the ground's own water */
  kept: number;
  ponds: number;
}

const genMaze = (rng: Rng): MazeCase => ({
  seed: rng.int(0, 2 ** 31 - 1),
  cells: rng.int(2, 16),
  low: rng.chance(0.3),
  mouth: rng.pick(['edge', 'sea', 'lake'] as const),
  wind: rng.range(0, 1),
  flip: rng.range(0.05, 0.5),
  plant: rng.chance(0.7),
  kept: rng.chance(0.5) ? rng.range(0, 0.15) : 0,
  ponds: rng.chance(0.4) ? rng.range(0, 0.15) : 0,
});

/** Smaller mazes first, then without each feature. */
function* shrinkMaze(c: MazeCase): Iterable<MazeCase> {
  for (const cells of shrinkInt(c.cells, 2)) yield { ...c, cells };
  if (c.kept) yield { ...c, kept: 0 };
  if (c.ponds) yield { ...c, ponds: 0 };
  if (c.plant) yield { ...c, plant: false };
  if (c.mouth !== 'edge') yield { ...c, mouth: 'edge' };
  if (c.low) yield { ...c, low: false };
}

/** Height classes of a maze's corridor tiles. */
const LOW_TILE = 0;
const HIGH_TILE = 1;
const HILL_TILE = 2;
const KEPT_TILE = 3;

/**
 * The maze's planes, and the tile each corridor tile is cut from (-1 elsewhere). The cells are the
 * core tiles at odd x and odd y from 3, cut out one from another from the middle cell of the top
 * row, which drains down a stem of two tiles and across the core's edge (its mouth). Everything
 * else is wall, kept out and higher than any kept-out corridor tile, so the flood reaches every
 * corridor tile from the tile it was cut from: the drainage is the maze. A tile is low (level step
 * 0.2 to 1.8), high (2 to 3), hill (3 and up, Hill ground) or kept out and low, mostly as the tile
 * below it is. A mouth on land is low, high or kept out; a lake is the mouth and the stem, low
 * ground around it.
 */
function mazeInput(c: MazeCase): { p: DrainInput; from: Int32Array } {
  const rng = new Rng(c.seed);
  const r = LAKE_CLEARANCE;
  const cw = 2 * c.cells + 1;
  const ch = cw + 2;
  const w = cw + 2 * r;
  const h = ch + 2 * r;
  const scale = c.low ? LOW_SCALE : DEFAULT_SCALE;
  const elevAt = (step: number) => {
    const { waterLevel: sea, hillLevel: hill, rockLevel: rock } = scale;
    return step < 3 ? sea + (step * (hill - sea)) / 3 : hill + (step - 3) * (rock - hill);
  };
  const p: DrainInput = {
    ...scale,
    w,
    h,
    core: { x0: r, y0: r, x1: r + cw, y1: r + ch },
    elev: new Float32Array(w * h).fill(elevAt(1.95)),
    ground: new Uint8Array(w * h).fill(Terrain.Grass),
    land: new Uint8Array(w * h).fill(Terrain.Grass),
    sea: new Uint8Array(w * h),
    mark: new Uint8Array(w * h),
  };
  const tile = (x: number, y: number) => (y + r) * w + x + r;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) p.mark[tile(x, y)] = KEEP_OUT;
  // the corridor tiles in the order they are cut, each with the tile it is cut from and its class
  const a0 = Math.floor(c.cells / 2);
  const mx = 2 * a0 + 1;
  const from = new Int32Array(w * h).fill(-1);
  const cls = new Int8Array(w * h);
  const pond = new Uint8Array(w * h);
  const planted = new Uint8Array(w * h);
  const order: number[] = [];
  const cut = (x: number, y: number, to: number, k: number) => {
    const i = tile(x, y);
    from[i] = to;
    cls[i] = k;
    order.push(i);
    return i;
  };
  const cellTile = (cell: number): [number, number] => [
    2 * (cell % c.cells) + 1,
    2 * Math.floor(cell / c.cells) + 3,
  ];
  const k0 = rng.int(LOW_TILE, HILL_TILE);
  for (const y of [1, 2, 3]) cut(mx, y, tile(mx, y - 1), k0);
  const done = new Uint8Array(c.cells * c.cells);
  done[a0] = 1;
  const open = [a0];
  while (open.length) {
    const k = rng.chance(c.wind) ? open.length - 1 : rng.int(0, open.length - 1);
    const cell = open[k];
    const [bx, by] = cellTile(cell);
    const free = [
      [bx, by - 2],
      [bx + 2, by],
      [bx, by + 2],
      [bx - 2, by],
    ].filter(
      ([x, y]) =>
        x > 0 && y > 2 && x < cw && y < ch && !done[((y - 3) / 2) * c.cells + (x - 1) / 2],
    );
    if (!free.length) {
      open.splice(k, 1);
      continue;
    }
    const [ax, ay] = rng.pick(free);
    const next = ((ay - 3) / 2) * c.cells + (ax - 1) / 2;
    done[next] = 1;
    open.push(next);
    const below = cls[tile(bx, by)];
    const v = rng.chance(c.flip) ? (below + rng.int(1, 2)) % 3 : below;
    cut(ax, ay, cut((ax + bx) / 2, (ay + by) / 2, tile(bx, by), v), v);
  }
  if (c.plant) {
    // a tile two of whose inflows gather a stream's rain and a fuller dry slope's, each cut to the
    // rain wanted by keeping tiles out above it: on high ground where together they gather too
    // little to rise, or on ground kept out
    const size = new Int32Array(w * h);
    const into = new Map<number, number[]>();
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      size[i]++;
      size[from[i]] += size[i];
      into.set(from[i], [...(into.get(from[i]) ?? []), i]);
    }
    const fits: [number, number, number][] = [];
    for (const i of order)
      for (const a of into.get(i) ?? [])
        for (const b of into.get(i) ?? [])
          if (a !== b && size[a] >= RIVER_FLOW && size[b] >= RIVER_FLOW) fits.push([i, a, b]);
    // the first tile below each that a river of its own may run into
    const joinBelow = (j: number): [number, number] => {
      for (let i = from[j], last = j; from[i] >= 0; last = i, i = from[i]) {
        const q = (into.get(i) ?? []).find((t) => t !== last && size[t] >= SIDE_STREAM_FLOW);
        if (q !== undefined) return [i, q];
      }
      return [-1, -1];
    };
    const joining = fits.filter(([j]) => joinBelow(j)[0] >= 0);
    if (fits.length) {
      const joins = joining.length > 0 && rng.chance(0.5);
      const [j, a, b] = rng.pick(joins ? joining : fits);
      const high = rng.chance(0.6);
      const most = Math.min(size[a], size[b], high ? 65 : SIDE_STREAM_FLOW - 1);
      const ra = rng.int(RIVER_FLOW, most);
      const rb = rng.int(
        ra,
        Math.min(size[b], high ? HIGH_RIVER_FLOW - 2 - ra : HIGH_RIVER_FLOW - 1),
      );
      // tile i and those above it of class k, gathering `rain`: i itself and as many above it as
      // that takes, the rest kept out
      const fillAbove = (i: number, k: number, rain: number) => {
        const tiles = [i];
        for (let t = 0; t < tiles.length; t++) tiles.push(...(into.get(tiles[t]) ?? []));
        const out = new Set(rng.shuffle(tiles.slice(1)).slice(0, Math.max(0, tiles.length - rain)));
        for (const t of tiles) {
          cls[t] = out.has(t) ? KEPT_TILE : k;
          planted[t] = 1;
        }
      };
      fillAbove(a, LOW_TILE, ra);
      fillAbove(b, HIGH_TILE, rb);
      cls[j] = high ? HIGH_TILE : KEPT_TILE;
      planted[j] = 1;
      pond[j] = rng.chance(0.3) ? 1 : 0;
      // the way on: kept out to the first tile a river of its own runs into, or up to 8 tiles
      const [join, q] = joins ? joinBelow(j) : [-1, -1];
      if (q >= 0) fillAbove(q, LOW_TILE, size[q]);
      let left = join >= 0 ? Infinity : rng.int(0, 8);
      for (let i = from[j]; left > 0 && from[i] >= 0 && i !== join; i = from[i], left--) {
        cls[i] = join >= 0 ? KEPT_TILE : rng.pick([HIGH_TILE, KEPT_TILE]);
        planted[i] = 1;
        pond[i] = rng.chance(0.2) ? 1 : 0;
      }
      if (join >= 0) {
        cls[join] = KEPT_TILE;
        planted[join] = 1;
      }
    }
  }
  const lake = c.mouth === 'lake';
  for (const i of order) {
    const x = (i % w) - r;
    const y = Math.floor(i / w) - r;
    const kept = cls[i] === KEPT_TILE || (!planted[i] && rng.chance(c.kept));
    const low = kept || cls[i] === LOW_TILE || (lake && Math.abs(x - mx) <= 2 && y <= 4);
    const step = low
      ? rng.range(0.2, 1.8)
      : cls[i] === HIGH_TILE
        ? rng.range(2.05, 2.8)
        : rng.range(3.05, 3.9);
    p.elev[i] = elevAt(step);
    p.mark[i] = kept ? KEEP_OUT : 0;
    p.ground[i] = p.land[i] = step >= 3 ? Terrain.Hill : Terrain.Grass;
    if (rng.chance(c.ponds) || pond[i]) {
      p.ground[i] = Terrain.Water;
      p.land[i] = step >= 3 ? Terrain.Hill : Terrain.Sand;
    }
  }
  // the mouth, on the core's top edge
  for (const y of lake ? [0, 1, 2] : [0]) {
    const i = tile(mx, y);
    const k = c.mouth === 'edge' ? rng.int(0, 2) : -1;
    p.elev[i] = elevAt(k < 0 ? -0.5 : k === 1 ? 2.5 : 0.5);
    p.mark[i] = k === 2 ? KEEP_OUT : 0;
    p.ground[i] = k < 0 ? Terrain.Water : Terrain.Grass;
    p.land[i] = k < 0 ? Terrain.Sand : Terrain.Grass;
    p.sea[i] = c.mouth === 'sea' ? 1 : 0;
  }
  return { p, from };
}

describe('the one-channel rule', () => {
  const MAZE_SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

  it('draws mazes of every kind the property claims', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = MAZE_SEEDS.map((s) => genMaze(new Rng(s)));
    for (const mouth of ['edge', 'sea', 'lake'] as const)
      expect(cases.some((c) => c.mouth === mouth)).toBe(true);
    expect(cases.some((c) => c.cells <= 3)).toBe(true);
    expect(cases.some((c) => c.cells >= 14)).toBe(true);
    expect(cases.some((c) => c.low) && cases.some((c) => !c.low)).toBe(true);
    expect(cases.some((c) => c.wind > 0.8) && cases.some((c) => c.wind < 0.2)).toBe(true);
    expect(cases.some((c) => c.kept > 0.1) && cases.some((c) => c.ponds > 0.1)).toBe(true);
    expect(cases.some((c) => c.kept === 0 && c.ponds === 0)).toBe(true);
    expect(cases.some((c) => c.plant) && cases.some((c) => !c.plant)).toBe(true);
  });

  // 300 mazes up to 33 tiles a side, each drained once and slowly: about 3 s alone, and a failure
  // shrinks through up to 300 more
  it('takes away only side streams and the way they ran on, as the slow drainage does', () => {
    const seen = {
      // rivers taken away as side streams or above one
      side: 0,
      // tiles a removed stream ran on over, taken away with it: two or more in a row, on high
      // ground, on kept-out ground, on the ground's own water (Dry again)
      runOn: 0,
      longRunOn: 0,
      highRunOn: 0,
      keptRunOn: 0,
      dryRunOn: 0,
      // where such a removal stops: rain enough for a river of its own, or another river runs in
      toRain: 0,
      toJoin: 0,
      joins: 0,
      lake: 0,
    };
    forAll(
      genMaze,
      (c) => {
        const { p, from } = mazeInput(c);
        const d = drain(p);
        const s = slowDrain(p);
        // the maze drains as it was cut
        for (let i = 0; i < from.length; i++)
          if (from[i] >= 0 && s.down[i] !== from[i])
            throw new Error(`the flood takes (${i % p.w}, ${Math.floor(i / p.w)}) another way`);
        samePlane('kind', d.kind, s.kind, p.w);
        samePlane('water level', d.surface, s.surface, p.w);
        samePlane('flow', d.flow, s.flow, p.w);
        samePlane('side', d.dir, s.dir, p.w);
        expect(d.exits).toEqual(s.exits);
        const broken = riverWithoutSource(p, d, s) ?? riverTakenWithoutCause(p, d, s);
        if (broken) throw new Error(broken);
        // a tile taken back is the land it was: the ground's own water Dry, other ground Land
        for (let i = 0; i < d.kind.length; i++)
          if (
            p.ground[i] === Terrain.Water
              ? d.kind[i] === WaterKind.Land
              : d.kind[i] === WaterKind.Dry
          )
            throw new Error(
              `water kind ${d.kind[i]} on terrain ${p.ground[i]} at (${i % p.w}, ${Math.floor(i / p.w)})`,
            );
        const joined = sideStreamJoins(p, d, s);
        if (typeof joined === 'string') throw new Error(joined);
        // what the case met
        seen.joins += joined;
        seen.lake += d.kind.some((k) => k === WaterKind.Lake) ? 1 : 0;
        const b = riversBefore(p, d, s);
        const gone = (i: number) => b.river[i] === 1 && d.kind[i] !== WaterKind.River;
        for (const i of b.tiles) {
          if (!gone(i)) continue;
          if (b.side(i)) {
            seen.side++;
            continue;
          }
          seen.runOn++;
          const j = s.down[i];
          if (j >= 0 && gone(j) && !b.rises(j)) seen.longRunOn++;
          if (p.mark[i] & KEEP_OUT) seen.keptRunOn++;
          else seen.highRunOn++;
          if (p.ground[i] === Terrain.Water) seen.dryRunOn++;
          if (j >= 0 && d.kind[j] === WaterKind.River) seen[b.rises(j) ? 'toRain' : 'toJoin']++;
        }
      },
      { seeds: MAZE_SEEDS, shrink: shrinkMaze, shrinkBudget: 300 },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  }, 60_000);

  // 2000 planes, each drained once and slowly: about 2 s alone
  it('takes a river rising from its own rain away only as a side stream, on any small plane', () => {
    // "A side stream ... is removed, and the removal carries upstream. Rivers into a lake or the
    // sea are never removed." A river that gathered the rain it needs stays unless it, or a river
    // below it, joins a river whose fullest inflow is another with less than SIDE_STREAM_FLOW; so
    // one that runs into a lake or the sea stays.
    let side = 0;
    forAll(
      genPlane,
      (c) => {
        const p = planeInput(c);
        const d = drain(p);
        const s = slowDrain(p);
        const broken = riverTakenWithoutCause(p, d, s);
        if (broken) throw new Error(broken);
        const b = riversBefore(p, d, s);
        side += b.tiles.filter(
          (i) => b.river[i] && b.rises(i) && d.kind[i] !== WaterKind.River,
        ).length;
      },
      {
        seeds: Array.from({ length: 2000 }, (_, i) => i + 1),
        shrink: shrinkPlane,
        shrinkBudget: 2000,
      },
    );
    // side streams were taken away
    expect(side).toBeGreaterThan(0);
  }, 40_000);
});
