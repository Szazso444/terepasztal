import { DIRS, DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
import { Terrain, TERRAIN_NAMES, inBounds, terrainAt, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import {
  TrackGraph,
  pieceCost,
  footprintOf,
  isUnitKind,
  portClass,
  classesJoin,
  type TrackItem,
  type TrackKind,
  type TrackPiece,
} from '../world/track';
import { DIR_DX as DDX, DIR_DY as DDY, opposite } from '../engine/iso';
import { SUPPLY_DEFS, type Catenary, type SupplyKind } from './catenary';
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
  onSupplyChanged: ((x: number, y: number) => void) | null = null;
  /** electrification overlay (set by the game) */
  catenary: Catenary | null = null;
  /** fired once when a producing station or a works building is newly placed (not on load or upgrade) */
  onIndustryPlaced: ((x: number, y: number) => void) | null = null;
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
    return this.stations.find((s) => s.covers(x, y));
  }
  depots() {
    return this.stations.filter((s) => s.def.depot);
  }
  /** Depots the player may own: one, plus one per nine owned chunks. */
  depotsAllowed() {
    return 1 + Math.floor(this.regions.ownedCount() / 9);
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
  /** How many of one kind stand already (stations, services, works). */
  kindCount(defId: string) {
    let n = 0;
    for (const s of this.stations) if (s.def.id === defId) n++;
    for (const d of this.decor.values()) if (d.id === defId) n++;
    for (const b of this.buildings.values()) if (b.id === defId) n++;
    return n;
  }
  /** Each further one of a kind costs a step more than the base (track and depots excepted). */
  kindMul(defId: string) {
    return 1 + rules.repeatCostStep * this.kindCount(defId);
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
  /** Track tiles serving a station: its platforms (a depot's gates with track on them). */
  platformTiles(s: Station): { x: number; y: number }[] {
    const gates = s.gateTiles().filter((p) => this.track.has(p.x, p.y));
    if (!s.def.depot) return gates;
    // rails through the shed serve it too
    for (const t of s.footprint()) if (this.track.has(t.x, t.y)) gates.push(t);
    return gates;
  }
  /** Station whose platform set contains this track tile (if any). */
  stationForTrackTile(x: number, y: number): Station | undefined {
    return this.stations.find((s) => s.gateTiles().some((g) => g.x === x && g.y === y));
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
  depotCount() {
    return this.depots().length;
  }
  /** Townhouses standing (the house registry knows who lives in them). */
  houseCount() {
    let n = 0;
    for (const d of this.decor.values()) if (decorDef(d.id).residents) n++;
    return n;
  }
  plantCount() {
    let n = 0;
    for (const b of this.buildings.values()) if (buildingDef(b.id).power) n++;
    return n;
  }

  // ------------------------------------------------------------------ track
  private checkTrackTile(x: number, y: number, kind: TrackKind, anchor: boolean): string | null {
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Mountain) return STR.build.rock;
    if (t === Terrain.Water && kind !== 'bridge') return STR.build.needBridge;
    if (t !== Terrain.Water && kind === 'bridge') return STR.build.bridgeOnWater;
    const st = this.stationAt(x, y);
    // a depot is a through-station: plain pieces may run through the shed
    if ((st && !(st.def.depot && anchor)) || this.buildingAt(x, y)) return STR.build.occupied;
    const dec = this.decorAt(x, y);
    if (dec && !decorDef(dec.id).onTrack) return STR.build.occupied;
    const existing = this.track.get(x, y);
    // a wide piece needs its whole footprint free of track; a one-tile piece may replace another
    // one-tile piece but never a member of a wide one
    if (existing && (!anchor || existing.unit)) return STR.build.trackInWay;
    return null;
  }
  /**
   * Can a piece with its anchor at (x,y) be laid? Checks every footprint tile, then that each
   * open edge meeting existing track joins a compatible class (a transition piece joins any).
   */
  checkTrack(x: number, y: number, item: TrackItem, rot = 0): PlacementCheck {
    const kind = item.kind;
    const wide = isUnitKind(kind, item.cls);
    const tiles = footprintOf(x, y, kind, rot, item.cls);
    for (const t of tiles) {
      const why = this.checkTrackTile(t.x, t.y, kind, !wide);
      if (why) return { ok: false, cost: {}, reason: why };
    }
    // class compatibility with the neighbours the new piece would open onto
    const probe = new TrackGraph(this.map.w, this.map.h);
    probe.place(x, y, kind, rot, item.cls, item.cls2);
    for (const t of tiles) {
      const p = probe.get(t.x, t.y);
      if (!p) continue;
      for (const [a, b] of p.links)
        for (const d of [a, b]) {
          const nx = t.x + DDX[d];
          const ny = t.y + DDY[d];
          if (tiles.some((q) => q.x === nx && q.y === ny)) continue;
          const q = this.track.get(nx, ny);
          if (!q || !this.track.opensTo(nx, ny, opposite(d))) continue;
          if (!classesJoin(portClass(p, d), portClass(q, opposite(d))))
            return { ok: false, cost: {}, reason: STR.build.needTransition };
        }
    }
    let mul = 0;
    for (const t of tiles) mul = Math.max(mul, this.terrainMul(t.x, t.y));
    return this.affordable(this.priced(pieceCost(kind, item.cls, item.cls2), mul));
  }
  refundFor(p: TrackPiece): Cost {
    return this.free
      ? {}
      : scaleCost(pieceCost(p.kind, p.cls, p.cls2), rules.buildCostMul * rules.refundRate);
  }
  placeTrack(x: number, y: number, item: TrackItem, rot: number): boolean {
    const c = this.checkTrack(x, y, item, rot);
    if (!c.ok) return false;
    const existing = this.track.get(x, y);
    if (
      existing &&
      existing.kind === item.kind &&
      existing.rot === rot &&
      existing.cls === item.cls &&
      (existing.cls2 ?? existing.cls) === (item.cls2 ?? item.cls)
    )
      return false;
    if (!this.pay(c.cost)) return false;
    if (existing) this.refund(pieceCost(existing.kind, existing.cls, existing.cls2));
    const tiles = this.track.place(x, y, item.kind, rot, item.cls, item.cls2);
    for (const t of tiles) this.onTrackChanged?.(t.x, t.y);
    for (const t of tiles) this.checkOrphans(t.x, t.y);
    sfx('build.place');
    return true;
  }
  /** Compatibility: lay a regular piece by kind. */
  placeTrackKind(x: number, y: number, kind: TrackKind, rot: number) {
    return this.placeTrack(x, y, { kind, cls: 'regular', cls2: 'regular' }, rot);
  }
  removeTrack(x: number, y: number): boolean {
    const p = this.track.get(x, y);
    if (!p) return false;
    const tiles = this.track.unitTiles(x, y);
    // a signal or pole standing on the tile goes with it
    for (const t of tiles) {
      const dec = this.decorAt(t.x, t.y);
      if (dec && decorDef(dec.id).onTrack && !decorDef(dec.id).anyTile) this.removeDecor(t.x, t.y);
    }
    for (const t of tiles) if (this.catenary?.supplyAt(t.x, t.y)) this.removeSupply(t.x, t.y);
    this.track.removeAt(x, y);
    this.refund(pieceCost(p.kind, p.cls, p.cls2));
    for (const t of tiles) this.onTrackChanged?.(t.x, t.y);
    for (const t of tiles) this.checkOrphans(t.x, t.y);
    sfx('build.remove');
    return true;
  }
  /** Re-evaluate platform access of the stations around a changed track tile. */
  private checkOrphans(x: number, y: number) {
    for (const s of this.stations) {
      if (!s.gateTiles().some((g) => g.x === x && g.y === y)) continue;
      this.onStationOrphaned?.(s, this.platformTiles(s).length === 0);
    }
  }

  // ------------------------------------------------------------------ stations
  /** Minimum Chebyshev distance between two town stations. */
  static readonly TOWN_SPACING = 25;
  checkStation(x: number, y: number, defId: string): PlacementCheck {
    const def = stationDef(defId);
    const size = def.size ?? 1;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!inBounds(this.map, tx, ty)) return { ok: false, cost: {}, reason: STR.build.offMap };
        if (!this.unlocked(tx, ty)) return { ok: false, cost: {}, reason: STR.build.locked };
        const t = terrainAt(this.map, tx, ty);
        if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Mountain)
          return { ok: false, cost: {}, reason: STR.build.badTerrain };
        if (
          this.track.has(tx, ty) ||
          this.stationAt(tx, ty) ||
          this.decorAt(tx, ty) ||
          this.buildingAt(tx, ty)
        )
          return { ok: false, cost: {}, reason: STR.build.occupied };
      }
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(def.tier) };
    if (def.depot && !this.free) {
      const allowed = this.depotsAllowed();
      const have = this.depots().length;
      if (have >= allowed)
        return { ok: false, cost: {}, reason: STR.build.depotLocked(allowed * 9) };
    }
    if (defId === 'town') {
      const near = this.stations.find(
        (s) =>
          s.def.id === 'town' &&
          Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < Builder.TOWN_SPACING,
      );
      if (near)
        return { ok: false, cost: {}, reason: STR.build.townTooClose(Builder.TOWN_SPACING) };
    }
    if (!def.depot && !this.hasAdjacentTrack(x, y))
      return { ok: false, cost: {}, reason: STR.build.needTrack };
    return this.affordable(
      this.priced(
        def.cost,
        Math.max(1, this.terrainMul(x, y)) * (def.depot ? 1 : this.kindMul(defId)),
      ),
    );
  }
  /** Output multiplier a harvesting station would get on a tile (1 for others). */
  harvestFactor(x: number, y: number, defId: string) {
    return terrainFactorAt(this.map, x, y, defId);
  }
  /** Recompute every station's nearby-resource multiplier (after terrain edits). */
  refreshHarvest() {
    for (const s of this.stations) s.terrainFactor = terrainFactorAt(this.map, s.x, s.y, s.def.id);
  }
  placeStation(x: number, y: number, defId: string, rot = 0): Station | null {
    const c = this.checkStation(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    const count = this.stations.filter((s) => s.def.id === defId).length;
    const s = new Station(
      defId,
      x,
      y,
      count ? `${stationDef(defId).name} ${count + 1}` : undefined,
    );
    s.rot = rot % 2;
    s.terrainFactor = terrainFactorAt(this.map, x, y, defId);
    this.stations.push(s);
    this.refreshStationBoosts();
    this.onStationChanged?.(s, false);
    if (s.def.produces.length) this.onIndustryPlaced?.(x, y);
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
  /** Placement rules for decor without the price check (the reason when it cannot stand here). */
  canPlaceDecor(x: number, y: number, defId: string): string | null {
    const def = decorDef(defId);
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    if (this.decorAt(x, y) || this.buildingAt(x, y)) return STR.build.occupied;
    const t = terrainAt(this.map, x, y);
    if (def.onTrack && !def.anyTile) {
      if (!this.track.has(x, y)) return STR.build.needTrackHere;
    } else {
      if (t === Terrain.Rock || t === Terrain.Water || t === Terrain.Mountain)
        return STR.build.badTerrain;
      if (this.stationAt(x, y)) return STR.build.occupied;
      if (!def.anyTile && this.track.has(x, y)) return STR.build.occupied;
    }
    return null;
  }
  checkDecor(x: number, y: number, defId: string): PlacementCheck {
    const reason = this.canPlaceDecor(x, y, defId);
    if (reason) return { ok: false, cost: {}, reason };
    return this.affordable(this.priced(decorDef(defId).cost, this.kindMul(defId)));
  }
  placeDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    const c = this.checkDecor(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    return this.addDecor(x, y, defId, rot);
  }
  /** Decor the world builds itself (a town raising a house): no price, still needs a free tile. */
  spawnDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    if (this.canPlaceDecor(x, y, defId)) return null;
    return this.addDecor(x, y, defId, rot);
  }
  private addDecor(x: number, y: number, defId: string, rot: number): Decor {
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
        if (s.distTo(d.x, d.y) > def.radius) continue;
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
    if (
      def.needsWater &&
      !DIRS.some((d) => terrainAt(this.map, x + DDX[d], y + DDY[d]) === Terrain.Water)
    )
      return { ok: false, cost: {}, reason: STR.build.needWaterside };
    return this.affordable(this.priced(def.cost, this.kindMul(defId)));
  }

  // ------------------------------------------------------------------ electrification
  checkSupply(x: number, y: number, kind: SupplyKind): PlacementCheck {
    if (!inBounds(this.map, x, y)) return { ok: false, cost: {}, reason: STR.build.offMap };
    if (!this.unlocked(x, y)) return { ok: false, cost: {}, reason: STR.build.locked };
    if (!this.free && SUPPLY_DEFS[kind].tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(SUPPLY_DEFS[kind].tier) };
    if (!this.track.has(x, y)) return { ok: false, cost: {}, reason: STR.build.needTrackHere };
    if (this.catenary?.supplyAt(x, y) === kind)
      return { ok: false, cost: {}, reason: STR.build.sameSupply };
    return this.affordable(this.priced(SUPPLY_DEFS[kind].cost, 1));
  }
  placeSupply(x: number, y: number, kind: SupplyKind): boolean {
    if (!this.catenary) return false;
    const c = this.checkSupply(x, y, kind);
    if (!c.ok || !this.pay(c.cost)) return false;
    const old = this.catenary.supplyAt(x, y);
    if (old) this.refund(SUPPLY_DEFS[old].cost);
    this.catenary.set(x, y, kind);
    this.onSupplyChanged?.(x, y);
    sfx('build.place');
    return true;
  }
  removeSupply(x: number, y: number): boolean {
    const old = this.catenary?.supplyAt(x, y);
    if (!old || !this.catenary) return false;
    this.catenary.remove(x, y);
    this.refund(SUPPLY_DEFS[old].cost);
    this.onSupplyChanged?.(x, y);
    sfx('build.remove');
    return true;
  }
  placeBuilding(x: number, y: number, defId: string): Building | null {
    const c = this.checkBuilding(x, y, defId);
    if (!c.ok || !this.pay(c.cost)) return null;
    const b: Building = { id: defId, x, y, acc: 0, active: false, rate: 0 };
    this.buildings.set(this.key(x, y), b);
    this.onBuildingChanged?.(b, false);
    this.onIndustryPlaced?.(x, y);
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
