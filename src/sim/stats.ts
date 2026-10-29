import type { ResourceStore } from './stores';

export interface ResourceStat {
  /** Actual units received during the rolling seven-day window. */
  produced: number;
  /** Actual units spent during the same window, including construction and refuelling. */
  consumed: number;
}

/** The weekly flows of a store (or of a pool, which adds up its members') for each resource. */
export function resourceStats(store: ResourceStore, ids: string[]): Record<string, ResourceStat> {
  return Object.fromEntries(ids.map((id) => [id, store.weeklyFlow(id)]));
}
