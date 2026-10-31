import { describe, expect, it } from 'vitest';
import {
  SIZE_FILTERS,
  filtered,
  levelGainPercent,
  levelUpState,
  pickOf,
  rosterItems,
  type RosterEntry,
  type RosterFilters,
} from './rosterView';

let uid = 0;
const copy = (o: Partial<RosterEntry> & { name: string }): RosterEntry => ({
  uid: ++uid,
  kind: 'loco',
  rarity: 'N',
  level: 1,
  assigned: null,
  obtainedAt: 0,
  ...o,
});

const stock = [
  copy({ name: 'Rocket', rarity: 'N', obtainedAt: 5 }),
  copy({ name: 'Mallard', rarity: 'SSR', size: 'large', level: 3, assigned: 7, obtainedAt: 1 }),
  copy({ name: 'Bathtub', kind: 'wagon', rarity: 'R', size: 'medium', obtainedAt: 9 }),
  copy({ name: 'Mine Tub', kind: 'wagon', rarity: 'N', size: 'tiny', obtainedAt: 9 }),
  copy({ name: 'Battery Cart', kind: 'wagon', rarity: 'SR', size: 'small', level: 3 }),
];

const all: RosterFilters = {
  kind: 'all',
  rarity: 'all',
  size: 'all',
  freeOnly: false,
  sort: 'name',
};
const names = (f: Partial<RosterFilters>) =>
  rosterItems(stock, { ...all, ...f }).map((i) => i.name);

describe('the roster filters', () => {
  it('leaves every copy with no filter', () => {
    expect(names({})).toHaveLength(stock.length);
  });

  it('filters by kind and by rarity', () => {
    expect(names({ kind: 'wagon' })).toEqual(['Bathtub', 'Battery Cart', 'Mine Tub']);
    expect(names({ rarity: 'SSR' })).toEqual(['Mallard']);
    expect(names({ kind: 'wagon', rarity: 'N' })).toEqual(['Mine Tub']);
  });

  it('counts a model with no size as small', () => {
    expect(names({ size: 'small' })).toEqual(['Battery Cart', 'Rocket']);
    expect(names({ size: 'large' })).toEqual(['Mallard']);
    expect(names({ size: 'medium' })).toEqual(['Bathtub']);
  });

  it('keeps the unassigned copies only when asked', () => {
    expect(names({ freeOnly: true })).not.toContain('Mallard');
    expect(names({ freeOnly: true })).toHaveLength(stock.length - 1);
  });

  it('says a filter is on when any of them is', () => {
    expect(filtered(all)).toBe(false);
    expect(filtered({ ...all, kind: 'loco' })).toBe(true);
    expect(filtered({ ...all, freeOnly: true })).toBe(true);
    // the sort is not a filter
    expect(filtered({ ...all, sort: 'level' })).toBe(false);
  });

  it('leaves the roster as it was', () => {
    const before = stock.map((i) => i.name);
    rosterItems(stock, { ...all, sort: 'rarity' });
    expect(stock.map((i) => i.name)).toEqual(before);
  });
});

describe('the roster sorts', () => {
  it('puts the rarest first, the commoner ones by name', () => {
    expect(names({ sort: 'rarity' })).toEqual([
      'Mallard',
      'Battery Cart',
      'Bathtub',
      'Mine Tub',
      'Rocket',
    ]);
  });

  it('sorts by name', () => {
    expect(names({ sort: 'name' })).toEqual([
      'Bathtub',
      'Battery Cart',
      'Mallard',
      'Mine Tub',
      'Rocket',
    ]);
  });

  it('puts the highest level first, the rarer one before the other at a level', () => {
    expect(names({ sort: 'level' }).slice(0, 2)).toEqual(['Mallard', 'Battery Cart']);
  });

  it('puts the newest first, the later uid first when they came together', () => {
    const order = rosterItems(stock, { ...all, sort: 'newest' });
    expect(order.map((i) => i.name).slice(0, 2)).toEqual(['Mine Tub', 'Bathtub']);
  });
});

describe('picking an option', () => {
  it('takes one of the options, and keeps what it had for any other', () => {
    expect(pickOf(SIZE_FILTERS, 'large', 'all')).toBe('large');
    expect(pickOf(SIZE_FILTERS, 'tiny', 'small')).toBe('small');
  });
});

describe('levelling up', () => {
  it('is ready with a spare copy and a level to gain', () => {
    expect(levelUpState(1, 5, 1)).toBe('ready');
    expect(levelUpState(4, 5, 3)).toBe('ready');
  });

  it('is off for want of a spare copy, and gone at the top whatever the spares', () => {
    expect(levelUpState(2, 5, 0)).toBe('noSpare');
    expect(levelUpState(5, 5, 4)).toBe('max');
    expect(levelUpState(5, 5, 0)).toBe('max');
  });

  it('gains a whole percent per level', () => {
    expect(levelGainPercent(0.08)).toBe(8);
    expect(levelGainPercent(0.125)).toBe(13);
  });
});
