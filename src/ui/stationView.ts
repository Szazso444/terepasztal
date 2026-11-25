/**
 * What the tabs of the station panel say, as plain data read from a station and the world around
 * it: DOM-free, so Node tests read it from literals. `stationPanel.ts` draws it, and compares it to
 * know when to draw again. A field the simulation has no number for is not here; nothing is made up.
 */
import type { Cost, StationDef } from '../data/content';
import { LAST_AGE, ageDef } from '../sim/ages';
import { cargoDef, cargoName } from '../sim/cargo';
import { MAX_LEVEL, ageOfLevel, levelCap } from '../sim/levels';
import { rules } from '../sim/rules';
import { LEVELS, weeklyOutput } from '../sim/stations';
import { FAMINE_PRODUCTION_MUL } from '../sim/step';
import { RESOURCE_IDS, scaleCost, type ResourceStore } from '../sim/stores';
import { inSupplyMode } from '../sim/supply';
import { TRAIN_COLOURS } from '../sim/trainColours';
import { STR } from '../strings';
import { fmtDuration, fmtInt } from './numberFormat';
import { worksChip, type Amount } from './outlinerRows';
import type { WorksStatus } from './tooltipContent';
import {
  arrivalOf,
  cargoOf,
  loadShare,
  nextStopId,
  trainChip,
  type Chip,
  type TrainFacts,
} from './trainView';
import { upgradeHours, type UpgradeView } from './upgradeView';

export type StationTab = 'overview' | 'cargo' | 'trains' | 'expansion' | 'timetable';
/** The tabs, in the order the panel has them: every kind keeps goods, takes trains and has levels. */
export const STATION_TABS: readonly StationTab[] = [
  'overview',
  'cargo',
  'trains',
  'expansion',
  'timetable',
];

/** The fields of a station this file reads. */
export interface StationFacts {
  id: number;
  level: number;
  closed: boolean;
  capacity: number;
  loadRate: number;
  platforms: number;
  crew: number;
  loadBoost: number;
  firstAge: number;
  terrainFactor: number;
  productionMul: number;
  productionPerWeek: number;
  passengerPopulation: number;
  occupants: ReadonlySet<number>;
  def: Pick<StationDef, 'id' | 'cost' | 'produces' | 'accepts' | 'depot' | 'stockpile'>;
  /** its goods are this store's */
  dock: Pick<ResourceStore, 'key' | 'weeklyFlow'> | null;
  /** its workers carry its output to this store */
  outlet: Pick<ResourceStore, 'key' | 'get' | 'cap'> | null;
  distTo(x: number, y: number): number;
  availableCargo(): string[];
  producedCargo(): string[];
  stored(cargo: string): number;
  shownStored(): number;
  fill(): number;
}

/** What says whether a station makes goods now, and how many. */
type Maker = Pick<
  StationFacts,
  'closed' | 'productionMul' | 'productionPerWeek' | 'outlet' | 'producedCargo' | 'fill'
>;
/** A station that may make goods for a store. */
export type MakerFacts = Maker & { id: number; name: string; x: number; y: number };

/** A works, as what it runs from and what it is doing. */
export interface WorksFacts {
  name: string;
  x: number;
  y: number;
  /** the key of the store it works from; null with none */
  store: string | null;
  /** what a batch makes (`buildingRecipe`) */
  out: Record<string, number>;
  /** batches a week, the sim's running estimate (`Building.rate`) */
  rate: number;
  /** what it is doing (`BuildingPanel.statusKind`) */
  status: WorksStatus;
}

/** A stop of a train, as far as it says whether the train calls here. */
interface StopFacts {
  stationId: number;
  pass: boolean;
}
/** A contract handed to a train: its two ends. */
interface JobFacts {
  name: string;
  originId: number;
  destId: number;
}

/** The fields of a train the Trains and Timetable tabs read. */
export type CallFacts = Omit<TrainFacts, 'job' | 'jobs'> & {
  id: number;
  name: string;
  colour: number;
  schedule: readonly StopFacts[];
  /** its own stops, also while a contract has set them aside */
  program: readonly StopFacts[];
  /** where it stands; null under way */
  atStation: { id: number } | null;
  job: JobFacts | null;
  jobs: readonly JobFacts[];
};

/** What the Cargo tab reads of an active contract. */
export interface ContractFacts {
  id: number;
  originId: number;
  destId: number;
  cargo: string;
  amount: number;
  delivered: number;
  expires: number;
}

/** A works or a harvester that makes goods, and the store they go to. */
export interface ReachSource {
  name: string;
  /** tiles from the station */
  tiles: number;
  /** the key of the store it works from or carries to; null with none */
  store: string | null;
  /** units a week it makes now, by good; power goes to the grid and is not here */
  makes: Record<string, number>;
  /** what holds it back; null while it runs */
  chip: Chip | null;
}

/** What the tabs read of the world around a station. */
export interface StationWorld {
  /** the age the game is in */
  age: number;
  /** the level editor: the age holds no level back and nothing is paid */
  free: boolean;
  town: string | null;
  /** whether track runs past it (`Builder.platformTiles`) */
  hasTrack: boolean;
  /** the crews at the store that supplies it are starving, which halves what it makes */
  famine: boolean;
  /** the place its workers carry to (`StoreRegistry.label`); null with no outlet */
  outletName: string | null;
  /** the name of its store's owner (`StoreRegistry.label`); null with no store */
  storeName: string | null;
  /** its store is one of several on a rail network, whose ledger is one (Simple mode) */
  storeShared: boolean;
  /** everything that works from a store, this station's own or not */
  reach: readonly ReachSource[];
  now: number;
  contracts: readonly ContractFacts[];
  /** the share of a contract's term left, 0 to 1 */
  remaining(c: ContractFacts): number;
  trains: readonly CallFacts[];
  stationName(id: number): string | null;
  /** the seconds a train has stood stuck; null if it has not */
  stuck(id: number): number | null;
}

/** A share as whole percent of the bar, 0 to 100. */
const percent = (v: number, of: number) =>
  of > 0 ? Math.max(0, Math.min(100, Math.round((v / of) * 100))) : 0;

/** How a bar of storage reads: full is a problem, nearly full worth a look. */
export function fillTone(share: number): '' | 'warn' | 'bad' {
  if (share >= 100) return 'bad';
  return share >= 75 ? 'warn' : '';
}

/** One decimal, as the panels print a rate. */
const oneDecimal = (v: number) => Math.round(v * 10) / 10;

/** What a good did at a store in the last seven days. */
interface WeekFlow {
  in: number;
  out: number;
}

/**
 * The goods a station's store moved in the last seven days, by whole units. Only a store counts
 * this: a station with storage of its own has no such record, so its answer is null.
 */
function weekFlows(s: StationFacts): Map<string, WeekFlow> | null {
  const dock = s.dock;
  if (!dock) return null;
  const out = new Map<string, WeekFlow>();
  for (const id of RESOURCE_IDS) {
    const f = dock.weeklyFlow(id);
    const moved = { in: Math.round(f.produced), out: Math.round(f.consumed) };
    if (moved.in || moved.out) out.set(id, moved);
  }
  return out;
}

/**
 * Whose ledger `weeklyFlow` reads: all that enters and leaves the store, by trains or not. In a
 * town that is the town's store, shared by its Townhouse and its warehouses; on a rail network in
 * Simple mode, every store of the network. Null for a station with no store.
 */
function storeTitle(s: StationFacts, w: StationWorld): string | null {
  const P = STR.stationPanel;
  if (!s.dock) return null;
  if (w.storeShared) return P.networkStore;
  return s.dock.key.startsWith('town:') ? P.townStore(w.storeName ?? '') : P.ownStore;
}

/** The goods it has on hand, as a person counts them. */
function waitingGoods(s: StationFacts): Amount[] {
  return s
    .availableCargo()
    .map((res) => ({ res, amount: Math.floor(s.stored(res)) }))
    .filter((g) => g.amount >= 1);
}

// ---------------------------------------------------------------- Overview

/** A line that has to be seen: the class it is printed in. */
export interface StationNote {
  cls: 'amber' | 'red' | 'cyan';
  text: string;
}

export interface StationFact {
  label: string;
  value: string;
  /** a storage bar under it, in percent */
  meter?: number;
  /** it takes the grid's whole width */
  wide?: boolean;
}

export interface ProductionRow {
  res: string;
  name: string;
  /** tiles away; null for the station's own */
  tiles: number | null;
  /** what it makes now */
  perWeek: number;
  /** what holds it back; null while it runs */
  chip: Chip | null;
}

export interface StationOverview {
  notes: StationNote[];
  facts: StationFact[];
  /** whose ledger the week's line reads; null when the simulation counts none */
  weekOf: string | null;
  /** what that store moved in a week, the most first */
  week: Amount[];
  production: ProductionRow[];
  /** the people a passenger station draws from; null for any other kind */
  residents: number | null;
  waiting: Amount[];
}

/** How many goods the week's line has room for. */
export const WEEK_GOODS = 3;

function storageFact(s: StationFacts): StationFact {
  const stored = fmtInt(Math.floor(s.shownStored()));
  const cap = fmtInt(s.capacity);
  return {
    label: STR.station.storage,
    value: s.dock
      ? STR.stationPanel.storedAGood(stored, cap)
      : STR.stationPanel.stored(stored, cap),
    meter: percent(s.fill(), 1),
  };
}

/**
 * What a station makes a week now, as `Station.tick` works it out: nothing while it is closed, half
 * while the crews at its store starve.
 */
export function stationPerWeek(
  s: Pick<StationFacts, 'productionPerWeek' | 'productionMul'>,
  famine: boolean,
): number {
  return s.productionPerWeek * s.productionMul * (famine ? FAMINE_PRODUCTION_MUL : 1);
}

/** Its goods have nowhere to go: its own storage, or every good of its own at the store's cap. */
function outputFull(s: Maker): boolean {
  const outlet = s.outlet;
  if (!outlet) return s.fill() >= 1;
  const made = s.producedCargo();
  return made.length > 0 && made.every((c) => outlet.get(c) >= outlet.cap(c));
}

/** What holds a station's output back. */
function makerChip(s: Maker): Chip | null {
  if (s.closed) return worksChip({ kind: 'closed' });
  return outputFull(s) ? worksChip({ kind: 'full' }) : null;
}

/** What it makes now, shared out between its goods as a tick shares it. */
function makerRate(s: Maker, famine: boolean, chip: Chip | null): number {
  return chip ? 0 : stationPerWeek(s, famine) / Math.max(1, s.producedCargo().length);
}

/**
 * Every harvester that carries to a store and every works that makes goods, as it does now: a
 * works by the sim's own estimate of its batches, so a starved one reads what it really makes, with
 * what holds it back. Power goes to the grid and no store receives it, so it is left out, and a
 * works that makes nothing else with it. `s` is the station they are told from, and not one of them.
 */
export function reachSources(
  s: Pick<StationFacts, 'id' | 'distTo'>,
  stations: readonly MakerFacts[],
  works: readonly WorksFacts[],
  famine: (x: number, y: number) => boolean,
): ReachSource[] {
  const out: ReachSource[] = [];
  for (const o of stations) {
    const goods = o.producedCargo();
    if (o.id === s.id || !o.outlet || !goods.length) continue;
    const chip = makerChip(o);
    const each = makerRate(o, famine(o.x, o.y), chip);
    out.push({
      name: o.name,
      tiles: s.distTo(o.x, o.y),
      store: o.outlet.key,
      makes: Object.fromEntries(goods.map((c) => [c, each])),
      chip,
    });
  }
  for (const b of works) {
    const goods = Object.entries(b.out).filter(([res]) => res !== 'power');
    if (!goods.length) continue;
    out.push({
      name: b.name,
      tiles: s.distTo(b.x, b.y),
      store: b.store,
      makes: Object.fromEntries(goods.map(([res, n]) => [res, n * b.rate])),
      chip: worksChip(b.status),
    });
  }
  return out;
}

/**
 * What it makes itself, a line per good as `Station.tick` shares it out, then what works from its
 * store: the nearest first. A place with no store of its own has nothing else in reach.
 */
function productionRows(s: StationFacts, w: StationWorld): ProductionRow[] {
  const chip = makerChip(s);
  const out: ProductionRow[] = s.producedCargo().map((res) => ({
    res,
    name: cargoName(res),
    tiles: null,
    perWeek: oneDecimal(makerRate(s, w.famine, chip)),
    chip,
  }));
  const key = s.dock?.key;
  if (key === undefined) return out;
  const from = w.reach.filter((r) => r.store === key).sort((a, b) => a.tiles - b.tiles);
  for (const r of from)
    for (const [res, n] of Object.entries(r.makes))
      out.push({ res, name: r.name, tiles: r.tiles, perWeek: oneDecimal(n), chip: r.chip });
  return out;
}

export function stationOverview(s: StationFacts, w: StationWorld): StationOverview {
  const notes: StationNote[] = [];
  if (s.closed) notes.push({ cls: 'amber', text: STR.upgrade.closed });
  if (!w.hasTrack) notes.push({ cls: 'red', text: STR.station.noPlatform });
  if (s.loadBoost > 1)
    notes.push({ cls: 'cyan', text: STR.station.boost(Math.round((s.loadBoost - 1) * 100)) });
  const facts: StationFact[] = [
    {
      label: STR.station.platforms,
      value: STR.stationPanel.stored(String(s.occupants.size), String(s.platforms)),
    },
    { label: STR.station.loadRate, value: STR.station.perSec(s.loadRate) },
    storageFact(s),
    { label: STR.stationPanel.crew, value: String(s.crew) },
  ];
  if (w.town) facts.push({ label: STR.station.town, value: w.town, wide: true });
  const flows = weekFlows(s);
  const store = storeTitle(s, w);
  return {
    notes,
    facts,
    weekOf: store && STR.stationPanel.storeWeek(store),
    week: [...(flows ?? [])]
      .map(([res, f]) => ({ res, amount: f.in + f.out }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, WEEK_GOODS),
    production: productionRows(s, w),
    residents: s.def.id === 'station' ? s.passengerPopulation : null,
    waiting: waitingGoods(s),
  };
}

// ---------------------------------------------------------------- Cargo

export interface CargoRow {
  res: string;
  waiting: number;
  /** of its capacity, in percent */
  share: number;
  /** a week's goods in and out; null where the simulation does not count them */
  in: number | null;
  out: number | null;
}

export interface ContractLine {
  id: number;
  title: string;
  progress: string;
  left: string;
  /** under a quarter of its term is left */
  late: boolean;
}

export interface StationCargo {
  /** whose goods and figures the rows are: its store's, or the station's own */
  title: string;
  rows: CargoRow[];
  /** the rows have a week's flows */
  counted: boolean;
  storage: StationFact;
  /** the sentence on where its output goes; null while it stays here */
  carried: string | null;
  /** what trains may bring it */
  accepts: string[];
  contracts: ContractLine[];
}

/** The contracts with an end here, the nearest deadline first. */
function contractLines(s: StationFacts, w: StationWorld): ContractLine[] {
  return w.contracts
    .filter((c) => c.originId === s.id || c.destId === s.id)
    .sort((a, b) => a.expires - b.expires)
    .map((c) => {
      const from = c.originId === s.id;
      const other = w.stationName(from ? c.destId : c.originId) ?? '?';
      return {
        id: c.id,
        title: `${from ? '→' : '←'} ${other}: ${Math.round(c.amount)} ${cargoName(c.cargo)}`,
        progress: `${Math.floor(c.delivered)}/${c.amount}`,
        left: fmtDuration(Math.max(0, c.expires - w.now)),
        late: w.remaining(c) < 0.25,
      };
    });
}

/** What it holds, then what only passed through its store this week. */
export function stationCargo(s: StationFacts, w: StationWorld): StationCargo {
  const flows = weekFlows(s);
  const goods = s.availableCargo();
  if (flows) for (const res of flows.keys()) if (!goods.includes(res)) goods.push(res);
  return {
    title: storeTitle(s, w) ?? STR.stationPanel.cargoHere,
    rows: goods.map((res) => {
      const waiting = Math.floor(s.stored(res));
      return {
        res,
        waiting,
        share: percent(waiting, s.capacity),
        in: flows && (flows.get(res)?.in ?? 0),
        out: flows && (flows.get(res)?.out ?? 0),
      };
    }),
    counted: !!flows,
    storage: storageFact(s),
    carried: w.outletName && STR.stationPanel.carriedTo(w.outletName),
    accepts: s.def.accepts.filter((c) => inSupplyMode(cargoDef(c))),
    contracts: contractLines(s, w),
  };
}

// ---------------------------------------------------------------- Trains

/** Where a train stands with this station: the order the tab has them in. */
export type CallState = 'platform' | 'queued' | 'inbound' | 'later';
const CALL_ORDER: Record<CallState, number> = { platform: 0, queued: 1, inbound: 2, later: 3 };

export interface CallRow {
  id: number;
  name: string;
  hex: string;
  chip: Chip;
  cargo: Amount[];
  load: number;
  state: CallState;
  /** the sentence on where it is */
  where: string;
  /** game seconds until it is here; null when the simulation cannot say */
  eta: number | null;
}

/** How the train stands with the station; null for one that does not call here. */
export function callState(
  t: CallFacts,
  s: Pick<StationFacts, 'id' | 'occupants'>,
): CallState | null {
  if (s.occupants.has(t.id)) return 'platform';
  if (t.state === 'waiting' && t.atStation?.id === s.id) return 'queued';
  const stops = [...t.schedule, ...t.program].some((p) => p.stationId === s.id && !p.pass);
  const job = (t.job ? [t.job, ...t.jobs] : t.jobs).some(
    (j) => j.originId === s.id || j.destId === s.id,
  );
  if (!stops && !job && t.detour !== s.id) return null;
  return nextStopId(t) === s.id ? 'inbound' : 'later';
}

function whereLine(t: CallFacts, state: CallState, eta: number | null, w: StationWorld): string {
  const P = STR.stationPanel;
  if (state === 'platform') return P.atPlatform;
  if (state === 'queued') return P.queued;
  if (state === 'inbound') return eta === null ? P.onItsWay : P.arrives(fmtDuration(eta));
  const next = nextStopId(t);
  const name = next === null ? null : w.stationName(next);
  return name === null ? P.onItsRoute : P.boundFor(name);
}

/** Every train that calls here: those at the platforms, those waiting, then by when they come. */
export function stationTrains(s: StationFacts, w: StationWorld): CallRow[] {
  const rows: CallRow[] = [];
  for (const t of w.trains) {
    const state = callState(t, s);
    if (!state) continue;
    const eta = state === 'inbound' ? (arrivalOf(t)?.seconds ?? null) : null;
    rows.push({
      id: t.id,
      name: t.name,
      hex: TRAIN_COLOURS[t.colour],
      chip: trainChip(t, w.stuck(t.id)),
      cargo: cargoOf(t).map((g) => ({ res: g.res, amount: Math.round(g.amount) })),
      load: Math.round(loadShare(t) * 100),
      state,
      where: whereLine(t, state, eta, w),
      eta,
    });
  }
  return rows.sort(
    (a, b) =>
      CALL_ORDER[a.state] - CALL_ORDER[b.state] || (a.eta ?? Infinity) - (b.eta ?? Infinity),
  );
}

/**
 * What the rows are drawn from. Where a train is and what it carries change as it runs: the panel
 * writes those over the rows it has, so a row under the pointer stays the same element.
 */
export function callsShape(rows: readonly CallRow[]): unknown {
  return rows.map((r) => [r.id, r.name, r.hex, r.chip]);
}

// ---------------------------------------------------------------- Expansion

/** Where a level stands: reached, the one the station has, the next one up, or further. */
export type LevelState = 'done' | 'now' | 'next' | 'later';

export interface LevelRow {
  level: number;
  state: LevelState;
  /** which of the kind's pictures it has (`spriteByLevel`) */
  picture: number;
  storage: number;
  loadRate: number;
  platforms: number;
  crew: number;
  /** a week's output on this ground in this season; null for a station that makes nothing there */
  output: number | null;
  /** goods this level adds */
  unlocks: string[];
  /** what rising to it costs: nothing for a level it has */
  cost: Cost;
  /** game hours the work takes; 0 when it is instant or done */
  hours: number;
  /** the age holds it back */
  locked: boolean;
  /** the sentence on when it opens; null while it is open */
  opens: string | null;
}

/** A line of the next level's comparison; `next` is null where the level changes nothing. */
export interface LevelCompare {
  label: string;
  now: string;
  next: string | null;
}

export interface StationExpansion {
  levels: LevelRow[];
  /** the next level, null at the top */
  next: LevelRow | null;
  compare: LevelCompare[];
  /** how the level table heads its output column */
  outputHead: string;
}

/**
 * Its storage at a level. A depot's and a Townhouse's store does not follow the level; a warehouse
 * adds one `warehouseCap` a level, to its own store or to its town's; any other kind has its table.
 */
function storageAt(s: StationFacts, level: number): number {
  if (s.def.depot || s.def.id === 'town') return s.capacity;
  if (s.def.stockpile) return s.capacity + rules.warehouseCap * (level - s.level);
  return Math.round(LEVELS.capacity[level - 1] * rules.capacityMul);
}

/** A week's output at a level, as `Station.tick` multiplies it; null with nothing made there. */
function outputAt(s: StationFacts, level: number): number | null {
  if (!s.def.produces.some((p) => p.level <= level)) return null;
  return oneDecimal(weeklyOutput(level, s.terrainFactor) * s.productionMul);
}

/** The level's row: `Station.upgradeCost` for it, the tables' values, and when the age opens it. */
function levelRow(s: StationFacts, w: StationWorld, level: number, cap: number): LevelRow {
  const i = level - 1;
  const ahead = level > s.level;
  const locked = ahead && level > cap;
  const paid = ahead && !w.free;
  const state: LevelState =
    level === s.level ? 'now' : level === s.level + 1 ? 'next' : ahead ? 'later' : 'done';
  return {
    level,
    state,
    picture: LEVELS.spriteByLevel[i],
    storage: storageAt(s, level),
    loadRate: LEVELS.loadRate[i],
    // a shed's tracks are its own, whatever its level
    platforms: s.def.depot ? s.platforms : LEVELS.platforms[i],
    crew: LEVELS.crew[i],
    output: outputAt(s, level),
    unlocks: s.def.produces.filter((p) => p.level === level).map((p) => p.cargo),
    cost: paid ? scaleCost(s.def.cost, LEVELS.upgradeCostMul[i] * rules.buildCostMul) : {},
    hours: ahead ? upgradeHours(level, w.free || !!s.def.depot) : 0,
    locked,
    opens: locked
      ? STR.build.levelOpens(level, STR.ages.name[ageDef(ageOfLevel(s.firstAge, level)).id])
      : null,
  };
}

/**
 * The people around a passenger station can hold it below what a level allows (`productionPerWeek`),
 * so its figure is a most, where the Overview has what it makes now.
 */
const atMost = (s: StationFacts) => s.def.id === 'station';

function compareRows(s: StationFacts, now: LevelRow, next: LevelRow): LevelCompare[] {
  const line = (
    label: string,
    a: number,
    b: number,
    show: (v: number) => string = fmtInt,
  ): LevelCompare => ({ label, now: show(a), next: a === b ? null : show(b) });
  const out = [
    line(STR.station.storage, now.storage, next.storage),
    line(STR.stationPanel.loadPerSec, now.loadRate, next.loadRate),
    line(STR.station.platforms, now.platforms, next.platforms),
    line(STR.stationPanel.crew, now.crew, next.crew),
  ];
  const P = STR.stationPanel;
  if (next.output !== null)
    out.push(line(atMost(s) ? P.atMostAWeek : P.makesAWeek, now.output ?? 0, next.output, String));
  return out;
}

/**
 * Its levels as the kind can reach them: one per age from the age it appears in, up to what the
 * last age opens (`levelCap`), with those the age it is now holds back marked. The editor has them
 * all.
 */
export function stationExpansion(s: StationFacts, w: StationWorld): StationExpansion {
  const cap = w.free ? MAX_LEVEL : levelCap(s.firstAge, w.age);
  const top = Math.max(s.level, w.free ? MAX_LEVEL : levelCap(s.firstAge, LAST_AGE));
  const levels: LevelRow[] = [];
  for (let level = 1; level <= top; level++) levels.push(levelRow(s, w, level, cap));
  const now = levels[s.level - 1];
  const next = levels[s.level] ?? null;
  const P = STR.stationPanel;
  return {
    levels,
    next,
    compare: next ? compareRows(s, now, next) : [],
    outputHead: atMost(s) ? P.atMostShort : P.makesShort,
  };
}

/**
 * What the upgrade part is drawn from. The work's progress and the reason on a button that is off
 * change with the clock and the stock: the panel writes those over what it has.
 */
export function upgradeShape(v: UpgradeView): unknown {
  return v.kind === 'button' ? [v.kind, v.label, v.enabled] : v.kind;
}

// ---------------------------------------------------------------- Timetable

export interface BoardRow {
  id: number;
  name: string;
  hex: string;
  /** when it is here */
  when: string;
  /** the stop it leaves for; null when the simulation cannot say yet */
  to: string | null;
  chip: Chip;
}

export interface StationTimetable {
  /** what the simulation can say: the trains here, then those on their way, the nearest first */
  board: BoardRow[];
  used: number;
  platforms: number;
  /** platforms in use, in percent */
  share: number;
  queued: number;
}

/**
 * The stop a train makes for after this one, a stop it runs through not being one; null when that
 * is this station again, as a one-stop program chooses when it leaves.
 */
function onwardId(t: CallFacts, stationId: number): number | null {
  const stops = t.schedule;
  const n = stops.length;
  if (n === 0) return null;
  const at = t.routeIndex % n;
  const service = t.detour === stationId;
  if (!service && stops[at].stationId !== stationId) return null;
  for (let i = service ? 0 : 1; i <= n; i++) {
    const stop = stops[(at + i) % n];
    if (!stop.pass) return stop.stationId === stationId ? null : stop.stationId;
  }
  return null;
}

function boardTime(row: CallRow): string {
  if (row.state === 'platform') return STR.stationPanel.now;
  if (row.state === 'queued') return STR.stationPanel.inQueue;
  return row.eta === null ? '-' : STR.stationPanel.inAbout(fmtDuration(row.eta));
}

/** What the board is drawn from: when each train comes is written over the rows it has. */
export function boardShape(v: StationTimetable): unknown {
  return [v.board.map((r) => [r.id, r.name, r.hex, r.to, r.chip]), v.used, v.platforms, v.queued];
}

export function stationTimetable(s: StationFacts, w: StationWorld): StationTimetable {
  const rows = stationTrains(s, w).filter((r) => r.state !== 'later');
  const name = (id: number | null) => (id === null ? null : w.stationName(id));
  return {
    board: rows.map((r) => ({
      id: r.id,
      name: r.name,
      hex: r.hex,
      when: boardTime(r),
      to: name(
        onwardId(
          w.trains.find((t) => t.id === r.id)!,
          s.id,
        ),
      ),
      chip: r.chip,
    })),
    used: s.occupants.size,
    platforms: s.platforms,
    share: percent(s.occupants.size, s.platforms),
    queued: rows.filter((r) => r.state === 'queued').length,
  };
}
