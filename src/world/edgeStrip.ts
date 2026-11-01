import { buildMap, type ChunkStore, type MapGenerator } from './chunks';
import { tileLevels } from './elevation';
import { DEFAULT_MAP_PARAMS, type MapGenParams } from './mapgen';
import { grownFrame, ringsWithinBound } from '../sim/expand';
import { storeOf } from '../sim/ground';
import type { WorldSpec } from '../sim/save';
import type { SupplyMode } from '../sim/supply';

/**
 * The edge strip: the ground of the tiles just past a generated map, for a picture of it. A world
 * grows by a ring of chunks, and the ring is fixed already by the seed and the stored chunks, so
 * the map's next ring can be built ahead of time. It is the build the next load of a grown save
 * runs (`buildMap`, on the frame `expandSave` gives), so the strip is that map's tiles, and only
 * read: nothing here is stored, and the map the game plays on does not change.
 */

/** How many tiles the strip reaches past each map edge. */
export const EDGE_STRIP_TILES = 12;

/** The frame round a map: its tiles and the strip's, each with its terrain and level. */
export interface EdgeStrip {
  /** the map's size; the frame runs from map tile (-EDGE_STRIP_TILES, -EDGE_STRIP_TILES) */
  w: number;
  h: number;
  /** a terrain id per tile of the frame, in rows */
  terrain: Uint8Array;
  /**
   * The level of each tile of the frame as the grown map reads it (`tileLevels`). Under a map
   * tile that is the level the tile rises to when the map grows, not the one its border holds it
   * to now.
   */
  levels: Uint8Array;
}

/** What a build of the strip needs, all of it plain data, so it can go to a worker. */
export interface EdgeStripRequest {
  seed: number;
  /** the map's size */
  w: number;
  h: number;
  /** the parameters of the map one ring bigger */
  grown: MapGenParams;
  chunks: ChunkStore;
  /** the production chain, as `generatorOf` reads it */
  chain: SupplyMode;
}

/** Whether map tile (`x`, `y`) of a map of `w` x `h` lies in the strip: past an edge, not too far. */
export function inEdgeStrip(x: number, y: number, w: number, h: number): boolean {
  const past = Math.max(-x, -y, x - (w - 1), y - (h - 1));
  return past >= 1 && past <= EDGE_STRIP_TILES;
}

/** The place in the frame's planes of map tile (`x`, `y`). */
export function frameIndex(strip: Pick<EdgeStrip, 'w'>, x: number, y: number): number {
  const stride = strip.w + 2 * EDGE_STRIP_TILES;
  return (y + EDGE_STRIP_TILES) * stride + x + EDGE_STRIP_TILES;
}

/** Map tile (`x`, `y`) as the frame holds it. */
export function edgeTile(strip: EdgeStrip, x: number, y: number) {
  const i = frameIndex(strip, x, y);
  return { terrain: strip.terrain[i], level: strip.levels[i] };
}

/**
 * The strip a world shows, or null when it has none: only a generated world has a next ring. A
 * level carries its own ground, with nothing behind it, and a world at its bound
 * (`ringsWithinBound`) stops growing.
 */
export function edgeStripRequest(world: WorldSpec, supply?: SupplyMode): EdgeStripRequest | null {
  if (world.kind !== 'generated') return null;
  if (ringsWithinBound(world.params) === 0) return null;
  const { w, h } = { ...DEFAULT_MAP_PARAMS, ...world.params };
  return {
    seed: world.seed,
    w,
    h,
    grown: { ...DEFAULT_MAP_PARAMS, ...world.params, ...grownFrame(world.params, 1) },
    chunks: storeOf(world.chunks),
    chain: supply === 'full' ? 'full' : 'simple',
  };
}

/**
 * Builds the strip: the grown map, as a load of the grown save builds it, cut to the frame round
 * the map. The levels are the whole grown map's (`tileLevels`), read as the renderer reads them,
 * so the tiles of the strip, well inside the grown map, are at their true height.
 */
export function edgeStripOf(req: EdgeStripRequest, generate: MapGenerator): EdgeStrip {
  const { w, h } = req;
  const grown = buildMap(req.seed, req.grown, req.chunks, generate).map;
  const levels = tileLevels(grown);
  const margin = (grown.w - w) / 2;
  const stride = w + 2 * EDGE_STRIP_TILES;
  const rows = h + 2 * EDGE_STRIP_TILES;
  const strip: EdgeStrip = {
    w,
    h,
    terrain: new Uint8Array(stride * rows),
    levels: new Uint8Array(stride * rows),
  };
  for (let y = 0; y < rows; y++) {
    const from = (y + margin - EDGE_STRIP_TILES) * grown.w + margin - EDGE_STRIP_TILES;
    strip.terrain.set(grown.terrain.subarray(from, from + stride), y * stride);
    strip.levels.set(levels.subarray(from, from + stride), y * stride);
  }
  return strip;
}
