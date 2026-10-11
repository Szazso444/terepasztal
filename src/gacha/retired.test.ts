import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONTENT, validateContent, type Banner } from '../data/content';
import { Rng } from '../engine/rng';
import { Economy } from '../sim/economy';
import { Stockpile } from '../sim/stockpile';
import { LOCOS, WAGONS, RARITIES, isRetired, itemDef, locoDef, obtainable } from './items';
import type { Item } from './items';
import { Inventory } from './inventory';
import { BANNERS, Gacha, bannerPool, validateBanners } from './gacha';
import { CRAFT_TIERS, Crafting, craftPool, craftResources, type CraftKind } from './crafting';

/**
 * A retired model stays in the tables so copies a player owns keep working, and nothing may hand
 * out a new one. These tests walk every way an item enters an inventory (banner pulls, the
 * starter kit, the workshop) and feed each one stale data that still names a retired model, the
 * way an edited content table or an old save would: the flag has to hold on its own.
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
  const stock = new Stockpile();
  for (const k of craftResources()) stock.add(k, 1e9);
  return {
    inventory,
    economy,
    stock,
    crafting: new Crafting(new Rng(seed), inventory, economy, stock),
  };
}
/**
 * Runs `fn` with `ids` retired too, the way a later retirement would flag them, then puts every
 * flag back. The shipped retired models are both N, and the featured rotation only ever picks SR
 * and SSR models, so the rarer cases need models retired for the test.
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

describe('banners and retired models', () => {
  it('lists no retired model in a shipped pool and still offers every rarity', () => {
    for (const b of BANNERS) {
      expect(b.pool.filter(isRetired), b.id).toEqual([]);
      expect(bannerPool(b).filter(isRetired), b.id).toEqual([]);
    }
    expect(validateBanners()).toEqual([]);
  });

  it('never pulls, features or lists a retired model, even when the pool still names one', () => {
    for (const shipped of BANNERS) {
      // what a stored content override from before the retirement looks like
      const stale: Banner = { ...shipped, pool: [...RETIRED, ...shipped.pool] };
      expect(bannerPool(stale)).toEqual(shipped.pool);
      // and a later retirement of one model of each rarity, the featured SR and SSR included
      for (const later of [[], onePerRarity(shipped.pool)])
        retiring(later, () => {
          for (const banner of [shipped, stale]) {
            expect(bannerPool(banner).filter(isRetired)).toEqual([]);
            const seen = new Set<string>();
            for (let seed = 1; seed <= 8; seed++) {
              const inventory = new Inventory();
              const gacha = new Gacha(new Rng(seed * 7919), inventory);
              for (let rotation = 0; rotation < 12; rotation++) {
                expect(Gacha.featured(banner, rotation).filter(isRetired)).toEqual([]);
                const results = [
                  ...gacha.pull(banner, 10, 0, rotation),
                  ...gacha.pull(banner, 1, 0, rotation),
                ];
                expect(results).toHaveLength(11);
                for (const r of results) {
                  expect(isRetired(r.defId), r.defId).toBe(false);
                  seen.add(r.defId);
                }
              }
              expect(inventory.items).toHaveLength(12 * 11);
              expect(inventory.ownedDefs().filter(isRetired)).toEqual([]);
            }
            // the run was wide enough to reach every rarity a retired model sits in, wherever
            // the banner still has a model of that rarity to give
            for (const id of [...RETIRED, ...later]) {
              const rarity = itemDef(id).rarity;
              if (bannerPool(banner).some((p) => itemDef(p).rarity === rarity))
                expect(
                  [...seen].some((s) => itemDef(s).rarity === rarity),
                  id,
                ).toBe(true);
            }
          }
        });
    }
  });

  it('falls back to a model it may hand out when the rolled rarity has only retired ones', () => {
    // N rolls find no N model to give; the downgrade search runs dry and the fallback picks
    const ssr = LOCOS.find((l) => l.rarity === 'SSR' && !l.retired)!.id;
    const banner: Banner = { id: 'thin', name: 'Thin', tier: 0, pool: [...RETIRED, ssr] };
    const inventory = new Inventory();
    const gacha = new Gacha(new Rng(5), inventory);
    for (let rotation = 0; rotation < 6; rotation++)
      for (const r of gacha.pull(banner, 10, 0, rotation)) expect(r.defId).toBe(ssr);
    expect(inventory.ownedDefs()).toEqual([ssr]);
  });

  it('hands out nothing from a pool that is retired through and through', () => {
    const inventory = new Inventory();
    const gacha = new Gacha(new Rng(1), inventory);
    const banner: Banner = { id: 'gone', name: 'Gone', tier: 0, pool: [...RETIRED] };
    expect(bannerPool(banner)).toEqual([]);
    expect(Gacha.featured(banner, 0)).toEqual([]);
    expect(gacha.pull(banner, 10, 0)).toEqual([]);
    expect(gacha.pull(banner, 1, 0)).toEqual([]);
    expect(inventory.items).toEqual([]);
  });

  it('warns of a banner left without a rarity once its models of that rarity are retired', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const b of BANNERS) {
        const n = b.pool.filter((id) => itemDef(id).rarity === 'N');
        expect(retiring(n, validateBanners), b.id).toContain(`banner ${b.id} has no N items`);
      }
      expect(validateBanners()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects edited content whose banner has nothing left to pull, and keeps one that has', () => {
    const bundle = structuredClone(DEFAULT_CONTENT);
    const [first] = bundle.gacha.banners;
    first.pool = [...RETIRED, ...first.pool];
    expect(validateContent(bundle)).toEqual([]);
    first.pool = [...RETIRED];
    expect(validateContent(bundle)).toEqual([
      `banner ${first.id}: every item in the pool is retired`,
    ]);
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
            expect(w.crafting.choose(pick.pick(draw.cards))).not.toBeNull();
          }
      expect(w.crafting.recipes.size).toBeGreaterThan(RARITIES.length);
      expect([...w.crafting.recipes].filter(isRetired)).toEqual([]);
      for (const id of w.crafting.known())
        for (let n = 0; n < 4; n++) expect(w.crafting.craft(id, 0)).not.toBeNull();
      expect(w.inventory.items.length).toBeGreaterThan(0);
      expect(w.inventory.ownedDefs().filter(isRetired)).toEqual([]);
    }
  });

  it('refuses to build a retired model even with its recipe in hand, the stock untouched', () => {
    const w = workshop(3);
    const stock = () => JSON.stringify(w.stock.toJSON());
    for (const id of RETIRED) {
      w.crafting.recipes.add(id);
      const had = stock();
      expect(w.crafting.canCraft(id)).toBe(false);
      expect(w.crafting.craft(id, 0)).toBeNull();
      expect(stock()).toBe(had);
    }
    expect(w.inventory.items).toEqual([]);
    expect(w.crafting.stats.crafts).toBe(0);
    // the same workshop still builds a model that is not retired
    w.crafting.recipes.add('rocket');
    expect(w.crafting.canCraft('rocket')).toBe(true);
  });

  it('refuses to keep a retired card left over in a draw', () => {
    const w = workshop(4);
    w.crafting.pending = { kind: 'loco', tier: 0, cards: [RETIRED[0], 'rocket'] };
    expect(w.crafting.choose(RETIRED[0])).toBeNull();
    expect(w.crafting.knows(RETIRED[0])).toBe(false);
    // the draw is still open for the card that is left
    expect(w.crafting.choose('rocket')).toEqual({ defId: 'rocket', owned: false });
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
