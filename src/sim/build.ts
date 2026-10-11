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
import { content, type DecorDef, type Cost, type Gauge } from '../data/content';
import { rules } from './rules';
import {
  Station,
  terrainFactorAt,
  stationDef,
  stationFootprint,
  maxLevelForTier,
  MAX_LEVEL,
} from './stations';
import type { Economy } from './economy';
import { Stockpile, scaleCost } from './stockpile';
import {
  buildingDef,
  buildingLevel,
  buildingUpgradeCost,
  BUILDING_DEFS,
  type Building,
} from './buildings';
import { biomeDef, biomeAt } from './biomes';
import { inSupplyMode } from './supply';
import { STR } from '../strings';
import { bridgeCapacity } from './bridges';
import { climbAxes, supportedDeck } from '../world/railProfile';
import { levelAt, MAX_LEVEL as HIGHEST_LEVEL } from '../world/elevation';
import type { Dir } from '../engine/iso';
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
  /**
   * The rendered hill decides what its ground carries: `straight` rails climb at most one level
   * per tile, `level` pieces and structures need a level tile. Unset means level everywhere.
   */
  groundCheck: ((x: number, y: number, need: 'straight' | 'level') => boolean) | null = null;
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
  /**
   * The level of the rail on a tile in the current rail profile (set by the game): where an
   * automatic bridge deck stands once track lies on it. Undefined where no straight rail runs.
   */
  autoDeck: ((x: number, y: number) => number | undefined) | null = null;
  /** A train stands on the tile (set by the game): no deck moves under it. */
  busy: ((x: number, y: number) => boolean) | null = null;

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
  // ------------------------------------------------------------------ bridge decks
  /**
   * Deck height of a bridge platform, in levels: what the player set, else the level of the rail
   * it carries, else the ground (or water) it lies on. Never below that ground, as in the rail
   * profile (the terrain under a platform can change in the editor).
   */
  deckLevel(b: Building) {
    return this.railLevelAt(b.x, b.y);
  }
  /** Level of the rail on a track tile: a deck set by hand, the rail profile, or the ground. */
  private railLevelAt(x: number, y: number) {
    const ground = levelAt(this.map, x, y);
    return Math.max(ground, this.bridgeAt(x, y)?.deck ?? this.autoDeck?.(x, y) ?? ground);
  }
  /** Can the rail of piece `p` bend where it leaves through edge `d`? Only a straight run can. */
  private bends(p: TrackPiece, d: Dir) {
    return !p.unit && p.links.some(([a, b]) => a === opposite(b) && (a === d || b === d));
  }
  /** Platforms joined edge to edge with `b`, itself included: one bridge. */
  bridgeGroup(b: Building): Building[] {
    const seen = new Set<Building>([b]),
      out = [b];
    for (let i = 0; i < out.length; i++)
      for (const d of DIRS) {
        const n = this.bridgeAt(out[i].x + DIR_DX[d], out[i].y + DIR_DY[d]);
        if (n && !seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
      }
    return out;
  }
  /**
   * Can the deck of a platform move by `delta` levels (docs/rail-inclines.md)? A deck stands
   * between the ground under it and the highest level. Rail on it climbs one level per tile at
   * most to the rail beside it and meets a curve or switch at that piece's own level; a curve,
   * switch or crossing on the deck stays where it was laid, and so does a station platform.
   * Nothing moves under a train. `level` is the height the deck would take; `limit` says that
   * the deck already stands at its floor or at the greatest height.
   */
  checkDeck(
    b: Building,
    delta: number,
  ): { ok: boolean; level: number; reason?: string; limit?: 'floor' | 'ceiling' } {
    const level = this.deckLevel(b) + delta,
      why = STR.build.deck,
      no = (reason: string) => ({ ok: false, level, reason });
    if (level < levelAt(this.map, b.x, b.y))
      return {
        ...no(why.lowest(terrainAt(this.map, b.x, b.y) === Terrain.Water)),
        limit: 'floor',
      };
    if (level > HIGHEST_LEVEL) return { ...no(why.highest), limit: 'ceiling' };
    const piece = this.track.get(b.x, b.y);
    if (!piece) return { ok: true, level };
    if (piece.unit || piece.links.length !== 1 || !climbAxes(piece.links).length)
      return no(why.fixed);
    if (this.stationForTrackTile(b.x, b.y)) return no(why.station);
    if (this.busy?.(b.x, b.y)) return no(why.train);
    for (const d of piece.links[0]) {
      const nx = b.x + DDX[d],
        ny = b.y + DDY[d],
        q = this.track.get(nx, ny);
      if (!q || !this.track.opensTo(nx, ny, opposite(d))) continue;
      // The rail bends on the tiles either side of a step: no train may stand there either.
      if (this.busy?.(nx, ny)) return no(why.train);
      const there = this.railLevelAt(nx, ny);
      if (this.bends(q, opposite(d))) {
        if (Math.abs(level - there) > 1) return no(why.steep);
      } else if (level !== there) return no(why.meets);
    }
    return { ok: true, level };
  }
  /**
   * Raise (+1) or lower (-1) the deck of a platform. The first change on a bridge fixes the rail
   * it already carries where it runs: an automatic deck follows the rail beside it, so without
   * this the whole bridge would move with the one tile. Platforms without track stay automatic
   * and take the level of the rail laid over them later; one that is lowered back onto the ground
   * (or the water) before any rail lies on it is automatic again, as it was placed. Returns false
   * when a rule refuses.
   */
  changeDeck(b: Building, delta: number): boolean {
    if (this.bridgeAt(b.x, b.y) !== b) return false;
    const c = this.checkDeck(b, delta);
    if (!c.ok) {
      sfx('build.invalid');
      return false;
    }
    const pinned = this.bridgeGroup(b)
      .filter((p) => p !== b && p.deck === undefined && this.track.has(p.x, p.y))
      .map((p) => ({ p, deck: this.deckLevel(p) }));
    for (const { p, deck } of pinned) p.deck = deck;
    if (!this.track.has(b.x, b.y) && c.level === levelAt(this.map, b.x, b.y)) delete b.deck;
    else b.deck = c.level;
    this.onBuildingChanged?.(b, false);
    sfx(delta > 0 ? 'build.place' : 'build.remove');
    return true;
  }
  /**
   * The deck a new platform takes on a tile: beside a deck set by hand the bridge continues at
   * that height (never below the ground), otherwise it is automatic.
   */
  placedDeck(x: number, y: number): number | undefined {
    let deck: number | undefined;
    for (const d of DIRS) {
      const n = this.bridgeAt(x + DIR_DX[d], y + DIR_DY[d]);
      if (n?.deck !== undefined) deck = Math.max(deck ?? 0, n.deck);
    }
    return deck === undefined ? undefined : Math.max(deck, levelAt(this.map, x, y));
  }

  refreshBridgeCapacity(x: number, y: number) {
    const p = this.track.get(x, y);
    if (p)
      p.bridgeCapacity = this.bridgeAt(x, y)
        ? (bridgeCapacity(this.bridgeAt(x, y)!) ?? undefined)
        : undefined;
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
  upgradeBuilding(b: Building) {
    if (this.buildingAt(b.x, b.y) !== b) return false;
    const cost = buildingUpgradeCost(b);
    if (!cost || !this.pay(this.free ? {} : cost)) return false;
    b.level = buildingLevel(b) + 1;
    if (buildingDef(b.id).bridge) {
      this.refreshBridgeCapacity(b.x, b.y);
      this.track.version++;
    }
    this.onBuildingChanged?.(b, false);
    return true;
  }
  plantCount() {
    let n = 0;
    for (const b of this.buildings.values()) if (buildingDef(b.id).power) n++;
    return n;
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
  private checkTrackTile(x: number, y: number, kind: TrackKind, anchor: boolean): string | null {
    if (!inBounds(this.map, x, y)) return STR.build.offMap;
    if (!this.unlocked(x, y)) return STR.build.locked;
    const t = terrainAt(this.map, x, y);
    if (t === Terrain.Rock || t === Terrain.Mountain) return STR.build.rock;
    if (t === Terrain.Water && kind !== 'bridge' && !this.bridgeAt(x, y))
      return STR.build.needBridge;
    if (t !== Terrain.Water && kind === 'bridge') return STR.build.bridgeOnWater;
    const st = this.stationAt(x, y);
    // a depot is a through-station: plain pieces may run through the shed
    if ((st && !(st.def.depot && anchor)) || (this.buildingAt(x, y) && !this.bridgeAt(x, y)))
      return STR.build.occupied;
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
    if ((item.cls === 'narrow' || item.cls2 === 'narrow') && !rules.narrowUnlocked)
      return { ok: false, cost: {}, reason: STR.build.narrowLocked };
    const wide = isUnitKind(kind, item.cls);
    const tiles = footprintOf(x, y, kind, rot, item.cls);
    for (const t of tiles) {
      const why = this.checkTrackTile(t.x, t.y, kind, !wide);
      if (why) return { ok: false, cost: {}, reason: why };
    }
    // class compatibility with the neighbours the new piece would open onto
    const probe = new TrackGraph(this.map.w, this.map.h);
    probe.place(x, y, kind, rot, item.cls, item.cls2);
    // Straights, crossings and class transitions may climb. Curves and switches (regular and
    // high speed) need smooth ground on every tile, or a bridge platform under every tile: then
    // they sit at the deck, the level of the rails they meet off the bridge.
    const members = tiles.map((t) => ({ ...t, links: probe.get(t.x, t.y)?.links ?? [] })),
      // Members of a wide piece are parts of a curve or switch, whatever their links look like.
      climbs = !wide && members.some((m) => climbAxes(m.links).length > 0),
      /** The deck the player set under a tile, if any. */
      set = (t: { x: number; y: number }) => this.bridgeAt(t.x, t.y)?.deck;
    // A level piece on uneven ground, or over a deck set by hand, sits on platforms: its seat.
    let seat: number | null = null;
    if (
      !climbs &&
      (tiles.some((t) => set(t) !== undefined) ||
        (this.groundCheck && !tiles.every((t) => this.groundCheck!(t.x, t.y, 'level'))))
    ) {
      if (!tiles.every((t) => this.bridgeAt(t.x, t.y)))
        return { ok: false, cost: {}, reason: STR.build.notSmooth };
      seat = supportedDeck(this.map, members, (bx, by) => this.bridgeAt(bx, by));
      if (seat === null) return { ok: false, cost: {}, reason: STR.build.deckLevels };
    }
    /** Track beside tile `t` that the new piece would join: its edge and the piece there. */
    const joins = (t: { x: number; y: number }, p: TrackPiece) =>
      p.links.flat().flatMap((d) => {
        const nx = t.x + DDX[d],
          ny = t.y + DDY[d],
          q = this.track.get(nx, ny);
        return !q ||
          tiles.some((m) => m.x === nx && m.y === ny) ||
          !this.track.opensTo(nx, ny, opposite(d))
          ? []
          : [{ d, nx, ny, q }];
      });
    for (const t of tiles) {
      const p = probe.get(t.x, t.y);
      if (!p) continue;
      if (climbs && this.groundCheck && !this.groundCheck(t.x, t.y, 'straight'))
        return { ok: false, cost: {}, reason: STR.build.tooSteep };
      // Heights: where a deck set by hand is involved the rails have to meet. A straight rail
      // climbs one level per tile at most; a curve or switch meets its rails at its own level.
      const beside = joins(t, p),
        here = this.bridgeAt(t.x, t.y),
        ground = levelAt(this.map, t.x, t.y);
      if (
        beside.length &&
        (set(t) !== undefined || beside.some((n) => set({ x: n.nx, y: n.ny }) !== undefined))
      ) {
        const theirs = beside.map((n) => this.railLevelAt(n.nx, n.ny)),
          // An automatic deck takes the level of the higher rail it meets.
          mine =
            set(t) ?? (!climbs ? (seat ?? ground) : here ? Math.max(ground, ...theirs) : ground);
        for (let i = 0; i < beside.length; i++) {
          const n = beside[i],
            bends = climbs && this.bends(p, n.d) && this.bends(n.q, opposite(n.d));
          if (bends ? Math.abs(mine - theirs[i]) > 1 : mine !== theirs[i])
            return {
              ok: false,
              cost: {},
              reason: bends ? STR.build.tooSteep : STR.build.deckMeets,
            };
        }
      }
      for (const [a, b] of p.links)
        for (const d of [a, b]) {
          const nx = t.x + DDX[d];
          const ny = t.y + DDY[d];
          if (tiles.some((q) => q.x === nx && q.y === ny)) continue;
          const q = this.track.get(nx, ny);
          if (!q || !this.track.opensTo(nx, ny, opposite(d))) continue;
          const mine = portClass(p, d),
            theirs = portClass(q, opposite(d));
          if (!classesJoin(mine, theirs)) {
            // no piece joins the two gauges; only regular and high speed meet at a transition
            const gauges = mine === 'narrow' || theirs === 'narrow';
            const reason = gauges ? STR.build.gaugeBreak : STR.build.needTransition;
            return { ok: false, cost: {}, reason };
          }
        }
    }
    let mul = 0;
    for (const t of tiles) mul = Math.max(mul, this.terrainMul(t.x, t.y));
    return this.affordable(this.priced(pieceCost(kind, item.cls, item.cls2), mul));
  }
  /**
   * A run of straights dragged in one go, as it would be laid tile after tile: each piece is
   * checked against the track that stands already (checkTrack) and against the piece before it
   * in the run, which is not there yet. Terrain never puts two neighbours more than a level
   * apart; a deck height set by hand can.
   */
  checkTrackRun(
    tiles: readonly { x: number; y: number; rot: number }[],
    item: TrackItem,
  ): PlacementCheck[] {
    let before: number | null = null;
    return tiles.map((t) => {
      let c = this.checkTrack(t.x, t.y, item, t.rot);
      const p = this.bridgeAt(t.x, t.y),
        ground = levelAt(this.map, t.x, t.y),
        // An automatic deck carries on at the level of the rail it continues.
        level = this.track.has(t.x, t.y)
          ? this.railLevelAt(t.x, t.y)
          : p
            ? (p.deck ?? Math.max(ground, before ?? ground))
            : ground;
      if (c.ok && before !== null && Math.abs(level - before) > 1)
        c = { ok: false, cost: {}, reason: STR.build.tooSteep };
      before = c.ok ? level : null;
      return c;
    });
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
    for (const t of tiles) {
      this.refreshBridgeCapacity(t.x, t.y);
      this.onTrackChanged?.(t.x, t.y);
    }
    // a switch beside a parallel track bends its branch into an S (and back)
    for (const t of this.track.refreshSwitchForms(tiles)) this.onTrackChanged?.(t.x, t.y);
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
    for (const t of this.track.refreshSwitchForms(tiles)) this.onTrackChanged?.(t.x, t.y);
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
  checkStation(x: number, y: number, defId: string, rot = 0): PlacementCheck {
    const def = stationDef(defId);
    if (def.gauge === 'narrow' && !rules.narrowUnlocked)
      return { ok: false, cost: {}, reason: STR.build.narrowLocked };
    for (const { x: tx, y: ty } of stationFootprint(defId, x, y, rot)) {
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
    const c = this.checkStation(x, y, defId, rot);
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
      if (!def.anyTile && this.groundCheck && !this.groundCheck(x, y, 'level'))
        return STR.build.notLevel;
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
    if (!this.free && !inSupplyMode(def))
      return { ok: false, cost: {}, reason: STR.build.supplyLocked };
    const t = terrainAt(this.map, x, y);
    // Bridge platforms stand on water or carry a rail level across a dip in the land.
    if (t === Terrain.Rock || t === Terrain.Mountain || (t === Terrain.Water && !def.bridge))
      return { ok: false, cost: {}, reason: STR.build.badTerrain };
    if (!def.bridge && this.groundCheck && !this.groundCheck(x, y, 'level'))
      return { ok: false, cost: {}, reason: STR.build.notLevel };
    if (this.track.has(x, y) || this.stationAt(x, y) || this.decorAt(x, y) || this.buildingAt(x, y))
      return { ok: false, cost: {}, reason: STR.build.occupied };
    if (
      def.needsWater &&
      !DIRS.some((d) => terrainAt(this.map, x + DDX[d], y + DDY[d]) === Terrain.Water)
    )
      return { ok: false, cost: {}, reason: STR.build.needWaterside };
    if (def.terrain && TERRAIN_NAMES[t].toLowerCase() !== def.terrain)
      return { ok: false, cost: {}, reason: STR.build.needTerrain(def.terrain) };
    if (def.deposit && !this.hasDeposit(x, y, def.deposit))
      return { ok: false, cost: {}, reason: STR.build.needDeposit(def.deposit) };
    return this.affordable(this.priced(def.cost, def.bridge ? 1 : this.kindMul(defId)));
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
    if (buildingDef(defId).bridge) {
      const deck = this.placedDeck(x, y);
      if (deck !== undefined) b.deck = deck;
    }
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
    if (!b || (buildingDef(b.id).bridge && this.track.has(x, y))) return false;
    this.buildings.delete(this.key(x, y));
    this.refund(buildingDef(b.id).cost);
    this.onBuildingChanged?.(b, true);
    sfx('build.remove');
    return true;
  }
}
export { BUILDING_DEFS };
