import { CARGO, cargoDef } from './cargo';
import { rules, daySeconds } from './rules';
import { hash2 } from '../engine/rng';
import type { Stockpile } from './stockpile';
import type { Economy } from './economy';

/** Spot market multipliers on the base price (buying dear, selling cheap). */
export const BUY_MUL = 1.6;
export const SELL_MUL = 0.6;
/** Standing deals get a little better rate than one-off spot trades. */
const DEAL_BONUS = 0.9;
/** Fuels whose market price drifts: a slow random walk, one step per day, within ±40 %. */
export const DRIFTING = ['oil', 'diesel', 'crude'];
const DRIFT_MIN = 0.6;
const DRIFT_MAX = 1.4;
const DRIFT_STEP = 0.12;

export interface TradeDeal {
  resource: string;
  /** units bought (positive) or sold (negative) per cycle */
  perCycle: number;
}
export interface TradeSettlement {
  resource: string;
  units: number;
  money: number;
}

/**
 * Standing trade deals, settled once per cycle: buy so much of a resource per cycle, or sell
 * so much. A deal settles what is affordable and on hand at the time; the rest is skipped.
 * Also keeps the fuel price walk every market price is multiplied with.
 */
export class TradeDesk {
  deals = new Map<string, number>();
  /** game time of the next settlement */
  nextAt = 0;
  /** current fuel price multiplier (oil, diesel, crude) */
  fuelMul = 1;
  /** day the walk last stepped */
  private driftDay = 0;
  /** seeds the walk; the game sets it to the world seed */
  seed = 0;
  onSettled: ((s: TradeSettlement[]) => void) | null = null;

  /** Does this resource's price drift? */
  drifts(resource: string) {
    return DRIFTING.includes(resource);
  }
  /** Market price multiplier of a resource (1 for everything but fuels). */
  priceMul(resource: string) {
    return this.drifts(resource) ? this.fuelMul : 1;
  }
  buyPrice(resource: string) {
    return (
      cargoDef(resource).price * BUY_MUL * DEAL_BONUS * rules.spotPriceMul * this.priceMul(resource)
    );
  }
  sellPrice(resource: string) {
    return (
      cargoDef(resource).price *
      SELL_MUL *
      (2 - DEAL_BONUS) *
      rules.spotPriceMul *
      this.priceMul(resource)
    );
  }
  cycleSeconds() {
    return rules.tradeCycleDays * daySeconds();
  }
  set(resource: string, perCycle: number) {
    if (!perCycle) this.deals.delete(resource);
    else this.deals.set(resource, perCycle);
  }
  get(resource: string) {
    return this.deals.get(resource) ?? 0;
  }
  /** Money in (positive) or out per cycle if every deal settled in full. */
  balancePerCycle() {
    let m = 0;
    for (const [r, n] of this.deals) m += n > 0 ? -n * this.buyPrice(r) : -n * this.sellPrice(r);
    return m;
  }
  /** One step of the fuel price walk per in-game day (deterministic per seed and day). */
  private drift(now: number) {
    const day = Math.floor(now / daySeconds());
    if (day <= this.driftDay) return;
    // catch up at most a few days at once (a long-idle save should not spin the walk)
    const from = Math.max(this.driftDay, day - 5);
    for (let d = from + 1; d <= day; d++) {
      const step = (hash2(d, 7, this.seed ^ 0x0f1e) - 0.5) * 2 * DRIFT_STEP;
      // a light pull back to 1 keeps the walk wandering around the base price
      this.fuelMul = Math.max(
        DRIFT_MIN,
        Math.min(DRIFT_MAX, this.fuelMul + step + (1 - this.fuelMul) * 0.05),
      );
    }
    this.driftDay = day;
  }
  tick(now: number, stock: Stockpile, economy: Economy, cap: (id: string) => number) {
    this.drift(now);
    if (this.nextAt === 0) this.nextAt = now + this.cycleSeconds();
    if (now < this.nextAt) return;
    this.nextAt += this.cycleSeconds();
    const out: TradeSettlement[] = [];
    for (const [r, n] of this.deals) {
      if (!CARGO.some((c) => c.id === r)) continue;
      if (n > 0) {
        const room = Math.max(0, cap(r) - stock.get(r));
        const price = this.buyPrice(r);
        const affordable = Math.floor(economy.money / Math.max(0.01, price));
        const qty = Math.floor(Math.min(n, room, affordable));
        if (qty <= 0) continue;
        economy.spend(qty * price);
        stock.add(r, qty, cap(r));
        out.push({ resource: r, units: qty, money: -qty * price });
      } else {
        const qty = Math.floor(Math.min(-n, stock.get(r)));
        if (qty <= 0) continue;
        stock.take(r, qty);
        const money = qty * this.sellPrice(r);
        economy.earn(money);
        out.push({ resource: r, units: -qty, money });
      }
    }
    if (out.length) this.onSettled?.(out);
  }
  toJSON() {
    return {
      deals: Object.fromEntries(this.deals),
      nextAt: this.nextAt,
      fuelMul: this.fuelMul,
      driftDay: this.driftDay,
    };
  }
  load(
    j:
      | { deals?: Record<string, number>; nextAt?: number; fuelMul?: number; driftDay?: number }
      | undefined,
  ) {
    this.deals = new Map(Object.entries(j?.deals ?? {}));
    this.nextAt = j?.nextAt ?? 0;
    this.fuelMul = Math.max(DRIFT_MIN, Math.min(DRIFT_MAX, j?.fuelMul ?? 1));
    this.driftDay = j?.driftDay ?? 0;
  }
}
