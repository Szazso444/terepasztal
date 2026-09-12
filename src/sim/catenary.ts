/**
 * Electrification overlay (spec §7, R12). Track tiles carry a supply kind; a tile is live when it
 * lies within the radius of a substation that the pole grid powers. Substations have a
 * throughput: when the trains under one draw more than it delivers, every train under it slows in
 * proportion. Electric locomotives need live supply of a kind their collector can use under the
 * head tile; the battery cap stays as the buffer that lets one leave the wire briefly.
 */
import type { GameMap } from '../world/tiles';
import type { Cost, Collector } from '../data/content';
import type { Building } from './buildings';
import { buildingDef } from './buildings';
import type { PowerGrid } from './power';

export type SupplyKind = 'third_rail' | 'catenary' | 'hv_catenary';
export const SUPPLY_KINDS: SupplyKind[] = ['third_rail', 'catenary', 'hv_catenary'];
export interface SupplyDef {
  kind: SupplyKind;
  cost: Cost;
  /** speed ceiling for stock drawing from it, tiles per second */
  ceiling: number;
  /** age required */
  tier: number;
}
export const SUPPLY_DEFS: Record<SupplyKind, SupplyDef> = {
  third_rail: { kind: 'third_rail', cost: { iron: 2 }, ceiling: 1.2, tier: 2 },
  catenary: { kind: 'catenary', cost: { iron: 2, wood: 1 }, ceiling: 1.9, tier: 2 },
  hv_catenary: { kind: 'hv_catenary', cost: { iron: 3, wood: 1 }, ceiling: Infinity, tier: 2 },
};

/**
 * Can a collector draw from a supply, and at what ceiling? A high-speed pantograph runs under
 * plain catenary at the plain ceiling; a plain pantograph gets nothing from HV wire unless the
 * unit is multi-system.
 */
export function collectorCeiling(
  collector: Collector | undefined,
  supply: SupplyKind,
): number | null {
  const c = collector ?? 'pantograph';
  switch (c) {
    case 'shoe':
      return supply === 'third_rail' ? SUPPLY_DEFS.third_rail.ceiling : null;
    case 'pantograph':
      return supply === 'catenary' ? SUPPLY_DEFS.catenary.ceiling : null;
    case 'hv':
      return supply === 'catenary' || supply === 'hv_catenary' ? SUPPLY_DEFS[supply].ceiling : null;
    case 'multi':
      return SUPPLY_DEFS[supply].ceiling;
  }
}

export interface Substation {
  x: number;
  y: number;
  radius: number;
  /** power units per second it can pass */
  throughput: number;
  /** on a live part of the pole grid */
  powered: boolean;
  /** units per second drawn by trains under it in the last tick */
  load: number;
  private_acc: number;
}

export class Catenary {
  /** tile key -> supply kind */
  readonly tiles = new Map<number, SupplyKind>();
  version = 0;
  private live: Uint8Array;
  /** substation index per tile, -1 when none */
  private owner: Int16Array;
  substations: Substation[] = [];
  /** no substation anywhere: pole-powered rails count as live (older saves keep running) */
  legacy = false;
  private legacyPowered: ((x: number, y: number) => boolean) | null = null;
  constructor(readonly map: GameMap) {
    this.live = new Uint8Array(map.w * map.h);
    this.owner = new Int16Array(map.w * map.h).fill(-1);
  }
  key(x: number, y: number) {
    return y * this.map.w + x;
  }
  supplyAt(x: number, y: number): SupplyKind | null {
    return this.tiles.get(this.key(x, y)) ?? null;
  }
  set(x: number, y: number, kind: SupplyKind) {
    this.tiles.set(this.key(x, y), kind);
    this.version++;
  }
  remove(x: number, y: number) {
    if (this.tiles.delete(this.key(x, y))) this.version++;
  }
  /** Recompute which tiles are live from the substations and the pole grid. */
  rebuild(buildings: Iterable<Building>, power: PowerGrid) {
    this.live.fill(0);
    this.owner.fill(-1);
    this.substations = [];
    for (const b of buildings) {
      const def = buildingDef(b.id);
      if (!def.substation) continue;
      this.substations.push({
        x: b.x,
        y: b.y,
        radius: def.substation.radius,
        throughput: def.substation.throughput,
        powered: power.isPowered(b.x, b.y),
        load: 0,
        private_acc: 0,
      });
    }
    this.legacy = this.substations.length === 0;
    this.legacyPowered = (x, y) => power.isPowered(x, y);
    this.substations.forEach((s, i) => {
      if (!s.powered) return;
      for (let dy = -s.radius; dy <= s.radius; dy++)
        for (let dx = -s.radius; dx <= s.radius; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) continue;
          const k = this.key(x, y);
          if (!this.tiles.has(k)) continue;
          this.live[k] = 1;
          if (this.owner[k] < 0) this.owner[k] = i;
        }
    });
  }
  isLive(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
    const k = this.key(x, y);
    if (this.live[k]) return true;
    return this.legacy && this.tiles.has(k) && !!this.legacyPowered?.(x, y);
  }
  substationAt(x: number, y: number): Substation | null {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
    const i = this.owner[this.key(x, y)];
    return i >= 0 ? this.substations[i] : null;
  }
  /** Trains report what they draw each tick; the factor is what the substation can deliver of it. */
  beginTick() {
    for (const s of this.substations) {
      s.load = s.private_acc;
      s.private_acc = 0;
    }
  }
  addDraw(x: number, y: number, unitsPerSecond: number) {
    const s = this.substationAt(x, y);
    if (s) s.private_acc += unitsPerSecond;
  }
  /** 1 while the substation copes; below 1 everyone under it slows together. */
  loadFactor(x: number, y: number) {
    const s = this.substationAt(x, y);
    if (!s || s.load <= s.throughput) return 1;
    return Math.max(0.25, s.throughput / s.load);
  }
  *entries(): IterableIterator<{ x: number; y: number; kind: SupplyKind }> {
    for (const [k, kind] of this.tiles)
      yield { x: k % this.map.w, y: Math.floor(k / this.map.w), kind };
  }
  toJSON(): [number, number, SupplyKind][] {
    return [...this.entries()].map((e) => [e.x, e.y, e.kind]);
  }
}
