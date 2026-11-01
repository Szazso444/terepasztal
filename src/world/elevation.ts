import { Terrain, type GameMap } from './tiles';

/** The highest level a tile stands at. One level is a quarter of a tile side. */
export const MAX_LEVEL = 16;

/**
 * The level a Mountain tile targets where neither level plane sets one: the old top. Taller
 * mountains come from the generated level plane, so a map without it (a level, the editor's, a
 * game saved before it) keeps the heights it had.
 */
export const LEGACY_MOUNTAIN_LEVEL = 4;

/** What a ground level plane (GameMap.groundLevel, generatedLevel) holds where it sets no level. */
export const NO_LEVEL = 255;

/**
 * What levels are read from: the terrain, the water levels where the map has them, and the
 * ground level planes where it has them.
 */
export type Elevated = Pick<GameMap, 'w' | 'h' | 'terrain'> &
  Pick<Partial<GameMap>, 'waterSurface' | 'generatedLevel' | 'groundLevel'>;

/**
 * The most two neighbouring tiles of the map differ in level: 4 on a map with a generated level
 * plane, whose generator may make steep ground, 1 on any other.
 */
export function maxStep(map: Elevated): 1 | 4 {
  return map.generatedLevel ? 4 : 1;
}

/**
 * The level tile `i` (`y * w + x`) stands at before its neighbours lower it: the player's level
 * where GameMap.groundLevel sets one, else the generated one where GameMap.generatedLevel does,
 * else by terrain: a hill 2, a mountain LEGACY_MOUNTAIN_LEVEL, water the level of its surface
 * (GameMap.waterSurface, 0 where the map has none), and any other ground 0. tileLevels and
 * levelAt build every level from it; the renderer reads the same rule through them.
 */
export function levelTarget(map: Elevated, i: number): number {
  const ground = map.groundLevel?.[i];
  if (ground !== undefined && ground !== NO_LEVEL) return ground;
  const generated = map.generatedLevel?.[i];
  if (generated !== undefined && generated !== NO_LEVEL) return generated;
  const t = map.terrain[i];
  if (t === Terrain.Water) return map.waterSurface?.[i] ?? 0;
  return t === Terrain.Hill ? 2 : t === Terrain.Mountain ? LEGACY_MOUNTAIN_LEVEL : 0;
}

/**
 * Elevation level of every tile, derived from the terrain, the water levels and the ground level
 * planes (levelTarget): hills reach level 2, mountains LEGACY_MOUNTAIN_LEVEL, raised water its own level, and
 * neighbouring tiles differ by at most maxStep(map) levels, one without a generated level plane.
 * Sea level and ordinary ground are 0; tiles on the map border never rise above 1. Generated
 * water comes out at its own level here, away from the map border: generateMap gives each water
 * tile a level its four sides allow.
 */
export function tileLevels(map: Elevated): Uint8Array {
  const { w, h } = map,
    step = maxStep(map),
    levels = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) levels[k] = levelTarget(map, k);
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        let v = levels[k];
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = Math.min(v, 1);
        if (x) v = Math.min(v, levels[k - 1] + step);
        if (y) v = Math.min(v, levels[k - w] + step);
        if (x < w - 1) v = Math.min(v, levels[k + 1] + step);
        if (y < h - 1) v = Math.min(v, levels[k + w] + step);
        if (v !== levels[k]) {
          levels[k] = v;
          changed = true;
        }
      }
  }
  return levels;
}

/**
 * The same level for one tile, from its neighbourhood only. A tile a plane sets a level for reads
 * it, capped by the border and its four sides: a plane holds levels tileLevels has already
 * settled, so no tile further out can lower it. Any other tile is its levelTarget, capped by every
 * tile within `level` steps (its target plus maxStep a step) and by the border.
 */
export function levelAt(map: Elevated, x: number, y: number): number {
  const { w, h } = map,
    step = maxStep(map);
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const i = y * w + x;
  let level = levelTarget(map, i);
  level = Math.min(level, 1 + step * Math.min(x, y, w - 1 - x, h - 1 - y));
  const g = map.groundLevel?.[i],
    s = map.generatedLevel?.[i];
  if ((g !== undefined && g !== NO_LEVEL) || (s !== undefined && s !== NO_LEVEL)) {
    if (x) level = Math.min(level, levelTarget(map, i - 1) + step);
    if (y) level = Math.min(level, levelTarget(map, i - w) + step);
    if (x < w - 1) level = Math.min(level, levelTarget(map, i + 1) + step);
    if (y < h - 1) level = Math.min(level, levelTarget(map, i + w) + step);
    return level;
  }
  // a neighbour d tiles away lowers the tile only to its target plus step * d, so none further
  // out than the tile's own level can matter
  const reach = Math.ceil(level / step) - 1;
  for (let dy = -reach; dy <= reach && level > 0; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (!d || step * d >= level) continue;
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      level = Math.min(level, levelTarget(map, yy * w + xx) + step * d);
    }
  return level;
}
