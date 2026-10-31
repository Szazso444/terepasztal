import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT, validateContent } from '../data/content';
import { Rng } from '../engine/rng';
import { Economy } from '../sim/economy';
import { forAll, shrinkArray } from '../testing/property';
import { looseStore } from '../testing/storeFixtures';
import {
  LOCOS,
  WAGONS,
  RARITIES,
  isRetired,
  itemDef,
  itemKind,
  locoDef,
  obtainable,
} from './items';
import type { Item } from './items';
import { Inventory } from './inventory';
import {
  CRAFT_TIERS,
  Crafting,
  craftPool,
  craftResources,
  craftTier,
  type CraftKind,
} from './crafting';

/**
 * A retired model stays in the tables so copies a player owns keep working, and nothing may hand
 * out a new one. These tests walk every way an item enters an inventory (the starter kit, the
 * workshop) and feed each one stale data that still names a retired model, the way an edited
 * content table or an old save would: the flag has to hold on its own.
 */
const RETIRED = [...LOCOS, ...WAGONS].filter((d) => d.retired).map((d) => d.id);
const KINDS: CraftKind[] = ['loco', 'wagon'];

function item(uid: number, defId: string): Item {
  return {
    uid,
    defId,
    kind: LOCOS.some((l) => l.id === defId) ? 'loco' : 'wagon',
    level: 1,
    assigned: null,
    dupes: 0,
    obtainedAt: 0,
  };
}
function workshop(seed: number) {
  const inventory = new Inventory();
  const economy = new Economy();
  economy.money = 1e12;
  const stock = looseStore(Object.fromEntries(craftResources().map((k) => [k, 1e9])));
  return {
    inventory,
    economy,
    stock,
    crafting: new Crafting(new Rng(seed), inventory, economy),
  };
}
/**
 * Runs `fn` with `ids` retired too, the way a later retirement would flag them, then puts every
 * flag back. The shipped retired models are both N, so the rarer cases need models retired for the
 * test.
 */
function retiring<T>(ids: string[], fn: () => T): T {
  const defs = ids.map((id) => itemDef(id));
  const before = defs.map((d) => ('retired' in d ? d.retired : null));
  try {
    for (const d of defs) d.retired = true;
    return fn();
  } finally {
    defs.forEach((d, i) => {
      if (before[i] === null) delete d.retired;
      else d.retired = before[i];
    });
  }
}
/** The first model of each rarity in a pool. */
const onePerRarity = (pool: string[]) =>
  RARITIES.flatMap((r) => pool.filter((id) => itemDef(id).rarity === r).slice(0, 1));

describe('retired models', () => {
  it('retires the Adler and the John Bull, and no other model, without deleting them', () => {
    expect([...RETIRED].sort()).toEqual(['adler', 'john_bull']);
    // the definitions stay: a save that references them must still resolve
    expect(locoDef('adler').name).toBe('Adler');
    expect(locoDef('john_bull').name).toBe('John Bull');
    expect(obtainable(['rocket', 'adler', 'john_bull'])).toEqual(['rocket']);
  });

  it('ships content that still validates', () => {
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]);
  });
});

describe('recipe pools and retired models', () => {
  /** Every recipe pool: each kind in each age. */
  const POOLS = KINDS.flatMap((kind) =>
    CRAFT_TIERS.map((tier) => ({ kind, tier, name: `${kind} age ${tier}` })),
  );

  it('lists no retired model in a shipped pool and still offers every rarity', () => {
    const offered = POOLS.flatMap((p) => craftPool(p.kind, p.tier));
    expect(offered.filter(isRetired)).toEqual([]);
    for (const r of RARITIES)
      expect(
        offered.some((id) => itemDef(id).rarity === r),
        r,
      ).toBe(true);
  });

  // slow because every pool, as shipped and with a later retirement, runs 12 draws for 8 seeds and
  // builds what they give
  it('never draws, lists or builds a retired model, even when a list still names one', () => {
    for (const { kind, tier, name } of POOLS) {
      const shipped = craftPool(kind, tier);
      // what a list from before the retirement looks like
      const stale = [...RETIRED, ...shipped];
      expect(obtainable(stale), name).toEqual(shipped);
      // and a later retirement of one model of each rarity
      for (const later of [[], onePerRarity(shipped)])
        retiring(later, () => {
          const pool = craftPool(kind, tier);
          expect(obtainable(stale).filter(isRetired), name).toEqual([]);
          expect(pool.filter(isRetired), name).toEqual([]);
          const seen = new Set<string>();
          for (let seed = 1; seed <= 8; seed++) {
            const w = workshop(seed * 7919);
            for (let n = 0; n < 12; n++) {
              const draw = w.crafting.draw(kind, tier);
              if (!draw) break;
              expect(draw.cards.length, name).toBeGreaterThan(0);
              for (const id of draw.cards) {
                expect(isRetired(id), id).toBe(false);
                seen.add(id);
              }
              expect(w.crafting.choose(draw.cards[0], w.stock)?.defId, name).toBe(draw.cards[0]);
              w.crafting.craft(draw.cards[0], w.stock, 0);
            }
            expect(w.inventory.ownedDefs().filter(isRetired), name).toEqual([]);
          }
          // the run was wide enough to reach every rarity a retired model sits in, wherever the
          // pool still has a model of that rarity to give
          for (const id of later) {
            const rarity = itemDef(id).rarity;
            if (pool.some((c) => itemDef(c).rarity === rarity))
              expect(
                [...seen].some((c) => itemDef(c).rarity === rarity),
                `${name}: ${id}`,
              ).toBe(true);
          }
        });
    }
  }, 30_000);

  it('falls back to the model it may hand out when the rest of a pool is retired', () => {
    for (const { kind, tier, name } of POOLS) {
      const [kept, ...rest] = craftPool(kind, tier);
      if (!kept) continue;
      retiring(rest, () => {
        for (const seed of [5, 6, 7]) {
          const w = workshop(seed);
          for (let n = 0; n < 6; n++) {
            expect(w.crafting.draw(kind, tier)?.cards, name).toEqual([kept]);
            expect(w.crafting.choose(kept, w.stock)?.defId, name).toBe(kept);
          }
          expect([...w.crafting.recipes], name).toEqual([kept]);
        }
      });
    }
  });

  it('hands out nothing from a pool that is retired through and through', () => {
    for (const { kind, tier, name } of POOLS)
      retiring(craftPool(kind, tier), () => {
        const w = workshop(1);
        const money = w.economy.money;
        expect(craftPool(kind, tier), name).toEqual([]);
        expect(w.crafting.canDraw(kind, tier), name).toBe(false);
        expect(w.crafting.draw(kind, tier), name).toBeNull();
        expect(w.economy.money, `${name}: nothing charged`).toBe(money);
        expect(w.crafting.pending, name).toBeNull();
        expect(w.inventory.items, name).toEqual([]);
      });
  });
});

describe('the starter kit and retired models', () => {
  it('starts a new game without a retired model, even with every model marked as a starter', () => {
    const defs = [...LOCOS, ...WAGONS];
    const flags = () => JSON.stringify(defs.map((d) => [d.id, d.starter]));
    const shipped = flags();
    const before = defs.map((d) => ('starter' in d ? d.starter : null));
    try {
      for (const d of defs) d.starter = true;
      // no shipped wagon is retired: one is retired here so the wagon half of the kit is tried too
      retiring([WAGONS[0].id], () => {
        const inventory = new Inventory();
        inventory.seedStarter(0);
        // every model but the retired ones: the flag alone keeps a model out of the kit
        expect(inventory.ownedDefs().sort()).toEqual(
          defs
            .filter((d) => !d.retired)
            .map((d) => d.id)
            .sort(),
        );
      });
    } finally {
      defs.forEach((d, i) => {
        if (before[i] === null) delete d.starter;
        else d.starter = before[i];
      });
    }
    expect(flags(), 'the starter flags put back').toBe(shipped);
    expect(WAGONS[0].retired).toBeUndefined();
  });

  it('does not count a retired model as the starter the content needs', () => {
    const locos = structuredClone(DEFAULT_CONTENT);
    for (const l of locos.locomotives) if (l.starter) l.retired = true;
    expect(validateContent(locos)).toEqual(['no starter locomotive']);
    const wagons = structuredClone(DEFAULT_CONTENT);
    for (const w of wagons.wagons) if (w.starter) w.retired = true;
    expect(validateContent(wagons)).toEqual(['no starter wagon']);
  });
});

describe('the workshop and retired models', () => {
  it('offers a recipe card for every model but the retired ones, in its age', () => {
    const offered = KINDS.flatMap((k) => CRAFT_TIERS.flatMap((t) => craftPool(k, t)));
    expect(offered.filter(isRetired)).toEqual([]);
    expect([...offered].sort()).toEqual(
      [...LOCOS, ...WAGONS]
        .filter((d) => !d.retired)
        .map((d) => d.id)
        .sort(),
    );
  });

  it('draws, keeps and builds through every age without producing a retired model', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = workshop(seed * 104729);
      const pick = new Rng(seed);
      for (const kind of KINDS)
        for (const tier of CRAFT_TIERS)
          for (let n = 0; n < 60; n++) {
            const draw = w.crafting.draw(kind, tier);
            if (!draw) break;
            expect(draw.cards.filter(isRetired)).toEqual([]);
            expect(w.crafting.choose(pick.pick(draw.cards), w.stock)).not.toBeNull();
          }
      expect(w.crafting.recipes.size).toBeGreaterThan(RARITIES.length);
      expect([...w.crafting.recipes].filter(isRetired)).toEqual([]);
      for (const id of w.crafting.known())
        for (let n = 0; n < 4; n++) expect(w.crafting.craft(id, w.stock, 0)).not.toBeNull();
      expect(w.inventory.items.length).toBeGreaterThan(0);
      expect(w.inventory.ownedDefs().filter(isRetired)).toEqual([]);
    }
  });

  it('refuses to build a retired model even with its recipe in hand, the stock untouched', () => {
    const w = workshop(3);
    const stock = () => JSON.stringify([...w.stock.amounts]);
    for (const id of RETIRED) {
      w.crafting.recipes.add(id);
      const had = stock();
      expect(w.crafting.canCraft(id, w.stock)).toBe(false);
      expect(w.crafting.craft(id, w.stock, 0)).toBeNull();
      expect(stock()).toBe(had);
    }
    expect(w.inventory.items).toEqual([]);
    expect(w.crafting.stats.crafts).toBe(0);
    // the same workshop still builds a model that is not retired
    w.crafting.recipes.add('rocket');
    expect(w.crafting.canCraft('rocket', w.stock)).toBe(true);
  });

  it('refuses to keep a retired card left over in a draw', () => {
    const w = workshop(4);
    w.crafting.pending = { kind: 'loco', tier: 0, cards: [RETIRED[0], 'rocket'] };
    expect(w.crafting.choose(RETIRED[0], w.stock)).toBeNull();
    expect(w.crafting.knows(RETIRED[0])).toBe(false);
    // the draw is still open for the card that is left
    expect(w.crafting.choose('rocket', w.stock)).toEqual({ defId: 'rocket', owned: false });
  });

  it('drops the recipes and drawn cards of retired models when a save loads', () => {
    const w = workshop(5);
    w.crafting.load({
      recipes: ['rocket', ...RETIRED],
      stats: { unlocks: 3, crafts: 2, failures: 0 },
      pending: { kind: 'loco', tier: 0, cards: [RETIRED[0], 'rocket', RETIRED[1]] },
      rng: 99,
    });
    expect([...w.crafting.recipes]).toEqual(['rocket']);
    expect(w.crafting.pending).toEqual({ kind: 'loco', tier: 0, cards: ['rocket'] });
    expect(w.crafting.stats).toEqual({ unlocks: 3, crafts: 2, failures: 0 });
  });

  it('derives no recipe from a retired model the player owns, and leaves the copy alone', () => {
    const w = workshop(6);
    w.inventory.load({
      items: [item(1, 'rocket'), ...RETIRED.map((id, i) => item(i + 2, id))],
      nextUid: RETIRED.length + 2,
    });
    w.crafting.load(undefined); // a save from before the workshop existed
    expect([...w.crafting.recipes]).toEqual(['rocket']);
    expect(w.inventory.ownedDefs()).toEqual(['rocket', ...RETIRED]);
  });
});

/** Every model the content defines, engines first, in table order. */
const ALL = [...LOCOS, ...WAGONS].map((d) => d.id);

/** Runs `fn` with every model marked as a starter, then puts every starter flag back. */
function everyStarter<T>(fn: () => T): T {
  const defs = [...LOCOS, ...WAGONS];
  const before = defs.map((d) => ('starter' in d ? d.starter : null));
  try {
    for (const d of defs) d.starter = true;
    return fn();
  } finally {
    defs.forEach((d, i) => {
      if (before[i] === null) delete d.starter;
      else d.starter = before[i];
    });
  }
}

/**
 * Every way a model is handed out, checked against the `retired` flag read straight off the
 * tables (not through `isRetired`): any list read through `obtainable`, the starter kit, the recipe
 * pools, draws, choices and builds, the recipes and drawn cards a save brings back, the recipes
 * derived from an inventory, and the content checks.
 */
function nothingRetiredHandedOut() {
  const off = new Set([...LOCOS, ...WAGONS].filter((d) => d.retired === true).map((d) => d.id));
  const on = (ids: readonly string[]) => ids.filter((id) => !off.has(id));
  const retiredOf = (ids: readonly string[]) => ids.filter((id) => off.has(id));

  // a list as a stale table has it: the shipped retired models and every model, in either order
  for (const list of [[...RETIRED], [...ALL], [...RETIRED, ...ALL], [...ALL].reverse()])
    expect(obtainable(list)).toEqual(on(list));

  // the starter kit, with every model marked as a starter
  const kit = everyStarter(() => {
    const inventory = new Inventory();
    inventory.seedStarter(0);
    return inventory.ownedDefs();
  });
  expect(kit, 'starter kit').toEqual(on(ALL));

  // recipe pools and draws, age by age
  const w = workshop(11);
  for (const kind of KINDS)
    for (const tier of CRAFT_TIERS) {
      const age = on(ALL.filter((id) => itemKind(id) === kind && craftTier(id) === tier));
      expect(craftPool(kind, tier), `${kind} age ${tier}`).toEqual(age);
      const draw = w.crafting.draw(kind, tier);
      expect(draw === null, `${kind} age ${tier} draw`).toBe(age.length === 0);
      if (!draw) continue;
      expect(retiredOf(draw.cards), `${kind} age ${tier} draw`).toEqual([]);
      expect(w.crafting.choose(draw.cards[0], w.stock)?.defId).toBe(draw.cards[0]);
    }

  // a recipe in hand and a card left in a draw: refused, the stock untouched, the draw kept open
  const stock = () => JSON.stringify([...w.stock.amounts]);
  for (const id of off) {
    w.crafting.recipes.add(id);
    const had = stock();
    expect(w.crafting.canCraft(id, w.stock), id).toBe(false);
    expect(w.crafting.craft(id, w.stock, 0), id).toBeNull();
    expect(stock(), id).toBe(had);
  }
  w.crafting.pending = { kind: 'loco', tier: 0, cards: [...ALL] };
  for (const id of off) expect(w.crafting.choose(id, w.stock), id).toBeNull();
  const kept = on(ALL)[0];
  if (kept) expect(w.crafting.choose(kept, w.stock)?.defId).toBe(kept);

  // a save's recipes and drawn cards; a draw left with no card it may keep is dropped, or the
  // workshop would wait for ever on a choice it refuses
  const loaded = workshop(12);
  loaded.crafting.load({ recipes: [...ALL], pending: { kind: 'loco', tier: 0, cards: [...ALL] } });
  expect([...loaded.crafting.recipes], 'loaded recipes').toEqual(on(ALL));
  expect(loaded.crafting.pending?.cards ?? [], 'loaded draw').toEqual(on(ALL));
  loaded.crafting.load({ recipes: [], pending: { kind: 'loco', tier: 0, cards: [...off] } });
  expect(loaded.crafting.pending, 'a draw of retired cards only').toBeNull();

  // recipes derived from an inventory that owns one of every model; the copies stay
  const owner = workshop(13);
  owner.inventory.load({ items: ALL.map((id, i) => item(i + 1, id)), nextUid: ALL.length + 1 });
  owner.crafting.load(undefined);
  expect([...owner.crafting.recipes], 'derived recipes').toEqual(on(ALL));
  expect(owner.inventory.ownedDefs()).toEqual(ALL);

  // content checks: the retired starters do not count
  const bundle = structuredClone(DEFAULT_CONTENT);
  for (const row of [...bundle.locomotives, ...bundle.wagons])
    if (off.has(row.id)) row.retired = true;
    else delete row.retired;
  const problems = validateContent(bundle);
  const startersLeft = (rows: { id: string; starter?: boolean }[]) =>
    rows.some((r) => r.starter && !off.has(r.id));
  expect(problems.includes('no starter locomotive')).toBe(!startersLeft(bundle.locomotives));
  expect(problems.includes('no starter wagon')).toBe(!startersLeft(bundle.wagons));
}

describe('any set of retired models', () => {
  // The shipped retirement is two N engines; a later one may flag any model. Each case retires a
  // seeded set on top of the shipped one, so a guard that kept its own list of names, or skipped
  // a kind or a rarity, fails here even while it passes for Adler and John Bull.
  const genRetirement = (rng: Rng) => {
    const share = rng.pick([0, 0.05, 0.2, 0.5, 1]);
    return ALL.filter(() => rng.chance(share));
  };

  // slow because every one of the 100 seeded sets is put through every path that hands a model
  // out, workshop and content check alike: a few seconds alone
  it('hands none of them out by any path, and every other model as before', () => {
    forAll(genRetirement, (extra) => retiring(extra, nothingRetiredHandedOut), {
      shrink: (extra) => shrinkArray(extra),
    });
    expect(ALL.filter(isRetired), 'the flags put back').toEqual(RETIRED);
  }, 60_000);
});
