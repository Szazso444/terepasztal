import type { AtlasRegistry } from '../engine/atlas';
import type { LocoDef, WagonDef } from '../data/content';
import { cargoClass } from '../sim/cargo';

/** Locomotive frame with fallbacks so content-editor bodies or paints never leave a train invisible. */
export function locoFrame(atlas: AtlasRegistry, def: LocoDef, facing: number): string {
  const tries = [
    `rolling/loco_${def.body}_${def.paint}_f${facing}`,
    `rolling/loco_${def.body}_iron_f${facing}`,
    `rolling/loco_${def.type === 'electric' ? 'electric_box' : def.type === 'diesel' ? 'diesel_hood' : 'steam_std'}_${def.paint}_f${facing}`,
    `rolling/loco_steam_std_iron_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
export function wagonFrame(atlas: AtlasRegistry, def: WagonDef, facing: number): string {
  const tries = [
    `rolling/wagon_${def.body}_${def.paint}_f${facing}`,
    `rolling/wagon_${def.body}_iron_f${facing}`,
    `rolling/wagon_flat_wood_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
/** Which cargo overlay a wagon shows for a cargo (none for liquids). */
export function loadKind(
  def: WagonDef,
  cargo?: string | null,
): 'heap' | 'logs' | 'bales' | 'crates' | 'none' {
  const cls = cargo ? cargoClass(cargo) : def.carries;
  if (cls === 'liquid' || def.body === 'tank') return 'none';
  if (cls === 'mineral') return 'heap';
  if (cargo === 'wheat') return 'bales';
  if (cargo === 'wood') return 'logs';
  return def.body === 'box' ? 'crates' : 'logs';
}
