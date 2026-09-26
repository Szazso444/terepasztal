import { Terrain } from '../world/tiles';
import { hash2 } from '../engine/rng';
import type { LandscapeMap } from './landscapeModel';

export const RELIEF_STEP = 10;
/** Highest surface point in world pixels for any supported style (four levels plus a crown). */
export const RELIEF_MAX = 60;
/** World pixels a vertical tile side spans: 2:1 iso at a 30° camera elevation. */
export const TILE_SIDE_PX = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
export interface ReliefStyle {
  /** World pixels per level. */
  step: number;
  /** Largest corner difference along a tile edge, in levels. 2 mixes one- and two-level rises. */
  maxRise: 1 | 2;
  /** Light each tile by its own slope, so elevated tiles read as tiles. */
  faces: boolean;
}
/** The shipped style. */
export const DEFAULT_RELIEF: ReliefStyle = { step: RELIEF_STEP, maxRise: 1, faces: false };
export interface TerrainRelief {
  /** Shared lattice: corner (x,y) is at tile coordinate (x-.5,y-.5). */
  corners: Uint8Array;
  centres: Float32Array;
  style: ReliefStyle;
}
export type HillFamily = 'flat' | 'slope' | 'shoulder' | 'saddle' | 'ridge' | 'plateau' | 'peak';

/** Discrete landform levels, not a blurred height field. No simulation planes are changed. */
export function buildRelief(
  map: LandscapeMap,
  flat: ReadonlySet<number>,
  style: ReliefStyle = DEFAULT_RELIEF,
): TerrainRelief {
  const { w, h } = map,
    stride = w + 1,
    step = style.step;
  const corners = new Uint8Array(stride * (h + 1));
  // A corner touching a flat or non-hill tile must stay at zero. This makes the entire
  // railway/structure footprint flat, including its edges, rather than only its anchor.
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      let level = 4;
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -1; dx <= 0; dx++) {
          const tx = x + dx,
            ty = y + dy,
            k = ty * w + tx;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h || flat.has(k)) {
            level = 0;
            continue;
          }
          const t = map.terrain[k];
          level = Math.min(level, t === Terrain.Hill ? 2 : t === Terrain.Mountain ? 4 : 0);
        }
      // Broad saddles in mountain interiors avoid a uniform, featureless tabletop.
      if (level === 4) {
        const gx = Math.floor((x + map.originX) / 4),
          gy = Math.floor((y + map.originY) / 4);
        if (hash2(gx, gy, map.seed + 503) < 0.35) level = 3;
      }
      corners[y * stride + x] = level;
    }
  // Distance transform bounds neighbouring corner differences. With maxRise 2 each edge allows
  // one or two levels, seeded per edge, so gentle and steep slopes mix; passes repeat until stable.
  const rise = (x: number, y: number, vertical: number) =>
    style.maxRise === 1 || hash2(x + map.originX, y + map.originY, map.seed + 211 + vertical) < 0.5
      ? 1
      : 2;
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y <= h; y++)
      for (let x = 0; x <= w; x++) {
        const k = y * stride + x,
          v = Math.min(
            corners[k],
            x ? corners[k - 1] + rise(x - 1, y, 0) : 255,
            y ? corners[k - stride] + rise(x, y - 1, 1) : 255,
          );
        if (v !== corners[k]) {
          corners[k] = v;
          changed = true;
        }
      }
    for (let y = h; y >= 0; y--)
      for (let x = w; x >= 0; x--) {
        const k = y * stride + x,
          v = Math.min(
            corners[k],
            x < w ? corners[k + 1] + rise(x, y, 0) : 255,
            y < h ? corners[k + stride] + rise(x, y, 1) : 255,
          );
        if (v !== corners[k]) {
          corners[k] = v;
          changed = true;
        }
      }
  }
  const centres = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x,
        t = map.terrain[k];
      if (flat.has(k) || (t !== Terrain.Hill && t !== Terrain.Mountain)) continue;
      const c = y * stride + x,
        a = corners[c] * step,
        b = corners[c + 1] * step,
        d = corners[c + stride + 1] * step,
        e = corners[c + stride] * step;
      let z = (a + b + d + e) / 4;
      const wx = x + map.originX,
        wy = y + map.originY;
      // A few distinct summit caps; the remaining tiles become connecting landforms.
      const summit =
        t === Terrain.Mountain &&
        Math.min(a, b, d, e) >= 2 * step &&
        hash2(wx, wy, map.seed + 87) > 0.87;
      if (summit) z += 0.7 * step;
      else if (a === b && b === d && d === e && z === 0) z = 0.5 * step; // isolated low hill
      // Along the camera ray d(height)/d(x+y) stays below the 32px ground projection.
      // This prevents foldovers and allows one shared inverse projection in the painter.
      centres[k] = Math.max(Math.max(a, d) - 1.4 * step, Math.min(Math.min(a, d) + 1.4 * step, z));
    }
  return { corners, centres, style };
}

export function reliefCorners(map: LandscapeMap, relief: TerrainRelief, x: number, y: number) {
  const stride = map.w + 1,
    k = y * stride + x,
    c = relief.corners;
  return [c[k], c[k + 1], c[k + stride + 1], c[k + stride]].map((v) => v * relief.style.step);
}

/** Bilinear shared edges with a small rounded crown; no visible triangle-fan geometry. */
export function reliefHeight(
  map: LandscapeMap,
  relief: TerrainRelief,
  x: number,
  y: number,
): number {
  if (x < -0.5 || y < -0.5 || x >= map.w - 0.5 || y >= map.h - 0.5) return 0;
  const tx = Math.floor(x + 0.5),
    ty = Math.floor(y + 0.5),
    u = x - tx + 0.5,
    v = y - ty + 0.5;
  const stride = map.w + 1,
    k = ty * stride + tx,
    c = relief.corners;
  const step = relief.style.step,
    a = c[k] * step,
    b = c[k + 1] * step,
    d = c[k + stride + 1] * step,
    e = c[k + stride] * step,
    z = relief.centres[ty * map.w + tx];
  const base = a + (b - a) * u + (e - a) * v + (a - b - e + d) * u * v;
  const limit = (a === b && b === d && d === e ? 0.5 : 0.2) * step;
  const crown = Math.max(-limit, Math.min(limit, z - (a + b + d + e) / 4));
  // A rounded interior crown vanishes along every shared edge; no triangular fans.
  return base + crown * 16 * u * (1 - u) * v * (1 - v);
}

/** Inverse of tile projection onto this surface, shared by picking and visual QA. */
export function reliefTileAtWorld(
  map: LandscapeMap,
  relief: TerrainRelief,
  wx: number,
  wy: number,
) {
  const bx = wx / 64 + wy / 32,
    by = wy / 32 - wx / 64,
    z = surfaceAlongRay(map, relief, bx, by, 16);
  return { x: Math.round(bx + z / 32) || 0, y: Math.round(by + z / 32) || 0 };
}

/**
 * Height where the camera ray through ground point (bx, by) meets the surface. Along that ray a
 * higher point is nearer the camera, so the visible hit is the highest one. Surfaces that stay
 * below the ray's own rise take a plain bisection; steeper styles scan down from the top first.
 */
export function surfaceAlongRay(
  map: LandscapeMap,
  relief: TerrainRelief,
  bx: number,
  by: number,
  iterations: number,
) {
  const above = (z: number) => reliefHeight(map, relief, bx + z / 32, by + z / 32) > z;
  let lo = 0,
    hi = RELIEF_MAX;
  if (relief.style.maxRise > 1 || relief.style.step > RELIEF_STEP) {
    let z = RELIEF_MAX - 3;
    while (z > 0 && !above(z)) z -= 3;
    if (z <= 0) return 0;
    lo = z;
    hi = Math.min(RELIEF_MAX, z + 3);
  }
  for (let n = 0; n < iterations; n++) {
    const z = (lo + hi) / 2;
    if (above(z)) lo = z;
    else hi = z;
  }
  return (lo + hi) / 2;
}

export function hillFamily(
  map: LandscapeMap,
  relief: TerrainRelief,
  x: number,
  y: number,
): HillFamily {
  const [a, b, c, d] = reliefCorners(map, relief, x, y),
    z = relief.centres[y * map.w + x];
  const lo = Math.min(a, b, c, d),
    hi = Math.max(a, b, c, d);
  if (z > hi) return hi >= 20 ? 'peak' : 'shoulder';
  if (lo === hi) return hi ? 'plateau' : 'flat';
  if (a === c && b === d && a !== b) return a > b ? 'ridge' : 'saddle';
  if ([a, b, c, d].filter((v) => v === hi).length === 1) return 'shoulder';
  if ([a, b, c, d].filter((v) => v === lo).length === 1) return 'saddle';
  return 'slope';
}
