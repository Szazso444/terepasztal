import { content, type BuildingDef, type Cost } from '../data/content';
import type { Stockpile } from './stockpile';
import { rules, weekSeconds } from './rules';
import { MAX_LEVEL, levelCap } from './levels';
import { workFromJSON, workToJSON, type Work } from './upgrade';
import { wrapRotation } from './rotation';

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
  /** Player-paid upgrade, 1..`worksMaxLevel`. Older saves default to 1. */
  level?: number;
  /**
   * The rotation it was placed in, 0 to 3 (`BUILDING_ROTATIONS`). A works covers its one tile at
   * every rotation, so nothing it does depends on it. Missing (a level file's works) means 0.
   */
  rot?: number;
  /** running in the last tick */
  active: boolean;
  /** batches completed in the last in-game week (rolling estimate) */
  rate: number;
  /** total output produced over the building's life, per resource */
  made?: Record<string, number>;
  /** why the last tick did not run (empty when running) */
  reason?: 'inputs' | 'full' | 'upgrading' | '';
  /**
   * The upgrade under way (`Builder.upgradeBuilding`), absent when none is. While it runs the
   * works is closed: it processes nothing, has no crew, and gives no power and feeds no wire.
   */
  work?: Work;
}
/**
 * A building as a save holds it (v4); the level came later, and a save without one means 1. The
 * upgrade under way came in v15, null for none; the rotation in v16, and a save without one means 0.
 */
export type BuildingJSON = [
  x: number,
  y: number,
  id: string,
  acc: number,
  level?: number,
  work?: Work | null,
  rot?: number,
];
export function buildingToJSON(b: Building): BuildingJSON {
  return [b.x, b.y, b.id, b.acc, b.level ?? 1, workToJSON(b.work), b.rot ?? 0];
}
/**
 * A saved building, idle until its first tick says otherwise. Its work is kept only where the game
 * could have started it: on a building it knows, towards the next level and at most the top one.
 * Its rotation is one of the four (`wrapRotation`), 0 where the save has none.
 */
export function buildingFromJSON([x, y, id, acc, level, work, rot]: BuildingJSON): Building {
  const lv = level ?? 1;
  const b: Building = {
    id,
    x,
    y,
    acc: acc ?? 0,
    level: lv,
    rot: wrapRotation(rot),
    active: false,
    rate: 0,
  };
  if (BUILDING_DEFS.some((d) => d.id === id)) {
    const w = workFromJSON(work, buildingLevel(b), worksMaxLevel(b));
    if (w) b.work = w;
  }
  return b;
}
/** Which primary input is short, if any. */
export function missingInput(def: BuildingDef, stock: Stockpile): string | null {
  for (const [k, v] of Object.entries(def.recipe.in)) if (stock.get(k) < v) return k;
  return null;
}

/**
 * Run every building's recipe against the stockpile. Inputs are consumed continuously; when the
 * primary inputs run short the alternative input set is tried (power plants burn oil instead of coal).
 * A building being upgraded is skipped: it takes nothing in and makes nothing.
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
    if (b.work) {
      b.reason = 'upgrading';
      b.active = false;
      // the estimate fades as it does over any idle tick
      b.rate *= 0.95;
      continue;
    }
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

/** Bridges are strengthened, not rebuilt: they keep their own four levels, whatever the age. */
export const BRIDGE_MAX_LEVEL = 4;
/** The highest level with a picture of its own (`_lv4`); the levels above it draw that one. */
export const WORKS_TOP_PICTURE = 4;
/**
 * The highest level a building may hold: four for a bridge, `MAX_LEVEL` for works. It clamps what
 * a save or a level file brings (`buildingLevel`, `buildingFromJSON`), so a building above the
 * cap `worksUpgradeMax` sets keeps its level. Upgrades stop earlier, at `worksUpgradeMax`.
 */
export function worksMaxLevel(b: Building) {
  return buildingDef(b.id).bridge ? BRIDGE_MAX_LEVEL : MAX_LEVEL;
}
/**
 * The highest level the player can upgrade a building to, a whole number from 1 to
 * `worksMaxLevel`. A bridge has its four levels; works with a `lastTier` stop at the level that
 * age opens (`levelCap` of the works' own first age), since the art has no model for the ages
 * after it. A `lastTier` that is not a whole number counts as missing, so every age upgrades.
 */
export function worksUpgradeMax(b: Building) {
  const def = buildingDef(b.id);
  if (def.bridge) return BRIDGE_MAX_LEVEL;
  const last = def.lastTier;
  return typeof last === 'number' && Number.isInteger(last)
    ? levelCap(def.tier ?? 0, last)
    : MAX_LEVEL;
}
export function buildingLevel(b: Building) {
  return Math.min(worksMaxLevel(b), Math.max(1, b.level ?? 1));
}
export function buildingRate(b: Building) {
  return buildingDef(b.id).perWeek * (1 + (buildingLevel(b) - 1) * 0.5);
}
export function buildingRecipe(b: Building) {
  const r = buildingDef(b.id).recipe;
  return b.id === 'windmill' ? { in: r.in, out: { food: 5 + 2 * (buildingLevel(b) - 1) } } : r;
}
export function buildingUpgradeCost(b: Building): Cost | null {
  if (buildingLevel(b) >= worksUpgradeMax(b)) return null;
  return Object.fromEntries(
    Object.entries(buildingDef(b.id).cost).map(([k, v]) => [
      k,
      Math.ceil(v * buildingLevel(b) * 1.5 * rules.buildCostMul),
    ]),
  );
}
/** Atlas frame of a building: its level's picture, or the highest there is for the levels above. */
export function buildingFrame(b: Building) {
  const l = Math.min(buildingLevel(b), WORKS_TOP_PICTURE);
  return 'structures/' + b.id + (l > 1 ? '_lv' + l : '');
}
