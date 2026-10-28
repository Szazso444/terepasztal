import { Terrain, inBounds, type GameMap } from '../world/tiles';
import { footprintOf } from '../world/track';
import { stationFootprint } from '../sim/stations';
import { buildingDef } from '../sim/buildings';
import { onRails } from '../sim/mountainTrack';
import type { SaveGame } from '../sim/save';

/**
 * The load repair: ground a load generates need not be what was built on, and whatever the player
 * built must still stand on ground that allows it (a regenerated stone field or lake under a
 * station would strand it). A pure function of the map and the saved objects, so a headless test
 * can call it; `Game` only applies what it answers (`applyTileRepairs`) and redraws the tiles. It
 * changes the map in memory and never the text a save stores for a chunk: the store keeps the
 * ground as generated. A road is the one thing the ground is not bent for: one on ground that
 * cannot hold it is taken off (`repairBuiltRoads`).
 */

/** The saved objects the repair reads: what stands on the map. */
export type BuiltObjects = Pick<SaveGame, 'track' | 'stations'> &
  Partial<Pick<SaveGame, 'decor' | 'buildings' | 'roads'>>;

/** A tile to give `terrain` in place of the one the map holds. */
export interface TileRepair {
  x: number;
  y: number;
  terrain: Terrain;
}

/**
 * What an object needs of the ground under one tile:
 * - `land`: buildable ground, so not water, rock or mountain (stations, works, decor off the
 *   track);
 * - `rails`: a track piece, and a signal on it: any land, rock and mountain included, since a line
 *   may run on across both (`src/sim/mountainTrack.ts`) and a mountain under it keeps its levels;
 *   water needs a platform. The rule a line is drawn by onto rock or a mountain, that it continue
 *   a line, is not the ground's, and a piece stays where it stands when the track around it goes;
 * - `platform`: a bridge platform stands on water or carries a rail across a dip in the land
 *   (`checkBuilding` in `src/sim/build.ts`), so anything but rock and mountain; a platform on land
 *   keeps its land, and one whose tile came back rock or mountain gets grass, not water;
 * - `water`: a track piece of the retired `bridge` kind, which `checkTrackTile` lays on water only.
 */
type Standing = 'land' | 'rails' | 'platform' | 'water';

/** The terrain a tile of terrain `t` keeps or is given for an object that needs `standing`. */
function groundFor(standing: Standing, t: Terrain): Terrain {
  switch (standing) {
    case 'land':
      return t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain
        ? Terrain.Grass
        : t;
    case 'rails':
      return t === Terrain.Water ? Terrain.Grass : t;
    case 'platform':
      // any other ground stays as it is; a tile no platform may stand on becomes grass, the land
      // a platform may stand on, never water: the repair makes no water where the player had none
      return t === Terrain.Rock || t === Terrain.Mountain ? Terrain.Grass : t;
    case 'water':
      return Terrain.Water;
  }
}

/** The keys (`y * w + x`) of the tiles a bridge platform stands on. */
function platformKeys(map: GameMap, built: BuiltObjects): Set<number> {
  // a platform off the map stands on no tile, even where its index `y * w + x` lands on one
  const platforms = new Set<number>();
  for (const [x, y, id] of built.buildings ?? [])
    if (buildingDef(id).bridge && inBounds(map, x, y)) platforms.add(y * map.w + x);
  return platforms;
}

/**
 * The terrain each tile `built` stands on has once the ground is repaired for it, keyed
 * `y * w + x`, in the order the objects are met: track, stations, decor, works. Only tiles an object
 * needed another ground for are listed, and one may come back to the terrain it has.
 */
function repairedGround(map: GameMap, built: BuiltObjects): Map<number, Terrain> {
  const platforms = platformKeys(map, built);
  // the terrain each repaired tile has after the objects met so far
  const after = new Map<number, Terrain>();
  const stand = (x: number, y: number, standing: Standing) => {
    if (!inBounds(map, x, y)) return;
    const i = y * map.w + x;
    const now = after.get(i) ?? (map.terrain[i] as Terrain);
    const to = groundFor(standing, now);
    if (to !== now) after.set(i, to);
  };
  // the tiles track stands on as rails, where a signal stands as its track does
  const rails = new Set<number>();
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'branch')) {
      const i = f.y * map.w + f.x;
      const standing: Standing =
        kind === 'bridge' ? 'water' : platforms.has(i) ? 'platform' : 'rails';
      if (standing === 'rails' && inBounds(map, f.x, f.y)) rails.add(i);
      stand(f.x, f.y, standing);
    }
  for (const s of built.stations)
    for (const f of stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)) stand(f.x, f.y, 'land');
  for (const [x, y, id] of built.decor ?? [])
    stand(x, y, onRails(id) && rails.has(y * map.w + x) ? 'rails' : 'land');
  for (const [x, y, id] of built.buildings ?? [])
    stand(x, y, buildingDef(id).bridge ? 'platform' : 'land');
  return after;
}

/**
 * The tiles of `map` to give another terrain so everything in `built` stands on ground that
 * allows it, in the order the objects are met: track, stations, decor, works. Pure: the map is
 * read, never changed, and the answer lists only tiles whose terrain ends up different; applying
 * it and asking again answers nothing. Tiles off the map are skipped. Roads are not here: the
 * ground is not bent for a road, which goes instead (`repairBuiltRoads`).
 */
export function repairBuiltTiles(map: GameMap, built: BuiltObjects): TileRepair[] {
  const out: TileRepair[] = [];
  for (const [i, terrain] of repairedGround(map, built))
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

/**
 * The saved roads (`built.roads`) to take off the map because the ground under them cannot hold
 * one: each tile once, in the order the save lists them. A road needs what `placeRoad` asks of the
 * ground (`checkRoad` in src/sim/build.ts): not water, rock or a mountain, the ground a station
 * stands on. The ground is judged as the repair leaves it (`repairBuiltTiles`), so a level
 * crossing whose tile came back water stays, the track having made it land, while one whose tile
 * came back rock or a mountain goes. A bridge platform carries a road where it carries no rail
 * (#493): a road on a platform with no track on its tile stays, whatever the ground, and one on a
 * platform with track goes, no level crossing standing on a bridge. Every other road is left, and
 * so is an entry `Roads.load` would skip (not a whole [x, y] on the map). A road taken off this
 * way is not refunded: the answer names tiles, and `Roads.remove` pays nothing, as
 * `Builder.removeRoad` does. Pure, and the same asked of the map before the repair is applied or
 * after it.
 */
export function repairBuiltRoads(map: GameMap, built: BuiltObjects): { x: number; y: number }[] {
  if (!Array.isArray(built.roads) || !built.roads.length) return [];
  const after = repairedGround(map, built);
  const decks = platformKeys(map, built);
  const railed = new Set<number>();
  for (const [x, y, kind, rot, cls] of built.track)
    for (const f of footprintOf(x, y, kind, rot, cls ?? 'branch'))
      if (inBounds(map, f.x, f.y)) railed.add(f.y * map.w + f.x);
  const out: { x: number; y: number }[] = [];
  const met = new Set<number>();
  for (const t of built.roads as unknown[]) {
    const [x, y] = Array.isArray(t) ? (t as unknown[]) : [];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(map, x, y)) continue;
    const i = y * map.w + x;
    const ground = after.get(i) ?? (map.terrain[i] as Terrain);
    const stays = decks.has(i) ? !railed.has(i) : groundFor('land', ground) === ground;
    if (met.has(i) || stays) continue;
    met.add(i);
    out.push({ x, y });
  }
  return out;
}
