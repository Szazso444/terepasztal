import gachaData from '../data/gacha.json';
import { Rng } from '../engine/rng';
import { RARITIES, itemDef, type Rarity, type Item } from './items';
import type { Inventory } from './inventory';

export interface Banner {
  id: string;
  name: string;
  tier: number;
  pool: string[];
}
export interface PullResult {
  defId: string;
  rarity: Rarity;
  item: Item;
  duplicate: boolean;
  leveled: boolean;
  /** true when the pity counter or the 10-pull guarantee forced this rarity */
  forced: boolean;
}

export const BANNERS: Banner[] = gachaData.banners;
export const RATES = gachaData.rates as Record<Rarity, number>;
export const PITY = gachaData.pity;
export const PULL_COST = gachaData.pullCost;

/** Seeded gacha with hard pity and a 10-pull rare guarantee. */
export class Gacha {
  pity = 0;
  totalPulls = 0;
  constructor(
    readonly rng: Rng,
    readonly inventory: Inventory,
  ) {}

  rollRarity(): Rarity {
    const r = this.rng.next();
    let acc = 0;
    for (const rar of RARITIES) {
      acc += RATES[rar];
      if (r < acc) return rar;
    }
    return 'N';
  }

  private pickFromPool(banner: Banner, rarity: Rarity): string {
    const pool = banner.pool.filter((id) => itemDef(id).rarity === rarity);
    if (!pool.length) {
      const any = banner.pool.filter((id) => itemDef(id).rarity === rarity);
      return this.rng.pick(any.length ? any : banner.pool);
    }
    return this.rng.pick(pool);
  }

  pull(banner: Banner, count: 1 | 10, now: number): PullResult[] {
    const out: PullResult[] = [];
    for (let i = 0; i < count; i++) {
      this.pity++;
      this.totalPulls++;
      let rarity = this.rollRarity();
      let forced = false;
      if (this.pity >= PITY && rarity !== 'SSR') {
        rarity = 'SSR';
        forced = true;
      }
      if (rarity === 'SSR') this.pity = 0;
      // 10-pull guarantee: last slot becomes R if nothing R+ appeared
      if (count === 10 && i === 9 && rarity === 'N' && !out.some((r) => r.rarity !== 'N')) {
        rarity = 'R';
        forced = true;
      }
      const defId = this.pickFromPool(banner, rarity);
      const added = this.inventory.add(defId, now);
      out.push({
        defId,
        rarity,
        item: added.item,
        duplicate: added.duplicate,
        leveled: added.leveled,
        forced,
      });
    }
    return out;
  }

  toJSON() {
    return { pity: this.pity, totalPulls: this.totalPulls, rng: this.rng.state };
  }
  load(j: ReturnType<Gacha['toJSON']>) {
    this.pity = j.pity;
    this.totalPulls = j.totalPulls;
    this.rng.state = j.rng;
  }
}
