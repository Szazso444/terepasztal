/**
 * What the Crafting screen decides, apart from drawing it: which recipes a filter and a search
 * leave, how the pool of an age is grouped, when the unlock button is off and why, and what a
 * waiting draw holds the choices at. DOM-free, so it runs under Node.
 */

/** Recipe list filters, in strip order: everything, a locomotive type or what a wagon carries. */
export const RECIPE_FILTERS = [
  'all',
  'steam',
  'diesel',
  'electric',
  'bulk',
  'mineral',
  'liquid',
  'people',
] as const;
export type RecipeFilter = (typeof RECIPE_FILTERS)[number];

/** The filter that exists: a value that is none leaves the list as it was. */
export function pickFilter(id: string, current: string): string {
  return (RECIPE_FILTERS as readonly string[]).includes(id) ? id : current;
}

/** What a recipe is filtered and searched by: its name, and its type or what it carries. */
export interface RecipeKey {
  name: string;
  /** a locomotive's type, a wagon's cargo class */
  group: string;
}

/** The recipes a filter and a search leave, in the order they came; the search ignores case. */
export function filterRecipes<T extends RecipeKey>(
  recipes: readonly T[],
  filter: string,
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  return recipes.filter(
    (r) => r.name.toLowerCase().includes(q) && (filter === 'all' || r.group === filter),
  );
}

/** Rarities from the rarest down, as the pool lists them. */
export const POOL_ORDER = ['L', 'SSR', 'SR', 'R', 'N'] as const;

/** The models of a pool grouped by rarity, the rarest first; a rarity with none is left out. */
export function poolByRarity(
  ids: readonly string[],
  rarityOf: (id: string) => string,
): { rarity: string; ids: string[] }[] {
  return POOL_ORDER.map((rarity) => ({
    rarity,
    ids: ids.filter((id) => rarityOf(id) === rarity),
  })).filter((g) => g.ids.length > 0);
}

export type UnlockOff = 'pending' | 'noPool' | 'funds';

/** Why Unlock recipe is off, or null when it is on. A waiting draw is the first thing to settle. */
export function unlockOff(s: {
  pending: boolean;
  poolSize: number;
  canAfford: boolean;
}): UnlockOff | null {
  if (s.pending) return 'pending';
  if (s.poolSize === 0) return 'noPool';
  return s.canAfford ? null : 'funds';
}

export interface Choice {
  kind: 'loco' | 'wagon';
  tier: number;
}

/**
 * What Kind and Age stand at: a paid draw waiting for its card holds them at the draw's own, so
 * what the screen shows is what was bought.
 */
export function heldChoice(
  pending: Choice | null,
  chosen: Choice,
): { choice: Choice; held: boolean } {
  return pending
    ? { choice: { kind: pending.kind, tier: pending.tier }, held: true }
    : { choice: chosen, held: false };
}

/** How many recipes of the pool the player knows, and how many the pool has. */
export function knownShare(
  pool: readonly string[],
  knows: (id: string) => boolean,
): { known: number; total: number; share: number } {
  const known = pool.filter(knows).length;
  return { known, total: pool.length, share: pool.length ? known / pool.length : 0 };
}

/** The materials line of the foot: each resource and how much of it the store holds, whole. */
export function stockLine(keys: readonly string[], have: (k: string) => number): string {
  return keys.map((k) => `${Math.floor(have(k))} ${k}`).join(' · ');
}
