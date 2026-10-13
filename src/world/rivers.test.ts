import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAP_PARAMS,
  generateMap,
  generateMapPlanes,
  type MapGenParams,
  type MapPlanes,
} from './mapgen';
import { levelTarget, tileLevels } from './elevation';
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
import {
  FLOW_CAP,
  HIGH_RIVER_FLOW,
  KEEP_OUT,
  RIVER_FLOW,
  WaterKind,
  drain,
  levelSteps,
  type DrainInput,
} from './rivers';
import { DIR_DX, DIR_DY } from '../engine/iso';

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

/** A map of `size` tiles a side at origin 0, and the same world grown by RING on every side. */
function world(seed: number, size: number, sliders: Sliders) {
  const small = generateMapPlanes(seed, { ...sliders, w: size, h: size });
  const big = generateMapPlanes(seed, {
    ...sliders,
    w: size + 2 * RING,
    h: size + 2 * RING,
    originX: -RING,
    originY: -RING,
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
      // neighbouring levels within one step, and water at its own level
      if (Math.abs(levels[i] - levels[i - 1]) > 1 || Math.abs(levels[i] - levels[i - w]) > 1)
        throw new Error(`a step of two at ${at(i)}`);
      if (terrain[i] === Terrain.Water && levels[i] !== surface[i])
        throw new Error(`water at level ${levels[i]}, its own ${surface[i]}, at ${at(i)}`);
      if (terrain[i] !== Terrain.Water && surface[i])
        throw new Error(`a water level on land at ${at(i)}`);
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
          // a river beside the lake that does not run into it runs out of it
          const into = downstream(m, n);
          if (into < 0 || group[into] !== s) outlet = true;
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
 * The start chunk stays buildable and gets a river nearby: no river within 13 tiles of its centre
 * (the ground's own water there may run out of it), and a river in the 3 x 3 chunks around it.
 */
function checkStart(small: MapPlanes) {
  const m = small.map;
  const { rx, ry } = startRegion(m);
  const cx = rx * CHUNK_TILES + CHUNK_TILES / 2;
  const cy = ry * CHUNK_TILES + CHUNK_TILES / 2;
  let near = 0;
  for (let y = Math.max(0, cy - 48); y < Math.min(m.h, cy + 48); y++)
    for (let x = Math.max(0, cx - 48); x < Math.min(m.w, cx + 48); x++) {
      const i = y * m.w + x;
      if (!small.river[i]) continue;
      near++;
      const d = Math.hypot(x - cx, y - cy);
      // a river out of the ground's own water at the start may cross it
      if (d < 13 && small.shore[i] !== Terrain.Water && !nearWater(small, x, y))
        throw new Error(`a river ${d.toFixed(1)} tiles from the start at (${x}, ${y})`);
    }
  if (!near) throw new Error('no river in the 3 x 3 chunks around the start');
}
/** Whether the ground's own water (before the shore, so a lake) lies within 13 tiles. */
function nearWater(p: MapPlanes, x: number, y: number) {
  const m = p.map;
  for (let dy = -13; dy <= 13; dy++)
    for (let dx = -13; dx <= 13; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h) continue;
      const i = yy * m.w + xx;
      if (p.lake[i] && Math.hypot(dx, dy) < 13) return true;
    }
  return false;
}

describe('rivers and lakes of a generated map', () => {
  // 20 worlds of 160 x 160 at the default sliders, each with a ring around it: one river plan a
  // world, about 6 s alone
  it('hold on 20 worlds at the default size and sliders', () => {
    const seen = noneSeen();
    for (let seed = 1; seed <= 20; seed++) {
      const { small, big } = world(seed, 160, DEFAULTS);
      try {
        checkWater(small, big, seen);
        checkStart(small);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
      }
    }
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  }, 120_000);

  // 2 x 8 worlds of 96 and 224 tiles a side: about 5 s alone
  it.each([96, 224])(
    'hold on worlds of %i tiles a side',
    (size) => {
      const seen = noneSeen();
      for (let seed = 101; seed <= 108; seed++) {
        const { small, big } = world(seed, size, DEFAULTS);
        try {
          checkWater(small, big, seen);
          checkStart(small);
        } catch (e) {
          throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
        }
      }
      expect(seen.river).toBeGreaterThan(0);
      expect(seen.lake).toBeGreaterThan(0);
    },
    120_000,
  );

  // 10 worlds of 160 x 160 at other sliders: about 3 s alone
  it('hold at another setting of the Map sliders', () => {
    const seen = noneSeen();
    for (let seed = 201; seed <= 210; seed++) {
      const { small, big } = world(seed, 160, LOW_LAND);
      try {
        checkWater(small, big, seen);
        checkStart(small);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
      }
    }
    for (const k of ['river', 'raised', 'drop', 'lake', 'outlet'] as const)
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
});

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
    // a version 2 text: the same bytes with the version byte 2 and without the water planes,
    // which version 3 writes last
    const m = generateMap(7412, { w: 96, h: 96 });
    const text = encodeChunk(m, 1, 1);
    const now = decodeChunk(text)!;
    const bytes = Array.from(atob(text), (ch) => ch.charCodeAt(0));
    const tail = waterBytes(now);
    const v2 = btoa(String.fromCharCode(2, ...bytes.slice(1, bytes.length - tail)));
    const old = decodeChunk(v2)!;
    expect(old.version).toBe(2);
    expect([...old.terrain]).toEqual([...now.terrain]);
    expect([...old.biome]).toEqual([...now.biome]);
    for (const plane of [old.waterSurface, old.flow, old.flowDir])
      expect(plane.every((v) => v === 0)).toBe(true);
    // a map built from it has its water at level 0
    const built = buildMap(7412, { w: 32, h: 32, originX: 32, originY: 32 }, { '1,1': v2 }, () => {
      throw new Error('generated a stored chunk');
    }).map;
    for (let i = 0; i < 32 * 32; i++)
      if (built.terrain[i] === Terrain.Water) expect(levelTarget(built, i)).toBe(0);
  });

  it('end a new river that runs into a stored chunk in a pond on the new side', () => {
    // the chunks around the start of a 160-tile world, the start's east neighbour stored as an old
    // generator left it: all grass. Every new river that ran into it ends in a pond at the seam.
    for (const seed of [1, 2, 3, 4]) {
      const params = { w: 160, h: 160 };
      const fresh = buildMap(seed, params, {});
      // the stored chunk: a stub of plain grass, no water in it
      const stub = generateMap(seed, params);
      stub.terrain.fill(Terrain.Grass);
      stub.biome.fill(Biome.Plains);
      stub.climate!.fill(Biome.Plains);
      stub.waterSurface!.fill(0);
      stub.flow!.fill(0);
      stub.flowDir!.fill(0);
      stub.props.clear();
      const store: ChunkStore = { [chunkKey(3, 2)]: encodeChunk(stub, 3, 2) };
      const built = buildMap(seed, params, store).map;
      const stored = (x: number, y: number) => x >= 96 && x < 128 && y >= 64 && y < 96;
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
});

/** How many bytes varint `v` takes. */
const varintBytes = (v: number) => {
  let n = 1;
  for (; v >= 128; v = Math.floor(v / 128)) n++;
  return n;
};
/** How many bytes the water planes take at the end of a chunk text of version 3. */
function waterBytes(c: {
  waterSurface: Uint8Array;
  flow: Uint16Array;
  flowDir: Uint8Array;
}): number {
  let n = 0;
  for (let i = 0; i < c.waterSurface.length;) {
    let end = i + 1;
    while (end < c.waterSurface.length && c.waterSurface[end] === c.waterSurface[i]) end++;
    n += end - i >= 16 ? 1 + varintBytes(end - i - 16) : 1;
    i = end;
  }
  let rivers = 0;
  for (let i = 0, last = -1; i < c.flowDir.length; i++) {
    if (!c.flowDir[i]) continue;
    n += varintBytes(i - last - 1) + varintBytes(c.flow[i] * 4 + c.flowDir[i] - 1);
    last = i;
    rivers++;
  }
  return n + varintBytes(rivers);
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
    // a plane sloping down along x, the same in every row, below the hills and then above them
    const low = drain(planes(40, (x) => 0.5 - 0.001 * x));
    const high = drain(planes(40, (x) => 0.7 - 0.001 * x));
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
    // land sloping down to a sea along the bottom rows
    const p = planes(30, (x, y) => 0.6 - 0.006 * y + 0.0004 * Math.abs(x - 15));
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
