import { STR } from '../strings';
import { defaultStop, type StopPlan } from '../sim/trains';

/**
 * What the Depot and the stop editor say and decide, as plain functions over plain data: the
 * rows of the train list, the haul meter, whether Dispatch may be pressed and why not, the stop
 * list's edits. DOM-free, so it is tested under Node from literals.
 */

/** How a train's state reads in colour: good, info (at a platform), warn (waiting) or bad. */
export type Tone = '' | 'good' | 'info' | 'warn' | 'bad';

/** A train's state in the game's words; a train held up behind another says so. */
export function stateText(state: string, blocked = false): string {
  if (blocked && state === 'moving') return STR.depot.state.held;
  return STR.depot.state[state] ?? state;
}

/** The colour of a state: moving is fine, a wait is amber, trouble is red. */
export function stateTone(state: string, blocked = false): Tone {
  switch (state) {
    case 'moving':
      return blocked ? 'warn' : 'good';
    case 'loading':
      return 'info';
    case 'waiting':
    case 'yielding':
      return 'warn';
    case 'noRoute':
    case 'stranded':
    case 'noFuel':
    case 'noPower':
    case 'overweight':
      return 'bad';
    default:
      return '';
  }
}

/** What one row of the train list works from. */
export interface TrainRowInput {
  locoNames: readonly string[];
  wagonCount: number;
  /** the routing mode: `schedule` or one of the dynamic ones */
  mode: string;
  /** the stops of the route, by station name, when the train runs a schedule */
  routeNames: readonly string[];
  state: string;
  blocked: boolean;
  /** the station it heads for */
  next: string | null;
  /** units aboard */
  cargoUnits: number;
  /** wagon weight and what the engines can haul, t */
  weight: number;
  power: number;
  message: string;
}

/** The lines of a train's row. */
export interface TrainRowText {
  /** engines, wagons and route */
  consist: string;
  /** state and the station it heads for */
  status: string;
  /** hauled weight over engine power */
  load: string;
  /** the train is heavier than its engines can haul */
  over: boolean;
  /** units aboard and the last message */
  aboard: string;
  tone: Tone;
}

/** A train's route in a line: its stops in order, or the way it picks them. */
export function routeText(mode: string, routeNames: readonly string[]): string {
  return mode !== 'schedule' ? (STR.train.mode[mode] ?? mode) : routeNames.join(' > ');
}

export function trainRowText(i: TrainRowInput): TrainRowText {
  const route = routeText(i.mode, i.routeNames);
  return {
    consist: `${i.locoNames.join(' + ')} + ${STR.depot.wagonsCount(i.wagonCount)}${route ? ` · ${route}` : ''}`,
    status: `${stateText(i.state, i.blocked)}${i.next ? ` → ${i.next}` : ''}`,
    load: STR.train.weightPower(Math.round(i.weight), Math.round(i.power)),
    over: i.weight > i.power,
    aboard: `${STR.depot.cargo(Math.round(i.cargoUnits))}${i.message ? ` · ${i.message}` : ''}`,
    tone: stateTone(i.state, i.blocked),
  };
}

/** How full the haul meter is, of 1; a train no engine can pull is full. */
export function haulShare(weight: number, haul: number): number {
  if (haul <= 0) return weight > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, weight / haul));
}

/** The meter turns amber near the limit and red over it. */
export function haulTone(weight: number, haul: number): '' | 'warn' | 'bad' {
  if (weight > haul) return 'bad';
  return haul > 0 && weight > haul * 0.85 ? 'warn' : '';
}

/** A pick of `uid` in a list that holds at most `max`: the new list, and whether it was full. */
export function togglePick(
  list: readonly number[],
  uid: number,
  max: number,
): { list: number[]; full: boolean } {
  if (list.includes(uid)) return { list: list.filter((u) => u !== uid), full: false };
  if (list.length >= max) return { list: [...list], full: true };
  return { list: [...list, uid], full: false };
}

/** What stands in the way of Dispatch, in the order the game would refuse it. */
export interface DispatchInput {
  locos: number;
  /** locomotives and wagons of both gauges */
  mixedGauge: boolean;
  /** why a model picked cannot roll out of the depot (gauge, track), first one */
  barred: string | null;
  /** wagon weight and what the engines can haul, t */
  weight: number;
  haul: number;
  /** the preview's reason: no depot, no gate, two stops needed; null when it rolls out */
  preview: string | null;
}

/** The reason Dispatch is off, or null when the train can go. */
export function dispatchReason(i: DispatchInput): string | null {
  if (i.locos < 1) return STR.fleet.needLoco;
  if (i.mixedGauge) return STR.fleet.mixedGauge;
  if (i.barred) return i.barred;
  if (i.weight > i.haul) return STR.fleet.tooHeavy(Math.round(i.weight), Math.round(i.haul));
  return i.preview;
}

/** What a locomotive row says about the engine, at its level's multiplier. */
export function locoStats(
  d: { type: string; size?: string; speed: number; power: number; crew: number },
  mul: number,
): string {
  return [
    STR.roster.type[d.type] ?? d.type,
    STR.roster.size[d.size ?? 'small'],
    `${STR.depot.speed} ${(d.speed * mul).toFixed(1)}`,
    `${STR.depot.power} ${Math.round(d.power * mul)} t`,
    `${STR.roster.crew} ${d.crew}`,
  ].join(' · ');
}

/** The resource a refuelling cart brings, by its service. */
export function serviceResource(service: 'coal' | 'fuel' | 'battery'): string {
  return service === 'battery' ? 'power' : service === 'fuel' ? 'oil' : 'coal';
}

/** What a wagon row says about the wagon; a refuelling cart says what it adds instead. */
export function wagonStats(
  d: {
    carries: string;
    size?: string;
    capacity: number;
    weight: number;
    service?: 'coal' | 'fuel' | 'battery';
    serviceCap?: number;
  },
  mul: number,
): string {
  if (d.service)
    return `${STR.depot.cartLine(serviceResource(d.service), d.serviceCap ?? 0)} · ${d.weight}t`;
  return [
    STR.roster.carries[d.carries] ?? d.carries,
    STR.roster.size[d.size ?? 'small'],
    `${Math.round(d.capacity * mul)}u`,
    `${d.weight}t`,
  ].join(' · ');
}

// ---------------------------------------------------------------- the stop editor

/** The longest a stop's times may be, in seconds. */
export const MAX_DWELL = 600;
/** What a click on − or + moves a stop's time by, and Shift+click. */
export const DWELL_STEP = 5;
export const DWELL_BIG_STEP = 15;

/** A stop moved one place up; the first stays. Returns whether anything moved. */
export function moveStopUp(stops: StopPlan[], i: number): boolean {
  if (i < 1 || i >= stops.length) return false;
  [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]];
  return true;
}

/** A stop taken out. Returns whether there was one. */
export function removeStopAt(stops: StopPlan[], i: number): boolean {
  if (i < 0 || i >= stops.length) return false;
  stops.splice(i, 1);
  return true;
}

/** A stop at the end, with the game's defaults. */
export function appendStop(stops: StopPlan[], stationId: number): StopPlan {
  const s = defaultStop(stationId);
  stops.push(s);
  return s;
}

/** The short phrases that say what a stop does, for a list to read; none for a plain stop. */
export function stopSummary(s: StopPlan): string[] {
  const t = STR.depot.stopSum;
  return [
    s.load === 'none' ? t.loadNone : '',
    s.unload === 'all' ? t.unloadAll : s.unload === 'none' ? t.unloadNone : '',
    s.waitFull ? t.waitFull : '',
    s.refuel ? t.refuel : '',
    s.pass ? t.pass : '',
    s.depart === 'forward' ? t.departForward : s.depart === 'reverse' ? t.departReverse : '',
    s.minDwell ? t.atLeast(s.minDwell) : '',
    s.maxDwell ? t.leaveAfter(s.maxDwell) : '',
  ].filter(Boolean);
}

/** What the "Add stop" list says about one station. */
export interface StationInput {
  id: number;
  name: string;
  /** names of what it produces */
  produces: readonly string[];
  refuelsFuel: boolean;
  refuelsWater: boolean;
  hasPlatform: boolean;
}

export interface StationRow {
  id: number;
  name: string;
  /** what it produces, whether it refuels, and why it cannot be a stop */
  tags: string[];
  hasPlatform: boolean;
}

export function stationRow(s: StationInput): StationRow {
  return {
    id: s.id,
    name: s.name,
    hasPlatform: s.hasPlatform,
    tags: [
      s.produces.join(', ') || '-',
      s.refuelsFuel ? STR.depot.fuelTag : '',
      s.refuelsWater ? STR.depot.waterTag : '',
      s.hasPlatform ? '' : STR.station.noPlatform,
    ].filter(Boolean),
  };
}

/**
 * What the editor drew its stops and its station list from. It is built again only when this
 * changes, so a refresh never rebuilds a field being typed in.
 */
export function editorSignature(
  stops: readonly StopPlan[],
  current: number,
  stations: readonly StationRow[],
): string {
  return JSON.stringify([stops, current, stations]);
}
