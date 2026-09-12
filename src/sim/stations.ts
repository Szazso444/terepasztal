import { content, type StationDef, type Cost } from '../data/content';
import { scaleCost } from './stockpile';
import { daySeconds } from './rules';
import { Terrain, inBounds, terrainAt, type GameMap } from '../world/tiles';
import { rules } from './rules';
import { cargoDef } from './cargo';

export type { StationDef };
export const STATION_DEFS: StationDef[] = content.stations.defs;
export const LEVELS = content.stations.levels;
export const MAX_LEVEL = 5;

export function stationDef(id: string): StationDef {
  const d = STATION_DEFS.find((s) => s.id === id);
  if (!d) throw new Error(`unknown station ${id}`);
  return d;
}
/** Station level cap in an age (`maxLevelByTier` is indexed by age: steam, diesel, electric). */
export function maxLevelForTier(tier: number) {
  return LEVELS.maxLevelByTier[Math.min(tier, LEVELS.maxLevelByTier.length - 1)];
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
  /** v7: orientation of multi-tile stations (depot gates: 0 = west/east, 1 = north/south) */
  rot?: number;
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
  /** a coaling stage stands within reach (engines refuel from the stockpile) */
  fuelSupply = false;
  get crew() {
    return LEVELS.crew[this.level - 1];
  }
  get refuelsFuel() {
    return !!this.def.fuel || this.fuelSupply;
  }
  get refuelsWater() {
    return !!this.def.water || this.waterSupply || this.producedCargo().includes('water');
  }
  /** orientation of a multi-tile station (depot: 0 = gates west and east, 1 = north and south) */
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
  /** every tile the station stands on (x, y is the top-left corner) */
  footprint(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let dy = 0; dy < this.size; dy++)
      for (let dx = 0; dx < this.size; dx++) out.push({ x: this.x + dx, y: this.y + dy });
    return out;
  }
  covers(x: number, y: number) {
    return x >= this.x && y >= this.y && x < this.x + this.size && y < this.y + this.size;
  }
  /** centre of the footprint in tile units */
  get cx() {
    return this.x + (this.size - 1) / 2;
  }
  get cy() {
    return this.y + (this.size - 1) / 2;
  }
  /**
   * Tiles where track may serve the station: every orthogonal neighbour of a one-tile station;
   * a depot only has its four gates, two on each of the sides its orientation selects.
   */
  gateTiles(): { x: number; y: number }[] {
    if (this.def.depot && this.size === 2) {
      return this.rot % 2 === 0
        ? [
            { x: this.x - 1, y: this.y },
            { x: this.x - 1, y: this.y + 1 },
            { x: this.x + 2, y: this.y },
            { x: this.x + 2, y: this.y + 1 },
          ]
        : [
            { x: this.x, y: this.y - 1 },
            { x: this.x + 1, y: this.y - 1 },
            { x: this.x, y: this.y + 2 },
            { x: this.x + 1, y: this.y + 2 },
          ];
    }
    const out: { x: number; y: number }[] = [];
    for (const t of this.footprint()) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = t.x + dx;
        const ny = t.y + dy;
        if (!this.covers(nx, ny) && !out.some((o) => o.x === nx && o.y === ny))
          out.push({ x: nx, y: ny });
      }
    }
    return out;
  }
  /** Chebyshev distance from the footprint to a tile. */
  distTo(x: number, y: number) {
    const dx = Math.max(this.x - x, 0, x - (this.x + this.size - 1));
    const dy = Math.max(this.y - y, 0, y - (this.y + this.size - 1));
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
    if (this.def.depot) return 2;
    return LEVELS.platforms[this.level - 1];
  }
  /** Goods trains may take from here: what it makes, plus a warehouse's stored kinds. */
  availableCargo(): string[] {
    const out = this.producedCargo();
    if (this.def.stockpile)
      for (const [c, v] of this.storage) if (v >= 1 && !out.includes(c)) out.push(c);
    return out;
  }
  /** Room a warehouse has for more goods. */
  get room() {
    return Math.max(0, this.capacity - this.totalStored());
  }
  /** Put goods into a warehouse's store; returns what fitted. */
  store(cargo: string, amount: number): number {
    const n = Math.max(0, Math.min(amount, this.room));
    if (n > 0) this.storage.set(cargo, this.stored(cargo) + n);
    return n;
  }
  /** nearby-resource multiplier, set when placed and after terrain edits */
  terrainFactor = 1;
  get productionPerDay() {
    return LEVELS.production[this.level - 1] * rules.productionMul * this.terrainFactor;
  }
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
  accepts(cargo: string) {
    return this.def.accepts.includes(cargo);
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
  /** Produce goods over in-game seconds. Storage is shared across produced cargo types. */
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
  tick(gameDt: number) {
    const decay = Math.exp(-gameDt / daySeconds());
    for (const [c, v] of this.market) this.market.set(c, v * decay);
    const produced = this.producedCargo();
    if (!produced.length) return;
    const perType =
      ((this.productionPerDay * this.productionMul) / daySeconds() / produced.length) * gameDt;
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
    };
  }
  static fromJSON(j: StationJSON): Station {
    const s = new Station(j.defId, j.x, j.y, j.name, j.id);
    s.level = j.level;
    s.rot = j.rot ?? 0;
    s.storage = new Map(Object.entries(j.storage));
    s.market = new Map(Object.entries(j.market ?? {}));
    return s;
  }
}
