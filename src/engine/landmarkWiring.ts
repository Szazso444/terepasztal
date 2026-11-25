import { content } from '../data/content';
import { placeLandmarks } from '../world/landmarks';
import type { GameMap } from '../world/tiles';
import type { LandmarkRegistry } from '../sim/landmarks';

/**
 * Where the world's rare landmarks reach the game: the chunks a build generated now get their
 * rolled landmarks, handed to the registry. Pulled out of `Game` so a headless test asks it.
 *
 * Only chunks generated now are rolled (`added`): a chunk the save stored already has its
 * landmark in the registry, so a reload never doubles one. A level has no ground (`added` null). The first load after the v24 step
 * rolls nothing and clears its mark (`takeSkipRoll`), whatever chunks it generated. A placement
 * whose footprint a held landmark already covers is dropped as well. Returns how many were added.
 */
export function placeNewLandmarks(
  registry: LandmarkRegistry,
  seed: number,
  map: GameMap,
  added: readonly string[] | null,
  chance: number,
): number {
  if (registry.takeSkipRoll() || !added?.length) return 0;
  const sites = content.landmarks;
  const fits = placeLandmarks(seed, map, added, sites, { chance }).filter((p) => {
    const site = sites.find((s) => s.id === p.id);
    if (!site) return false;
    for (let dy = 0; dy < site.d; dy++)
      for (let dx = 0; dx < site.w; dx++) if (registry.occupies(p.x + dx, p.y + dy)) return false;
    return true;
  });
  registry.addPlacements(fits);
  return fits.length;
}
