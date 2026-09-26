import { Terrain, Biome, type GameMap } from '../world/tiles';

export type LandscapeMap = Pick<
  GameMap,
  'w' | 'h' | 'seed' | 'originX' | 'originY' | 'terrain' | 'biome'
>;
export const MATERIAL_COLORS = [
  [110, 125, 69],
  [88, 106, 60],
  [185, 158, 102],
  [106, 126, 103],
  [95, 112, 77],
  [65, 111, 116],
  [185, 161, 111],
  [127, 130, 118],
] as const;
const clamp = (n: number, hi: number) => Math.max(0, Math.min(hi, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function landscapeNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = smooth(x - ix),
    fy = smooth(y - iy);
  const a = hash(ix, iy, seed),
    b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed),
    d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}
export function materialAt(map: LandscapeMap, x: number, y: number) {
  const k = clamp(Math.round(y), map.h - 1) * map.w + clamp(Math.round(x), map.w - 1);
  const t = map.terrain[k],
    b = map.biome[k];
  if (t === Terrain.Water) return 5;
  if (t === Terrain.Sand) return b === Biome.Desert ? 2 : 6;
  if (t === Terrain.Rock || t === Terrain.Mountain) return 7;
  if (t === Terrain.Forest) return b === Biome.Swamp ? 4 : b === Biome.Taiga ? 3 : 1;
  return b === Biome.Ocean ? 0 : b;
}

/** Visual relief only: generation, terrain membership, costs and saves stay unchanged. */
export function landscapeHeights(map: LandscapeMap, flat: ReadonlySet<number>): Float32Array {
  const heights = new Float32Array(map.w * map.h);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const k = y * map.w + x;
      if (flat.has(k) || ![Terrain.Hill, Terrain.Mountain].includes(map.terrain[k])) continue;
      let mass = 0,
        weight = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = clamp(x + dx, map.w - 1),
            yy = clamp(y + dy, map.h - 1);
          const t = map.terrain[yy * map.w + xx],
            w = (3 - Math.abs(dx)) * (3 - Math.abs(dy));
          mass += (t === Terrain.Mountain ? 54 : t === Terrain.Hill ? 31 : 0) * w;
          weight += w;
        }
      heights[k] = mass / weight;
    }
  // Bound slopes even beside a freshly excavated railway. This keeps the surface
  // single-valued in isometric projection, and prevents overlapping chunk edges.
  for (let pass = 0; pass < 8; pass++)
    for (let j = 0; j < heights.length; j++) {
      const k = pass % 2 ? heights.length - 1 - j : j,
        x = k % map.w;
      let h = heights[k];
      if (x) h = Math.min(h, heights[k - 1] + 9);
      if (x < map.w - 1) h = Math.min(h, heights[k + 1] + 9);
      if (k >= map.w) h = Math.min(h, heights[k - map.w] + 9);
      if (k + map.w < heights.length) h = Math.min(h, heights[k + map.w] + 9);
      heights[k] = h;
    }
  return heights;
}
export function heightAt(map: LandscapeMap, heights: Float32Array, x: number, y: number) {
  x = clamp(x, map.w - 1);
  y = clamp(y, map.h - 1);
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const nx = Math.min(ix + 1, map.w - 1),
    ny = Math.min(iy + 1, map.h - 1);
  const a = heights[iy * map.w + ix],
    b = heights[iy * map.w + nx];
  const c = heights[ny * map.w + ix],
    d = heights[ny * map.w + nx];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

/** World-coordinate sampling: no texture restarts, mirroring or tile-sized motifs. */
export function landscapeColor(map: LandscapeMap, x: number, y: number, tint = 0xffffff): number[] {
  const wx = x + map.originX,
    wy = y + map.originY,
    seed = map.seed;
  // Coherent edge displacement, plus smaller broken tufts. Never move an edge
  // farther than .22 tile: the central buildable area still reads correctly.
  const warpX = (landscapeNoise(wx * 2.3, wy * 2.3, seed + 5) - 0.5) * 0.35;
  const warpY = (landscapeNoise(wx * 2.3, wy * 2.3, seed + 19) - 0.5) * 0.35;
  const u = x + warpX,
    v = y + warpY,
    ix = Math.floor(u),
    iy = Math.floor(v);
  const blend = (f: number) => smooth(clamp((f - 0.34) / 0.32, 1));
  const fx = blend(u - ix),
    fy = blend(v - iy);
  const a = MATERIAL_COLORS[materialAt(map, ix, iy)],
    b = MATERIAL_COLORS[materialAt(map, ix + 1, iy)];
  const c = MATERIAL_COLORS[materialAt(map, ix, iy + 1)],
    d = MATERIAL_COLORS[materialAt(map, ix + 1, iy + 1)];
  const waterWeight =
    (a === MATERIAL_COLORS[5] ? (1 - fx) * (1 - fy) : 0) +
    (b === MATERIAL_COLORS[5] ? fx * (1 - fy) : 0) +
    (c === MATERIAL_COLORS[5] ? (1 - fx) * fy : 0) +
    (d === MATERIAL_COLORS[5] ? fx * fy : 0);
  const broad = landscapeNoise(wx * 0.31, wy * 0.31, seed) - 0.5;
  const clumps = landscapeNoise(wx * 7.7, wy * 7.7, seed + 71) - 0.5;
  const grain = hash(Math.floor(wx * 33), Math.floor(wy * 33), seed + 331) - 0.5;
  const water = materialAt(map, x, y) === 5;
  const texture =
    broad * 15 + Math.round(clumps * 4) * (water ? 1.5 : 2.4) + grain * (water ? 2 : 5);
  return a.map(
    (n, i) =>
      (n + (b[i] - n) * fx + (c[i] - n + (n - b[i] - c[i] + d[i]) * fx) * fy + texture) *
      (waterWeight + ((1 - waterWeight) * ((tint >> (16 - i * 8)) & 255)) / 255),
  );
}
