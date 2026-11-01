/**
 * What the outliner and the train panel say about a train, as plain data read from its fields:
 * DOM-free, so Node tests read it from literals. A field the simulation has no number for is not
 * here; nothing is made up.
 */
import { levelMul } from '../gacha/items';
import { contractTitle } from '../sim/contracts';
import { daySeconds } from '../sim/rules';
import type { TrainState, TripStats } from '../sim/trains';
import { STR } from '../strings';
import { CLIMB_SPEED } from '../world/railProfile';
import type { BuildIcon } from './buildIcons';
import { noteText } from './noteText';
import { fmtDuration, fmtMoney } from './numberFormat';

/** A status's weight, drawn in the alert bar's `sev-` colours and the good green. */
export type Sev = 'good' | 'info' | 'attention' | 'problem' | 'critical';

/** A word or two on a status, with its icon. */
export interface Chip {
  sev: Sev;
  icon: BuildIcon;
  text: string;
}

/** The fields of a train this file reads. */
export interface TrainFacts {
  state: TrainState;
  blocked: boolean;
  route: readonly number[];
  routeIndex: number;
  detour: number | null;
  wagons: readonly {
    cargo: string | null;
    amount: number;
    level: number;
    def: { capacity: number };
  }[];
  hasSteam: boolean;
  hasDiesel: boolean;
  hasElectric: boolean;
  fuelKind: string;
  coal: number;
  coalCap: number;
  coalRate: number;
  water: number;
  waterCap: number;
  waterRate: number;
  oilKind: string;
  oil: number;
  oilCap: number;
  oilRate: number;
  battery: number;
  batteryCap: number;
  powerRate: number;
  rangeTiles: number;
  lastTrip: TripStats | null;
  freeSpeed: number;
  maxSpeed: number;
  loadFactor: number;
  holding: boolean;
  pathTotal: number;
  pathProgress: number;
  lastMessage: string;
  hungry: boolean;
  job: { name: string; destId: number } | null;
  jobs: readonly { name: string; destId: number }[];
}

/** A tank this few tiles from empty reads as low. */
export const LOW_TANK_TILES = 8;

const CHIP: Record<TrainState, Pick<Chip, 'sev' | 'icon'>> = {
  moving: { sev: 'good', icon: 'play' },
  loading: { sev: 'good', icon: 'cargo' },
  waiting: { sev: 'attention', icon: 'clock' },
  yielding: { sev: 'attention', icon: 'clock' },
  repairing: { sev: 'good', icon: 'repair' },
  idle: { sev: 'info', icon: 'clock' },
  noRoute: { sev: 'problem', icon: 'rail' },
  overweight: { sev: 'problem', icon: 'alert' },
  stranded: { sev: 'critical', icon: 'alert' },
  noFuel: { sev: 'critical', icon: 'fuel' },
  noPower: { sev: 'critical', icon: 'fuel' },
};

/**
 * A train's status in a word. A train that stands for good (`stuck`, its seconds, null if it does
 * not) says so over what holds it, but not over the state that stopped it.
 */
export function trainChip(t: Pick<TrainFacts, 'state' | 'blocked'>, stuck: number | null): Chip {
  const held = t.blocked && t.state === 'moving';
  const plain = t.state === 'moving' || t.state === 'waiting' || t.state === 'yielding';
  if (stuck !== null && plain) return { sev: 'critical', icon: 'alert', text: STR.outliner.stuck };
  if (held) return { sev: 'attention', icon: 'clock', text: STR.outliner.status.held };
  return { ...CHIP[t.state], text: STR.outliner.status[t.state] };
}

/** The station the train is bound for: a service stop goes before the scheduled one. */
export function nextStopId(t: Pick<TrainFacts, 'detour' | 'route' | 'routeIndex'>): number | null {
  if (t.detour !== null) return t.detour;
  return t.route.length ? t.route[t.routeIndex % t.route.length] : null;
}

/** The stop before the one it is bound for; none on a route of one stop. */
export function lastStopId(t: Pick<TrainFacts, 'route' | 'routeIndex'>): number | null {
  const n = t.route.length;
  return n < 2 ? null : t.route[(t.routeIndex + n - 1) % n];
}

/** What it carries, a line per good, in the order of its wagons; a crumb that would read 0 is none. */
export function cargoOf(t: Pick<TrainFacts, 'wagons'>): { res: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const w of t.wagons)
    if (w.cargo && w.amount > 0) by.set(w.cargo, (by.get(w.cargo) ?? 0) + w.amount);
  return [...by].filter(([, amount]) => amount >= 0.5).map(([res, amount]) => ({ res, amount }));
}

/** What its wagons can hold in all. */
export function capacityOf(t: Pick<TrainFacts, 'wagons'>): number {
  return t.wagons.reduce((n, w) => n + w.def.capacity * levelMul(w.level), 0);
}

/** How full its wagons are, 0 to 1; 0 with no wagons. */
export function loadShare(t: Pick<TrainFacts, 'wagons'>): number {
  const cap = capacityOf(t);
  return cap > 0 ? Math.min(1, t.wagons.reduce((n, w) => n + w.amount, 0) / cap) : 0;
}

/** One tank of the train. */
export interface Tank {
  /** the resource, which names its icon */
  res: string;
  have: number;
  cap: number;
  /** whole tiles it lasts; null when the engine burns none of it */
  tiles: number | null;
  low: boolean;
}

/** Only the tanks this train has: a diesel shows oil, an electric train its battery carts. */
export function tanksOf(t: TrainFacts): Tank[] {
  const tank = (res: string, have: number, cap: number, rate: number): Tank => ({
    res,
    have,
    cap,
    tiles: rate > 0 ? Math.floor(have / rate) : null,
    low: have < rate * LOW_TANK_TILES,
  });
  const out: Tank[] = [];
  if (t.hasSteam && t.coalCap > 0) out.push(tank(t.fuelKind, t.coal, t.coalCap, t.coalRate));
  if (t.hasSteam && t.waterCap > 0) out.push(tank('water', t.water, t.waterCap, t.waterRate));
  if (t.hasDiesel && t.oilCap > 0) out.push(tank(t.oilKind, t.oil, t.oilCap, t.oilRate));
  if (t.batteryCap > 0) out.push(tank('power', t.battery, t.batteryCap, t.powerRate));
  return out;
}

/** Days of the last whole loop; null before the first one closes. */
function loopDays(trip: TripStats | null): number | null {
  if (!trip || trip.endedAt <= trip.startedAt) return null;
  return (trip.endedAt - trip.startedAt) / daySeconds();
}

/** The last loop's income as a week's, as the loop's other flows are put; null before one. */
export function weeklyIncome(trip: TripStats | null): number | null {
  const days = loopDays(trip);
  return days === null ? null : (trip!.income / days) * 7;
}

/** A record of the last loop as weekly amounts, dust left out; null with nothing to show. */
export function weeklyFlow(
  trip: TripStats | null,
  rec: Record<string, number>,
  keep: (k: string) => boolean = () => true,
): { res: string; amount: number }[] | null {
  const days = loopDays(trip);
  if (days === null) return null;
  const out = Object.entries(rec)
    .filter(([k]) => keep(k))
    .map(([res, v]) => ({ res, amount: (v / days) * 7 }))
    .filter((f) => f.amount >= 0.05);
  return out.length ? out : null;
}

/** How far off the next stop is, along its path. */
export interface Arrival {
  tiles: number;
  /** game seconds, at the speed it last ran free at */
  seconds: number;
}

/**
 * The way left to the stop it runs to. Only a train running to a stop has one: a train that stands,
 * is held behind another or is making way has no such way to measure.
 */
export function arrivalOf(t: TrainFacts): Arrival | null {
  if (t.state !== 'moving' || t.blocked || t.holding || t.pathTotal <= 0) return null;
  const tiles = Math.max(0, t.pathTotal - t.pathProgress);
  const speed = t.freeSpeed > 0.01 ? t.freeSpeed : t.maxSpeed;
  return speed > 0 ? { tiles, seconds: tiles / speed } : null;
}

/** What the problem box offers. */
export type ProblemAction = 'refuel' | 'stops' | 'depot';

/** A train in trouble: what is wrong, in the simulation's own words, and what can be done. */
export interface Problem {
  sev: Sev;
  title: string;
  text: string;
  actions: ProblemAction[];
}

/** Whole hours in `sec` game seconds. */
const hoursIn = (sec: number) => Math.floor((sec / daySeconds()) * 24);

/** What is wrong with the train, the worst first; null with nothing wrong. */
export function problemOf(t: TrainFacts, stuck: number | null): Problem | null {
  const P = STR.trainPanel.problem;
  const title = STR.depot.state[t.state];
  const note = noteText(t.lastMessage);
  switch (t.state) {
    case 'noFuel':
      return {
        sev: 'critical',
        title,
        text: note || P.noFuel,
        actions: ['refuel', 'stops'],
      };
    case 'noPower':
      return { sev: 'critical', title, text: note || P.noPower, actions: ['stops'] };
    case 'stranded':
      return { sev: 'critical', title, text: P.stranded, actions: [] };
    case 'noRoute':
      return { sev: 'problem', title, text: note || P.noRoute, actions: ['stops'] };
    case 'overweight':
      return { sev: 'problem', title, text: note || P.overweight, actions: ['depot'] };
    default:
  }
  if (stuck !== null)
    return {
      sev: 'critical',
      title: P.stuckFor(hoursIn(stuck)),
      text: note || P.stuck,
      actions: ['stops'],
    };
  if (t.hungry) return { sev: 'attention', title: P.hungry, text: STR.train.hungry, actions: [] };
  return null;
}

/** The top speed under its load, and what is left of it on a climb. */
export function climbSpeed(t: Pick<TrainFacts, 'maxSpeed' | 'loadFactor'>): number {
  return t.maxSpeed * t.loadFactor * CLIMB_SPEED;
}

/** A speed as the panels print it. */
export const fmtSpeed = (v: number) => `${v.toFixed(2)} ${STR.trainSide.tilesPerSec}`;

/** The contract it works, with how many wait behind it; null with none. */
export function jobLine(
  t: Pick<TrainFacts, 'job' | 'jobs'>,
  stationName: (id: number) => string | null,
): string | null {
  const job = t.job ?? t.jobs[0];
  if (!job) return null;
  const queued = t.jobs.length - (t.job ? 0 : 1);
  const line = STR.trainSide.onContract(contractTitle(job.name), stationName(job.destId) ?? '?');
  return queued > 0 ? `${line} · ${STR.trainSide.queuedContracts(queued)}` : line;
}

/** A good on board, against what the wagons can hold. */
export interface CargoLine {
  res: string;
  amount: number;
  /** percent of what the wagons hold */
  share: number;
}

/** A tank as the Overview tab prints it. */
export interface SupplyLine {
  res: string;
  /** percent full */
  share: number;
  tiles: number | null;
  low: boolean;
}

/** A week's flow of the last loop: its name, and what moved; null with nothing yet. */
export interface FlowLine {
  label: string;
  goods: { res: string; amount: string }[] | null;
}

/** The train panel's Overview tab: rounded as it is shown, so its text says when to draw again. */
export interface TrainOverview {
  chip: Chip;
  speed: string;
  topSpeed: string;
  next: string | null;
  arrival: string | null;
  problem: Problem | null;
  job: string | null;
  load: number;
  cargo: CargoLine[];
  supplies: SupplyLine[];
  /** what an electric engine draws from the grid; null without one */
  electric: string | null;
  range: string;
  income: string | null;
  flows: FlowLine[];
}

const fmtAmount = (v: number) =>
  v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);

function flowLine(label: string, list: { res: string; amount: number }[] | null): FlowLine {
  return {
    label,
    goods: list && list.map((f) => ({ res: f.res, amount: fmtAmount(f.amount) })),
  };
}

/** Everything the Overview tab shows. `stuck` is the seconds it has stood; null if it has not. */
export function trainOverview(
  t: TrainFacts & { speed: number },
  stationName: (id: number) => string | null,
  stuck: number | null,
): TrainOverview {
  const next = nextStopId(t);
  const arrival = arrivalOf(t);
  const cap = capacityOf(t);
  const trip = t.lastTrip;
  const income = weeklyIncome(trip);
  return {
    chip: trainChip(t, stuck),
    speed: fmtSpeed(Math.round(t.speed * 10) / 10),
    topSpeed: fmtSpeed(t.maxSpeed),
    next: next === null ? null : stationName(next),
    arrival:
      arrival && STR.trainPanel.arrival(Math.ceil(arrival.tiles), fmtDuration(arrival.seconds)),
    problem: problemOf(t, stuck),
    job: jobLine(t, stationName),
    load: Math.round(loadShare(t) * 100),
    cargo: cargoOf(t).map((g) => ({
      res: g.res,
      amount: Math.round(g.amount),
      share: cap > 0 ? Math.round((g.amount / cap) * 100) : 0,
    })),
    supplies: tanksOf(t).map((k) => ({
      res: k.res,
      share: k.cap > 0 ? Math.round((k.have / k.cap) * 100) : 0,
      tiles: k.tiles,
      low: k.low,
    })),
    electric: t.hasElectric ? `${t.powerRate.toFixed(2)} ${STR.trainSide.perTile}` : null,
    range:
      t.rangeTiles === Infinity
        ? STR.trainPanel.unlimited
        : STR.trainPanel.tiles(Math.floor(t.rangeTiles)),
    income: income === null ? null : fmtMoney(income),
    flows: [
      flowLine(
        STR.trainSide.consumes,
        weeklyFlow(trip, trip?.fuel ?? {}, (k) => !k.startsWith('refuel_')),
      ),
      flowLine(STR.trainSide.collects, weeklyFlow(trip, trip?.loaded ?? {})),
      flowLine(STR.trainSide.delivers, weeklyFlow(trip, trip?.delivered ?? {})),
    ],
  };
}
