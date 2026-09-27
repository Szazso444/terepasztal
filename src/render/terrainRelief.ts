import { Terrain } from '../world/tiles';
import { hash2 } from '../engine/rng';
import { tileLevels } from '../world/elevation';
import { railLevel, type RailBed } from '../world/railProfile';
import type { LandscapeMap } from './landscapeModel';

export const RELIEF_STEP = 10;
/** Highest surface point in world pixels for any supported style (four half-side levels). */
export const RELIEF_MAX = 90;
/** World pixels a vertical tile side spans: 2:1 iso at a 30° camera elevation. */
export const TILE_SIDE_PX = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;
export interface ReliefStyle {
  /** World pixels per level. */
  step: number;
  /** Largest corner difference along a tile edge, in levels. 2 mixes one- and two-level rises. */
  maxRise: 1 | 2;
  /** Light each tile by its own slope, so elevated tiles read as tiles. */
  faces: boolean;
  /**
   * `corners` (default): each tile interpolates its four corner levels. `terraces`: each tile is
   * a flat plateau at its own level and level changes happen in a rounded bank at tile edges.
   */
  shape?: 'corners' | 'terraces';
  /** Terrace bank width in tiles, centred on the shared edge (default 0.5). */
  bank?: number;
  /** A soft light along the top of a slope and a soft shadow at its foot. */
  rims?: boolean;
  /** Steep slopes show rock (default); false keeps them grassy and lets light alone shape them. */
  rockFaces?: boolean;
  /** Preview: every terrace bank is rock, as locked on 2026-09-27 before the stacked-bank rule. */
  everyBankRock?: boolean;
  /** Preview: raised ground casts a soft shadow onto lower ground away from the light. */
  shadows?: boolean;
  /** Preview: grass on a slope takes a tone apart from grass on the flat. */
  bankGrass?: { tone: 'dry' | 'dark' | 'lush'; amount: number };
  /** Preview: each level above ground paints this much lighter; ground level is unchanged. */
  heightLight?: number;
  /** Preview: snow patches on the biome's snow line level, full snow from the level above. */
  snow?: boolean;
}
/**
 * The shipped style, approved 2026-09-27: terraces. Every hill tile is a level plateau at its own
 * level, a level is a quarter of a tile side, neighbouring tiles differ by at most one level, and
 * the change happens in a rounded bank half a tile wide at the shared edge. Banks show rock; slope
 * tops catch light and their feet sit in soft shadow. (Earlier: corner slopes, { step: 10,
 * maxRise: 1, faces: false }, then { step: side/4, maxRise: 2, faces: true }.)
 */
export const DEFAULT_RELIEF: ReliefStyle = {
  step: TILE_SIDE_PX / 4,
  maxRise: 1,
  faces: true,
  shape: 'terraces',
  bank: 0.5,
  rims: true,
};
export interface TerrainRelief {
  /** Shared lattice: corner (x,y) is at tile coordinate (x-.5,y-.5). */
  corners: Uint8Array;
  centres: Float32Array;
  style: ReliefStyle;
  /** Terraces only: the level of each tile. */
  tiles?: Uint8Array;
  /** Terraces only: straight track tiles and the rail profile over them; each carries a bed. */
  rails?: ReadonlyMap<number, RailBed>;
  /** Highest surface point of this relief in world pixels; the painter searches below it. */
  top: number;
}
export type HillFamily = 'flat' | 'slope' | 'shoulder' | 'saddle' | 'ridge' | 'plateau' | 'peak';

/**
 * Discrete landform levels, not a blurred height field. No simulation planes are changed.
 * `built` tiles (track, stations, buildings) keep the hill's corner heights: rails and structures
 * sit on the hill instead of cutting it away. They only lose the small rounded crown, so a rail
 * bed follows the corners exactly.
 */
export function buildRelief(
  map: LandscapeMap,
  built: ReadonlySet<number>,
  style: ReliefStyle = DEFAULT_RELIEF,
  rails: ReadonlyMap<number, RailBed> = new Map(),
): TerrainRelief {
  const { w, h } = map,
    stride = w + 1,
    step = style.step;
  const corners = new Uint8Array(stride * (h + 1));
  // A corner touching a non-hill tile stays at zero, so ordinary ground is always level.
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      let level = 4;
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -1; dx <= 0; dx++) {
          const tx = x + dx,
            ty = y + dy,
            k = ty * w + tx;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) {
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
      if (t !== Terrain.Hill && t !== Terrain.Mountain) continue;
      const c = y * stride + x,
        a = corners[c] * step,
        b = corners[c + 1] * step,
        d = corners[c + stride + 1] * step,
        e = corners[c + stride] * step;
      let z = (a + b + d + e) / 4;
      if (built.has(k)) {
        centres[k] = z;
        continue;
      }
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
  let top = 0;
  for (const c of corners) top = Math.max(top, c);
  if (style.shape === 'terraces') return terraces(map, style, corners, rails);
  return { corners, centres, style, top: top * step + step };
}

/**
 * Terraces over the shared tile levels (world/elevation.ts), which the simulation also reads.
 * Corners take the lowest touching tile, so rules that read corners stay conservative.
 */
function terraces(
  map: LandscapeMap,
  style: ReliefStyle,
  corners: Uint8Array,
  rails: ReadonlyMap<number, RailBed>,
): TerrainRelief {
  const { w, h } = map,
    tiles = tileLevels(map);
  const stride = w + 1,
    centres = new Float32Array(w * h);
  let top = 0;
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      let level = 255;
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -1; dx <= 0; dx++) {
          const tx = x + dx,
            ty = y + dy;
          level = tx < 0 || ty < 0 || tx >= w || ty >= h ? 0 : Math.min(level, tiles[ty * w + tx]);
        }
      corners[y * stride + x] = level;
    }
  for (let k = 0; k < w * h; k++) {
    centres[k] = tiles[k] * style.step;
    top = Math.max(top, centres[k]);
  }
  // Bridges carry their rail over the ground, which keeps its own shape.
  const beds = new Map<number, RailBed>();
  for (const [k, bed] of rails) if (!bed.bridge) beds.set(k, bed);
  return { corners, centres, style, tiles, rails: beds, top: top + 1 };
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
  if (relief.tiles) return terraceHeight(map, relief, x, y);
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

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Flat at each tile's level; between tile centres, a rounded bank only near the shared edge. */
function terraceHeight(map: LandscapeMap, relief: TerrainRelief, x: number, y: number) {
  const tiles = relief.tiles!,
    bank = relief.style.bank ?? 0.5,
    fx = Math.floor(x),
    fy = Math.floor(y),
    level = (tx: number, ty: number) =>
      tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? 0 : tiles[ty * map.w + tx],
    su = smoothstep((x - fx - 0.5) / bank + 0.5),
    sv = smoothstep((y - fy - 0.5) / bank + 0.5);
  const a = level(fx, fy),
    b = level(fx + 1, fy),
    c = level(fx, fy + 1),
    d = level(fx + 1, fy + 1),
    step = relief.style.step,
    terrace = step * ((a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv);
  // A straight rail rides its own bed, following the line's rail profile (world/railProfile.ts)
  // so neighbouring track tiles meet exactly. Outside the bed the hill keeps its terrace shape.
  const tx = Math.round(x),
    ty = Math.round(y),
    rail = relief.rails?.get(ty * map.w + tx);
  if (!rail) return terrace;
  const [along, across] = rail.axis === 'x' ? [x, y - ty] : [y, x - tx],
    bed = step * railLevel(rail, along),
    weight = 1 - smoothstep((Math.abs(across) - 0.28) / 0.16);
  return terrace + (bed - terrace) * weight;
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
  const ceiling = Math.min(RELIEF_MAX, relief.top);
  let lo = 0,
    hi = ceiling;
  if (relief.style.maxRise > 1 || relief.style.step > RELIEF_STEP || relief.tiles) {
    let z = ceiling - 3;
    while (z > 0 && !above(z)) z -= 3;
    if (z <= 0) return 0;
    lo = z;
    hi = Math.min(ceiling, z + 3);
  }
  for (let n = 0; n < iterations; n++) {
    const z = (lo + hi) / 2;
    if (above(z)) lo = z;
    else hi = z;
  }
  return (lo + hi) / 2;
}

/** Corner levels of tile (x, y), lowest and highest. */
function levelSpan(map: LandscapeMap, relief: TerrainRelief, x: number, y: number) {
  const stride = map.w + 1,
    k = y * stride + x,
    c = relief.corners,
    levels = [c[k], c[k + 1], c[k + stride + 1], c[k + stride]];
  return Math.max(...levels) - Math.min(...levels);
}
/**
 * Can this ground carry it? `straight` (a straight axis-aligned rail) climbs at most one level
 * across the tile; `level` (curves, switches, crossings, stations, buildings) needs a tile whose
 * corners are all at the same height, at whatever height the hill is.
 */
export function groundAllows(
  map: LandscapeMap,
  relief: TerrainRelief,
  x: number,
  y: number,
  need: 'straight' | 'level',
) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  if (relief.tiles) {
    // Terraces: neighbours never differ by more than a level, so a straight rail always fits
    // (its bed climbs at most one level per tile). Level pieces and structures need a tile
    // no bank reaches into: all four neighbours at its own level.
    if (need === 'straight') return true;
    const here = relief.tiles[y * map.w + x];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      const there =
        nx < 0 || ny < 0 || nx >= map.w || ny >= map.h ? 0 : relief.tiles[ny * map.w + nx];
      if (there !== here) return false;
    }
    return true;
  }
  return levelSpan(map, relief, x, y) <= (need === 'straight' ? 1 : 0);
}
/**
 * Height and slope of the surface at (x, y): `z` in world pixels, `gx`/`gy` in world pixels per
 * tile along +x and +y. Sprites standing on it are sheared by the slope.
 */
export function surfaceSlope(map: LandscapeMap, relief: TerrainRelief, x: number, y: number) {
  const d = 0.2;
  return {
    z: reliefHeight(map, relief, x, y),
    gx: (reliefHeight(map, relief, x + d, y) - reliefHeight(map, relief, x - d, y)) / (2 * d),
    gy: (reliefHeight(map, relief, x, y + d) - reliefHeight(map, relief, x, y - d)) / (2 * d),
  };
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
  // Corner averages of irrational level heights round; a crown is a real rise above that.
  if (z > hi + 1e-6) return hi >= 2 * relief.style.step ? 'peak' : 'shoulder';
  if (lo === hi) return hi ? 'plateau' : 'flat';
  if (a === c && b === d && a !== b) return a > b ? 'ridge' : 'saddle';
  if ([a, b, c, d].filter((v) => v === hi).length === 1) return 'shoulder';
  if ([a, b, c, d].filter((v) => v === lo).length === 1) return 'saddle';
  return 'slope';
}
