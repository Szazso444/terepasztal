import { content, type Rarity, type LocoDef, type WagonDef } from '../data/content';

export type { Rarity, LocoDef, WagonDef };
export const RARITIES: Rarity[] = ['N', 'R', 'SR', 'SSR'];

export const LOCOS: LocoDef[] = content.locomotives;
export const WAGONS: WagonDef[] = content.wagons;
export const LEVEL_CAP: number = content.gacha.levelCap;
export const STAT_PER_LEVEL: number = content.gacha.statPerLevel;

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
