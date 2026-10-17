import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAP_PARAMS,
  emptyMap,
  generateMap,
  generateMapPlanes,
  type MapGenParams,
  type MapPlanes,
} from './mapgen';
import { MAX_LEVEL, tileLevels } from './elevation';
import { Biome, Terrain, type GameMap } from './tiles';
import {
  CHUNK_TILES,
  CHUNK_VERSION,
  buildMap,
  chunkKey,
  decodeChunk,
  encodeChunk,
  encodeMap,
  mapChunks,
  placeChunk,
  type ChunkStore,
  type MapGenerator,
} from './chunks';
import { bytesOf, oldChunkText, textOf } from './oldChunkTexts';
import {
  FALL_BITS,
  MAX_DROP,
  fallAt,
  fallDrop,
  fallEdge,
  fallFeature,
  isFeature,
  markWaterfalls,
  waterfallAt,
} from './waterfalls';
import { DIRS, DIR_DX, DIR_DY, Dir } from '../engine/iso';
import { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

// Waterfalls (#342): a river tile whose water drops to a lower level on the tile downstream of it
// is a waterfall, marked in the feature plane with its drop and the edge it falls over. Generated
// worlds make drops of one level only (their water levels step down one level at a time), so the
// drops of 2 to 4 that the plane and the chunks hold are checked on hand-made rivers.

/** A generator that must not run. */
const never: MapGenerator = () => {
  throw new Error('generated a chunk that is stored');
};

/** The Dir of the side (`dx`, `dy`) lies on. */
const sideOf = (dx: number, dy: number): Dir =>
  DIRS.find((d) => DIR_DX[d] === dx && DIR_DY[d] === dy)!;

/** The tile river tile `i` of `m` runs into, or -1 off the map. */
function downstream(m: GameMap, i: number): number {
  const d = m.flowDir![i] - 1;
  const x = (i % m.w) + DIR_DX[d];
  const y = Math.floor(i / m.w) + DIR_DY[d];
  return x < 0 || y < 0 || x >= m.w || y >= m.h ? -1 : y * m.w + x;
}

/** A map of `w` x `h` grass with every water plane, all empty. */
function blank(w: number, h: number, fill = Terrain.Grass): GameMap {
  const m = emptyMap(1, w, h, fill);
  m.waterSurface = new Uint8Array(w * h);
  m.flow = new Uint16Array(w * h);
  m.flowDir = new Uint8Array(w * h);
  m.feature = new Uint8Array(w * h);
  return m;
}

/** A river tile: where it lies and its water level. */
type Step = [x: number, y: number, level: number];

/**
 * Lays a river along `course` on `m`: each tile Water in the River biome at its level, running
 * into the next tile; the last runs over `last`, or is still water (a lake) without it.
 */
function layRiver(m: GameMap, course: Step[], last?: Dir) {
  course.forEach(([x, y, level], k) => {
    const i = y * m.w + x;
    m.terrain[i] = Terrain.Water;
    m.biome[i] = Biome.River;
    m.waterSurface![i] = level;
    const next = course[k + 1];
    const side = next ? sideOf(next[0] - x, next[1] - y) : last;
    if (side === undefined) {
      m.biome[i] = Biome.Lake;
      return;
    }
    m.flowDir![i] = side + 1;
    m.flow![i] = k + 1;
  });
}

/** Every tile of `m` that is a waterfall, as "x,y: drop edge". */
function falls(m: GameMap): string[] {
  const out: string[] = [];
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const f = waterfallAt(m, x, y);
      if (f) out.push(`${x},${y}: ${f.drop} ${f.edge}`);
    }
  return out;
}

describe('the feature byte', () => {
  it('holds a drop of 1 to MAX_DROP and the edge it falls over, as waterfalls.ts lays them out', () => {
    // a drop of the highest water level to the lowest, and no more
    expect(MAX_DROP).toBe(MAX_LEVEL);
    for (let drop = 1; drop <= MAX_DROP; drop++)
      for (const edge of DIRS) {
        const f = fallFeature(drop, edge);
        // bits 0 to 2 the drop, 3 and 4 the edge, none of the bits kept for #356
        expect(f).toBe(drop | (edge << 3));
        expect(f & ~FALL_BITS).toBe(0);
        expect([fallDrop(f), fallEdge(f)]).toEqual([drop, edge]);
      }
    expect(fallDrop(0)).toBe(0);
  });

  it('is 0 or a waterfall, and nothing else: no drop past MAX_DROP, no edge alone, no kept bit', () => {
    const held: number[] = [];
    for (let f = 0; f < 256; f++) if (isFeature(f)) held.push(f);
    const want: number[] = [0];
    for (let drop = 1; drop <= MAX_DROP; drop++)
      for (const edge of DIRS) want.push(fallFeature(drop, edge));
    expect(held).toEqual(want.sort((a, b) => a - b));
    for (const v of [-1, 256, 1.5, NaN]) expect(isFeature(v)).toBe(false);
    for (const drop of [0, MAX_DROP + 1, -1, 1.5]) expect(() => fallFeature(drop, Dir.N)).toThrow();
  });
});

describe('waterfalls on hand-made rivers', () => {
  it('fall from the upper tile over its downstream edge, by 1 to 4 levels, every way', () => {
    for (let drop = 1; drop <= MAX_DROP; drop++)
      for (const edge of DIRS) {
        const m = blank(5, 5);
        layRiver(m, [
          [2, 2, drop],
          [2 + DIR_DX[edge], 2 + DIR_DY[edge], 0],
        ]);
        markWaterfalls(m, m.feature!);
        // the upper tile, and no other
        expect(falls(m), `drop ${drop}, edge ${edge}`).toEqual([`2,2: ${drop} ${edge}`]);
        expect(m.feature![2 * 5 + 2]).toBe(fallFeature(drop, edge));
        expect(fallAt(m, 2 * 5 + 2)).toBe(fallFeature(drop, edge));
      }
  });

  it('fall at each step of a river that drops several times, and nowhere else', () => {
    // levels 4 4 | 1 1 | 0 0 0 down an L into a lake
    const m = blank(6, 6);
    layRiver(m, [
      [0, 1, 4],
      [1, 1, 4],
      [2, 1, 1],
      [2, 2, 1],
      [2, 3, 0],
      [3, 3, 0],
      [3, 4, 0],
    ]);
    markWaterfalls(m, m.feature!);
    expect(falls(m)).toEqual([`1,1: 3 ${Dir.E}`, `2,2: 1 ${Dir.S}`]);
  });

  // Any river down a small plane, its levels never rising: the waterfalls are the course's drops,
  // read off the course, not the planes. 300 rivers of up to 30 tiles.
  it('are the drops of any course, read apart from the planes', () => {
    let big = 0;
    forAll(
      (rng) => {
        const size = rng.int(2, 9);
        // a walk that never meets itself, each tile at most as high as the one before
        const course: Step[] = [];
        const seen = new Set<number>();
        let x = rng.int(0, size - 1);
        let y = rng.int(0, size - 1);
        let level = rng.int(0, MAX_LEVEL);
        for (let k = rng.int(1, 30); k > 0; k--) {
          course.push([x, y, level]);
          seen.add(y * size + x);
          const ways = DIRS.filter((d) => {
            const nx = x + DIR_DX[d];
            const ny = y + DIR_DY[d];
            return nx >= 0 && ny >= 0 && nx < size && ny < size && !seen.has(ny * size + nx);
          });
          if (!ways.length) break;
          const d = rng.pick(ways);
          x += DIR_DX[d];
          y += DIR_DY[d];
          if (rng.chance(0.3)) level = rng.int(0, level);
        }
        // the last tile runs off the plane, into land, or is a lake
        const end = rng.pick(['off', 'land', 'lake'] as const);
        return { size, course, end };
      },
      ({ size, course, end }) => {
        const m = blank(size, size);
        const [lx, ly] = course[course.length - 1];
        const on = new Set(course.map(([x, y]) => y * size + x));
        // a side of the last tile off the plane, or on land; a lake where it has none
        const out = DIRS.find((d) => {
          const nx = lx + DIR_DX[d];
          const ny = ly + DIR_DY[d];
          const off = nx < 0 || ny < 0 || nx >= size || ny >= size;
          return end === 'off' ? off : !off && !on.has(ny * size + nx);
        });
        layRiver(m, course, end === 'lake' ? undefined : out);
        // what the plane held before stays in the bits a waterfall does not use
        m.feature!.fill(0b0100_0000);
        markWaterfalls(m, m.feature!);
        const want = new Map<number, number>();
        course.forEach(([x, y, level], k) => {
          const next = course[k + 1];
          if (!next || next[2] >= level) return;
          want.set(y * size + x, fallFeature(level - next[2], sideOf(next[0] - x, next[1] - y)));
          if (level - next[2] > 1) big++;
        });
        for (let i = 0; i < size * size; i++)
          expect(m.feature![i], `tile ${i}`).toBe(0b0100_0000 | (want.get(i) ?? 0));
      },
      { seeds: Array.from({ length: 300 }, (_, i) => i + 1) },
    );
    expect(big).toBeGreaterThan(0);
  });

  it('do not fall where the water does not drop on a river', () => {
    const at = (m: GameMap) => fallAt(m, 2 * 5 + 2);
    // the same level, or higher downstream
    for (const lower of [3, 4]) {
      const m = blank(5, 5);
      layRiver(m, [
        [2, 2, 3],
        [3, 2, lower],
      ]);
      expect(at(m)).toBe(0);
    }
    // into land, and off the planes
    const land = blank(5, 5);
    layRiver(land, [[2, 2, 3]], Dir.E);
    expect(at(land)).toBe(0);
    const edge = blank(3, 3);
    layRiver(edge, [[2, 1, 3]], Dir.E);
    expect(fallAt(edge, 1 * 3 + 2)).toBe(0);
    // still water beside lower water: a lake runs nowhere
    const lake = blank(5, 5);
    layRiver(lake, [
      [3, 2, 0],
      [2, 2, 3],
    ]);
    expect(at(lake)).toBe(0);
    // a downstream side on a tile that is not water, and water with no levels at all
    const dry = blank(5, 5);
    layRiver(dry, [
      [2, 2, 3],
      [3, 2, 0],
    ]);
    dry.terrain[2 * 5 + 2] = Terrain.Grass;
    expect(at(dry)).toBe(0);
    const flat = blank(5, 5);
    layRiver(flat, [
      [2, 2, 3],
      [3, 2, 0],
    ]);
    flat.waterSurface = undefined;
    expect(at(flat)).toBe(0);
  });

  it('hold a drop past MAX_DROP, which no water level allows, to MAX_DROP', () => {
    const m = blank(5, 5);
    layRiver(m, [
      [2, 2, 9],
      [2, 3, 0],
    ]);
    expect(fallAt(m, 2 * 5 + 2)).toBe(fallFeature(MAX_DROP, Dir.S));
  });

  it('are marked on the tiles asked for only', () => {
    const m = blank(6, 3);
    layRiver(m, [
      [0, 1, 4],
      [1, 1, 3],
      [2, 1, 2],
      [3, 1, 1],
      [4, 1, 0],
    ]);
    markWaterfalls(m, m.feature!, { x0: 1, y0: 0, x1: 3, y1: 3 });
    expect(falls(m)).toEqual([`1,1: 1 ${Dir.E}`, `2,1: 1 ${Dir.E}`]);
    expect(waterfallAt(m, -1, 1)).toBeNull();
    expect(waterfallAt({ ...m, feature: undefined }, 1, 1)).toBeNull();
  });
});

/** Another setting of the Map sliders: lower water and lower hills, so more of the land is high. */
const LOW_LAND = { waterLevel: 0.3, hillLevel: 0.58, rockLevel: 0.7, forestDensity: 0.5 };
/** The ring the checks read around a map. */
const RING = CHUNK_TILES;

/** A world for the checks: its seed, its map's size and origin, and whether its land is low. */
interface WorldCase {
  seed: number;
  size: number;
  ox: number;
  oy: number;
  low: boolean;
}
const genWorldCase = (rng: Rng): WorldCase => ({
  seed: rng.int(1, 2 ** 31 - 1),
  size: rng.chance(0.4) ? 160 : rng.int(64, 160),
  ox: rng.chance(0.5) ? 0 : rng.int(-100, 100),
  oy: rng.chance(0.5) ? 0 : rng.int(-100, 100),
  low: rng.chance(0.3),
});
function* shrinkWorldCase(c: WorldCase): Iterable<WorldCase> {
  if (c.low) yield { ...c, low: false };
  for (const size of shrinkInt(c.size, 64)) yield { ...c, size };
  for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
  for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
}
const WORLD_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** A world's map, and the same world grown by RING on every side, which keeps its start chunk. */
function world(c: WorldCase): { small: MapPlanes; big: MapPlanes } {
  const sliders: Partial<MapGenParams> = c.low ? LOW_LAND : {};
  const frame = (ring: number) => ({
    ...sliders,
    w: c.size + 2 * ring,
    h: c.size + 2 * ring,
    originX: c.ox - ring,
    originY: c.oy - ring,
  });
  return {
    small: generateMapPlanes(c.seed, frame(0)),
    big: generateMapPlanes(c.seed, frame(RING)),
  };
}

/** What the checks met, summed over the worlds, so a run that never meets a case cannot pass. */
interface Seen {
  falls: number;
  /** waterfalls over each edge, in Dir order */
  edges: number[];
}

/**
 * Checks the waterfalls of `small` (its tiles RING in from every side of `big`), read on `big` so
 * every tile's neighbours are there, and throws at the first tile that breaks a rule.
 */
function checkFalls(small: MapPlanes, big: MapPlanes, seen: Seen) {
  const m = big.map;
  const { w, terrain, biome } = m;
  const surface = m.waterSurface!;
  const flowDir = m.flowDir!;
  const feature = m.feature!;
  const at = (i: number) => `world tile (${(i % w) + m.originX}, ${Math.floor(i / w) + m.originY})`;
  // the map's waterfalls are the grown world's, at its edge too, where its river runs off it
  const S = small.map;
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const j = (y + RING) * w + x + RING;
      if (S.feature![y * S.w + x] !== feature[j])
        throw new Error(
          `feature ${S.feature![y * S.w + x]} on the map, ${feature[j]} grown, at ${at(j)}`,
        );
    }
  const levels = tileLevels(m);
  /** The drop of the waterfall whose edge lies between neighbours `i` and `j`, or 0. */
  const fallBetween = (i: number, j: number) => {
    for (const [a, b] of [
      [i, j],
      [j, i],
    ])
      if (fallDrop(feature[a]) && downstream(m, a) === b) return fallDrop(feature[a]);
    return 0;
  };
  for (let y = RING; y < RING + S.h; y++)
    for (let x = RING; x < RING + S.w; x++) {
      const i = y * w + x;
      const f = feature[i];
      if (!isFeature(f) || f & ~FALL_BITS) throw new Error(`feature byte ${f} at ${at(i)}`);
      const drop = fallDrop(f);
      // every level drop along a river is a waterfall, and a waterfall is nothing else
      const n = flowDir[i] ? downstream(m, i) : -1;
      const drops = n >= 0 && terrain[n] === Terrain.Water && surface[n] < surface[i];
      if (drops !== drop > 0)
        throw new Error(
          `a drop ${drops ? 'with no' : 'marked where there is no'} waterfall at ${at(i)}`,
        );
      if (drop) {
        seen.falls++;
        seen.edges[fallEdge(f)]++;
        // a River-biome water tile the river pass made river
        if (terrain[i] !== Terrain.Water || biome[i] !== Biome.River || !big.river[i])
          throw new Error(`a waterfall off a river at ${at(i)}`);
        // over the river's downstream edge, by the difference of the water levels it joins
        if (fallEdge(f) !== flowDir[i] - 1)
          throw new Error(
            `a waterfall over edge ${fallEdge(f)}, downstream ${flowDir[i] - 1}, at ${at(i)}`,
          );
        if (drop !== surface[i] - surface[n] || drop > MAX_DROP)
          throw new Error(`a drop of ${drop} from ${surface[i]} to ${surface[n]} at ${at(i)}`);
      }
      for (const j of [i + 1, i + w]) {
        const fall = fallBetween(i, j);
        // neighbouring river tiles' water within a level of each other, but across a waterfall's
        // edge, where it is apart by the drop
        if (flowDir[i] && flowDir[j]) {
          const apart = Math.abs(surface[i] - surface[j]);
          if (fall ? apart !== fall : apart > 1)
            throw new Error(`river water ${apart} levels apart at ${at(i)}`);
        }
        // and the ground keeps the one-step rule
        if (!fall && Math.abs(levels[i] - levels[j]) > 1)
          throw new Error(`a step of two at ${at(i)}`);
      }
    }
}

describe('waterfalls of a generated map', () => {
  it('are checked on worlds of several sizes, origins and sliders', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = WORLD_SEEDS.map((s) => genWorldCase(new Rng(s)));
    expect(cases.filter((c) => c.size === 160).length).toBeGreaterThanOrEqual(3);
    expect(cases.some((c) => c.size < 128)).toBe(true);
    expect(cases.some((c) => c.size % 32 !== 0)).toBe(true);
    expect(cases.some((c) => c.ox !== 0 && c.oy !== 0)).toBe(true);
    expect(cases.some((c) => c.low) && cases.some((c) => !c.low)).toBe(true);
  });

  // 20 worlds up to 160 tiles a side, each with a ring around it: one river plan a world, about
  // 5 s alone, and a failure shrinks through up to 30 more
  it('fall on rivers over their downstream edge, wherever the water drops, on 20 worlds', () => {
    const seen: Seen = { falls: 0, edges: [0, 0, 0, 0] };
    forAll(
      genWorldCase,
      (c) => {
        const { small, big } = world(c);
        checkFalls(small, big, seen);
      },
      { seeds: WORLD_SEEDS, shrink: shrinkWorldCase, shrinkBudget: 30 },
    );
    expect(seen.falls).toBeGreaterThan(0);
    for (const d of DIRS) expect(seen.edges[d], `waterfalls over edge ${d}`).toBeGreaterThan(0);
  }, 120_000);

  /**
   * Waterfalls over a chunk's edge facing away from the start chunk (world chunk 1, 1), one over
   * each edge, found by scanning seeds 1 to 200 on maps of 7 x 7 chunks around it, and a map of
   * whole chunks around the start that ends at that edge, so the tile the water falls into is the
   * first one off it. Should generation change and move them, these want picking again.
   */
  const EDGE_FALLS: { seed: number; x: number; y: number; edge: Dir; frame: MapGenParams }[] = [
    { seed: 36, x: 109, y: 32, edge: Dir.N, frame: { w: 160, h: 32, originX: -32, originY: 32 } },
    { seed: 65, x: 95, y: -2, edge: Dir.E, frame: { w: 96, h: 160, originX: 0, originY: -32 } },
    { seed: 93, x: 38, y: 95, edge: Dir.S, frame: { w: 32, h: 96, originX: 32, originY: 0 } },
    { seed: 105, x: 0, y: 124, edge: Dir.W, frame: { w: 96, h: 160, originX: 0, originY: -32 } },
  ].map((c) => ({ ...c, frame: { ...DEFAULT_MAP_PARAMS, ...c.frame } }));

  // Four worlds of 7 x 7 chunks, a smaller map of each, and each stored and grown: about 1.5 s
  // alone
  it("keep a river's waterfall at the map's edge, over it, as the world grown past it has it", () => {
    const around = { w: 224, h: 224, originX: -64, originY: -64 };
    for (const { seed, x, y, edge, frame } of EDGE_FALLS) {
      const where = `seed ${seed}, world tile (${x}, ${y})`;
      const big = generateMap(seed, around);
      const fall = big.feature![(y - around.originY) * big.w + x - around.originX];
      expect(fall, where).toBe(fallFeature(1, edge));
      // the map ends at the edge it falls over, and has the waterfall all the same
      const m = generateMap(seed, frame);
      const [mx, my] = [x - m.originX, y - m.originY];
      const off = (v: number, n: number) => v < 0 || v >= n;
      expect(off(mx + DIR_DX[edge], m.w) || off(my + DIR_DY[edge], m.h), where).toBe(true);
      expect(m.feature![my * m.w + mx], where).toBe(fall);
      // stored so, and kept when the world grows past it
      const stored = buildMap(seed, frame, {}).chunks;
      const grown = buildMap(seed, around, stored).map;
      expect([...grown.feature!], where).toEqual([...big.feature!]);
    }
  }, 40_000);
});

/**
 * The text `text` would have had in version 3, before the water features: version 3's text of its
 * planes (oldChunkTexts.ts), without the features.
 */
const asVersion3 = (text: string) => oldChunkText(decodeChunk(text)!, 3);
/** Version 4's text of the planes of `text`, whose features come last. */
const asVersion4 = (text: string) => oldChunkText(decodeChunk(text)!, 4);

/** A 32 x 32 map with a river dropping 1, 2, 3 and 4 levels over each edge in turn. */
function stairs(): GameMap {
  const m = blank(32, 32);
  for (const edge of DIRS)
    for (let drop = 1; drop <= MAX_DROP; drop++) {
      // a pair of tiles a drop apart, each pair on its own 3 x 3 tiles
      const cx = 1 + 4 * (drop - 1) + 16 * (edge % 2);
      const cy = 1 + 4 * (drop - 1) + 16 * Math.floor(edge / 2);
      layRiver(m, [
        [cx, cy, drop],
        [cx + DIR_DX[edge], cy + DIR_DY[edge], 0],
      ]);
    }
  markWaterfalls(m, m.feature!);
  return m;
}

describe('waterfalls in stored chunks', () => {
  it('come back from a chunk text, every drop over every edge', () => {
    const m = stairs();
    expect(falls(m)).toHaveLength(4 * MAX_DROP);
    const text = encodeChunk(m, 0, 0);
    const c = decodeChunk(text)!;
    expect(c.version).toBe(CHUNK_VERSION);
    expect(CHUNK_VERSION).toBeGreaterThanOrEqual(4);
    expect([...c.feature]).toEqual([...m.feature!]);
    const back = buildMap(1, { w: 32, h: 32 }, { '0,0': text }, never).map;
    expect(falls(back)).toEqual(falls(m));
  });

  // 200 maps of up to 3 x 3 chunks, any frame, a waterfall of any drop and edge on any tile
  it('hold any feature byte on any tile and read it back as it was', () => {
    let stored = 0;
    forAll(
      (rng) => {
        const w = rng.int(1, 80);
        const h = rng.int(1, 80);
        const m = emptyMap(
          rng.int(0, 1000),
          w,
          h,
          Terrain.Grass,
          rng.int(-50, 50),
          rng.int(-50, 50),
        );
        m.feature = new Uint8Array(w * h);
        const share = rng.pick([0, 0.01, 0.2, 1]);
        for (let i = 0; i < w * h; i++)
          if (rng.chance(share)) m.feature[i] = fallFeature(rng.int(1, MAX_DROP), rng.pick(DIRS));
        return m;
      },
      (m) => {
        for (const { cx, cy } of mapChunks(m)) {
          const c = decodeChunk(encodeChunk(m, cx, cy))!;
          expect(c).not.toBeNull();
          stored += c.feature.filter((f) => f).length;
        }
        const frame = { w: m.w, h: m.h, originX: m.originX, originY: m.originY };
        const back = buildMap(m.seed, frame, encodeMap(m), never).map;
        for (let i = 0; i < m.w * m.h; i++)
          if (back.feature![i] !== m.feature![i])
            throw new Error(
              `feature ${back.feature![i]} read back, ${m.feature![i]} stored, at tile ${i}`,
            );
      },
      {
        seeds: Array.from({ length: 200 }, (_, i) => i + 1),
        format: (m) => `${m.w} x ${m.h} at (${m.originX}, ${m.originY}), seed ${m.seed}`,
      },
    );
    expect(stored).toBeGreaterThan(0);
  });

  it('refuse a feature byte the plane does not hold', () => {
    for (const f of [MAX_DROP + 1, 7, 0b1000, 0b10_0000, 0b100_0001, 0x80 | 1]) {
      const m = blank(32, 32);
      m.feature![40] = f;
      expect(() => encodeChunk(m, 0, 0), `byte ${f}`).toThrow(/waterfalls/);
    }
    // a text of version 4 whose features, which it lists last, say what no encoder wrote reads as
    // nothing: a byte the plane does not hold, a 0 listed, a tile past the chunk (a skip of 1024,
    // as a varint)
    const m = blank(32, 32);
    m.feature![40] = fallFeature(2, Dir.W);
    const bytes = bytesOf(asVersion4(encodeChunk(m, 0, 0)));
    const head = bytes.slice(0, -3);
    expect(bytes.slice(-3)).toEqual([1, 40, fallFeature(2, Dir.W)]);
    expect(decodeChunk(textOf(bytes))).not.toBeNull();
    for (const tail of [
      [1, 40, 0b10_0001],
      [1, 40, MAX_DROP + 1],
      [1, 40, 0],
      [1, 0x80, 0x08, fallFeature(2, Dir.W)],
    ])
      expect(decodeChunk(textOf([...head, ...tail])), `${tail}`).toBeNull();
  });

  it('read as no waterfalls from a chunk of version 3 or older', () => {
    const m = stairs();
    const text = encodeChunk(m, 0, 0);
    const now = decodeChunk(text)!;
    const v3 = asVersion3(text);
    const old = decodeChunk(v3)!;
    expect(old.version).toBe(3);
    // every plane as it was but the features, which are none
    expect({ ...old, version: now.version, feature: now.feature }).toEqual(now);
    expect(old.feature.every((f) => f === 0)).toBe(true);
    // a map built from it has its rivers and their drops, and no waterfall
    const built = buildMap(1, { w: 32, h: 32 }, { '0,0': v3 }, never).map;
    expect([...built.waterSurface!]).toEqual([...m.waterSurface!]);
    expect([...built.flowDir!]).toEqual([...m.flowDir!]);
    expect(falls(built)).toEqual([]);
    // and so from version 1, which held no water planes either (chunks.test.ts spells it out)
    const v1 = decodeChunk('AQECAwIBEGEwBcEOAglFQLIuAAAJDEJCHwsJgH8=')!;
    expect(v1.version).toBe(1);
    expect(v1.feature.every((f) => f === 0)).toBe(true);
  });

  // a world of 160 tiles built, read back and generated, one river plan: about 0.5 s alone
  it("keep a generated world's waterfalls and give them back on a load", () => {
    const params = { w: 160, h: 160, originX: -32, originY: -32 };
    const built = buildMap(52, params, {});
    const generated = generateMap(52, params);
    expect([...built.map.feature!]).toEqual([...generated.feature!]);
    expect(falls(built.map).length).toBeGreaterThan(0);
    const again = buildMap(52, params, built.chunks, never).map;
    expect(falls(again)).toEqual(falls(built.map));
  }, 20_000);

  // Worlds whose 96-tile map and the ring grown around it both have a waterfall, found by
  // scanning seeds 1 to 60. Three worlds, each built three times: about 1.5 s alone
  it('grow a world stored before them with waterfalls in its new chunks only', () => {
    for (const seed of [6, 7, 52]) {
      const small = { w: 96, h: 96 };
      const grown = { w: 160, h: 160, originX: -32, originY: -32 };
      const old = buildMap(seed, small, {});
      const store: ChunkStore = {};
      for (const [k, text] of Object.entries(old.chunks)) store[k] = asVersion3(text);
      const built = buildMap(seed, grown, store);
      const fresh = buildMap(seed, grown, {});
      const inStore = (x: number, y: number) =>
        x >= CHUNK_TILES && y >= CHUNK_TILES && x < CHUNK_TILES + 96 && y < CHUNK_TILES + 96;
      let missing = 0;
      let added = 0;
      for (let y = 0; y < 160; y++)
        for (let x = 0; x < 160; x++) {
          const i = y * 160 + x;
          const f = fresh.map.feature![i];
          const where = `seed ${seed}, map tile (${x}, ${y})`;
          // the stored chunks have none, where the world grown at once has its waterfalls
          if (inStore(x, y)) {
            expect(built.map.feature![i], where).toBe(0);
            if (f) missing++;
          } else {
            expect(built.map.feature![i], where).toBe(f);
            if (f) added++;
          }
        }
      expect(missing, `seed ${seed}`).toBeGreaterThan(0);
      expect(added, `seed ${seed}`).toBeGreaterThan(0);
      // the new chunks are stored as the world grown at once stores them
      for (const k of built.added)
        expect(built.chunks[k], `seed ${seed}, ${k}`).toBe(fresh.chunks[k]);
    }
  }, 40_000);
});

describe('waterfalls at the seam with a stored chunk', () => {
  /**
   * A map of 34 x 32 tiles: chunk 0,0 whole and two columns of chunk 1,0. A generator that makes it
   * all Hill with a river along row 5 over the two columns, at level 2, the way `side` says, its
   * waterfalls marked; `beyond` is the drop it saw past the map's east edge.
   */
  const river =
    (side: Dir, beyond = 0): MapGenerator =>
    (s, p) => {
      const m = blank(p.w!, p.h!, Terrain.Hill);
      m.seed = s;
      // the ground west of the columns as the generator has it: water at level 2
      const course: Step[] =
        side === Dir.E
          ? [
              [32, 5, 2],
              [33, 5, 2],
            ]
          : [
              [33, 5, 2],
              [32, 5, 2],
              [31, 5, 2],
            ];
      layRiver(m, course, side === Dir.E ? Dir.E : undefined);
      markWaterfalls(m, m.feature!);
      if (beyond) m.feature![5 * 34 + 33] = fallFeature(beyond, Dir.E);
      return m;
    };
  /** Chunk 0,0 as an older generator stored it: all `fill`, and (31, 5) as `edge`. */
  const stored = (fill: Terrain, edge: Terrain): ChunkStore => {
    const m = blank(32, 32, fill);
    m.terrain[5 * 32 + 31] = edge;
    if (edge === Terrain.Water) m.biome[5 * 32 + 31] = Biome.Lake;
    return { [chunkKey(0, 0)]: encodeChunk(m, 0, 0) };
  };
  const frame = { w: 34, h: 32 };
  const at = (m: GameMap, x: number, y: number) => waterfallAt(m, x, y);

  it('keep the drop the generator saw off the map where the seam lowers nothing', () => {
    const m = buildMap(1, frame, stored(Terrain.Hill, Terrain.Hill), river(Dir.E, 2)).map;
    expect([m.waterSurface![5 * 34 + 32], m.waterSurface![5 * 34 + 33]]).toEqual([2, 2]);
    expect(falls(m)).toEqual([`33,5: 2 ${Dir.E}`]);
  });

  it('take what the seam lowered a river off the drop the generator saw off the map', () => {
    // grass beside the river holds it at level 1, and the water it runs into no higher
    const built = buildMap(1, frame, stored(Terrain.Grass, Terrain.Grass), river(Dir.E, 2));
    const m = built.map;
    expect([m.waterSurface![5 * 34 + 32], m.waterSurface![5 * 34 + 33]]).toEqual([1, 1]);
    expect(at(m, 33, 5)).toEqual({ drop: 1, edge: Dir.E });
    expect(falls(m)).toEqual([`33,5: 1 ${Dir.E}`]);
    // and the chunk stores it so
    const c = decodeChunk(built.chunks[chunkKey(1, 0)])!;
    expect(c.feature[5 * 2 + 1]).toBe(fallFeature(1, Dir.E));
    // lowered by its whole drop, it falls no more
    const flat = buildMap(1, frame, stored(Terrain.Grass, Terrain.Grass), river(Dir.E, 1)).map;
    expect(falls(flat)).toEqual([]);
  });

  it('fall where the levels the seam leaves drop, into stored water too', () => {
    // the river runs west into a stored lake at level 0, which holds the tile beside it at 1
    const m = buildMap(1, frame, stored(Terrain.Hill, Terrain.Water), river(Dir.W)).map;
    expect([m.waterSurface![5 * 34 + 32], m.waterSurface![5 * 34 + 33]]).toEqual([1, 2]);
    // generated, neither fell; now each falls a level
    expect(falls(river(Dir.W)(1, { ...DEFAULT_MAP_PARAMS, ...frame }))).toEqual([]);
    expect(falls(m)).toEqual([`32,5: 1 ${Dir.W}`, `33,5: 1 ${Dir.W}`]);
  });
});

/**
 * Worlds whose 160-tile map has water at level 2 beside another chunk (rivers.test.ts, found by
 * scanning seeds 1 to 100), so a stored chunk there lowers it.
 */
const RAISED_WORLDS = [9, 36, 38, 61, 72, 90, 100];

describe('waterfalls of a world grown beside a chunk an older generator stored', () => {
  // Seven worlds of 160 tiles, each built twice: about 3 s alone
  it("follow the levels the seam leaves on the new side, and keep the stored chunk's", () => {
    let changed = 0;
    for (const seed of RAISED_WORLDS) {
      const params = { w: 160, h: 160 };
      const fresh = buildMap(seed, params, {}).map;
      // the first chunk in reading order that raised water stands beside, from another chunk
      const chunk = (i: number) =>
        Math.floor(i / 160 / CHUNK_TILES) * 5 + Math.floor((i % 160) / CHUNK_TILES);
      let first = -1;
      for (let i = 0; i < 160 * 160; i++) {
        if (fresh.waterSurface![i] < 2) continue;
        for (const n of [i - 160, i + 160, i - 1, i + 1]) {
          if (n < 0 || n >= 160 * 160 || Math.abs((n % 160) - (i % 160)) > 1) continue;
          if (chunk(n) !== chunk(i) && (first < 0 || chunk(n) < first)) first = chunk(n);
        }
      }
      expect(first, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      const cx = first % 5;
      const cy = Math.floor(first / 5);
      // the stored chunk: plain grass with a waterfall of its own, which stays as stored
      const stub = blank(160, 160);
      const [fx, fy] = [cx * CHUNK_TILES + 3, cy * CHUNK_TILES + 3];
      layRiver(stub, [
        [fx, fy, 3],
        [fx, fy + 1, 0],
      ]);
      markWaterfalls(stub, stub.feature!);
      const fall = fy * 160 + fx;
      expect(stub.feature![fall]).toBe(fallFeature(3, Dir.S));
      const built = buildMap(seed, params, { [chunkKey(cx, cy)]: encodeChunk(stub, cx, cy) }).map;
      const isStored = (i: number) => chunk(i) === first;
      for (let i = 0; i < 160 * 160; i++) {
        const f = built.feature![i];
        const where = `seed ${seed}, map tile (${i % 160}, ${Math.floor(i / 160)})`;
        if (isStored(i)) {
          expect(f, where).toBe(i === fall ? fallFeature(3, Dir.S) : 0);
          continue;
        }
        // a new tile's waterfall is the one its levels give, where the map holds the tile it runs
        // into; the generator's, less what the seam lowered it by, where it does not
        const n = built.flowDir![i] ? downstream(built, i) : -1;
        if (n >= 0) expect(f, where).toBe(fallAt(built, i));
        else if (built.flowDir![i]) {
          const lowered = fresh.waterSurface![i] - built.waterSurface![i];
          const drop = Math.max(0, fallDrop(fresh.feature![i]) - lowered);
          expect(f, where).toBe(drop ? fallFeature(drop, built.flowDir![i] - 1) : 0);
        } else expect(f, where).toBe(0);
        if (f !== fresh.feature![i]) changed++;
      }
    }
    // the seam moved a waterfall somewhere
    expect(changed).toBeGreaterThan(0);
  }, 90_000);
});

// Verification (#342): properties checked against oracles written apart from chunks.ts and
// waterfalls.ts, the feature section of a chunk text read byte by byte here, and the waterfalls a
// seam leaves read off the levels it leaves.

describe('a feature section written by hand', () => {
  /**
   * The text of rectangle (`x0`, `y0`, `w`, `h`) of chunk 0, 0 with a feature section of its own:
   * a count `extra` off the number of `entries`, and for each tile its skip since the one before
   * and its byte, any of them.
   */
  interface HandFeatures {
    x0: number;
    y0: number;
    w: number;
    h: number;
    extra: number;
    entries: [skip: number, byte: number][];
  }
  const genHand = (rng: Rng): HandFeatures => {
    const w = rng.int(1, 32);
    const h = rng.int(1, 32);
    const k = rng.int(0, 5);
    const entries: [number, number][] = [];
    for (let t = 0; t < k; t++) {
      // mostly tiles inside the rectangle, some at its last tile and past it
      const skip = rng.chance(0.15)
        ? rng.int(w * h - 1, w * h + 200)
        : rng.int(0, Math.ceil((w * h) / k));
      // mostly a waterfall's byte, some 0 and some any byte at all
      const byte = rng.chance(0.7)
        ? fallFeature(rng.int(1, MAX_DROP), rng.pick(DIRS))
        : rng.chance(0.15)
          ? 0
          : rng.int(0, 255);
      entries.push([skip, byte]);
    }
    const extra = rng.chance(0.15) ? rng.pick([-1, 1]) : 0;
    return { x0: rng.int(0, 32 - w), y0: rng.int(0, 32 - h), w, h, extra, entries };
  };
  function* shrinkHand(c: HandFeatures): Iterable<HandFeatures> {
    for (const entries of shrinkArray(c.entries)) yield { ...c, entries };
    if (c.extra) yield { ...c, extra: 0 };
    for (const w of shrinkInt(c.w, 1)) yield { ...c, w, x0: Math.min(c.x0, 32 - w) };
    for (const h of shrinkInt(c.h, 1)) yield { ...c, h, y0: Math.min(c.y0, 32 - h) };
  }
  const count = (c: HandFeatures) => Math.max(0, c.entries.length + c.extra);
  const varint = (out: number[], v: number) => {
    for (; v >= 0x80; v = Math.floor(v / 0x80)) out.push((v % 0x80) | 0x80);
    out.push(v);
  };
  /**
   * The text: the planes of the rectangle as version 4 writes them, the last version to list its
   * features as a section of its own, then the section by hand.
   */
  function handText(c: HandFeatures): string {
    const m = emptyMap(0, c.w, c.h, Terrain.Grass, c.x0, c.y0);
    const bytes = bytesOf(asVersion4(encodeChunk(m, 0, 0)));
    // a map with no waterfalls ends in a count of 0
    if (bytes.pop() !== 0) throw new Error('a chunk text with no waterfalls ends in a count of 0');
    varint(bytes, count(c));
    for (const [skip, byte] of c.entries) {
      varint(bytes, skip);
      bytes.push(byte);
    }
    return textOf(bytes);
  }
  /**
   * What decodeChunk has to make of the section, read here and not by chunks.ts: the feature plane
   * it lists, or null with the reason encodeChunk never writes such a section.
   */
  function expected(c: HandFeatures): { plane: Uint8Array | null; why: string } {
    const n = c.w * c.h;
    const plane = new Uint8Array(n);
    let last = -1;
    for (const [skip, byte] of c.entries.slice(0, count(c))) {
      const i = last + 1 + skip;
      if (i >= n) return { plane: null, why: 'a tile past the rectangle' };
      if (!byte) return { plane: null, why: 'a 0 listed' };
      // a waterfall's byte: a drop of 1 to MAX_DROP in bits 0 to 2, an edge in 3 and 4, nothing
      // above them
      if (byte >= 32 || (byte & 7) > MAX_DROP || !(byte & 7))
        return { plane: null, why: 'not a waterfall' };
      plane[i] = byte;
      last = i;
    }
    if (count(c) < c.entries.length) return { plane: null, why: 'bytes left over' };
    if (count(c) > c.entries.length) return { plane: null, why: 'cut short' };
    return { plane, why: plane.some((f) => f) ? 'read, with waterfalls' : 'read, none' };
  }
  /** The ground around a rectangle that holds part of its chunk: grass, no water. */
  const plain: MapGenerator = (s, p) =>
    emptyMap(s, p.w!, p.h!, Terrain.Grass, p.originX, p.originY);

  // 400 texts, each read, built into a map and written again
  it('reads as the waterfalls it lists, on the tiles it lists them, or as nothing', () => {
    const seen = new Set<string>();
    forAll(
      genHand,
      (c) => {
        const text = handText(c);
        const want = expected(c);
        seen.add(want.why);
        const got = decodeChunk(text);
        const built = buildMap(1, { w: 32, h: 32 }, { '0,0': text }, plain);
        if (!want.plane) {
          expect(got, want.why).toBeNull();
          expect(built.unreadable).toEqual(['0,0']);
          return;
        }
        expect(got, want.why).not.toBeNull();
        expect([...got!.feature]).toEqual([...want.plane]);
        // the map has each one on its tile of the rectangle, and none elsewhere
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const inside = x >= c.x0 && y >= c.y0 && x < c.x0 + c.w && y < c.y0 + c.h;
            const f = inside ? want.plane[(y - c.y0) * c.w + x - c.x0] : 0;
            const fall = waterfallAt(built.map, x, y);
            const read = fall ? fall.drop | (fall.edge << 3) : 0;
            if (built.map.feature![y * 32 + x] !== f || read !== f)
              throw new Error(`tile (${x}, ${y}): ${built.map.feature![y * 32 + x]}, not ${f}`);
          }
        // and the planes it read, written again, are the same text in version 4 and read the same
        // in today's
        const m = emptyMap(0, c.w, c.h, Terrain.Grass, c.x0, c.y0);
        placeChunk(m, 0, 0, got!);
        expect(asVersion4(encodeChunk(m, 0, 0))).toBe(text);
        expect(decodeChunk(encodeChunk(m, 0, 0))).toEqual({ ...got!, version: CHUNK_VERSION });
      },
      {
        seeds: Array.from({ length: 400 }, (_, i) => i + 1),
        shrink: shrinkHand,
        format: (c) => `${JSON.stringify(c)}, text ${handText(c)}`,
      },
    );
    // every way out was taken
    for (const why of [
      'read, with waterfalls',
      'read, none',
      'a tile past the rectangle',
      'a 0 listed',
      'not a waterfall',
      'bytes left over',
      'cut short',
    ])
      expect(seen, why).toContain(why);
  });
});

describe('waterfalls of a world grown beside a stored chunk of any ground', () => {
  /** The ground a stored chunk is drawn from, simplest first. */
  const GROUND = [Terrain.Grass, Terrain.Water, Terrain.Hill, Terrain.Mountain];
  /**
   * Where the stored chunk lies: beside a river, beside water at level 2 (which the seam may
   * lower), or where a river at level 1 or 2 runs into it.
   */
  const NEAR = ['beside', 'raised', 'into'] as const;
  /**
   * A world of RAISED_WORLDS, and a chunk an older generator stored `near` one of its rivers:
   * ground of the first `kinds` of GROUND in square patches of `patch` tiles, its water at any level
   * 0 to MAX_LEVEL, a river on some of it running any way, out of the chunk too (`rivers`), and on
   * some of those a waterfall of any drop over that way (`falls`), whatever the levels say. With
   * `pool`, the tiles a river at level 1 or 2 of the world runs into are still water at level 0.
   */
  interface Beside {
    seed: number;
    near: (typeof NEAR)[number];
    pick: number;
    salt: number;
    kinds: number;
    patch: number;
    rivers: boolean;
    falls: boolean;
    pool: boolean;
  }
  const genBeside = (rng: Rng): Beside => ({
    seed: rng.pick(RAISED_WORLDS),
    near: rng.pick(NEAR),
    pick: rng.int(0, 999),
    salt: rng.int(1, 2 ** 31 - 1),
    kinds: rng.int(1, GROUND.length),
    patch: rng.pick([1, 2, 4, 8]),
    rivers: rng.chance(0.8),
    falls: rng.chance(0.8),
    pool: rng.chance(0.5),
  });
  function* shrinkBeside(c: Beside): Iterable<Beside> {
    if (c.pool) yield { ...c, pool: false };
    if (c.falls) yield { ...c, falls: false };
    if (c.rivers) yield { ...c, rivers: false, falls: false };
    for (const kinds of shrinkInt(c.kinds, 1)) yield { ...c, kinds };
  }

  const PARAMS = { w: 160, h: 160 };
  /** The chunk of map tile `i`, in reading order over the map's 5 x 5 chunks. */
  const chunkOfTile = (i: number) =>
    Math.floor(i / 160 / CHUNK_TILES) * 5 + Math.floor((i % 160) / CHUNK_TILES);
  /** A world as generated and stored, and the chunks near its rivers each way NEAR names. */
  interface World {
    fresh: GameMap;
    near: Record<Beside['near'], number[]>;
    /** the tiles a river at level 1 or 2 of another chunk runs into */
    entries: Set<number>;
  }
  const worlds = new Map<number, World>();
  function worldOf(seed: number): World {
    let w = worlds.get(seed);
    if (w) return w;
    const fresh = buildMap(seed, PARAMS, {}).map;
    const near = { beside: new Set<number>(), raised: new Set<number>(), into: new Set<number>() };
    const entries = new Set<number>();
    for (let i = 0; i < 160 * 160; i++) {
      if (!fresh.flowDir![i]) continue;
      const x = i % 160;
      const y = Math.floor(i / 160);
      for (const d of DIRS) {
        const nx = x + DIR_DX[d];
        const ny = y + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= 160 || ny >= 160) continue;
        const n = ny * 160 + nx;
        const k = chunkOfTile(n);
        if (k === chunkOfTile(i)) continue;
        near.beside.add(k);
        if (fresh.waterSurface![i] >= 2) near.raised.add(k);
        if (fresh.waterSurface![i] >= 1 && fresh.flowDir![i] === d + 1) {
          near.into.add(k);
          entries.add(n);
        }
      }
    }
    const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
    w = {
      fresh,
      near: { beside: sorted(near.beside), raised: sorted(near.raised), into: sorted(near.into) },
      entries,
    };
    worlds.set(seed, w);
    return w;
  }
  /** The stored chunk (`cx`, `cy`) of case `c` in world `w`, on a map of the world's frame. */
  function storedGround(c: Beside, w: World, cx: number, cy: number): GameMap {
    const m = blank(160, 160);
    const rng = new Rng(c.salt);
    const side = CHUNK_TILES / c.patch;
    const kinds = Array.from({ length: side * side }, () => GROUND[rng.int(0, c.kinds - 1)]);
    const levels = Array.from({ length: side * side }, () => rng.int(0, MAX_LEVEL));
    for (let y = 0; y < CHUNK_TILES; y++)
      for (let x = 0; x < CHUNK_TILES; x++) {
        const i = (cy * CHUNK_TILES + y) * 160 + cx * CHUNK_TILES + x;
        const p = Math.floor(y / c.patch) * side + Math.floor(x / c.patch);
        const pool = c.pool && w.entries.has(i);
        m.terrain[i] = pool ? Terrain.Water : kinds[p];
        if (m.terrain[i] !== Terrain.Water) continue;
        m.biome[i] = Biome.Lake;
        m.waterSurface![i] = pool ? 0 : levels[p];
        if (pool || !c.rivers || rng.chance(0.4)) continue;
        const way = rng.pick(DIRS);
        m.biome[i] = Biome.River;
        m.flowDir![i] = way + 1;
        m.flow![i] = rng.int(1, 200);
        if (c.falls && rng.chance(0.5)) m.feature![i] = fallFeature(rng.int(1, MAX_DROP), way);
      }
    return m;
  }

  // 30 cases over 7 worlds of 160 tiles, each built with its stored chunk and read back: about
  // 4 s alone
  it("keep the stored chunk's bytes, and give every new river tile the drop its levels leave", () => {
    const met = { lowered: 0, ponds: 0, intoStored: 0, moved: 0, outward: 0, falls: 0 };
    forAll(
      genBeside,
      (c) => {
        const w = worldOf(c.seed);
        const { fresh } = w;
        const list = w.near[c.near].length ? w.near[c.near] : w.near.beside;
        const k = list[c.pick % list.length];
        const [cx, cy] = [k % 5, Math.floor(k / 5)];
        const ground = storedGround(c, w, cx, cy);
        const key = chunkKey(cx, cy);
        const store: ChunkStore = { [key]: encodeChunk(ground, cx, cy) };
        const built = buildMap(c.seed, PARAMS, store);
        expect(built.chunks[key]).toBe(store[key]);
        const m = built.map;
        const level = m.waterSurface!;
        const way = m.flowDir!;
        const feature = m.feature!;
        const isStored = (i: number) => chunkOfTile(i) === k;
        const at = (i: number) => `chunk ${key}, map tile (${i % 160}, ${Math.floor(i / 160)})`;
        for (let i = 0; i < 160 * 160; i++) {
          const f = feature[i];
          // a waterfall's bits read here: the drop in bits 0 to 2, the edge in 3 and 4
          const drop = f & 7;
          if (isStored(i)) {
            // a stored tile keeps the byte it was stored with, whatever the new side does
            if (f !== ground.feature![i])
              throw new Error(`stored feature ${ground.feature![i]} read as ${f} at ${at(i)}`);
            const n = drop ? downstream(m, i) : -1;
            if (n >= 0 && !isStored(n)) met.outward++;
            continue;
          }
          if (fresh.flowDir![i] && !way[i]) met.ponds++;
          if (m.terrain[i] === Terrain.Water && level[i] < fresh.waterSurface![i]) met.lowered++;
          if (f !== fresh.feature![i]) met.moved++;
          if (f >= 32 || (f && !drop)) throw new Error(`feature byte ${f} at ${at(i)}`);
          if (!way[i]) {
            if (f) throw new Error(`a waterfall ${f} on a tile that runs nowhere at ${at(i)}`);
            continue;
          }
          if (drop) {
            met.falls++;
            // River-biome water, falling over its downstream edge
            if (m.terrain[i] !== Terrain.Water || m.biome[i] !== Biome.River)
              throw new Error(`a waterfall off a river at ${at(i)}`);
            if (f >> 3 !== way[i] - 1)
              throw new Error(
                `a waterfall over edge ${f >> 3}, downstream ${way[i] - 1}, ${at(i)}`,
              );
          }
          const n = downstream(m, i);
          let want: number;
          if (n >= 0) {
            // the difference of the levels the seam leaves, into stored water too
            want = m.terrain[n] === Terrain.Water && level[i] > level[n] ? level[i] - level[n] : 0;
            if (want && isStored(n)) met.intoStored++;
          } else
            // off the map: the drop the generator saw, less what the seam lowered the tile by
            want = Math.max(0, fallDrop(fresh.feature![i]) - (fresh.waterSurface![i] - level[i]));
          if (drop !== want || want > MAX_DROP)
            throw new Error(`a drop of ${drop}, not ${want}, at ${at(i)}`);
        }
        // new river tiles' water within a level of each other's, but across a waterfall's edge
        for (let i = 0; i < 160 * 160; i++) {
          if (isStored(i) || !way[i]) continue;
          for (const j of [i % 160 < 159 ? i + 1 : -1, i + 160 < 160 * 160 ? i + 160 : -1]) {
            if (j < 0 || isStored(j) || !way[j]) continue;
            const apart = Math.abs(level[i] - level[j]);
            const fall =
              downstream(m, i) === j ? feature[i] & 7 : downstream(m, j) === i ? feature[j] & 7 : 0;
            if (fall ? apart !== fall : apart > 1)
              throw new Error(`river water ${apart} levels apart at ${at(i)}`);
          }
        }
        // and a load reads the same waterfalls back from the store alone
        const again = buildMap(c.seed, PARAMS, built.chunks, never).map;
        for (let i = 0; i < 160 * 160; i++)
          if (again.feature![i] !== feature[i])
            throw new Error(`feature ${again.feature![i]} on a load, ${feature[i]}, at ${at(i)}`);
      },
      {
        seeds: Array.from({ length: 30 }, (_, i) => i + 1),
        shrink: shrinkBeside,
        shrinkBudget: 10,
      },
    );
    // every way the seam meets a waterfall was met
    for (const [what, n] of Object.entries(met)) expect(n, what).toBeGreaterThan(0);
  }, 120_000);
});
