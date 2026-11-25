import { describe, it, expect } from 'vitest';
import { Rng } from '../engine/rng';
import { Economy } from '../sim/economy';
import { storesWith } from '../testing/storeFixtures';
import { Inventory } from './inventory';
import { CRAFT_CONFIG, Crafting, craftPool, craftResources, craftTier } from './crafting';

/** A workshop and two depot stores far apart: one holds plenty of every material, one nothing. */
function workshop() {
  // well under the depot's cap, so a refund fits
  const plenty = Object.fromEntries(craftResources().map((k) => [k, 1000]));
  const { stores, depots } = storesWith([
    { amounts: plenty, at: { x: 0, y: 0 } },
    { amounts: {}, at: { x: 200, y: 200 } },
  ]);
  const [rich, poor] = depots.map((d) => stores.poolOf(d));
  const inventory = new Inventory();
  const crafting = new Crafting(new Rng(5), inventory, new Economy());
  const id = craftPool('loco', 0)[0];
  crafting.recipes.add(id);
  return { crafting, inventory, rich, poor, id, plenty };
}

describe('Crafting from a store', () => {
  it('crafting pays from the given store', () => {
    const { crafting, inventory, rich, poor, id, plenty } = workshop();
    const cost = crafting.instanceCost(id);
    expect(Object.keys(cost).length).toBeGreaterThan(0);
    // the store that cannot pay refuses, and nothing moves
    expect(crafting.canCraft(id, poor)).toBe(false);
    expect(crafting.craft(id, poor, 0)).toBeNull();
    expect([...poor.held()].filter(([, n]) => n > 0)).toEqual([]);
    expect(crafting.canCraft(id, rich)).toBe(true);

    // a built one costs the whole price, from that store alone
    crafting.rng.chance = () => false;
    const ok = crafting.craft(id, rich, 0);
    expect(ok?.ok).toBe(true);
    for (const [k, v] of Object.entries(cost)) expect(rich.get(k), k).toBe(plenty[k] - v);
    expect(inventory.count(id)).toBe(1);

    // a failed one gives its share back to the same store
    crafting.rng.chance = () => true;
    const failed = crafting.craft(id, rich, 0);
    expect(failed?.ok).toBe(false);
    for (const [k, v] of Object.entries(cost)) {
      const back = Math.floor(v * CRAFT_CONFIG.failRefund);
      expect(rich.get(k), k).toBe(plenty[k] - 2 * v + back);
    }
    expect([...poor.held()].filter(([, n]) => n > 0)).toEqual([]);
  });

  it('refunds a recipe drawn again into the given store', () => {
    const { crafting, rich, poor, id, plenty } = workshop();
    crafting.pending = { kind: 'loco', tier: 0, cards: [id] };
    const res = crafting.choose(id, poor);
    expect(res).toEqual({ defId: id, owned: true, refund: { ...CRAFT_CONFIG.ownedRefund } });
    for (const [k, v] of Object.entries(CRAFT_CONFIG.ownedRefund)) {
      expect(poor.get(k), k).toBe(Math.min(Math.floor(v), poor.cap(k)));
      expect(rich.get(k), k).toBe(plenty[k]);
    }
  });
});

describe('the maintenance stock in the crafting pools', () => {
  it('maintenance locomotives are Diesel', () => {
    expect(craftTier('maint_loco_narrow')).toBe(1);
    expect(craftTier('maint_loco_branch')).toBe(1);
    for (const id of ['maint_loco_narrow', 'maint_loco_branch']) {
      expect(craftPool('loco', 1), id).toContain(id);
      for (const t of [0, 2]) expect(craftPool('loco', t), id).not.toContain(id);
    }
  });

  it('maintenance wagons are Steam', () => {
    for (const id of ['maint_wagon_narrow', 'maint_wagon_branch']) {
      expect(craftTier(id)).toBe(0);
      expect(craftPool('wagon', 0), id).toContain(id);
      for (const t of [1, 2]) expect(craftPool('wagon', t), id).not.toContain(id);
    }
  });
});
