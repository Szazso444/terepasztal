import { content, type Banner } from '../data/content';
import { Rng, hashString } from '../engine/rng';
import { RARITIES, itemDef, type Rarity, type Item } from './items';
import type { Inventory } from './inventory';

export type { Banner };
export interface PullResult {
  defId: string;
  rarity: Rarity;
  item: Item;
  duplicate: boolean;
  leveled: boolean;
  /** true when the pity counter or the 10-pull guarantee forced this rarity */
  forced: boolean;
  /** picked from the rotation's featured list */
  featured: boolean;
}

export const BANNERS: Banner[] = content.gacha.banners;
export const RATES = content.gacha.rates as Record<Rarity, number>;
export const PITY = content.gacha.pity;
export const PULL_COST = content.gacha.pullCost;
/** in-game days per featured rotation */
export const ROTATION_DAYS = 3;
/** share of a rarity slot that goes to featured items of that rarity */
export const FEATURED_SHARE = 0.5;
export function rotationIndex(day: number) {
  return Math.floor((day - 1) / ROTATION_DAYS);
}
export function daysUntilRotation(day: number) {
  return ROTATION_DAYS - ((day - 1) % ROTATION_DAYS);
}

/** Every banner must offer every rarity, otherwise rolls get downgraded; warn loudly at startup. */
export function validateBanners(): string[] {
  const problems: string[] = [];
  for (const b of BANNERS)
    for (const r of RARITIES)
      if (!b.pool.some((id) => itemDef(id).rarity === r))
        problems.push(`banner ${b.id} has no ${r} items`);
  for (const p of problems) console.warn(`[gacha] ${p}`);
  return problems;
}

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

  /** Pick from the pool at the rolled rarity, downgrading to the nearest rarity the pool has. */
  private pickFromPool(
    banner: Banner,
    rarity: Rarity,
    featured: string[],
  ): { defId: string; rarity: Rarity; featured: boolean } {
    let idx = RARITIES.indexOf(rarity);
    while (idx >= 0) {
      const r = RARITIES[idx];
      const pool = banner.pool.filter((id) => itemDef(id).rarity === r);
      if (pool.length) {
        const feat = featured.filter((id) => itemDef(id).rarity === r);
        const rest = pool.filter((id) => !feat.includes(id));
        const useFeat = feat.length > 0 && (rest.length === 0 || this.rng.next() < FEATURED_SHARE);
        const defId = this.rng.pick(useFeat ? feat : rest);
        return { defId, rarity: r, featured: feat.includes(defId) };
      }
      idx--;
    }
    const defId = this.rng.pick(banner.pool);
    return { defId, rarity: itemDef(defId).rarity, featured: featured.includes(defId) };
  }

  /** Featured items for a banner in a given rotation: up to one SSR and two SR, seeded. */
  static featured(banner: Banner, rotation: number): string[] {
    const rng = new Rng((hashString(banner.id) ^ Math.imul(rotation + 1, 2654435761)) >>> 0);
    const pick = (r: Rarity, n: number) =>
      rng.shuffle(banner.pool.filter((id) => itemDef(id).rarity === r)).slice(0, n);
    return [...pick('SSR', 1), ...pick('SR', 2)];
  }

  pull(banner: Banner, count: 1 | 10, now: number, rotation = 0): PullResult[] {
    const out: PullResult[] = [];
    const featured = Gacha.featured(banner, rotation);
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
      const picked = this.pickFromPool(banner, rarity, featured);
      const defId = picked.defId;
      rarity = picked.rarity;
      // copies no longer merge into levels; a repeat is only reported
      const duplicate = this.inventory.count(defId) > 0;
      const item = this.inventory.add(defId, now);
      out.push({
        defId,
        rarity,
        featured: picked.featured,
        item,
        duplicate,
        leveled: false,
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
