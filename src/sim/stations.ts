import { content, type StationDef, type Cost } from '../data/content';
import type { LevelStation } from '../world/level';
import { scaleCost } from './stockpile';
import { weekSeconds } from './rules';
import { Terrain, inBounds, terrainAt, type GameMap } from '../world/tiles';
import { rules } from './rules';
import { cargoDef } from './cargo';
import { MAX_LEVEL } from './levels';
import { workFromJSON, workToJSON, type Work } from './upgrade';
import { wrapRotation } from './rotation';

export type { StationDef };
export { MAX_LEVEL };
export const STATION_DEFS: StationDef[] = content.stations.defs;
/** Per-level tables, one value for each level 1..MAX_LEVEL. */
export const LEVELS = content.stations.levels;

export function stationDef(id: string): StationDef {
  const d = STATION_DEFS.find((s) => s.id === id);
  if (!d) throw new Error(`unknown station ${id}`);
  return d;
}
/**
 * Width (along x) and depth (along y) of a station turned to `rot`: the rotation's axis decides
 * it (`rotationAxis`), so `rot` and `rot + 2` give the same span.
 */
export function stationSpan(def: StationDef, rot: number): { w: number; h: number } {
  if (def.long) return rot % 2 === 0 ? { w: 2, h: 1 } : { w: 1, h: 2 };
  const n = def.size ?? 1;
  return { w: n, h: n };
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
 * 2) or north then south (rot 1 and 3); any other station every orthogonal neighbour of its
 * footprint.
 */
export function stationGates(defId: string, x: number, y: number, rot: number) {
  return gatesOf(stationDef(defId), x, y, rot);
}
function gatesOf(def: StationDef, x: number, y: number, rot: number) {
  const { w, h } = stationSpan(def, rot);
  const out: { x: number; y: number }[] = [];
  // a narrow shed is one track through, in at one end and out at the other; a wide depot two
  if (def.long || (def.depot && (def.size ?? 1) === 2)) {
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

/** A placed station. Storage is a cargo -> units map (produced goods waiting for pickup). */
/** Radius within which harvested terrain counts, and the weighted sum that means "plenty". */
export const HARVEST_RADIUS = 4;
const HARVEST_FULL = 12;
/**
 * How well a harvesting station is placed: matching tiles within the radius count with weight
 * 1/(1+distance). 1 = plenty; sparse surroundings drop towards 0.15, a dense patch reaches 1.6.
 */
export function terrainFactorAt(map: GameMap, x: number, y: number, defId: string): number {
  const want = stationDef(defId).terrain;
  if (!want) return 1;
  const match = (t: Terrain) =>
    want === 'grass'
      ? t === Terrain.Grass
      : want === 'forest'
        ? t === Terrain.Forest
        : want === 'rock'
          ? t === Terrain.Rock || t === Terrain.Hill
          : want === 'sand'
            ? t === Terrain.Sand
            : t === Terrain.Water;
  let sum = 0;
  for (let dy = -HARVEST_RADIUS; dy <= HARVEST_RADIUS; dy++)
    for (let dx = -HARVEST_RADIUS; dx <= HARVEST_RADIUS; dx++) {
      if (!dx && !dy) continue;
      if (!inBounds(map, x + dx, y + dy)) continue;
      if (!match(terrainAt(map, x + dx, y + dy))) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      sum += 1 / (1 + d);
    }
  return Math.max(0.15, Math.min(1.6, sum / HARVEST_FULL));
}

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
  /** Closed while it is upgraded: it makes nothing, takes nothing in and has no crew to feed. */
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
  get productionPerWeek() {
    const rate = LEVELS.production[this.level - 1] * rules.productionMul * this.terrainFactor;
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
  static fromJSON(j: StationJSON): Station {
    const s = new Station(j.defId, j.x, j.y, j.name, j.id);
    s.level = j.level;
    s.rot = wrapRotation(j.rot);
    s.storage = new Map(Object.entries(j.storage));
    s.market = new Map(Object.entries(j.market ?? {}));
    s.work = workFromJSON(j.work, s.level, MAX_LEVEL);
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
  static fromLevel(j: LevelStation): Station {
    const s = new Station(j.defId, j.x, j.y, j.name || undefined);
    s.level = Math.max(1, Math.min(MAX_LEVEL, j.level));
    s.rot = wrapRotation(j.rot);
    return s;
  }
}
