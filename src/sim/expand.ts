import type { SaveGame } from './save';
import type { MapGenParams } from '../world/mapgen';
import { worldWithinBound } from './ground';

/** Chunk edge length in tiles (must match `emptyMap`). */
export const CHUNK_TILES = 32;

type Frame = Pick<MapGenParams, 'w' | 'h' | 'originX' | 'originY'>;

/** The frame of a world after `ring` rings: a size larger by 2 rings and an origin shifted by one. */
export function grownFrame(p: Frame, ring: number) {
  const d = ring * CHUNK_TILES;
  return {
    w: p.w + 2 * d,
    h: p.h + 2 * d,
    originX: (p.originX ?? 0) - d,
    originY: (p.originY ?? 0) - d,
  };
}

/**
 * How many of `ring` rings a generated world on `frame` can still be given: the most, up to
 * `ring`, that keep the map within MAX_WORLD_CHUNKS chunks (`worldWithinBound`); 0 when not even
 * one does. Growth stops there, so the bound is the largest world the game reaches.
 */
export function ringsWithinBound(frame: Frame, ring = 1): number {
  let fits = 0;
  while (
    fits + 1 <= ring &&
    worldWithinBound({ kind: 'generated', params: grownFrame(frame, fits + 1) })
  )
    fits++;
  return fits;
}

/**
 * Grow a generated world by `ring` chunks on every side: the map parameters get a larger size and
 * a shifted origin, and every saved coordinate moves by the same amount so the start chunk stays
 * in the middle. A ring that would take the map past MAX_WORLD_CHUNKS chunks is not added
 * (`ringsWithinBound`): the world grows by the rings that fit, and when none does the save comes
 * back as it was. The ground the world stores is kept as it is: its chunks are keyed by world chunk
 * coordinate, which growth never moves, so the next load reads the old tiles from it and
 * generates only the new ring (`groundOf`), and with the generator unchanged that ring is what
 * generation in world space gives the grown parameters.
 */
export function expandSave(save: SaveGame, ring = 1): SaveGame {
  if (!save.world || save.world.kind !== 'generated') return save;
  ring = ringsWithinBound(save.world.params, ring);
  if (ring === 0) return save;
  const p: MapGenParams = { ...save.world.params };
  const d = ring * CHUNK_TILES;
  const oldRX = Math.ceil(p.w / CHUNK_TILES);
  const oldRY = Math.ceil(p.h / CHUNK_TILES);
  p.originX = (p.originX ?? 0) - d;
  p.originY = (p.originY ?? 0) - d;
  p.w += 2 * d;
  p.h += 2 * d;
  const newRX = Math.ceil(p.w / CHUNK_TILES);
  save.world = { ...save.world, params: p };
  save.track = save.track.map(([x, y, k, r, ...rest]) => [x + d, y + d, k, r, ...rest]);
  for (const s of save.stations) {
    s.x += d;
    s.y += d;
  }
  save.decor = (save.decor ?? []).map(([x, y, id, r]) => [x + d, y + d, id, r]);
  save.buildings = (save.buildings ?? []).map(([x, y, id, a, ...rest]) => [
    x + d,
    y + d,
    id,
    a,
    ...rest,
  ]);
  save.wires = (save.wires ?? []).map(([x, y, k]) => [x + d, y + d, k]);
  save.roads = (save.roads ?? []).map(([x, y]) => [x + d, y + d]);
  for (const h of save.houses?.list ?? []) {
    h.x += d;
    h.y += d;
  }
  for (const t of save.trains as {
    head?: { x: number; y: number } | null;
    trail?: number[][];
    retreat?: { path: { x: number; y: number }[] } | null;
    way?: { path: { x: number; y: number }[] } | null;
    serviceStop?: { x: number; y: number } | null;
    want?: number[][] | null;
  }[]) {
    if (t.head) {
      t.head.x += d;
      t.head.y += d;
    }
    if (t.trail)
      t.trail = t.trail.map(([x, y, sx, sy, ...rest]) => [x + d, y + d, sx + d, sy + d, ...rest]);
    // the escape a train backing off runs along, the way any other runs, and the service a train
    // heads to
    for (const s of [
      ...(t.retreat?.path ?? []),
      ...(t.way?.path ?? []),
      ...(t.serviceStop ? [t.serviceStop] : []),
    ]) {
      s.x += d;
      s.y += d;
    }
    // the way a waiting train would take
    if (t.want) t.want = t.want.map(([x, y]) => [x + d, y + d]);
  }
  if (save.regions) {
    const owned = new Array<boolean>(newRX * Math.ceil(p.h / CHUNK_TILES)).fill(false);
    save.regions.forEach((v, i) => {
      if (!v) return;
      const rx = (i % oldRX) + ring;
      const ry = Math.floor(i / oldRX) + ring;
      owned[ry * newRX + rx] = true;
    });
    save.regions = owned;
  }
  // camera: iso shift of (d, d) tiles is straight down
  save.camera = { ...save.camera, y: save.camera.y + d * 32 };
  void oldRY;
  return save;
}

/**
 * Does any owned chunk touch the grid's edge, so the next purchase needs more world, and can the
 * world grow another ring (`ringsWithinBound`)? At the bound the answer is no: a purchase of a
 * chunk at the edge still stands, and the map stays as it is. The grid is on the chunk grid, as
 * `regions` is indexed.
 */
export function ownsBorderChunk(regions: boolean[], w: number, h: number) {
  if (ringsWithinBound({ w, h }) === 0) return false;
  const rx = Math.ceil(w / CHUNK_TILES);
  const ry = Math.ceil(h / CHUNK_TILES);
  return regions.some((v, i) => {
    if (!v) return false;
    const x = i % rx;
    const y = Math.floor(i / rx);
    return x === 0 || y === 0 || x === rx - 1 || y === ry - 1;
  });
}
