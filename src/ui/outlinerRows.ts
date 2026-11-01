/**
 * The outliner's rows, as plain data from what the simulation has: DOM-free, so Node tests read
 * them from literals. `outliner.ts` draws them, and compares their text to know when to draw again.
 */
import { contractAtRisk } from '../sim/alerts';
import { cargoName } from '../sim/cargo';
import type { ContractRarity } from '../sim/contracts';
import { TRAIN_COLOURS, shownTrainColour } from '../sim/trainColours';
import { STR } from '../strings';
import { fmtDuration, fmtInt, fmtMoney } from './numberFormat';
import type { WorksStatus } from './tooltipContent';
import {
  arrivalOf,
  cargoOf,
  lastStopId,
  loadShare,
  nextStopId,
  workLine,
  tanksOf,
  trainChip,
  weeklyIncome,
  type Chip,
  type TrainFacts,
} from './trainView';

export type OutlinerTab = 'trains' | 'stations' | 'contracts' | 'works';
export const OUTLINER_TABS: readonly OutlinerTab[] = ['trains', 'stations', 'contracts', 'works'];

/** In view lists what the camera shows, All everything. */
export type OutlinerScope = 'view' | 'all';

export interface Point {
  x: number;
  y: number;
}
/** What the camera shows, in world pixels (`Camera.viewRect`). */
export interface ViewRect extends Point {
  w: number;
  h: number;
}

/**
 * Whether the camera shows a point: its edges count as shown. `view` null shows everything (All,
 * and the overview, which has the whole map on the screen); a point nowhere is in no view.
 */
export function inView(view: ViewRect | null, p: Point | null): boolean {
  if (!view) return true;
  if (!p) return false;
  return p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h;
}

/** A tab's list: its rows, how many of all there are made the list, and how many there are. */
export interface Listed<R> {
  rows: R[];
  shown: number;
  total: number;
}

/** The footer's counts: what is in view of what there is. */
export function countsLine(scope: OutlinerScope, shown: number, total: number): string {
  const all = STR.outliner.inAll(total);
  return scope === 'view' ? `${STR.outliner.inView(shown)} · ${all}` : all;
}

// ---------------------------------------------------------------- trains

/** A good and how much of it, as a row shows it. */
export interface Amount {
  res: string;
  amount: number;
}

/** A tank in the open row. */
export interface TankBar {
  res: string;
  share: number;
  low: boolean;
}

/** What a row shows open. */
export interface TrainDetail {
  load: number;
  tanks: TankBar[];
  /** the next stop's name; null with none */
  next: string | null;
  /** the time to it; null when the train does not run to it now */
  eta: string | null;
  /** the money line; null before its first loop closes */
  income: string | null;
}

export interface TrainRow {
  id: number;
  name: string;
  hex: string;
  chip: Chip;
  cargo: Amount[];
  from: string | null;
  to: string | null;
  /** what a maintenance train is doing; null for any other */
  work: string | null;
  selected: boolean;
  following: boolean;
  detail: TrainDetail | null;
}

/** The trains of one colour. */
export interface TrainGroup {
  colour: number;
  hex: string;
  title: string;
  rows: TrainRow[];
}

/** What a train row needs besides the train. */
export interface TrainContext {
  /** where a tile point is drawn, in world pixels */
  tilePoint(x: number, y: number): Point;
  stationName(id: number): string | null;
  /** the seconds it has stood stuck; null if it has not */
  stuck(id: number): number | null;
  selected: number | null;
  following: number | null;
  expanded: number | null;
  /**
   * The colour each train is grouped by while the player works the stripes (a train's own colour
   * when it has none here): the row stays under the pointer until it leaves the list. Null with
   * nothing held.
   */
  heldColours: ReadonlyMap<number, number> | null;
}

export type TrainRowFacts = TrainFacts & {
  id: number;
  name: string;
  colour: number;
  /** its cars, the head first; none while it is not on the map */
  poses: readonly Point[];
};

function trainRow(t: TrainRowFacts, c: TrainContext): TrainRow {
  const next = nextStopId(t);
  const last = lastStopId(t);
  const to = next === null ? null : c.stationName(next);
  const open = c.expanded === t.id;
  const arrival = open ? arrivalOf(t) : null;
  const income = open ? weeklyIncome(t.lastTrip) : null;
  return {
    id: t.id,
    name: t.name,
    hex: TRAIN_COLOURS[shownTrainColour(t.colour)],
    chip: trainChip(t, c.stuck(t.id)),
    cargo: cargoOf(t).map((g) => ({ res: g.res, amount: Math.round(g.amount) })),
    from: last === null || last === next ? null : c.stationName(last),
    to,
    work: workLine(t),
    selected: c.selected === t.id,
    following: c.following === t.id,
    detail: open
      ? {
          load: Math.round(loadShare(t) * 100),
          tanks: tanksOf(t).map((k) => ({
            res: k.res,
            share: k.cap > 0 ? Math.round((k.have / k.cap) * 100) : 0,
            low: k.low,
          })),
          next: to,
          eta: arrival && fmtDuration(arrival.seconds),
          income: income === null ? null : STR.outliner.perWeek(fmtMoney(income)),
        }
      : null,
  };
}

/**
 * The order the colour groups stand in: the codes in their order, those who carry none (the first
 * code, a train's own) last.
 */
const groupOrder = (colour: number) => (colour === 0 ? TRAIN_COLOURS.length : colour);

/** Each group's title: the first code is no group at all. */
export function groupTitle(colour: number): string {
  return colour === 0 ? STR.outliner.ungrouped : STR.outliner.colourGroup(STR.train.colour[colour]);
}

/**
 * The trains in `view`, a car of them on screen being enough, grouped by colour; in the fleet's
 * order inside a group.
 */
export function trainGroups(
  trains: readonly TrainRowFacts[],
  view: ViewRect | null,
  c: TrainContext,
): Listed<TrainGroup> {
  const seen = (t: TrainRowFacts) =>
    !view || t.poses.some((p) => inView(view, c.tilePoint(p.x, p.y)));
  const groupOf = (t: TrainRowFacts) => shownTrainColour(c.heldColours?.get(t.id) ?? t.colour);
  const list = trains.filter(seen);
  const colours = [...new Set(list.map(groupOf))];
  colours.sort((a, b) => groupOrder(a) - groupOrder(b));
  return {
    rows: colours.map((colour) => ({
      colour,
      hex: TRAIN_COLOURS[colour],
      title: groupTitle(colour),
      rows: list.filter((t) => groupOf(t) === colour).map((t) => trainRow(t, c)),
    })),
    shown: list.length,
    total: trains.length,
  };
}

// ---------------------------------------------------------------- stations

/** What the Stations tab reads of a station. */
export interface StationFacts {
  id: number;
  name: string;
  level: number;
  closed: boolean;
  /** what it holds, a good at a time */
  goods: readonly Amount[];
  /** how full the fullest measure of its storage is, 0 to 1 */
  fill: number;
  /** its corners as drawn: it is in view when one of them is */
  at: readonly Point[];
}

export interface StationRow {
  id: number;
  name: string;
  level: string;
  chip: Chip | null;
  /** the most it holds of what it holds */
  goods: Amount[];
  fill: number;
}

/** How many goods a station's row has room for. */
export const ROW_GOODS = 3;

function stationChip(s: StationFacts): Chip | null {
  if (s.closed) return { sev: 'attention', icon: 'clock', text: STR.outliner.closed };
  if (s.fill >= 1) return { sev: 'problem', icon: 'alert', text: STR.outliner.full };
  return null;
}

export function stationRows(
  stations: readonly StationFacts[],
  view: ViewRect | null,
): Listed<StationRow> {
  const list = stations.filter((s) => s.at.some((p) => inView(view, p)));
  return {
    rows: list.map((s) => ({
      id: s.id,
      name: s.name,
      level: STR.outliner.level(s.level),
      chip: stationChip(s),
      goods: [...s.goods]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, ROW_GOODS)
        .map((g) => ({ res: g.res, amount: Math.floor(g.amount) })),
      fill: Math.round(Math.min(1, s.fill) * 100),
    })),
    shown: list.length,
    total: stations.length,
  };
}

// ---------------------------------------------------------------- contracts

/** What the Contracts tab reads of an active contract. */
export interface ContractFacts {
  id: number;
  rarity: ContractRarity;
  cargo: string;
  amount: number;
  delivered: number;
  payout: number;
  expires: number;
  /** the share of its term left, 0 to 1 */
  remaining: number;
  dest: string;
  /** both its stations: it is in view when one of them is */
  ends: readonly (Point | null)[];
}

export interface ContractRow {
  id: number;
  rarity: ContractRarity;
  res: string;
  title: string;
  progress: string;
  share: number;
  left: string;
  pay: string;
  atRisk: boolean;
}

/** The active contracts with an end in `view`, the nearest deadline first. */
export function contractRows(
  contracts: readonly ContractFacts[],
  now: number,
  view: ViewRect | null,
): Listed<ContractRow> {
  const list = contracts.filter((c) => c.ends.some((p) => inView(view, p)));
  return {
    rows: [...list]
      .sort((a, b) => a.expires - b.expires)
      .map((c) => ({
        id: c.id,
        rarity: c.rarity,
        res: c.cargo,
        title: `${cargoName(c.cargo)} → ${c.dest}`,
        progress: `${fmtInt(Math.floor(c.delivered))} / ${fmtInt(c.amount)}`,
        share: Math.round((c.delivered / c.amount) * 100),
        left: fmtDuration(Math.max(0, c.expires - now)),
        pay: `+${fmtMoney(c.payout)}`,
        atRisk: contractAtRisk(c.remaining, c.delivered, c.amount),
      })),
    shown: list.length,
    total: contracts.length,
  };
}

// ---------------------------------------------------------------- works

/** What the Works tab reads of a works. */
export interface WorksFacts {
  /** its corner tile's key (`BuildingMap`) */
  key: number;
  name: string;
  level: number;
  /** what it makes first; null when it makes nothing */
  res: string | null;
  /** units of that a week at its level, as tuned */
  perWeek: number;
  status: WorksStatus;
  /** the store it runs from; null with none in reach */
  store: string | null;
  /** its corners as drawn: it is in view when one of them is */
  at: readonly Point[];
}

export interface WorksRow {
  key: number;
  name: string;
  level: string;
  res: string | null;
  rate: string;
  store: string | null;
  chip: Chip | null;
}

export function worksChip(s: WorksStatus): Chip | null {
  switch (s.kind) {
    case 'running':
      return null;
    case 'closed':
      return { sev: 'attention', icon: 'clock', text: STR.outliner.closed };
    case 'full':
      return { sev: 'attention', icon: 'alert', text: STR.outliner.full };
    case 'starved':
      return { sev: 'attention', icon: 'alert', text: STR.outliner.noInput };
    case 'noStore':
      return { sev: 'problem', icon: 'alert', text: STR.outliner.noStore };
  }
}

export function worksRows(works: readonly WorksFacts[], view: ViewRect | null): Listed<WorksRow> {
  const list = works.filter((b) => b.at.some((p) => inView(view, p)));
  return {
    rows: list.map((b) => ({
      key: b.key,
      name: b.name,
      level: STR.outliner.level(b.level),
      res: b.res,
      rate: STR.outliner.perWeek(`+${fmtInt(b.perWeek)}`),
      store: b.store,
      chip: worksChip(b.status),
    })),
    shown: list.length,
    total: works.length,
  };
}

// ---------------------------------------------------------------- clicks

/** Two clicks on a name this close together, in ms, are a double-click. */
export const DOUBLE_CLICK_MS = 400;

/**
 * Whether a click on the name of train `id` at `now` is the second of a double-click. Told from
 * the clicks and not from the browser's `dblclick`, which a list redrawn after the first click may
 * not fire: the first click picks the train.
 */
export function secondClick(
  last: { id: number; at: number } | null,
  id: number,
  now: number,
): boolean {
  return !!last && last.id === id && now - last.at <= DOUBLE_CLICK_MS;
}
