/**
 * The data sheet of a locomotive or wagon, one line each, in names the player reads: its size and
 * body plan, its weight, what it pulls or carries, its wheels or tanks, and the track it runs on.
 * Inspect 3D shows every line under its label, the crafting list the first three as plain lines.
 * DOM-free so it runs under Node.
 */
import { itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import { BOGIE_AXLES, vehicleSpec } from '../sim/body';
import { cargoName } from '../sim/cargo';
import { runsOn } from '../sim/compat';
import { STR } from '../strings';

/** What a line of the sheet is about; its label is `STR.vehicle.fact[key]`. */
export type FactKey =
  'body' | 'weight' | 'pulls' | 'wheels' | 'fuel' | 'water' | 'carries' | 'takes' | 'track';

export interface VehicleFact {
  key: FactKey;
  /** the line as the crafting list prints it, with its own words */
  line: string;
  /** what stands beside the label: the line, but for a tank, which the label already names */
  value: string;
}

/** The sheet as labelled facts, in the order of its lines. */
export function vehicleFacts(id: string): VehicleFact[] {
  const d = itemDef(id),
    s = vehicleSpec(d);
  const V = STR.vehicle;
  const R = STR.roster;
  const facts: VehicleFact[] = [];
  const add = (key: FactKey, line: string, value = line) => facts.push({ key, line, value });
  add('body', V.body(R.sizes[s.size] ?? s.size, s.L, V.plan[s.plan] ?? s.plan));
  add('weight', V.weight(d.weight));
  if (itemKind(id) === 'loco') {
    const l = d as LocoDef;
    add('pulls', V.loco(R.type[l.type] ?? l.type, l.speed, l.power));
    add(
      'wheels',
      s.drawBogies
        ? s.segments.map((p) => V.bogie(p.nb, BOGIE_AXLES[p.bogie] * 2)).join(' + ')
        : V.axles,
    );
    if (l.fuelCap) add('fuel', V.fuel(l.fuelCap, l.fuelPerTile), V.tank(l.fuelCap, l.fuelPerTile));
    if (l.waterCap)
      add('water', V.water(l.waterCap, l.waterPerTile), V.tank(l.waterCap, l.waterPerTile));
  } else {
    const w = d as WagonDef;
    add('carries', V.wagon(R.carries[w.carries] ?? w.carries, w.capacity));
    const accepts = (w.accepts ?? []).map((c) => cargoName(c)).join(', ');
    if (accepts) add('takes', accepts);
  }
  add('track', runsOn(d));
  return facts;
}

export function vehicleProperties(id: string): string[] {
  return vehicleFacts(id).map((f) => f.line);
}
