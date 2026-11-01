import { content, type BuildingDef, type Cost } from '../data/content';
import type { ResourceStore } from './stores';
import { rules, weekSeconds } from './rules';
import { MAX_LEVEL, levelCap } from './levels';
import { workFromJSON, workToJSON, type Work } from './upgrade';
import { wrapRotation } from './rotation';
import { placeSpan } from './doors';
import type { LevelBuilding } from '../world/level';

export type { BuildingDef };
export const BUILDING_DEFS: BuildingDef[] = content.buildings;
export function buildingDef(id: string): BuildingDef {
  const d = BUILDING_DEFS.find((b) => b.id === id);
  if (!d) throw new Error(`unknown building ${id}`);
  return d;
}
/**
 * Width (along x) and depth (along y) of a works turned to `rot`: its span at rotation 0
 * (`placeSpan`), swapped on the other axis, so `rot` and `rot + 2` give the same span.
 */
export function buildingSpan(def: BuildingDef, rot: number): { w: number; h: number } {
  const { w, h } = placeSpan(def);
  return wrapRotation(rot) % 2 === 0 ? { w, h } : { w: h, h: w };
}
/** The tiles a works of this kind covers with its corner at (x, y), turned to `rot`. */
export function buildingFootprint(defId: string, x: number, y: number, rot: number) {
  const { w, h } = buildingSpan(buildingDef(defId), rot);
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

/**
 * The works of a map keyed by their corner tile (`y * w + x`), which is all a save holds, and also
 * indexed by every tile of their footprint, so `at` finds a works from any tile it covers. Setting
 * or deleting an entry keeps the index, whoever does it. A footprint tile off the map is not
 * indexed (a repaired old save may hold one).
 */
export class BuildingMap extends Map<number, Building> {
  private readonly cover = new Map<number, Building>();
  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    super();
  }
  private tiles(b: Building) {
    // a works of a kind the content no longer has covers its corner tile alone
    const all = BUILDING_DEFS.some((d) => d.id === b.id)
      ? buildingFootprint(b.id, b.x, b.y, b.rot ?? 0)
      : [{ x: b.x, y: b.y }];
    return all.filter((t) => this.inside(t.x, t.y));
  }
  private inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  private uncover(b: Building) {
    for (const t of this.tiles(b)) {
      const k = t.y * this.w + t.x;
      if (this.cover.get(k) === b) this.cover.delete(k);
    }
  }
  override set(key: number, b: Building) {
    const old = this.get(key);
    if (old) this.uncover(old);
    super.set(key, b);
    for (const t of this.tiles(b)) this.cover.set(t.y * this.w + t.x, b);
    return this;
  }
  override delete(key: number) {
    const old = this.get(key);
    if (old) this.uncover(old);
    return super.delete(key);
  }
  override clear() {
    super.clear();
    this.cover.clear();
  }
  /** The works that covers (x, y), whichever of its tiles that is. */
  at(x: number, y: number): Building | undefined {
    return this.inside(x, y) ? this.cover.get(y * this.w + x) : undefined;
  }
}

/** A placed processing building. */
export interface Building {
  id: string;
  /** the footprint's corner, its lowest x and y (`buildingFootprint`); a save keeps only this */
  x: number;
  y: number;
  /** fraction of a batch accumulated */
  acc: number;
  /** Player-paid upgrade, 1..`worksMaxLevel`. Older saves default to 1. */
  level?: number;
  /**
   * The rotation it was placed in, 0 to 3 (`BUILDING_ROTATIONS`). It turns the footprint of a
   * works with a `span` (`buildingFootprint`) and its doors. A level file keeps it too
   * (`buildingToLevel`); missing (a works built without one, or one in a level file older than
   * that) means 0.
   */
  rot?: number;
  /**
   * A bridge platform raised by the player (`Builder.raiseSpan`): its deck height in levels,
   * absolute like the terrain's. Absent, the deck is automatic: it takes the level of the rail
   * laid over it, or lies on the ground or the water. It has nothing to do with `level`, the
   * capacity upgrade.
   */
  deck?: number;
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
 * upgrade under way came in v15, null for none; the rotation in v16, and a save without one means 0;
 * the deck height of a raised bridge platform in v25, null on anything else.
 */
export type BuildingJSON = [
  x: number,
  y: number,
  id: string,
  acc: number,
  level?: number,
  work?: Work | null,
  rot?: number,
  deck?: number | null,
];
export function buildingToJSON(b: Building): BuildingJSON {
  return [b.x, b.y, b.id, b.acc, b.level ?? 1, workToJSON(b.work), b.rot ?? 0, b.deck ?? null];
}
/**
 * A saved building, idle until its first tick says otherwise. Its work is kept only where the game
 * could have started it: on a building it knows, towards the next level and at most the top one.
 * Its rotation is one of the four (`wrapRotation`), 0 where the save has none.
 */
export function buildingFromJSON([x, y, id, acc, level, work, rot, deck]: BuildingJSON): Building {
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
  if (typeof deck === 'number' && Number.isInteger(deck)) b.deck = deck;
  return b;
}
/**
 * A works as a level file holds it: where, what, and its turn as the fourth element. A works
 * unturned is left at the three, which is also all an older level file ever held.
 */
export function buildingToLevel(b: Building): LevelBuilding {
  const rot = wrapRotation(b.rot);
  return rot ? [b.x, b.y, b.id, rot] : [b.x, b.y, b.id];
}
/**
 * The works a level file holds, idle and at its first level with no upgrade under way (a level
 * keeps neither). Its rotation is one of the four (`wrapRotation`), 0 where the file has none.
 */
export function buildingFromLevel([x, y, id, rot]: LevelBuilding): Building {
  return { id, x, y, acc: 0, active: false, rate: 0, rot: wrapRotation(rot) };
}
/** Which primary input is short at the store, if any; with no store, the first input. */
export function missingInput(
  def: BuildingDef,
  store: Pick<ResourceStore, 'get'> | null,
): string | null {
  for (const [k, v] of Object.entries(def.recipe.in)) if (!store || store.get(k) < v) return k;
  return null;
}

/**
 * Whether a works moves any good but power, in or out: one that does needs a store to run
 * (`StoreRegistry.worksStore`); one that does not (a hydro plant, a bridge) runs on the grid.
 */
export function needsStore(b: Building): boolean {
  const def = buildingDef(b.id);
  const r = buildingRecipe(b);
  return [r.in, r.out, def.altIn ?? {}].some((c) => Object.keys(c).some((k) => k !== 'power'));
}

/** What a works makes while the crews at its store starve (the step's `FAMINE_PRODUCTION_MUL`). */
const FAMINE_MUL = 0.5;

/**
 * Run every building's recipe against its store (`storeOf`; the game's is
 * `StoreRegistry.worksStore`). Inputs are consumed continuously; when the primary inputs run
 * short the alternative input set is tried (power plants burn oil instead of coal). A works with no
 * store does not run, and one whose store is in famine runs at half its rate. A building being
 * upgraded is skipped: it takes nothing in and makes nothing.
 */
export function tickBuildings(
  buildings: Iterable<Building>,
  storeOf: (b: Building) => ResourceStore | null,
  gameDt: number,
) {
  for (const b of buildings) {
    if (b.work) {
      b.reason = 'upgrading';
      b.active = false;
      // the estimate fades as it does over any idle tick
      b.rate *= 0.95;
      continue;
    }
    const store = storeOf(b);
    const def = buildingDef(b.id);
    const recipe = buildingRecipe(b);
    const rate = buildingRate(b) * (store?.famine ? FAMINE_MUL : 1) * rules.productionMul;
    const batches = (rate / weekSeconds()) * gameDt;
    const room = (st: ResourceStore) =>
      Object.entries(recipe.out).every(([k, v]) => st.get(k) + v <= st.cap(k) + 1e-6);
    const inputsAt = (st: ResourceStore): Cost | null =>
      st.canAfford(recipe.in) ? recipe.in : def.altIn && st.canAfford(def.altIn) ? def.altIn : null;
    // can the next batch run at all? (a store, room for the output, inputs on hand)
    const outOk = !!store && room(store);
    const running = !!store && outOk && !!inputsAt(store);
    b.reason = running ? '' : store && !outOk ? 'full' : 'inputs';
    if (running) b.acc += batches;
    while (store && b.acc >= 1) {
      const pick = inputsAt(store);
      if (!pick || !room(store)) break;
      store.spend(pick);
      for (const [k, v] of Object.entries(recipe.out)) {
        store.add(k, v);
        b.made = b.made ?? {};
        b.made[k] = (b.made[k] ?? 0) + v;
      }
      b.acc -= 1;
    }
    if (b.acc > 1) b.acc = 1;
    b.active = running;
    // smoothed batches/week estimate for the UI
    b.rate = b.rate * 0.95 + (running ? rate : 0) * 0.05;
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
