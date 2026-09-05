import { DIRS, DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
import { Terrain, TERRAIN_NAMES, inBounds, terrainAt, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { TrackGraph, makePiece, pieceCost, type TrackKind, type TrackPiece } from '../world/track';
import { content, type DecorDef } from '../data/content';
import { rules } from './rules';

const trackData = content.track;
import { Station, stationDef, maxLevelForTier, MAX_LEVEL } from './stations';
import type { Economy } from './economy';
import { STR } from '../strings';
import { sfx } from '../engine/audio';

export type { DecorDef };
export const DECOR_DEFS: DecorDef[] = content.decor;
export function decorDef(id: string): DecorDef {
  const d = DECOR_DEFS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown decor ${id}`);
  return d;
}
export interface Decor {
  id: string;
  x: number;
  y: number;
  rot: number;
}
/** World-pixel offset from the tile centre where a decor sprite stands (signals sit beside the rails). */
export function decorOffset(d: { id: string; rot: number }): { dx: number; dy: number } {
  if (d.id !== 'signal') return { dx: 0, dy: 0 };
  const fx = DIR_DX[d.rot] * 0.3 + DIR_DY[d.rot] * 0.24;
  const fy = DIR_DY[d.rot] * 0.3 - DIR_DX[d.rot] * 0.24;
  const p = tileToWorld(fx, fy);
  return { dx: Math.round(p.x), dy: Math.round(p.y) };
}

export interface PlacementCheck {
  ok: boolean;
  cost: number;
  reason?: string;
}

/** Placement rules, costs and refunds for track and stations. Pure game logic; no rendering. */
export class Builder {
  readonly stations: Station[] = [];
  /** editor mode: no costs, no region or tier locks */
  free = false;
  /** signals and water towers keyed by tile */
  readonly decor = new Map<number, Decor>();
  onTrackChanged: ((x: number, y: number) => void) | null = null;
  onStationChanged: ((s: Station, removed: boolean) => void) | null = null;
  onDecorChanged: ((d: Decor, removed: boolean) => void) | null = null;
  /** fired when a station loses (true) or regains (false) its last platform tile */
  onStationOrphaned: ((s: Station, orphaned: boolean) => void) | null = null;

  constructor(
    readonly map: GameMap,
    readonly regions: RegionState,
    readonly track: TrackGraph,
    readonly economy: Economy,
  ) {}

  stationAt(x: number, y: number): Station | undefined {
    return this.stations.find((s) => s.x === x && s.y === y);
  }
  stationById(id: number) {
    return this.stations.find((s) => s.id === id);
  }

  terrainMul(x: number, y: number): number {
    const t = terrainAt(this.map, x, y);
    return (trackData.terrainCost as Record<string, number>)[TERRAIN_NAMES[t]] ?? 0;
  }

  checkTrack(x: number, y: number, kind: TrackKind): PlacementCheck {
    if (!inBounds(this.map, x, y)) return { ok: false, cost: 0, reason: STR.build.offMap };
    if (!this.free && !this.regions.isTileUnlocked(x, y))
      return { ok: false, cost: 0, reason: STR.build.locked };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock) return { ok: false, cost: 0, reason: STR.build.rock };
    if (t === Terrain.Water && kind !== 'bridge')
      return { ok: false, cost: 0, reason: STR.build.needBridge };
    if (t !== Terrain.Water && kind === 'bridge')
      return { ok: false, cost: 0, reason: STR.build.bridgeOnWater };
    if (this.stationAt(x, y)) return { ok: false, cost: 0, reason: STR.build.occupied };
    const dec = this.decorAt(x, y);
    if (dec && !decorDef(dec.id).onTrack) return { ok: false, cost: 0, reason: STR.build.occupied };
    let cost = Math.round(pieceCost(kind) * this.terrainMul(x, y) * rules.buildCostMul);
    const existing = this.track.get(x, y);
    if (existing) cost = Math.max(0, cost - this.refundFor(existing));
    if (this.free) return { ok: true, cost: 0 };
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
  }

  refundFor(p: TrackPiece) {
    if (this.free) return 0;
    return Math.round(pieceCost(p.kind) * rules.buildCostMul * rules.refundRate);
  }

  placeTrack(x: number, y: number, kind: TrackKind, rot: number): boolean {
    const c = this.checkTrack(x, y, kind);
    if (!c.ok) return false;
    const existing = this.track.get(x, y);
    if (existing && existing.kind === kind && existing.rot === rot) return false;
    if (!this.economy.spend(Math.max(0, c.cost))) return false;
    this.track.set(x, y, makePiece(kind, rot));
    this.onTrackChanged?.(x, y);
    this.checkOrphans(x, y);
    sfx('build.place');
    return true;
  }

  removeTrack(x: number, y: number): boolean {
    const p = this.track.get(x, y);
    if (!p) return false;
    // a signal standing on the tile goes with it
    const dec = this.decorAt(x, y);
    if (dec && decorDef(dec.id).onTrack) this.removeDecor(x, y);
    this.track.remove(x, y);
    this.economy.earn(this.refundFor(p));
    this.onTrackChanged?.(x, y);
    this.checkOrphans(x, y);
    sfx('build.remove');
    return true;
  }

  /** Re-evaluate platform access of the stations around a changed track tile. */
  private checkOrphans(x: number, y: number) {
    for (const s of this.stations) {
      if (Math.abs(s.x - x) + Math.abs(s.y - y) !== 1) continue;
      this.onStationOrphaned?.(s, this.platformTiles(s).length === 0);
    }
  }
  isOrphaned(s: Station) {
    return this.platformTiles(s).length === 0;
  }

  // ------------------------------------------------------------------ decor
  decorAt(x: number, y: number): Decor | undefined {
    return this.decor.get(y * this.map.w + x);
  }
  checkDecor(x: number, y: number, defId: string): PlacementCheck {
    const def = decorDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: 0, reason: STR.build.offMap };
    if (!this.free && !this.regions.isTileUnlocked(x, y))
      return { ok: false, cost: 0, reason: STR.build.locked };
    if (this.decorAt(x, y)) return { ok: false, cost: 0, reason: STR.build.occupied };
    if (def.onTrack) {
      if (!this.track.has(x, y)) return { ok: false, cost: 0, reason: STR.build.needTrackHere };
    } else {
      const t = terrainAt(this.map, x, y);
      if (t === Terrain.Rock || t === Terrain.Water)
        return { ok: false, cost: 0, reason: STR.build.badTerrain };
      if (this.track.has(x, y) || this.stationAt(x, y))
        return { ok: false, cost: 0, reason: STR.build.occupied };
    }
    const cost = Math.round(def.cost * rules.buildCostMul);
    if (this.free) return { ok: true, cost: 0 };
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
  }
  placeDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    const c = this.checkDecor(x, y, defId);
    if (!c.ok || !this.economy.spend(c.cost)) return null;
    const d: Decor = { id: defId, x, y, rot: rot % decorDef(defId).rotations };
    this.decor.set(y * this.map.w + x, d);
    this.onDecorChanged?.(d, false);
    this.refreshStationBoosts();
    sfx('build.place');
    return d;
  }
  decorRefund(d: Decor) {
    if (this.free) return 0;
    return Math.round(decorDef(d.id).cost * rules.buildCostMul * rules.refundRate);
  }
  removeDecor(x: number, y: number): boolean {
    const d = this.decorAt(x, y);
    if (!d) return false;
    this.decor.delete(y * this.map.w + x);
    this.economy.earn(this.decorRefund(d));
    this.onDecorChanged?.(d, true);
    this.refreshStationBoosts();
    sfx('build.remove');
    return true;
  }
  /** Water towers within their radius speed up loading; two towers stack, more do not. */
  refreshStationBoosts() {
    for (const s of this.stations) {
      let boost = 0;
      let count = 0;
      for (const d of this.decor.values()) {
        const def = decorDef(d.id);
        if (!def.loadBoost || !def.radius) continue;
        if (Math.max(Math.abs(d.x - s.x), Math.abs(d.y - s.y)) <= def.radius && count < 2) {
          boost += def.loadBoost;
          count++;
        }
      }
      s.loadBoost = 1 + boost;
    }
  }

  hasAdjacentTrack(x: number, y: number) {
    return DIRS.some((d) => this.track.has(x + DIR_DX[d], y + DIR_DY[d]));
  }

  checkStation(x: number, y: number, defId: string): PlacementCheck {
    const def = stationDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: 0, reason: STR.build.offMap };
    if (!this.free && !this.regions.isTileUnlocked(x, y))
      return { ok: false, cost: 0, reason: STR.build.locked };
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: 0, reason: STR.build.tierLocked(def.tier) };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Water)
      return { ok: false, cost: 0, reason: STR.build.badTerrain };
    if (this.track.has(x, y) || this.stationAt(x, y) || this.decorAt(x, y))
      return { ok: false, cost: 0, reason: STR.build.occupied };
    if (!this.hasAdjacentTrack(x, y)) return { ok: false, cost: 0, reason: STR.build.needTrack };
    const cost = Math.round(def.cost * Math.max(1, this.terrainMul(x, y)) * rules.buildCostMul);
    if (this.free) return { ok: true, cost: 0 };
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
  }

  placeStation(x: number, y: number, defId: string): Station | null {
    const c = this.checkStation(x, y, defId);
    if (!c.ok || !this.economy.spend(c.cost)) return null;
    const count = this.stations.filter((s) => s.def.id === defId).length;
    const s = new Station(
      defId,
      x,
      y,
      count ? `${stationDef(defId).name} ${count + 1}` : undefined,
    );
    this.stations.push(s);
    this.refreshStationBoosts();
    this.onStationChanged?.(s, false);
    sfx('build.place');
    return s;
  }

  removeStation(s: Station): boolean {
    const i = this.stations.indexOf(s);
    if (i < 0) return false;
    this.stations.splice(i, 1);
    this.economy.earn(Math.round(s.def.cost * rules.buildCostMul * rules.refundRate));
    this.onStationChanged?.(s, true);
    return true;
  }

  canUpgrade(s: Station): PlacementCheck {
    if (s.level >= MAX_LEVEL) return { ok: false, cost: Infinity, reason: STR.station.maxed };
    if (this.free) return { ok: true, cost: 0 };
    if (s.level >= maxLevelForTier(this.economy.tier))
      return { ok: false, cost: s.upgradeCost(), reason: STR.build.levelCap };
    const cost = s.upgradeCost();
    if (this.free) return { ok: true, cost: 0 };
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
  }

  /** Editor only: lower a station's level. */
  downgradeStation(s: Station): boolean {
    if (!this.free || s.level <= 1) return false;
    s.level--;
    this.onStationChanged?.(s, false);
    return true;
  }

  upgradeStation(s: Station): boolean {
    const c = this.canUpgrade(s);
    if (!c.ok || !this.economy.spend(c.cost)) return false;
    s.level++;
    this.onStationChanged?.(s, false);
    sfx('station.upgrade');
    return true;
  }

  /** Track tiles orthogonally adjacent to a station: its platforms. */
  platformTiles(s: Station): { x: number; y: number }[] {
    return DIRS.map((d) => ({ x: s.x + DIR_DX[d], y: s.y + DIR_DY[d] })).filter((p) =>
      this.track.has(p.x, p.y),
    );
  }

  /** Station whose platform set contains this track tile (if any). */
  stationForTrackTile(x: number, y: number): Station | undefined {
    return this.stations.find((s) => Math.abs(s.x - x) + Math.abs(s.y - y) === 1);
  }
}
