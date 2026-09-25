import type { AtlasRegistry } from '../engine/atlas';
import type { BogieStyle, LocoDef, WagonDef } from '../data/content';
import { cargoClass } from '../sim/cargo';
import type { BogieKind, PartKind } from '../sim/body';

/**
 * Locomotive part frame. A rendered sprite of the prototype itself (`loco_<id>_…`) wins; then the
 * body/size/paint the generators draw, with fallbacks so content-editor bodies or paints never
 * leave a train invisible.
 */
export function locoFrame(
  atlas: Pick<AtlasRegistry, 'has'>,
  def: LocoDef,
  facing: number,
  part: PartKind = 'body',
): string {
  const size = def.size ?? 'small';
  const fb =
    def.type === 'electric' ? 'electric_box' : def.type === 'diesel' ? 'diesel_hood' : 'steam_std';
  const tries = [
    `rolling/loco_${def.id}_${part}_f${facing}`,
    `rolling/loco_${def.body}_${size}_${def.paint}_${part}_f${facing}`,
    `rolling/loco_${def.body}_${size}_iron_${part}_f${facing}`,
    `rolling/loco_${fb}_${size}_${def.paint}_${part}_f${facing}`,
    `rolling/loco_${fb}_${size}_iron_${part}_f${facing}`,
    `rolling/loco_${fb}_small_iron_body_f${facing}`,
    `rolling/loco_steam_std_small_iron_body_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
/** Wagon frame: the wagon's own rendered sprite (`wagon_<id>_…`), then body/size/paint with fallbacks. */
export function wagonFrame(
  atlas: Pick<AtlasRegistry, 'has'>,
  def: WagonDef,
  facing: number,
): string {
  const size = def.size ?? 'small';
  const tries = [
    `rolling/wagon_${def.id}_f${facing}`,
    `rolling/wagon_${def.body}_${size}_${def.paint}_f${facing}`,
    `rolling/wagon_${def.body}_${size}_iron_f${facing}`,
    `rolling/wagon_${def.body}_small_iron_f${facing}`,
    `rolling/wagon_flat_small_wood_f${facing}`,
  ];
  return tries.find((t) => atlas.has(t)) ?? tries[tries.length - 1];
}
/** The style of the bogie at `index` under `part`, counted from the part's own front. */
export function bogieStyleOf(
  style: BogieStyle | undefined,
  part: PartKind,
  index: number,
): string | undefined {
  const s = typeof style === 'object' ? style[part] : style;
  // a list shorter than the bogies repeats its last entry
  return Array.isArray(s) ? s[Math.min(index, s.length - 1)] : s;
}
/** A styled bogie's own sprite when the atlas has it, else the generic truck of that kind. */
export function bogieFrame(
  atlas: Pick<AtlasRegistry, 'has'>,
  style: string | undefined,
  kind: BogieKind,
  facing: number,
): string {
  const own = style ? `rolling/bogie_${style}_f${facing}` : null;
  return own && atlas.has(own) ? own : `rolling/${kind}_f${facing}`;
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
