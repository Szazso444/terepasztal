import { describe, it, expect } from 'vitest';
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
 * starter kit, the workshop) and feed each one stale data that still names the retired models,
 * the way an edited content table or an old save would: the flag has to hold on its own.
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

describe('retired models', () => {
  it('retires the Adler and the John Bull without deleting them', () => {
    expect(RETIRED).toEqual(expect.arrayContaining(['adler', 'john_bull']));
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
    for (const b of BANNERS) expect(b.pool.filter(isRetired)).toEqual([]);
    expect(validateBanners()).toEqual([]);
  });

  it('never pulls or features a retired model, on any banner, even when the pool still names one', () => {
    for (const shipped of BANNERS) {
      // what a stored content override from before the retirement looks like
      const stale: Banner = { ...shipped, pool: [...RETIRED, ...shipped.pool] };
      expect(bannerPool(stale)).toEqual(shipped.pool);
      for (const banner of [shipped, stale]) {
        const seen = new Set<string>();
        for (let seed = 1; seed <= 12; seed++) {
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
              expect(isRetired(r.defId)).toBe(false);
              seen.add(r.defId);
            }
          }
          expect(inventory.items).toHaveLength(12 * 11);
          expect(inventory.ownedDefs().filter(isRetired)).toEqual([]);
        }
        // the run was wide enough to reach every rarity the retired models sit in
        for (const id of RETIRED)
          expect([...seen].some((s) => itemDef(s).rarity === itemDef(id).rarity)).toBe(true);
      }
    }
  });

  it('hands out nothing from a pool that is retired through and through', () => {
    const inventory = new Inventory();
    const gacha = new Gacha(new Rng(1), inventory);
    const banner: Banner = { id: 'gone', name: 'Gone', tier: 0, pool: [...RETIRED] };
    expect(gacha.pull(banner, 10, 0)).toEqual([]);
    expect(gacha.pull(banner, 1, 0)).toEqual([]);
    expect(inventory.items).toEqual([]);
  });

  it('rejects edited content whose banner has nothing left to pull', () => {
    const bundle = structuredClone(DEFAULT_CONTENT);
    bundle.gacha.banners[0].pool = [...RETIRED];
    expect(validateContent(bundle).some((p) => p.includes('retired'))).toBe(true);
  });
});

describe('the starter kit and retired models', () => {
  it('starts a new game without a retired model, even one still marked as a starter', () => {
    const defs = RETIRED.map((id) => itemDef(id));
    const before = defs.map((d) => d.starter);
    for (const d of defs) d.starter = true;
    try {
      const inventory = new Inventory();
      inventory.seedStarter(0);
      expect(inventory.ownedDefs().filter(isRetired)).toEqual([]);
      // and the game is still startable: an engine and something to pull
      expect(inventory.free('loco').length).toBeGreaterThan(0);
      expect(inventory.free('wagon').length).toBeGreaterThan(0);
    } finally {
      defs.forEach((d, i) => {
        if (before[i] === undefined) delete d.starter;
        else d.starter = before[i];
      });
    }
  });

  it('does not count a retired model as the starter the content needs', () => {
    const bundle = structuredClone(DEFAULT_CONTENT);
    for (const l of bundle.locomotives) if (l.starter) l.retired = true;
    expect(validateContent(bundle)).toContain('no starter locomotive');
  });
});

describe('the workshop and retired models', () => {
  it('offers no recipe card for a retired model in any age', () => {
    const offered = KINDS.flatMap((k) => CRAFT_TIERS.flatMap((t) => craftPool(k, t)));
    expect(offered.filter(isRetired)).toEqual([]);
    // everything else is still on offer
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

  it('refuses to build a retired model even with its recipe in hand', () => {
    const w = workshop(3);
    for (const id of RETIRED) {
      w.crafting.recipes.add(id);
      const cost = w.crafting.instanceCost(id);
      const had = Object.keys(cost).map((k) => w.stock.get(k));
      expect(w.crafting.canCraft(id)).toBe(false);
      expect(w.crafting.craft(id, 0)).toBeNull();
      expect(Object.keys(cost).map((k) => w.stock.get(k))).toEqual(had);
    }
    expect(w.inventory.items).toEqual([]);
    expect(w.crafting.stats.crafts).toBe(0);
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
