import type { LocoDef, WagonDef } from '../data/content';
import type { AtlasRegistry } from '../engine/atlas';
import { STR } from '../strings';
import { el } from './dom';
import { listRow } from './kit';
import { vehicleLabels } from './labels';
import { frameForItem, spriteImg } from './spritePreview';

type Content = Node | string | null | undefined;

export interface VehicleRowOptions {
  def: LocoDef | WagonDef;
  level: number;
  /** the stat lines under the name */
  sub: readonly Content[];
  /** red: why the model cannot roll out of the depot */
  reason?: string | null;
  /** red: a warning about the vehicle, such as dead weight */
  warn?: string | null;
  on?: boolean;
  onClick?: () => void;
  /** the row's actions at its far end */
  right?: readonly Content[];
}

/** The vehicle's sprite in the box a list row gives it. */
export function vehicleSprite(atlas: AtlasRegistry, defId: string, scale = 1): HTMLElement {
  return spriteImg(atlas, frameForItem(defId), scale, 'sprite-preview dp-img');
}

/** A vehicle's name in its rarity's colour, with its level as a tag. */
export function vehicleName(def: LocoDef | WagonDef, level: number): HTMLElement {
  return el(
    'span',
    {},
    el('span', { class: `dp-vn rarity-${def.rarity}`, text: def.name }),
    el('em', { class: 'dp-lv', text: STR.roster.lv(level) }),
  );
}

/**
 * One vehicle as a list row, in the Depot's stock and in the Train screen's consist: its sprite,
 * name, level, labels and the lines the caller gives it.
 */
export function vehicleRow(atlas: AtlasRegistry, o: VehicleRowOptions): HTMLElement {
  const lines: Content[] = [...o.sub];
  if (o.reason) lines.push(el('span', { class: 'k-bad', title: o.reason, text: o.reason }));
  if (o.warn) lines.push(el('span', { class: 'k-bad', text: o.warn }));
  return listRow({
    title: vehicleName(o.def, o.level),
    sprite: vehicleSprite(atlas, o.def.id),
    sub: lines,
    foot: [vehicleLabels(o.def)],
    on: o.on,
    onClick: o.onClick,
    right: o.right,
    cls: `dp-li${o.reason ? ' dp-barred' : ''}${o.onClick ? ' dp-pick' : ''}`,
  });
}
