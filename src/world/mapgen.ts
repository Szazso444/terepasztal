import { Rng, hash2 } from '../engine/rng';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import { DEFAULT_SUPPLY, type SupplyMode } from '../sim/supply';
import {
  Terrain,
  Biome,
  CLIMATES,
  climateAtIndex,
  lowGround,
  startRegion,
  type GameMap,
  type PropInstance,
  type PropKind,
} from './tiles';
import { DRY, FLOW_CAP, KEEP_OUT, LAKE_CLEARANCE, LOW, WaterKind, drain } from './rivers';
import { markWaterfalls } from './waterfalls';
import { tileLevels } from './elevation';
import { NoiseRoom, fbm, fbmBlock } from './noise';
import {
  SCULPT_REACH,
  coverMountains,
  massifLift,
  massifWander,
  sculptMountains,
} from './mountains';

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

/**
 * The longest stream beyond the river region, in tiles of its course. Bounding it is what keeps
 * `MARGIN` finite.
 */
const RIVER_TILES = 64;
/**
 * The river region: the chunks this many chunks or fewer from the start chunk along either axis,
 * a square of 11 x 11 chunks (352 tiles a side) with the start chunk in its middle: a new world of
 * the default size (5 x 5 chunks) and three rings of growth, or a new world up to 352 tiles a
 * side. Its rivers and lakes are planned once, tile by tile, over the whole square (riverPlan);
 * beyond it rivers are short streams (riverWater). Planning costs time in proportion to its area,
 * once a world.
 */
const REGION_CHUNKS = 5;
/**
 * The ground the plan generates around the region: the drainage reads two tiles around it, the
 * lone-tile cleanup one more, and the ground is exact SMOOTH_REACH tiles inside a field's edge.
 */
const PLAN_MARGIN = 2 + 1 + 4;
/**
 * Nearer than this to the start chunk's centre, in tiles, no rain falls, no river rises or runs and
 * no basin fills, so the start stays buildable (rivers stopped 12 tiles out before). The ground's
 * own water there stays, a lake like any other, overflowing outwards.
 */
const START_KEEP_OUT = 13;
/** River plans kept for the next maps of the same world (a growing map asks again). */
const PLAN_CACHE = 4;
/** How far biome smoothing reads: two passes of a 5x5 majority. */
const SMOOTH_REACH = 4;
/**
 * How far a rock tile looks for the mountain of its field, in steps: a Rock tile is in the
 * Mountain biome when a path of at most this many steps across tile sides, over Rock and Mountain
 * only, reaches a Mountain tile. A field of rock has no bound of its own (at a low Rock level it
 * runs on and on), so the whole field would make a tile's biome depend on how far the map
 * reaches; this bound keeps it to the tiles near it. Over 20 worlds of 160 x 160 at the default
 * sliders, 54 of the 3491 rock tiles of fields that hold a mountain lie further out and keep their
 * climate. The terrain this reads lies within LATE_REACH of the map, and so the margin.
 */
export const MOUNTAIN_REACH = 12;
/**
 * How far around the map mountains are made and covered: MOUNTAIN_REACH for the Mountain biome to
 * find them, and 2 for the Rock around a Mountain tile (coverMountains) to reach those tiles.
 */
const MOUNTAIN_FIELD = MOUNTAIN_REACH + 2;
/** How far sand reads as Beach from the sea water it lies by, in tiles along either axis. */
export const BEACH_REACH = 2;
/**
 * How far the passes after the rivers read: the sculpt SCULPT_REACH around the tiles it raises,
 * which are the tiles the mountains stand on (MOUNTAIN_FIELD) and one more for the cover to read.
 * The sea shore needs less: the shore 1, oil and wheat fields 4 (a centre 2 out, 2 more for the
 * field, WHEAT_REACH).
 */
const LATE_REACH = MOUNTAIN_FIELD + 1 + SCULPT_REACH;
/**
 * Generation runs on a field this many tiles wider than the map on every side, and the map is
 * cropped out of it, so no pass ever sees the map's own edge: a tile comes out the same whatever
 * the map's size and origin, and a map that grows keeps every tile it had.
 *
 * Biomes, and so the ground, are exact more than SMOOTH_REACH tiles inside the field's edge. In
 * the river region the water comes from its plan, which is the same for every map. Beyond it, a
 * stream that runs within LATE_REACH of the map lies wholly within LATE_REACH + RIVER_TILES of it,
 * on exact ground, so it is walked exactly as on an endless map; a stream that strays onto inexact
 * ground is too far out to run anywhere that matters.
 *
 * Only the tiles a pass reads are generated (see Field): everything within LATE_REACH of the map,
 * and out in the margin the blocks along the streams' courses.
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
  massif: number;
}

/** The moisture above which climate `b` grows a forest; on the plains it is the map's slider. */
function forestMoisture(b: Biome, forestDensity: number): number {
  if (b === Biome.Forest) return 0.42;
  if (b === Biome.Taiga) return 0.55;
  return forestDensity + 0.08;
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

  /**
   * Takes from `src`, a field of the same world (seeds, params and start) generated in full at
   * GROUND, every block of this field whose tiles lie more than SMOOTH_REACH inside `src`'s edge,
   * where its values are exact: the same values this field would generate, copied instead.
   */
  adopt(src: Field) {
    const b = BLOCK_BITS;
    // this field's tile (x, y) is src's tile (x + dx, y + dy)
    const dx = this.ox - src.ox;
    const dy = this.oy - src.oy;
    const bx0 = Math.max(0, (SMOOTH_REACH - dx + (1 << b) - 1) >> b);
    const by0 = Math.max(0, (SMOOTH_REACH - dy + (1 << b) - 1) >> b);
    const bx1 = Math.min(this.bw, (src.w - SMOOTH_REACH - dx) >> b);
    const by1 = Math.min(this.bh, (src.h - SMOOTH_REACH - dy) >> b);
    if (bx0 >= bx1 || by0 >= by1) return;
    const x0 = bx0 << b;
    const x1 = Math.min(this.w, bx1 << b);
    for (let y = by0 << b; y < Math.min(this.h, by1 << b); y++) {
      const to = y * this.w + x0;
      const from = (y + dy) * src.w + x0 + dx;
      const n = x1 - x0;
      this.elev.set(src.elev.subarray(from, from + n), to);
      this.moist.set(src.moist.subarray(from, from + n), to);
      this.raw.set(src.raw.subarray(from, from + n), to);
      this.once.set(src.once.subarray(from, from + n), to);
      this.biome.set(src.biome.subarray(from, from + n), to);
      this.ground.set(src.ground.subarray(from, from + n), to);
    }
    for (let by = by0; by < by1; by++)
      this.stage.fill(GROUND, by * this.bw + bx0, by * this.bw + bx1);
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
    const { w, ox, oy, scx, scy, elev, seeds } = this;
    const noise = this.noise(0, x0, y0, x1, y1, 22, 0, seeds.elev, 5);
    for (let y = y0, j = 0; y < y1; y++)
      for (let x = x0; x < x1; x++, j++) {
        const dx = x - scx;
        const dy = y - scy;
        let e = noise[j] + massifLift(x + ox, y + oy, dx, dy, seeds.massif);
        // smooth basin around the start point so the centre is buildable without a hard edge;
        // a tile 27 or more out is past its rim whatever hypot rounds to
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
        else if (
          b === Biome.Swamp &&
          fbm((x + ox) / 5 + 700, (y + oy) / 5 + 700, seeds.biome + 7, 2) > 0.66
        )
          t = Terrain.Water;
        else t = lowGround(b, m > forestMoisture(b, params.forestDensity));
        ground[i] = t;
      }
  }

  /**
   * The land a tile at GROUND would be with its water taken away (the river pass dries a pond too
   * small to be a lake): genGround's own rules with every rule that makes water left out, and the
   * ground below the water line read as the sand at its shore.
   */
  landAt(i: number): Terrain {
    const { params } = this;
    const e = this.elev[i];
    const m = this.moist[i];
    const b = this.biome[i] as Biome;
    if (e < params.waterLevel + 0.025) return Terrain.Sand;
    if (e > params.rockLevel) return Terrain.Rock;
    if (e > params.hillLevel) return b === Biome.Swamp ? Terrain.Grass : Terrain.Hill;
    return lowGround(b, m > forestMoisture(b, params.forestDensity));
  }
}

/**
 * The ground of `src` (`w` x `h`) with lone tiles cleaned up on the tiles of `s`: a tile with at
 * most one of its eight neighbours of its own terrain takes the terrain of the tile below it. Reads
 * the tiles 1 around `s`; a new plane, `src` outside `s`.
 */
function tidyGround(src: Uint8Array, w: number, h: number, s: Span): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = Math.max(1, s.y0); y < Math.min(h - 1, s.y1); y++)
    for (let x = Math.max(1, s.x0); x < Math.min(w - 1, s.x1); x++) {
      const i = y * w + x;
      const t = src[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (src[(y + dy) * w + x + dx] === t) same++;
        }
      if (same <= 1) out[i] = src[i + w];
    }
  return out;
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
 * neighbourhood in `src`, cut off at the plane's edge; a tie keeps the tile's own. The biomes are
 * climates, ids 0 to CLIMATES - 1: the biome rules relabel tiles only after smoothing.
 */
function smoothBiomes(src: Uint8Array, dst: Uint8Array, w: number, h: number, s: Span) {
  const x0 = Math.max(0, s.x0);
  const x1 = Math.min(w, s.x1);
  // a local, not the import: an imported binding read in the loop below slows smoothing manifold
  const kinds = CLIMATES;
  const counts = new Int32Array(kinds);
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
      for (let k = 0; k < kinds; k++) if (counts[k] > counts[best]) best = k;
      dst[i] = best;
    }
  }
}

/**
 * The world of `seed`. `supply` is the production chain the game will run: the terrain, biome,
 * climate and variant planes and the decorations are the same for both, and only the full chain
 * adds oil fields and the start chunk's seeps over the props. It is an argument, not a map
 * parameter, so it never reaches the saved `MapGenParams`.
 */
export function generateMap(
  seed: number,
  p: Partial<MapGenParams> = {},
  supply: SupplyMode = DEFAULT_SUPPLY,
): GameMap {
  return generateMapPlanes(seed, p, supply).map;
}

/**
 * generateMap's map with planes its biome rules read, as tiles of the map, for tests. The river
 * pass's own output is `river` and `lake` with the map's waterSurface, flow and flowDir planes;
 * the map's feature plane holds the waterfalls read off them (waterfalls.ts).
 */
export interface MapPlanes {
  map: GameMap;
  /**
   * 1 on each tile the river pass made river, 0 elsewhere. Only land is made river: a river's way
   * over water that was there before (into a lake or the sea) stays that water. The start chunk's
   * patches never paint over a river.
   */
  river: Uint8Array;
  /**
   * 1 on each tile the river pass made or kept a lake: in the river region every lake there is (a
   * basin filled to its rim, the ground's own inland water, the start chunk's pond), beyond it the
   * pond a stream ends in. The ground's water beyond the region is not marked, and neither is a
   * lake's tile the start chunk's patches paint land over.
   */
  lake: Uint8Array;
  /** the terrain before the sea shore turned to sand (seaShore) */
  shore: Uint8Array;
  /** the seed of the world's massifs and shapes (massifAt, shapeAt) */
  massifSeed: number;
}

/** generateMap, with the planes of MapPlanes. */
export function generateMapPlanes(
  seed: number,
  p: Partial<MapGenParams> = {},
  supply: SupplyMode = DEFAULT_SUPPLY,
): MapPlanes {
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
  // the order they are drawn in is part of every seed's world; a new seed is drawn after these
  const seeds: FieldSeeds = {
    elev: rng.int(1, 1e6),
    moist: rng.int(1, 1e6),
    temp: rng.int(1, 1e6),
    biome: rng.int(1, 1e6),
    island: rng.int(1, 1e6),
    massif: rng.int(1, 1e6),
  };
  // the start basin sits in the middle of the start chunk, which keeps its world tiles as the map
  // grows by a ring of chunks on every side
  const scx = start.x0 + rs / 2;
  const scy = start.y0 + rs / 2;
  const f = new Field(w, h, ox, oy, seeds, params, scx, scy, rs);
  // the passes after the rivers run on the map and the tiles around it they read, each on a band
  // narrower than the one it reads: the terrain LATE_REACH tiles out, the mountains MOUNTAIN_FIELD
  // tiles out, the sea shore 4 and the oil and wheat field centres 2
  const inMap: Span = { x0: MARGIN, y0: MARGIN, x1: MARGIN + mw, y1: MARGIN + mh };
  const late = grow(inMap, LATE_REACH);
  const plan = riverPlan(seed, seeds, params, start.x0 + ox, start.y0 + oy, rs);
  // the ground the plan generated, where it holds this field's, is taken rather than made again
  if (plan.field) f.adopt(plan.field);
  // the lone-tile cleanup reads a tile around: water and rock singletons take the tile below
  f.needSpan(grow(late, 1), GROUND);
  const ground = tidyGround(f.ground, w, h, late);
  const water = riverWater(f, ground, plan, seed, late);
  const terrain = new Uint8Array(w * h);
  const river = new Uint8Array(w * h);
  const lake = new Uint8Array(w * h);
  for (let y = late.y0; y < late.y1; y++)
    for (let x = late.x0; x < late.x1; x++) {
      const i = y * w + x;
      const k = water.kind[i];
      if (k === WaterKind.River) river[i] = 1;
      if (k === WaterKind.Lake) lake[i] = 1;
      if (k === WaterKind.River || k === WaterKind.Lake) terrain[i] = Terrain.Water;
      else if (k === WaterKind.Dry) terrain[i] = f.landAt(i);
      else terrain[i] = ground[i];
    }
  const field: GameMap = {
    ...map,
    w,
    h,
    originX: ox,
    originY: oy,
    terrain,
    waterSurface: water.surface,
    variant: new Uint8Array(w * h),
    // the climate, until the biome rules relabel the map's tiles
    biome: f.biome,
    climate: f.biome,
    props: new Map(),
    regionsX: Math.ceil(w / rs),
    regionsY: Math.ceil(h / rs),
  };
  // an oil field reaches 2 tiles from its centre and reads the terrain under it
  const oilCentres = grow(inMap, 2);
  const mountains = grow(inMap, MOUNTAIN_FIELD);
  raiseMountains(field, mountains);
  // the cover reads the levels a tile around the tiles it covers
  const keepClear = grow(start, 4);
  const raised = sculptMountains(field, grow(mountains, 1), keepClear, seeds.massif);
  coverMountains(field, raised, mountains, keepClear, seeds.massif, params);
  startResources(field, start, { pond: plan.pond, river });
  // a patch painted over a lake's tile leaves land there
  for (let y = start.y0; y < start.y1; y++)
    for (let x = start.x0; x < start.x1; x++)
      if (terrain[y * w + x] !== Terrain.Water) lake[y * w + x] = 0;
  // the level the tile's ground and water give it, or the mountain's where that is higher: each
  // keeps neighbours within 4, so the plane holds settled levels
  const levels = tileLevels(field);
  for (let i = 0; i < w * h; i++) if (raised[i] > levels[i]) levels[i] = raised[i];
  const shore = cropPlane(terrain, w, mw, mh);
  // After the start chunk's patches, which it never reaches: the Ocean climate lies at least 5
  // tiles outside the start chunk (genRaw keeps the sea out of the start zone, and smoothing moves
  // it 4 tiles at most), so no tile of the chunk or beside it has sea water on a side. The oil and
  // wheat fields read the terrain 4 tiles out.
  const shoreSpan = grow(oilCentres, 2);
  const pass = river.map((r, i) => r | lake[i]);
  const sea = seaWater(field, pass, grow(shoreSpan, 1));
  seaShore(field, sea, shoreSpan);
  field.biome = biomeRules(field, river, sea, inMap);
  // the waterfalls of the map's tiles, read on the field, where a river tile at the map's edge has
  // the tile it runs into
  const feature = new Uint8Array(w * h);
  markWaterfalls(
    { w, h, terrain, waterSurface: water.surface, flowDir: water.dir },
    feature,
    inMap,
  );
  // crop the map out of the field
  map.terrain = cropPlane(terrain, w, mw, mh);
  map.biome = cropPlane(field.biome, w, mw, mh);
  map.climate = cropPlane(f.biome, w, mw, mh);
  map.generatedLevel = cropPlane(levels, w, mw, mh);
  map.waterSurface = cropPlane(water.surface, w, mw, mh);
  map.flow = cropPlane(water.flow, w, mw, mh);
  map.flowDir = cropPlane(water.dir, w, mw, mh);
  map.feature = cropPlane(feature, w, mw, mh);
  decorateProps(map, seed);
  // the fields and deposits read the field around the map; they go over the map's props, the
  // wheat fields, then the oil fields, then the start seeps, as if all four had been laid on the
  // field (decorations are never wheat or oil). The oil is worked out first, as the full chain
  // lays it, for the wheat to keep off in either chain: oil never cuts a field, and both chains
  // grow the same wheat.
  const oil: GameMap = { ...field, props: new Map() };
  oilFields(oil, seed, oilCentres, 'full');
  startDeposits(oil, start, 'full');
  wheatFields(field, seed, oilCentres, scx, scy, oil.props);
  if (supply === 'full') for (const [i, list] of oil.props) field.props.set(i, list);
  for (const [i, list] of field.props) {
    const x = (i % w) - MARGIN;
    const y = Math.floor(i / w) - MARGIN;
    if (x >= 0 && y >= 0 && x < mw && y < mh) map.props.set(y * mw + x, list);
  }
  return {
    map,
    river: cropPlane(river, w, mw, mh),
    lake: cropPlane(lake, w, mw, mh),
    shore,
    massifSeed: seeds.massif,
  };
}

/** The map's `mw` x `mh` tiles of a plane of the field (`w` tiles wide) around it. */
function cropPlane<P extends Uint8Array | Uint16Array>(
  plane: P,
  w: number,
  mw: number,
  mh: number,
): P {
  const out = new (plane.constructor as new (n: number) => P)(mw * mh);
  for (let y = 0; y < mh; y++) {
    const from = (y + MARGIN) * w + MARGIN;
    out.set(plane.subarray(from, from + mw), y * mw);
  }
  return out;
}

/** The places a world chunk has for a wheat field; each grows one field or none. */
const WHEAT_SLOTS = 2;
/** The share of slots that grow a field where their tile is plains grass. */
const WHEAT_CHANCE = 0.9;
/** A wheat field's fewest and most tiles. */
const WHEAT_MIN = 4;
const WHEAT_MAX = 9;
/** How far a wheat field reaches from its slot, in tiles along either axis. */
const WHEAT_REACH = 2;
/** No wheat nearer than this to the start chunk's centre, in tiles: the first buildings go there. */
const WHEAT_CLEAR = 8;
/** The four sides of a tile. */
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Wheat fields: patches of WHEAT_MIN to WHEAT_MAX tiles of wheat on Grass in the Plains biome, in
 * both production chains, about as rare as oil fields (wheat covers about 1 % of plains grass).
 * Every world chunk has WHEAT_SLOTS slots, each a tile fixed by the chunk's world coordinates and
 * a hash of its own, at least WHEAT_REACH tiles inside the chunk, so a field never crosses a
 * chunk's edge and a chunk holds at most WHEAT_SLOTS fields. A slot whose hash says so and whose
 * tile is plains grass grows a field from that tile over the plains grass within WHEAT_REACH tiles,
 * nearest first with a jitter that makes the edge ragged, each new tile beside one it already has;
 * a slot with room for fewer than WHEAT_MIN tiles grows none. No wheat comes within WHEAT_CLEAR
 * tiles of the start chunk's centre (`scx`, `scy`). Only slots on the tiles of `s` grow a field.
 *
 * A field tile carries the wheat alone: it replaces the tile's decoration (a flower patch, a bush
 * or an oak). No field takes a tile oil could lie on, in either production chain: a tile an oil
 * field could cover (oilCouldCover) or a tile of `oil`, the full chain's oil with its start seeps.
 * So oil never cuts a field into pieces, and both chains grow the same fields; a field grows
 * around the oil, or with fewer than WHEAT_MIN tiles left to it, not at all.
 */
function wheatFields(
  map: GameMap,
  seed: number,
  s: Span,
  scx: number,
  scy: number,
  oil: GameMap['props'],
) {
  const { w, h, terrain, biome, originX, originY, regionSize: rs } = map;
  const ok = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    if (terrain[i] !== Terrain.Grass || biome[i] !== Biome.Plains) return false;
    if (oil.has(i) || oilCouldCover(x + originX, y + originY, seed)) return false;
    const dx = x - scx;
    const dy = y - scy;
    return dx * dx + dy * dy >= WHEAT_CLEAR * WHEAT_CLEAR;
  };
  // the places along each axis a slot can take, WHEAT_REACH tiles or more inside its chunk
  const span = rs - 2 * WHEAT_REACH;
  const cx0 = Math.floor((originX + s.x0) / rs);
  const cy0 = Math.floor((originY + s.y0) / rs);
  const cx1 = Math.floor((originX + s.x1 - 1) / rs);
  const cy1 = Math.floor((originY + s.y1 - 1) / rs);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++)
      for (let k = 0; k < WHEAT_SLOTS; k++) {
        const slot = cx * WHEAT_SLOTS + k;
        const grows = hash2(slot, cy, seed + 16);
        if (grows >= WHEAT_CHANCE) continue;
        const x = cx * rs + WHEAT_REACH + Math.floor(hash2(slot, cy, seed + 17) * span) - originX;
        const y = cy * rs + WHEAT_REACH + Math.floor(hash2(slot, cy, seed + 18) * span) - originY;
        if (x < s.x0 || y < s.y0 || x >= s.x1 || y >= s.y1 || !ok(x, y)) continue;
        // the same hash, below WHEAT_CHANCE, picks the size evenly
        const size = WHEAT_MIN + Math.floor((grows / WHEAT_CHANCE) * (WHEAT_MAX - WHEAT_MIN + 1));
        // the tiles it may take, soonest first (pushed in reading order, which breaks a tie)
        const near: { x: number; y: number; by: number }[] = [];
        for (let dy = -WHEAT_REACH; dy <= WHEAT_REACH; dy++)
          for (let dx = -WHEAT_REACH; dx <= WHEAT_REACH; dx++) {
            if ((dx || dy) && ok(x + dx, y + dy)) {
              const jitter = hash2(x + dx + originX, y + dy + originY, seed + 19);
              near.push({ x: x + dx, y: y + dy, by: dx * dx + dy * dy + 2 * jitter });
            }
          }
        near.sort((a, b) => a.by - b.by);
        const field = [{ x, y }];
        const beside = (t: { x: number; y: number }) =>
          field.some((f) => Math.abs(f.x - t.x) + Math.abs(f.y - t.y) === 1);
        while (field.length < size) {
          const next = near.find((t) => !field.includes(t) && beside(t));
          if (!next) break;
          field.push(next);
        }
        if (field.length < WHEAT_MIN) continue;
        for (const t of field) {
          const variant = Math.floor(hash2(t.x + originX, t.y + originY, seed + 20) * 3);
          map.props.set(t.y * w + t.x, [{ kind: 'wheat', variant, ox: 0, oy: 0 }]);
        }
      }
}

/**
 * Oil fields (full production chain only): rare clusters of puddles on low ground. A field centre
 * is picked by hash on plain grass, sand or swamp, then a blob of 4–9 tiles around it is covered.
 * Fields never touch the starting chunk's centre. Ground in the Ocean climate (an island, its
 * beach included) takes no oil.
 */
export function placeOilFields(map: GameMap, seed: number, supply: SupplyMode = DEFAULT_SUPPLY) {
  oilFields(map, seed, { x0: 0, y0: 0, x1: map.w, y1: map.h }, supply);
}
/** placeOilFields with the field centres limited to the tiles of `s`. */
function oilFields(map: GameMap, seed: number, s: Span, supply: SupplyMode) {
  if (supply !== 'full') return;
  const { w, h, terrain, originX, originY } = map;
  const ok = (i: number) => {
    const t = terrain[i];
    return climateAtIndex(map, i) !== Biome.Ocean && (t === Terrain.Grass || t === Terrain.Sand);
  };
  for (let y = Math.max(2, s.y0); y < Math.min(h - 2, s.y1); y++)
    for (let x = Math.max(2, s.x0); x < Math.min(w - 2, s.x1); x++) {
      const i = y * w + x;
      if (!ok(i)) continue;
      const rad = oilRadius(x + originX, y + originY, seed);
      if (!rad) continue;
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const ni = ny * w + nx;
          if (!ok(ni)) continue;
          if (!oilCovers(nx + originX, ny + originY, dx, dy, rad, seed)) continue;
          map.props.set(ni, [{ kind: 'oil', variant: (dx + dy + 6) % 3, ox: 0, oy: 0 }]);
        }
    }
}

/** The farthest an oil field reaches from its centre, in tiles along either axis. */
const OIL_REACH = 2;
/**
 * The radius, 1 to OIL_REACH, of the oil field centred on world tile (`wx`, `wy`), or 0 where its
 * hash makes it no centre. The field grows only where the tile's ground takes one (grass or sand
 * off the ocean).
 */
function oilRadius(wx: number, wy: number, seed: number) {
  if (hash2(wx, wy, seed + 12) < 0.9975) return 0;
  return 1 + Math.floor(hash2(wx, wy, seed + 13) * OIL_REACH);
}
/**
 * Whether an oil field of radius `rad` covers world tile (`wx`, `wy`), `dx`, `dy` from its centre,
 * where the tile's ground takes oil: inside the radius, and not one of the quarter it leaves bare.
 */
const oilCovers = (wx: number, wy: number, dx: number, dy: number, rad: number, seed: number) =>
  dx * dx + dy * dy <= rad * rad + 0.5 && hash2(wx, wy, seed + 14) >= 0.25;
/**
 * Whether an oil field could cover world tile (`wx`, `wy`): one centred within OIL_REACH tiles
 * would, wherever its centre's ground takes one. The hashes alone answer it, never the ground, so
 * it is the same on every map that holds the tile; every tile an oil field covers is one.
 */
function oilCouldCover(wx: number, wy: number, seed: number) {
  for (let dy = -OIL_REACH; dy <= OIL_REACH; dy++)
    for (let dx = -OIL_REACH; dx <= OIL_REACH; dx++) {
      const rad = oilRadius(wx - dx, wy - dy, seed);
      if (rad && oilCovers(wx, wy, dx, dy, rad, seed)) return true;
    }
  return false;
}

/** The oil seeps a full-chain start chunk holds. */
const START_SEEPS = 3;

/**
 * The starting chunk gets three oil seeps (full production chain), counting the oil already in it,
 * on its grass or sand tiles without oil, nearest the chunk centre first, ties in reading order, a
 * fixed order so an expanded map picks the same tiles again. They go on every third tile of the
 * ring 6 to 13 tiles out, where the ring holds enough such tiles (seven for three seeps). Where it
 * is short (a high Water level, a dense forest), they go on the nearest such tiles of the whole
 * chunk instead, at a step of `max(1, min(3, floor((n - 1) / (need - 1))))` for `n` tiles and
 * `need` seeps, so a chunk with three grass or sand tiles always gets three. A second call changes
 * nothing.
 */
export function ensureStartDeposits(map: GameMap, supply: SupplyMode = DEFAULT_SUPPLY) {
  startDeposits(map, startSpan(map), supply);
}
function startDeposits(map: GameMap, s: Span, supply: SupplyMode) {
  if (supply !== 'full') return;
  const cx = s.x0 + map.regionSize / 2;
  const cy = s.y0 + map.regionSize / 2;
  const free: { x: number; y: number; d: number }[] = [];
  let have = 0;
  for (let y = s.y0; y < s.y1; y++)
    for (let x = s.x0; x < s.x1; x++) {
      const i = y * map.w + x;
      if (map.props.get(i)?.some((p) => p.kind === 'oil')) {
        have++;
        continue;
      }
      const t = map.terrain[i];
      if (t === Terrain.Grass || t === Terrain.Sand)
        free.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    }
  const need = START_SEEPS - have;
  if (need <= 0) return;
  // nearest first; ties in reading order, which a wider map keeps
  free.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  let from = free.filter((c) => c.d > 6 && c.d < 13);
  let step = 3;
  if (from.length < step * (need - 1) + 1) {
    from = free;
    step = need > 1 ? Math.max(1, Math.min(3, Math.floor((free.length - 1) / (need - 1)))) : 1;
  }
  for (let k = 0, laid = 0; laid < need && k < from.length; k += step, laid++) {
    const { x, y } = from[k];
    const jitter = hash2(x + map.originX, y + map.originY, map.seed + 15);
    map.props.set(y * map.w + x, [
      { kind: 'oil', variant: k % 3, ox: (jitter - 0.5) * 0.3, oy: 0 },
    ]);
  }
}

/**
 * The starting chunk must offer every basic resource: water (pumps), forest (lumber), hill or
 * rock (quarries) and grass (farms). Missing ones are painted as small patches near the chunk's
 * corners, away from the central basin. Then it must hold a tile a Water Pump can stand on (see
 * startPump).
 */
export function ensureStartResources(map: GameMap) {
  startResources(map, startSpan(map));
}
/**
 * startResources after the river pass (`pass`): where the pass laid the water patch already, as
 * a lake that overflows (riverPlan), the patch's corner is taken, and no patch paints over a river
 * (riverPlan keeps rivers off the patches' corners but for a lake's outlet). Without `pass`
 * (ensureStartResources) the patches paint whatever lies there.
 */
function startResources(map: GameMap, s: Span, pass?: { pond: boolean; river: Uint8Array }) {
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
        if (pass?.river[y * map.w + x]) continue;
        map.terrain[y * map.w + x] = t;
      }
  };
  if (pass?.pond) ci++;
  else if (count((t) => t === Terrain.Water) < 4) paint(Terrain.Water, 1);
  if (count((t) => t === Terrain.Forest) < 6) paint(Terrain.Forest, 2);
  if (count((t) => t === Terrain.Hill || t === Terrain.Rock) < 4) paint(Terrain.Hill, 1);
  if (count((t) => t === Terrain.Grass) < 20) paint(Terrain.Grass, 3);
  startPump(map, s);
}

/**
 * The starting chunk `s` must hold a tile a Water Pump can stand on: Grass or Forest with Water on
 * one of its 4 sides inside the chunk, and level: no Hill or Mountain on any of its 4 sides (the
 * terraces' level tile; a hill or mountain always stands a level above the ground beside it).
 * Where no tile is one, the tile beside the chunk's water that needs the fewest tiles changed
 * becomes one, nearest the chunk's centre on a tie, then in reading order: it turns Grass unless
 * it is Grass or Forest, and every Hill or Mountain on its sides turns Grass. Mostly that is a
 * sand tile of a lake's shore turned grass. The chunk always has water and other ground here (the
 * patches above), so some tile is beside its water.
 */
function startPump(map: GameMap, s: Span) {
  const { w, terrain } = map;
  const cx = s.x0 + map.regionSize / 2;
  const cy = s.y0 + map.regionSize / 2;
  const steep = (t: number) => t === Terrain.Hill || t === Terrain.Mountain;
  const inChunk = (x: number, y: number) => x >= s.x0 && y >= s.y0 && x < s.x1 && y < s.y1;
  let best: { x: number; y: number; cost: number; d: number } | null = null;
  for (let y = s.y0; y < s.y1; y++)
    for (let x = s.x0; x < s.x1; x++) {
      const t = terrain[y * w + x];
      if (t === Terrain.Water) continue;
      let water = false;
      let cost = t === Terrain.Grass || t === Terrain.Forest ? 0 : 1;
      for (const [dx, dy] of SIDES) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
        const n = terrain[ny * w + nx];
        if (n === Terrain.Water) water ||= inChunk(nx, ny);
        else if (steep(n)) cost++;
      }
      if (!water) continue;
      if (cost === 0) return;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || cost < best.cost || (cost === best.cost && d < best.d)) best = { x, y, cost, d };
    }
  if (!best) return;
  const { x, y } = best;
  if (terrain[y * w + x] !== Terrain.Forest) terrain[y * w + x] = Terrain.Grass;
  for (const [dx, dy] of SIDES) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
    if (steep(terrain[ny * w + nx])) terrain[ny * w + nx] = Terrain.Grass;
  }
}

/** The rivers and lakes of the river region, planned once (riverPlan). */
interface RiverPlan {
  /** world tile of the region's first tile, and its side in tiles */
  x0: number;
  y0: number;
  size: number;
  /** WaterKind, water level, flow and Dir + 1 of each of its tiles (rivers.ts, Drainage) */
  kind: Uint8Array;
  surface: Uint8Array;
  flow: Uint16Array;
  dir: Uint8Array;
  /** world tiles at its edge whose water leaves it, the way it goes and the rain it carries */
  exits: { x: number; y: number; dir: number; flow: number }[];
  /** whether the start chunk's water patch is a lake of the plan */
  pond: boolean;
  /**
   * the ground the plan generated, kept with the latest plan only, for the map asked for with it
   * (Field.adopt): the region and PLAN_MARGIN tiles around it
   */
  field?: Field;
}

/** The latest river plans, newest first, under their key. */
const plans: { key: string; plan: RiverPlan }[] = [];

/**
 * The rivers and lakes of the river region of a world: the REGION_CHUNKS chunks around its start
 * chunk, whose world corner is (`cx0`, `cy0`). They depend on the seed, the sliders and where the
 * start chunk lies, never on the map asked for, so every map of a world that holds a tile of the
 * region gets the same water there, generated before or after its neighbours.
 *
 * The plan generates the region's ground (and PLAN_MARGIN tiles around it), cleans up its lone
 * tiles as generateMapPlanes does, and drains it (rivers.ts, `drain`). The start chunk is marked
 * for it: no river and no basin lake within START_KEEP_OUT tiles of its centre, the land there
 * draining away; its water at level 0 within 2 tiles of it, where the start patches and the pump
 * tile change the ground after the pass (startResources); no basin lake within 3 tiles of a
 * corner a hill patch may stand on; and its water patch laid as a lake when it would be painted.
 * The ground's own water stays in all of these. The 3 x 3 chunks around it get a river if none
 * runs there.
 *
 * Computed once for each world and kept (PLAN_CACHE), so a map that grows asks again for free.
 */
function riverPlan(
  seed: number,
  seeds: FieldSeeds,
  params: MapGenParams,
  cx0: number,
  cy0: number,
  rs: number,
): RiverPlan {
  const { waterLevel, hillLevel, rockLevel, forestDensity } = params;
  // the rock slider moves the ground the plan reads, though the drainage itself does not read it
  const key = [seed, waterLevel, hillLevel, rockLevel, forestDensity, cx0, cy0, rs].join();
  const at = plans.findIndex((p) => p.key === key);
  if (at >= 0) {
    const [hit] = plans.splice(at, 1);
    plans.unshift(hit);
    return hit.plan;
  }
  const size = (2 * REGION_CHUNKS + 1) * rs;
  const x0 = cx0 - REGION_CHUNKS * rs;
  const y0 = cy0 - REGION_CHUNKS * rs;
  const M = PLAN_MARGIN;
  const w = size + 2 * M;
  // field tiles: the region's first tile is (M, M), the start chunk's (sx, sy)
  const sx = M + REGION_CHUNKS * rs;
  const sy = sx;
  const scx = sx + rs / 2;
  const scy = sy + rs / 2;
  const f = new Field(w, w, x0 - M, y0 - M, seeds, params, scx, scy, rs);
  const core: Span = { x0: M, y0: M, x1: M + size, y1: M + size };
  const reads = grow(core, LAKE_CLEARANCE);
  f.needSpan(grow(reads, 1), GROUND);
  const ground = tidyGround(f.ground, w, w, reads);
  const land = new Uint8Array(ground);
  const sea = new Uint8Array(w * w);
  const mark = new Uint8Array(w * w);
  for (let y = reads.y0; y < reads.y1; y++)
    for (let x = reads.x0; x < reads.x1; x++) {
      const i = y * w + x;
      if (ground[i] !== Terrain.Water) continue;
      if (f.biome[i] === Biome.Ocean) sea[i] = 1;
      else land[i] = f.landAt(i);
    }
  const chunk: Span = { x0: sx, y0: sy, x1: sx + rs, y1: sy + rs };
  for (let y = chunk.y0 - 2; y < chunk.y1 + 2; y++)
    for (let x = chunk.x0 - 2; x < chunk.x1 + 2; x++) {
      const dx = x - scx;
      const dy = y - scy;
      mark[y * w + x] = dx * dx + dy * dy < START_KEEP_OUT * START_KEEP_OUT ? KEEP_OUT | LOW : LOW;
    }
  // startResources' corners, the first its water patch's
  const corners = [
    [sx + 4, sy + 4],
    [sx + rs - 5, sy + 4],
    [sx + 4, sy + rs - 5],
    [sx + rs - 5, sy + rs - 5],
  ];
  // the patches startResources may paint there, 3 tiles or less from a corner, meet no river, and
  // no lake lies within 2 tiles of where its hill patch would stand at level 2
  for (const [cx, cy] of corners)
    for (let y = cy - 3; y <= cy + 3; y++)
      for (let x = cx - 3; x <= cx + 3; x++) {
        const near = Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2;
        mark[y * w + x] |= near ? KEEP_OUT | DRY : KEEP_OUT;
      }
  const [px, py] = corners[Math.floor(hash2(seed, 3, 41) * 4) % 4];
  const wander = new Float32Array(w * w);
  for (let y = core.y0; y < core.y1; y++)
    for (let x = core.x0; x < core.x1; x++)
      wander[y * w + x] = massifWander(x + f.ox, y + f.oy, x - scx, y - scy, seeds.massif);
  const d = drain({
    waterLevel,
    hillLevel,
    w,
    h: w,
    core,
    elev: f.elev,
    ground,
    land,
    sea,
    mark,
    wander,
    start: { chunk, pond: { x: px, y: py } },
    near: grow(chunk, rs),
  });
  const crop = <P extends Uint8Array | Uint16Array>(src: P, out: P): P => {
    for (let y = 0; y < size; y++)
      out.set(src.subarray((y + M) * w + M, (y + M) * w + M + size), y * size);
    return out;
  };
  const plan: RiverPlan = {
    x0,
    y0,
    size,
    kind: crop(d.kind, new Uint8Array(size * size)),
    surface: crop(d.surface, new Uint8Array(size * size)),
    flow: crop(d.flow, new Uint16Array(size * size)),
    dir: crop(d.dir, new Uint8Array(size * size)),
    exits: d.exits.map((e) => ({
      x: (e.tile % w) - M + x0,
      y: Math.floor(e.tile / w) - M + y0,
      dir: e.dir,
      flow: e.flow,
    })),
    pond: d.pond,
  };
  for (const kept of plans) kept.plan.field = undefined;
  plan.field = f;
  plans.unshift({ key, plan });
  plans.length = Math.min(plans.length, PLAN_CACHE);
  return plan;
}

/** What the river pass makes of the tiles of a field: rivers.ts's Drainage planes. */
interface FieldWater {
  kind: Uint8Array;
  surface: Uint8Array;
  flow: Uint16Array;
  dir: Uint8Array;
}

/**
 * The water of the field's tiles of `late`: the river region's from its plan, and beyond it short
 * streams like the rivers before the plan, each walking downhill (with a little position-fixed
 * wander) for at most RIVER_TILES tiles across tile sides:
 *
 * - from a source of its own, one candidate per world chunk outside the region, on high ground
 *   off the sea and the desert, kept when it runs 12 tiles or more;
 * - from where a river of the region leaves it (the plan's exits), carrying the rain it gathered.
 *
 * A stream ends where it meets water, the region's included; one that does not within its length,
 * comes to a dead end, dries out after 12 desert tiles, or would enter the region onto land ends
 * in a pond, its last tile. Streams read the ground as it is before any stream, so they never
 * depend on one another: a tile two of them cross takes the fuller (a river before a pond, then the
 * lower walk in a fixed order), and every tile of either is water, so neither ends on land. Their
 * water is at level 0. A stream is walked only when it can come within `late`, and generates the
 * field's blocks along its course as it goes.
 */
function riverWater(
  f: Field,
  ground: Uint8Array,
  plan: RiverPlan,
  seed: number,
  late: Span,
): FieldWater {
  const { w, h, ox, oy, rs, elev, biome, scx, scy, seeds } = f;
  const kind = new Uint8Array(w * h);
  const surface = new Uint8Array(w * h);
  const flow = new Uint16Array(w * h);
  const dir = new Uint8Array(w * h);
  // the region in field tiles
  const reg: Span = {
    x0: plan.x0 - ox,
    y0: plan.y0 - oy,
    x1: plan.x0 - ox + plan.size,
    y1: plan.y0 - oy + plan.size,
  };
  const inReg = (x: number, y: number) => x >= reg.x0 && y >= reg.y0 && x < reg.x1 && y < reg.y1;
  const planAt = (x: number, y: number) => (y - reg.y0) * plan.size + x - reg.x0;
  for (let y = Math.max(late.y0, reg.y0); y < Math.min(late.y1, reg.y1); y++)
    for (let x = Math.max(late.x0, reg.x0); x < Math.min(late.x1, reg.x1); x++) {
      const i = y * w + x;
      const j = planAt(x, y);
      kind[i] = plan.kind[j];
      surface[i] = plan.surface[j];
      flow[i] = plan.flow[j];
      dir[i] = plan.dir[j];
    }
  // the ground's water after the lone-tile cleanup, worked out where `ground` does not reach
  const wet = (x: number, y: number) => {
    if (x >= late.x0 && y >= late.y0 && x < late.x1 && y < late.y1)
      return ground[y * w + x] === Terrain.Water;
    f.need(x - 1, y - 1, GROUND);
    f.need(x + 1, y - 1, GROUND);
    f.need(x - 1, y + 1, GROUND);
    f.need(x + 1, y + 1, GROUND);
    const g = f.ground;
    const i = y * w + x;
    let same = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g[i + dy * w + dx] === g[i]) same++;
    return (same <= 1 ? g[i + w] : g[i]) === Terrain.Water;
  };
  const planWet = (x: number, y: number) => {
    const k = plan.kind[planAt(x, y)];
    return k === WaterKind.River || k === WaterKind.Lake || k === WaterKind.Sea;
  };
  /** Tiles from (x, y) to `late`, 0 inside it. */
  const away = (x: number, y: number) =>
    Math.max(late.x0 - x, x - late.x1 + 1, late.y0 - y, y - late.y1 + 1, 0);
  // the walk that laid each tile, for a tile two walks lay
  const owner = new Int32Array(w * h).fill(-1);
  const onCourse = new Int32Array(w * h).fill(-1);
  let walks = 0;
  const walk = (x: number, y: number, carried: number, minLen: number) => {
    const id = walks++;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || away(x, y) >= RIVER_TILES) return;
    const course: number[] = [];
    let into = -1;
    let dry = 0;
    for (;;) {
      if (inReg(x, y)) {
        if (planWet(x, y)) into = y * w + x;
        break;
      }
      if (wet(x, y)) {
        into = y * w + x;
        break;
      }
      const i = y * w + x;
      course.push(i);
      onCourse[i] = id;
      if (course.length === RIVER_TILES) break;
      if (biome[i] === Biome.Desert && ++dry > 12) break;
      let bx = -1;
      let by = -1;
      let be = Infinity;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d];
        const ny = y + DIR_DY[d];
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (onCourse[ny * w + nx] === id) continue;
        f.need(nx, ny, ELEV);
        // a little position-fixed noise so streams wander the same way every time, as much as a
        // massif's slope needs there
        const ev =
          elev[ny * w + nx] +
          (hash2(nx + ox, ny + oy, seed + 80) - 0.5) * 0.02 +
          massifWander(nx + ox, ny + oy, nx - scx, ny - scy, seeds.massif);
        if (ev < be) {
          be = ev;
          bx = nx;
          by = ny;
        }
      }
      if (bx < 0) break;
      x = bx;
      y = by;
    }
    if (course.length === 0 || course.length < minLen) return;
    const pond = into < 0;
    course.forEach((i, k) => {
      const last = k === course.length - 1;
      const k2 = pond && last ? WaterKind.Lake : WaterKind.River;
      const fl = Math.min(FLOW_CAP, carried + k + 1);
      const o = owner[i];
      // a river before a pond, then the fuller, then the walk laid first
      if (o >= 0) {
        if (kind[i] === WaterKind.River && k2 === WaterKind.Lake) return;
        if (kind[i] === k2 && flow[i] >= fl) return;
      }
      const next = last ? into : course[k + 1];
      kind[i] = k2;
      flow[i] = k2 === WaterKind.River ? fl : 0;
      dir[i] = k2 === WaterKind.River ? sideOf(next - i, w) + 1 : 0;
      owner[i] = id;
    });
  };
  // the region's rivers first, in the order of their world tiles
  for (const e of plan.exits)
    walk(e.x - ox + DIR_DX[e.dir - 1], e.y - oy + DIR_DY[e.dir - 1], e.flow, 0);
  // one candidate source per world chunk, fixed by the chunk's world coordinates, so the same
  // streams reappear wherever the map's edges happen to be
  const cx0 = Math.floor(ox / rs);
  const cy0 = Math.floor(oy / rs);
  const cx1 = Math.floor((ox + w - 1) / rs);
  const cy1 = Math.floor((oy + h - 1) / rs);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      if (hash2(cx, cy, seed + 77) > 0.75) continue;
      const x = cx * rs + 4 + Math.floor(hash2(cx, cy, seed + 78) * (rs - 8)) - ox;
      const y = cy * rs + 4 + Math.floor(hash2(cx, cy, seed + 79) * (rs - 8)) - oy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || inReg(x, y)) continue;
      if (away(x, y) >= RIVER_TILES) continue;
      f.need(x, y, GROUND);
      const i = y * w + x;
      if (elev[i] < f.params.waterLevel + 0.12) continue;
      if (biome[i] === Biome.Ocean || biome[i] === Biome.Desert) continue;
      walk(x, y, 0, 12);
    }
  return { kind, surface, flow, dir };
}

/** The Dir of the side a tile `delta` away (along a row of `w`) lies on. */
const sideOf = (delta: number, w: number) =>
  delta === -w ? Dir.N : delta === 1 ? Dir.E : delta === w ? Dir.S : Dir.W;

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
 * The sea water of the tiles of `s`, as 1s on the map's plane: Water in the Ocean climate that the
 * river pass did not make river or lake (`pass`: a river or lake on an island). The Ocean climate
 * is the generator's own sea (a broad noise of its own, Field.genRaw), and the rule reads the tile
 * alone, so its reach is 0: water outside the Ocean climate is a lake even where it runs into the
 * sea.
 */
function seaWater(map: GameMap, pass: Uint8Array, s: Span): Uint8Array {
  const { w, h, terrain } = map;
  const climate = map.climate ?? map.biome;
  const sea = new Uint8Array(w * h);
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0), i = y * w + x; x < Math.min(w, s.x1); x++, i++)
      if (terrain[i] === Terrain.Water && !pass[i] && climate[i] === Biome.Ocean) sea[i] = 1;
  return sea;
}

/**
 * The sea shore: every Grass, Forest or Sand tile of `s` with sea water (seaWater) on one of its 4
 * sides becomes Sand, which biomeRules makes Beach. Hill, Rock and Mountain on the coast stay as
 * they are (a cliff coast), and lakes and rivers get no shore. Reads the tiles 1 around `s`.
 */
function seaShore(map: GameMap, sea: Uint8Array, s: Span) {
  const { w, h, terrain } = map;
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0), i = y * w + x; x < Math.min(w, s.x1); x++, i++) {
      const t = terrain[i];
      if (t !== Terrain.Grass && t !== Terrain.Forest && t !== Terrain.Sand) continue;
      if (
        (x > 0 && sea[i - 1]) ||
        (x < w - 1 && sea[i + 1]) ||
        (y > 0 && sea[i - w]) ||
        (y < h - 1 && sea[i + w])
      )
        terrain[i] = Terrain.Sand;
    }
}

/**
 * The biomes of the tiles of `s`: the map's climate, with the tiles whose landform has a biome of
 * its own relabelled to it.
 *
 * - River: Water the river pass made of land (`river`).
 * - Lake: any other Water but the sea (`sea`, seaWater), which keeps the Ocean climate.
 * - Beach: Sand within BEACH_REACH tiles of sea water, along either axis.
 * - Mountain: Mountain terrain, and Rock that reaches it in MOUNTAIN_REACH steps or fewer across
 *   tile sides over Rock and Mountain alone.
 *
 * Every other tile keeps its climate. Returns a new plane, the climate outside `s`. Reads the
 * terrain up to MOUNTAIN_REACH tiles around `s` and the sea BEACH_REACH tiles around it.
 */
function biomeRules(map: GameMap, river: Uint8Array, sea: Uint8Array, s: Span): Uint8Array {
  const { w, h, terrain } = map;
  const biome = (map.climate ?? map.biome).slice();
  const steps = stepsToMountain(map, grow(s, MOUNTAIN_REACH));
  const r = BEACH_REACH;
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0), i = y * w + x; x < Math.min(w, s.x1); x++, i++) {
      const t = terrain[i];
      if (t === Terrain.Water) {
        if (river[i]) biome[i] = Biome.River;
        else if (!sea[i]) biome[i] = Biome.Lake;
      } else if (t === Terrain.Mountain || t === Terrain.Rock) {
        if (steps[i] <= MOUNTAIN_REACH) biome[i] = Biome.Mountain;
      } else if (t === Terrain.Sand) {
        let shore = false;
        for (let ny = Math.max(0, y - r); ny <= Math.min(h - 1, y + r) && !shore; ny++)
          for (let nx = Math.max(0, x - r); nx <= Math.min(w - 1, x + r); nx++)
            if (sea[ny * w + nx]) {
              shore = true;
              break;
            }
        if (shore) biome[i] = Biome.Beach;
      }
    }
  return biome;
}

/**
 * For each tile of `s`, the fewest steps across tile sides, over Rock alone, to a Mountain tile of
 * `s`, as a plane of the map; 255 where there are more than MOUNTAIN_REACH or none. Exact on the
 * tiles MOUNTAIN_REACH or more inside `s`, as a path that long never leaves it.
 */
function stepsToMountain(map: GameMap, s: Span): Uint8Array {
  const { w, h, terrain } = map;
  const x0 = Math.max(0, s.x0);
  const y0 = Math.max(0, s.y0);
  const x1 = Math.min(w, s.x1);
  const y1 = Math.min(h, s.y1);
  const FAR = 255;
  const steps = new Uint8Array(w * h).fill(FAR);
  const queue = new Int32Array(Math.max(0, (x1 - x0) * (y1 - y0)));
  let tail = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++)
      if (terrain[i] === Terrain.Mountain) {
        steps[i] = 0;
        queue[tail++] = i;
      }
  // breadth first, so each tile is reached by its fewest steps, and none beyond the reach
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const d = steps[i] + 1;
    if (d > MOUNTAIN_REACH) break;
    const x = i % w;
    const y = (i - x) / w;
    const go = (n: number) => {
      if (steps[n] === FAR && terrain[n] === Terrain.Rock) {
        steps[n] = d;
        queue[tail++] = n;
      }
    };
    if (x > x0) go(i - 1);
    if (x < x1 - 1) go(i + 1);
    if (y > y0) go(i - w);
    if (y < y1 - 1) go(i + w);
  }
  return steps;
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
 * (Re)generate decorative props from the terrain and the climate (climateAt: palms on a beach in
 * the Ocean climate, cacti on one in the desert). With a rectangle only those tiles are redone,
 * which is what the editor needs after painting. Deterministic per tile and seed.
 */
export function decorateProps(
  map: GameMap,
  seed: number,
  rect?: { x0: number; y0: number; x1: number; y1: number },
) {
  const { w, h, terrain } = map;
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
      const b = climateAtIndex(map, i);
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
