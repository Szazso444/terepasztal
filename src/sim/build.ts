import { DIRS, DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
import { Terrain, TERRAIN_NAMES, inBounds, terrainAt, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { TrackGraph, makePiece, pieceCost, type TrackKind, type TrackPiece } from '../world/track';
import { content, type DecorDef, type Cost } from '../data/content';
import { rules } from './rules';
import { Station, terrainFactorAt, stationDef, maxLevelForTier, MAX_LEVEL } from './stations';
import type { Economy } from './economy';
import { Stockpile, scaleCost } from './stockpile';
import { buildingDef, BUILDING_DEFS, type Building } from './buildings';
import { biomeDef, biomeAt } from './biomes';
import { STR } from '../strings';
import { sfx } from '../engine/audio';

const trackData = content.track;

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
  if (d.id === 'signal') {
    const fx = DIR_DX[d.rot] * 0.3 + DIR_DY[d.rot] * 0.24;
    const fy = DIR_DY[d.rot] * 0.3 - DIR_DX[d.rot] * 0.24;
    const p = tileToWorld(fx, fy);
    return { dx: Math.round(p.x), dy: Math.round(p.y) };
  }
  if (d.id === 'power_line') {
    const p = tileToWorld(0.3, -0.3);
    return { dx: Math.round(p.x), dy: Math.round(p.y) };
  }
  return { dx: 0, dy: 0 };
}

export interface PlacementCheck {
  ok: boolean;
  cost: Cost;
  reason?: string;
}

/** Placement rules, resource costs and refunds for track, stations, decor and buildings. */
export class Builder {
  readonly stations: Station[] = [];
  /** signals, towers, coaling stages, power poles keyed by tile */
  readonly decor = new Map<number, Decor>();
  /** processing buildings keyed by tile */
  readonly buildings = new Map<number, Building>();
  /** editor mode: no costs, no region or tier locks */
  free = false;
  onTrackChanged: ((x: number, y: number) => void) | null = null;
  onStationChanged: ((s: Station, removed: boolean) => void) | null = null;
  onDecorChanged: ((d: Decor, removed: boolean) => void) | null = null;
  onBuildingChanged: ((b: Building, removed: boolean) => void) | null = null;
  /** fired when a station loses (true) or regains (false) its last platform tile */
  onStationOrphaned: ((s: Station, orphaned: boolean) => void) | null = null;

  constructor(
    readonly map: GameMap,
    readonly regions: RegionState,
    readonly track: TrackGraph,
    readonly economy: Economy,
    readonly stock: Stockpile,
  ) {}

  // ------------------------------------------------------------------ helpers
  private key(x: number, y: number) {
    return y * this.map.w + x;
  }
  stationAt(x: number, y: number): Station | undefined {
    return this.stations.find((s) => s.x === x && s.y === y);
  }
  stationById(id: number) {
    return this.stations.find((s) => s.id === id);
  }
  decorAt(x: number, y: number): Decor | undefined {
    return this.decor.get(this.key(x, y));
  }
  buildingAt(x: number, y: number): Building | undefined {
    return this.buildings.get(this.key(x, y));
  }
  terrainMul(x: number, y: number): number {
    const t = terrainAt(this.map, x, y);
    const base = (trackData.terrainCost as Record<string, number>)[TERRAIN_NAMES[t]] ?? 0;
    return base * biomeDef(biomeAt(this.map, x, y)).trackCostMul;
  }
  private priced(cost: Cost, mul: number): Cost {
    return this.free ? {} : scaleCost(cost, mul * rules.buildCostMul);
  }
  private affordable(cost: Cost): PlacementCheck {
    if (!this.free && !this.stock.canAfford(cost)) {
      const miss = this.stock.missing(cost);
      return {
        ok: false,
        cost,
        reason: STR.build.needResources(
          Object.entries(miss)
            .map(([k, v]) => `${v} ${k}`)
            .join(', '),
        ),
      };
    }
    return { ok: true, cost };
  }
  private pay(cost: Cost) {
    if (this.free) return true;
    return this.stock.spend(cost);
  }
  private refund(cost: Cost) {
    if (this.free) return;
    this.stock.refund(cost, rules.refundRate);
  }
  private unlocked(x: number, y: number) {
    return this.free || this.regions.isTileUnlocked(x, y);
  }
  hasAdjacentTrack(x: number, y: number) {
    return DIRS.some((d) => this.track.has(x + DIR_DX[d], y + DIR_DY[d]));
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
  isOrphaned(s: Station) {
    return this.platformTiles(s).length === 0;
  }
  /** Crew of everything built (trains add their own). */
  decorHas(id: string) {
    for (const d of this.decor.values()) if (d.id === id) return true;
    return false;
  }
  buildingHas(id: string) {
    for (const b of this.buildings.values()) if (b.id === id) return true;
    return false;
  }
  crewTotal() {
    let n = 0;
    for (const s of this.stations) n += s.crew;
    for (const d of this.decor.values()) n += decorDef(d.id).crew;
    for (const b of this.buildings.values()) n += buildingDef(b.id).crew;
    return n;
  }
  warehouseLevels() {
    return this.stations.filter((s) => s.def.stockpile).reduce((a, s) => a + s.level, 0);
  }
  plantCount() {
    let n = 0;
    for (const b of this.buildings.values()) if (buildingDef(b.id).power) n++;
    return n;
  }

  // ------------------------------------------------------------------ track
  checkTrack(x: number, y: number, kind: TrackKind): PlacementCheck {
    if (!inBounds(this.map, x, y)) return { ok: false, cost: {}, reason: STR.build.offMap };
    if (!this.unlocked(x, y)) return { ok: false, cost: {}, reason: STR.build.locked };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Mountain)
      return { ok: false, cost: {}, reason: STR.build.rock };
    if (t === Terrain.Water && kind !== 'bridge')
      return { ok: false, cost: {}, reason: STR.build.needBridge };
    if (t !== Terrain.Water && kind === 'bridge')
      return { ok: false, cost: {}, reason: STR.build.bridgeOnWater };
    if (this.stationAt(x, y) || this.buildingAt(x, y))
      return { ok: false, cost: {}, reason: STR.build.occupied };
    const dec = this.decorAt(x, y);
    if (dec && !decorDef(dec.id).onTrack)
      return { ok: false, cost: {}, reason: STR.build.occupied };
    return this.affordable(this.priced(pieceCost(kind), this.terrainMul(x, y)));
  }
  refundFor(p: TrackPiece): Cost {
    return this.free ? {} : scaleCost(pieceCost(p.kind), rules.buildCostMul * rules.refundRate);
  }
  placeTrack(x: number, y: number, kind: TrackKind, rot: number): boolean {
    const c = this.checkTrack(x, y, kind);
    if (!c.ok) return false;
    const existing = this.track.get(x, y);
    if (existing && existing.kind === kind && existing.rot === rot) return false;
    if (!this.pay(c.cost)) return false;
    if (existing) this.refund(pieceCost(existing.kind));
    this.track.set(x, y, makePiece(kind, rot));
    this.onTrackChanged?.(x, y);
    this.checkOrphans(x, y);
    sfx('build.place');
    return true;
  }
  removeTrack(x: number, y: number): boolean {
    const p = this.track.get(x, y);
    if (!p) return false;
    // a signal or pole standing on the tile goes with it
    const dec = this.decorAt(x, y);
    if (dec && decorDef(dec.id).onTrack && !decorDef(dec.id).anyTile) this.removeDecor(x, y);
    this.track.remove(x, y);
    this.refund(pieceCost(p.kind));
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

  // ------------------------------------------------------------------ stations
  checkStation(x: number, y: number, defId: string): PlacementCheck {
    const def = stationDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: {}, reason: STR.build.offMap };
    if (!this.unlocked(x, y)) return { ok: false, cost: {}, reason: STR.build.locked };
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(def.tier) };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Mountain)
      return { ok: false, cost: {}, reason: STR.build.badTerrain };
    if (this.track.has(x, y) || this.stationAt(x, y) || this.decorAt(x, y) || this.buildingAt(x, y))
      return { ok: false, cost: {}, reason: STR.build.occupied };
    if (!this.hasAdjacentTrack(x, y)) return { ok: false, cost: {}, reason: STR.build.needTrack };
    return this.affordable(this.priced(def.cost, Math.max(1, this.terrainMul(x, y))));
  }
  /** Output multiplier a harvesting station would get on a tile (1 for others). */
  harvestFactor(x: number, y: number, defId: string) {
    return terrainFactorAt(this.map, x, y, defId);
  }
  /** Recompute every station's nearby-resource multiplier (after terrain edits). */
  refreshHarvest() {
    for (const s of this.stations) s.terrainFactor = terrainFactorAt(this.map, s.x, s.y, s.def.id);
  }
  placeStation(x: number, y: number, defId: string): Station | null {
    const c = this.checkStation(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    const count = this.stations.filter((s) => s.def.id === defId).length;
    const s = new Station(
      defId,
      x,
      y,
      count ? `${stationDef(defId).name} ${count + 1}` : undefined,
    );
    s.terrainFactor = terrainFactorAt(this.map, x, y, defId);
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
    this.refund(s.def.cost);
    this.onStationChanged?.(s, true);
    return true;
  }
  canUpgrade(s: Station): PlacementCheck {
    if (s.level >= MAX_LEVEL) return { ok: false, cost: {}, reason: STR.station.maxed };
    if (this.free) return { ok: true, cost: {} };
    if (s.level >= maxLevelForTier(this.economy.tier))
      return { ok: false, cost: s.upgradeCost(), reason: STR.build.levelCap };
    return this.affordable(s.upgradeCost());
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
    if (!c.ok || !this.pay(c.cost)) return false;
    s.level++;
    this.onStationChanged?.(s, false);
    sfx('station.upgrade');
    return true;
  }

  // ------------------------------------------------------------------ decor
  checkDecor(x: number, y: number, defId: string): PlacementCheck {
    const def = decorDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: {}, reason: STR.build.offMap };
    if (!this.unlocked(x, y)) return { ok: false, cost: {}, reason: STR.build.locked };
    if (this.decorAt(x, y) || this.buildingAt(x, y))
      return { ok: false, cost: {}, reason: STR.build.occupied };
    const t = terrainAt(this.map, x, y);
    if (def.onTrack && !def.anyTile) {
      if (!this.track.has(x, y)) return { ok: false, cost: {}, reason: STR.build.needTrackHere };
    } else {
      if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Mountain)
        return { ok: false, cost: {}, reason: STR.build.badTerrain };
      if (this.stationAt(x, y)) return { ok: false, cost: {}, reason: STR.build.occupied };
      if (!def.anyTile && this.track.has(x, y))
        return { ok: false, cost: {}, reason: STR.build.occupied };
    }
    return this.affordable(this.priced(def.cost, 1));
  }
  placeDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    const c = this.checkDecor(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    const d: Decor = { id: defId, x, y, rot: rot % decorDef(defId).rotations };
    this.decor.set(this.key(x, y), d);
    this.onDecorChanged?.(d, false);
    this.refreshStationBoosts();
    sfx('build.place');
    return d;
  }
  decorRefund(d: Decor): Cost {
    return this.free ? {} : scaleCost(decorDef(d.id).cost, rules.buildCostMul * rules.refundRate);
  }
  removeDecor(x: number, y: number): boolean {
    const d = this.decorAt(x, y);
    if (!d) return false;
    this.decor.delete(this.key(x, y));
    this.refund(decorDef(d.id).cost);
    this.onDecorChanged?.(d, true);
    this.refreshStationBoosts();
    sfx('build.remove');
    return true;
  }
  /** Water towers and coaling stages within their radius mark stations as supplied; towers also boost loading. */
  refreshStationBoosts() {
    for (const s of this.stations) {
      let boost = 0;
      let count = 0;
      s.waterSupply = false;
      s.fuelSupply = false;
      for (const d of this.decor.values()) {
        const def = decorDef(d.id);
        if (!def.radius) continue;
        if (Math.max(Math.abs(d.x - s.x), Math.abs(d.y - s.y)) > def.radius) continue;
        if (def.loadBoost && count < 2) {
          boost += def.loadBoost;
          count++;
        }
        if (def.water) s.waterSupply = true;
        if (def.fuel) s.fuelSupply = true;
      }
      s.loadBoost = 1 + boost;
    }
  }

  // ------------------------------------------------------------------ buildings
  checkBuilding(x: number, y: number, defId: string): PlacementCheck {
    const def = buildingDef(defId);
    if (!inBounds(this.map, x, y)) return { ok: false, cost: {}, reason: STR.build.offMap };
    if (!this.unlocked(x, y)) return { ok: false, cost: {}, reason: STR.build.locked };
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(def.tier) };
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Mountain)
      return { ok: false, cost: {}, reason: STR.build.badTerrain };
    if (this.track.has(x, y) || this.stationAt(x, y) || this.decorAt(x, y) || this.buildingAt(x, y))
      return { ok: false, cost: {}, reason: STR.build.occupied };
    return this.affordable(this.priced(def.cost, 1));
  }
  placeBuilding(x: number, y: number, defId: string): Building | null {
    const c = this.checkBuilding(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    const b: Building = { id: defId, x, y, acc: 0, active: false, rate: 0 };
    this.buildings.set(this.key(x, y), b);
    this.onBuildingChanged?.(b, false);
    sfx('build.place');
    return b;
  }
  buildingRefund(b: Building): Cost {
    return this.free
      ? {}
      : scaleCost(buildingDef(b.id).cost, rules.buildCostMul * rules.refundRate);
  }
  removeBuilding(x: number, y: number): boolean {
    const b = this.buildingAt(x, y);
    if (!b) return false;
    this.buildings.delete(this.key(x, y));
    this.refund(buildingDef(b.id).cost);
    this.onBuildingChanged?.(b, true);
    sfx('build.remove');
    return true;
  }
}
export { BUILDING_DEFS };
