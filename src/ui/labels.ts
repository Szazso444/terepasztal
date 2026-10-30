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

/** How many stars a rarity has, of a model or of a contract. */
export const RARITY_STARS: Record<string, number> = {
  N: 1,
  R: 2,
  SR: 3,
  SSR: 4,
  L: 5,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};
/** A rarity's stars as text. */
export const starsOf = (rarity: string) => '★'.repeat(RARITY_STARS[rarity] ?? 1);

/** A rarity's mark: its stars close together, in its colour (`colour` is the colour's class). */
export function rarityStars(rarity: string, colour: string): HTMLElement {
  return el('span', { class: `rarity-star ${colour}`, text: starsOf(rarity) });
}

function starLabel(rarity: string, colour: string, name: string, text: string): HTMLElement {
  return ttLabel(rarityStars(rarity, colour), 'rarity-label', name, () => [
    ttTitle(el('span', { class: colour, text: name })),
    ttDim(text),
  ]);
}

/** The label of a model's rarity: its stars, the name in its tooltip. */
export function rarityLabel(rarity: string): HTMLElement {
  const name = STR.craft.quality[rarity] ?? rarity;
  return starLabel(rarity, `rarity-${rarity}`, name, STR.badge.rarity);
}

/** The label of a contract's rarity: the same stars, in the same colours. */
export function contractRarityLabel(rarity: string): HTMLElement {
  const name = STR.contracts.rarity[rarity] ?? rarity;
  return starLabel(rarity, `crarity-${rarity}`, name, STR.badge.contractRarity);
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
