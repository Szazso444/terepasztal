import type { Door } from '../sim/doors';

type Tile = { x: number; y: number };

/**
 * The tiles the road tool marks (#409), DOM-free: the reach tile of each street door, where a
 * road to the door ends (`Door.reach`, the tile outside the footprint, not the door's own tile
 * inside it, which the tool refuses). Two doors may share a reach tile and it is marked once; a
 * reach tile off the map is left out. Order follows the doors.
 */
export function doorReachTiles(
  doors: readonly Door[],
  onMap: (x: number, y: number) => boolean,
): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (const d of doors) {
    const { x, y } = d.reach;
    const key = `${x},${y}`;
    if (seen.has(key) || !onMap(x, y)) continue;
    seen.add(key);
    out.push({ x, y });
  }
  return out;
}
