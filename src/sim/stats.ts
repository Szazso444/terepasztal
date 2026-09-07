import type { Builder } from './build';
import type { Train } from './trains';
import type { Stockpile } from './stockpile';
import { buildingDef } from './buildings';
import { daySeconds } from './rules';

export interface ResourceStat {
  /** units per day entering the stockpile (stations' output the trains can carry, works output) */
  produced: number;
  /** units per day leaving it (works input, train fuel, crew food) */
  consumed: number;
}

/** Rough per-day flows for the resource tooltips. */
export function resourceStats(
  builder: Builder,
  trains: Train[],
  stock: Stockpile,
  ids: string[],
): Record<string, ResourceStat> {
  const out: Record<string, ResourceStat> = {};
  for (const id of ids) out[id] = { produced: 0, consumed: 0 };
  const add = (id: string, k: 'produced' | 'consumed', v: number) => {
    if (out[id]) out[id][k] += v;
  };
  for (const s of builder.stations)
    for (const c of s.producedCargo()) add(c, 'produced', s.productionPerDay * s.productionMul);
  for (const b of builder.buildings.values()) {
    const def = buildingDef(b.id);
    for (const [k, v] of Object.entries(def.recipe.out)) add(k, 'produced', v * b.rate);
    for (const [k, v] of Object.entries(def.recipe.in)) add(k, 'consumed', v * b.rate);
  }
  for (const t of trains) {
    const tr = t.lastTrip;
    if (!tr || tr.endedAt <= tr.startedAt) continue;
    const days = (tr.endedAt - tr.startedAt) / daySeconds();
    for (const [k, v] of Object.entries(tr.fuel))
      if (!k.startsWith('refuel_')) add(k, 'consumed', v / days);
  }
  add('wheat', 'consumed', stock.wheatPerDay());
  return out;
}
