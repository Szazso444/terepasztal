import { depthKey, HALF_W } from '../engine/iso';

/**
 * Where a bridge sorts in the depth-ordered object layer. Depth keys run 100 to a row of tiles
 * (engine/iso.ts depthKey) and a display object has one key, so a deck that is drawn over the
 * scenery behind it and under the scenery in front of it has to keep to its own row:
 *
 * - `body` (supports, deck, far parapets) lies above everything that stands on the tiles behind:
 *   trains there reach layer -35, props are held below `PROP_BEHIND`;
 * - what rides the deck comes next: its track piece, light pooled on it, then the trains;
 * - `near` (parapets on the near edges) lies below everything on the tiles in front, whose props
 *   start at layer 26.
 *
 * A vehicle is longer than the gap between two rows, so one key cannot put it above the deck of
 * the tile its front is over and below the parapet beside its tail. On straight track a vehicle
 * that rides a deck is therefore drawn in slices, one per tile it is over (`tileColumns`), each
 * with the key of its own tile (`ridingKey`). A vehicle that stands askew (on a curve carried by
 * platforms) keeps one key: that of the front-most deck under it.
 */
export const BRIDGE_DEPTH = {
  body: -34.9,
  track: -34.8,
  light: -34.7,
  rider: -33.6,
  near: 25,
} as const;
/** Props on the tile behind a bridge deck sort below its body: this far under the deck's row. */
const PROP_BEHIND = -36;
/** Props on the tile in front of a bridge deck sort above whatever rides it: the next row less this. */
const PROP_FRONT = -32;
/** How far a rider's key may rise within its layer: vehicles on one tile keep their order. */
const RIDER_SPREAD = 0.5;

/**
 * Depth key of a prop at offset (ox, oy) in tile (x, y). Beside a bridge deck it sorts wholly
 * behind or wholly in front of the deck, wherever in its tile it stands: `bridgeAhead` when the
 * tile to its south or east holds a deck (the prop stands behind it), `bridgeBehind` when the tile
 * to its north or west does.
 */
export function propDepthKey(
  x: number,
  y: number,
  ox: number,
  oy: number,
  bridgeAhead: boolean,
  bridgeBehind: boolean,
) {
  let key = depthKey(x + ox, y + oy, 10);
  const row = depthKey(x, y);
  if (bridgeBehind) key = Math.max(key, row + PROP_FRONT);
  if (bridgeAhead) key = Math.min(key, row + 100 + PROP_BEHIND);
  return key;
}

/**
 * Depth key of a train sprite (or of one slice of it) over the bridge deck on a tile: `tile` is
 * that tile's depth key, `own` the key the sprite's position alone would give it (which keeps
 * the vehicles of a train in order where they share a tile), `layer` its layer among the sprites
 * of one vehicle (15 the body, 16 its load).
 */
export function ridingKey(tile: number, own: number, layer = 15) {
  const spread = Math.max(0, Math.min(RIDER_SPREAD, RIDER_SPREAD / 2 + (own - tile) / 800));
  return tile + BRIDGE_DEPTH.rider + spread + (layer - 15) * 0.1;
}

/**
 * Depth key of the slice of a train sprite over a tile without a deck (a vehicle half on a
 * bridge, half on the bank): its own key, held within that tile's row.
 */
export function groundSliceKey(tile: number, own: number, layer = 15) {
  return Math.max(tile - 34.5, Math.min(tile + 64.5, own)) + (layer - 15);
}

/** One screen column of a train sprite and the tile whose depth row it sorts in. */
export interface TileColumn {
  x: number;
  y: number;
  /** World pixel x where the column starts and ends. */
  from: number;
  to: number;
}

/**
 * The tiles under a train sprite on straight track, as columns of the screen. The sprite stands
 * square to tile axis `axis` in row (axis x) or column (axis y) `line` and covers world pixels
 * `left` to `right`. Columns are cut at the near ends of the tile joints, which gives each
 * column these properties (bridgeDepth.test.ts):
 *
 * - everything of the deck of a tile lies in that tile's column or in the next one along the
 *   track, toward the camera: a slice is never under the deck it is drawn over;
 * - the near edge of a tile, and the parapet on it, lies in that tile's column alone: a slice
 *   only ever meets the parapet of its own tile, which sorts above it.
 */
export function tileColumns(
  axis: 'x' | 'y',
  line: number,
  left: number,
  right: number,
): TileColumn[] {
  const out: TileColumn[] = [];
  for (let q = Math.floor(left / HALF_W); q * HALF_W < right; q++) {
    const from = Math.max(left, q * HALF_W),
      to = Math.min(right, (q + 1) * HALF_W);
    if (to - from < 1e-6) continue;
    out.push(
      axis === 'x' ? { x: q + line + 1, y: line, from, to } : { x: line, y: line - q, from, to },
    );
  }
  return out;
}
