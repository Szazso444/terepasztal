import { hash2 } from '../engine/rng';
import { materialAt, type LandscapeMap } from './landscapeModel';

export const SURFACE_COLORS = [
  [106, 121, 65],
  [84, 103, 58],
  [185, 158, 102],
  [103, 124, 103],
  [92, 111, 75],
  [64, 111, 116],
  [185, 161, 111],
  [125, 128, 116],
  [154, 147, 123],
  [137, 142, 136],
] as const;
export const GRASS_DETAIL = 0.78;
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

/** Same balanced illustrated source sampling as the approved terrain-v4 comparison. */
function sampleSurface(
  samples: Uint8ClampedArray,
  material: number,
  x: number,
  y: number,
  out: number[],
) {
  const rock = material === 7 || material === 9;
  const grid = rock ? 0.9 : 0.72,
    rate = rock ? 0.23 : 0.2;
  const sx = x * grid,
    sy = y * grid,
    ix = Math.floor(sx),
    iy = Math.floor(sy),
    u = smooth(sx - ix),
    v = smooth(sy - iy);
  out[0] = out[1] = out[2] = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const a = 0.5 + (x - (ix + dx) / grid) * rate + (hash2(ix + dx, iy + dy, 81) - 0.5) * 0.24;
      const b = 0.5 + (y - (iy + dy) / grid) * rate + (hash2(ix + dx, iy + dy, 177) - 0.5) * 0.24;
      const px = Math.round(512 * (rock ? a : 0.5 + (a - b) * 0.19)),
        py = Math.round(512 * (rock ? b : (material === 5 ? 0.5 : 0.49) + (a + b - 1) * 0.145));
      const k = ((material * 512 + py) * 512 + px) * 4,
        w = (dx ? u : 1 - u) * (dy ? v : 1 - v);
      out[0] += samples[k] * w;
      out[1] += samples[k + 1] * w;
      out[2] += samples[k + 2] * w;
    }
  const strength = material === 5 ? 0.8 : material >= 7 ? GRASS_DETAIL : grassDetail(x, y),
    base = SURFACE_COLORS[material];
  for (let i = 0; i < 3; i++) out[i] = base[i] + (out[i] - base[i]) * strength;
}

/** Grass remains the dominant surface, with coherent exposed stone islands. */
export function rockExposure(x: number, y: number) {
  return 0.82 * smooth((surfaceNoise(x * 0.85, y * 0.85, 607) - 0.57) / 0.2);
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
