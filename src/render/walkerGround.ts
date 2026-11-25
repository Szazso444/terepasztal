import { depthKey } from '../engine/iso';
import type { GameMap, PropKind } from '../world/tiles';

/** The ground's y offset under a tile point, in world pixels (up is negative), as the world reads it. */
export type GroundAt = (x: number, y: number) => number;

/**
 * How far either side of a tile edge a walker spreads a jump in the ground, in tiles. The painted
 * landscape has no jumps; the per-tile ground the game falls back to when its painter fails does,
 * and a walker climbs one over this distance instead of popping a level at the edge.
 */
export const EDGE_RAMP = 0.25;
/** How far either side of an edge the ground is read to measure its jump there, in tiles. */
const EDGE_READ = 1e-5;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * `ground(t, s)` with each jump at a tile edge across `t` spread over `ramp` either side of the
 * edge; `s` is the other axis, held.
 */
function rampAcross(ground: GroundAt, t: number, s: number, ramp: number) {
  const here = ground(t, s),
    tile = Math.round(t),
    side = t >= tile ? 1 : -1,
    // distance to the nearer edge of the tile the point is on
    gap = 0.5 - Math.abs(t - tile);
  if (gap >= ramp) return here;
  const edge = tile + side / 2,
    jump = ground(edge + side * EDGE_READ, s) - ground(edge - side * EDGE_READ, s);
  // nothing at `ramp` from the edge, half the jump at it: the two sides meet there
  return here + jump * smoothstep((ramp - gap) / (2 * ramp));
}

/**
 * The ground a walker at (x, y) stands on: `ground` itself wherever it is continuous (to within a
 * hundredth of a pixel), and across a tile edge where it jumps, a smooth climb from one side's
 * height to the other's over EDGE_RAMP either side. Ramping along x first, then ramping that
 * along y, keeps the result continuous at tile corners too. Reads `ground` at most nine times.
 */
export function walkerGround(ground: GroundAt, x: number, y: number, ramp = EDGE_RAMP): number {
  // the ground ramped along x, read with its axes swapped so it can be ramped along y in turn
  const alongX: GroundAt = (yy, xx) => rampAcross(ground, xx, yy, ramp);
  return rampAcross(alongX, y, x, ramp);
}

/**
 * Props that lie over their whole tile like ground rather than stand on it: a wheat field, a
 * coal seam, an oil seep. Each is one sprite sorted by its tile centre, so a walker on the half of
 * the tile behind that centre would be drawn under it.
 */
export const GROUND_COVER: ReadonlySet<PropKind> = new Set<PropKind>(['wheat', 'coal', 'oil']);
/** A walker's layer within its depth key: over props (10), under structures (20). */
export const WALKER_LAYER = 16;
/** The layer every prop sprite is sorted at (WorldRenderer's `propSprite`). */
const PROP_LAYER = 10;
/** How far over a ground cover's key a walker standing on it sorts. */
const OVER_COVER = 0.5;

/**
 * A walker's sort key in the object layer: its feet's depth, as everything standing there is
 * sorted, lifted just over any ground cover on the tile it stands on, so it is always drawn on
 * top of the ground under it and never beneath the tile.
 */
export function walkerDepth(map: Pick<GameMap, 'w' | 'h' | 'props'>, x: number, y: number) {
  let depth = depthKey(x, y, WALKER_LAYER);
  const tx = Math.round(x),
    ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return depth;
  for (const p of map.props.get(ty * map.w + tx) ?? [])
    if (GROUND_COVER.has(p.kind))
      depth = Math.max(depth, depthKey(tx + p.ox, ty + p.oy, PROP_LAYER) + OVER_COVER);
  return depth;
}
