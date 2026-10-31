/**
 * What each age brings, worked out from the data so it cannot go stale: the lines of `LINES`, the
 * stations, works and contracts by their `tier`, the rolling stock by its age (`craftPool`) and the
 * building level the age opens. The era tooltip (ageTooltip.ts) and the Guide (guideContent.ts) read
 * it. DOM-free, so Node tests read it.
 */
import {
  content,
  type BuildingDef,
  type ContractTemplate,
  type DecorDef,
  type LocoDef,
  type StationDef,
  type WagonDef,
} from '../data/content';
import { craftPool } from '../gacha/crafting';
import { locoDef, wagonDef } from '../gacha/items';
import { AGE_DEFS } from '../sim/ages';
import { DECOR_DEFS } from '../sim/build';
import { BUILDING_DEFS } from '../sim/buildings';
import { SUPPLY_DEFS, SUPPLY_KINDS, type SupplyKind } from '../sim/catenary';
import { levelCap } from '../sim/levels';
import { rules } from '../sim/rules';
import { STATION_DEFS } from '../sim/stations';
import { inSupplyMode } from '../sim/supply';
import { BUILDABLE_CLASSES, lineAge, type TrackClass } from '../world/track';

/**
 * The picture of each age, a path under `public/`; null shows the age's icon. For now a vehicle
 * portrait of the age; the ages with no vehicle of their own have none. A painted picture of an age
 * takes its place here, and nothing else changes: both places show 16:9, the era tooltip at 96×54
 * and the Guide's Ages page at 320×180.
 */
export const AGE_PICTURE: Record<string, string | null> = {
  steam: 'assets/portraits/flying_scotsman.png',
  diesel: 'assets/portraits/f7.png',
  electric: 'assets/portraits/taurus.png',
  nuclear: null,
  magnetic: null,
  hyper: null,
};

/** The URL of an age's picture, null with none. */
export function agePictureUrl(id: string, base: string = import.meta.env.BASE_URL): string | null {
  const path = AGE_PICTURE[id];
  return path ? `${base}${path}` : null;
}

/** What opens with one age, in the running production chain and under the running rules. */
export interface AgeNews {
  id: string;
  /** track lines with pieces to build */
  lines: TrackClass[];
  /** bridges, which are listed with the track */
  bridges: BuildingDef[];
  stations: StationDef[];
  /** services and town buildings: they have no age of their own and belong to the first */
  decor: DecorDef[];
  works: BuildingDef[];
  supplies: SupplyKind[];
  locos: LocoDef[];
  wagons: WagonDef[];
  contracts: ContractTemplate[];
  /** the level a building of the first age may rise to in this age */
  level: number;
}

/** The age a line opens in as the game plays it: tuning can open every line from the start. */
export function lineOpens(c: TrackClass): number {
  return rules.lineAgeLocks ? lineAge(c) : 0;
}

/** The news of the age at `index` of `AGE_DEFS`. */
export function ageNews(index: number): AgeNews {
  const openLine = (c: TrackClass) => c !== 'narrow' || !!rules.narrowUnlocked;
  const openStation = (d: StationDef) => d.gauge !== 'narrow' || !!rules.narrowUnlocked;
  const works = BUILDING_DEFS.filter((b) => b.tier === index && inSupplyMode(b));
  return {
    id: AGE_DEFS[index]?.id ?? '',
    lines: BUILDABLE_CLASSES.filter((c) => lineOpens(c) === index && openLine(c)),
    bridges: works.filter((b) => b.bridge),
    stations: STATION_DEFS.filter((d) => d.tier === index && inSupplyMode(d) && openStation(d)),
    decor: index === 0 ? DECOR_DEFS : [],
    works: works.filter((b) => !b.bridge),
    supplies: SUPPLY_KINDS.filter((k) => SUPPLY_DEFS[k].tier === index),
    locos: craftPool('loco', index).map(locoDef),
    wagons: craftPool('wagon', index).map(wagonDef),
    contracts: content.contracts.templates.filter((t) => t.minTier === index),
    level: levelCap(0, index),
  };
}
