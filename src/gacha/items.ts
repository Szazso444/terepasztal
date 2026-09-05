import locoData from '../data/locomotives.json';
import wagonData from '../data/wagons.json';
import gachaData from '../data/gacha.json';

export type Rarity = 'N' | 'R' | 'SR' | 'SSR';
export const RARITIES: Rarity[] = ['N', 'R', 'SR', 'SSR'];

export interface LocoDef {
  id: string;
  name: string;
  rarity: Rarity;
  era: string;
  body: 'steam' | 'diesel';
  paint: string;
  speed: number;
  power: number;
  maxWagons: number;
  costPerTile: number;
  starter?: boolean;
}
export interface WagonDef {
  id: string;
  name: string;
  rarity: Rarity;
  era: string;
  body: 'box' | 'hopper' | 'flat' | 'tank';
  paint: string;
  load: 'crates' | 'heap' | 'logs' | 'none';
  accepts: string[];
  capacity: number;
  weight: number;
  starter?: boolean;
}
export const LOCOS: LocoDef[] = locoData as LocoDef[];
export const WAGONS: WagonDef[] = wagonData as WagonDef[];
export const LEVEL_CAP: number = gachaData.levelCap;
export const STAT_PER_LEVEL: number = gachaData.statPerLevel;

export function locoDef(id: string): LocoDef {
  const d = LOCOS.find((l) => l.id === id);
  if (!d) throw new Error(`unknown loco ${id}`);
  return d;
}
export function wagonDef(id: string): WagonDef {
  const d = WAGONS.find((l) => l.id === id);
  if (!d) throw new Error(`unknown wagon ${id}`);
  return d;
}
export function itemKind(defId: string): 'loco' | 'wagon' {
  return LOCOS.some((l) => l.id === defId) ? 'loco' : 'wagon';
}
export function itemDef(defId: string): LocoDef | WagonDef {
  return itemKind(defId) === 'loco' ? locoDef(defId) : wagonDef(defId);
}
/** Stat multiplier for an item level (1 = base). */
export function levelMul(level: number) {
  return 1 + (level - 1) * STAT_PER_LEVEL;
}

export interface Item {
  uid: number;
  defId: string;
  kind: 'loco' | 'wagon';
  level: number;
  /** train id if in service */
  assigned: number | null;
  /** duplicate points collected towards the next level */
  dupes: number;
  obtainedAt: number;
}

export function dupesNeeded(level: number) {
  return level; // 1 dupe to reach 2, 2 more to reach 3, ...
}
