import { hash2 } from '../engine/rng';
import { materialAt, type LandscapeMap } from './landscapeModel';

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

/** Feather only a 0.06-tile strip following the irregular interlock. */
export function surfaceBlend(map: LandscapeMap, x: number, y: number, out: number[]) {
  const [u, v] = surfaceLocation(map, x, y),
    ix = Math.floor(u),
    iy = Math.floor(v);
  const fx = smooth((u - ix - 0.47) / 0.06),
    fy = smooth((v - iy - 0.47) / 0.06);
  out[0] = materialAt(map, ix, iy);
  out[1] = materialAt(map, ix + 1, iy);
  out[2] = materialAt(map, ix, iy + 1);
  out[3] = materialAt(map, ix + 1, iy + 1);
  out[4] = (1 - fx) * (1 - fy);
  out[5] = fx * (1 - fy);
  out[6] = (1 - fx) * fy;
  out[7] = fx * fy;
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
  if (material === 7 || material === 9) {
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
    const spread = material === 7 || material === 9 ? 0.2 : 0.3;
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
  const size = Math.round(Math.sqrt(samples.length / 40));
  const rock = material === 7 || material === 9;
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
      addTexel(samples, size, material, point[0], point[1], w, out);
    }
}

/** Grass remains the dominant surface, with coherent exposed stone islands and narrow edges. */
export function rockExposure(x: number, y: number) {
  const n = surfaceNoise(x * 0.85, y * 0.85, 607) + (surfaceNoise(x * 4, y * 4, 613) - 0.5) * 0.06;
  return smooth((n - 0.64) / 0.06);
}
export function surfaceColor(
  samples: Uint8ClampedArray,
  material: number,
  x: number,
  y: number,
  out: number[],
) {
  if (material !== 7 && material !== 9) {
    sampleSurface(samples, material, x, y, out);
    return;
  }
  const exposure = rockExposure(x, y);
  if (exposure === 0) {
    sampleSurface(samples, 0, x, y, out);
    return;
  }
  sampleSurface(samples, material, x, y, out);
  const r = out[0],
    g = out[1],
    b = out[2];
  sampleSurface(samples, 0, x, y, out);
  out[0] += (r - out[0]) * exposure;
  out[1] += (g - out[1]) * exposure;
  out[2] += (b - out[2]) * exposure;
}
