import {
  content,
  type Cost,
  type CraftKind,
  type CraftRarity,
  type CraftingConfig,
  type LocoDef,
  type VehicleSize,
} from '../data/content';
import type { Rng } from '../engine/rng';
import { LOCOS, WAGONS, itemDef, itemKind, type Item } from './items';
import type { Inventory } from './inventory';
import type { Economy } from '../sim/economy';
import type { Stockpile } from '../sim/stockpile';
import { scaleCost } from '../sim/stockpile';

export type { CraftKind };
export const CRAFT_CONFIG: CraftingConfig = content.crafting;
/** ages a recipe can belong to: 0 steam, 1 diesel, 2 electric */
export const CRAFT_TIERS = [0, 1, 2] as const;
export type CraftTier = (typeof CRAFT_TIERS)[number];
const LOCO_TYPES: LocoDef['type'][] = ['steam', 'diesel', 'electric'];

/** Age of a model: locomotives by traction type, wagons by their tier field. */
export function craftTier(defId: string): number {
  if (itemKind(defId) === 'loco') return LOCO_TYPES.indexOf((itemDef(defId) as LocoDef).type);
  return WAGONS.find((w) => w.id === defId)?.tier ?? 0;
}
export function craftSize(defId: string): VehicleSize {
  return itemDef(defId).size ?? 'small';
}
export function craftRarity(defId: string): CraftRarity {
  return itemDef(defId).rarity;
}
/** Resource ids any crafting table can charge or refund, in table order. */
export function craftResources(): string[] {
  const out: string[] = [];
  const push = (c: Cost) => {
    for (const k of Object.keys(c)) if (!out.includes(k)) out.push(k);
  };
  for (const kind of Object.values(CRAFT_CONFIG.instanceCost))
    for (const c of Object.values(kind)) push(c);
  push(CRAFT_CONFIG.ownedRefund);
  return out;
}
/** Every model of a kind and age. */
export function craftPool(kind: CraftKind, tier: number): string[] {
  const defs = kind === 'loco' ? LOCOS : WAGONS;
  return defs.map((d) => d.id).filter((id) => craftTier(id) === tier);
}

export interface CraftStats {
  unlocks: number;
  crafts: number;
  failures: number;
}
/** A paid draw whose card has not been chosen yet (kept across a reload so the money is not lost). */
export interface PendingDraw {
  kind: CraftKind;
  tier: number;
  cards: string[];
}
export type ChooseResult =
  { defId: string; owned: false } | { defId: string; owned: true; refund: Cost };
export type CraftResult =
  { ok: true; item: Item; cost: Cost } | { ok: false; refund: Cost; cost: Cost };

/**
 * Recipes and building. Step one: pay money for a draw of a few recipe cards of one kind and age
 * and keep one. Step two: spend stockpile resources on an instance of a known recipe; rarer
 * models fail more often and give part of the materials back.
 */
export class Crafting {
  /** model ids the player can build */
  recipes = new Set<string>();
  stats: CraftStats = { unlocks: 0, crafts: 0, failures: 0 };
  pending: PendingDraw | null = null;

  constructor(
    readonly rng: Rng,
    readonly inventory: Inventory,
    readonly economy: Economy,
    readonly stock: Stockpile,
  ) {}

  knows(defId: string) {
    return this.recipes.has(defId);
  }
  /** known recipes, locomotives first, rarest first */
  known(): string[] {
    const order: CraftRarity[] = ['L', 'SSR', 'SR', 'R', 'N'];
    return [...this.recipes].sort((a, b) => {
      const ka = itemKind(a) === 'loco' ? 0 : 1;
      const kb = itemKind(b) === 'loco' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      const ra = order.indexOf(craftRarity(a));
      const rb = order.indexOf(craftRarity(b));
      return (
        ra - rb || craftTier(a) - craftTier(b) || itemDef(a).name.localeCompare(itemDef(b).name)
      );
    });
  }

  // ------------------------------------------------------------------ step 1: recipes
  unlockPrice(kind: CraftKind, tier: number): number {
    const prices = CRAFT_CONFIG.unlockPrice[kind];
    return prices[Math.min(tier, prices.length - 1)] ?? 0;
  }
  canDraw(kind: CraftKind, tier: number) {
    return (
      !this.pending &&
      craftPool(kind, tier).length > 0 &&
      this.economy.canAfford(this.unlockPrice(kind, tier))
    );
  }
  /**
   * Pay for a draw. Cards are distinct, weighted by rarity, with already-owned recipes weighted
   * down; when too few unseen recipes exist the draw fills up with owned ones. Returns null when
   * the player cannot pay or a draw is still waiting for its choice.
   */
  draw(kind: CraftKind, tier: number): PendingDraw | null {
    if (this.pending) return null;
    const pool = craftPool(kind, tier);
    if (!pool.length) return null;
    if (!this.economy.spend(this.unlockPrice(kind, tier))) return null;
    const cards = this.pickCards(pool, CRAFT_CONFIG.cardsPerDraw);
    this.pending = { kind, tier, cards };
    return this.pending;
  }
  private pickCards(pool: string[], n: number): string[] {
    const left = [...pool];
    const out: string[] = [];
    while (left.length && out.length < n) {
      const weights = left.map((id) => {
        const w = CRAFT_CONFIG.rarityWeight[craftRarity(id)] ?? 0;
        return this.recipes.has(id) ? w * CRAFT_CONFIG.ownedWeight : w;
      });
      const total = weights.reduce((a, v) => a + v, 0);
      let idx = left.length - 1;
      if (total > 0) {
        let r = this.rng.next() * total;
        for (let i = 0; i < left.length; i++) {
          r -= weights[i];
          if (r < 0) {
            idx = i;
            break;
          }
        }
      } else idx = Math.floor(this.rng.next() * left.length);
      out.push(left[idx]);
      left.splice(idx, 1);
    }
    return out;
  }
  /** Keep one card of the pending draw; the others are gone. An owned recipe refunds materials. */
  choose(defId: string): ChooseResult | null {
    if (!this.pending || !this.pending.cards.includes(defId)) return null;
    this.pending = null;
    if (this.recipes.has(defId)) {
      const refund = { ...CRAFT_CONFIG.ownedRefund };
      this.stock.refund(refund);
      return { defId, owned: true, refund };
    }
    this.recipes.add(defId);
    this.stats.unlocks++;
    return { defId, owned: false };
  }

  // ------------------------------------------------------------------ step 2: instances
  instanceCost(defId: string): Cost {
    const base = CRAFT_CONFIG.instanceCost[itemKind(defId)][craftSize(defId)] ?? {};
    return scaleCost(base, CRAFT_CONFIG.rarityCostMul[craftRarity(defId)] ?? 1);
  }
  failChance(defId: string): number {
    return CRAFT_CONFIG.failChance[craftRarity(defId)] ?? 0;
  }
  canCraft(defId: string) {
    return this.recipes.has(defId) && this.stock.canAfford(this.instanceCost(defId));
  }
  /** Spend the materials and roll against the failure chance. Null when the recipe is unknown or unaffordable. */
  craft(defId: string, now: number): CraftResult | null {
    if (!this.recipes.has(defId)) return null;
    const cost = this.instanceCost(defId);
    if (!this.stock.spend(cost)) return null;
    this.stats.crafts++;
    if (this.rng.chance(this.failChance(defId))) {
      this.stats.failures++;
      const refund: Cost = {};
      for (const [k, v] of Object.entries(cost))
        refund[k] = Math.floor(v * CRAFT_CONFIG.failRefund);
      this.stock.refund(refund);
      return { ok: false, refund, cost };
    }
    return { ok: true, item: this.inventory.add(defId, now), cost };
  }

  // ------------------------------------------------------------------ persistence
  /** Every model in the inventory becomes a known recipe (saves from before crafting existed). */
  grantFromInventory() {
    for (const id of this.inventory.ownedDefs()) this.recipes.add(id);
  }
  toJSON() {
    return {
      recipes: [...this.recipes],
      stats: { ...this.stats },
      pending: this.pending,
      rng: this.rng.state,
    };
  }
  load(j: Partial<ReturnType<Crafting['toJSON']>> | undefined) {
    this.recipes = new Set();
    this.stats = { unlocks: 0, crafts: 0, failures: 0 };
    this.pending = null;
    if (!j) {
      this.grantFromInventory();
      return;
    }
    const known = (id: unknown): id is string =>
      typeof id === 'string' && (LOCOS.some((l) => l.id === id) || WAGONS.some((w) => w.id === id));
    for (const id of j.recipes ?? []) if (known(id)) this.recipes.add(id);
    if (j.stats) this.stats = { ...this.stats, ...j.stats };
    if (j.pending && Array.isArray(j.pending.cards)) {
      const cards = j.pending.cards.filter(known);
      if (cards.length) this.pending = { kind: j.pending.kind, tier: j.pending.tier, cards };
    }
    if (typeof j.rng === 'number') this.rng.state = j.rng;
  }
}
