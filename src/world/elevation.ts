import { Terrain, type GameMap } from './tiles';

/** The highest level: mountain summits. One level is a quarter of a tile side. */
export const MAX_LEVEL = 4;

type Elevated = Pick<GameMap, 'w' | 'h' | 'terrain'>;
const target = (t: number) => (t === Terrain.Hill ? 2 : t === Terrain.Mountain ? MAX_LEVEL : 0);

/**
 * Elevation level of every tile, derived from terrain alone (nothing is saved): hills reach
 * level 2, mountains level 4, and neighbouring tiles differ by at most one level. Sea level and
 * ordinary ground are 0; tiles on the map border never rise above 1.
 */
export function tileLevels(map: Elevated): Uint8Array {
  const { w, h } = map,
    levels = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) levels[k] = target(map.terrain[k]);
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        let v = levels[k];
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = Math.min(v, 1);
        if (x) v = Math.min(v, levels[k - 1] + 1);
        if (y) v = Math.min(v, levels[k - w] + 1);
        if (x < w - 1) v = Math.min(v, levels[k + 1] + 1);
        if (y < h - 1) v = Math.min(v, levels[k + w] + 1);
        if (v !== levels[k]) {
          levels[k] = v;
          changed = true;
        }
      }
  }
  return levels;
}

/**
 * The same level for one tile, from its neighbourhood only: a level is its terrain's target,
 * capped by every tile within MAX_LEVEL steps (its target plus the distance) and by the border.
 */
export function levelAt(map: Elevated, x: number, y: number): number {
  const { w, h } = map;
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  let level = target(map.terrain[y * w + x]);
  level = Math.min(level, 1 + Math.min(x, y, w - 1 - x, h - 1 - y));
  for (let dy = -MAX_LEVEL; dy <= MAX_LEVEL && level > 0; dy++)
    for (let dx = -MAX_LEVEL; dx <= MAX_LEVEL; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (!d || d >= level) continue;
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      level = Math.min(level, target(map.terrain[yy * w + xx]) + d);
    }
  return level;
}
