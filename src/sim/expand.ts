import type { SaveGame } from './save';
import type { MapGenParams } from '../world/mapgen';

/** Chunk edge length in tiles (must match `emptyMap`). */
export const CHUNK_TILES = 32;

/**
 * Grow a generated world by `ring` chunks on every side: the map parameters get a larger size and
 * a shifted origin, and every saved coordinate moves by the same amount so the start chunk stays
 * in the middle. Terrain is regenerated in world space, so the old tiles come back unchanged.
 */
export function expandSave(save: SaveGame, ring = 1): SaveGame {
  if (!save.world || save.world.kind !== 'generated') return save;
  const p: MapGenParams = { ...save.world.params };
  const d = ring * CHUNK_TILES;
  const oldRX = Math.ceil(p.w / CHUNK_TILES);
  const oldRY = Math.ceil(p.h / CHUNK_TILES);
  p.originX = (p.originX ?? 0) - d;
  p.originY = (p.originY ?? 0) - d;
  p.w += 2 * d;
  p.h += 2 * d;
  const newRX = Math.ceil(p.w / CHUNK_TILES);
  save.world = { kind: 'generated', seed: save.world.seed, params: p };
  save.track = save.track.map(([x, y, k, r]) => [x + d, y + d, k, r]);
  for (const s of save.stations) {
    s.x += d;
    s.y += d;
  }
  save.decor = (save.decor ?? []).map(([x, y, id, r]) => [x + d, y + d, id, r]);
  save.buildings = (save.buildings ?? []).map(([x, y, id, a]) => [x + d, y + d, id, a]);
  for (const t of save.trains as {
    head?: { x: number; y: number } | null;
    trail?: number[][];
  }[]) {
    if (t.head) {
      t.head.x += d;
      t.head.y += d;
    }
    if (t.trail)
      t.trail = t.trail.map(([x, y, sx, sy, ...rest]) => [x + d, y + d, sx + d, sy + d, ...rest]);
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

/** Does any owned chunk touch the grid's edge (so the next purchase would need more world)? */
export function ownsBorderChunk(regions: boolean[], w: number, h: number) {
  const rx = Math.ceil(w / CHUNK_TILES);
  const ry = Math.ceil(h / CHUNK_TILES);
  return regions.some((v, i) => {
    if (!v) return false;
    const x = i % rx;
    const y = Math.floor(i / rx);
    return x === 0 || y === 0 || x === rx - 1 || y === ry - 1;
  });
}
