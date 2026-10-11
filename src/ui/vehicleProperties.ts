/**
 * The data sheet of a locomotive or wagon, one line each, in names the player reads: its size and
 * body plan, its weight, what it pulls or carries, its wheels or tanks, and the track it runs on.
 * The vehicle preview shows every line, the crafting list the first three. DOM-free so it runs
 * under Node.
 */
import { itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import { BOGIE_AXLES, vehicleSpec } from '../sim/body';
import { cargoName } from '../sim/cargo';
import { runsOn } from '../sim/compat';
import { STR } from '../strings';

export function vehicleProperties(id: string): string[] {
  const d = itemDef(id),
    s = vehicleSpec(d);
  const V = STR.vehicle;
  const R = STR.roster;
  const lines = [
    V.body(R.sizes[s.size] ?? s.size, s.L, V.plan[s.plan] ?? s.plan),
    V.weight(d.weight),
  ];
  if (itemKind(id) === 'loco') {
    const l = d as LocoDef;
    lines.push(
      V.loco(R.type[l.type] ?? l.type, l.speed, l.power),
      s.drawBogies
        ? s.segments.map((p) => V.bogie(p.nb, BOGIE_AXLES[p.bogie] * 2)).join(' + ')
        : V.axles,
    );
    if (l.fuelCap) lines.push(V.fuel(l.fuelCap, l.fuelPerTile));
    if (l.waterCap) lines.push(V.water(l.waterCap, l.waterPerTile));
  } else {
    const w = d as WagonDef;
    lines.push(V.wagon(R.carries[w.carries] ?? w.carries, w.capacity));
    const accepts = (w.accepts ?? []).map((c) => cargoName(c)).join(', ');
    if (accepts) lines.push(accepts);
  }
  lines.push(runsOn(d));
  return lines;
}
