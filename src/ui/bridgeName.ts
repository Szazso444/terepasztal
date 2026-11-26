import type { Building } from '../sim/buildings';
import { STR } from '../strings';
import { levelAt, type Elevated } from '../world/elevation';
import { Terrain } from '../world/tiles';

/** A span is a Bridge over water at height 0, and a Viaduct on land or once raised. */
export function bridgeName(material: 'wood' | 'stone', overWater: boolean, height: number) {
  return STR.building.bridgeName(material, !overWater || height > 0);
}

/** Heights a platform's deck was raised above the ground or water under it; automatic is 0. */
export function deckRise(map: Elevated, b: Pick<Building, 'x' | 'y' | 'deck'>) {
  return b.deck === undefined ? 0 : Math.max(0, b.deck - levelAt(map, b.x, b.y));
}

/** The name of the span platform `b` belongs to, by where it stands. */
export function bridgeTitle(map: Elevated, b: Building, material: 'wood' | 'stone') {
  const water = map.terrain[b.y * map.w + b.x] === Terrain.Water;
  return bridgeName(material, water, deckRise(map, b));
}
