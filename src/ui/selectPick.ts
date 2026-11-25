import type { Building } from '../sim/buildings';
import type { Decor } from '../sim/build';
import type { LandmarkItem } from '../sim/landmarks';
import type { Station } from '../sim/stations';

/** What the Select tool can pick on a tile: at most one of the four. */
export interface TilePick {
  station: Station | null;
  building: Building | null;
  decor: Decor | null;
  landmark: LandmarkItem | null;
}

/** The parts of the builder the pick reads. */
export interface PickBuilder {
  stationAt(x: number, y: number): Station | undefined | null;
  buildingAt(x: number, y: number): Building | undefined | null;
  decorAt(x: number, y: number): Decor | undefined | null;
}

/**
 * What a click on the tile picks, in the order station, building, decor, then landmark. A landmark
 * is picked only once it is seen: a hidden one is nothing to the player, and its tiles still block.
 */
export function pickAt(
  builder: PickBuilder,
  landmarks: { at(x: number, y: number): LandmarkItem | undefined } | null,
  x: number,
  y: number,
): TilePick {
  const station = builder.stationAt(x, y) ?? null;
  const building = station ? null : (builder.buildingAt(x, y) ?? null);
  const decor = station || building ? null : (builder.decorAt(x, y) ?? null);
  const found = station || building || decor ? undefined : landmarks?.at(x, y);
  const landmark = found && found.stage !== 'hidden' ? found : null;
  return { station, building, decor, landmark };
}
