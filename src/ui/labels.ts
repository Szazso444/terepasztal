/**
 * The labels of a vehicle or a train, each its own mark with its own tooltip: the class's icon and
 * the lines it runs on (lineBadge.ts), the age it belongs to and its rarity.
 */
import type { LocoDef, TrainClass, WagonDef } from '../data/content';
import { craftTier } from '../gacha/crafting';
import { classOf } from '../sim/compat';
import { AGE_ORDER, STR } from '../strings';
import { ageIconSvg } from './ageIcon';
import { el } from './dom';
import { classBadge, trackBadges } from './lineBadge';
import { ttDim, ttLabel, ttTitle } from './tooltip';

/** The label of an age, by its index: its icon on a plate, the name in its tooltip. */
export function ageLabel(tier: number): HTMLElement {
  const id = AGE_ORDER[tier] ?? AGE_ORDER[0];
  const s = el('span', {});
  s.innerHTML = ageIconSvg(id, 16);
  const name = STR.ages.name[id];
  return ttLabel(s, 'age-label', name, () => [ttTitle(name), ttDim(STR.badge.age)]);
}

/** A rarity's mark: one star in its colour (grey common, green uncommon, blue rare, and so on). */
export function rarityStar(colour: string): HTMLElement {
  return el('span', { class: `rarity-star ${colour}`, text: '★' });
}

function starLabel(colour: string, name: string, text: string): HTMLElement {
  return ttLabel(rarityStar(colour), 'rarity-label', name, () => [
    ttTitle(el('span', { class: colour, text: name })),
    ttDim(text),
  ]);
}

/** The label of a model's rarity: its star, the name in its tooltip. */
export function rarityLabel(rarity: string): HTMLElement {
  return starLabel(`rarity-${rarity}`, STR.craft.quality[rarity] ?? rarity, STR.badge.rarity);
}

/** The label of a contract's rarity: the same star, in the same colours. */
export function contractRarityLabel(rarity: string): HTMLElement {
  return starLabel(
    `crarity-${rarity}`,
    STR.contracts.rarity[rarity] ?? rarity,
    STR.badge.contractRarity,
  );
}

/** The labels of a train: its class and the lines it runs on. */
export function trainLabels(tc: TrainClass | null): HTMLElement | null {
  return tc ? el('div', { class: 'label-row' }, classBadge(tc), trackBadges(tc)) : null;
}

/** The labels of a vehicle: class, lines, age and rarity. */
export function vehicleLabels(def: LocoDef | WagonDef): HTMLElement {
  const tc = classOf(def);
  return el(
    'div',
    { class: 'label-row' },
    classBadge(tc),
    trackBadges(tc),
    ageLabel(craftTier(def.id)),
    rarityLabel(def.rarity),
  );
}
