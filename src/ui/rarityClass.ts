/** The five rarities as the game shows them: Common, Uncommon, Rare, Epic, Legendary. */
const CLASS: Record<string, string> = {
  N: 'common',
  R: 'uncommon',
  SR: 'rare',
  SSR: 'epic',
  L: 'legendary',
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
};

/** The kit's rarity class of a model's (N, R, SR, SSR, L) or a contract's rarity. */
export function rarityClass(rarity: string): string {
  return CLASS[rarity] ?? 'common';
}
