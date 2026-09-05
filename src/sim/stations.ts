import stationData from '../data/stations.json';
import { DAY_SECONDS } from './time';

export interface StationDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  tier: number;
  produces: { cargo: string; level: number }[];
  accepts: string[];
}
export const STATION_DEFS: StationDef[] = stationData.defs;
const LEVELS = stationData.levels;
export const MAX_LEVEL = 5;

export function stationDef(id: string): StationDef {
  const d = STATION_DEFS.find((s) => s.id === id);
  if (!d) throw new Error(`unknown station ${id}`);
  return d;
}
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
}

let nextId = 1;
export function resetStationIds(v = 1) {
  nextId = v;
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
  get capacity() {
    return LEVELS.capacity[this.level - 1];
  }
  get loadRate() {
    return LEVELS.loadRate[this.level - 1];
  }
  get platforms() {
    return LEVELS.platforms[this.level - 1];
  }
  get productionPerDay() {
    return LEVELS.production[this.level - 1];
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
  upgradeCost(): number {
    if (this.level >= MAX_LEVEL) return Infinity;
    return Math.round(this.def.cost * LEVELS.upgradeCostMul[this.level]);
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
    const n = Math.min(have, amount);
    this.storage.set(cargo, have - n);
    return n;
  }
  hasFreePlatform() {
    return this.occupants.size < this.platforms;
  }
  /** Produce goods over in-game seconds. Storage is shared across produced cargo types. */
  tick(gameDt: number) {
    const produced = this.producedCargo();
    if (!produced.length) return;
    const perType = (this.productionPerDay / DAY_SECONDS / produced.length) * gameDt;
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
    };
  }
  static fromJSON(j: StationJSON): Station {
    const s = new Station(j.defId, j.x, j.y, j.name, j.id);
    s.level = j.level;
    s.storage = new Map(Object.entries(j.storage));
    return s;
  }
}
