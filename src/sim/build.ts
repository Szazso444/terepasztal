import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import { Terrain, TERRAIN_NAMES, inBounds, terrainAt, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { TrackGraph, makePiece, pieceCost, type TrackKind, type TrackPiece } from '../world/track';
import trackData from '../data/track.json';
import { Station, stationDef, maxLevelForTier } from './stations';
import type { Economy } from './economy';
import { STR } from '../strings';
import { sfx } from '../engine/audio';

export interface PlacementCheck {
  ok: boolean;
  cost: number;
  reason?: string;
}

/** Placement rules, costs and refunds for track and stations. Pure game logic; no rendering. */
export class Builder {
  readonly stations: Station[] = [];
  onTrackChanged: ((x: number, y: number) => void) | null = null;
  onStationChanged: ((s: Station, removed: boolean) => void) | null = null;

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
    if (!this.regions.isTileUnlocked(x, y)) return { ok: false, cost: 0, reason: STR.build.locked };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock) return { ok: false, cost: 0, reason: STR.build.rock };
    if (t === Terrain.Water && kind !== 'bridge')
      return { ok: false, cost: 0, reason: STR.build.needBridge };
    if (t !== Terrain.Water && kind === 'bridge')
      return { ok: false, cost: 0, reason: STR.build.bridgeOnWater };
    if (this.stationAt(x, y)) return { ok: false, cost: 0, reason: STR.build.occupied };
    let cost = Math.round(pieceCost(kind) * this.terrainMul(x, y));
    const existing = this.track.get(x, y);
    if (existing) cost -= this.refundFor(existing);
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
  }

  refundFor(p: TrackPiece) {
    return Math.round(pieceCost(p.kind) * trackData.refund);
  }

  placeTrack(x: number, y: number, kind: TrackKind, rot: number): boolean {
    const c = this.checkTrack(x, y, kind);
    if (!c.ok) return false;
    const existing = this.track.get(x, y);
    if (existing && existing.kind === kind && existing.rot === rot) return false;
    if (!this.economy.spend(Math.max(0, c.cost))) return false;
    this.track.set(x, y, makePiece(kind, rot));
    this.onTrackChanged?.(x, y);
    sfx('build.place');
    return true;
  }

  removeTrack(x: number, y: number): boolean {
    const p = this.track.get(x, y);
    if (!p) return false;
    this.track.remove(x, y);
    this.economy.earn(this.refundFor(p));
    this.onTrackChanged?.(x, y);
    sfx('build.remove');
    return true;
  }

  hasAdjacentTrack(x: number, y: number) {
    return DIRS.some((d) => this.track.has(x + DIR_DX[d], y + DIR_DY[d]));
  }

  checkStation(x: number, y: number, defId: string): PlacementCheck {
    const def = stationDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: 0, reason: STR.build.offMap };
    if (!this.regions.isTileUnlocked(x, y)) return { ok: false, cost: 0, reason: STR.build.locked };
    if (def.tier > this.economy.tier)
      return { ok: false, cost: 0, reason: STR.build.tierLocked(def.tier) };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Water)
      return { ok: false, cost: 0, reason: STR.build.badTerrain };
    if (this.track.has(x, y) || this.stationAt(x, y))
      return { ok: false, cost: 0, reason: STR.build.occupied };
    if (!this.hasAdjacentTrack(x, y)) return { ok: false, cost: 0, reason: STR.build.needTrack };
    const cost = Math.round(def.cost * Math.max(1, this.terrainMul(x, y)));
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
    this.onStationChanged?.(s, false);
    sfx('build.place');
    return s;
  }

  removeStation(s: Station): boolean {
    const i = this.stations.indexOf(s);
    if (i < 0) return false;
    this.stations.splice(i, 1);
    this.economy.earn(Math.round(s.def.cost * trackData.refund));
    this.onStationChanged?.(s, true);
    return true;
  }

  canUpgrade(s: Station): PlacementCheck {
    if (s.level >= maxLevelForTier(this.economy.tier))
      return { ok: false, cost: s.upgradeCost(), reason: STR.build.levelCap };
    const cost = s.upgradeCost();
    if (!this.economy.canAfford(cost)) return { ok: false, cost, reason: STR.build.funds };
    return { ok: true, cost };
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
