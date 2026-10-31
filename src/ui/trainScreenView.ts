import { cargoWord } from '../sim/cargo';
import { STR } from '../strings';
import { fmtDecimal } from './numberFormat';

/**
 * What the Train screen says and decides, as plain functions over plain data: the tanks and their
 * tones, the loop records, the emergency refuel's state, the cargo aboard. DOM-free, so it is
 * tested under Node from literals.
 */

/** A tank's tone: red when it holds under five tiles of use, amber under a quarter. */
export function tankTone(value: number, cap: number, rate: number): '' | 'warn' | 'bad' {
  if (rate > 0 && value < rate * 5) return 'bad';
  return cap > 0 && value < cap * 0.25 ? 'warn' : '';
}

/** What the tanks are worked out from: the train's own fields. */
export interface TankInput {
  steam: boolean;
  diesel: boolean;
  electric: boolean;
  fuelKind: string;
  oilKind: string;
  coal: number;
  coalCap: number;
  coalRate: number;
  water: number;
  waterCap: number;
  waterRate: number;
  oil: number;
  oilCap: number;
  oilRate: number;
  battery: number;
  batteryCap: number;
  /** power drawn per tile: the battery carts run out by it too */
  powerRate: number;
}

/** One tank as a meter. `icon` is the resource whose icon heads it. */
export interface TankRow {
  key: 'fuel' | 'water' | 'oil' | 'battery';
  icon: string;
  label: string;
  value: number;
  cap: number;
  tone: '' | 'warn' | 'bad';
}

/**
 * The tanks a train has, in the game's order: fuel and water, oil, the battery carts. The power an
 * electric engine draws from the wire is a row, not a tank (`hasPowerRow`). `oilName` is the oil's
 * display name.
 */
export function tankRows(t: TankInput, oilName: string): TankRow[] {
  const rows: TankRow[] = [];
  if (t.steam) {
    rows.push({
      key: 'fuel',
      icon: t.fuelKind,
      label: `${STR.train.fuel} (${cargoWord(t.fuelKind)})`,
      value: t.coal,
      cap: t.coalCap,
      tone: tankTone(t.coal, t.coalCap, t.coalRate),
    });
    rows.push({
      key: 'water',
      icon: 'water',
      label: STR.train.water,
      value: t.water,
      cap: t.waterCap,
      tone: tankTone(t.water, t.waterCap, t.waterRate),
    });
  }
  if (t.diesel)
    rows.push({
      key: 'oil',
      icon: t.oilKind,
      label: oilName,
      value: t.oil,
      cap: t.oilCap,
      tone: tankTone(t.oil, t.oilCap, t.oilRate),
    });
  if (t.batteryCap > 0)
    rows.push({
      key: 'battery',
      icon: 'power',
      label: STR.train.battery,
      value: t.battery,
      cap: t.batteryCap,
      tone: tankTone(t.battery, t.batteryCap, t.powerRate),
    });
  return rows;
}

/** A tank's value as the meter reads it. */
export function tankValue(r: Pick<TankRow, 'value' | 'cap'>): string {
  return `${Math.round(r.value)} / ${Math.round(r.cap)}`;
}

/** A tank's fill, of 1. */
export function tankShare(r: Pick<TankRow, 'value' | 'cap'>): number {
  return r.cap > 0 ? Math.min(1, Math.max(0, r.value / r.cap)) : 0;
}

/** How far a train gets on its tanks, in whole tiles; `∞` when it uses nothing. */
export function rangeText(rangeTiles: number): string {
  return rangeTiles === Infinity ? '∞' : `${Math.floor(rangeTiles)} ${STR.train.tiles}`;
}

/** The use per tile, as the screen lists it; a dash when nothing is used. */
export function perTileText(t: {
  coalRate: number;
  fuelKind: string;
  waterRate: number;
  oilRate: number;
  oilKind: string;
  powerRate: number;
}): string {
  const rate = [
    t.coalRate > 0 ? `${fmtDecimal(t.coalRate, 2)} ${cargoWord(t.fuelKind)}` : '',
    t.waterRate > 0 ? `${fmtDecimal(t.waterRate, 2)} ${cargoWord('water')}` : '',
    t.oilRate > 0 ? `${fmtDecimal(t.oilRate, 2)} ${cargoWord(t.oilKind)}` : '',
    t.powerRate > 0 ? `${fmtDecimal(t.powerRate, 2)} ${cargoWord('power')}` : '',
  ].filter(Boolean);
  return rate.join(', ') || '-';
}

/** A loop's amounts per resource as text: what is under a twentieth of a unit is left out. */
export function recordText(rec: Record<string, number>): string {
  return (
    Object.entries(rec)
      .filter(([, v]) => v >= 0.05)
      .map(([k, v]) => {
        const amount = fmtDecimal(Math.round(v * 10) / 10);
        return k.startsWith('refuel_')
          ? `${amount} +${cargoWord(k.slice('refuel_'.length))}`
          : `${amount} ${cargoWord(k)}`;
      })
      .join(', ') || '-'
  );
}

/** A loop's fuel record split into what was consumed and what was refuelled (`refuel_` keys). */
export function splitFuel(fuel: Record<string, number>): {
  used: Record<string, number>;
  refuelled: Record<string, number>;
} {
  const used: Record<string, number> = {};
  const refuelled: Record<string, number> = {};
  for (const [k, v] of Object.entries(fuel)) (k.startsWith('refuel_') ? refuelled : used)[k] = v;
  return { used, refuelled };
}

/** The cargo aboard, summed over the wagons, biggest first; a wagon with none counts for none. */
export function cargoAboard(
  wagons: readonly { cargo: string | null; amount: number }[],
): [string, number][] {
  const sums = new Map<string, number>();
  for (const w of wagons)
    if (w.cargo && w.amount > 0) sums.set(w.cargo, (sums.get(w.cargo) ?? 0) + w.amount);
  return [...sums.entries()].sort((a, b) => b[1] - a[1]);
}

/** Whether the emergency refuel may be pressed, and why not. */
export interface EmergencyState {
  disabled: boolean;
  /** the tooltip: what the button does, or why it is off */
  title: string;
}

export function emergencyState(t: {
  steam: boolean;
  diesel: boolean;
  coal: number;
  coalCap: number;
  water: number;
  waterCap: number;
  oil: number;
  oilCap: number;
}): EmergencyState {
  if (!t.steam && !t.diesel) return { disabled: true, title: STR.train.noTanks };
  const low = (v: number, cap: number) => v < cap * 0.999;
  const needs =
    (t.steam && (low(t.coal, t.coalCap) || low(t.water, t.waterCap))) ||
    (t.diesel && low(t.oil, t.oilCap));
  return needs
    ? { disabled: false, title: STR.train.emergencyHint }
    : { disabled: true, title: STR.train.tanksFull };
}

/** What a level adds to a model, in the roster's words: "Lv 2 · +8 % speed and power". */
export function levelGain(level: number, mul: number, what: string): string {
  if (level <= 1) return STR.train.levelBase;
  return STR.train.levelGain(level, Math.round((mul - 1) * 100), what);
}

/** The stop being run, when the train runs its own program rather than a contract job. */
export function currentStopIndex(onProgram: boolean, routeIndex: number, count: number): number {
  return onProgram ? routeIndex % Math.max(1, count) : -1;
}
