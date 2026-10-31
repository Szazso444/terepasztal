/**
 * What the Roster screen decides, apart from drawing it: which copies a filter leaves, in what
 * order, and whether a copy can level up. DOM-free, so it runs under Node.
 */

export type KindFilter = 'all' | 'loco' | 'wagon';
export type SortKey = 'rarity' | 'name' | 'level' | 'newest';

export const KIND_FILTERS: readonly KindFilter[] = ['all', 'loco', 'wagon'];
export const SORT_KEYS: readonly SortKey[] = ['rarity', 'name', 'level', 'newest'];
export const SIZE_FILTERS = ['all', 'tiny', 'small', 'medium', 'large'] as const;

/** Rarities from the commonest up: a copy's place in the order is its index. */
export const RARITY_ORDER: readonly string[] = ['N', 'R', 'SR', 'SSR', 'L'];

/** What the roster knows about one copy for filtering and sorting. */
export interface RosterEntry {
  uid: number;
  kind: 'loco' | 'wagon';
  /** the model's rarity: N, R, SR, SSR */
  rarity: string;
  /** the model's size; a model that does not say is small */
  size?: string;
  name: string;
  level: number;
  /** the train it is in, none in the depot */
  assigned: number | null;
  obtainedAt: number;
}

export interface RosterFilters {
  kind: string;
  /** a rarity id, or `all` */
  rarity: string;
  size: string;
  freeOnly: boolean;
  sort: string;
}

/** `id` when it is one of `options`, else what was picked stays. */
export function pickOf<T extends string>(options: readonly T[], id: string, current: T): T {
  return (options as readonly string[]).includes(id) ? (id as T) : current;
}

const rank = (rarity: string) => RARITY_ORDER.indexOf(rarity);

/** The copies the filters leave, sorted: a new array, the roster itself is left as it is. */
export function rosterItems<T extends RosterEntry>(items: readonly T[], f: RosterFilters): T[] {
  const out = items
    .filter((i) => f.kind === 'all' || i.kind === f.kind)
    .filter((i) => f.rarity === 'all' || i.rarity === f.rarity)
    .filter((i) => f.size === 'all' || (i.size ?? 'small') === f.size)
    .filter((i) => !f.freeOnly || i.assigned === null);
  out.sort((a, c) => {
    switch (f.sort) {
      case 'rarity':
        return rank(c.rarity) - rank(a.rarity) || a.name.localeCompare(c.name);
      case 'name':
        return a.name.localeCompare(c.name);
      case 'level':
        return c.level - a.level || rank(c.rarity) - rank(a.rarity);
      default:
        return c.obtainedAt - a.obtainedAt || c.uid - a.uid;
    }
  });
  return out;
}

/** Is any filter on? The count then says how many of all there are. */
export function filtered(f: RosterFilters): boolean {
  return f.kind !== 'all' || f.rarity !== 'all' || f.size !== 'all' || f.freeOnly;
}

export type LevelUp = 'max' | 'noSpare' | 'ready';

/** Whether a copy can level up: it needs a spare unassigned copy of its model, and a level to gain. */
export function levelUpState(level: number, cap: number, spares: number): LevelUp {
  if (level >= cap) return 'max';
  return spares > 0 ? 'ready' : 'noSpare';
}

/** What one level adds, as a whole percentage. */
export function levelGainPercent(statPerLevel: number): number {
  return Math.round(statPerLevel * 100);
}
