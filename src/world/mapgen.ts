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

/** Room fbmBlock works in, kept between calls and grown when a block needs more. */
class NoiseRoom {
  cellX = new Int32Array(16);
  smoothX = new Float64Array(16);
  cellY = new Int32Array(16);
  smoothY = new Float64Array(16);
  corners = new Float64Array(64);
}

/**
 * `fbm(wx / scale + offset, wy / scale + offset, seed, octaves)` for every tile of a `w` x `h`
 * block whose first tile is world tile (`x0`, `y0`), row by row into the start of `out`. The
 * values are bit for bit what `fbm` returns, from the same operations in the same order; only the
 * lattice corners are hashed once per block and octave instead of four times per tile.
 */
function fbmBlock(
  out: Float64Array,
  room: NoiseRoom,
  x0: number,
  y0: number,
  w: number,
  h: number,
  scale: number,
  offset: number,
  seed: number,
  octaves: number,
) {
  out.fill(0, 0, w * h);
  if (room.cellX.length < w) {
    room.cellX = new Int32Array(w);
    room.smoothX = new Float64Array(w);
  }
  if (room.cellY.length < h) {
    room.cellY = new Int32Array(h);
    room.smoothY = new Float64Array(h);
  }
  const { cellX, smoothX, cellY, smoothY } = room;
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
      cellY[y] = yi;
      smoothY[y] = fy * fy * (3 - 2 * fy);
    }
    // the lattice corners the block's cells touch, hashed once
    const lx = cellX[0];
    const ly = cellY[0];
    const nx = cellX[w - 1] - lx + 2;
    const ny = cellY[h - 1] - ly + 2;
    if (room.corners.length < nx * ny) room.corners = new Float64Array(nx * ny);
    const corners = room.corners;
    for (let r = 0, k = 0; r < ny; r++)
      for (let c = 0; c < nx; c++, k++) corners[k] = hash2(lx + c, ly + r, s);
    for (let y = 0; y < h; y++) {
      const row = (cellY[y] - ly) * nx - lx;
      const sy = smoothY[y];
      for (let x = 0, i = y * w; x < w; x++, i++) {
        const k = row + cellX[x];
        const a = corners[k];
        const b = corners[k + 1];
        const c = corners[k + nx];
        const d = corners[k + nx + 1];
        const sx = smoothX[x];
        out[i] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  for (let i = 0; i < w * h; i++) out[i] /= norm;
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
/** `s` grown by `d` tiles on every side. */
const grow = (s: Span, d: number): Span => ({
  x0: s.x0 - d,
  y0: s.y0 - d,
  x1: s.x1 + d,
  y1: s.y1 + d,
});

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
 *
 * Only the tiles a pass reads are generated (see Field): everything within LATE_REACH of the map,
 * and out in the margin the blocks along the rivers' courses.
 */
const MARGIN = RIVER_TILES + LATE_REACH + SMOOTH_REACH;

/**
 * The field is generated in square blocks of 2^BLOCK_BITS tiles a side. A block is SMOOTH_REACH
 * tiles wide, so the blocks around a block hold every tile its smoothing reads.
 */
const BLOCK_BITS = 2;
/**
 * How far a block of the field has been generated, each stage on top of the one before. ELEV:
 * the elevation. RAW: moisture and the biome before smoothing. GROUND: the smoothed biome and the
 * terrain before rivers, on a block whose neighbours are at RAW, and so at ELEV.
 */
const ELEV = 1;
const RAW = 2;
const GROUND = 3;

interface FieldSeeds {
  elev: number;
  moist: number;
  temp: number;
  biome: number;
  island: number;
}

/**
 * The planes of the field generateMap works on, generated a block at a time the first time a pass
 * asks for them. A tile's values depend only on its world tile, the seeds, the params and the start
 * basin, never on which blocks were asked for or in what order, so a field generated in part
 * agrees with one generated in full wherever both have values.
 */
class Field {
  /** blocks across and down */
  readonly bw: number;
  readonly bh: number;
  /** each block's stage (ELEV, RAW, GROUND), 0 before any */
  readonly stage: Uint8Array;
  /** elevation, the start basin included */
  readonly elev: Float32Array;
  readonly moist: Float32Array;
  /** the biome before smoothing, after one pass of it, and after both */
  readonly raw: Uint8Array;
  readonly once: Uint8Array;
  readonly biome: Uint8Array;
  /** the terrain before rivers */
  readonly ground: Uint8Array;
  /** room for the noise of the block being generated, one buffer per noise field */
  private readonly scratch: Float64Array[] = [];
  private readonly room = new NoiseRoom();

  constructor(
    readonly w: number,
    readonly h: number,
    /** world tile of the field's tile (0, 0) */
    readonly ox: number,
    readonly oy: number,
    readonly seeds: FieldSeeds,
    readonly params: MapGenParams,
    /** centre of the start chunk, in field tiles */
    readonly scx: number,
    readonly scy: number,
    readonly rs: number,
  ) {
    this.bw = (w + (1 << BLOCK_BITS) - 1) >> BLOCK_BITS;
    this.bh = (h + (1 << BLOCK_BITS) - 1) >> BLOCK_BITS;
    this.stage = new Uint8Array(this.bw * this.bh);
    this.elev = new Float32Array(w * h);
    this.moist = new Float32Array(w * h);
    this.raw = new Uint8Array(w * h);
    this.once = new Uint8Array(w * h);
    this.biome = new Uint8Array(w * h);
    this.ground = new Uint8Array(w * h);
  }

  /** Generates tile (`x`, `y`) up to `stage`. */
  need(x: number, y: number, stage: number) {
    const bx = x >> BLOCK_BITS;
    const by = y >> BLOCK_BITS;
    if (this.stage[by * this.bw + bx] < stage) this.fill(stage, bx, by, bx + 1, by + 1);
  }

  /** Generates every tile of `s` (field tiles, clipped to the field) up to `stage`. */
  needSpan(s: Span, stage: number) {
    const x0 = Math.max(0, s.x0);
    const y0 = Math.max(0, s.y0);
    const x1 = Math.min(this.w, s.x1);
    const y1 = Math.min(this.h, s.y1);
    if (x0 >= x1 || y0 >= y1) return;
    const b = BLOCK_BITS;
    this.fill(stage, x0 >> b, y0 >> b, ((x1 - 1) >> b) + 1, ((y1 - 1) >> b) + 1);
  }

  /** Generates blocks `bx0`..`bx1 - 1`, `by0`..`by1 - 1` (clipped to the field) up to `stage`. */
  private fill(stage: number, bx0: number, by0: number, bx1: number, by1: number) {
    bx0 = Math.max(0, bx0);
    by0 = Math.max(0, by0);
    bx1 = Math.min(this.bw, bx1);
    by1 = Math.min(this.bh, by1);
    if (stage === RAW) this.fill(ELEV, bx0, by0, bx1, by1);
    // smoothing a block reads the biomes up to SMOOTH_REACH tiles around it
    else if (stage === GROUND) this.fill(RAW, bx0 - 1, by0 - 1, bx1 + 1, by1 + 1);
    let todo = 0;
    for (let by = by0; by < by1; by++)
      for (let bx = bx0; bx < bx1; bx++) if (this.stage[by * this.bw + bx] < stage) todo++;
    if (todo === 0) return;
    // a rectangle with nothing at this stage yet in one go, else each row's runs of blocks
    if (todo === (bx1 - bx0) * (by1 - by0)) this.run(stage, bx0, by0, bx1, by1);
    else
      for (let by = by0; by < by1; by++) {
        const row = by * this.bw;
        let bx = bx0;
        while (bx < bx1) {
          if (this.stage[row + bx] >= stage) {
            bx++;
            continue;
          }
          let end = bx + 1;
          while (end < bx1 && this.stage[row + end] < stage) end++;
          this.run(stage, bx, by, end, by + 1);
          bx = end;
        }
      }
  }

  private run(stage: number, bx0: number, by0: number, bx1: number, by1: number) {
    const b = BLOCK_BITS;
    const x0 = bx0 << b;
    const y0 = by0 << b;
    const x1 = Math.min(this.w, bx1 << b);
    const y1 = Math.min(this.h, by1 << b);
    if (stage === ELEV) this.genElev(x0, y0, x1, y1);
    else if (stage === RAW) this.genRaw(x0, y0, x1, y1);
    else this.genGround(x0, y0, x1, y1);
    for (let by = by0; by < by1; by++)
      this.stage.fill(stage, by * this.bw + bx0, by * this.bw + bx1);
  }

  /** `fbmBlock` over field tiles `x0`..`x1 - 1`, `y0`..`y1 - 1`, into scratch buffer `k`. */
  private noise(
    k: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    scale: number,
    offset: number,
    seed: number,
    octaves: number,
  ): Float64Array {
    const n = (x1 - x0) * (y1 - y0);
    if (!(this.scratch[k]?.length >= n)) this.scratch[k] = new Float64Array(n);
    const out = this.scratch[k];
    const { ox, oy, room } = this;
    fbmBlock(out, room, ox + x0, oy + y0, x1 - x0, y1 - y0, scale, offset, seed, octaves);
    return out;
  }

  private genElev(x0: number, y0: number, x1: number, y1: number) {
    const { w, scx, scy, elev } = this;
    const noise = this.noise(0, x0, y0, x1, y1, 22, 0, this.seeds.elev, 5);
    for (let y = y0, j = 0; y < y1; y++)
      for (let x = x0; x < x1; x++, j++) {
        let e = noise[j];
        // smooth basin around the start point so the centre is buildable without a hard edge;
        // a tile 27 or more out is past its rim whatever hypot rounds to
        const dx = x - scx;
        const dy = y - scy;
        if (dx * dx + dy * dy < 27 * 27) {
          const cd = Math.hypot(dx, dy) / 26;
          if (cd < 1) {
            const k = 1 - cd * cd * (3 - 2 * cd);
            e = e * (1 - k) + 0.5 * k;
          }
        }
        elev[y * w + x] = e;
      }
  }

  /** Biome fields: low-frequency temperature and moisture, blended to mild plains/forest
   *  conditions around the starting chunk. */
  private genRaw(x0: number, y0: number, x1: number, y1: number) {
    const { w, scx, scy, rs, elev, moist, raw, seeds } = this;
    const waterLevel = this.params.waterLevel;
    const tempNoise = this.noise(0, x0, y0, x1, y1, 60, 300, seeds.temp, 3);
    const moistNoise = this.noise(1, x0, y0, x1, y1, 14, 100, seeds.moist, 4);
    const lowNoise = this.noise(2, x0, y0, x1, y1, 44, 500, seeds.biome, 3);
    // seas: a separate broad noise, never inside the start zone
    const seaNoise = this.noise(3, x0, y0, x1, y1, 70, 1200, seeds.biome + 11, 3);
    for (let y = y0, j = 0; y < y1; y++)
      for (let x = x0; x < x1; x++, j++) {
        const i = y * w + x;
        let t = tempNoise[j];
        let m = moistNoise[j];
        const mLow = lowNoise[j];
        m = m * 0.55 + mLow * 0.45;
        // start chunk: pull towards temperate, moderately moist
        const sd = Math.max(Math.abs(x - scx), Math.abs(y - scy)) / (rs * 0.9);
        const k = sd < 1 ? 1 - sd * sd * (3 - 2 * sd) : 0;
        t = t * (1 - k) + 0.5 * k;
        m = m * (1 - k) + 0.52 * k;
        moist[i] = m;
        const e = elev[i];
        let b: Biome;
        if (k < 0.05 && seaNoise[j] < 0.34) b = Biome.Ocean;
        else if (t > 0.6 && m < 0.5) b = Biome.Desert;
        else if (t < 0.4) b = Biome.Taiga;
        else if (m > 0.6 && e < waterLevel + 0.2) b = Biome.Swamp;
        else if (m > 0.56) b = Biome.Forest;
        else b = Biome.Plains;
        raw[i] = b;
      }
  }

  /** Smooths the biome edges and lays the terrain each biome makes. */
  private genGround(x0: number, y0: number, x1: number, y1: number) {
    const { w, h, ox, oy, elev, moist, biome, ground, params, seeds } = this;
    // majority of the 5x5 neighbourhood, twice; the first pass reaches 2 tiles further
    smoothBiomes(this.raw, this.once, w, h, grow({ x0, y0, x1, y1 }, 2));
    smoothBiomes(this.once, biome, w, h, { x0, y0, x1, y1 });
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const e = elev[i];
        const m = moist[i];
        const b = biome[i] as Biome;
        let t: Terrain;
        if (b === Biome.Ocean) {
          // islands: bumps of a finer noise poke out of the sea
          const isl = fbm((x + ox) / 9 + 900, (y + oy) / 9 + 900, seeds.island, 3);
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
              const wet = fbm((x + ox) / 5 + 700, (y + oy) / 5 + 700, seeds.biome + 7, 2);
              t = wet > 0.66 ? Terrain.Water : Terrain.Grass;
              break;
            }
            default:
              t = m > params.forestDensity + 0.08 ? Terrain.Forest : Terrain.Grass;
          }
        ground[i] = t;
      }
  }
}

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

/**
 * Each tile of `s` (clipped to the `w` x `h` plane) gets the majority biome of its 5x5
 * neighbourhood in `src`, cut off at the plane's edge; a tie keeps the tile's own.
 */
function smoothBiomes(src: Uint8Array, dst: Uint8Array, w: number, h: number, s: Span) {
  const x0 = Math.max(0, s.x0);
  const x1 = Math.min(w, s.x1);
  const counts = new Int32Array(6);
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++) {
    const ya = Math.max(0, y - 2);
    const yb = Math.min(h - 1, y + 2);
    counts.fill(0);
    // a window of columns x - 2 .. x + 2 slides along the row, starting one column before x0
    for (let x = Math.max(0, x0 - 3); x < Math.min(w, x0 + 2); x++)
      for (let yy = ya; yy <= yb; yy++) counts[src[yy * w + x]]++;
    for (let x = x0; x < x1; x++) {
      if (x + 2 < w) for (let yy = ya; yy <= yb; yy++) counts[src[yy * w + x + 2]]++;
      if (x >= 3) for (let yy = ya; yy <= yb; yy++) counts[src[yy * w + x - 3]]--;
      const i = y * w + x;
      let best = src[i];
      for (let k = 0; k < 6; k++) if (counts[k] > counts[best]) best = k;
      dst[i] = best;
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
  const ss = startSpan(map);
  const start: Span = {
    x0: ss.x0 + MARGIN,
    y0: ss.y0 + MARGIN,
    x1: ss.x1 + MARGIN,
    y1: ss.y1 + MARGIN,
  };
  const rng = new Rng(seed);
  // the order they are drawn in is part of every seed's world
  const seeds: FieldSeeds = {
    elev: rng.int(1, 1e6),
    moist: rng.int(1, 1e6),
    temp: rng.int(1, 1e6),
    biome: rng.int(1, 1e6),
    island: rng.int(1, 1e6),
  };
  // the start basin sits in the middle of the start chunk, which keeps its world tiles as the map
  // grows by a ring of chunks on every side
  const scx = start.x0 + rs / 2;
  const scy = start.y0 + rs / 2;
  const f = new Field(w, h, ox, oy, seeds, params, scx, scy, rs);
  // the passes after the rivers run on the map and the tiles around it they read, each on a band
  // narrower than the one it reads: the terrain LATE_REACH tiles out, the cleanup a tile less,
  // the mountains and the oil field centres 2 tiles out
  const inMap: Span = { x0: MARGIN, y0: MARGIN, x1: MARGIN + mw, y1: MARGIN + mh };
  const late = grow(inMap, LATE_REACH);
  f.needSpan(late, GROUND);
  // the 3x3 chunks around the start chunk get a river of their own if none rises in them
  const near: Span = {
    x0: Math.max(0, start.x0 - rs),
    y0: Math.max(0, start.y0 - rs),
    x1: Math.min(w, start.x0 + 2 * rs),
    y1: Math.min(h, start.y0 + 2 * rs),
  };
  // a river tile can carve the one east of it too
  const carved = carveRivers(f, seed, scx, scy, near, grow(late, 1));
  const terrain = new Uint8Array(w * h);
  for (let y = late.y0; y < late.y1; y++)
    for (let x = late.x0; x < late.x1; x++) {
      const i = y * w + x;
      terrain[i] = carved[i] ? Terrain.Water : f.ground[i];
    }
  // clean up lone tiles: majority filter for water/rock singletons
  const copy = new Uint8Array(terrain);
  const tidy = grow(late, -1);
  for (let y = tidy.y0; y < tidy.y1; y++)
    for (let x = tidy.x0; x < tidy.x1; x++) {
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
  const field: GameMap = {
    ...map,
    w,
    h,
    originX: ox,
    originY: oy,
    terrain,
    variant: new Uint8Array(w * h),
    biome: f.biome,
    props: new Map(),
    regionsX: Math.ceil(w / rs),
    regionsY: Math.ceil(h / rs),
  };
  // an oil field reaches 2 tiles from its centre and reads the terrain under it
  const oilCentres = grow(inMap, 2);
  raiseMountains(field, oilCentres);
  startResources(field, start);
  // crop the map out of the field
  for (let y = 0; y < mh; y++) {
    const from = (y + MARGIN) * w + MARGIN;
    map.terrain.set(terrain.subarray(from, from + mw), y * mw);
    map.biome.set(f.biome.subarray(from, from + mw), y * mw);
  }
  decorateProps(map, seed);
  // the deposits read the field around the map; they go over the map's props, the oil fields
  // first, as if all three had been laid on the field (decorations are never oil)
  oilFields(field, seed, oilCentres);
  startDeposits(field, start);
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
  oilFields(map, seed, { x0: 0, y0: 0, x1: map.w, y1: map.h });
}
/** placeOilFields with the field centres limited to the tiles of `s`. */
function oilFields(map: GameMap, seed: number, s: Span) {
  if (supplyMode() !== 'full') return;
  const { w, h, terrain, biome, originX, originY } = map;
  const ok = (i: number) => {
    const t = terrain[i];
    const b = biome[i];
    return b !== Biome.Ocean && (t === Terrain.Grass || t === Terrain.Sand);
  };
  for (let y = Math.max(2, s.y0); y < Math.min(h - 2, s.y1); y++)
    for (let x = Math.max(2, s.x0); x < Math.min(w - 2, s.x1); x++) {
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
 *
 * Returns the carved tiles as 1s on the field, exact within `reach` (where a carved tile can
 * matter): a river is carved only when its course comes within `reach`, and one that never does is
 * walked only as far as its answer needs. The rivers generate the field's blocks along their
 * courses as they walk them.
 */
function carveRivers(
  f: Field,
  seed: number,
  scx: number,
  scy: number,
  near: Span,
  reach: Span,
): Uint8Array {
  const { w, h, ox: originX, oy: originY, rs, elev, biome, ground } = f;
  const waterLevel = f.params.waterLevel;
  const carved = new Uint8Array(w * h);
  // tiles on the course being walked, marked with that walk's number
  const onCourse = new Int32Array(w * h);
  let walk = 0;
  /** Tiles from (x, y) to `reach`, 0 inside it. */
  const away = (x: number, y: number) =>
    Math.max(reach.x0 - x, x - reach.x1 + 1, reach.y0 - y, y - reach.y1 + 1, 0);
  const inNear = (x: number, y: number) =>
    x >= near.x0 && y >= near.y0 && x < near.x1 && y < near.y1;
  /**
   * Walk downhill from a source and carve the water; true when a river of some length resulted.
   * That answer is used only for a source in `near`, so a river that can no longer come within
   * `reach` is left where it is: from any other source at once, from one in `near` once it is
   * long enough to count.
   */
  const attempt = (x0: number, y0: number, minLen: number, keepOut: number): boolean => {
    if (x0 < 1 || y0 < 1 || x0 >= w - 1 || y0 >= h - 1) return false;
    if (Math.hypot(x0 - scx, y0 - scy) < keepOut) return false;
    const settled = inNear(x0, y0) ? minLen : 0;
    if (settled === 0 && away(x0, y0) >= RIVER_TILES) return false;
    // a tile at GROUND has the elevation of every tile around it too
    f.need(x0, y0, GROUND);
    const i0 = y0 * w + x0;
    if (biome[i0] === Biome.Ocean || biome[i0] === Biome.Desert) return false;
    if (ground[i0] === Terrain.Water) return false;
    walk++;
    let x = x0;
    let y = y0;
    const path: number[] = [];
    let dry = 0;
    let matters = false;
    for (let step = 0; step < RIVER_TILES; step++) {
      path.push(y * w + x);
      onCourse[y * w + x] = walk;
      // the rest of the course is at most RIVER_TILES - 1 - step tiles long
      const d = away(x, y);
      if (d === 0) matters = true;
      else if (!matters && d >= RIVER_TILES - step && path.length >= settled) return true;
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
      f.need(x, y, GROUND);
      if (biome[y * w + x] === Biome.Desert && ++dry > 12) break;
      if (Math.hypot(x - scx, y - scy) < 12) break;
    }
    if (path.length < minLen) return false;
    if (matters)
      path.forEach((i, k) => {
        const px = i % w;
        const py = Math.floor(i / w);
        carved[i] = 1;
        if (k > path.length / 2) carved[py * w + Math.min(w - 1, px + 1)] = 1;
      });
    return true;
  };
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
      f.need(x0, y0, ELEV);
      if (elev[y0 * w + x0] < waterLevel + 0.12) continue;
      if (attempt(x0, y0, 12, 20) && inNear(x0, y0)) nearby++;
    }
  // no river near the start: start one from the highest ground there, away from the start
  if (nearby === 0) {
    f.needSpan(near, ELEV);
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
  return carved;
}

/**
 * Large stone fields rise in the middle: rock tiles two deep inside a field become mountains, on
 * the tiles of `s` (which reads the rock 2 tiles around it).
 */
function raiseMountains(map: GameMap, s: Span) {
  const { w, h, terrain } = map;
  const isRock = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === Terrain.Rock;
  const inner = new Uint8Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? null : new Uint8Array(inner);
    // the first pass reaches a tile further, for the second to read
    const r = grow(s, 1 - pass);
    for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++)
      for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) {
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
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0); x < Math.min(w, s.x1); x++)
      if (inner[y * w + x]) terrain[y * w + x] = Terrain.Mountain;
}

/**
 * The `k`th prop on world tile (`wx`, `wy`); `a` is the tile's hash2(wx * 3 + k, wy, seed + 7),
 * which also places the prop sideways.
 */
function prop(
  kind: PropKind,
  variants: number,
  wx: number,
  wy: number,
  seed: number,
  k: number,
  a: number,
): PropInstance {
  return {
    kind,
    variant: Math.floor(hash2(wx + k, wy - k, seed + 9) * variants),
    ox: (a - 0.5) * 0.7,
    oy: (hash2(wx, wy * 3 + k, seed + 8) - 0.5) * 0.7,
  };
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
  const { w, h, terrain, biome } = map;
  const x0 = rect ? Math.max(0, rect.x0) : 0;
  const y0 = rect ? Math.max(0, rect.y0) : 0;
  const x1 = rect ? Math.min(w - 1, rect.x1) : w - 1;
  const y1 = rect ? Math.min(h - 1, rect.y1) : h - 1;
  // a map with no props has none to clear
  const clear = map.props.size > 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (clear) map.props.delete(i);
      const t = terrain[i] as Terrain;
      if (t !== Terrain.Forest && t !== Terrain.Grass && t !== Terrain.Sand) continue;
      const wx = x + map.originX;
      const wy = y + map.originY;
      const b = biome[i] as Biome;
      if (t === Terrain.Forest) {
        const n = 1 + Math.floor(hash2(wx, wy, seed + 6) * 2.5);
        const list: PropInstance[] = [];
        for (let k = 0; k < n; k++) {
          const a = hash2(wx * 3 + k, wy, seed + 7);
          let kind: PropKind;
          if (b === Biome.Taiga) kind = a > 0.35 ? 'spruce' : 'pine';
          else if (b === Biome.Swamp) kind = a > 0.6 ? 'deadtree' : a > 0.3 ? 'tree' : 'reeds';
          else if (b === Biome.Plains) kind = a > 0.6 ? 'oak' : a > 0.3 ? 'tree' : 'birch';
          else kind = a > 0.7 ? 'pine' : a > 0.45 ? 'oak' : a > 0.2 ? 'tree' : 'birch';
          list.push(prop(kind, 3, wx, wy, seed, k, a));
        }
        map.props.set(i, list);
        continue;
      }
      // grass and sand: now and then one prop
      const r = hash2(wx, wy, seed + 5);
      let kind: PropKind | null = null;
      let variants = 3;
      if (t === Terrain.Grass) {
        if (b === Biome.Swamp) {
          if (r > 0.86) {
            kind = r > 0.97 ? 'deadtree' : 'reeds';
            variants = 2;
          }
        } else if (b === Biome.Taiga) {
          if (r > 0.95) kind = r > 0.985 ? 'spruce' : 'bush';
        } else if (b === Biome.Plains) {
          if (r > 0.9) {
            kind = r > 0.985 ? 'oak' : r > 0.955 ? 'bush' : 'flowers';
            variants = r > 0.955 ? 3 : 4;
          }
        } else if (b === Biome.Ocean) {
          if (r > 0.9) {
            kind = 'palm';
            variants = 2;
          }
        } else if (r > 0.94) kind = r > 0.985 ? 'tree' : r > 0.965 ? 'bush' : 'flowers';
      } else if (b === Biome.Desert) {
        if (r > 0.93) kind = r > 0.965 ? 'deadtree' : 'cactus';
      } else if (b === Biome.Ocean && r > 0.9) {
        kind = 'palm';
        variants = 2;
      }
      if (kind)
        map.props.set(i, [prop(kind, variants, wx, wy, seed, 0, hash2(wx * 3, wy, seed + 7))]);
    }
}
