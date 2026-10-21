import { levelAt } from './elevation';
import type { GameMap } from './tiles';

/**
 * What a piece needs of the ground under a tile (the renderer's `groundAllows`, in
 * `src/render/terrainRelief.ts`, takes the same two words):
 * - `straight`: a straight, crossing or class transition, which may climb;
 * - `level`: a curve, switch, station or building, which needs flat ground.
 */
export type GroundNeed = 'straight' | 'level';

type Grid = Pick<GameMap, 'w' | 'h'>;
type Terrained = Pick<GameMap, 'w' | 'h' | 'terrain'>;

/**
 * The slope rule of the shipped "terraces" relief, over tile levels, with no renderer: can this
 * ground carry a piece that needs `need`?
 *
 * - Off the map nothing fits, whatever is needed.
 * - `straight` always fits: a tile's level differs from each neighbour's by at most one
 *   (`tileLevels`), so a straight rail climbs at most one level across the tile.
 * - `level` fits where no bank reaches into the tile: all four sides (north, south, east, west;
 *   diagonals do not count) stand at the tile's own level. A side off the map counts as level 0,
 *   so a tile on the map border fits only at level 0, and a border tile cannot rise above 1.
 *
 * `levels` is `tileLevels(map)` (or the renderer's `relief.tiles`), indexed `y * map.w + x`. It is
 * only read here; rebuild it after the terrain changes (the editor paints it).
 * For a few tiles at a time, with no whole-map pass, use `groundAllowsOn`.
 *
 * What this means for the ground a map generates: ordinary ground and Rock are level 0 and take
 * `level` wherever the four sides are level 0 too. A Hill rises to level 2 and a Mountain to level
 * 4, one level per tile from the level 0 ground around them, so the rings below the top are banks
 * that take `straight` only, and `level` fits a hill's or mountain's plateau. A Mountain stands
 * behind two rings of Rock (every tile within two of it is Rock or Mountain), except in the start
 * chunk, where the start guarantee paints patches over stone (`mapgen.ts`, `startResources`).
 */
export function groundAllowsAt(
  map: Grid,
  levels: ArrayLike<number>,
  x: number,
  y: number,
  need: GroundNeed,
): boolean {
  const { w, h } = map;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (need === 'straight') return true;
  const here = levels[y * w + x];
  return sides(x, y).every(([nx, ny]) => {
    const there = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : levels[ny * w + nx];
    return there === here;
  });
}

/**
 * `groundAllowsAt` for one tile straight from the terrain, with no stored levels: the tile and its
 * four sides are read through `levelAt`, which looks at the terrain within four tiles of each. It
 * answers exactly as `groundAllowsAt(map, tileLevels(map), x, y, need)` does, and stays right as
 * the terrain changes, so it suits a placement check or a repair of a few tiles; a pass over the
 * whole map is cheaper through `tileLevels`.
 */
export function groundAllowsOn(map: Terrained, x: number, y: number, need: GroundNeed): boolean {
  const { w, h } = map;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (need === 'straight') return true;
  const here = levelAt(map, x, y);
  return sides(x, y).every(([nx, ny]) => levelAt(map, nx, ny) === here);
}

function sides(x: number, y: number) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ] as const;
}
