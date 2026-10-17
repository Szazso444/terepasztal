import { hash2 } from '../engine/rng';
import {
  compileRoad,
  roadDistance,
  roadShape,
  roadSide,
  ROAD_FEATHER,
  ROAD_HALF,
  ROAD_RAG,
  ROAD_REACH,
  ROAD_STRIDE,
} from './roadShape';
import { surfaceNoise } from './terrainMaterials';

/**
 * Roads painted into the ground (#329): gravel along each road tile's centre line (roadShape.ts),
 * ROAD_WIDTH wide, with two soft wheel ruts, broad worn patches and a few pebbles, darker worn
 * soil at its rim, and an edge that fades into the ground over ROAD_FEATHER in a ragged line (edge
 * B, the author's pick on the art demo, 2026-10-12). The landscape painter lays it after the
 * buildings' yards and under the town paving, the way it paints both (buildingYard.ts,
 * townPaving.ts).
 *
 * Everything here is a function of the map point and the road tiles, never of the chunk being
 * painted, so neighbouring chunks agree pixel for pixel; the noise runs on world coordinates (map
 * plus origin), so a map that grows keeps its picture. Pure: the paint workers and the tests run
 * it.
 */

/** The gravel of the road's middle: the demo's organic road, measured. */
export const ROAD_GRAVEL: readonly number[] = [182, 161, 125];
/** The worn soil at its rim, darker and browner, as the demo's rims measure. */
export const ROAD_SOIL: readonly number[] = [146, 128, 88];
/** A pebble's lit top and the shade on its lower right, both under the cursor white. */
const PEBBLE = [192, 187, 174] as const,
  PEBBLE_SHADE = [112, 106, 96] as const;
/** How far the wheel ruts run from the centre line (tiles), and how wide they are. */
const RUT_AT = 0.075,
  RUT_HALF = 0.024;
/**
 * Where the gravel gives way to worn soil at the rim, inward from ROAD_HALF (tiles): on the side
 * away from the camera, and on the side toward it, where the rim is wider and in shade (the
 * lower rims, as the art direction darkens them). The band each blends over.
 */
const RIM_FAR = 0.04,
  RIM_NEAR = 0.065,
  RIM_WIDTH = 0.04;

/** Pebbles: the side of the cells they lie in (tiles), and how many cells hold one. */
const PEBBLE_CELL = 0.08,
  PEBBLE_SHARE = 0.06;
/** How far in from the edge the road's core starts, where tufts and loose stones never lie. */
const CORE = ROAD_HALF - ROAD_FEATHER / 2;

/** Seeds of the road's noise. */
const SEED_RAG = 4481,
  SEED_RIPPLE = 4482,
  SEED_TONE = 4483,
  SEED_PATCH = 4484,
  SEED_PEBBLE = 4487;

const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How much road there is `e` tiles out from its half width (negative inside), its ragged edge
 * moved `rag` tiles out (0 to ROAD_RAG): 1 to ROAD_FEATHER / 2 inside the half width, 0 from
 * ROAD_FEATHER / 2 past the edge, a half at the edge.
 */
export function roadWeight(e: number, rag: number) {
  return 1 - sstep((e - rag + ROAD_FEATHER / 2) / ROAD_FEATHER);
}

/**
 * How much of a road shows `pave` tiles inside the town paving's outline (`TownPaving.distance`,
 * negative outside it): all of it from 0.17 tile out, none from 0.03 tile out, so a road running
 * up to the paving fades out over its fringe rather than ending at a tile's edge (the demo's rule).
 */
export function pavingFade(pave: number) {
  return sstep((-pave - 0.03) / 0.14);
}

/** How far the ragged edge stands out at world point (wx, wy) (tiles, 0 to ROAD_RAG). */
export function roadRag(wx: number, wy: number) {
  return (
    ROAD_RAG *
    (0.65 * surfaceNoise(wx * 3.6, wy * 3.6, SEED_RAG) +
      0.35 * surfaceNoise(wx * 9, wy * 9, SEED_RIPPLE))
  );
}

/**
 * The roads of one map, as the painter reads them at any map point: which tiles they reach, and
 * the road's weight and colour there.
 */
export class RoadPaint {
  /** Each road tile's place in `table`, -1 for a tile with none. */
  private readonly at: Int32Array;
  /** The tiles a road's paint can reach: the road tiles and the tiles beside them. */
  private readonly flags: Uint8Array;
  /** The road tiles' compiled centre lines (`compileRoad`). */
  private readonly table: Float64Array;
  /** The last point read (`weigh`): the road's weight there and its distance from a centre line. */
  weight = 0;
  dist = Infinity;
  /** And which side of that centre line it lies on, as the screen sees it (`roadSide`). */
  side = 0;
  /**
   * `roads` holds two numbers a road tile: its index (`y * w + x`) and its code (`roadCode`). A
   * tile `paved` says the town paving covers is left out: no road shows on the paving.
   */
  constructor(
    readonly w: number,
    readonly h: number,
    readonly originX: number,
    readonly originY: number,
    roads: readonly number[],
    paved: (tile: number) => boolean = () => false,
  ) {
    this.at = new Int32Array(w * h).fill(-1);
    this.flags = new Uint8Array(w * h);
    this.table = new Float64Array((roads.length >> 1) * ROAD_STRIDE);
    let n = 0;
    for (let i = 0; i + 1 < roads.length; i += 2) {
      const k = roads[i];
      if (!(k >= 0 && k < w * h) || this.at[k] >= 0 || paved(k)) continue;
      const x = k % w,
        y = (k - x) / w;
      compileRoad(roadShape(roads[i + 1], x + originX, y + originY), this.table, n * ROAD_STRIDE);
      this.at[k] = n++;
      this.flags[k] = 1;
      if (x > 0) this.flags[k - 1] = 1;
      if (x + 1 < w) this.flags[k + 1] = 1;
      if (y > 0) this.flags[k - w] = 1;
      if (y + 1 < h) this.flags[k + w] = 1;
    }
  }
  /** Can a road change the picture anywhere on the tile with index `k` (`y * w + x`)? */
  near(k: number) {
    return this.flags[k] === 1;
  }
  /**
   * The distance from map point (x, y), on the tile with index `k`, to the nearest road's centre
   * line: its own tile's, and a neighbour's arm reaching over the edge it is near.
   */
  private distance(x: number, y: number, k: number) {
    const w = this.w,
      i = k % w,
      j = (k - i) / w,
      u = x - i,
      v = y - j,
      at = this.at,
      t = this.table,
      lim = 0.5 - ROAD_REACH;
    let d = Infinity,
      side = 0,
      n = at[k],
      e: number;
    // its own tile's road, then a neighbour's arm over the edge the point is near
    if (n >= 0) {
      d = roadDistance(t, n * ROAD_STRIDE, u, v);
      side = roadSide();
    }
    if (
      u > lim &&
      i + 1 < w &&
      (n = at[k + 1]) >= 0 &&
      (e = roadDistance(t, n * ROAD_STRIDE, u - 1, v)) < d
    ) {
      d = e;
      side = roadSide();
    }
    if (
      u < -lim &&
      i > 0 &&
      (n = at[k - 1]) >= 0 &&
      (e = roadDistance(t, n * ROAD_STRIDE, u + 1, v)) < d
    ) {
      d = e;
      side = roadSide();
    }
    if (
      v > lim &&
      j + 1 < this.h &&
      (n = at[k + w]) >= 0 &&
      (e = roadDistance(t, n * ROAD_STRIDE, u, v - 1)) < d
    ) {
      d = e;
      side = roadSide();
    }
    if (
      v < -lim &&
      j > 0 &&
      (n = at[k - w]) >= 0 &&
      (e = roadDistance(t, n * ROAD_STRIDE, u, v + 1)) < d
    ) {
      d = e;
      side = roadSide();
    }
    this.side = side;
    return d;
  }
  /**
   * How much road there is at map point (x, y) on the tile with index `k`, into `weight` (0 to 1),
   * with its distance from the nearest centre line into `dist`.
   */
  weigh(x: number, y: number, k: number) {
    this.weight = 0;
    this.dist = Infinity;
    if (this.flags[k] !== 1) return 0;
    const d = (this.dist = this.distance(x, y, k)),
      e = d - ROAD_HALF;
    if (e >= ROAD_FEATHER / 2 + ROAD_RAG) return 0;
    // the ragged line, read only where it can move the edge
    const rag = e > -ROAD_FEATHER / 2 ? roadRag(x + this.originX, y + this.originY) : 0;
    return (this.weight = roadWeight(e, rag));
  }
  /**
   * Is map point (x, y), on the tile with index `k`, on a road's core, inside its soft edge? Grass
   * tufts and loose stones keep off it; they may stand on the edge.
   */
  onCore(x: number, y: number, k: number) {
    if (this.flags[k] !== 1) return false;
    return this.distance(x, y, k) <= CORE;
  }
  /**
   * Paints the road read last (`weigh`) at map point (x, y) over `ground`, the ground's colour
   * before the season's tint, in place. `share` scales its weight there (the land's share of the
   * point, less where the road fades out at the paving); `tint` is the season's tint the painter
   * puts on the ground after, which the gravel is kept out of.
   */
  paint(x: number, y: number, ground: number[], share: number, tint: number) {
    const wt = this.weight * share;
    if (wt <= 0) return;
    const d = this.dist,
      wx = x + this.originX,
      wy = y + this.originY;
    // broad clusters: a tone across the gravel, a step either way, and worn patches, paler where
    // it is packed and darker where it has worn through
    const tone = surfaceNoise(wx * 4.1, wy * 4.1, SEED_TONE),
      patch = surfaceNoise(wx * 1.9, wy * 1.9, SEED_PATCH);
    let k =
      1 +
      (tone - 0.5) * 0.1 +
      0.06 * sstep((patch - 0.62) / 0.15) -
      0.06 * sstep((0.38 - patch) / 0.15);
    // two soft wheel ruts, broken here and there
    const rut = (1 - sstep(Math.abs(d - RUT_AT) / RUT_HALF)) * sstep((tone - 0.25) / 0.3);
    k *= 1 - 0.11 * rut;
    // the crown between the ruts, packed paler
    k *= 1 + 0.06 * (1 - sstep(d / (RUT_AT - RUT_HALF / 2)));
    // the rim: worn soil, wider and in shade on the side toward the camera (+x +y), its inner line
    // wandering with the patches
    let rim = 0,
      near = 0;
    if (d > ROAD_HALF - RIM_NEAR - RIM_WIDTH) {
      near = sstep(this.side + 0.5);
      const from = ROAD_HALF - RIM_FAR - (RIM_NEAR - RIM_FAR) * near;
      rim = sstep((d - from + (patch - 0.5) * 0.04) / RIM_WIDTH + 0.5);
    }
    k *= 1 - 0.08 * near * rim;
    let r = ROAD_GRAVEL[0] + (ROAD_SOIL[0] - ROAD_GRAVEL[0]) * rim,
      g = ROAD_GRAVEL[1] + (ROAD_SOIL[1] - ROAD_GRAVEL[1]) * rim,
      b = ROAD_GRAVEL[2] + (ROAD_SOIL[2] - ROAD_GRAVEL[2]) * rim;
    r *= k;
    g *= k;
    b *= k;
    // a few pebbles on the gravel, lit on their upper left
    if (d < CORE - 0.01) {
      const ci = Math.floor(wx / PEBBLE_CELL),
        cj = Math.floor(wy / PEBBLE_CELL);
      if (hash2(ci, cj, SEED_PEBBLE) < PEBBLE_SHARE) {
        const radius = PEBBLE_CELL * (0.17 + 0.07 * hash2(ci, cj, SEED_PEBBLE + 3)),
          px = wx - (ci + 0.25 + 0.5 * hash2(ci, cj, SEED_PEBBLE + 1)) * PEBBLE_CELL,
          py = wy - (cj + 0.25 + 0.5 * hash2(ci, cj, SEED_PEBBLE + 2)) * PEBBLE_CELL,
          q = Math.sqrt(px * px + py * py) / radius;
        if (q < 1) {
          // the screen's upper left is toward -x in the map, a little toward +y
          const lit = sstep(0.5 - (0.75 * px - 0.25 * py) / radius),
            cover = 1 - sstep((q - 0.6) / 0.4);
          r += (PEBBLE_SHADE[0] + (PEBBLE[0] - PEBBLE_SHADE[0]) * lit - r) * cover;
          g += (PEBBLE_SHADE[1] + (PEBBLE[1] - PEBBLE_SHADE[1]) * lit - g) * cover;
          b += (PEBBLE_SHADE[2] + (PEBBLE[2] - PEBBLE_SHADE[2]) * lit - b) * cover;
        }
      }
    }
    // gravel takes no tint: undo the one the painter puts on the ground after this
    r /= Math.max(1, (tint >> 16) & 255) / 255;
    g /= Math.max(1, (tint >> 8) & 255) / 255;
    b /= Math.max(1, tint & 255) / 255;
    ground[0] += (r - ground[0]) * wt;
    ground[1] += (g - ground[1]) * wt;
    ground[2] += (b - ground[2]) * wt;
  }
}
