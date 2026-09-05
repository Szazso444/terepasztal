import type { GameMap } from './tiles';

/** Region unlock order: index into regionsX*regionsY grid, keyed by reputation tier. */
export function regionTierMap(map: GameMap): number[] {
  // tier required for each region. Centre = 0, edge-adjacent = 1, corners = 2.
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
  isTileUnlocked(x: number, y: number) {
    const rs = this.map.regionSize;
    const i = Math.floor(y / rs) * this.map.regionsX + Math.floor(x / rs);
    return this.unlocked[i] ?? false;
  }
  regionRect(i: number) {
    const rs = this.map.regionSize;
    const rx = i % this.map.regionsX;
    const ry = Math.floor(i / this.map.regionsX);
    return { x: rx * rs, y: ry * rs, w: rs, h: rs };
  }
}
