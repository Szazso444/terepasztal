import type { AtlasRegistry } from '../engine/atlas';
import type { LocoDef, WagonDef } from '../data/content';
import { cargoClass } from '../sim/cargo';
import type { PartKind } from '../sim/body';

/** Locomotive part frame with fallbacks so content-editor bodies or paints never leave a train invisible. */
export function locoFrame(
  atlas: AtlasRegistry,
  def: LocoDef,
  facing: number,
  part: PartKind = 'body',
): string {
  const size = def.size ?? 'small';
  const fb =
    def.type === 'electric' ? 'electric_box' : def.type === 'diesel' ? 'diesel_hood' : 'steam_std';
  const tries = [
    `rolling/loco_${def.body}_${size}_${def.paint}_${part}_f${facing}`,
    `rolling/loco_${def.body}_${size}_iron_${part}_f${facing}`,
    `rolling/loco_${fb}_${size}_${def.paint}_${part}_f${facing}`,
    `rolling/loco_${fb}_${size}_iron_${part}_f${facing}`,
    `rolling/loco_${fb}_small_iron_body_f${facing}`,
    `rolling/loco_steam_std_small_iron_body_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
export function wagonFrame(atlas: AtlasRegistry, def: WagonDef, facing: number): string {
  const size = def.size ?? 'small';
  const tries = [
    `rolling/wagon_${def.body}_${size}_${def.paint}_f${facing}`,
    `rolling/wagon_${def.body}_${size}_iron_f${facing}`,
    `rolling/wagon_${def.body}_small_iron_f${facing}`,
    `rolling/wagon_flat_small_wood_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
/** Which cargo overlay a wagon shows for a cargo (none for liquids). */
export function loadKind(
  def: WagonDef,
  cargo?: string | null,
): 'heap' | 'logs' | 'bales' | 'crates' | 'none' {
  const cls = cargo ? cargoClass(cargo) : def.carries;
  if (cls === 'liquid' || def.body === 'tank' || cls === 'people') return 'none';
  if (def.body === 'coach' || def.body === 'van' || def.service) return 'none';
  if (cls === 'mineral') return 'heap';
  if (cargo === 'wheat') return 'bales';
  if (cargo === 'wood') return 'logs';
  return def.body === 'box' ? 'crates' : 'logs';
}
