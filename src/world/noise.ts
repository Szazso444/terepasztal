import { hash2 } from '../engine/rng';

/** Smooth value noise built from the coordinate hash. */
export function valueNoise(x: number, y: number, seed: number): number {
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
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
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
export class NoiseRoom {
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
export function fbmBlock(
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
