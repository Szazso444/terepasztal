import type { Stockpile } from './stockpile';

export interface ResourceStat {
  /** Actual units received during the rolling seven-day window. */
  produced: number;
  /** Actual units spent during the same window, including construction and refuelling. */
  consumed: number;
}

export function resourceStats(stock: Stockpile, ids: string[]): Record<string, ResourceStat> {
  return Object.fromEntries(ids.map((id) => [id, stock.weeklyFlow(id)]));
}
