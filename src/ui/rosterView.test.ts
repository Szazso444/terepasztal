import { describe, expect, it } from 'vitest';
import { LEVEL_CAP, locoDef, wagonDef } from '../gacha/items';
import { STR } from '../strings';
import {
  SIZE_FILTERS,
  filtered,
  levelGainPercent,
  levelUpState,
  pickOf,
  revealFilters,
  rosterCard,
  rosterCardTip,
  rosterItems,
  type RosterEntry,
  type RosterFilters,
} from './rosterView';
import { blockText, type TipDoc } from './tooltipDoc';

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

  it('keeps the tiny stock apart: it is neither small nor listed under it', () => {
    expect(names({ size: 'tiny' })).toEqual(['Mine Tub']);
    expect(names({ size: 'small' })).not.toContain('Mine Tub');
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
    expect(pickOf(SIZE_FILTERS, 'huge', 'small')).toBe('small');
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

describe('a card of the Roster', () => {
  const copy = { defId: 'rocket', kind: 'loco', level: 1 } as const;
  const said = (doc: TipDoc) => doc.map(blockText).filter(Boolean);

  it('says what a copy does at its level', () => {
    const one = rosterCard(copy, null, 2);
    const five = rosterCard({ ...copy, level: 5 }, null, 2);
    expect(one.name).toBe(locoDef('rocket').name);
    expect(one.level).toBe(STR.roster.lv(1));
    expect(five.level).toBe(STR.roster.lv(5));
    expect(five.lines[0]).not.toBe(one.lines[0]);
  });

  it('says where a copy is', () => {
    expect(rosterCard(copy, null, 1).where).toBe(STR.roster.inDepot);
    const serving = rosterCard(copy, 'Coal run', 1);
    expect(serving.where).toBe(STR.roster.assignedTo('Coal run'));
    expect(serving.inService).toBe(true);
  });

  it('counts the copies, or says the level is the last', () => {
    expect(rosterCard(copy, null, 3).stock).toBe(STR.roster.copies(3));
    expect(rosterCard({ ...copy, level: LEVEL_CAP }, null, 3).stock).toBe(STR.roster.maxLevel);
  });

  it('says what a wagon carries and a refuelling cart adds', () => {
    const tub = rosterCard({ defId: 'mine_tub', kind: 'wagon', level: 1 }, null, 1);
    expect(tub.lines[0]).toContain(STR.roster.capacity);
    const cart = wagonDef('coal_cart');
    const lines = rosterCard({ defId: 'coal_cart', kind: 'wagon', level: 1 }, null, 1).lines;
    expect(lines).toContain(STR.roster.serviceLine(cart.service ?? '', cart.serviceCap ?? 0));
  });

  it('as a tooltip says all that the card does, and no more', () => {
    const c = rosterCard(copy, 'Coal run', 2);
    expect(said(rosterCardTip(c))).toEqual([
      `${c.name} ${c.level}`,
      c.era,
      ...c.lines,
      c.where,
      c.stock,
    ]);
  });

  it('as a tooltip carries the picture of the model', () => {
    const doc = rosterCardTip(rosterCard(copy, null, 1));
    expect(doc.find((b) => b.kind === 'vehicle')).toMatchObject({ defId: 'rocket' });
  });
});

describe('opening the Roster on a copy', () => {
  const entry: RosterEntry = {
    uid: 1,
    kind: 'wagon',
    rarity: 'R',
    size: 'tiny',
    name: 'Mine Tub',
    level: 1,
    assigned: 7,
    obtainedAt: 0,
  };
  const none: RosterFilters = {
    kind: 'all',
    rarity: 'all',
    size: 'all',
    freeOnly: false,
    sort: 'name',
  };

  it('leaves filters that show the copy as they are', () => {
    expect(revealFilters(none, entry)).toEqual(none);
    const fitting = { ...none, kind: 'wagon', rarity: 'R', size: 'tiny' };
    expect(revealFilters(fitting, entry)).toEqual(fitting);
  });

  it('lets go of what would hide it, and of nothing else', () => {
    const hiding = { kind: 'loco', rarity: 'SR', size: 'large', freeOnly: true, sort: 'level' };
    const shown = revealFilters(hiding, entry);
    expect(shown).toEqual({ ...none, sort: 'level' });
    expect(rosterItems([entry], shown)).toEqual([entry]);
  });

  it('keeps Unassigned only for a copy that is free', () => {
    const f = { ...none, freeOnly: true };
    expect(revealFilters(f, { ...entry, assigned: null }).freeOnly).toBe(true);
  });

  it('reads a model with no size as small', () => {
    const f = { ...none, size: 'small' };
    expect(revealFilters(f, { ...entry, size: undefined }).size).toBe('small');
  });
});
