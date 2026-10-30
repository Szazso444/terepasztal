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

/** Stars by rarity: the letters N and R would read as the lines' letters. */
export const RARITY_STARS: Record<string, number> = { N: 1, R: 2, SR: 3, SSR: 4, L: 5 };

/** The label of a rarity: its stars in the rarity's colour, the name in its tooltip. */
export function rarityLabel(rarity: string): HTMLElement {
  const stars = el('span', { text: '★'.repeat(RARITY_STARS[rarity] ?? 1) });
  const name = STR.craft.quality[rarity] ?? rarity;
  return ttLabel(stars, `rarity-label rarity-${rarity}`, name, () => [
    ttTitle(name),
    ttDim(STR.badge.rarity),
  ]);
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
