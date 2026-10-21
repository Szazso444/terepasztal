import { content, type StationDef, type Cost } from '../data/content';
import type { LevelStation } from '../world/level';
import { scaleCost } from './stockpile';
import { weekSeconds } from './rules';
import { Terrain, inBounds, terrainAt, type GameMap } from '../world/tiles';
import { rules, type Rules } from './rules';
import { productionMul as seasonProductionMul, type Season } from './weather';
import { biomeAt, biomeDef } from './biomes';
import { cargoDef } from './cargo';
import { MAX_LEVEL } from './levels';
import { workFromJSON, workToJSON, type Work } from './upgrade';
import { wrapRotation } from './rotation';
import { placeSpan } from './doors';

export type { StationDef };
export { MAX_LEVEL };
export const STATION_DEFS: StationDef[] = content.stations.defs;
/** Per-level tables, one value for each level 1..MAX_LEVEL. */
export const LEVELS = content.stations.levels;

/** The definition of a station kind; a plain loop, as a placing preview asks every frame. */
export function stationDef(id: string): StationDef {
  for (let i = 0; i < STATION_DEFS.length; i++)
    if (STATION_DEFS[i].id === id) return STATION_DEFS[i];
  throw new Error(`unknown station ${id}`);
}
/**
 * Width (along x) and depth (along y) of a station turned to `rot`: its span at rotation 0
 * (`placeSpan`), swapped on the other axis (`rotationAxis`), so `rot` and `rot + 2` give the same
 * span.
 */
export function stationSpan(def: StationDef, rot: number): { w: number; h: number } {
  const { w, h } = placeSpan(def);
  return rot % 2 === 0 ? { w, h } : { w: h, h: w };
}
/** Tiles a station of this kind covers with its corner at (x, y), turned to `rot`. */
export function stationFootprint(defId: string, x: number, y: number, rot: number) {
  const { w, h } = stationSpan(stationDef(defId), rot);
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}
/**
 * Tiles where track may serve a station of this kind with its corner at (x, y), turned to `rot`:
 * a shed (a depot) has one gate at each end of every track through it, west then east (rot 0 and
 * 2) or north then south (rot 1 and 3); any other station, one of two tiles included, every
 * orthogonal neighbour of its footprint.
 */
export function stationGates(defId: string, x: number, y: number, rot: number) {
  return gatesOf(stationDef(defId), x, y, rot);
}
function gatesOf(def: StationDef, x: number, y: number, rot: number) {
  const { w, h } = stationSpan(def, rot);
  const out: { x: number; y: number }[] = [];
  // a narrow shed is one track through, in at one end and out at the other; a wide depot two. The
  // shed rule is the depot's, not the footprint's: a station of two tiles is served from all sides
  if (def.depot && (def.long || (def.size ?? 1) === 2)) {
    if (rot % 2 === 0) {
      for (let dy = 0; dy < h; dy++) out.push({ x: x - 1, y: y + dy });
      for (let dy = 0; dy < h; dy++) out.push({ x: x + w, y: y + dy });
    } else {
      for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y - 1 });
      for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + h });
    }
    return out;
  }
  const covers = (tx: number, ty: number) => tx >= x && ty >= y && tx < x + w && ty < y + h;
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!covers(nx, ny) && !out.some((o) => o.x === nx && o.y === ny))
          out.push({ x: nx, y: ny });
      }
  return out;
}
export interface StationJSON {
  id: number;
  defId: string;
  name: string;
  x: number;
  y: number;
  level: number;
  storage: Record<string, number>;
  market?: Record<string, number>;
  /**
   * v7: orientation of multi-tile stations (depot gates: 0 = west/east, 1 = north/south); v16:
   * one of the four rotations, 0 to 3, whose axis is that orientation (`rotationAxis`)
   */
  rot?: number;
  /** v15: the upgrade under way, null for none */
  work?: Work | null;
}

let nextId = 1;
export function resetStationIds(v = 1) {
  nextId = v;
}

/**
 * A level a save or a level file holds, as a level a station has: a number rounded down and kept
 * within 1 to MAX_LEVEL, and 1 for NaN and for anything that is no number, so the per-level tables
 * (`LEVELS`) always have an entry for it.
 */
function wholeLevel(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(v)));
}

/** Radius within which harvested terrain counts, and the weighted sum that means "plenty". */
export const HARVEST_RADIUS = 4;
export const HARVEST_FULL = 12;
/** The ground factor's floor (a bare site) and ceiling (a dense patch). */
export const HARVEST_FLOOR = 0.15;
export const HARVEST_CEIL = 1.6;
/** Most tiles a harvest counts: every tile within the radius but the station's own. */
export const HARVEST_CELLS_MAX = (2 * HARVEST_RADIUS + 1) ** 2 - 1;

/** The kind of ground a harvesting station counts. */
export type HarvestTerrain = NonNullable<StationDef['terrain']>;

/**
 * The tiles a harvest counted, in the order it counted them (rows north to south, each west to
 * east): tile `i < count` is (x[i], y[i]), at Chebyshev distance d[i] from the station, and adds
 * weight[i] = 1 / (1 + d[i]). Entries from `count` on are left over from earlier use. A breakdown
 * given one overwrites it, so a caller that asks every frame keeps one and allocates nothing for
 * the tiles.
 */
export class HarvestCells {
  count = 0;
  readonly x = new Int32Array(HARVEST_CELLS_MAX);
  readonly y = new Int32Array(HARVEST_CELLS_MAX);
  readonly d = new Uint8Array(HARVEST_CELLS_MAX);
  readonly weight = new Float64Array(HARVEST_CELLS_MAX);
}

/** The matching tiles at one distance: `n` of them, adding `contribution` = n / (1 + d). */
export interface HarvestRing {
  d: number;
  n: number;
  contribution: number;
}

/**
 * What a harvesting station of a level makes a week on a tile, and why. The rings are the raw
 * weighted sum split by distance, so they add up to `sum` (bar float rounding), not to `factor`.
 */
export interface HarvestBreakdown {
  defId: string;
  terrain: HarvestTerrain;
  /** the level the yield is for, whole and within 1 to MAX_LEVEL */
  level: number;
  /** every tile counted, with its distance and weight */
  cells: HarvestCells;
  /** one row per distance, 1 to HARVEST_RADIUS, nearest first */
  rings: HarvestRing[];
  /** the weighted sum of the counted tiles, added in `cells` order */
  sum: number;
  /** sum / HARVEST_FULL */
  raw: number;
  /** raw kept within HARVEST_FLOOR and HARVEST_CEIL: the station's `terrainFactor` */
  factor: number;
  /** which bound `factor` was held at, null when raw lies within them */
  clamped: 'floor' | 'ceil' | null;
  /** the biome of the station's own tile (`BiomeDef.id`), and its multiplier for this kind */
  biome: string;
  biomeMul: number;
  season: Season;
  seasonMul: number;
  /** the tuning's `productionMul` */
  rulesMul: number;
  /** the level's production before any multiplier (`LEVELS.production`) */
  base: number;
  /**
   * units a week: base × rulesMul × factor × seasonMul × biomeMul, grouped as a placed station
   * multiplies them (`productionPerWeek` × `productionMul`), so the two agree to the last bit
   */
  perWeek: number;
}

/** Whether ground of terrain `t` counts for a station that harvests `want`. */
function harvests(want: HarvestTerrain, t: Terrain): boolean {
  switch (want) {
    case 'grass':
      return t === Terrain.Grass;
    case 'forest':
      return t === Terrain.Forest;
    case 'rock':
      return t === Terrain.Rock || t === Terrain.Hill;
    case 'sand':
      return t === Terrain.Sand;
    default:
      return t === Terrain.Water;
  }
}

/**
 * Units a week a station of `level` makes on ground of `factor` under the tuning, before the
 * season and biome multiplier (`Station.productionMul`): what `Station.productionPerWeek` and a
 * harvest breakdown both read, so the number shown is the number produced.
 */
export function weeklyOutput(
  level: number,
  factor: number,
  tuning: Pick<Rules, 'productionMul'> = rules,
): number {
  return LEVELS.production[level - 1] * tuning.productionMul * factor;
}

/**
 * Why a harvesting station of `defId` at `level` on (x, y) makes what it does, in `season` and
 * under `tuning`: matching tiles within HARVEST_RADIUS each add 1 / (1 + distance), the sum over
 * HARVEST_FULL is held within HARVEST_FLOOR and HARVEST_CEIL, and the yield multiplies that factor
 * with the level's base, the tuning, the season and the biome of the station's own tile. Null for
 * a station that harvests nothing. Whether a station may stand there is not asked, so a preview
 * can show the yield of a tile it cannot be placed on. The counted tiles go into `cells`, which is
 * overwritten (emptied for a null), so a caller that asks every frame passes the same one.
 */
export function harvestBreakdown(
  map: GameMap,
  x: number,
  y: number,
  defId: string,
  level: number,
  season: Season,
  tuning: Pick<Rules, 'productionMul'> = rules,
  cells: HarvestCells = new HarvestCells(),
): HarvestBreakdown | null {
  cells.count = 0;
  const want = stationDef(defId).terrain;
  if (!want) return null;
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let n4 = 0;
  let sum = 0;
  // dy outer, dx inner, adding as it goes: the float sum every placed station's factor came from
  for (let dy = -HARVEST_RADIUS; dy <= HARVEST_RADIUS; dy++)
    for (let dx = -HARVEST_RADIUS; dx <= HARVEST_RADIUS; dx++) {
      if (!dx && !dy) continue;
      if (!inBounds(map, x + dx, y + dy)) continue;
      if (!harvests(want, terrainAt(map, x + dx, y + dy))) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const w = 1 / (1 + d);
      sum += w;
      const i = cells.count++;
      cells.x[i] = x + dx;
      cells.y[i] = y + dy;
      cells.d[i] = d;
      cells.weight[i] = w;
      if (d === 1) n1++;
      else if (d === 2) n2++;
      else if (d === 3) n3++;
      else n4++;
    }
  const raw = sum / HARVEST_FULL;
  const factor = Math.max(HARVEST_FLOOR, Math.min(HARVEST_CEIL, raw));
  const whole = wholeLevel(level);
  const biome = biomeDef(biomeAt(map, x, y));
  const biomeMul = biome.production[defId] ?? 1;
  const seasonMul = seasonProductionMul(defId, season);
  return {
    defId,
    terrain: want,
    level: whole,
    cells,
    rings: [
      { d: 1, n: n1, contribution: n1 / 2 },
      { d: 2, n: n2, contribution: n2 / 3 },
      { d: 3, n: n3, contribution: n3 / 4 },
      { d: 4, n: n4, contribution: n4 / 5 },
    ],
    sum,
    raw,
    factor,
    clamped: raw < HARVEST_FLOOR ? 'floor' : raw > HARVEST_CEIL ? 'ceil' : null,
    biome: biome.id,
    biomeMul,
    season,
    seasonMul,
    rulesMul: tuning.productionMul,
    base: LEVELS.production[whole - 1],
    // grouped as the station multiplies them: productionPerWeek × (season × biome)
    perWeek: weeklyOutput(whole, factor, tuning) * (seasonMul * biomeMul),
  };
}

/** Shared by terrainFactorAt, which reads the factor alone. */
const FACTOR_CELLS = new HarvestCells();
/**
 * How well a harvesting station is placed (`harvestBreakdown`'s factor): 1 = plenty; sparse
 * surroundings drop towards 0.15, a dense patch reaches 1.6. 1 for a station that harvests nothing.
 */
export function terrainFactorAt(map: GameMap, x: number, y: number, defId: string): number {
  return harvestBreakdown(map, x, y, defId, 1, 'spring', rules, FACTOR_CELLS)?.factor ?? 1;
}

/** A placed station. Storage is a cargo -> units map (produced goods waiting for pickup). */
export class Station {
  readonly id: number;
  readonly def: StationDef;
  name: string;
  level = 1;
  storage = new Map<string, number>();
  /** trains currently occupying a platform */
  occupants = new Set<number>();
  /** spot-market satiety per accepted cargo (0 = hungry, 1 = glutted) */
  market = new Map<string, number>();
  /** loading-rate multiplier from nearby water towers */
  loadBoost = 1;
  /** production multiplier from the season */
  productionMul = 1;
  /** a water tower stands within reach (steam engines refill water) */
  waterSupply = false;
  /** Residents within the passenger catchment, updated by the game. */
  passengerPopulation = 0;
  /** a coaling stage stands within reach (engines refuel from the stockpile) */
  fuelSupply = false;
  /** the upgrade under way (`Builder.upgradeStation`); null when none is */
  work: Work | null = null;
  /**
   * Closed while it is upgraded: it makes nothing (`productionPerWeek` is 0), takes nothing in and
   * has no crew to feed, and nobody lives or gathers at it (`PeopleSim.places`). Trains still stop
   * and load what it holds, but do not wait there for output that will not come.
   */
  get closed() {
    return !!this.work;
  }
  get crew() {
    return this.closed ? 0 : LEVELS.crew[this.level - 1];
  }
  /** the age the station appears in: its levels open one per age from there (`levelCap`) */
  get firstAge() {
    return this.def.tier ?? 0;
  }
  get refuelsFuel() {
    return !!this.def.fuel || this.fuelSupply;
  }
  get refuelsWater() {
    return !!this.def.water || this.waterSupply || this.producedCargo().includes('water');
  }
  /**
   * The rotation it was placed in, 0 to 3 (`BUILDING_ROTATIONS`, front facing S, W, N or E). The
   * footprint and gates follow its axis alone (depot: 0 and 2 gates west and east, 1 and 3 north
   * and south).
   */
  rot = 0;
  constructor(
    defId: string,
    public x: number,
    public y: number,
    name?: string,
    id?: number,
  ) {
    this.def = stationDef(defId);
    this.id = id ?? nextId++;
    if (id !== undefined) nextId = Math.max(nextId, id + 1);
    this.name = name ?? this.def.name;
  }
  /** footprint side in tiles */
  get size() {
    return this.def.size ?? 1;
  }
  /** footprint width along x */
  get w() {
    return stationSpan(this.def, this.rot).w;
  }
  /** footprint depth along y */
  get h() {
    return stationSpan(this.def, this.rot).h;
  }
  /** every tile the station stands on (x, y is the top-left corner) */
  footprint(): { x: number; y: number }[] {
    return stationFootprint(this.def.id, this.x, this.y, this.rot);
  }
  covers(x: number, y: number) {
    return x >= this.x && y >= this.y && x < this.x + this.w && y < this.y + this.h;
  }
  /** centre of the footprint in tile units */
  get cx() {
    return this.x + (this.w - 1) / 2;
  }
  get cy() {
    return this.y + (this.h - 1) / 2;
  }
  /** Tiles where track may serve the station (`stationGates`). */
  gateTiles(): { x: number; y: number }[] {
    return gatesOf(this.def, this.x, this.y, this.rot);
  }
  /** Chebyshev distance from the footprint to a tile. */
  distTo(x: number, y: number) {
    const dx = Math.max(this.x - x, 0, x - (this.x + this.w - 1));
    const dy = Math.max(this.y - y, 0, y - (this.y + this.h - 1));
    return Math.max(dx, dy);
  }
  /** Storage: produced goods for pickup; a warehouse holds whatever trains bring, per level. */
  get capacity() {
    if (this.def.stockpile) return Math.round(rules.warehouseCap * this.level);
    return Math.round(LEVELS.capacity[this.level - 1] * rules.capacityMul);
  }
  get loadRate() {
    return LEVELS.loadRate[this.level - 1];
  }
  get platforms() {
    if (this.def.depot) return this.def.long ? 1 : 2;
    return LEVELS.platforms[this.level - 1];
  }
  /** Goods trains may take from here: what it makes, plus a warehouse's stored kinds. */
  availableCargo(): string[] {
    const out = this.producedCargo();
    if (this.def.stockpile)
      for (const [c, v] of this.storage) if (v >= 1 && !out.includes(c)) out.push(c);
    return out;
  }
  /** Room a warehouse has for more goods: none while it is closed. */
  get room() {
    if (this.closed) return 0;
    return Math.max(0, this.capacity - this.totalStored());
  }
  /** Put goods into a warehouse's store; returns what fitted (nothing while it is closed). */
  store(cargo: string, amount: number): number {
    const n = Math.max(0, Math.min(amount, this.room));
    if (n > 0) this.storage.set(cargo, this.stored(cargo) + n);
    return n;
  }
  /** nearby-resource multiplier, set when placed and after terrain edits */
  terrainFactor = 1;
  /**
   * Units made a week at this level, under the rules and on this ground, a passenger station's
   * capped by the people around it; none while it is closed.
   */
  get productionPerWeek() {
    if (this.closed) return 0;
    const rate = weeklyOutput(this.level, this.terrainFactor);
    return this.def.id === 'station' ? Math.min(rate, this.passengerPopulation * 0.4) : rate;
  }
  /** Picture of the level (`spriteByLevel`): levels above the highest picture repeat it. */
  get spriteLevel() {
    return LEVELS.spriteByLevel[this.level - 1];
  }
  producedCargo(): string[] {
    return this.def.produces.filter((p) => p.level <= this.level).map((p) => p.cargo);
  }
  /** Cargo the next level would add, if any. */
  nextLevelUnlocks(): string[] {
    return this.def.produces.filter((p) => p.level === this.level + 1).map((p) => p.cargo);
  }
  /** Whether a delivery of the cargo is taken here: never while the station is closed. */
  accepts(cargo: string) {
    return !this.closed && this.def.accepts.includes(cargo);
  }
  upgradeCost(): Cost {
    if (this.level >= MAX_LEVEL) return {};
    return scaleCost(this.def.cost, LEVELS.upgradeCostMul[this.level] * rules.buildCostMul);
  }
  stored(cargo: string) {
    return this.storage.get(cargo) ?? 0;
  }
  totalStored() {
    let t = 0;
    for (const v of this.storage.values()) t += v;
    return t;
  }
  /** Take up to `amount` units of cargo out of storage; returns what was taken. */
  take(cargo: string, amount: number): number {
    const have = this.stored(cargo);
    const n = Math.max(0, Math.min(have, amount));
    if (n <= 0) return 0;
    if (have - n < 1e-9) this.storage.delete(cargo);
    else this.storage.set(cargo, have - n);
    return n;
  }
  hasFreePlatform() {
    return this.occupants.size < this.platforms;
  }
  /** Current spot price per unit for cargo delivered here without a contract. */
  marketPrice(cargo: string, distance: number) {
    const sat = this.satiety(cargo);
    return (
      cargoDef(cargo).price *
      rules.spotPriceMul *
      (0.55 + 0.75 * (1 - sat)) *
      (1 + Math.min(1, distance / 120))
    );
  }
  satiety(cargo: string) {
    return this.market.get(cargo) ?? 0;
  }
  /** Register a spot-market delivery: demand drops and recovers over about a day. */
  absorb(cargo: string, amount: number) {
    this.market.set(cargo, Math.min(1, this.satiety(cargo) + amount / (this.capacity * 1.5)));
  }
  /**
   * Produce goods over in-game seconds, nothing while closed; storage is shared across produced
   * cargo types. The market's demand recovers either way.
   */
  tick(gameDt: number) {
    const decay = Math.exp(-gameDt / weekSeconds());
    for (const [c, v] of this.market) this.market.set(c, v * decay);
    if (this.closed) return;
    const produced = this.producedCargo();
    if (!produced.length) return;
    const perType =
      ((this.productionPerWeek * this.productionMul) / weekSeconds() / produced.length) * gameDt;
    for (const c of produced) {
      if (this.totalStored() >= this.capacity) break;
      const room = this.capacity - this.totalStored();
      this.storage.set(c, this.stored(c) + Math.min(room, perType));
    }
  }
  toJSON(): StationJSON {
    return {
      id: this.id,
      defId: this.def.id,
      name: this.name,
      x: this.x,
      y: this.y,
      level: this.level,
      storage: Object.fromEntries(this.storage),
      market: Object.fromEntries(this.market),
      rot: this.rot,
      work: workToJSON(this.work),
    };
  }
  /**
   * The station a save holds, at a whole level (`wholeLevel`) and one of the four turns
   * (`wrapRotation`). Its upgrade under way is kept when it is a work towards the next level; a
   * depot's never is, as a depot's upgrade takes no time (`Builder.upgradeStation`), so a depot
   * always loads open.
   */
  static fromJSON(j: StationJSON): Station {
    const s = new Station(j.defId, j.x, j.y, j.name, j.id);
    s.level = wholeLevel(j.level);
    s.rot = wrapRotation(j.rot);
    s.storage = new Map(Object.entries(j.storage));
    s.market = new Map(Object.entries(j.market ?? {}));
    s.work = s.def.depot ? null : workFromJSON(j.work, s.level, MAX_LEVEL);
    return s;
  }
  /** The station as a level file holds it: what it is, where, its level, name and turn. */
  toLevel(): LevelStation {
    return {
      defId: this.def.id,
      x: this.x,
      y: this.y,
      level: this.level,
      name: this.name,
      ...(this.rot ? { rot: this.rot } : {}),
    };
  }
  /** The station a level file holds, at a whole level (`wholeLevel`) and one of the four turns. */
  static fromLevel(j: LevelStation): Station {
    const s = new Station(j.defId, j.x, j.y, j.name || undefined);
    s.level = wholeLevel(j.level);
    s.rot = wrapRotation(j.rot);
    return s;
  }
}
