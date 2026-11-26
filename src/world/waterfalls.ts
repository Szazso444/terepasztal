import { DIR_DX, DIR_DY, type Dir } from '../engine/iso';
import { MAX_LEVEL } from './elevation';
import { Terrain, type GameMap } from './tiles';

/**
 * Waterfalls (#342): where a river's water drops to a lower level on the tile downstream of it.
 *
 * The waterfall is the upper tile, the one the water falls from. It stays what it was: Water in
 * the River biome, with its water level, flow and downstream side (GameMap.waterSurface, flow and
 * flowDir); no terrain or biome says it falls. What marks it is its byte in the feature plane
 * (GameMap.feature): its drop, its own water level less the level of the water it falls into, and
 * the edge it falls over, which is always its downstream side, so a fall drawn on it continues the
 * river's channel and never stands across it.
 *
 * The feature plane holds a byte a tile:
 *
 * - bits 0 to 2: the drop, 1 to MAX_DROP on a waterfall, 0 on any other tile;
 * - bits 3 and 4: the edge a waterfall falls over, as a Dir (0 N, 1 E, 2 S, 3 W); 0 on a tile that
 *   is no waterfall;
 * - bits 5 and 6: the headwater kind of the tile (#356): Headwater.None, Melt or Spring, on a river
 *   tile, a waterfall or not; held from CHUNK_VERSION 6;
 * - bit 7: unused, 0.
 *
 * Water stands at levels 0 to MAX_LEVEL, so no drop is more than MAX_DROP and none needs splitting
 * over several tiles. Generation marks the waterfalls of a map on the ground around it
 * (markWaterfalls in mapgen.ts), so a river tile at the map's edge knows the tile beyond it, and
 * stored chunks keep the plane from CHUNK_VERSION 4; a chunk stored before it has no waterfalls.
 *
 * Generated water steps down one level at a time (rivers.ts, the drainage's levels), so every
 * waterfall a world generates drops one level. Drops of 2 to MAX_DROP are held all the same; the
 * relief (tileLevels) keeps every tile within a level of its neighbours, water included, so such a
 * drop would stand in it as a single level.
 */

/** The largest drop: from the highest water level to the lowest. */
export const MAX_DROP = MAX_LEVEL;

/** The drop's bits of a feature byte. */
const DROP_BITS = 0b111;
/** Where the edge's two bits start. */
const EDGE_SHIFT = 3;
/** The bits a waterfall holds: its drop and its edge. */
export const FALL_BITS = 0b1_1111;
/** Where the headwater kind's two bits start. */
const HEAD_SHIFT = 5;
/** The bits a headwater holds. */
export const HEAD_BITS = 0b110_0000;
/** The unused top bit. */
const RESERVED_BITS = 0b1000_0000;

/** Where a river starts in high ground (#356). */
export const enum Headwater {
  None = 0,
  /** the highest river tile below a glacier */
  Melt = 1,
  /** a river source at level 2 or more with no glacier above it */
  Spring = 2,
}
/** The lowest level a spring rises at: a source below it has no headwater. */
export const SPRING_LEVEL = 2;
/** The headwater kind of feature byte `f`. */
export const headwaterOf = (f: number): Headwater => ((f & HEAD_BITS) >> HEAD_SHIFT) as Headwater;
/** Feature byte `f` with headwater kind `kind`. */
export const withHeadwater = (f: number, kind: Headwater): number =>
  (f & ~HEAD_BITS) | (kind << HEAD_SHIFT);

/** The feature byte of a waterfall of `drop` (1 to MAX_DROP) over `edge`. */
export function fallFeature(drop: number, edge: Dir): number {
  if (!Number.isInteger(drop) || drop < 1 || drop > MAX_DROP)
    throw new Error(`a waterfall drops 1 to ${MAX_DROP} levels, not ${drop}`);
  return drop | (edge << EDGE_SHIFT);
}
/** The drop of feature byte `f`: 0 when it is no waterfall. */
export const fallDrop = (f: number): number => f & DROP_BITS;
/** The edge the waterfall of feature byte `f` falls over; read it only where fallDrop is above 0. */
export const fallEdge = (f: number): Dir => ((f >> EDGE_SHIFT) & 3) as Dir;

/**
 * Whether `f` is a byte the feature plane holds: a drop of 0 to MAX_DROP, an edge only with a drop,
 * a headwater kind there is, and not the unused bit.
 */
export function isFeature(f: number): boolean {
  if (!Number.isInteger(f) || f < 0 || f > 255 || f & RESERVED_BITS) return false;
  const drop = fallDrop(f);
  if (headwaterOf(f) > Headwater.Spring) return false;
  return drop <= MAX_DROP && (drop > 0 || !(f & FALL_BITS));
}

/** A waterfall: how many levels its water drops, and the edge it falls over. */
export interface Waterfall {
  drop: number;
  edge: Dir;
}

/** The waterfall on tile (`x`, `y`) of `map`; null where there is none, and off the map. */
export function waterfallAt(
  map: Pick<GameMap, 'w' | 'h' | 'feature'>,
  x: number,
  y: number,
): Waterfall | null {
  if (!map.feature || x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
  const f = map.feature[y * map.w + x];
  const drop = fallDrop(f);
  return drop ? { drop, edge: fallEdge(f) } : null;
}

/** The headwater on tile (`x`, `y`) of `map`; Headwater.None where there is none, and off the map. */
export function headwaterAt(
  map: Pick<GameMap, 'w' | 'h' | 'feature'>,
  x: number,
  y: number,
): Headwater {
  if (!map.feature || x < 0 || y < 0 || x >= map.w || y >= map.h) return Headwater.None;
  return headwaterOf(map.feature[y * map.w + x]);
}

/** The planes a waterfall is read off: a map's, or the field's generation works on. */
export type WaterPlanes = Pick<GameMap, 'w' | 'h' | 'terrain'> &
  Pick<Partial<GameMap>, 'waterSurface' | 'flowDir'>;

/**
 * The waterfall bits (FALL_BITS) tile `i` (`y * w + x`) has as its water stands: a waterfall where
 * it is a river tile (Water with a downstream side) whose downstream tile is Water at a lower level,
 * its drop the difference and its edge the downstream side; 0 on any other tile, and where the
 * downstream tile is off the planes, which say nothing of it. A difference past MAX_DROP, which no
 * water level allows, is held to MAX_DROP.
 */
export function fallAt(p: WaterPlanes, i: number): number {
  const { w, h, terrain, waterSurface, flowDir } = p;
  const side = flowDir?.[i] ?? 0;
  if (!side || !waterSurface || terrain[i] !== Terrain.Water) return 0;
  const edge = (side - 1) as Dir;
  const x = (i % w) + DIR_DX[edge];
  const y = Math.floor(i / w) + DIR_DY[edge];
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const n = y * w + x;
  if (terrain[n] !== Terrain.Water) return 0;
  const drop = waterSurface[i] - waterSurface[n];
  return drop > 0 ? fallFeature(Math.min(drop, MAX_DROP), edge) : 0;
}

/**
 * Marks the waterfalls of the tiles of `s` (all of the planes when it is left out) in feature plane
 * `out`, a plane of the same size: each tile's waterfall bits become fallAt's, and its other bits
 * stay as they are.
 */
export function markWaterfalls(
  p: WaterPlanes,
  out: Uint8Array,
  s: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: p.w, y1: p.h },
) {
  const { w, h } = p;
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0), i = y * w + x; x < Math.min(w, s.x1); x++, i++)
      out[i] = (out[i] & ~FALL_BITS) | fallAt(p, i);
}

/**
 * Whether river tile `i` is a source: no river runs into it, and it is no lake's outlet (no still
 * water on any of its sides).
 */
export function isRiverSource(p: WaterPlanes, i: number): boolean {
  const { w, h, terrain, flowDir } = p;
  if (terrain[i] !== Terrain.Water || !flowDir?.[i]) return false;
  const x = i % w;
  const y = (i - x) / w;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d as Dir];
    const ny = y + DIR_DY[d as Dir];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const n = ny * w + nx;
    if (terrain[n] !== Terrain.Water) continue;
    // running into `i` it flows the opposite way to `d`, the way it lies from here
    const side = flowDir[n];
    if (!side || side - 1 === (d + 2) % 4) return false;
  }
  return true;
}

/**
 * Marks the headwaters of the tiles of `s` in feature plane `out`, keeping each tile's other bits:
 * Melt where `melt` has a 1 (the plan's glaciers), and Spring on any other river source at
 * SPRING_LEVEL or more. Run it after the river pass has settled, so a stream it removed has none.
 */
export function markHeadwaters(
  p: WaterPlanes,
  out: Uint8Array,
  s: { x0: number; y0: number; x1: number; y1: number },
  melt: Uint8Array,
) {
  const { w, h, waterSurface } = p;
  for (let y = Math.max(0, s.y0); y < Math.min(h, s.y1); y++)
    for (let x = Math.max(0, s.x0), i = y * w + x; x < Math.min(w, s.x1); x++, i++) {
      const spring = (waterSurface?.[i] ?? 0) >= SPRING_LEVEL && isRiverSource(p, i);
      const kind = melt[i] ? Headwater.Melt : spring ? Headwater.Spring : Headwater.None;
      out[i] = withHeadwater(out[i], kind);
    }
}
