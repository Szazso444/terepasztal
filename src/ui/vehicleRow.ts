import type { LocoDef, WagonDef } from '../data/content';
import type { AtlasRegistry } from '../engine/atlas';
import type { Item } from '../gacha/items';
import type { Fleet } from '../sim/fleet';
import { STR } from '../strings';
import { el } from './dom';
import { vehicleArt } from './economyParts';
import { listRow } from './kit';
import { vehicleLabels } from './labels';
import { rosterCard, rosterCardTip, type RosterCard } from './rosterView';
import { ttLabel } from './tooltip';
import type { TipDoc } from './tooltipDoc';
import { tipBuild } from './tooltipRender';

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
  /** the card the picture and the name open, resting on them */
  card?: CardTip | null;
  /** the labels stand on the name's line: a list of many rows, each as low as it can be */
  inline?: boolean;
}

/** A Roster card as a tooltip: `key` says which card it is, as the row is drawn again under it. */
export interface CardTip {
  key: string;
  doc: () => TipDoc;
}

/** The card of a copy the fleet's inventory holds. */
export function copyCard(fleet: Pick<Fleet, 'inventory' | 'byId'>, it: Item): RosterCard {
  const train = it.assigned !== null ? fleet.byId(it.assigned) : null;
  return rosterCard(it, train?.name ?? null, fleet.inventory.count(it.defId));
}

/** The tooltip of a copy's card, read when it opens; a copy gone by then has none. */
export function copyTip(fleet: Pick<Fleet, 'inventory' | 'byId'>, uid: number): CardTip {
  return {
    key: `card-${uid}`,
    doc: () => {
      const it = fleet.inventory.byUid(uid);
      return it ? rosterCardTip(copyCard(fleet, it)) : [];
    },
  };
}

/** What resting on `mark` opens the card of; without a card it stands as it is. */
export function withCard(atlas: AtlasRegistry, mark: Node, card?: CardTip | null): Node {
  return card ? ttLabel(mark, 'dp-card', card.key, tipBuild(atlas, card.doc)) : mark;
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
 * One vehicle as a list row, in the Depot's stock and in the Train screen's consist: its picture,
 * name, level, labels and the lines the caller gives it.
 */
export function vehicleRow(atlas: AtlasRegistry, o: VehicleRowOptions): HTMLElement {
  const lines: Content[] = [...o.sub];
  if (o.reason) lines.push(el('span', { class: 'k-bad', title: o.reason, text: o.reason }));
  if (o.warn) lines.push(el('span', { class: 'k-bad', text: o.warn }));
  const name = withCard(atlas, vehicleName(o.def, o.level), o.card);
  return listRow({
    title: o.inline ? el('span', { class: 'dp-vt' }, name, vehicleLabels(o.def)) : name,
    sprite: withCard(atlas, vehicleArt(atlas, o.def.id), o.card),
    sub: lines,
    foot: o.inline ? undefined : [vehicleLabels(o.def)],
    on: o.on,
    onClick: o.onClick,
    right: o.right,
    cls: `dp-li${o.reason ? ' dp-barred' : ''}${o.onClick ? ' dp-pick' : ''}`,
  });
}
