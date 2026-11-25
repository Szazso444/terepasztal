/**
 * What the Market screen decides, apart from drawing it: the goods it lists, when a trade button
 * is off and why, how a standing deal reads and what it costs. DOM-free, so it runs under Node.
 */

import { fmtMoney } from './numberFormat';

export type MarketTab = 'spot' | 'deals';

/** The most a standing deal buys or sells per cycle, and how far one press of − or + moves it. */
export const DEAL_MAX = 5000;
export const DEAL_STEP = 10;
export const DEAL_BIG_STEP = 100;
/** The amounts of the spot buttons. */
export const SPOT_AMOUNTS = [10, 100] as const;

/** The goods the market deals in: not people, and only what this game's production chain has. */
export function tradedGoods<T extends { class: string }>(
  cargo: readonly T[],
  inChain: (c: T) => boolean,
): T[] {
  return cargo.filter((c) => c.class !== 'people' && inChain(c));
}

/** The tab that exists: a value that is none leaves the screen where it was. */
export function pickMarketTab(id: string, current: MarketTab): MarketTab {
  return id === 'spot' || id === 'deals' ? id : current;
}

export type TradeKind = 'buy' | 'sell';
export type OffReason = 'noStore' | 'noMoney' | 'nothing';

export interface TradeState {
  /** a store is selected to trade with */
  hasStore: boolean;
  money: number;
  /** the unit price of the side asked about */
  price: number;
  /** units of the good in the store */
  have: number;
}

/**
 * Why a trade button is off, or null when it is on. Buying needs the money for one unit (the
 * trade itself takes what fits under the cap and the money pays for); selling needs a unit
 * in the store.
 */
export function tradeOff(kind: TradeKind, s: TradeState): OffReason | null {
  if (!s.hasStore) return 'noStore';
  if (kind === 'buy') return s.money < s.price ? 'noMoney' : null;
  return s.have < 1 ? 'nothing' : null;
}

/** A standing deal is one signed number: positive buys per cycle, negative sells. */
export function dealSides(deal: number): { buy: number; sell: number } {
  return { buy: Math.max(0, deal), sell: Math.max(0, -deal) };
}

/** The signed deal one side's field makes: the other side is gone, and 0 ends the deal. */
export function dealFrom(kind: TradeKind, amount: number): number {
  const n = Math.max(0, Math.min(DEAL_MAX, Math.floor(amount) || 0));
  return kind === 'buy' ? n : -n;
}

/** Money in (positive) or out (negative) per cycle when the deal settles in full. */
export function dealMoney(deal: number, buyPrice: number, sellPrice: number): number {
  return deal > 0 ? -deal * buyPrice : -deal * sellPrice;
}

/** How a sum reads: red for a cost, green for income, dim for nothing. */
export function moneyTone(money: number): 'bad' | 'good' | 'dim' {
  return money < 0 ? 'bad' : money > 0 ? 'good' : 'dim';
}

/** A sum with its sign: a cost is −$12, an income +$12; `fmtMoney` alone would put it $-12. */
export function signedMoney(money: number): string {
  const v = Math.round(money);
  if (v === 0) return fmtMoney(0);
  return v < 0 ? `−${fmtMoney(-v)}` : `+${fmtMoney(v)}`;
}

/** How a fuel price reads against its base: dearer is red, cheaper green, near it dim. */
export function driftTone(drift: number): 'bad' | 'good' | 'dim' {
  return drift > 1.02 ? 'bad' : drift < 0.98 ? 'good' : 'dim';
}

/** How many standing deals are set (a deal of nothing is none). */
export function dealCount(deals: Iterable<number>): number {
  let n = 0;
  for (const d of deals) if (d) n++;
  return n;
}

/** Whole days until the next settlement, as the summary says it. */
export function daysUntil(seconds: number, daySeconds: number): number {
  return Math.ceil(Math.max(0, seconds) / daySeconds);
}
