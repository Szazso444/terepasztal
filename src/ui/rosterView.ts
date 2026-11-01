/**
 * What the Roster screen decides, apart from drawing it: which copies a filter leaves, in what
 * order, what a card says, and whether a copy can level up. DOM-free, so it runs under Node.
 */
import {
  LEVEL_CAP,
  itemDef,
  levelMul,
  type Item,
  type LocoDef,
  type WagonDef,
} from '../gacha/items';
import { cargoDef } from '../sim/cargo';
import { runsOn } from '../sim/compat';
import { STR } from '../strings';
import { dim, good, quiet, richText, text, title, vehicle, type TipDoc } from './tooltipDoc';

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

/**
 * The filters with those that would hide this copy let go; the others stay, so the list it opens
 * on is still the one the player left.
 */
export function revealFilters(f: RosterFilters, e: RosterEntry): RosterFilters {
  return {
    ...f,
    kind: f.kind === 'all' || f.kind === e.kind ? f.kind : 'all',
    rarity: f.rarity === 'all' || f.rarity === e.rarity ? f.rarity : 'all',
    size: f.size === 'all' || f.size === (e.size ?? 'small') ? f.size : 'all',
    freeOnly: f.freeOnly && e.assigned === null,
  };
}

/** Is any filter on? The count then says how many of all there are. */
export function filtered(f: RosterFilters): boolean {
  return f.kind !== 'all' || f.rarity !== 'all' || f.size !== 'all' || f.freeOnly;
}

/** What a copy's card says, in the Roster and as a tooltip: the one place that words it. */
export interface RosterCard {
  defId: string;
  name: string;
  /** its level, as a tag */
  level: string;
  era: string;
  /** what it does at its level, and the lines it runs on */
  lines: string[];
  /** the train it is in, or that it is free */
  where: string;
  inService: boolean;
  /** how many copies there are, or that it can rise no further */
  stock: string;
  /** its in-cab signalling, fitted or built in; none without */
  fitted: string | null;
}

/** The card of a copy: `train` is the name of the train it is in, `copies` how many there are. */
export function rosterCard(
  it: Pick<Item, 'defId' | 'kind' | 'level' | 'inCab'>,
  train: string | null,
  copies: number,
): RosterCard {
  const d = itemDef(it.defId);
  const m = levelMul(it.level);
  const lines: string[] = [];
  if (it.kind === 'loco') {
    const ld = d as LocoDef;
    lines.push(
      `${STR.depot.speed} ${(ld.speed * m).toFixed(2)} · ${STR.depot.power} ${Math.round(ld.power * m)} t`,
      `${STR.depot.weight} ${ld.weight} t · ${STR.roster.crew} ${ld.crew}`,
      STR.roster.fuelLine(ld),
    );
    if (ld.controlClass) lines.push(STR.depot.controlClass(ld.controlClass));
  } else {
    const wd = d as WagonDef;
    lines.push(
      `${STR.roster.capacity} ${Math.round(wd.capacity * m)} · ${STR.depot.weight} ${wd.weight} t`,
      (wd.accepts ?? []).map((c) => cargoDef(c).name).join(', '),
    );
    if (wd.service) lines.push(STR.roster.serviceLine(wd.service, wd.serviceCap ?? 0));
  }
  // its train class and the lines it may run on
  lines.push(runsOn(d as LocoDef | WagonDef));
  return {
    defId: it.defId,
    name: d.name,
    level: STR.roster.lv(it.level),
    era: d.era,
    lines: lines.filter(Boolean),
    where: train !== null ? STR.roster.assignedTo(train) : STR.roster.inDepot,
    inService: train !== null,
    stock: it.level >= LEVEL_CAP ? STR.roster.maxLevel : STR.roster.copies(copies),
    fitted: it.kind === 'loco' && (it.inCab || (d as LocoDef).inCab) ? STR.roster.hasInCab : null,
  };
}

/** The same card as a tooltip. */
export function rosterCardTip(c: RosterCard): TipDoc {
  return [
    title(c.name, ' ', quiet(c.level)),
    vehicle(c.defId),
    dim(c.era),
    ...c.lines.map((l) => text(...richText(l))),
    c.inService ? good(c.where) : dim(c.where),
    dim(c.stock),
    ...(c.fitted ? [dim(c.fitted)] : []),
  ];
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
