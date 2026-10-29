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

/**
 * The weekly flows of the store a reader shows, worked out again only on `refresh` or when another
 * store is shown: the resource bar is drawn every frame, its flows worked out on the panels' half
 * second refresh (`Game`), each a look through a week of every member's log.
 */
export class ShownFlows {
  private store: ResourceStore | null = null;
  private stats: Record<string, ResourceStat> = {};

  constructor(private readonly ids: string[]) {}

  /** The flows of `store`: the ones last worked out for it, else worked out now. */
  of(store: ResourceStore): Record<string, ResourceStat> {
    if (store !== this.store) {
      this.store = store;
      this.stats = resourceStats(store, this.ids);
    }
    return this.stats;
  }
  /** The next `of` works the flows out again. */
  refresh() {
    this.store = null;
  }
}
