import { content, type BuildingDef, type Cost } from '../data/content';
import type { Stockpile } from './stockpile';
import { rules, weekSeconds } from './rules';

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
  /** Player-paid upgrade, 1..4. Older saves default to 1. */
  level?: number;
  /** running in the last tick */
  active: boolean;
  /** batches completed in the last in-game week (rolling estimate) */
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
  depots: number,
) {
  for (const b of buildings) {
    const def = buildingDef(b.id);
    const recipe = buildingRecipe(b);
    const rate = buildingRate(b);
    const batches = ((rate * (famine ? 0.5 : 1) * rules.productionMul) / weekSeconds()) * gameDt;
    // can the next batch run at all? (inputs on hand, room for the output)
    const outOk = Object.entries(recipe.out).every(
      ([k, v]) => stock.get(k) + v <= stock.cap(k, depots, plants) + 1e-6,
    );
    const inputs = stock.canAfford(recipe.in)
      ? recipe.in
      : def.altIn && stock.canAfford(def.altIn)
        ? def.altIn
        : null;
    const running = outOk && !!inputs;
    b.reason = running ? '' : !outOk ? 'full' : 'inputs';
    if (running) b.acc += batches;
    while (b.acc >= 1) {
      const pick: Cost | null = stock.canAfford(recipe.in)
        ? recipe.in
        : def.altIn && stock.canAfford(def.altIn)
          ? def.altIn
          : null;
      if (
        !pick ||
        !Object.entries(recipe.out).every(
          ([k, v]) => stock.get(k) + v <= stock.cap(k, depots, plants) + 1e-6,
        )
      )
        break;
      stock.spend(pick);
      for (const [k, v] of Object.entries(recipe.out)) {
        stock.add(k, v, stock.cap(k, depots, plants));
        b.made = b.made ?? {};
        b.made[k] = (b.made[k] ?? 0) + v;
      }
      b.acc -= 1;
    }
    if (b.acc > 1) b.acc = 1;
    b.active = running;
    // smoothed batches/week estimate for the UI
    b.rate = b.rate * 0.95 + (running ? rate * (famine ? 0.5 : 1) * rules.productionMul : 0) * 0.05;
  }
}

export const WORKS_MAX_LEVEL = 4;
export function buildingLevel(b: Building) {
  return Math.min(WORKS_MAX_LEVEL, Math.max(1, b.level ?? 1));
}
export function buildingRate(b: Building) {
  return buildingDef(b.id).perWeek * (1 + (buildingLevel(b) - 1) * 0.5);
}
export function buildingRecipe(b: Building) {
  const r = buildingDef(b.id).recipe;
  return b.id === 'windmill' ? { in: r.in, out: { food: 5 + 2 * (buildingLevel(b) - 1) } } : r;
}
export function buildingUpgradeCost(b: Building): Cost | null {
  if (buildingLevel(b) >= WORKS_MAX_LEVEL) return null;
  return Object.fromEntries(
    Object.entries(buildingDef(b.id).cost).map(([k, v]) => [
      k,
      Math.ceil(v * buildingLevel(b) * 1.5 * rules.buildCostMul),
    ]),
  );
}
export function buildingFrame(b: Building) {
  return 'structures/' + b.id + (buildingLevel(b) > 1 ? '_lv' + buildingLevel(b) : '');
}
