import type { GameMap } from './tiles';
import { rules } from '../sim/rules';

/** Manhattan ring of each chunk around the starting chunk (centre = 0). */
export function regionTierMap(map: GameMap): number[] {
  const out: number[] = [];
  const cx = (map.regionsX - 1) / 2;
  const cy = (map.regionsY - 1) / 2;
  for (let ry = 0; ry < map.regionsY; ry++)
    for (let rx = 0; rx < map.regionsX; rx++) {
      const d = Math.abs(rx - cx) + Math.abs(ry - cy);
      out.push(Math.round(d));
    }
  return out;
}

/**
 * Chunk ownership. The player starts with the centre chunk and buys neighbours; a chunk is
 * *revealed* (drawn as Uncharted, purchasable) when it touches an owned one, and hidden
 * otherwise. `tiers` holds each chunk's ring distance from the start, which drives the price.
 */
export class RegionState {
  readonly tiers: number[];
  unlocked: boolean[];
  constructor(
    readonly map: GameMap,
    currentTier = 0,
  ) {
    this.tiers = regionTierMap(map);
    this.unlocked = this.tiers.map((t) => t <= currentTier);
  }
  /** Own every chunk within `tier` rings of the start (levels, editor, legacy saves). */
  applyTier(tier: number): number[] {
    const newly: number[] = [];
    this.tiers.forEach((t, i) => {
      if (t <= tier && !this.unlocked[i]) {
        this.unlocked[i] = true;
        newly.push(i);
      }
    });
    return newly;
  }
  own(i: number) {
    if (this.unlocked[i]) return false;
    this.unlocked[i] = true;
    return true;
  }
  regionIndex(x: number, y: number) {
    const rs = this.map.regionSize;
    return Math.floor(y / rs) * this.map.regionsX + Math.floor(x / rs);
  }
  isTileUnlocked(x: number, y: number) {
    return this.unlocked[this.regionIndex(x, y)] ?? false;
  }
  isTileRevealed(x: number, y: number) {
    return this.isRevealed(this.regionIndex(x, y));
  }
  /** Owned, or edge-adjacent to an owned chunk. */
  isRevealed(i: number) {
    if (this.unlocked[i]) return true;
    return this.neighbours(i).some((n) => this.unlocked[n]);
  }
  neighbours(i: number): number[] {
    const rx = i % this.map.regionsX;
    const ry = Math.floor(i / this.map.regionsX);
    const out: number[] = [];
    if (rx > 0) out.push(i - 1);
    if (rx < this.map.regionsX - 1) out.push(i + 1);
    if (ry > 0) out.push(i - this.map.regionsX);
    if (ry < this.map.regionsY - 1) out.push(i + this.map.regionsX);
    return out;
  }
  /** Price of a chunk: first ring costs `chunkCost`, each further ring multiplies it. */
  price(i: number) {
    const ring = Math.max(1, this.tiers[i]);
    return Math.round(rules.chunkCost * Math.pow(rules.chunkCostMul, ring - 1));
  }
  /** Bounding rectangle (tiles) of every revealed chunk. */
  revealedBounds() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.unlocked.length; i++) {
      if (!this.isRevealed(i)) continue;
      const r = this.regionRect(i);
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    if (x0 === Infinity) return { x: 0, y: 0, w: this.map.w, h: this.map.h };
    return { x: x0, y: y0, w: Math.min(this.map.w, x1) - x0, h: Math.min(this.map.h, y1) - y0 };
  }
  regionRect(i: number) {
    const rs = this.map.regionSize;
    const rx = i % this.map.regionsX;
    const ry = Math.floor(i / this.map.regionsX);
    return { x: rx * rs, y: ry * rs, w: rs, h: rs };
  }
  toJSON() {
    return [...this.unlocked];
  }
  load(owned: boolean[]) {
    if (owned.length === this.unlocked.length) this.unlocked = [...owned];
  }
}
