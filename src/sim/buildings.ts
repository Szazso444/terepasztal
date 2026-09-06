import { content, type BuildingDef, type Cost } from '../data/content';
import type { Stockpile } from './stockpile';
import { rules, daySeconds } from './rules';

export type { BuildingDef };
export const BUILDING_DEFS: BuildingDef[] = content.buildings;
export function buildingDef(id: string): BuildingDef {
  const d = BUILDING_DEFS.find((b) => b.id === id);
  if (!d) throw new Error(`unknown building ${id}`);
  return d;
}

/** A placed processing building. */
export interface Building {
  id: string;
  x: number;
  y: number;
  /** fraction of a batch accumulated */
  acc: number;
  /** running in the last tick */
  active: boolean;
  /** batches completed in the last in-game day (rolling estimate) */
  rate: number;
  /** total output produced over the building's life, per resource */
  made?: Record<string, number>;
  /** why the last tick did not run (empty when running) */
  reason?: 'inputs' | 'full' | '';
}
/** Which primary input is short, if any. */
export function missingInput(def: BuildingDef, stock: Stockpile): string | null {
  for (const [k, v] of Object.entries(def.recipe.in)) if (stock.get(k) < v) return k;
  return null;
}

/**
 * Run every building's recipe against the stockpile. Inputs are consumed continuously; when the
 * primary inputs run short the alternative input set is tried (power plants burn oil instead of coal).
 */
export function tickBuildings(
  buildings: Iterable<Building>,
  stock: Stockpile,
  gameDt: number,
  famine: boolean,
  plants: number,
  warehouseLevels: number,
) {
  for (const b of buildings) {
    const def = buildingDef(b.id);
    const batches =
      ((def.perDay * (famine ? 0.5 : 1) * rules.productionMul) / daySeconds()) * gameDt;
    // can the next batch run at all? (inputs on hand, room for the output)
    const outOk = Object.entries(def.recipe.out).every(
      ([k, v]) => stock.get(k) + v <= stock.cap(k, warehouseLevels, plants) + 1e-6,
    );
    const inputs = stock.canAfford(def.recipe.in)
      ? def.recipe.in
      : def.altIn && stock.canAfford(def.altIn)
        ? def.altIn
        : null;
    const running = outOk && !!inputs;
    b.reason = running ? '' : !outOk ? 'full' : 'inputs';
    if (running) b.acc += batches;
    while (b.acc >= 1) {
      const pick: Cost | null = stock.canAfford(def.recipe.in)
        ? def.recipe.in
        : def.altIn && stock.canAfford(def.altIn)
          ? def.altIn
          : null;
      if (!pick) break;
      stock.spend(pick);
      for (const [k, v] of Object.entries(def.recipe.out)) {
        stock.add(k, v, stock.cap(k, warehouseLevels, plants));
        b.made = b.made ?? {};
        b.made[k] = (b.made[k] ?? 0) + v;
      }
      b.acc -= 1;
    }
    if (b.acc > 1) b.acc = 1;
    b.active = running;
    // smoothed batches/day estimate for the UI
    b.rate =
      b.rate * 0.95 + (running ? def.perDay * (famine ? 0.5 : 1) * rules.productionMul : 0) * 0.05;
  }
}
