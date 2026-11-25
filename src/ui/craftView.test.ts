import { describe, expect, it } from 'vitest';
import {
  POOL_ORDER,
  RECIPE_FILTERS,
  filterRecipes,
  heldChoice,
  knownShare,
  pickFilter,
  poolByRarity,
  stockLine,
  unlockOff,
} from './craftView';

const recipes = [
  { id: 'rocket', name: "Stephenson's Rocket", group: 'steam' },
  { id: 'mav490', name: 'MÁV 490', group: 'steam' },
  { id: 'deltic', name: 'Deltic', group: 'diesel' },
  { id: 'tub', name: 'Mine Tub', group: 'mineral' },
  { id: 'coach', name: 'Narrow Coach', group: 'people' },
];

describe('the recipe list', () => {
  it('shows every recipe with no filter and no search, in the order it came', () => {
    expect(filterRecipes(recipes, 'all', '').map((r) => r.id)).toEqual(recipes.map((r) => r.id));
  });

  it('filters by a locomotive type or what a wagon carries', () => {
    expect(filterRecipes(recipes, 'steam', '').map((r) => r.id)).toEqual(['rocket', 'mav490']);
    expect(filterRecipes(recipes, 'mineral', '').map((r) => r.id)).toEqual(['tub']);
    expect(filterRecipes(recipes, 'electric', '')).toEqual([]);
  });

  it('searches the name, in part, whatever the case', () => {
    expect(filterRecipes(recipes, 'all', 'MINE').map((r) => r.id)).toEqual(['tub']);
    expect(filterRecipes(recipes, 'all', ' roc ').map((r) => r.id)).toEqual(['rocket']);
    expect(filterRecipes(recipes, 'all', 'zzz')).toEqual([]);
  });

  it('applies the filter and the search together', () => {
    expect(filterRecipes(recipes, 'steam', 'máv').map((r) => r.id)).toEqual(['mav490']);
    expect(filterRecipes(recipes, 'diesel', 'máv')).toEqual([]);
  });

  it('knows the filters it offers, and keeps the one it had for another', () => {
    expect(RECIPE_FILTERS).toContain('liquid');
    expect(pickFilter('bulk', 'all')).toBe('bulk');
    expect(pickFilter('nope', 'steam')).toBe('steam');
  });
});

describe('the pool of an age', () => {
  const rarity: Record<string, string> = { a: 'N', b: 'SSR', c: 'N', d: 'R', e: 'L' };

  it('is grouped by rarity, the rarest first, with the order of the ids kept inside', () => {
    expect(poolByRarity(['a', 'b', 'c', 'd', 'e'], (id) => rarity[id])).toEqual([
      { rarity: 'L', ids: ['e'] },
      { rarity: 'SSR', ids: ['b'] },
      { rarity: 'R', ids: ['d'] },
      { rarity: 'N', ids: ['a', 'c'] },
    ]);
  });

  it('leaves out a rarity with no model, and an empty pool is no groups', () => {
    expect(poolByRarity(['a'], () => 'N').map((g) => g.rarity)).toEqual(['N']);
    expect(poolByRarity([], () => 'N')).toEqual([]);
    expect(POOL_ORDER[0]).toBe('L');
  });

  it('counts the known share of the pool, and 0 for an empty one', () => {
    expect(knownShare(['a', 'b', 'c', 'd'], (id) => id === 'a' || id === 'c')).toEqual({
      known: 2,
      total: 4,
      share: 0.5,
    });
    expect(knownShare([], () => true)).toEqual({ known: 0, total: 0, share: 0 });
  });
});

describe('Unlock recipe', () => {
  it('is off for a waiting draw first, then for an empty pool, then for want of funds', () => {
    expect(unlockOff({ pending: true, poolSize: 0, canAfford: false })).toBe('pending');
    expect(unlockOff({ pending: false, poolSize: 0, canAfford: false })).toBe('noPool');
    expect(unlockOff({ pending: false, poolSize: 3, canAfford: false })).toBe('funds');
  });

  it('is on with a pool and the money', () => {
    expect(unlockOff({ pending: false, poolSize: 3, canAfford: true })).toBeNull();
  });
});

describe('a draw waiting for its card', () => {
  const chosen = { kind: 'loco' as const, tier: 0 };

  it('holds Kind and Age at what was bought, whatever was picked since', () => {
    expect(heldChoice({ kind: 'wagon', tier: 2 }, chosen)).toEqual({
      choice: { kind: 'wagon', tier: 2 },
      held: true,
    });
  });

  it('lets the player choose with no draw waiting', () => {
    expect(heldChoice(null, chosen)).toEqual({ choice: chosen, held: false });
  });
});

describe('the materials line', () => {
  it('names each resource with the whole units the store holds', () => {
    const have: Record<string, number> = { iron: 288.9, wood: 465, coal: 0.4 };
    expect(stockLine(['iron', 'wood', 'coal'], (k) => have[k])).toBe(
      '288 iron · 465 wood · 0 coal',
    );
    expect(stockLine([], () => 0)).toBe('');
  });
});
