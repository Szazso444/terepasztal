import { Rng, hash2 } from '../engine/rng';
import { supplyMode } from '../sim/supply';
import {
  Terrain,
  Biome,
  startRegion,
  type GameMap,
  type PropInstance,
  type PropKind,
} from './tiles';

/** Smooth value noise built from the coordinate hash. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, y * f, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

/**
 * `fbm(wx / scale + offset, wy / scale + offset, seed, octaves)` for every tile of a `w` x `h`
 * block whose first tile is world tile (`x0`, `y0`), row by row. The values are bit for bit what
 * `fbm` returns, from the same operations in the same order; only the lattice corners are hashed
 * once per cell along a row instead of once per tile.
 */
function fbmBlock(
  x0: number,
  y0: number,
  w: number,
  h: number,
  scale: number,
  offset: number,
  seed: number,
  octaves: number,
): Float64Array {
  const out = new Float64Array(w * h);
  const cellX = new Int32Array(w);
  const smoothX = new Float64Array(w);
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const s = seed + o * 31;
    for (let x = 0; x < w; x++) {
      const X = ((x0 + x) / scale + offset) * f;
      const xi = Math.floor(X);
      const fx = X - xi;
      cellX[x] = xi;
      smoothX[x] = fx * fx * (3 - 2 * fx);
    }
    for (let y = 0; y < h; y++) {
      const Y = ((y0 + y) / scale + offset) * f;
      const yi = Math.floor(Y);
      const fy = Y - yi;
      const sy = fy * fy * (3 - 2 * fy);
      let cell = cellX[0] - 2;
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      for (let x = 0, i = y * w; x < w; x++, i++) {
        const xi = cellX[x];
        if (xi !== cell) {
          if (xi === cell + 1) {
            a = b;
            c = d;
          } else {
            a = hash2(xi, yi, s);
            c = hash2(xi, yi + 1, s);
          }
          b = hash2(xi + 1, yi, s);
          d = hash2(xi + 1, yi + 1, s);
          cell = xi;
        }
        const sx = smoothX[x];
        out[i] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

export interface MapGenParams {
  w: number;
  h: number;
  /** world coordinate of tile (0,0): the noise fields are sampled in world space so a map that
   *  grows around the start keeps every tile it already had */
  originX?: number;
  originY?: number;
  waterLevel: number;
  hillLevel: number;
  rockLevel: number;
  forestDensity: number;
}
export const DEFAULT_MAP_PARAMS: MapGenParams = {
  w: 96,
  h: 96,
  waterLevel: 0.36,
  hillLevel: 0.64,
  rockLevel: 0.76,
  forestDensity: 0.56,
};

/** A rectangle of tiles; `x1` and `y1` are exclusive. */
interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The longest river, in tiles of its course. Bounding it is what keeps `MARGIN` finite. */
const RIVER_TILES = 64;
/** How far biome smoothing reads: two passes of a 5x5 majority. */
const SMOOTH_REACH = 4;
/** How far the passes after the rivers read: lone-tile cleanup 1, mountains 2, oil fields 2. */
const LATE_REACH = 5;
/**
 * Generation runs on a field this many tiles wider than the map on every side, and the map is
 * cropped out of it, so no pass ever sees the map's own edge: a tile comes out the same whatever
 * the map's size and origin, and a map that grows keeps every tile it had.
 *
 * Biomes, and so the ground, are exact more than SMOOTH_REACH tiles inside the field's edge. A
 * river that carves within LATE_REACH of the map lies wholly within LATE_REACH + RIVER_TILES of
 * it, on exact ground, so it is walked exactly as on an endless map; a river that strays onto
 * inexact ground is too far out to carve anywhere that matters. The margin also holds the 3x3
 * chunks around the start (the fallback river's ground) for a map only one or two chunks wide.
 */
const MARGIN = RIVER_TILES + LATE_REACH + SMOOTH_REACH;

/** A flat map of one terrain type with no props (the editor's blank canvas). */
export function emptyMap(
  seed: number,
  w: number,
  h: number,
  fill: Terrain = Terrain.Grass,
  originX = 0,
  originY = 0,
): GameMap {
  const terrain = new Uint8Array(w * h).fill(fill);
  const variant = new Uint8Array(w * h);
  const biome = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      variant[y * w + x] = Math.floor(hash2(x + originX, y + originY, seed) * 4);
  const rs = 32;
  return {
    w,
    h,
    seed,
    originX,
    originY,
    terrain,
    variant,
    biome,
    props: new Map(),
    regionSize: rs,
    regionsX: Math.max(1, Math.ceil(w / rs)),
    regionsY: Math.max(1, Math.ceil(h / rs)),
  };
}

/** The start chunk's tiles in the map's own coordinates. */
function startSpan(map: GameMap): Span {
  const rs = map.regionSize;
  const { rx, ry } = startRegion(map);
  const x0 = rx * rs;
  const y0 = ry * rs;
  return { x0, y0, x1: Math.min(map.w, x0 + rs), y1: Math.min(map.h, y0 + rs) };
}

/** Majority of each tile's 5x5 neighbourhood (cut off at the edge); a tie keeps the tile's own. */
function smoothBiomes(biome: Uint8Array, w: number, h: number) {
  const copy = new Uint8Array(biome);
  const counts = new Int32Array(6);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - 2);
    const yb = Math.min(h - 1, y + 2);
    counts.fill(0);
    // a window of columns x - 2 .. x + 2 slides along the row
    for (let x = 0; x < Math.min(w, 2); x++)
      for (let yy = ya; yy <= yb; yy++) counts[copy[yy * w + x]]++;
    for (let x = 0; x < w; x++) {
      if (x + 2 < w) for (let yy = ya; yy <= yb; yy++) counts[copy[yy * w + x + 2]]++;
      if (x >= 3) for (let yy = ya; yy <= yb; yy++) counts[copy[yy * w + x - 3]]--;
      const i = y * w + x;
      let best = copy[i];
      for (let k = 0; k < 6; k++) if (counts[k] > counts[best]) best = k;
      biome[i] = best;
    }
  }
}

export function generateMap(seed: number, p: Partial<MapGenParams> = {}): GameMap {
  const params = { ...DEFAULT_MAP_PARAMS, ...p };
  const map = emptyMap(seed, params.w, params.h, Terrain.Grass, params.originX, params.originY);
  const { w: mw, h: mh, regionSize: rs } = map;
  // everything below runs on the field around the map (see MARGIN); its tile (x, y) is world
  // tile (x + ox, y + oy) and map tile (x - MARGIN, y - MARGIN)
  const w = mw + 2 * MARGIN;
  const h = mh + 2 * MARGIN;
  const ox = map.originX - MARGIN;
  const oy = map.originY - MARGIN;
  const field: GameMap = {
    ...map,
    w,
    h,
    originX: ox,
    originY: oy,
    terrain: new Uint8Array(w * h),
    variant: new Uint8Array(w * h),
    biome: new Uint8Array(w * h),
    props: new Map(),
    regionsX: Math.ceil(w / rs),
    regionsY: Math.ceil(h / rs),
  };
  const { terrain, biome } = field;
  const ss = startSpan(map);
  const start: Span = {
    x0: ss.x0 + MARGIN,
    y0: ss.y0 + MARGIN,
    x1: ss.x1 + MARGIN,
    y1: ss.y1 + MARGIN,
  };
  const rng = new Rng(seed);
  const elevSeed = rng.int(1, 1e6);
  const moistSeed = rng.int(1, 1e6);
  const elev = new Float32Array(w * h);
  // the start basin sits in the middle of the start chunk, which keeps its world tiles as the map
  // grows by a ring of chunks on every side
  const scx = start.x0 + rs / 2;
  const scy = start.y0 + rs / 2;
  const elevNoise = fbmBlock(ox, oy, w, h, 22, 0, elevSeed, 5);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let e = elevNoise[y * w + x];
      // smooth basin around the start point so the centre is buildable without a hard edge
      const cd = Math.hypot(x - scx, y - scy) / 26;
      if (cd < 1) {
        const k = 1 - cd * cd * (3 - 2 * cd);
        e = e * (1 - k) + 0.5 * k;
      }
      elev[y * w + x] = e;
    }
  // biome fields: low-frequency temperature and moisture, blended to mild plains/forest
  // conditions around the starting chunk
  const tempSeed = rng.int(1, 1e6);
  const biomeSeed = rng.int(1, 1e6);
  const moist = new Float32Array(w * h);
  const tempNoise = fbmBlock(ox, oy, w, h, 60, 300, tempSeed, 3);
  const moistNoise = fbmBlock(ox, oy, w, h, 14, 100, moistSeed, 4);
  const lowNoise = fbmBlock(ox, oy, w, h, 44, 500, biomeSeed, 3);
  // seas: a separate broad noise, never inside the start zone
  const seaNoise = fbmBlock(ox, oy, w, h, 70, 1200, biomeSeed + 11, 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let t = tempNoise[i];
      let m = moistNoise[i];
      const mLow = lowNoise[i];
      m = m * 0.55 + mLow * 0.45;
      // start chunk: pull towards temperate, moderately moist
      const sd = Math.max(Math.abs(x - scx), Math.abs(y - scy)) / (rs * 0.9);
      const k = sd < 1 ? 1 - sd * sd * (3 - 2 * sd) : 0;
      t = t * (1 - k) + 0.5 * k;
      m = m * (1 - k) + 0.52 * k;
      moist[i] = m;
      const e = elev[i];
      let b: Biome;
      if (k < 0.05 && seaNoise[i] < 0.34) b = Biome.Ocean;
      else if (t > 0.6 && m < 0.5) b = Biome.Desert;
      else if (t < 0.4) b = Biome.Taiga;
      else if (m > 0.6 && e < params.waterLevel + 0.2) b = Biome.Swamp;
      else if (m > 0.56) b = Biome.Forest;
      else b = Biome.Plains;
      biome[i] = b;
    }
  // smooth biome edges: majority of the 5x5 neighbourhood, twice
  smoothBiomes(biome, w, h);
  smoothBiomes(biome, w, h);
  // terrain per biome
  const islandSeed = rng.int(1, 1e6);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      const m = moist[i];
      const b = biome[i] as Biome;
      let t: Terrain;
      if (b === Biome.Ocean) {
        // islands: bumps of a finer noise poke out of the sea
        const isl = fbm((x + ox) / 9 + 900, (y + oy) / 9 + 900, islandSeed, 3);
        if (isl > 0.74) t = isl > 0.8 ? Terrain.Grass : Terrain.Sand;
        else t = Terrain.Water;
      } else if (e < params.waterLevel) t = Terrain.Water;
      else if (e < params.waterLevel + 0.025) t = Terrain.Sand;
      else if (e > params.rockLevel) t = Terrain.Rock;
      else if (e > params.hillLevel) t = b === Biome.Swamp ? Terrain.Grass : Terrain.Hill;
      else
        switch (b) {
          case Biome.Desert:
            t = Terrain.Sand;
            break;
          case Biome.Forest:
            t = m > 0.42 ? Terrain.Forest : Terrain.Grass;
            break;
          case Biome.Taiga:
            t = m > 0.55 ? Terrain.Forest : Terrain.Grass;
            break;
          case Biome.Swamp: {
            const wet = fbm((x + ox) / 5 + 700, (y + oy) / 5 + 700, biomeSeed + 7, 2);
            t = wet > 0.66 ? Terrain.Water : Terrain.Grass;
            break;
          }
          default:
            t = m > params.forestDensity + 0.08 ? Terrain.Forest : Terrain.Grass;
        }
      terrain[i] = t;
    }
  // the 3x3 chunks around the start chunk get a river of their own if none rises in them
  const near: Span = {
    x0: Math.max(0, start.x0 - rs),
    y0: Math.max(0, start.y0 - rs),
    x1: Math.min(w, start.x0 + 2 * rs),
    y1: Math.min(h, start.y0 + 2 * rs),
  };
  carveRivers(field, elev, seed, params.waterLevel, scx, scy, near);
  // clean up lone tiles: majority filter for water/rock singletons
  const copy = new Uint8Array(terrain);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const t = copy[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (copy[(y + dy) * w + x + dx] === t) same++;
        }
      if (same <= 1) terrain[i] = copy[(y + 1) * w + x];
    }
  raiseMountains(field);
  startResources(field, start);
  decorateProps(field, seed, {
    x0: MARGIN,
    y0: MARGIN,
    x1: MARGIN + mw - 1,
    y1: MARGIN + mh - 1,
  });
  placeOilFields(field, seed);
  startDeposits(field, start);
  // crop the map out of the field
  for (let y = 0; y < mh; y++) {
    const from = (y + MARGIN) * w + MARGIN;
    map.terrain.set(terrain.subarray(from, from + mw), y * mw);
    map.biome.set(biome.subarray(from, from + mw), y * mw);
  }
  for (const [i, list] of field.props) {
    const x = (i % w) - MARGIN;
    const y = Math.floor(i / w) - MARGIN;
    if (x >= 0 && y >= 0 && x < mw && y < mh) map.props.set(y * mw + x, list);
  }
  return map;
}

/**
 * Oil fields (full production chain only): rare clusters of puddles on low ground. A field centre
 * is picked by hash on plain grass, sand or swamp, then a blob of 4–9 tiles around it is covered.
 * Fields never touch the starting chunk's centre.
 */
export function placeOilFields(map: GameMap, seed: number) {
  if (supplyMode() !== 'full') return;
  const { w, h, terrain, biome, originX, originY } = map;
  const ok = (i: number) => {
    const t = terrain[i];
    const b = biome[i];
    return b !== Biome.Ocean && (t === Terrain.Grass || t === Terrain.Sand);
  };
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!ok(i)) continue;
      if (hash2(x + originX, y + originY, seed + 12) < 0.9975) continue;
      const rad = 1 + Math.floor(hash2(x + originX, y + originY, seed + 13) * 2);
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const ni = ny * w + nx;
          if (!ok(ni)) continue;
          if (dx * dx + dy * dy > rad * rad + 0.5) continue;
          if (hash2(nx + originX, ny + originY, seed + 14) < 0.25) continue;
          map.props.set(ni, [{ kind: 'oil', variant: (dx + dy + 6) % 3, ox: 0, oy: 0 }]);
        }
    }
}

/**
 * The starting chunk gets at least three oil seeps (full production chain): grass or sand tiles a
 * little way out from the chunk centre, in a fixed order so an expanded map picks the same tiles
 * again. Skipped when the chunk already has them.
 */
export function ensureStartDeposits(map: GameMap) {
  startDeposits(map, startSpan(map));
}
function startDeposits(map: GameMap, s: Span) {
  if (supplyMode() !== 'full') return;
  const cx = s.x0 + map.regionSize / 2;
  const cy = s.y0 + map.regionSize / 2;
  const has = (i: number, kind: PropKind) => map.props.get(i)?.some((p) => p.kind === kind);
  const place = (kind: PropKind, want: number, ok: (t: Terrain, d: number) => boolean) => {
    const cands: { x: number; y: number; d: number }[] = [];
    let have = 0;
    for (let y = s.y0; y < s.y1; y++)
      for (let x = s.x0; x < s.x1; x++) {
        const i = y * map.w + x;
        if (has(i, kind)) {
          have++;
          continue;
        }
        const d = Math.hypot(x - cx, y - cy);
        if (ok(map.terrain[i] as Terrain, d)) cands.push({ x, y, d });
      }
    // nearest first; ties in reading order, which a wider map keeps
    cands.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (let k = 0; have < want && k < cands.length; k += 3, have++) {
      const { x, y } = cands[k];
      const jitter = hash2(x + map.originX, y + map.originY, map.seed + 15);
      map.props.set(y * map.w + x, [{ kind, variant: k % 3, ox: (jitter - 0.5) * 0.3, oy: 0 }]);
    }
  };
  place('oil', 3, (t, d) => (t === Terrain.Grass || t === Terrain.Sand) && d > 6 && d < 13);
}

/**
 * The starting chunk must offer every basic resource: water (pumps), forest (lumber), hill or
 * rock (quarries) and grass (farms). Missing ones are painted as small patches near the chunk's
 * corners, away from the central basin.
 */
export function ensureStartResources(map: GameMap) {
  startResources(map, startSpan(map));
}
function startResources(map: GameMap, s: Span) {
  const { x0, y0, x1, y1 } = s;
  const count = (pred: (t: Terrain) => boolean) => {
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (pred(map.terrain[y * map.w + x] as Terrain)) n++;
    return n;
  };
  const corners = [
    [x0 + 4, y0 + 4],
    [x1 - 5, y0 + 4],
    [x0 + 4, y1 - 5],
    [x1 - 5, y1 - 5],
  ];
  let ci = Math.floor(hash2(map.seed, 3, 41) * 4);
  const paint = (t: Terrain, r: number) => {
    const [cx, cy] = corners[ci % 4];
    ci++;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        if (Math.abs(x - cx) + Math.abs(y - cy) > r + 1) continue;
        map.terrain[y * map.w + x] = t;
      }
  };
  if (count((t) => t === Terrain.Water) < 4) paint(Terrain.Water, 1);
  if (count((t) => t === Terrain.Forest) < 6) paint(Terrain.Forest, 2);
  if (count((t) => t === Terrain.Hill || t === Terrain.Rock) < 4) paint(Terrain.Hill, 1);
  if (count((t) => t === Terrain.Grass) < 20) paint(Terrain.Grass, 3);
}

/**
 * Rivers: one candidate source per world chunk on high ground walks downhill (with a little
 * wander) for at most RIVER_TILES tiles, until it reaches water, carving water; the lower half
 * runs two tiles wide. Deserts dry a river out; the start basin is left alone so the first chunk
 * stays buildable. Every river reads the ground as it was before any river, so rivers never
 * depend on one another and a river that meets another simply follows it downhill. When no
 * river rises in `near`, one starts from the highest ground there away from the start.
 */
function carveRivers(
  map: GameMap,
  elev: Float32Array,
  seed: number,
  waterLevel: number,
  scx: number,
  scy: number,
  near: Span,
) {
  const { w, h, terrain, biome, originX, originY } = map;
  const rs = map.regionSize;
  const ground = new Uint8Array(terrain);
  // tiles on the course being walked, marked with that walk's number
  const onCourse = new Int32Array(w * h);
  let walk = 0;
  /** Walk downhill from a source and carve the water; true when a river of some length resulted. */
  const attempt = (x0: number, y0: number, minLen: number, keepOut: number): boolean => {
    if (x0 < 1 || y0 < 1 || x0 >= w - 1 || y0 >= h - 1) return false;
    const i0 = y0 * w + x0;
    if (biome[i0] === Biome.Ocean || biome[i0] === Biome.Desert) return false;
    if (ground[i0] === Terrain.Water) return false;
    if (Math.hypot(x0 - scx, y0 - scy) < keepOut) return false;
    walk++;
    let x = x0;
    let y = y0;
    const path: number[] = [];
    let dry = 0;
    for (let step = 0; step < RIVER_TILES; step++) {
      path.push(y * w + x);
      onCourse[y * w + x] = walk;
      if (ground[y * w + x] === Terrain.Water && step > 3) break;
      let bx = x;
      let by = y;
      let be = Infinity;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const ni = ny * w + nx;
          if (onCourse[ni] === walk) continue;
          // a little position-fixed noise so rivers meander the same way every time
          const ev = elev[ni] + (hash2(nx + originX, ny + originY, seed + 80) - 0.5) * 0.02;
          if (ev < be) {
            be = ev;
            bx = nx;
            by = ny;
          }
        }
      if (bx === x && by === y) break;
      x = bx;
      y = by;
      if (biome[y * w + x] === Biome.Desert && ++dry > 12) break;
      if (Math.hypot(x - scx, y - scy) < 12) break;
    }
    if (path.length < minLen) return false;
    path.forEach((i, k) => {
      const px = i % w;
      const py = Math.floor(i / w);
      terrain[i] = Terrain.Water;
      if (k > path.length / 2) {
        const j = py * w + Math.min(w - 1, px + 1);
        if (terrain[j] !== Terrain.Water) terrain[j] = Terrain.Water;
      }
    });
    return true;
  };
  const inNear = (x: number, y: number) =>
    x >= near.x0 && y >= near.y0 && x < near.x1 && y < near.y1;
  let nearby = 0;
  // one candidate source per world chunk, fixed by the chunk's world coordinates, so the same
  // rivers reappear wherever the map's edges happen to be
  const cx0 = Math.floor(originX / rs);
  const cy0 = Math.floor(originY / rs);
  const cx1 = Math.floor((originX + w - 1) / rs);
  const cy1 = Math.floor((originY + h - 1) / rs);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      if (hash2(cx, cy, seed + 77) > 0.75) continue;
      const x0 = cx * rs + 4 + Math.floor(hash2(cx, cy, seed + 78) * (rs - 8)) - originX;
      const y0 = cy * rs + 4 + Math.floor(hash2(cx, cy, seed + 79) * (rs - 8)) - originY;
      if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue;
      if (elev[y0 * w + x0] < waterLevel + 0.12) continue;
      if (attempt(x0, y0, 12, 20) && inNear(x0, y0)) nearby++;
    }
  // no river near the start: start one from the highest ground there, away from the start
  if (nearby === 0) {
    const cands: { i: number; e: number }[] = [];
    for (let y = near.y0 + 4; y < near.y1 - 4; y += 3)
      for (let x = near.x0 + 4; x < near.x1 - 4; x += 3) {
        const i = y * w + x;
        if (Math.hypot(x - scx, y - scy) < 20) continue;
        cands.push({ i, e: elev[i] });
      }
    cands.sort((a, b) => b.e - a.e);
    for (const c of cands.slice(0, 40)) if (attempt(c.i % w, Math.floor(c.i / w), 8, 16)) break;
  }
}

/** Large stone fields rise in the middle: rock tiles two deep inside a field become mountains. */
function raiseMountains(map: GameMap) {
  const { w, h, terrain } = map;
  const isRock = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === Terrain.Rock;
  const inner = new Uint8Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? null : new Uint8Array(inner);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (terrain[i] !== Terrain.Rock) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++)
          for (let dx = -1; dx <= 1 && ok; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!isRock(nx, ny)) ok = false;
            else if (src && !src[ny * w + nx]) ok = false;
          }
        inner[i] = ok ? 1 : 0;
      }
  }
  for (let i = 0; i < inner.length; i++) if (inner[i]) terrain[i] = Terrain.Mountain;
}

/**
 * (Re)generate decorative props from the terrain. With a rectangle only those tiles are redone,
 * which is what the editor needs after painting. Deterministic per tile and seed.
 */
export function decorateProps(
  map: GameMap,
  seed: number,
  rect?: { x0: number; y0: number; x1: number; y1: number },
) {
  const w = map.w;
  const h = map.h;
  const terrain = map.terrain;
  const x0 = rect ? Math.max(0, rect.x0) : 0;
  const y0 = rect ? Math.max(0, rect.y0) : 0;
  const x1 = rect ? Math.min(w - 1, rect.x1) : w - 1;
  const y1 = rect ? Math.min(h - 1, rect.y1) : h - 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      map.props.delete(i);
      const t = terrain[i] as Terrain;
      const list: PropInstance[] = [];
      const wx = x + map.originX;
      const wy = y + map.originY;
      const r = hash2(wx, wy, seed + 5);
      const b = map.biome[i] as Biome;
      const put = (kind: PropKind, variants: number, k = 0) =>
        list.push({
          kind,
          variant: Math.floor(hash2(wx + k, wy - k, seed + 9) * variants),
          ox: (hash2(wx * 3 + k, wy, seed + 7) - 0.5) * 0.7,
          oy: (hash2(wx, wy * 3 + k, seed + 8) - 0.5) * 0.7,
        });
      if (t === Terrain.Forest) {
        const n = 1 + Math.floor(hash2(wx, wy, seed + 6) * 2.5);
        for (let k = 0; k < n; k++) {
          const a = hash2(wx * 3 + k, wy, seed + 7);
          let kind: PropKind;
          if (b === Biome.Taiga) kind = a > 0.35 ? 'spruce' : 'pine';
          else if (b === Biome.Swamp) kind = a > 0.6 ? 'deadtree' : a > 0.3 ? 'tree' : 'reeds';
          else if (b === Biome.Plains) kind = a > 0.6 ? 'oak' : a > 0.3 ? 'tree' : 'birch';
          else kind = a > 0.7 ? 'pine' : a > 0.45 ? 'oak' : a > 0.2 ? 'tree' : 'birch';
          put(kind, 3, k);
        }
      } else if (t === Terrain.Grass) {
        if (b === Biome.Swamp) {
          if (r > 0.86) put(r > 0.97 ? 'deadtree' : 'reeds', 2);
        } else if (b === Biome.Taiga) {
          if (r > 0.95) put(r > 0.985 ? 'spruce' : 'bush', 3);
        } else if (b === Biome.Plains) {
          if (r > 0.9) put(r > 0.985 ? 'oak' : r > 0.955 ? 'bush' : 'flowers', r > 0.955 ? 3 : 4);
        } else if (b === Biome.Ocean) {
          if (r > 0.9) put('palm', 2);
        } else if (r > 0.94) put(r > 0.985 ? 'tree' : r > 0.965 ? 'bush' : 'flowers', 3);
      } else if (t === Terrain.Sand) {
        if (b === Biome.Desert) {
          if (r > 0.93) put(r > 0.965 ? 'deadtree' : 'cactus', 3);
        } else if (b === Biome.Ocean && r > 0.9) put('palm', 2);
      }
      // deposits for the full production chain: coal seams crop out on some hills, oil seeps
      // through low ground (swamps, sand and now and then plain grass). Their own hash keeps
      // them independent of the vegetation above.
      if (list.length) map.props.set(i, list);
    }
}
