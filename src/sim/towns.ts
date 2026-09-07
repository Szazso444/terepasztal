import type { Builder, Decor } from './build';
import { decorDef } from './build';
import type { Station } from './stations';
import { buildingDef, type Building } from './buildings';
import { rules } from './rules';
import { hash2 } from '../engine/rng';

/** Chebyshev reach of a town around its town station. */
export const TOWN_RADIUS = 7;
/** People living in one townhouse. */
export const HOUSE_RESIDENTS = 6;

export interface Town {
  id: number;
  name: string;
  stationId: number;
  /** the player typed the name */
  custom: boolean;
  /** palette index for maps and panels */
  color: number;
}
export interface TownJSON {
  id: number;
  name: string;
  stationId: number;
  custom: boolean;
  color: number;
}
export interface TownMembers {
  stations: Station[];
  buildings: Building[];
  decor: Decor[];
  houses: number;
  warehouses: number;
}

const FIRST = [
  'Kis',
  'Nagy',
  'Új',
  'Ó',
  'Al',
  'Fel',
  'Szent',
  'Vas',
  'Kő',
  'Ér',
  'Sár',
  'Fény',
  'Hév',
  'Bükk',
  'Tölgy',
  'Nyír',
  'Cser',
  'Szil',
  'Hárs',
  'Mező',
];
const LAST = [
  'falva',
  'vár',
  'hely',
  'laka',
  'háza',
  'telek',
  'kút',
  'rét',
  'halom',
  'szeg',
  'völgy',
  'patak',
  'liget',
  'fő',
  'berek',
  'domb',
  'sziget',
  'hida',
];
export const TOWN_COLORS = [
  0x5ec8dc, 0xe0a83a, 0x8fd06a, 0xd86a8a, 0xb08cf0, 0xf0d060, 0x60c0a0, 0xe8804c,
];

/**
 * Towns: one per town station. A town is "founded" once a townhouse and a warehouse stand within
 * reach; then every station inside carries the town's name. Names are generated and can be
 * changed by the player; renaming updates every prefixed station at once.
 */
export class TownRegistry {
  towns: Town[] = [];
  /** names this registry gave to stations (so a player's own name is never overwritten) */
  private assigned = new Map<number, string>();
  private nextId = 1;
  onChanged: (() => void) | null = null;

  constructor(private readonly builder: Builder) {}

  byStation(stationId: number) {
    return this.towns.find((t) => t.stationId === stationId);
  }
  byId(id: number) {
    return this.towns.find((t) => t.id === id);
  }
  station(t: Town): Station | undefined {
    return this.builder.stationById(t.stationId);
  }
  /** Town whose reach covers a tile (the nearest station when reaches overlap). */
  townAt(x: number, y: number): Town | null {
    let best: Town | null = null;
    let bd = Infinity;
    for (const t of this.towns) {
      const s = this.station(t);
      if (!s) continue;
      const d = Math.max(Math.abs(s.x - x), Math.abs(s.y - y));
      if (d <= TOWN_RADIUS && d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
  townOfStation(s: Station): Town | null {
    if (s.def.id === 'town') return this.byStation(s.id) ?? null;
    return this.townAt(s.x, s.y);
  }
  members(t: Town): TownMembers {
    const s0 = this.station(t);
    const out: TownMembers = { stations: [], buildings: [], decor: [], houses: 0, warehouses: 0 };
    if (!s0) return out;
    const inside = (x: number, y: number) =>
      Math.max(Math.abs(s0.x - x), Math.abs(s0.y - y)) <= TOWN_RADIUS &&
      this.townAt(x, y)?.id === t.id;
    for (const s of this.builder.stations) {
      if (s === s0) {
        out.stations.push(s);
        continue;
      }
      if (s.def.id === 'town' || !inside(s.x, s.y)) continue;
      out.stations.push(s);
      if (s.def.stockpile) out.warehouses++;
    }
    for (const b of this.builder.buildings.values()) if (inside(b.x, b.y)) out.buildings.push(b);
    for (const d of this.builder.decor.values())
      if (inside(d.x, d.y)) {
        out.decor.push(d);
        if (decorDef(d.id).residents) out.houses++;
      }
    return out;
  }
  /** A town is founded once it has a townhouse and a warehouse. */
  founded(t: Town) {
    const m = this.members(t);
    return m.houses > 0 && m.warehouses > 0;
  }
  /** Residents plus everyone working at the town's stations, works and services. */
  population(t: Town, m = this.members(t)) {
    let n = 0;
    for (const s of m.stations) n += s.crew;
    for (const b of m.buildings) n += buildingDef(b.id).crew;
    for (const d of m.decor) {
      const def = decorDef(d.id);
      n += def.crew + (def.residents ?? 0);
    }
    return n;
  }
  /** Goods made per day by the town's stations and works, per cargo. */
  production(t: Town, m = this.members(t)): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of m.stations) {
      const list = s.producedCargo().filter((c) => c !== 'passengers');
      for (const c of list)
        out[c] = (out[c] ?? 0) + (s.productionPerDay * s.productionMul) / list.length;
    }
    for (const b of m.buildings) {
      const def = buildingDef(b.id);
      for (const [k, v] of Object.entries(def.recipe.out)) out[k] = (out[k] ?? 0) + v * def.perDay;
    }
    return out;
  }
  /** Goods used per day: works inputs plus the wheat its people eat. */
  consumption(t: Town, m = this.members(t)): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of m.buildings) {
      const def = buildingDef(b.id);
      for (const [k, v] of Object.entries(def.recipe.in)) out[k] = (out[k] ?? 0) + v * def.perDay;
    }
    const wheat = this.population(t, m) * rules.wheatPerCrew;
    if (wheat > 0) out.wheat = (out.wheat ?? 0) + wheat;
    return out;
  }

  /** A name no other town uses, seeded by the station so it is stable. */
  generateName(seed: number): string {
    for (let k = 0; k < 64; k++) {
      const a = FIRST[Math.floor(hash2(seed, k * 7 + 1) * FIRST.length) % FIRST.length];
      const b = LAST[Math.floor(hash2(seed * 3 + 11, k * 13 + 5) * LAST.length) % LAST.length];
      const name = a + b.toLowerCase();
      if (!this.towns.some((t) => t.name === name)) return name;
    }
    return `Town ${seed}`;
  }
  /** Register a town for a freshly placed town station. */
  found(s: Station): Town {
    const have = this.byStation(s.id);
    if (have) return have;
    const t: Town = {
      id: this.nextId++,
      name: this.generateName(s.id),
      stationId: s.id,
      custom: false,
      color: (this.towns.length + s.id) % TOWN_COLORS.length,
    };
    this.towns.push(t);
    this.refresh();
    return t;
  }
  rename(t: Town, name: string) {
    const n = name.trim().slice(0, 20);
    if (!n) return;
    t.name = n;
    t.custom = true;
    this.refresh();
  }

  /**
   * Re-derive the registry from the stations: towns follow their town station, a removed station
   * dissolves its town, and every station inside a founded town is named after it.
   */
  refresh() {
    const stations = this.builder.stations;
    for (const s of stations)
      if (s.def.id === 'town' && !this.byStation(s.id)) {
        this.towns.push({
          id: this.nextId++,
          name: this.generateName(s.id),
          stationId: s.id,
          custom: false,
          color: (this.towns.length + s.id) % TOWN_COLORS.length,
        });
      }
    this.towns = this.towns.filter((t) => stations.some((s) => s.id === t.stationId));
    // names: "<town> <kind>" inside a founded town, the plain kind elsewhere
    const wanted = new Map<number, string>();
    const perTown = new Map<string, number>();
    for (const s of stations) {
      const t = this.townOfStation(s);
      const inTown = t && (s.def.id === 'town' || this.founded(t));
      const base = inTown ? `${t.name} ${s.def.name}` : s.def.name;
      const key = inTown ? `${t.id}:${s.def.id}` : `:${s.def.id}`;
      const n = (perTown.get(key) ?? 0) + 1;
      perTown.set(key, n);
      wanted.set(s.id, n > 1 ? `${base} ${n}` : base);
    }
    let changed = false;
    for (const s of stations) {
      const w = wanted.get(s.id)!;
      const mine = this.assigned.get(s.id);
      const untouched = mine === undefined ? isDefaultName(s) : s.name === mine;
      if (!untouched || s.name === w) {
        if (mine === undefined && s.name === w) this.assigned.set(s.id, w);
        continue;
      }
      s.name = w;
      this.assigned.set(s.id, w);
      changed = true;
    }
    for (const id of [...this.assigned.keys()])
      if (!stations.some((s) => s.id === id)) this.assigned.delete(id);
    if (changed) this.onChanged?.();
  }

  toJSON(): TownJSON[] {
    return this.towns.map((t) => ({ ...t }));
  }
  load(list: TownJSON[] | undefined) {
    this.towns = (list ?? []).map((t) => ({ ...t }));
    this.nextId = Math.max(1, ...this.towns.map((t) => t.id + 1));
    this.assigned.clear();
    this.refresh();
  }
}

/** Whether a station still carries the name the builder gave it ("Farm Halt", "Farm Halt 2"). */
function isDefaultName(s: Station) {
  if (s.name === s.def.name) return true;
  return s.name.startsWith(s.def.name + ' ') && /^\d+$/.test(s.name.slice(s.def.name.length + 1));
}
