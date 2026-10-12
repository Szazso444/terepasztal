import { Terrain, inBounds, type GameMap } from '../world/tiles';
import { footprintOf } from '../world/track';
import { stationFootprint } from '../sim/stations';
import { buildingDef } from '../sim/buildings';
import type { SaveGame } from '../sim/save';

/**
 * The load repair: ground a load generates need not be what was built on, and whatever the player
 * built must still stand on ground that allows it (a regenerated stone field or lake under a
 * station would strand it). A pure function of the map and the saved objects, so a headless test
 * can call it; `Game` only applies what it answers (`applyTileRepairs`) and redraws the tiles. It
 * changes the map in memory and never the text a save stores for a chunk: the store keeps the
 * ground as generated.
 */

/** The saved objects the repair reads: what stands on the map. */
export type BuiltObjects = Pick<SaveGame, 'track' | 'stations'> &
  Partial<Pick<SaveGame, 'decor' | 'buildings'>>;

/** A tile to give `terrain` in place of the one the map holds. */
export interface TileRepair {
  x: number;
  y: number;
  terrain: Terrain;
}

/**
 * What an object needs of the ground under one tile:
 * - `land`: buildable ground, so not water, rock or mountain (stations, works, decor, track);
 * - `platform`: a bridge platform stands on water or carries a rail across a dip in the land
 *   (`checkBuilding` in `src/sim/build.ts`), so anything but rock and mountain;
 * - `water`: a track piece of the retired `bridge` kind, which `checkTrackTile` lays on water only.
 */
type Standing = 'land' | 'platform' | 'water';

/** The terrain a tile of terrain `t` keeps or is given for an object that needs `standing`. */
function groundFor(standing: Standing, t: Terrain): Terrain {
  switch (standing) {
    case 'land':
      return t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain
        ? Terrain.Grass
        : t;
    case 'platform':
      // grass stays grass and water stays water; a tile no platform may stand on becomes the
      // water one always may, so the platform is not stranded
      return t === Terrain.Rock || t === Terrain.Mountain ? Terrain.Water : t;
    case 'water':
      return Terrain.Water;
  }
}

/**
 * The tiles of `map` to give another terrain so everything in `built` stands on ground that
 * allows it, in the order the objects are met: track, stations, decor, works. Pure: the map is
 * read, never changed, and the answer lists only tiles whose terrain ends up different; applying
 * it and asking again answers nothing. Tiles off the map are skipped.
 */
export function repairBuiltTiles(map: GameMap, built: BuiltObjects): TileRepair[] {
  const platforms = new Set<number>();
  for (const [x, y, id] of built.buildings ?? [])
    if (buildingDef(id).bridge) platforms.add(y * map.w + x);
  // the terrain each repaired tile has after the objects met so far
  const after = new Map<number, Terrain>();
  const stand = (x: number, y: number, standing: Standing) => {
    if (!inBounds(map, x, y)) return;
    const i = y * map.w + x;
    const now = after.get(i) ?? (map.terrain[i] as Terrain);
    const to = groundFor(standing, now);
    if (to !== now) after.set(i, to);
  };
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'regular'))
      stand(
        f.x,
        f.y,
        kind === 'bridge' ? 'water' : platforms.has(f.y * map.w + f.x) ? 'platform' : 'land',
      );
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) stand(f.x, f.y, 'land');
  for (const [x, y] of built.decor ?? []) stand(x, y, 'land');
  for (const [x, y, id] of built.buildings ?? [])
    stand(x, y, buildingDef(id).bridge ? 'platform' : 'land');
  const out: TileRepair[] = [];
  for (const [i, terrain] of after)
    if (terrain !== map.terrain[i]) out.push({ x: i % map.w, y: Math.floor(i / map.w), terrain });
  return out;
}

/**
 * Give the tiles their repaired terrain, and take the props off them (a prop stood on the old
 * ground). Changes `map` only; the chunk text a save stores is not read from it again.
 */
export function applyTileRepairs(map: GameMap, repairs: readonly TileRepair[]): void {
  for (const r of repairs) {
    const i = r.y * map.w + r.x;
    map.terrain[i] = r.terrain;
    map.props.delete(i);
  }
}
