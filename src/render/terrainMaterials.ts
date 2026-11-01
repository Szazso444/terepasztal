import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';
import { FIRST_WILD, Material, WILD_CELLS, materialAt, type LandscapeMap } from './landscapeModel';
import { channelsOf, isRiver, riverWater } from './waterPaint';

/** Each sheet's wild sheet of the same scale (`shareWildSheet`); none until it has loaded. */
const wildSheets = new WeakMap<Uint8ClampedArray, Uint8ClampedArray>();
/** The wild sheet to read wherever the painter reads `sheet`. */
export function shareWildSheet(sheet: Uint8ClampedArray, wild: Uint8ClampedArray) {
  wildSheets.set(sheet, wild);
}
/** What a material of the wild sheet stands in for while that sheet is missing. */
const WILD_FALLBACK = [
  Material.Water,
  Material.Sand,
  Material.Sand,
  Material.Water,
  Material.Water,
  Material.Rock,
  Material.Mountain,
  Material.Rock,
  Material.Rock,
  Material.Rock,
  Material.Rock,
  Material.Rock,
];
/**
 * A texel of a picture of the wild sheet (a fall's sheet, an ice cliff), where it repeats: `u` and
 * `v` wrap at 1. Grey where the sheet is missing.
 */
export function wildTexel(
  samples: Uint8ClampedArray,
  material: number,
  u: number,
  v: number,
  out: number[],
) {
  const sheet = wildSheets.get(samples);
  if (!sheet) {
    out[0] = out[1] = out[2] = 170;
    return;
  }
  const size = Math.round(Math.sqrt(sheet.length / (4 * WILD_CELLS)));
  out[0] = out[1] = out[2] = 0;
  addTexel(
    sheet,
    size,
    material - FIRST_WILD,
    (u - Math.floor(u)) * size,
    (v - Math.floor(v)) * size,
    1,
    out,
  );
}

/** Slow world-space variation, so light/balanced/rich areas never form tile-sized squares. */
export function grassDetail(x: number, y: number) {
  const n = surfaceNoise(x * 0.24, y * 0.24, 911);
  return 0.48 + 0.3 * smooth((n - 0.2) / 0.3) + 0.22 * smooth((n - 0.55) / 0.25);
}
const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
export function surfaceNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = smooth(x - ix),
    v = smooth(y - iy);
  const a = hash2(ix, iy, seed),
    b = hash2(ix + 1, iy, seed),
    c = hash2(ix, iy + 1, seed),
    d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Narrow material ownership changes; never blur the texture into a colour field. */
export function surfaceMaterial(map: LandscapeMap, x: number, y: number) {
  const [u, v] = surfaceLocation(map, x, y);
  return materialAt(map, u, v);
}
function surfaceLocation(map: LandscapeMap, x: number, y: number) {
  const wx = x + map.originX,
    wy = y + map.originY;
  const coastal =
    materialAt(map, x, y) === 5 ||
    materialAt(map, x + 0.4, y) === 5 ||
    materialAt(map, x - 0.4, y) === 5 ||
    materialAt(map, x, y + 0.4) === 5 ||
    materialAt(map, x, y - 0.4) === 5;
  const width = coastal ? 0.12 : 0.29;
  const q = coastal ? 0 : (surfaceNoise(wx * 10, wy * 10, 65) - 0.5) * 0.22;
  return [
    x + (surfaceNoise(wx * 3.1, wy * 3.1, 5) - 0.5) * width * 2 + q,
    y + (surfaceNoise(wx * 3.1, wy * 3.1, 11) - 0.5) * width * 2 + q * 0.7,
  ];
}

/** Where between two tile centres (tile units from the first) the blend's seam starts, and how wide it is. */
const SEAM = 0.47,
  SEAM_WIDTH = 0.06;
/** Feather only a 0.06-tile strip following the irregular interlock. */
export function surfaceBlend(map: LandscapeMap, x: number, y: number, out: number[]) {
  const [u, v] = surfaceLocation(map, x, y),
    ix = Math.floor(u),
    iy = Math.floor(v);
  const fx = smooth((u - ix - SEAM) / SEAM_WIDTH),
    fy = smooth((v - iy - SEAM) / SEAM_WIDTH);
  out[0] = materialAt(map, ix, iy);
  out[1] = materialAt(map, ix + 1, iy);
  out[2] = materialAt(map, ix, iy + 1);
  out[3] = materialAt(map, ix + 1, iy + 1);
  out[4] = (1 - fx) * (1 - fy);
  out[5] = fx * (1 - fy);
  out[6] = (1 - fx) * fy;
  out[7] = fx * fy;
  // the tiles the four materials are of, off the map its edge tile as materialAt reads
  const at = (tx: number, ty: number) =>
    Math.max(0, Math.min(map.h - 1, ty)) * map.w + Math.max(0, Math.min(map.w - 1, tx));
  out[8] = at(ix, iy);
  out[9] = at(ix + 1, iy);
  out[10] = at(ix, iy + 1);
  out[11] = at(ix + 1, iy + 1);
}

const blendAt: number[] = new Array(12);
/**
 * The landscape painter's water at map point (x, y): the share of the water material in the blend
 * it paints there (`surfaceBlend`, left in `blend`), from 0 (none) to 1 (water alone). The edge
 * of the water is where this falls from 1, inside a tile wherever the blend puts it. A paved tile
 * (a town's, `paved`) has none: the painter paves it over its water, and where the paving wears
 * out at its edge it shows the tile's own land (townPaving.ts). The painter
 * (landscape.worker.ts) weighs its colours by this, and bridges cut what stands in the water to it
 * (`underPaintedWater`), so the two can never disagree.
 */
export function paintedWater(
  map: LandscapeMap,
  x: number,
  y: number,
  paved = false,
  blend: number[] = blendAt,
): number {
  surfaceBlend(map, x, y, blend);
  if (paved) return 0;
  let water = 0;
  if (!map.flowDir) {
    for (let m = 0; m < 4; m++) if (blend[m] === Material.Water) water += blend[m + 4];
    return water;
  }
  // a river is narrower than its tile
  const channels = channelsOf(map, 1);
  for (let m = 0; m < 4; m++) {
    if (blend[m] !== Material.Water) continue;
    const tile = blend[m + 8];
    water += blend[m + 4] * (isRiver(map, tile) ? riverWater(channels, map, tile, x, y) : 1);
  }
  return water;
}

/** The share of water at or above which a point is water alone (blend weights sum inexactly). */
const ALL_WATER = 1 - 1e-6;
/**
 * Farther than `surfaceLocation` moves a point (tile units, along either axis): the land's warp of
 * 0.29 and its tufts of 0.11 at most (the coast's warp is 0.12).
 */
const REACH = 0.4;
/**
 * Whether the tiles the blend at (x, y) gives any weight are all water (1), none (0) or some (-1).
 * Tile T has weight where the moved point lies between 1 - SEAM before it and SEAM + SEAM_WIDTH
 * after it, and the moved point lies within REACH of (x, y).
 */
function waterReach(map: LandscapeMap, x: number, y: number) {
  const before = REACH + SEAM + SEAM_WIDTH,
    after = REACH + 1 - SEAM,
    x0 = Math.max(0, Math.floor(x - before) + 1),
    x1 = Math.min(map.w - 1, Math.ceil(x + after) - 1),
    y0 = Math.max(0, Math.floor(y - before) + 1),
    y1 = Math.min(map.h - 1, Math.ceil(y + after) - 1);
  let water = 0;
  // Read off the map, a tile is its edge tile (materialAt), so the clamped box holds them all.
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (map.terrain[ty * map.w + tx] !== Terrain.Water) continue;
      // a river's tile may be bank at the point, so all of it is known only by blending
      if (isRiver(map, ty * map.w + tx)) return -1;
      water++;
    }
  return water === (x1 - x0 + 1) * (y1 - y0 + 1) ? 1 : water ? -1 : 0;
}
/** Map offset along both axes of the point half a world pixel lower on screen. */
const HALF_PIXEL_DOWN = 1 / 64;
/**
 * Does the landscape paint map point (x, y) as water, for what stands in it (bridge supports)? Only
 * where it paints water alone (`paintedWater`): the soft shore, where the blend mixes water with
 * the bank, counts as bank, and so does a point whose picture blends into bank just below it (the
 * point half a world pixel lower on screen must be water too). The glints and foam in the water are
 * the water's own picture, not another material, so they count as water. Off the map nothing is
 * painted. `paved` tells a town's tiles by index (`y * w + x`), as the painter is told them.
 */
export function underPaintedWater(
  map: LandscapeMap,
  x: number,
  y: number,
  paved: (tile: number) => boolean = () => false,
): boolean {
  const water = (u: number, v: number) => {
    if (u < -0.5 || v < -0.5 || u >= map.w - 0.5 || v >= map.h - 0.5) return false;
    // Where the blend can read only land, or only water, it is known without blending.
    const reach = waterReach(map, u, v),
      tilePaved = reach !== 0 && paved(Math.round(v) * map.w + Math.round(u));
    if (reach === 0 || (reach === 1 && !tilePaved)) return reach === 1;
    return paintedWater(map, u, v, tilePaved) >= ALL_WATER;
  };
  return water(x, y) && water(x + HALF_PIXEL_DOWN, y + HALF_PIXEL_DOWN);
}

/** Centre window of each illustrated tile, as packed by tools/terrain-surfaces.mjs. */
const SURFACE_WINDOW = [0.25, 0.3, 0.75, 0.7] as const;
/**
 * Source travel per tile. The illustrated tiles are pixel art drawn at about four source pixels
 * per art pixel; 0.4 shows one art pixel per world pixel, the density of the placed sprites.
 */
const SURFACE_RATE = 0.4;
/** Seam width in patch cells. Patch interiors show one unblended source sample. */
const PATCH_SEAM = 0.16;
const CANDIDATES = 6;
/** Busyness of each surface around a source point: 3×3 average of block contrast, 16×16 blocks. */
const BLOCKS = 16;
const busyness = new WeakMap<Uint8ClampedArray, Float32Array>();
function busynessMap(samples: Uint8ClampedArray, size: number) {
  let map = busyness.get(samples);
  if (map) return map;
  const block = size / BLOCKS,
    count = block * block,
    raw = new Float32Array(10 * BLOCKS * BLOCKS);
  map = new Float32Array(raw.length);
  for (let m = 0; m < 10; m++)
    for (let by = 0; by < BLOCKS; by++)
      for (let bx = 0; bx < BLOCKS; bx++) {
        let sum = 0,
          squares = 0;
        for (let y = 0; y < block; y++)
          for (let x = 0; x < block; x++) {
            const k = ((m * size + by * block + y) * size + bx * block + x) * 4,
              l = 0.3 * samples[k] + 0.59 * samples[k + 1] + 0.11 * samples[k + 2];
            sum += l;
            squares += l * l;
          }
        raw[(m * BLOCKS + by) * BLOCKS + bx] = squares / count - (sum / count) ** 2;
      }
  for (let m = 0; m < 10; m++)
    for (let by = 0; by < BLOCKS; by++)
      for (let bx = 0; bx < BLOCKS; bx++) {
        let total = 0;
        for (let y = Math.max(0, by - 1); y <= Math.min(BLOCKS - 1, by + 1); y++)
          for (let x = Math.max(0, bx - 1); x <= Math.min(BLOCKS - 1, bx + 1); x++)
            total += raw[(m * BLOCKS + y) * BLOCKS + x];
        map[(m * BLOCKS + by) * BLOCKS + bx] = total;
      }
  busyness.set(samples, map);
  return map;
}
/** A reduced copy of the sheet picks exactly the same patches as the sheet it came from. */
export function shareSurfaceDetail(sheet: Uint8ClampedArray, copy: Uint8ClampedArray) {
  busyness.set(copy, busynessMap(sheet, Math.round(Math.sqrt(sheet.length / 40))));
}
/** Source position (in cell texels) for texture coordinates a, b. */
function sourcePoint(material: number, a: number, b: number, size: number, out: number[]) {
  if (material === 7 || material === 9 || material >= FIRST_WILD) {
    // Screen-aligned like the illustrated tiles, so the painted boulder faces keep their upper-left
    // light instead of being turned 45° and flattened into paving. About 6 source pixels per pixel.
    out[0] = (0.5 + (a - b) * 0.7) * size;
    out[1] = (0.5 + (a + b - 1) * 0.35) * size;
    return;
  }
  const [x0, y0, x1, y1] = SURFACE_WINDOW;
  out[0] = ((0.5 + (a - b) * 0.19 - x0) / (x1 - x0)) * size;
  out[1] = (((material === 5 ? 0.5 : 0.49) + (a + b - 1) * 0.145 - y0) / (y1 - y0)) * size;
}
const point = [0, 0],
  scores = new Float64Array(CANDIDATES),
  sorted = new Float64Array(CANDIDATES);
// Patch choices are pure functions of material and patch; neighbouring pixels share them.
const CACHE = 4096,
  cacheKeys = new Int32Array(CACHE * 3).fill(-1 << 30),
  cacheValues = new Float64Array(CACHE * 2);
let cacheMap: Float32Array | null = null;
/**
 * Picks where patch (cx, cy) reads the source. Of six seeded choices, light areas take the calmest
 * and rich areas the busiest, so detail varies by selection while the texture keeps its contrast.
 */
function patchOffset(
  samples: Uint8ClampedArray,
  size: number,
  material: number,
  cx: number,
  cy: number,
  grid: number,
  out: number[],
) {
  const seed = (material + 1) * 29;
  if (material >= 5 && material !== 6) {
    // Water, rock and road take a plain seeded offset; rock's wider source mapping allows less.
    const spread = material === 7 || material === 9 || material >= FIRST_WILD ? 0.2 : 0.3;
    out[0] = (hash2(cx, cy, seed + 81) - 0.5) * spread;
    out[1] = (hash2(cx, cy, seed + 177) - 0.5) * spread;
    return;
  }
  const map = busynessMap(samples, size);
  if (map !== cacheMap) {
    cacheKeys.fill(-1 << 30);
    cacheMap = map;
  }
  const slot =
    (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ (material * 83492791)) & (CACHE - 1);
  if (
    cacheKeys[slot * 3] === cx &&
    cacheKeys[slot * 3 + 1] === cy &&
    cacheKeys[slot * 3 + 2] === material
  ) {
    out[0] = cacheValues[slot * 2];
    out[1] = cacheValues[slot * 2 + 1];
    return;
  }
  const target = (grassDetail(cx / grid, cy / grid) - 0.48) / 0.52;
  for (let k = 0; k < CANDIDATES; k++) {
    const oa = (hash2(cx, cy, seed + 81 + k * 7) - 0.5) * 0.3,
      ob = (hash2(cx, cy, seed + 177 + k * 7) - 0.5) * 0.3;
    sourcePoint(material, 0.5 + oa, 0.5 + ob, BLOCKS, point);
    const bx = Math.max(0, Math.min(BLOCKS - 1, Math.floor(point[0]))),
      by = Math.max(0, Math.min(BLOCKS - 1, Math.floor(point[1])));
    scores[k] = sorted[k] = map[(material * BLOCKS + by) * BLOCKS + bx];
  }
  // The busyness rank this area wants among the candidates, then the candidate holding it.
  sorted.sort();
  const wanted = sorted[Math.round(Math.max(0, Math.min(1, target)) * (CANDIDATES - 1))];
  let best = 0;
  while (scores[best] !== wanted) best++;
  out[0] = cacheValues[slot * 2] = (hash2(cx, cy, seed + 81 + best * 7) - 0.5) * 0.3;
  out[1] = cacheValues[slot * 2 + 1] = (hash2(cx, cy, seed + 177 + best * 7) - 0.5) * 0.3;
  cacheKeys[slot * 3] = cx;
  cacheKeys[slot * 3 + 1] = cy;
  cacheKeys[slot * 3 + 2] = material;
}
/** Bilinear source texel, weighted into out. */
function addTexel(
  samples: Uint8ClampedArray,
  size: number,
  material: number,
  x: number,
  y: number,
  weight: number,
  out: number[],
) {
  x = Math.max(0, Math.min(size - 1.001, x - 0.5));
  y = Math.max(0, Math.min(size - 1.001, y - 0.5));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = x - ix,
    v = y - iy,
    k = ((material * size + iy) * size + ix) * 4,
    row = size * 4;
  for (let c = 0; c < 3; c++)
    out[c] +=
      weight *
      ((samples[k + c] * (1 - u) + samples[k + 4 + c] * u) * (1 - v) +
        (samples[k + row + c] * (1 - u) + samples[k + row + 4 + c] * u) * v);
}
const offset = [0, 0];
/**
 * Illustrated source sampled in irregular world-space patches. Each patch reads one offset of the
 * source at full contrast; only a narrow warped seam blends neighbouring patches. `samples` holds
 * the ten square surface cells at any power-of-two size, so a reduced copy serves coarse chunks.
 */
function sampleSurface(
  samples: Uint8ClampedArray,
  material: number,
  x: number,
  y: number,
  out: number[],
) {
  const wild = material >= FIRST_WILD;
  if (wild && !wildSheets.has(samples)) {
    sampleSurface(samples, WILD_FALLBACK[material - FIRST_WILD], x, y, out);
    return;
  }
  const sheet = wild ? wildSheets.get(samples)! : samples;
  const size = Math.round(Math.sqrt(sheet.length / (4 * (wild ? WILD_CELLS : 10))));
  const rock = wild || material === 7 || material === 9;
  const grid = rock ? 0.9 : 0.72,
    rate = rock ? 0.23 : SURFACE_RATE;
  const sx = x * grid + (surfaceNoise(x * 1.3, y * 1.3, 41) - 0.5) * 0.3,
    sy = y * grid + (surfaceNoise(x * 1.3, y * 1.3, 43) - 0.5) * 0.3,
    ix = Math.floor(sx),
    iy = Math.floor(sy),
    u = smooth((sx - ix - 0.5) / PATCH_SEAM + 0.5),
    v = smooth((sy - iy - 0.5) / PATCH_SEAM + 0.5);
  out[0] = out[1] = out[2] = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? u : 1 - u) * (dy ? v : 1 - v);
      if (!w) continue;
      patchOffset(samples, size, material, ix + dx, iy + dy, grid, offset);
      const a = 0.5 + (x - (ix + dx) / grid) * rate + offset[0],
        b = 0.5 + (y - (iy + dy) / grid) * rate + offset[1];
      sourcePoint(material, a, b, size, point);
      addTexel(sheet, size, wild ? material - FIRST_WILD : material, point[0], point[1], w, out);
    }
}

/** Grass remains the dominant surface, with coherent exposed stone islands and narrow edges. */
export function rockExposure(x: number, y: number) {
  const n = surfaceNoise(x * 0.85, y * 0.85, 607) + (surfaceNoise(x * 4, y * 4, 613) - 0.5) * 0.06;
  return smooth((n - 0.64) / 0.06);
}
/**
 * `exposure` overrides where rock shows (0..1), e.g. by slope; without it rock and mountain use
 * their world-space stone islands and every other material shows as itself.
 */
export function surfaceColor(
  samples: Uint8ClampedArray,
  material: number,
  x: number,
  y: number,
  out: number[],
  exposure?: number,
  /** Ground between stones on rock and mountain tiles (grass unless the biome says otherwise). */
  rockGround = 0,
) {
  const rocky = material === 7 || material === 9 || material === Material.HighRock;
  if (exposure === undefined) {
    if (!rocky) {
      sampleSurface(samples, material, x, y, out);
      return;
    }
    exposure = rockExposure(x, y);
  }
  // Rock and mountain ground is grass between stones; exposed faces elsewhere are plain rock.
  const ground = rocky ? rockGround : material;
  if (exposure === 0) {
    sampleSurface(samples, ground, x, y, out);
    return;
  }
  sampleSurface(samples, rocky ? material : 7, x, y, out);
  const r = out[0],
    g = out[1],
    b = out[2];
  sampleSurface(samples, ground, x, y, out);
  out[0] += (r - out[0]) * exposure;
  out[1] += (g - out[1]) * exposure;
  out[2] += (b - out[2]) * exposure;
}
