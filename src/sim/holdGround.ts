import { MAX_LEVEL } from '../world/elevation';
import { footprintOf } from '../world/track';
import { buildingFootprint } from './buildings';
import { expandSave, ringsWithinBound } from './expand';
import type { SaveGame } from './save';
import { stationFootprint } from './stations';
import { Underground } from './underground';

/**
 * A map grows by a ring of chunks, and ground near its old edge stood lower than it was generated:
 * the border caps a level at one, and each tile in from it at four more (`levelAt`). The ring frees
 * that ground to rise. What stands on it must not: rail along an old edge would stand on steps of 2
 * or 3 (seed 42 on 96: (0,21) and (0,22) read 1, 1, then 2, 5). So a growth writes the level each
 * such tile has into the save's plane first, and the load's settle pass (`settleGroundLevel`) moves
 * the neighbours.
 */

/** How far in from the border the cap can reach: past this it stands over the top level. */
const EDGE_REACH = Math.ceil(MAX_LEVEL / 4);

type Built = Pick<SaveGame, 'track' | 'stations'> &
  Pick<Partial<SaveGame>, 'decor' | 'buildings' | 'roads' | 'underground'>;

/**
 * The tiles of a map of w by h that hold their level when it grows, by key: those within reach of
 * the border under rail, stations, buildings, decor or roads, the cuts, and what a portal looks
 * out at. A dug tile is not among them: rising takes nothing from the cover over it.
 */
export function builtNearEdge(save: Built, w: number, h: number): number[] {
  const near = new Set<number>();
  const hold = (x: number, y: number) => {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge >= 0 && edge < EDGE_REACH) near.add(y * w + x);
  };
  const holdAll = (tiles: readonly { x: number; y: number }[]) => {
    for (const t of tiles) hold(t.x, t.y);
  };
  for (const [x, y, kind, rot, cls] of save.track)
    holdAll(footprintOf(x, y, kind, rot, cls ?? 'branch'));
  for (const s of save.stations) holdAll(stationFootprint(s.defId, s.x, s.y, s.rot ?? 0));
  for (const [x, y, id, , , , rot] of save.buildings ?? [])
    holdAll(buildingFootprint(id, x, y, rot ?? 0));
  for (const [x, y] of save.decor ?? []) hold(x, y);
  for (const [x, y] of save.roads ?? []) hold(x, y);
  const under = Underground.fromJSON(save.underground, w, h);
  for (const [x, y] of under.toJSON().cuts) hold(x, y);
  holdAll(under.fronts());
  return [...near];
}

/**
 * Grow a generated world by one ring as `expandSave` does, the tiles of `builtNearEdge` held at the
 * level they stand at: `levels` gives tileLevels of the map as the save has it, and is called only
 * when there is such a tile, as it may have to build the map. A tile the plane sets already keeps
 * its entry. A world that cannot grow comes back as it was.
 */
export function growHolding(save: SaveGame, levels: () => Uint8Array): SaveGame {
  const world = save.world;
  if (world?.kind !== 'generated' || !ringsWithinBound(world.params)) return save;
  const { w, h } = world.params;
  const near = builtNearEdge(save, w, h);
  if (near.length) {
    const at = levels(),
      plane = save.groundLevel ?? [],
      set = new Set(plane.map(([x, y]) => y * w + x));
    for (const k of near) if (!set.has(k)) plane.push([k % w, Math.floor(k / w), at[k]]);
    save.groundLevel = plane;
  }
  return expandSave(save, 1);
}
