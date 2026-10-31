import { DIRS, DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
import { Terrain, TERRAIN_NAMES, inBounds, terrainAt, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import {
  TrackGraph,
  pieceCost,
  footprintOf,
  isUnitKind,
  itemAge,
  memberClear,
  makePiece,
  portClass,
  classesJoin,
  rotationCount,
  type TrackItem,
  type TrackKind,
  type TrackPiece,
} from '../world/track';
import { DIR_DX as DDX, DIR_DY as DDY, opposite } from '../engine/iso';
import { SUPPLY_DEFS, type Catenary, type SupplyKind } from './catenary';
import { TrackWear } from './wear';
import {
  content,
  dataName,
  type DecorDef,
  type Cost,
  type Gauge,
  type StationDef,
} from '../data/content';
import { rules } from './rules';
import {
  Station,
  terrainFactorAt,
  stationDef,
  stationFootprint,
  stationGates,
  MAX_LEVEL,
} from './stations';
import { ageOfLevel, levelCap } from './levels';
import { ageDef, LAST_AGE } from './ages';
import type { Economy } from './economy';
import { scaleCost, type ResourceStore, type StoreRegistry } from './stores';
import {
  buildingDef,
  buildingLevel,
  buildingUpgradeCost,
  worksMaxLevel,
  buildingFootprint,
  buildingSpan,
  BuildingMap,
  BUILDING_DEFS,
  type Building,
} from './buildings';
import { advanceWork, startWork, workProgress, type Upgraded, type WorkSite } from './upgrade';
import { biomeDef, biomeAt } from './biomes';
import { inSupplyMode } from './supply';
import { wrapRotation } from './rotation';
import { STR } from '../strings';
import { cargoWord } from './cargo';
import { bridgeCapacity } from './bridges';
import { climbAxes, supportedDeck } from '../world/railProfile';
import { sfx } from '../engine/audio';
import { planReclass, type PieceChange, type ReclassDir } from '../world/reclass';
import { continuesLine, onRails, stone } from './mountainTrack';
import {
  Roads,
  SPUR_REACH,
  crossingRefusal,
  findSpur,
  roadCost,
  roadLinks,
  roadServes,
  type RoadLinks,
} from './roads';
import { hasDoors, streetDoors, type Door, type PlaceAt } from './doors';
import type { BuildLog, PieceSpec } from './buildLog';
import type { Work } from './upgrade';

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
  /** the key of the store that pays `cost` (`Builder.payerAt`); absent when nothing is paid */
  payer?: string;
}

/**
 * Why nothing can be built on terrain `t`, naming the ground, or null when it takes buildings.
 * The one list of where nothing stands: stations, works, decor off the track, roads and a depot's
 * gates all ask it, and a bridge platform asks it everywhere but on water, which it spans, as a
 * road on a platform does. Track has rules of its own (`checkTrackTile`, and `trackRules` for
 * rock and mountain), and so do the walkers (`walkable` in people.ts) and the town paving
 * (`cityTiles` in city.ts).
 */
export function unbuildable(t: Terrain): string | null {
  switch (t) {
    case Terrain.Water:
      return STR.build.nothingOn.water;
    case Terrain.Rock:
      return STR.build.nothingOn.rock;
    case Terrain.Mountain:
      return STR.build.nothingOn.mountain;
    default:
      return null;
  }
}

/**
 * One piece of a line, in the order the line lays it: a track piece by its anchor tile, item and
 * rotation, as `checkTrack` and `placeTrack` take them, or a bridge platform (`defId` names a
 * building with `bridge`; a platform stands at rotation 0). Each piece is judged as if the pieces
 * before it stood already, so a bridge lists each tile's platform before the rail on it.
 */
export type LinePiece =
  | { kind: 'track'; x: number; y: number; item: TrackItem; rot: number }
  | { kind: 'platform'; x: number; y: number; defId: string };

/** A piece's verdict within a line: its own price or refusal; `skip` when it stands already. */
export interface LineStep extends PlacementCheck {
  skip?: boolean;
}

/**
 * A line's verdict. `cost` is the total of every piece that would be laid; `reason` is the first
 * refusal: the first refused piece's own, or else the stock falling short of the total.
 */
export interface LineCheck extends PlacementCheck {
  /** index of the first refused piece; absent when no piece is refused */
  at?: number;
  /** each piece's verdict, in the line's order */
  steps: LineStep[];
}

/**
 * Why the age keeps a building that appears in `firstAge` from rising to `level`, or null when it
 * may: the level opens in a later age, named in full, or no age ever opens it.
 */
export function levelLocked(firstAge: number, level: number, age: number): string | null {
  if (level <= levelCap(firstAge, age)) return null;
  const opens = ageOfLevel(firstAge, level);
  if (opens > LAST_AGE) return STR.station.maxed;
  return STR.build.levelOpens(level, STR.ages.name[ageDef(opens).id]);
}

/** Placement rules, resource costs and refunds for track, stations, decor and buildings. */
export class Builder {
  readonly stations: Station[] = [];
  /** signals, towers, coaling stages, power poles keyed by tile */
  readonly decor = new Map<number, Decor>();
  /**
   * processing buildings keyed by their footprint's corner tile, also found from any tile they
   * cover (`buildingAt`)
   */
  readonly buildings: BuildingMap;
  /** editor mode: no costs, no region or tier locks */
  free = false;
  /** the transaction open on this builder (`Commands.act`); outside one nothing is recorded */
  log: BuildLog | null = null;
  onTrackChanged: ((x: number, y: number) => void) | null = null;
  /**
   * The rendered hill decides what its ground carries: `straight` rails climb at most one level
   * per tile, `level` pieces and structures need a level tile. Unset means level everywhere.
   */
  groundCheck: ((x: number, y: number, need: 'straight' | 'level') => boolean) | null = null;
  onStationChanged: ((s: Station, removed: boolean) => void) | null = null;
  onDecorChanged: ((d: Decor, removed: boolean) => void) | null = null;
  onBuildingChanged: ((b: Building, removed: boolean) => void) | null = null;
  onSupplyChanged: ((x: number, y: number) => void) | null = null;
  /** fired when an undo gave a tile back the props track or a structure took off it */
  onPropsBack: ((x: number, y: number) => void) | null = null;
  /** fired when a road is laid on or taken off a tile (`placeRoad`, `removeRoad`) */
  onRoadChanged: ((x: number, y: number) => void) | null = null;
  /** electrification overlay (set by the game) */
  catenary: Catenary | null = null;
  /** the wear of the track (src/sim/wear.ts) */
  readonly wear: TrackWear;
  /** fired once when a producing station or a works building is newly placed (not on load or upgrade) */
  onIndustryPlaced: ((x: number, y: number) => void) | null = null;
  /** fired when a station loses (true) or regains (false) its last platform tile */
  onStationOrphaned: ((s: Station, orphaned: boolean) => void) | null = null;
  /**
   * fired when an upgrade raises a station's or a building's level: at once, or when its work is
   * done (`tickWorks`), after `onStationChanged` or `onBuildingChanged`
   */
  onUpgraded: ((e: Upgraded) => void) | null = null;
  /**
   * fired once by `reclassTrack` after a stroke relaid track, with the anchor of every piece it
   * relaid and which way it moved them
   */
  onReclassed: ((tiles: { x: number; y: number }[], dir: ReclassDir) => void) | null = null;

  constructor(
    readonly map: GameMap,
    readonly regions: RegionState,
    readonly track: TrackGraph,
    readonly economy: Economy,
    /** where the goods are kept: building pays from the nearest store and refunds to one */
    readonly stores: StoreRegistry,
    /** the roads on the map (src/sim/roads.ts); a line's probe shares its builder's */
    readonly roads: Roads = new Roads(track),
  ) {
    this.buildings = new BuildingMap(map.w, map.h);
    this.wear = new TrackWear(track, this);
  }

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
  /** Depots of one gauge: each gauge has its own sheds and its own cap. */
  depotsOf(gauge: Gauge) {
    return this.depots().filter((s) => (s.def.gauge ?? 'regular') === gauge);
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
  bridgeAt(x: number, y: number) {
    const b = this.buildingAt(x, y);
    return b && buildingDef(b.id).bridge ? b : undefined;
  }
  refreshBridgeCapacity(x: number, y: number) {
    const p = this.track.get(x, y);
    if (p)
      p.bridgeCapacity = this.bridgeAt(x, y)
        ? (bridgeCapacity(this.bridgeAt(x, y)!) ?? undefined)
        : undefined;
  }
  /** The works that covers (x, y): any tile of its footprint finds it. */
  buildingAt(x: number, y: number): Building | undefined {
    return this.buildings.at(x, y);
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
  /** The store that pays `cost` for work at (x, y): the nearest in reach that holds all of it. */
  payerAt(cost: Cost, x: number, y: number): ResourceStore | null {
    return this.stores.payerFor(cost, x, y);
  }
  /**
   * Whether the cost of work at (x, y) can be paid, and by which store (`payer`). Free mode and a
   * cost of nothing need no store. Refused, the reason names the nearest store's shortfall (or
   * the whole cost with no store in reach): stores are never added up.
   */
  affordable(cost: Cost, x: number, y: number): PlacementCheck {
    if (this.free || !hasPrice(cost)) return { ok: true, cost };
    const payer = this.payerAt(cost, x, y);
    if (payer) return { ok: true, cost, payer: payer.key };
    const miss = this.stores.nearest(x, y)[0]?.missing(cost) ?? cost;
    const what = Object.entries(miss)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${cargoWord(k)}`)
      .join(', ');
    return { ok: false, cost, reason: STR.build.noStoreInReach(rules.buildReach, what) };
  }
  /** Pay what a check approved for work at (x, y), from the store it named (`payer`). */
  pay(c: PlacementCheck, x: number, y: number) {
    if (this.free || !hasPrice(c.cost)) return true;
    const payer = this.stores.nearest(x, y).find((s) => s.key === c.payer);
    return !!payer && payer.spend(c.cost);
  }
  /** Give back the refund share of `cost` to the store that supplies (x, y), else the nearest. */
  private refund(cost: Cost, x: number, y: number) {
    if (this.free) return;
    const to = this.stores.supplierFor(x, y) ?? this.stores.nearest(x, y, Infinity)[0];
    to?.refund(cost, rules.refundRate);
  }
  /**
   * A station was placed, removed or changed (a level, an upgrade begun): it is told, then the
   * stores are derived again, as they follow the stations (`StoreRegistry.refresh`).
   */
  private stationChanged(s: Station, removed: boolean) {
    this.onStationChanged?.(s, removed);
    this.stores.refresh();
  }
  /** A works or a platform changed: it is told; a power plant also changes the grid's cap. */
  private buildingChanged(b: Building, removed: boolean) {
    this.onBuildingChanged?.(b, removed);
    if (buildingDef(b.id).power) this.stores.refresh();
  }
  private unlocked(x: number, y: number) {
    return this.free || this.regions.isTileUnlocked(x, y);
  }
  /**
   * Track beside (x, y); with a station kind given, beside its footprint turned to `rot` (beside
   * any of its tiles, so a station of two tiles is served from either).
   */
  hasAdjacentTrack(x: number, y: number, defId?: string, rot = 0) {
    if (defId !== undefined)
      return stationGates(defId, x, y, rot).some((g) => this.track.has(g.x, g.y));
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
  decorHas(id: string) {
    for (const d of this.decor.values()) if (d.id === id) return true;
    return false;
  }
  buildingHas(id: string) {
    for (const b of this.buildings.values()) if (b.id === id) return true;
    return false;
  }
  /**
   * Where the crews of everything built work, and how many there are: stations, works and the
   * services beside the track, each at its anchor tile, those with no crew left out. A works being
   * upgraded has no crew to feed (a closed station's crew is 0 already). Trains have their own.
   */
  crewSites(): { x: number; y: number; crew: number }[] {
    const out: { x: number; y: number; crew: number }[] = [];
    const add = (x: number, y: number, crew: number) => {
      if (crew > 0) out.push({ x, y, crew });
    };
    for (const s of this.stations) add(s.x, s.y, s.crew);
    for (const d of this.decor.values()) add(d.x, d.y, decorDef(d.id).crew);
    for (const b of this.buildings.values()) if (!b.work) add(b.x, b.y, buildingDef(b.id).crew);
    return out;
  }
  /** Crew of everything built, `crewSites` added up (trains add their own). */
  crewTotal() {
    let n = 0;
    for (const c of this.crewSites()) n += c.crew;
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
  /**
   * Whether a works or bridge may rise a level: works one level per age from the age they appear
   * in, up to the level of their `lastTier` age when they have one (`worksUpgradeMax`: the Charcoal
   * Kiln ends at level 3), bridges to their four levels in any age. The editor ignores the age but
   * not that top. None while one runs.
   */
  canUpgradeBuilding(b: Building): PlacementCheck {
    if (b.work) return { ok: false, cost: {}, reason: STR.build.upgradingNow };
    const cost = buildingUpgradeCost(b);
    if (!cost) return { ok: false, cost: {}, reason: STR.station.maxed };
    if (this.free) return { ok: true, cost: {} };
    const def = buildingDef(b.id);
    // a works the content editor left without an age belongs to the first one, as stations do
    const locked = def.bridge
      ? null
      : levelLocked(def.tier ?? 0, buildingLevel(b) + 1, this.economy.tier);
    if (locked) return { ok: false, cost, reason: locked };
    return this.affordable(cost, b.x, b.y);
  }
  /**
   * Pay for the next level and start the work: the building closes until its time is up
   * (`tickWorks`), with `onBuildingChanged` fired so the power is rebuilt. In the editor, or when
   * upgrades take no time, the level rises at once.
   */
  upgradeBuilding(b: Building) {
    if (this.buildingAt(b.x, b.y) !== b) return false;
    const c = this.canUpgradeBuilding(b);
    if (!c.ok || !this.pay(c, b.x, b.y)) return false;
    sfx('station.upgrade');
    this.log?.worksLevel(b);
    const work = this.free ? null : startWork(buildingLevel(b) + 1);
    if (!work) {
      this.finishBuilding(b);
      return true;
    }
    b.work = work;
    this.buildingChanged(b, false);
    return true;
  }
  /** The building's level rises by one: it opens again, and the change is reported. */
  private finishBuilding(b: Building) {
    const def = buildingDef(b.id);
    b.level = Math.min(worksMaxLevel(b), buildingLevel(b) + 1);
    delete b.work;
    this.worksLevelChanged(b);
    this.onUpgraded?.({
      kind: 'works',
      x: b.x,
      y: b.y,
      w: 1,
      h: 1,
      name: def.name,
      level: b.level,
    });
  }
  /** A works' level changed: a bridge carries another load now, and the change is reported. */
  private worksLevelChanged(b: Building) {
    if (buildingDef(b.id).bridge) {
      this.refreshBridgeCapacity(b.x, b.y);
      this.track.version++;
    }
    this.buildingChanged(b, false);
  }
  /** Power plants at work: one being upgraded gives no power. */
  plantCount() {
    let n = 0;
    for (const b of this.buildings.values()) if (!b.work && buildingDef(b.id).power) n++;
    return n;
  }
  /**
   * Advance every work under way by `gameDt` game seconds (the step calls this once with its game
   * time); a station or building whose work is done rises a level.
   */
  tickWorks(gameDt: number) {
    for (const s of [...this.stations])
      if (s.work && advanceWork(s.work, gameDt)) this.finishStation(s);
    for (const b of [...this.buildings.values()])
      if (b.work && advanceWork(b.work, gameDt)) this.finishBuilding(b);
  }
  /** Every station and building being upgraded, with how far its work has come. */
  works(): WorkSite[] {
    const out: WorkSite[] = [];
    for (const s of this.stations)
      if (s.work) out.push({ x: s.x, y: s.y, w: s.w, h: s.h, progress: workProgress(s.work) });
    for (const b of this.buildings.values())
      if (b.work) {
        // the whole footprint, as turned: the progress overlay covers every tile, not the corner
        const { w, h } = buildingSpan(buildingDef(b.id), b.rot ?? 0);
        out.push({ x: b.x, y: b.y, w, h, progress: workProgress(b.work) });
      }
    return out;
  }

  /** Services can serve a platform or the rail directly within their advertised radius. */
  serviceAt(x: number, y: number) {
    let fuel = false,
      water = false;
    for (const d of this.decor.values()) {
      const def = decorDef(d.id);
      if (Math.max(Math.abs(x - d.x), Math.abs(y - d.y)) > (def.radius ?? 0)) continue;
      fuel ||= !!def.fuel;
      water ||= !!def.water;
    }
    for (const st of this.stations)
      if (!st.def.stockpile && this.platformTiles(st).some((p) => p.x === x && p.y === y)) {
        fuel ||= st.refuelsFuel;
        water ||= st.refuelsWater;
      }
    return { fuel, water };
  }
  serviceTiles() {
    const keys = new Set<number>();
    for (const d of this.decor.values()) {
      const def = decorDef(d.id);
      if (!def.fuel && !def.water) continue;
      const r = def.radius ?? 0;
      for (let y = d.y - r; y <= d.y + r; y++)
        for (let x = d.x - r; x <= d.x + r; x++) if (this.track.has(x, y)) keys.add(this.key(x, y));
    }
    for (const s of this.stations)
      if (!s.def.stockpile && (s.refuelsFuel || s.refuelsWater))
        for (const p of this.platformTiles(s)) keys.add(this.key(p.x, p.y));
    return [...keys].map((k) => {
      const x = k % this.map.w,
        y = Math.floor(k / this.map.w);
      return { x, y, ...this.serviceAt(x, y) };
    });
  }
  // ------------------------------------------------------------------ track
  private checkTrackTile(
    x: number,
    y: number,
    kind: TrackKind,
    anchor: boolean,
    replace: boolean,
    clear = false,
  ): string | null {
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Water && kind !== 'bridge' && !this.bridgeAt(x, y))
      return STR.build.needBridge;
    if (t !== Terrain.Water && kind === 'bridge') return STR.build.bridgeOnWater;
    const st = this.stationAt(x, y);
    // a depot is a through-station: plain pieces may run through the shed. A clear member of a
    // curve or switch (no rail on it) may go over whatever stands there.
    if (
      !clear &&
      ((st && !(st.def.depot && anchor)) || (this.buildingAt(x, y) && !this.bridgeAt(x, y)))
    )
      return STR.build.occupied;
    // a platform carries rail or a road, never both: no level crossing on a bridge (#493)
    if (this.bridgeAt(x, y) && this.roads.has(x, y)) return STR.build.bridgeCarriesRoad;
    const dec = this.decorAt(x, y);
    if (dec && !clear && !decorDef(dec.id).onTrack) return STR.build.occupied;
    const existing = this.track.get(x, y);
    // a wide piece needs its whole footprint free of track; a one-tile piece may replace another
    // one-tile piece (outside a line) but never a member of a wide one
    if (existing && (!anchor || existing.unit || !replace)) return STR.build.trackInWay;
    return null;
  }
  /**
   * Can a piece with its anchor at (x,y) be laid? Checks every footprint tile, that a piece on rock
   * or a mountain continues a line, the ground under it, then that each open edge meeting existing
   * track joins a line of the same network.
   */
  checkTrack(x: number, y: number, item: TrackItem, rot = 0): PlacementCheck {
    const c = this.trackRules(x, y, item, rot, true);
    return c.ok ? this.affordable(c.cost, x, y) : c;
  }
  /**
   * `checkTrack`'s rules and price, without asking whether the stock can pay. `replace` lets a
   * one-tile piece go over another one-tile piece; without it any track in the way refuses.
   */
  private trackRules(
    x: number,
    y: number,
    item: TrackItem,
    rot: number,
    replace: boolean,
  ): PlacementCheck {
    const kind = item.kind;
    if ((item.cls === 'narrow' || item.cls2 === 'narrow') && !rules.narrowUnlocked)
      return { ok: false, cost: {}, reason: STR.build.narrowLocked };
    if (this.lineLocked(itemAge(item)))
      return { ok: false, cost: {}, reason: STR.build.tierLocked(itemAge(item)) };
    const wide = isUnitKind(kind, item.cls);
    const tiles = footprintOf(x, y, kind, rot, item.cls);
    for (const [i, t] of tiles.entries()) {
      const clear = wide && memberClear(kind, item.cls, rot, i);
      const why = this.checkTrackTile(t.x, t.y, kind, !wide, replace, clear);
      if (why) return { ok: false, cost: {}, reason: why };
    }
    // class compatibility with the neighbours the new piece would open onto
    const probe = new TrackGraph(this.map.w, this.map.h);
    probe.place(x, y, kind, rot, item.cls, item.cls2);
    // A road on a tile the piece covers makes a level crossing there, which only a plain straight
    // across the road can be (src/sim/roads.ts).
    for (const t of tiles) {
      if (!this.roads.has(t.x, t.y)) continue;
      const why = crossingRefusal(probe.get(t.x, t.y), t.x, t.y, (rx, ry) =>
        this.roads.has(rx, ry),
      );
      if (why) return { ok: false, cost: {}, reason: why };
    }
    // Rock and mountain take track only as the continuation of a line, so a mountain line is
    // always drawn up from its foot or from track already on the mountain. The ground under it
    // is asked next, as anywhere.
    if (
      tiles.some((t) => stone(terrainAt(this.map, t.x, t.y))) &&
      !continuesLine(this.track, probe, tiles)
    )
      return { ok: false, cost: {}, reason: STR.build.mountainLine };
    // Straights and crossings may climb. Curves and switches need smooth ground on every tile, or a bridge platform under every tile: then
    // they sit at the deck, the level of the rails they meet off the bridge.
    const members = tiles.map((t) => ({ ...t, links: probe.get(t.x, t.y)?.links ?? [] })),
      // Members of a wide piece are parts of a curve or switch, whatever their links look like.
      climbs = !wide && members.some((m) => climbAxes(m.links).length > 0);
    if (this.groundCheck && !climbs && !tiles.every((t) => this.groundCheck!(t.x, t.y, 'level'))) {
      if (!tiles.every((t) => this.bridgeAt(t.x, t.y)))
        return { ok: false, cost: {}, reason: STR.build.notSmooth };
      if (supportedDeck(this.map, members, (bx, by) => !!this.bridgeAt(bx, by)) === null)
        return { ok: false, cost: {}, reason: STR.build.deckLevels };
    }
    for (const t of tiles) {
      const p = probe.get(t.x, t.y);
      if (!p) continue;
      if (climbs && this.groundCheck && !this.groundCheck(t.x, t.y, 'straight'))
        return { ok: false, cost: {}, reason: STR.build.tooSteep };
      for (const [a, b] of p.links)
        for (const d of [a, b]) {
          const nx = t.x + DDX[d];
          const ny = t.y + DDY[d];
          if (tiles.some((q) => q.x === nx && q.y === ny)) continue;
          const q = this.track.get(nx, ny);
          if (!q || !this.track.opensTo(nx, ny, opposite(d))) continue;
          const mine = portClass(p, d),
            theirs = portClass(q, opposite(d));
          // the standard lines join each other; a separate network joins only itself
          if (!classesJoin(mine, theirs))
            return { ok: false, cost: {}, reason: STR.build.gaugeBreak };
        }
    }
    let mul = 0;
    for (const t of tiles) mul = Math.max(mul, this.terrainMul(t.x, t.y));
    return { ok: true, cost: this.priced(pieceCost(kind, item.cls, item.cls2), mul) };
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
    if (!this.pay(c, x, y)) return false;
    if (existing) this.refund(pieceCost(existing.kind, existing.cls, existing.cls2), x, y);
    this.layTrack(x, y, item, rot);
    sfx('build.place');
    return true;
  }
  /** Lay a piece its check let through, with everything that follows from it: no price, no sound. */
  private layTrack(x: number, y: number, item: TrackItem, rot: number) {
    this.log?.track(x, y, { ...item, rot });
    this.trackChanged(this.track.place(x, y, item.kind, rot, item.cls, item.cls2));
  }
  /** The track on `tiles` was laid or lifted: everything that follows from it. */
  private trackChanged(tiles: { x: number; y: number }[]) {
    for (const t of tiles) {
      this.refreshBridgeCapacity(t.x, t.y);
      this.onTrackChanged?.(t.x, t.y);
    }
    // a switch beside a parallel track bends its branch into an S (and back)
    for (const t of this.track.refreshSwitchForms(tiles)) this.onTrackChanged?.(t.x, t.y);
    for (const t of tiles) this.checkOrphans(t.x, t.y);
  }
  /**
   * The piece with its anchor at (x,y) stands already: the same kind, class and turn (a switch's
   * form aside, which the track around it chooses). A line skips it.
   */
  private standing(x: number, y: number, item: TrackItem, rot: number) {
    const [t] = footprintOf(x, y, item.kind, rot, item.cls);
    const p = this.track.get(t.x, t.y);
    if (!p) return false;
    const n = rotationCount(item.kind);
    const anchor = isUnitKind(item.kind, item.cls) ? p.unit?.ax === x && p.unit.ay === y : !p.unit;
    return (
      anchor &&
      p.kind === item.kind &&
      p.cls === item.cls &&
      (item.kind !== 'crossing' || (p.cls2 ?? p.cls) === (item.cls2 ?? item.cls)) &&
      (((p.rot - rot) % n) + n) % n === 0
    );
  }

  /**
   * What moving the pieces on `tiles` one line up or down would change and cost. An upgrade
   * charges, piece by piece, what the new piece costs above the old one; a downgrade is free and
   * returns nothing. `from` is the tile a stroke came from (it picks a crossing's line). `left`
   * holds the anchors of the pieces that stay as they are although the move would change them: a
   * curve or switch of the wrong size, or anything the check refuses.
   */
  checkReclass(
    tiles: { x: number; y: number }[],
    dir: ReclassDir,
    from?: { x: number; y: number },
  ): PlacementCheck & { changes: PieceChange[]; left: { x: number; y: number }[] } {
    const plan = planReclass(this.track, tiles, dir, from);
    const sized = plan.left.map(({ x, y }) => ({ x, y }));
    if (!plan.changes.length) {
      const first = plan.left[0];
      return {
        ok: false,
        cost: {},
        changes: [],
        left: sized,
        reason: first
          ? STR.build.reclassSize(STR.toolbar.trackClass[first.to], first.need, first.n)
          : STR.build.reclass[plan.reason ?? 'nothing'],
      };
    }
    const refused = (reason: string) => ({
      ok: false,
      cost: {},
      changes: plan.changes,
      left: [...sized, ...plan.changes.map(({ x, y }) => ({ x, y }))],
      reason,
    });
    const locked = plan.changes.map(itemAge).find((age) => this.lineLocked(age));
    if (locked !== undefined) return refused(STR.build.tierLocked(locked));
    const crossing = this.reclassCrossing(plan.changes);
    if (crossing) return refused(crossing);
    const cost: Cost = {};
    if (dir === 'up')
      for (const c of plan.changes) {
        const old = this.track.get(c.x, c.y)!;
        let mul = 0;
        for (const t of this.track.unitTiles(c.x, c.y))
          mul = Math.max(mul, this.terrainMul(t.x, t.y));
        // the difference of the two prices as they would be charged here: rounding the
        // difference instead would bill more than the list on any ground but grass
        const was = this.priced(pieceCost(old.kind, old.cls, old.cls2), mul);
        for (const [k, v] of Object.entries(this.priced(pieceCost(c.kind, c.cls, c.cls2), mul)))
          if (v > (was[k] ?? 0)) cost[k] = (cost[k] ?? 0) + v - (was[k] ?? 0);
      }
    // a stroke pays from its first tile
    const at = tiles[0] ?? { x: 0, y: 0 };
    const paid = this.affordable(cost, at.x, at.y);
    if (!paid.ok) return { ...refused(paid.reason ?? ''), cost };
    return { ...paid, changes: plan.changes, left: sized };
  }
  /**
   * Why converting would leave a level crossing on a piece no road may cross (a line without
   * level crossings), or null when it would not: a road keeps its tile, so the piece laid there in the
   * place of the old one has to take it (`crossingRefusal`).
   */
  private reclassCrossing(changes: readonly PieceChange[]): string | null {
    const road = (rx: number, ry: number) => this.roads.has(rx, ry);
    for (const c of changes)
      for (const t of footprintOf(c.x, c.y, c.kind, c.rot, c.cls)) {
        if (!road(t.x, t.y)) continue;
        // every tile of a wide piece is a part of its curve or switch: the kind refuses it
        const why = crossingRefusal(makePiece(c.kind, c.rot, c.cls, c.cls2), t.x, t.y, road);
        if (why) return why;
      }
    return null;
  }
  /** Is a line of age `age` still closed? Main Line opens in the Diesel Age, Trunk Line in the Electric. */
  private lineLocked(age: number) {
    return !this.free && !!rules.lineAgeLocks && age > this.economy.tier;
  }
  /** Move the pieces on `tiles` one standard line up or down. */
  reclassTrack(
    tiles: { x: number; y: number }[],
    dir: ReclassDir,
    from?: { x: number; y: number },
  ): boolean {
    const c = this.checkReclass(tiles, dir, from);
    const at = tiles[0] ?? { x: 0, y: 0 };
    if (!c.ok || !this.pay(c, at.x, at.y)) return false;
    const laid: { x: number; y: number }[] = [];
    for (const p of c.changes) {
      this.log?.track(p.x, p.y, p, dir);
      laid.push(...this.track.place(p.x, p.y, p.kind, p.rot, p.cls, p.cls2, p.form ?? 'turn'));
    }
    for (const t of laid) {
      this.refreshBridgeCapacity(t.x, t.y);
      this.onTrackChanged?.(t.x, t.y);
    }
    // switches keep the form they had: the track around them did not change
    for (const t of laid) this.checkOrphans(t.x, t.y);
    sfx('build.place');
    this.onReclassed?.(
      c.changes.map((p) => ({ x: p.x, y: p.y })),
      dir,
    );
    return true;
  }
  /** Compatibility: lay a Branch Line piece by kind. */
  placeTrackKind(x: number, y: number, kind: TrackKind, rot: number) {
    return this.placeTrack(x, y, { kind, cls: 'branch', cls2: 'branch' }, rot);
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
    const anchor = this.track.anchorOf(x, y);
    this.log?.track(anchor.x, anchor.y, null);
    this.track.removeAt(x, y);
    this.refund(pieceCost(p.kind, p.cls, p.cls2), x, y);
    this.trackChanged(tiles);
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

  // ------------------------------------------------------------------ lines
  /**
   * Price and judge a line (a dragged run of track, a bridge with its rail) as a whole. Each piece
   * is judged as if the pieces before it stood already. A track piece that stands already is
   * skipped at no cost; any other track in the way refuses the line, which never replaces or
   * removes anything. A platform that stands already is skipped too; any other follows the rule
   * `checkBuilding` gives it. The line is refused for its first refused piece, or for a total the
   * stock cannot pay.
   */
  checkLine(pieces: readonly LinePiece[]): LineCheck {
    const probe = this.probe();
    const steps: LineStep[] = [];
    const cost: Cost = {};
    let at: number | undefined;
    for (const p of pieces) {
      const step = probe.judge(p);
      steps.push(step);
      if (!step.ok) at ??= steps.length - 1;
      if (!step.ok || step.skip) continue;
      for (const [k, v] of Object.entries(step.cost)) cost[k] = (cost[k] ?? 0) + v;
      probe.lay(p);
    }
    if (at !== undefined) return { ok: false, cost, reason: steps[at].reason, at, steps };
    // a line pays from its first tile
    const first = pieces[0] ?? { x: 0, y: 0 };
    return { ...this.affordable(cost, first.x, first.y), steps };
  }
  /** Lay every piece of a line and pay its total, or, when `checkLine` refuses it, nothing. */
  placeLine(pieces: readonly LinePiece[]): boolean {
    const c = this.checkLine(pieces);
    const first = pieces[0] ?? { x: 0, y: 0 };
    if (!c.ok || !this.pay(c, first.x, first.y)) return false;
    let laid = false;
    pieces.forEach((p, i) => {
      if (c.steps[i].skip) return;
      this.lay(p);
      laid = true;
    });
    if (laid) sfx('build.place');
    return true;
  }
  /**
   * A copy of this builder's world to judge a dragged run on piece by piece, as the Track tool
   * lays it: `checkTrack` judges a piece with the ones before it down, and `lay` puts one down
   * there with no price, no sound and nothing changed here.
   */
  runProbe() {
    const p = this.probe();
    return {
      track: p.track,
      checkTrack: (x: number, y: number, item: TrackItem, rot: number) =>
        p.checkTrack(x, y, item, rot),
      lay: (x: number, y: number, item: TrackItem, rot: number) => p.layTrack(x, y, item, rot),
    };
  }
  /** One piece of a line against this builder's world as it stands, without the stock. */
  private judge(p: LinePiece): LineStep {
    if (p.kind === 'track') {
      if (this.standing(p.x, p.y, p.item, p.rot)) return { ok: true, cost: {}, skip: true };
      return this.trackRules(p.x, p.y, p.item, p.rot, false);
    }
    if (!buildingDef(p.defId).bridge) throw new Error(`not a bridge platform: ${p.defId}`);
    if (inBounds(this.map, p.x, p.y) && this.buildingAt(p.x, p.y)?.id === p.defId)
      return { ok: true, cost: {}, skip: true };
    return this.buildingRules(p.x, p.y, p.defId);
  }
  private lay(p: LinePiece) {
    if (p.kind === 'track') this.layTrack(p.x, p.y, p.item, p.rot);
    else this.layBuilding(p.x, p.y, p.defId, 0);
  }
  /**
   * A builder to judge a line on: the same map, regions, economy, stock and rules, with copies of
   * the track, stations, decor and buildings and no callbacks. Laying on it changes none of this
   * builder's state, and it lays exactly as this builder would.
   */
  private probe(): Builder {
    const track = new TrackGraph(this.track.w, this.track.h);
    for (const [k, p] of this.track.pieces) track.pieces.set(k, p);
    const b = new Builder(this.map, this.regions, track, this.economy, this.stores, this.roads);
    b.free = this.free;
    b.groundCheck = this.groundCheck;
    b.stations.push(...this.stations);
    for (const [k, d] of this.decor) b.decor.set(k, d);
    for (const [k, w] of this.buildings) b.buildings.set(k, w);
    return b;
  }

  // ------------------------------------------------------------------ stations
  /** Minimum Chebyshev distance between two town stations. */
  static readonly TOWN_SPACING = 25;
  checkStation(x: number, y: number, defId: string, rot = 0): PlacementCheck {
    const def = stationDef(defId);
    if (def.gauge === 'narrow' && !rules.narrowUnlocked)
      return { ok: false, cost: {}, reason: STR.build.narrowLocked };
    for (const { x: tx, y: ty } of stationFootprint(defId, x, y, rot)) {
      if (!inBounds(this.map, tx, ty)) return { ok: false, cost: {}, reason: STR.build.offMap };
      if (!this.unlocked(tx, ty)) return { ok: false, cost: {}, reason: STR.build.locked };
      const bad = unbuildable(terrainAt(this.map, tx, ty));
      if (bad) return { ok: false, cost: {}, reason: bad };
      if (
        this.track.railOn(tx, ty) ||
        this.stationAt(tx, ty) ||
        this.decorAt(tx, ty) ||
        this.buildingAt(tx, ty)
      )
        return { ok: false, cost: {}, reason: STR.build.occupied };
      if (this.roads.has(tx, ty)) return { ok: false, cost: {}, reason: STR.build.roadInWay };
      if (this.groundCheck && !this.groundCheck(tx, ty, 'level'))
        return { ok: false, cost: {}, reason: STR.build.notLevel };
    }
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(def.tier) };
    if (!this.free && !inSupplyMode(def))
      return { ok: false, cost: {}, reason: STR.build.supplyLocked };
    if (def.depot && !this.free) {
      const allowed = this.depotsAllowed();
      const have = this.depotsOf(def.gauge ?? 'regular').length;
      if (have >= allowed)
        return { ok: false, cost: {}, reason: STR.build.depotLocked(allowed * 9) };
    }
    if (defId === 'town') {
      const near = this.stations.find(
        (s) => s.def.id === 'town' && s.distTo(x, y) < Builder.TOWN_SPACING,
      );
      if (near)
        return { ok: false, cost: {}, reason: STR.build.townTooClose(Builder.TOWN_SPACING) };
    }
    if (!def.depot && !this.hasAdjacentTrack(x, y, defId, rot))
      return { ok: false, cost: {}, reason: STR.build.needTrack };
    const own = this.stationGround(def, stationFootprint(defId, x, y, rot));
    if (own) return { ok: false, cost: {}, reason: own };
    return this.affordable(
      this.priced(
        def.cost,
        Math.max(1, this.terrainMul(x, y)) * (def.depot ? 1 : this.kindMul(defId)),
      ),
      x,
      y,
    );
  }
  /**
   * A station's own ground rules, asked after the rules every station keeps: one with `standOn`
   * goes only on those terrains, then one that `needsWater` only with water on one of the four
   * sides of its footprint, water of any biome (a lake, a river, the sea, a swamp's ponds). The
   * reason it is refused, or null. Asked when placing only, so a station a save holds where these
   * would refuse it keeps its place.
   */
  private stationGround(def: StationDef, tiles: { x: number; y: number }[]): string | null {
    const ground = def.standOn as readonly string[] | undefined;
    if (ground && tiles.some((t) => !ground.includes(TERRAIN_NAMES[terrainAt(this.map, t.x, t.y)])))
      return STR.build.standOn[def.id] ?? STR.build.needGround(ground);
    if (def.needsWater && !this.waterBeside(tiles))
      return STR.build.besideWater[def.id] ?? STR.build.needWaterside;
    return null;
  }
  /** Water lies on one of the four sides of a footprint: next to one of its tiles, outside it. */
  private waterBeside(tiles: { x: number; y: number }[]) {
    const inside = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);
    return tiles.some((t) =>
      DIRS.some((d) => {
        const x = t.x + DDX[d],
          y = t.y + DDY[d];
        return !inside(x, y) && terrainAt(this.map, x, y) === Terrain.Water;
      }),
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
  /**
   * Place a station turned to `rot`, one of the four rotations (`BUILDING_ROTATIONS`); its
   * footprint and gates follow the rotation's axis, so `rot` and `rot + 2` cover the same tiles.
   * Its street door, on the side away from its platform, gets its spur to the roads, free
   * (`connectPlace`).
   */
  placeStation(x: number, y: number, defId: string, rot = 0): Station | null {
    const turn = wrapRotation(rot);
    const c = this.checkStation(x, y, defId, turn);
    if (!c.ok || !this.pay(c, x, y)) return null;
    const count = this.stations.filter((s) => s.def.id === defId).length;
    const s = new Station(
      defId,
      x,
      y,
      count ? `${dataName(stationDef(defId))} ${count + 1}` : undefined,
    );
    s.rot = turn;
    s.terrainFactor = terrainFactorAt(this.map, x, y, defId);
    this.log?.station(s, true);
    this.stations.push(s);
    this.refreshStationBoosts();
    this.stationChanged(s, false);
    if (s.def.produces.length) this.onIndustryPlaced?.(x, y);
    this.connectPlace(stationPlace(s));
    sfx('build.place');
    return s;
  }
  removeStation(s: Station): boolean {
    const i = this.stations.indexOf(s);
    if (i < 0) return false;
    this.log?.station(s, false);
    this.stations.splice(i, 1);
    // removed during its upgrade, it is gone for good: no level rises later
    s.work = null;
    this.refund(s.def.cost, s.x, s.y);
    this.stationChanged(s, true);
    return true;
  }
  /**
   * Whether a station may rise a level: one level per age from the age it appears in, and not
   * while an upgrade runs.
   */
  canUpgrade(s: Station): PlacementCheck {
    if (s.work) return { ok: false, cost: {}, reason: STR.build.upgradingNow };
    if (s.level >= MAX_LEVEL) return { ok: false, cost: {}, reason: STR.station.maxed };
    if (this.free) return { ok: true, cost: {} };
    const locked = levelLocked(s.firstAge, s.level + 1, this.economy.tier);
    if (locked) return { ok: false, cost: s.upgradeCost(), reason: locked };
    return this.affordable(s.upgradeCost(), s.x, s.y);
  }
  /** Editor only: lower a station's level (an upgrade under way is dropped with it). */
  downgradeStation(s: Station): boolean {
    if (!this.free || s.level <= 1) return false;
    this.log?.stationLevel(s);
    s.level--;
    s.work = null;
    this.stationChanged(s, false);
    return true;
  }
  /**
   * Pay for the next level and start the work: the station closes until its time is up
   * (`tickWorks`). A depot's upgrade, the editor's, and any when upgrades take no time raise the
   * level at once.
   */
  upgradeStation(s: Station): boolean {
    if (!this.stations.includes(s)) return false;
    const c = this.canUpgrade(s);
    if (!c.ok || !this.pay(c, s.x, s.y)) return false;
    sfx('station.upgrade');
    this.log?.stationLevel(s);
    const work = s.def.depot || this.free ? null : startWork(s.level + 1);
    if (!work) {
      this.finishStation(s);
      return true;
    }
    s.work = work;
    this.stationChanged(s, false);
    return true;
  }
  /** The station's level rises by one: it opens again, and the change is reported. */
  private finishStation(s: Station) {
    s.level = Math.min(MAX_LEVEL, s.level + 1);
    s.work = null;
    this.stationChanged(s, false);
    this.onUpgraded?.({
      kind: 'station',
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      name: s.name,
      level: s.level,
    });
  }

  // ------------------------------------------------------------------ decor
  /** Placement rules for decor without the price check (the reason when it cannot stand here). */
  canPlaceDecor(x: number, y: number, defId: string): string | null {
    const def = decorDef(defId);
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    if (this.decorAt(x, y) || this.buildingAt(x, y)) return STR.build.occupied;
    if (onRails(defId)) {
      if (!this.track.railOn(x, y)) return STR.build.needTrackHere;
    } else {
      const bad = unbuildable(terrainAt(this.map, x, y));
      if (bad) return bad;
      if (this.stationAt(x, y)) return STR.build.occupied;
      if (!def.anyTile && this.track.railOn(x, y)) return STR.build.occupied;
      // a road keeps its tile from what stands off the rails; a pole goes beside it
      if (!def.anyTile && this.roads.has(x, y)) return STR.build.roadInWay;
      if (!def.anyTile && this.groundCheck && !this.groundCheck(x, y, 'level'))
        return STR.build.notLevel;
    }
    return null;
  }
  checkDecor(x: number, y: number, defId: string): PlacementCheck {
    const reason = this.canPlaceDecor(x, y, defId);
    if (reason) return { ok: false, cost: {}, reason };
    return this.affordable(this.priced(decorDef(defId).cost, this.kindMul(defId)), x, y);
  }
  /**
   * Place decor turned to `rot`, and pay for it. A house or a service stop gets its spur to the
   * roads, free (`connectPlace`).
   */
  placeDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    const c = this.checkDecor(x, y, defId);
    if (!c.ok || !this.pay(c, x, y)) return null;
    const d = this.addDecor(x, y, defId, rot);
    this.connectPlace(decorPlace(d));
    return d;
  }
  /**
   * Decor the world builds itself (a town raising a house): no price, still needs a free tile, and
   * no spur: the game lays roads only for what the player places.
   */
  spawnDecor(x: number, y: number, defId: string, rot: number): Decor | null {
    if (this.canPlaceDecor(x, y, defId)) return null;
    return this.addDecor(x, y, defId, rot);
  }
  private addDecor(x: number, y: number, defId: string, rot: number): Decor {
    const d: Decor = { id: defId, x, y, rot: rot % decorDef(defId).rotations };
    this.log?.decor(d, true);
    this.standDecor(d);
    sfx('build.place');
    return d;
  }
  decorRefund(d: Decor): Cost {
    return this.free ? {} : scaleCost(decorDef(d.id).cost, rules.buildCostMul * rules.refundRate);
  }
  removeDecor(x: number, y: number): boolean {
    const d = this.decorAt(x, y);
    if (!d) return false;
    this.log?.decor(d, false);
    this.refund(decorDef(d.id).cost, x, y);
    this.dropDecor(d);
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
  /**
   * Whether a works may stand with its corner at (x, y), turned to `rot`: every tile of its
   * footprint (`buildingFootprint`) must be on the map, unlocked, buildable, level and free of
   * track, stations, decor, works and roads, as `checkStation` asks of a station. The site rules
   * are asked of the footprint as a whole: water must lie beside it (on a side of any of its
   * tiles, `waterBeside`), and the ground it needs (`terrain`) and the deposit (`deposit`) must be
   * under any one of its tiles, so a colliery on a 3 x 2 needs a hill, not six.
   */
  checkBuilding(x: number, y: number, defId: string, rot = 0): PlacementCheck {
    const c = this.buildingRules(x, y, defId, rot);
    return c.ok ? this.affordable(c.cost, x, y) : c;
  }
  /** `checkBuilding`'s rules and price, without asking whether the stock can pay. */
  private buildingRules(x: number, y: number, defId: string, rot = 0): PlacementCheck {
    const def = buildingDef(defId);
    const tiles = buildingFootprint(defId, x, y, wrapRotation(rot));
    for (const t of tiles) {
      if (!inBounds(this.map, t.x, t.y)) return { ok: false, cost: {}, reason: STR.build.offMap };
      if (!this.unlocked(t.x, t.y)) return { ok: false, cost: {}, reason: STR.build.locked };
    }
    if (!this.free && def.tier > this.economy.tier)
      return { ok: false, cost: {}, reason: STR.build.tierLocked(def.tier) };
    if (!this.free && !inSupplyMode(def))
      return { ok: false, cost: {}, reason: STR.build.supplyLocked };
    for (const { x: tx, y: ty } of tiles) {
      const t = terrainAt(this.map, tx, ty);
      // Bridge platforms stand on water or carry a rail level across a dip in the land.
      const bad = def.bridge && t === Terrain.Water ? null : unbuildable(t);
      if (bad) return { ok: false, cost: {}, reason: bad };
      if (!def.bridge && this.groundCheck && !this.groundCheck(tx, ty, 'level'))
        return { ok: false, cost: {}, reason: STR.build.notLevel };
      if (
        (def.bridge ? this.track.has(tx, ty) : this.track.railOn(tx, ty)) ||
        this.stationAt(tx, ty) ||
        this.decorAt(tx, ty) ||
        this.buildingAt(tx, ty)
      )
        return { ok: false, cost: {}, reason: STR.build.occupied };
      if (this.roads.has(tx, ty)) return { ok: false, cost: {}, reason: STR.build.roadInWay };
    }
    if (def.needsWater && !this.waterBeside(tiles))
      return { ok: false, cost: {}, reason: STR.build.needWaterside };
    if (
      def.terrain &&
      !tiles.some((t) => TERRAIN_NAMES[terrainAt(this.map, t.x, t.y)].toLowerCase() === def.terrain)
    )
      return { ok: false, cost: {}, reason: STR.build.needTerrain(def.terrain) };
    if (def.deposit && !tiles.some((t) => this.hasDeposit(t.x, t.y, def.deposit!)))
      return { ok: false, cost: {}, reason: STR.build.needDeposit(def.deposit) };
    return { ok: true, cost: this.priced(def.cost, def.bridge ? 1 : this.kindMul(defId)) };
  }
  /** A deposit prop (coal seam, oil seep) lies on the tile. */
  hasDeposit(x: number, y: number, kind: string) {
    return !!this.map.props.get(this.key(x, y))?.some((p) => p.kind === kind);
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
    return this.affordable(this.priced(SUPPLY_DEFS[kind].cost, 1), x, y);
  }
  placeSupply(x: number, y: number, kind: SupplyKind): boolean {
    if (!this.catenary) return false;
    const c = this.checkSupply(x, y, kind);
    if (!c.ok || !this.pay(c, x, y)) return false;
    const old = this.catenary.supplyAt(x, y);
    if (old) this.refund(SUPPLY_DEFS[old].cost, x, y);
    this.log?.supply(x, y, kind);
    this.catenary.set(x, y, kind);
    this.onSupplyChanged?.(x, y);
    sfx('build.place');
    return true;
  }
  removeSupply(x: number, y: number): boolean {
    const old = this.catenary?.supplyAt(x, y);
    if (!old || !this.catenary) return false;
    this.log?.supply(x, y, null);
    this.catenary.remove(x, y);
    this.refund(SUPPLY_DEFS[old].cost, x, y);
    this.onSupplyChanged?.(x, y);
    sfx('build.remove');
    return true;
  }
  /**
   * Place a works turned to `rot`, one of the four rotations (`BUILDING_ROTATIONS`). A works with
   * a crew gets its spur to the roads, free (`connectPlace`); a bridge platform has no door.
   */
  placeBuilding(x: number, y: number, defId: string, rot = 0): Building | null {
    const turn = wrapRotation(rot);
    const c = this.checkBuilding(x, y, defId, turn);
    if (!c.ok || !this.pay(c, x, y)) return null;
    const b = this.layBuilding(x, y, defId, turn);
    this.connectPlace(buildingPlace(b));
    sfx('build.place');
    return b;
  }
  /** Raise a works or a platform its check let through: no price, no sound. */
  private layBuilding(x: number, y: number, defId: string, rot: number): Building {
    const b: Building = { id: defId, x, y, acc: 0, rot, active: false, rate: 0 };
    this.log?.building(b, true);
    this.standBuilding(b);
    this.onIndustryPlaced?.(x, y);
    return b;
  }
  buildingRefund(b: Building): Cost {
    return this.free
      ? {}
      : scaleCost(buildingDef(b.id).cost, rules.buildCostMul * rules.refundRate);
  }
  /** Take down the works that covers (x, y), whichever tile of its footprint that is: all of it goes. */
  removeBuilding(x: number, y: number): boolean {
    const b = this.buildingAt(x, y);
    // a platform goes only with nothing on it: its rail or its road comes off first
    if (!b || (buildingDef(b.id).bridge && (this.track.has(x, y) || this.roads.has(x, y))))
      return false;
    this.log?.building(b, false);
    this.refund(buildingDef(b.id).cost, b.x, b.y);
    this.dropBuilding(b);
    sfx('build.remove');
    return true;
  }

  // ------------------------------------------------------------------ roads
  /**
   * Whether a road may be laid on (x, y), and its price: on owned buildable land (not water, rock
   * or a mountain) with no road on it yet, off every station's footprint and works and off the
   * tile of decor that stands off the rails (a house, a tower), as a road meets a building only at
   * a street door, from the tile outside it (#408); a signal or a pole may share its tile. On track
   * it is a level crossing, which only a plain straight of a line with level crossings takes, the road
   * across it (`Roads.trackRefusal`). A bridge platform carries a road where it carries no rail,
   * on water as on land: one tile holds rail or road, never both, so a platform with rail on it
   * refuses the road (#493). Each tile costs `roadCost`, scaled by the build cost tuning, whatever
   * the ground.
   */
  checkRoad(x: number, y: number): PlacementCheck {
    const reason = this.roadRules(x, y);
    if (reason) return { ok: false, cost: {}, reason };
    return this.affordable(this.priced(roadCost(), 1), x, y);
  }
  /** `checkRoad`'s rules without the price, against `roads`: this builder's, or a copy. */
  private roadRules(x: number, y: number, roads = this.roads): string | null {
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    if (roads.has(x, y)) return STR.build.roadHere;
    const deck = this.bridgeAt(x, y);
    const bad = unbuildable(terrainAt(this.map, x, y));
    // a platform stands on water or on land, never on rock or a mountain (`buildingRules`)
    if (bad && !deck) return bad;
    if (deck && this.track.has(x, y)) return STR.build.bridgeCarriesRail;
    const dec = this.decorAt(x, y);
    if (
      this.stationAt(x, y) ||
      (this.buildingAt(x, y) && !deck) ||
      (dec && !decorDef(dec.id).onTrack)
    )
      return STR.build.roadOnBuilding;
    return roads.trackRefusal(x, y);
  }
  /**
   * Lay a road on (x, y) and pay for it; false, with nothing paid, when `checkRoad` refuses. A
   * street door near it with no road gets its spur, free (`connectNear`).
   */
  placeRoad(x: number, y: number): boolean {
    return this.placeRoads([{ x, y }], { x, y }).length === 1;
  }
  /**
   * Lay a stroke of road (#328), its tiles in order, the whole stroke paid by one store: the one
   * that pays it from `from`, the stroke's first tile (`affordable`). Each tile is judged by
   * `checkRoad`'s rules with the tiles before it laid, and laid while that store still pays for
   * the stroke so far with it; a tile refused is left out and costs nothing. Each tile laid gets
   * the spurs it brings (`connectNear`). Returns the tiles laid.
   */
  placeRoads(tiles: readonly { x: number; y: number }[], from: { x: number; y: number }) {
    const laid: { x: number; y: number }[] = [];
    let cost: Cost = {};
    for (const t of tiles) {
      if (this.roadRules(t.x, t.y)) continue;
      const more: Cost = { ...cost };
      for (const [k, v] of Object.entries(this.priced(roadCost(), 1))) more[k] = (more[k] ?? 0) + v;
      if (!this.affordable(more, from.x, from.y).ok) continue;
      cost = more;
      this.log?.road(t.x, t.y, true);
      this.roads.add(t.x, t.y);
      this.onRoadChanged?.(t.x, t.y);
      this.connectNear(t.x, t.y);
      sfx('build.place');
      laid.push(t);
    }
    // nothing was paid while laying, so the store that took the last tile pays the whole
    if (laid.length) this.pay(this.affordable(cost, from.x, from.y), from.x, from.y);
    return laid;
  }
  /** What `removeRoad` gives back: the refund share of a road's cost, each part rounded down. */
  roadRefund(): Cost {
    const out: Cost = {};
    if (this.free) return out;
    for (const [k, v] of Object.entries(roadCost())) out[k] = Math.floor(v * rules.refundRate);
    return out;
  }
  /**
   * Take the road off (x, y) for its refund; the track of a level crossing stays. A spur is a road
   * like any other: it comes up the same way, for the same refund.
   */
  removeRoad(x: number, y: number): boolean {
    if (!this.roads.has(x, y)) return false;
    this.log?.road(x, y, false);
    this.roads.remove(x, y);
    this.refund(roadCost(), x, y);
    this.onRoadChanged?.(x, y);
    sfx('build.remove');
    return true;
  }

  // ------------------------------------------------------------------ doors and spurs (#408)
  /**
   * Every place built that has doors (`hasDoors`), where it stands: each station, works with a
   * crew, house and service stop, in that order. One closed for its upgrade keeps its doors.
   */
  doorPlaces(): PlaceAt[] {
    const out: PlaceAt[] = this.stations.map(stationPlace);
    for (const b of this.buildings.values()) out.push(buildingPlace(b));
    for (const d of this.decor.values()) out.push(decorPlace(d));
    return out.filter((p) => hasDoors(p.def));
  }
  /** The street doors of every place built (`doorPlaces`), in that order. */
  streetDoors(): Door[] {
    return this.doorPlaces().flatMap(streetDoors);
  }
  /**
   * What the road on (x, y) joins (`roadLinks`): the roads beside it, and the street doors of the
   * places built that face it. A caller asking about many tiles reads `streetDoors` once.
   */
  roadLinks(x: number, y: number, doors: readonly Door[] = this.streetDoors()): RoadLinks {
    return roadLinks(this.roads, doors, x, y);
  }
  /** A road stands on the reach tile of one of the place's street doors (`roadServes`). */
  roadServes(place: PlaceAt): boolean {
    return roadServes(this.roads, place);
  }
  /**
   * A place was placed: each of its street doors gets its spur (`laySpur`) where a road of the
   * network is near enough, and no road tile otherwise; a road laid near the door later brings it
   * its spur (`connectNear`). Nothing for what has no door. A place is turned by placing it anew:
   * it gets the spur of its door where it faces now, and the spur it had stays, a road like any
   * other.
   */
  private connectPlace(p: PlaceAt) {
    if (!hasDoors(p.def)) return;
    const site = this.spurSite();
    for (const d of streetDoors(p)) this.laySpur(d, site);
  }
  /**
   * A road was laid on (x, y): each street door with no road on its reach tile within SPUR_REACH
   * tiles of it (|dx| + |dy|) gets its spur, when a road is near enough: a door of a place from
   * before spurs, or one whose reach tile took no road when it was placed.
   */
  private connectNear(x: number, y: number) {
    const near = this.streetDoors().filter(
      (d) =>
        Math.abs(d.reach.x - x) + Math.abs(d.reach.y - y) <= SPUR_REACH &&
        !this.roads.has(d.reach.x, d.reach.y),
    );
    if (!near.length) return;
    const site = this.spurSite();
    for (const d of near) this.laySpur(d, site);
  }
  /**
   * What every spur laid now is judged against. `platforms`: the keys of the tiles a spur keeps
   * off, every station's platform (`platformTiles`, its gate tiles that hold track) and every
   * depot's gates, track or none, where its gate track goes. `reaches`: the keys of every street
   * door's reach tile.
   */
  private spurSite(): { platforms: Set<number>; reaches: Set<number> } {
    const platforms = new Set<number>();
    for (const s of this.stations)
      for (const g of s.def.depot ? s.gateTiles() : this.platformTiles(s))
        platforms.add(this.key(g.x, g.y));
    const reaches = new Set(this.streetDoors().map((d) => this.key(d.reach.x, d.reach.y)));
    return { platforms, reaches };
  }
  /**
   * Whether the road on a tile belongs to the road network a spur joins: its road runs on, tile to
   * side-sharing tile, to a tile that is no street door's reach (`reaches`). A door's reach tile
   * laid alone, or a few side by side, is no network: two places near each other are not joined
   * by roads the player never laid. Worked out once for each run of road asked about.
   */
  private network(reaches: Set<number>): (x: number, y: number) => boolean {
    const known = new Map<number, boolean>();
    return (x, y) => {
      if (!this.roads.has(x, y)) return false;
      const start = this.key(x, y);
      const seen = known.get(start);
      if (seen !== undefined) return seen;
      const run = [start];
      const inRun = new Set(run);
      let joins = false;
      for (let i = 0; i < run.length; i++) {
        const k = run[i];
        if (!reaches.has(k)) joins = true;
        const kx = k % this.map.w;
        const ky = Math.floor(k / this.map.w);
        for (const d of DIRS) {
          const nx = kx + DIR_DX[d];
          const ny = ky + DIR_DY[d];
          const nk = this.key(nx, ny);
          if (this.roads.has(nx, ny) && !inRun.has(nk)) {
            inRun.add(nk);
            run.push(nk);
          }
        }
      }
      for (const k of run) known.set(k, joins);
      return joins;
    };
  }
  /**
   * Lay the road from a street door to the road network, free (D2, the author on 2026-10-14): the
   * spur `findSpur` finds from the door's reach tile to the nearest road of the network
   * (`network`), the fewest tiles that keep every rule below, at most SPUR_REACH of them. Every
   * tile of it is one a road could be laid on (`checkRoad`'s rules, judged tile by tile as if the
   * tiles before it stood, the stock aside), on land the player owns even where the builder lifts
   * the lock, off every station's platform and depot's gates (`spurSite`), which a road to a
   * door never touches (#406 D1), and off every bridge platform, which carries a road only where
   * the player lays one (#493). With no road that near, or none a spur keeping to those rules
   * reaches, nothing is laid: a lone road tile at a door would be one the player can neither see
   * nor remove until roads are drawn (#329) and can be removed (#409). Nothing either when the
   * reach tile holds a road already or can take none. Each tile laid is told (`onRoadChanged`);
   * nothing is paid. The tiles laid, the reach tile first.
   */
  private laySpur(
    door: Door,
    site: { platforms: Set<number>; reaches: Set<number> },
  ): { x: number; y: number }[] {
    const open = (x: number, y: number, roads = this.roads) =>
      !this.roadRules(x, y, roads) &&
      !this.bridgeAt(x, y) &&
      this.regions.isTileUnlocked(x, y) &&
      !site.platforms.has(this.key(x, y));
    const { reach } = door;
    if (!open(reach.x, reach.y)) return [];
    let tiles = findSpur(this.roads, reach, open, this.network(site.reaches));
    if (tiles) {
      // judged whole once more, by `checkRoad`'s rules: `findSpur` already keeps every tile off
      // the rails of the spur's own crossings, the one rule a tile of it could break for another
      const tried = this.roads.copy();
      for (const t of tiles) {
        if (!open(t.x, t.y, tried)) {
          tiles = null;
          break;
        }
        tried.add(t.x, t.y);
      }
    }
    if (!tiles) return [];
    for (const t of tiles) {
      this.log?.road(t.x, t.y, true, true);
      this.roads.add(t.x, t.y);
      this.onRoadChanged?.(t.x, t.y);
    }
    return tiles;
  }

  // ------------------------------------------------------------------ undo and redo
  // What a step does to the world, piece by piece (src/sim/buildLog.ts): no rule is asked and
  // nothing is paid, as the step has checked it and moves the goods itself, and every change is
  // told the way placing and removing tell it, so all that is derived from the world follows.

  /** Lay `piece` with its anchor at (x, y), over what stands there; null lifts what stands there. */
  setTrack(x: number, y: number, piece: PieceSpec | null) {
    this.trackChanged(
      piece
        ? this.track.place(x, y, piece.kind, piece.rot, piece.cls, piece.cls2, piece.form ?? 'turn')
        : this.track.removeAt(x, y),
    );
  }
  setSupply(x: number, y: number, kind: SupplyKind | null) {
    if (kind) this.catenary?.set(x, y, kind);
    else this.catenary?.remove(x, y);
    this.onSupplyChanged?.(x, y);
  }
  setRoad(x: number, y: number, laid: boolean) {
    if (laid) this.roads.add(x, y);
    else this.roads.remove(x, y);
    this.onRoadChanged?.(x, y);
  }
  /** A station back in the place it had in the list; `warn`: it says so if it has no platform. */
  standStation(s: Station, index: number, warn: boolean) {
    this.stations.splice(index, 0, s);
    this.refreshStationBoosts();
    this.stationChanged(s, false);
    if (warn) this.onStationOrphaned?.(s, this.isOrphaned(s));
  }
  dropStation(s: Station) {
    this.stations.splice(this.stations.indexOf(s), 1);
    s.work = null;
    this.stationChanged(s, true);
  }
  standDecor(d: Decor) {
    this.decor.set(this.key(d.x, d.y), d);
    this.onDecorChanged?.(d, false);
    this.refreshStationBoosts();
  }
  dropDecor(d: Decor) {
    this.decor.delete(this.key(d.x, d.y));
    this.onDecorChanged?.(d, true);
    this.refreshStationBoosts();
  }
  standBuilding(b: Building) {
    this.buildings.set(this.key(b.x, b.y), b);
    this.buildingChanged(b, false);
  }
  dropBuilding(b: Building) {
    this.buildings.delete(this.key(b.x, b.y));
    // removed during its upgrade, it is gone for good: no level rises later
    delete b.work;
    this.buildingChanged(b, true);
  }
  setStationLevel(s: Station, level: number, work: Work | null) {
    s.level = level;
    s.work = work;
    this.stationChanged(s, false);
  }
  setWorksLevel(b: Building, level: number | undefined, work: Work | undefined) {
    b.level = level;
    if (work) b.work = work;
    else delete b.work;
    this.worksLevelChanged(b);
  }
}

/** A cost asks for something: any good above zero. */
function hasPrice(cost: Cost) {
  return Object.values(cost).some((v) => v > 0);
}
/** A station where it stands, as a place with doors (src/sim/doors.ts). */
export function stationPlace(s: Station): PlaceAt {
  return { def: s.def, x: s.x, y: s.y, rot: s.rot };
}
/** A works or a bridge platform where it stands (a platform has no door: `hasDoors`). */
export function buildingPlace(b: Building): PlaceAt {
  return { def: buildingDef(b.id), x: b.x, y: b.y, rot: b.rot ?? 0 };
}
/** Decor where it stands (only a house or a service stop has a door: `hasDoors`). */
export function decorPlace(d: Decor): PlaceAt {
  return { def: decorDef(d.id), x: d.x, y: d.y, rot: d.rot };
}
export { BUILDING_DEFS };
