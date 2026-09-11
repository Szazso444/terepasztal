import { CARGO, cargoDef } from './cargo';
import { rules, daySeconds } from './rules';
import type { Stockpile } from './stockpile';
import type { Economy } from './economy';

/** Spot market multipliers on the base price (buying dear, selling cheap). */
export const BUY_MUL = 1.6;
export const SELL_MUL = 0.6;
/** Standing deals get a little better rate than one-off spot trades. */
const DEAL_BONUS = 0.9;

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
 */
export class TradeDesk {
  deals = new Map<string, number>();
  /** game time of the next settlement */
  nextAt = 0;
  onSettled: ((s: TradeSettlement[]) => void) | null = null;

  static buyPrice(resource: string) {
    return cargoDef(resource).price * BUY_MUL * DEAL_BONUS * rules.spotPriceMul;
  }
  static sellPrice(resource: string) {
    return cargoDef(resource).price * SELL_MUL * (2 - DEAL_BONUS) * rules.spotPriceMul;
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
    for (const [r, n] of this.deals)
      m += n > 0 ? -n * TradeDesk.buyPrice(r) : -n * TradeDesk.sellPrice(r);
    return m;
  }
  tick(now: number, stock: Stockpile, economy: Economy, cap: (id: string) => number) {
    if (this.nextAt === 0) this.nextAt = now + this.cycleSeconds();
    if (now < this.nextAt) return;
    this.nextAt += this.cycleSeconds();
    const out: TradeSettlement[] = [];
    for (const [r, n] of this.deals) {
      if (!CARGO.some((c) => c.id === r)) continue;
      if (n > 0) {
        const room = Math.max(0, cap(r) - stock.get(r));
        const price = TradeDesk.buyPrice(r);
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
        const money = qty * TradeDesk.sellPrice(r);
        economy.earn(money);
        out.push({ resource: r, units: -qty, money });
      }
    }
    if (out.length) this.onSettled?.(out);
  }
  toJSON() {
    return { deals: Object.fromEntries(this.deals), nextAt: this.nextAt };
  }
  load(j: { deals?: Record<string, number>; nextAt?: number } | undefined) {
    this.deals = new Map(Object.entries(j?.deals ?? {}));
    this.nextAt = j?.nextAt ?? 0;
  }
}
