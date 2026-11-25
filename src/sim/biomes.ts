import biomeJson from '../data/biomes.json';
import { translateRows } from '../data/content';
import { HU_NAMES } from '../data/names.hu';
import { Biome, type GameMap } from '../world/tiles';

export interface BiomeDef {
  id: string;
  name: string;
  desc: string;
  /** production multiplier per station def id, in the order panels list them */
  production: Record<string, number>;
  trackCostMul: number;
  waterUseMul: number;
  speedMul: number;
  /**
   * The level where snow starts to show: 4, taiga a level lower, desert a level higher. Every
   * entry carries one, so the landscape painter and the tile tooltip can read one number.
   */
  snowLevel: number;
}
/** Indexed by `Biome`: ids are appended and never renumbered. */
export const BIOME_DEFS: BiomeDef[] = biomeJson as unknown as BiomeDef[];
translateRows(BIOME_DEFS, HU_NAMES.biomes);
export function biomeDef(b: Biome): BiomeDef {
  return BIOME_DEFS[b] ?? BIOME_DEFS[0];
}
export function biomeAt(map: GameMap, x: number, y: number): Biome {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return Biome.Plains;
  return map.biome[y * map.w + x] as Biome;
}
/** "Swamp: pumps ×1.4, farms ×0.8, track ×2" for panels and tooltips. */
export function biomeSummary(b: Biome): string {
  const d = biomeDef(b);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d.production)) if (v !== 1) parts.push(`${k} ×${v}`);
  if (d.trackCostMul !== 1) parts.push(`track ×${d.trackCostMul}`);
  if (d.waterUseMul !== 1) parts.push(`water use ×${d.waterUseMul}`);
  if (d.speedMul !== 1) parts.push(`speed ×${d.speedMul}`);
  return parts.length ? `${d.name}: ${parts.join(', ')}` : d.name;
}
