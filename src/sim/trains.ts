import { type Vec2, angleToFacing8, Dir } from '../engine/iso';
import type { TrackGraph } from '../world/track';
import { linkPoints, isCurveLink } from '../world/trackGeom';
import { findPath, walkBack, type PathSegment } from '../world/pathfinding';
import { Terrain, terrainAt, type GameMap } from '../world/tiles';
import { locoDef, wagonDef, levelMul, type LocoDef, type WagonDef } from '../gacha/items';
import type { LocoType } from '../data/content';
import type { Stockpile } from './stockpile';
import type { Builder } from './build';
import type { Station } from './stations';
import { cargoDef } from './cargo';
import { content } from '../data/content';
import { rules } from './rules';

const trackData = content.track;
import { sfx } from '../engine/audio';

export type TrainState =
  'moving' | 'loading' | 'waiting' | 'noRoute' | 'stranded' | 'noFuel' | 'noPower' | 'overweight';

export interface LocoSlot {
  uid: number;
  def: LocoDef;
  level: number;
}
/** What a train does at one stop of its looped schedule. */
export interface StopPlan {
  stationId: number;
  load: 'auto' | 'none';
  unload: 'all' | 'none';
  waitFull: boolean;
  refuel: boolean;
  depart: 'auto' | 'forward' | 'reverse';
  /** pass through without stopping */
  pass: boolean;
}
export function defaultStop(stationId: number): StopPlan {
  return {
    stationId,
    load: 'auto',
    unload: 'all',
    waitFull: false,
    refuel: true,
    depart: 'auto',
    pass: false,
  };
}
/** Bookkeeping for one loop of the schedule. */
export interface TripStats {
  startedAt: number;
  /** clock time the loop closed (0 while running) */
  endedAt: number;
  distance: number;
  fuel: Record<string, number>;
  loaded: Record<string, number>;
  delivered: Record<string, number>;
  income: number;
}
export function newTrip(now: number): TripStats {
  return {
    startedAt: now,
    endedAt: 0,
    distance: 0,
    fuel: {},
    loaded: {},
    delivered: {},
    income: 0,
  };
}
function bump(rec: Record<string, number>, k: string, v: number) {
  rec[k] = (rec[k] ?? 0) + v;
}

export interface WagonSlot {
  uid: number;
  def: WagonDef;
  level: number;
  cargo: string | null;
  amount: number;
  origin: number | null;
}
interface TrailPoint {
  x: number;
  y: number;
  seg: PathSegment;
}
export interface CarPose {
  x: number;
  y: number;
  heading: number;
}

const LOCO_LEN = 0.62;
const WAGON_LEN = 0.56;
const GAP = 0.05;
const ACCEL = 0.7;
const DECEL = 1.1;
const MIN_DWELL = 2;
/** tiles of path scanned ahead for other trains */
const LOOKAHEAD = 2.5;
/** distance kept before an occupied tile */
const HOLD_GAP = 0.45;
/** seconds blocked before trying another path / squeezing past */
const REROUTE_AFTER = 25;
const SQUEEZE_AFTER = 60;
const MAX_DWELL = 40;
/** longest a train waits for full wagons */
const MAX_DWELL_FULL = 180;

/** Per-tick services the simulation hands to every train. */
export interface TickCtx {
  track: TrackGraph;
  builder: Builder;
  map: GameMap;
  /** apply a delivery to contracts; returns units credited to a contract */
  onDelivery: (e: DeliveryEvent) => number;
  stockpile: Stockpile;
  /** storage cap of the stockpile for a resource */
  stockCap: (id: string) => number;
  /** is the tile inside a live electric network? */
  powered: (x: number, y: number) => boolean;
  /** a resource entered (+) or left (-) the stockpile at a tile: drives the floating indicators */
  onFlow: (x: number, y: number, resource: string, delta: number) => void;
  spend: (v: number) => void;
  earn: (v: number) => void;
  /** is a tile occupied by any train other than `self`? */
  occupied: (x: number, y: number, self: number) => boolean;
  /** ids of the trains standing on a tile */
  occupants: (x: number, y: number) => number[];
  now: number;
  /** weather / season speed multiplier */
  speedFactor: number;
}

export interface DeliveryEvent {
  cargo: string;
  amount: number;
  origin: number;
  station: Station;
  train: Train;
}

let nextTrainId = 1;
export function resetTrainIds(v = 1) {
  nextTrainId = v;
}

export class Train {
  readonly id: number;
  name: string;
  locos: LocoSlot[];
  wagons: WagonSlot[] = [];
  schedule: StopPlan[] = [];
  routeIndex = 0;
  /** coal-equivalent units in the steam tanks (wood counts half) */
  coal = 0;
  /** which solid fuel is in the tanks, for display */
  fuelKind: 'coal' | 'wood' = 'coal';
  fuelPreference: 'coal' | 'wood' = 'coal';
  oil = 0;
  water = 0;
  trip: TripStats = newTrip(0);
  lastTrip: TripStats | null = null;
  /** first locomotive: drives art, smoke and glow */
  get locoDef(): LocoDef {
    return this.locos[0].def;
  }
  /** station ids of the schedule (compat accessor) */
  get route(): number[] {
    return this.schedule.map((s) => s.stationId);
  }
  set route(ids: number[]) {
    this.schedule = ids.map(
      (id) => this.schedule.find((s) => s.stationId === id) ?? defaultStop(id),
    );
  }
  get currentStop(): StopPlan | undefined {
    return this.schedule[this.routeIndex % Math.max(1, this.schedule.length)];
  }
  state: TrainState = 'noRoute';
  stateTime = 0;
  reversed = false;
  speed = 0;
  distance = 0;
  // geometry
  private trail: TrailPoint[] = [];
  private trailCum: number[] = [];
  private path: PathSegment[] | null = null;
  private pathPts: { x: number; y: number; seg: PathSegment; factor: number }[] = [];
  private pathCum: number[] = [];
  private pathPos = 0;
  private trackVersion = -1;
  /** stockpile deliveries at the current stop, flushed to `onFlow` every second or so */
  private flowAcc: Record<string, number> = {};
  private flowTimer = 0;

  /** Tiles of the current leg plus the next `legs` legs of the schedule, for map highlighting. */
  predictPath(track: TrackGraph, builder: Builder, legs = 2): { x: number; y: number }[][] {
    const out: { x: number; y: number }[][] = [];
    let cursor: PathSegment | null = null;
    if (this.path && this.path.length) {
      // from the head's tile onward
      const head = this.trail[this.trail.length - 1]?.seg;
      const from = head ? this.path.findIndex((s) => s.x === head.x && s.y === head.y) : 0;
      const seg = this.path.slice(Math.max(0, from));
      out.push(seg.map((s) => ({ x: s.x, y: s.y })));
      cursor = seg[seg.length - 1] ?? null;
    } else if (this.trail.length) cursor = this.trail[this.trail.length - 1].seg;
    if (!cursor || !this.route.length) return out;
    for (let k = 1; k <= legs; k++) {
      const id = this.route[(this.routeIndex + k) % this.route.length];
      const st = builder.stationById(id);
      if (!st) break;
      const plat = new Set(builder.platformTiles(st).map((p) => p.y * track.w + p.x));
      if (!plat.size) break;
      const p = findPath(
        track,
        { x: cursor.x, y: cursor.y, in: cursor.in },
        (x, y) => plat.has(y * track.w + x),
        4000,
      );
      if (!p) break;
      out.push(p.map((s) => ({ x: s.x, y: s.y })));
      cursor = p[p.length - 1];
    }
    return out;
  }
  private flushFlow(ctx: TickCtx, st: Station) {
    for (const [k, v] of Object.entries(this.flowAcc)) if (v > 0.05) ctx.onFlow(st.x, st.y, k, v);
    this.flowAcc = {};
    this.flowTimer = 0;
  }
  poses: CarPose[] = [];
  prevPoses: CarPose[] = [];
  atStation: Station | null = null;
  lastMessage = '';
  /** held behind another train */
  blocked = false;
  /** id of the train currently blocking this one */
  blockedBy: number | null = null;
  blockedTime = 0;
  private ghostUntil = 0;
  private rerouted = false;

  constructor(locos: LocoSlot[], name?: string, id?: number) {
    if (!locos.length) throw new Error('a train needs a locomotive');
    this.id = id ?? nextTrainId++;
    if (id !== undefined) nextTrainId = Math.max(nextTrainId, id + 1);
    this.locos = locos;
    this.name = name ?? `${this.locoDef.name} ${this.id}`;
  }

  // ------------------------------------------------------------ stats
  /** Slowest engine sets the pace. */
  get maxSpeed() {
    return (
      Math.min(...this.locos.map((l) => l.def.speed * levelMul(l.level))) * rules.trainSpeedMul
    );
  }
  /** Tonnes the engines can haul together. */
  get power() {
    return this.locos.reduce((a, l) => a + l.def.power * levelMul(l.level), 0);
  }
  /** Tonnes hauled: wagons plus payload. */
  get weight() {
    let w = 0;
    for (const s of this.wagons)
      w += s.def.weight + (s.cargo ? s.amount * cargoDef(s.cargo).weight : 0);
    return w;
  }
  get emptyWeight() {
    return this.wagons.reduce((a, w) => a + w.def.weight, 0);
  }
  get crew() {
    return this.locos.reduce((a, l) => a + l.def.crew, 0);
  }
  /** Speed multiplier from load: heavy trains crawl. */
  get loadFactor() {
    const r = this.weight / Math.max(1, this.power);
    return r <= 0.8 ? 1 : Math.max(0.4, 1 - (r - 0.8) * 0.6);
  }
  get length() {
    return (
      this.locos.length * (LOCO_LEN + GAP) + this.wagons.reduce((a) => a + WAGON_LEN + GAP, 0) - GAP
    );
  }
  get carLengths(): number[] {
    return [...this.locos.map(() => LOCO_LEN), ...this.wagons.map(() => WAGON_LEN)];
  }
  // ------------------------------------------------------------ fuel
  private sumBy(type: LocoType, f: (l: LocoSlot) => number) {
    return this.locos.filter((l) => l.def.type === type).reduce((a, l) => a + f(l), 0);
  }
  get coalCap() {
    return this.sumBy('steam', (l) => (l.def.fuelCap ?? 0) * levelMul(l.level));
  }
  get oilCap() {
    return this.sumBy('diesel', (l) => (l.def.fuelCap ?? 0) * levelMul(l.level));
  }
  get waterCap() {
    return this.sumBy('steam', (l) => (l.def.waterCap ?? 0) * levelMul(l.level));
  }
  get coalRate() {
    return this.sumBy('steam', (l) => l.def.fuelPerTile ?? 0) * rules.runningCostMul;
  }
  get oilRate() {
    return this.sumBy('diesel', (l) => l.def.fuelPerTile ?? 0) * rules.runningCostMul;
  }
  get waterRate() {
    return this.sumBy('steam', (l) => l.def.waterPerTile ?? 0) * rules.runningCostMul;
  }
  get powerRate() {
    return this.sumBy('electric', (l) => l.def.powerPerTile ?? 0) * rules.runningCostMul;
  }
  get hasSteam() {
    return this.coalCap > 0;
  }
  get hasDiesel() {
    return this.oilCap > 0;
  }
  get hasElectric() {
    return this.powerRate > 0;
  }
  /** Tiles the current tanks last for (Infinity for pure electric). */
  get rangeTiles() {
    const r: number[] = [];
    if (this.coalRate > 0) r.push(this.coal / this.coalRate);
    if (this.waterRate > 0) r.push(this.water / this.waterRate);
    if (this.oilRate > 0) r.push(this.oil / this.oilRate);
    return r.length ? Math.min(...r) : Infinity;
  }
  /** Why the train cannot move right now, or null. */
  fuelProblem(ctx: TickCtx, step: number): 'noFuel' | 'noPower' | null {
    if (this.coalRate > 0 && this.coal < this.coalRate * step) return 'noFuel';
    if (this.waterRate > 0 && this.water < this.waterRate * step) return 'noFuel';
    if (this.oilRate > 0 && this.oil < this.oilRate * step) return 'noFuel';
    if (this.powerRate > 0) {
      const head = this.headTile;
      if (!head || !ctx.powered(head.x, head.y)) return 'noPower';
      if (ctx.stockpile.get('power') < this.powerRate * step) return 'noPower';
    }
    return null;
  }
  /** Fill tanks from the stockpile. `mul` > 1 charges extra (emergency delivery). */
  refuel(stock: Stockpile, opts: { fuel: boolean; water: boolean }, mul = 1) {
    const taken: Record<string, number> = {};
    if (opts.fuel && this.coalCap > 0 && this.coal < this.coalCap - 1e-6) {
      const room = this.coalCap - this.coal;
      const order = this.fuelPreference === 'coal' ? ['coal', 'wood'] : ['wood', 'coal'];
      for (const kind of order) {
        const per = kind === 'coal' ? 1 : 0.5; // coal-equivalent per unit
        const need = (this.coalCap - this.coal) / per;
        if (need <= 0.01) break;
        const got = stock.take(kind, need * mul) / mul;
        if (got > 0) {
          if (this.coal < 1e-6) this.fuelKind = kind as 'coal' | 'wood';
          this.coal = Math.min(this.coalCap, this.coal + got * per);
          taken[kind] = (taken[kind] ?? 0) + got;
        }
      }
      void room;
    }
    if (opts.fuel && this.oilCap > 0 && this.oil < this.oilCap - 1e-6) {
      const got = stock.take('oil', (this.oilCap - this.oil) * mul) / mul;
      this.oil = Math.min(this.oilCap, this.oil + got);
      if (got > 0) taken.oil = got;
    }
    if (opts.water && this.waterCap > 0 && this.water < this.waterCap - 1e-6) {
      const got = stock.take('water', (this.waterCap - this.water) * mul) / mul;
      this.water = Math.min(this.waterCap, this.water + got);
      if (got > 0) taken.water = got;
    }
    return taken;
  }
  /** Give the tanks' contents back (recall). */
  drainTo(stock: Stockpile) {
    if (this.coal > 0)
      stock.add(this.fuelKind, this.fuelKind === 'coal' ? this.coal : this.coal * 2, Infinity);
    if (this.oil > 0) stock.add('oil', this.oil, Infinity);
    if (this.water > 0) stock.add('water', this.water, Infinity);
    this.coal = this.oil = this.water = 0;
  }
  /** Centre offsets of each car behind the head. */
  private carOffsets(): number[] {
    const lens = this.reversed ? [...this.carLengths].reverse() : this.carLengths;
    const out: number[] = [];
    let a = lens[0] / 2;
    out.push(a);
    for (let i = 1; i < lens.length; i++) {
      a += lens[i - 1] / 2 + GAP + lens[i] / 2;
      out.push(a);
    }
    return out;
  }
  get headTile(): { x: number; y: number } | null {
    const p = this.trail[this.trail.length - 1];
    return p ? { x: p.seg.x, y: p.seg.y } : null;
  }
  get headPos(): Vec2 | null {
    const p = this.trail[this.trail.length - 1];
    return p ? { x: p.x, y: p.y } : null;
  }
  totalCargo() {
    return this.wagons.reduce((a, w) => a + w.amount, 0);
  }

  // ------------------------------------------------------------ placement
  /** Place the train stopped on a track tile, facing out of edge `out`. */
  spawnAt(track: TrackGraph, x: number, y: number, entry: Dir) {
    const piece = track.get(x, y);
    if (!piece) return false;
    const exits = track.exits(x, y, entry);
    const out = exits.find((e) => e === (entry + 2) % 4) ?? exits[0];
    if (out === undefined) return false;
    const seg: PathSegment = { x, y, in: entry, out };
    const back = walkBack(track, x, y, entry, Math.ceil(this.length) + 1);
    this.trail = [];
    this.trailCum = [];
    for (const s of [...back, seg]) {
      const pts = linkPoints(s.in, s.out, 8);
      const upto = s === seg ? Math.floor(pts.length / 2) + 1 : pts.length;
      for (let i = 0; i < upto; i++)
        this.pushTrail({ x: s.x + pts[i].x, y: s.y + pts[i].y, seg: s });
    }
    this.reversed = false;
    this.speed = 0;
    this.pathPos = 0;
    this.path = null;
    this.updatePoses();
    this.prevPoses = this.poses.map((p) => ({ ...p }));
    return true;
  }

  /** Rebuild the trail (car positions and travel direction) from a save. */
  restoreTrail(points: number[][], reversed: boolean) {
    this.trail = [];
    this.trailCum = [];
    const segs = new Map<string, PathSegment>();
    for (const [x, y, sx, sy, sin, sout] of points) {
      const key = `${sx},${sy},${sin},${sout}`;
      let seg = segs.get(key);
      if (!seg) {
        seg = { x: sx, y: sy, in: sin as Dir, out: sout as Dir };
        segs.set(key, seg);
      }
      const last = this.trail[this.trail.length - 1];
      this.trailCum.push(
        last ? this.trailCum[this.trailCum.length - 1] + Math.hypot(x - last.x, y - last.y) : 0,
      );
      this.trail.push({ x, y, seg });
    }
    this.reversed = reversed;
    this.speed = 0;
    this.path = null;
    this.updatePoses();
    this.prevPoses = this.poses.map((p) => ({ ...p }));
  }

  private pushTrail(p: TrailPoint) {
    const last = this.trail[this.trail.length - 1];
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 1e-6) {
        last.seg = p.seg;
        return;
      }
      this.trailCum.push(this.trailCum[this.trailCum.length - 1] + d);
    } else this.trailCum.push(0);
    this.trail.push(p);
    // trim
    const total = this.trailCum[this.trailCum.length - 1];
    const keep = this.length + 2;
    while (this.trail.length > 2 && total - this.trailCum[1] > keep) {
      this.trail.shift();
      this.trailCum.shift();
    }
  }

  private sampleTrail(arc: number): CarPose {
    const cum = this.trailCum;
    const pts = this.trail;
    if (!pts.length) return { x: 0, y: 0, heading: 0 };
    if (arc <= 0 || pts.length === 1) {
      const h = pts.length > 1 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0;
      return { x: pts[0].x, y: pts[0].y, heading: h };
    }
    let i = 1;
    while (i < cum.length && cum[i] < arc) i++;
    if (i >= cum.length) {
      const n = pts.length - 1;
      const h = Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x);
      return { x: pts[n].x, y: pts[n].y, heading: h };
    }
    const t = (arc - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const a = pts[i - 1];
    const b = pts[i];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      heading: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  updatePoses() {
    const total = this.trailCum[this.trailCum.length - 1] ?? 0;
    const offs = this.carOffsets();
    const poses = offs.map((o) => this.sampleTrail(total - o));
    // keep the array in car order (loco first) regardless of travel direction
    this.poses = this.reversed ? poses.reverse() : poses;
  }

  /** Facing index for a car (loco faces backwards when pushed). */
  facingOf(carIndex: number, pose: CarPose) {
    const flip = this.reversed;
    return angleToFacing8(pose.heading + (flip ? Math.PI : 0) + (carIndex === 0 ? 0 : 0));
  }

  // ------------------------------------------------------------ routing
  /** Try to path to the next station. Returns false when nothing is reachable. */
  dispatch(
    track: TrackGraph,
    builder: Builder,
    map: GameMap,
    avoid?: (x: number, y: number) => boolean,
    mode: 'auto' | 'forward' | 'reverse' = 'auto',
  ): boolean {
    if (this.route.length === 0 || !this.trail.length) return false;
    const target = builder.stationById(this.route[this.routeIndex % this.route.length]);
    if (!target) return false;
    const plat = builder.platformTiles(target);
    if (!plat.length) {
      this.lastMessage = `${target.name} has no platform`;
      return false;
    }
    const targetSet = new Set(plat.map((p) => p.y * track.w + p.x));
    const isTarget = (x: number, y: number) => targetSet.has(y * track.w + x);
    const head = this.trail[this.trail.length - 1];
    const seg = head.seg;
    // already there?
    if (isTarget(seg.x, seg.y)) {
      this.path = null;
      return true;
    }
    let path =
      mode === 'reverse'
        ? null
        : findPath(track, { x: seg.x, y: seg.y, in: seg.in }, isTarget, 100000, avoid);
    if (!path && mode !== 'forward') {
      // reverse the consist and try the other way
      const alt = findPath(track, { x: seg.x, y: seg.y, in: seg.out }, isTarget, 100000, avoid);
      if (alt) {
        this.reverseConsist();
        // the head is now the old rear car: re-anchor the path on its actual tile
        const nh = this.trail[this.trail.length - 1].seg;
        if (isTarget(nh.x, nh.y)) {
          this.path = null;
          this.trackVersion = track.version;
          return true;
        }
        path = findPath(track, { x: nh.x, y: nh.y, in: nh.in }, isTarget, 100000, avoid) ?? alt;
      }
    }
    if (!path) return false;
    this.setPath(path, map);
    this.trackVersion = track.version;
    return true;
  }

  private reverseConsist() {
    const total = this.trailCum[this.trailCum.length - 1];
    const offs = this.carOffsets();
    const lens = this.reversed ? [...this.carLengths].reverse() : this.carLengths;
    const lastRear = offs[offs.length - 1] + lens[lens.length - 1] / 2; // arc behind head of the rear end
    const newHeadArc = Math.min(total, lastRear);
    const pts = [...this.trail].reverse();
    const cumR = pts.map((_, i) => total - this.trailCum[this.trail.length - 1 - i]);
    // truncate at newHeadArc
    const nt: TrailPoint[] = [];
    const nc: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (cumR[i] <= newHeadArc) {
        nt.push({
          ...pts[i],
          seg: { x: pts[i].seg.x, y: pts[i].seg.y, in: pts[i].seg.out, out: pts[i].seg.in },
        });
        nc.push(cumR[i]);
      } else {
        const prev = i > 0 ? pts[i - 1] : pts[i];
        const pc = i > 0 ? cumR[i - 1] : 0;
        const t = (newHeadArc - pc) / Math.max(1e-6, cumR[i] - pc);
        nt.push({
          x: prev.x + (pts[i].x - prev.x) * t,
          y: prev.y + (pts[i].y - prev.y) * t,
          seg: { x: pts[i].seg.x, y: pts[i].seg.y, in: pts[i].seg.out, out: pts[i].seg.in },
        });
        nc.push(newHeadArc);
        break;
      }
    }
    this.trail = nt;
    this.trailCum = nc;
    this.reversed = !this.reversed;
    this.updatePoses();
  }

  private setPath(path: PathSegment[], map: GameMap) {
    this.path = path;
    this.pathPts = [];
    this.pathCum = [];
    for (let s = 0; s < path.length; s++) {
      const seg = path[s];
      const pts = linkPoints(seg.in, seg.out, 8);
      const last = s === path.length - 1;
      const upto = last ? Math.floor(pts.length / 2) + 1 : pts.length;
      const curve = isCurveLink(seg.in, seg.out);
      let factor = curve ? trackData.curveSpeed : 1;
      if (seg.x !== undefined) {
        const t = terrainAt(map, seg.x, seg.y);
        if (t === Terrain.Water) factor = Math.min(factor, trackData.bridgeSpeed);
        if (t === Terrain.Hill) factor = Math.min(factor, 0.85);
      }
      for (let i = 0; i < upto; i++) {
        const p = { x: seg.x + pts[i].x, y: seg.y + pts[i].y, seg, factor };
        const prev = this.pathPts[this.pathPts.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6) continue;
        this.pathCum.push(
          prev ? this.pathCum[this.pathCum.length - 1] + Math.hypot(prev.x - p.x, prev.y - p.y) : 0,
        );
        this.pathPts.push(p);
      }
    }
    // locate head on the first segment
    const head = this.trail[this.trail.length - 1];
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.pathPts.length; i++) {
      if (this.pathPts[i].seg !== path[0]) break;
      const d = Math.hypot(this.pathPts[i].x - head.x, this.pathPts[i].y - head.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.pathPos = this.pathCum[best];
    this.speed = 0;
  }

  get pathTotal() {
    return this.pathCum[this.pathCum.length - 1] ?? 0;
  }

  private factorAt(arc: number) {
    let i = 0;
    while (i + 1 < this.pathCum.length && this.pathCum[i + 1] < arc) i++;
    const p = this.pathPts[Math.min(i + 1, this.pathPts.length - 1)];
    let f = p.factor;
    if (p.seg && p.factor === 1) {
      // straight through a switch
      f = 1;
    }
    return f;
  }

  /** Validate the remaining path after a track edit. */
  pathStillValid(track: TrackGraph): boolean {
    if (!this.path) return true;
    for (const s of this.path) {
      if (!track.opensTo(s.x, s.y, s.in) || !track.opensTo(s.x, s.y, s.out)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ tick
  /** Advance by in-game seconds. */
  tick(gdt: number, ctx: TickCtx) {
    this.prevPoses = this.poses.map((p) => ({ ...p }));
    this.stateTime += gdt;
    if (ctx.track.version !== this.trackVersion && this.state === 'moving') {
      this.trackVersion = ctx.track.version;
      const head = this.headTile;
      if (!head || !ctx.track.has(head.x, head.y)) {
        this.setState('stranded');
        this.speed = 0;
        return;
      }
      if (!this.pathStillValid(ctx.track)) {
        if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
        else this.setState('noRoute');
      }
    }
    switch (this.state) {
      case 'moving':
        this.tickMove(gdt, ctx);
        break;
      case 'loading':
        this.tickLoad(gdt, ctx);
        break;
      case 'waiting': {
        if (this.atStation && this.atStation.hasFreePlatform()) {
          this.atStation.occupants.add(this.id);
          this.setState('loading');
        }
        break;
      }
      case 'noFuel':
      case 'noPower':
      case 'overweight':
        if (this.stateTime > 3) {
          this.stateTime = 0;
          if (this.state === 'overweight' && this.weight > this.power) break;
          if (this.state !== 'overweight' && this.fuelProblem(ctx, 0.05)) break;
          if (this.path) this.setState('moving');
          else if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
          else this.setState('noRoute');
        }
        break;
      case 'noRoute':
      case 'stranded':
        if (this.stateTime > 4) {
          const head = this.headTile;
          if (this.state === 'stranded' && head && !ctx.track.has(head.x, head.y)) {
            this.stateTime = 0;
            break;
          }
          if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
          else this.stateTime = 0;
        }
        break;
    }
  }

  /** Forget any hold-behind-train bookkeeping. */
  private clearHold() {
    this.blocked = false;
    this.blockedBy = null;
    this.blockedTime = 0;
    this.rerouted = false;
  }
  private setState(s: TrainState) {
    if (s !== 'moving') this.clearHold();
    this.state = s;
    this.stateTime = 0;
  }

  /** After dispatch(): either start moving or handle "already at target". */
  onPathReady(ctx: { builder: Builder } | TickCtx) {
    const target = ctx.builder.stationById(this.route[this.routeIndex % this.route.length]);
    if (!this.path) {
      if (target) this.arrive(target, 'track' in ctx ? ctx : undefined);
      else this.setState('noRoute');
      return;
    }
    this.setState('moving');
  }

  private tickMove(gdt: number, ctx: TickCtx) {
    const remaining = this.pathTotal - this.pathPos;
    // look ahead for other trains; hold a little before the first occupied tile
    let blockDist = Infinity;
    let blocker: number | null = null;
    if (ctx.now >= this.ghostUntil) {
      const from = this.pathPos + 0.3;
      const to = this.pathPos + LOOKAHEAD;
      // tiles under this train's own cars never block it (two trains that already overlap
      // must be allowed to separate)
      const own = new Set<number>();
      for (const p of this.poses)
        own.add(Math.floor(p.y + 0.5) * ctx.track.w + Math.floor(p.x + 0.5));
      for (let i = 0; i < this.pathPts.length; i++) {
        const arc = this.pathCum[i];
        if (arc < from) continue;
        if (arc > to) break;
        const p = this.pathPts[i];
        if (own.has(p.seg.y * ctx.track.w + p.seg.x)) continue;
        if (ctx.occupied(p.seg.x, p.seg.y, this.id)) {
          blockDist = Math.max(0, arc - this.pathPos - HOLD_GAP);
          blocker = ctx.occupants(p.seg.x, p.seg.y).find((id) => id !== this.id) ?? null;
          break;
        }
      }
    }
    this.blocked = blockDist < 0.3;
    this.blockedBy = this.blocked ? blocker : null;
    if (this.blocked) {
      this.blockedTime += gdt;
      if (this.blockedTime > REROUTE_AFTER && !this.rerouted) {
        this.rerouted = true;
        // try a path that avoids the tiles other trains are sitting on
        const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
        const wasReversed = this.reversed;
        if (this.dispatch(ctx.track, ctx.builder, ctx.map, avoid)) {
          this.lastMessage = 'rerouted around traffic';
          if (!this.path) {
            // the head already stands on the target's platform: arrive instead of walking a stale path
            this.pathPts = [];
            this.pathCum = [];
            this.onPathReady(ctx);
          } else if (wasReversed !== this.reversed) this.updatePoses();
          return;
        }
      }
      if (this.blockedTime > SQUEEZE_AFTER) {
        // deadlock breaker: ignore the other train for a while
        this.ghostUntil = ctx.now + 15;
        this.blockedTime = 0;
        this.rerouted = false;
        this.lastMessage = 'squeezed past a blocked train';
      }
    } else {
      this.blockedTime = 0;
    }
    const vmax =
      this.maxSpeed * this.loadFactor * this.factorAt(this.pathPos + 0.3) * ctx.speedFactor;
    const vStop = Math.sqrt(2 * DECEL * Math.max(0, Math.min(remaining, blockDist)));
    const target = Math.min(vmax, vStop);
    if (target > this.speed) this.speed = Math.min(target, this.speed + ACCEL * gdt);
    else this.speed = Math.max(target, this.speed - DECEL * gdt * 1.5);
    const step = Math.min(
      remaining,
      Math.max(0, blockDist),
      Math.max(0.02 * gdt, this.speed * gdt),
    );
    this.pathPos += step;
    this.distance += step;
    if (step > 0) {
      const problem = this.fuelProblem(ctx, step);
      if (problem) {
        this.speed = 0;
        this.setState(problem);
        this.lastMessage = problem === 'noFuel' ? 'out of fuel or water' : 'no power on this line';
        return;
      }
      if (this.coalRate > 0) {
        this.coal -= this.coalRate * step;
        bump(
          this.trip.fuel,
          this.fuelKind,
          (this.coalRate * step) / (this.fuelKind === 'coal' ? 1 : 0.5),
        );
      }
      if (this.waterRate > 0) {
        this.water -= this.waterRate * step;
        bump(this.trip.fuel, 'water', this.waterRate * step);
      }
      if (this.oilRate > 0) {
        this.oil -= this.oilRate * step;
        bump(this.trip.fuel, 'oil', this.oilRate * step);
      }
      if (this.powerRate > 0) {
        ctx.stockpile.take('power', this.powerRate * step);
        bump(this.trip.fuel, 'power', this.powerRate * step);
      }
      this.trip.distance += step;
    }
    // append head sample(s)
    const p = this.samplePath(this.pathPos);
    this.pushTrail(p);
    this.updatePoses();
    if (this.pathTotal - this.pathPos < 1e-3) {
      if (!this.path) {
        this.speed = 0;
        this.setState('noRoute');
        return;
      }
      const seg = this.path[this.path.length - 1];
      const st = ctx.builder.stationForTrackTile(seg.x, seg.y);
      const want = ctx.builder.stationById(this.route[this.routeIndex % this.route.length]);
      this.path = null;
      this.speed = 0;
      if (want && st === want) this.arrive(want, ctx);
      else if (want && ctx.builder.platformTiles(want).some((t) => t.x === seg.x && t.y === seg.y))
        this.arrive(want, ctx);
      else this.setState('noRoute');
    }
  }

  private samplePath(arc: number): TrailPoint {
    const cum = this.pathCum;
    const pts = this.pathPts;
    let i = 1;
    while (i < cum.length && cum[i] < arc) i++;
    if (i >= cum.length) {
      const l = pts[pts.length - 1];
      return { x: l.x, y: l.y, seg: l.seg };
    }
    const t = (arc - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const a = pts[i - 1];
    const b = pts[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, seg: t < 0.5 ? a.seg : b.seg };
  }

  private arrive(st: Station, ctx?: TickCtx) {
    this.atStation = st;
    this.clearHold();
    const stop = this.currentStop;
    if (stop?.pass && ctx) {
      this.atStation = null;
      this.routeIndex = (this.routeIndex + 1) % Math.max(1, this.schedule.length);
      if (this.dispatch(ctx.track, ctx.builder, ctx.map, undefined, stop.depart))
        this.onPathReady(ctx);
      else this.setState('noRoute');
      return;
    }
    sfx('train.arrive');
    if (st.hasFreePlatform()) {
      st.occupants.add(this.id);
      this.setState('loading');
    } else this.setState('waiting');
  }

  private tickLoad(gdt: number, ctx: TickCtx) {
    const st = this.atStation;
    if (!st) {
      this.setState('noRoute');
      return;
    }
    const stop = this.currentStop ?? defaultStop(st.id);
    if (stop.refuel && this.stateTime < gdt * 1.5) {
      // top up once on arrival
      const taken = this.refuel(ctx.stockpile, { fuel: st.refuelsFuel, water: st.refuelsWater });
      for (const [k, v] of Object.entries(taken)) {
        bump(this.trip.fuel, `refuel_${k}`, v);
        if (v > 0.05) ctx.onFlow(st.x, st.y, k, -v);
      }
    }
    let busy = false;
    let budget = st.loadRate * st.loadBoost * rules.loadRateMul * gdt;
    // unload: contract cargo is credited first, everything else enters the stockpile
    this.flowTimer += gdt;
    for (const w of this.wagons) {
      if (stop.unload === 'none') break;
      if (!w.cargo || w.amount <= 0) continue;
      const room = Math.max(0, ctx.stockCap(w.cargo) - ctx.stockpile.get(w.cargo));
      const contractable = st.accepts(w.cargo);
      let n = Math.min(w.amount, budget, contractable ? w.amount : room);
      if (n <= 1e-6) continue;
      let credited = 0;
      if (contractable)
        credited = ctx.onDelivery({
          cargo: w.cargo,
          amount: n,
          origin: w.origin ?? -1,
          station: st,
          train: this,
        });
      const toPool = Math.min(n - credited, room);
      n = credited + toPool;
      if (n <= 1e-6) continue;
      if (toPool > 0) {
        ctx.stockpile.add(w.cargo, toPool, Infinity);
        this.flowAcc[w.cargo] = (this.flowAcc[w.cargo] ?? 0) + toPool;
      }
      w.amount -= n;
      budget -= n;
      busy = true;
      bump(this.trip.delivered, w.cargo, n);
      if (w.amount < 1e-3) {
        w.amount = 0;
        w.cargo = null;
        w.origin = null;
      }
    }
    if (this.flowTimer >= 1.5) this.flushFlow(ctx, st);
    // load produced cargo that some later station on the route accepts
    const produced = st.producedCargo();
    const routeStations = this.route
      .map((id) => ctx.builder.stationById(id))
      .filter((s): s is Station => !!s && s !== st);
    let allFull = true;
    for (const w of this.wagons) {
      if (stop.load === 'none') break;
      if (budget <= 0) break;
      if (w.cargo && w.amount >= w.def.capacity * levelMul(w.level) - 1e-3) continue;
      const options = produced.filter(
        (c) => (w.def.accepts ?? []).includes(c) && (!w.cargo || w.cargo === c),
      );
      if (!routeStations.length) break;
      if (!options.length) continue;
      // prefer the cargo with the most in storage
      options.sort((a, b) => st.stored(b) - st.stored(a));
      const c = options[0];
      const cap = w.def.capacity * levelMul(w.level);
      const room = cap - (w.cargo === c ? w.amount : 0);
      // never load beyond what the engines can haul
      const spareTonnes = this.power - this.weight;
      const want = Math.min(room, budget, Math.max(0, spareTonnes / cargoDef(c).weight));
      if (want <= 1e-6) {
        allFull = false;
        continue;
      }
      // only keep the train if the station can feed it at a useful rate
      if (st.stored(c) < Math.min(want, 1)) continue;
      const n = st.take(c, want);
      if (n <= 0) continue;
      if (!w.cargo) {
        w.cargo = c;
        w.amount = 0;
        w.origin = st.id;
      }
      w.amount += n;
      budget -= n;
      bump(this.trip.loaded, c, n);
      if (n >= want * 0.5) busy = true;
      if (w.amount < cap - 1e-3) allFull = false;
    }
    if (stop.load !== 'none' && stop.waitFull && !allFull && this.stateTime < MAX_DWELL_FULL)
      busy = true;
    const maxDwell = stop.load !== 'none' && stop.waitFull ? MAX_DWELL_FULL : MAX_DWELL;
    if ((!busy && this.stateTime >= MIN_DWELL) || this.stateTime >= maxDwell) this.depart(ctx);
  }

  private depart(ctx: TickCtx) {
    const st = this.atStation;
    if (st) {
      st.occupants.delete(this.id);
      this.flushFlow(ctx, st);
    }
    this.atStation = null;
    if (this.route.length < 1) {
      this.setState('noRoute');
      return;
    }
    const leaving = this.currentStop;
    this.routeIndex = (this.routeIndex + 1) % this.route.length;
    if (this.routeIndex === 0) {
      this.trip.endedAt = ctx.now;
      this.lastTrip = this.trip;
      this.trip = newTrip(ctx.now);
    }
    if (this.weight > this.power + 1e-6) {
      this.setState('overweight');
      this.lastMessage = 'too heavy for the engines';
      return;
    }
    sfx('train.whistle');
    if (this.dispatch(ctx.track, ctx.builder, ctx.map, undefined, leaving?.depart ?? 'auto'))
      this.onPathReady(ctx);
    else this.setState('noRoute');
  }

  /** Deadlock breaker: ignore other trains for a short while (used for head-on meetings). */
  squeeze(now: number, message = 'squeezed past an oncoming train') {
    this.ghostUntil = now + 15;
    this.clearHold();
    this.lastMessage = message;
  }

  /** Remove from the world: clear platform occupancy. */
  recall() {
    if (this.atStation) this.atStation.occupants.delete(this.id);
    this.atStation = null;
  }

  toJSON() {
    const head = this.trail[this.trail.length - 1];
    return {
      id: this.id,
      name: this.name,
      locos: this.locos.map((l) => ({ uid: l.uid, defId: l.def.id, level: l.level })),
      schedule: this.schedule,
      tanks: {
        coal: this.coal,
        oil: this.oil,
        water: this.water,
        kind: this.fuelKind,
        pref: this.fuelPreference,
      },
      trip: this.trip,
      lastTrip: this.lastTrip,
      wagons: this.wagons.map((w) => ({
        uid: w.uid,
        defId: w.def.id,
        level: w.level,
        cargo: w.cargo,
        amount: w.amount,
        origin: w.origin,
      })),
      routeIndex: this.routeIndex,
      distance: this.distance,
      head: head
        ? { x: head.seg.x, y: head.seg.y, in: head.seg.in, reversed: this.reversed }
        : null,
      reversed: this.reversed,
      trail: this.trail.map((p) => [
        Math.round(p.x * 1000) / 1000,
        Math.round(p.y * 1000) / 1000,
        p.seg.x,
        p.seg.y,
        p.seg.in,
        p.seg.out,
      ]),
    };
  }

  static fromJSON(j: ReturnType<Train['toJSON']>, track: TrackGraph): Train {
    const t = new Train(
      j.locos.map((l) => ({ uid: l.uid, def: locoDef(l.defId), level: l.level })),
      j.name,
      j.id,
    );
    t.wagons = j.wagons.map((w) => ({
      uid: w.uid,
      def: wagonDef(w.defId),
      level: w.level,
      cargo: w.cargo,
      amount: w.amount,
      origin: w.origin,
    }));
    t.schedule = j.schedule.map((s) => ({ ...defaultStop(s.stationId), ...s }));
    t.routeIndex = j.routeIndex;
    t.coal = j.tanks.coal;
    t.oil = j.tanks.oil;
    t.water = j.tanks.water;
    t.fuelKind = j.tanks.kind;
    t.fuelPreference = j.tanks.pref;
    t.trip = { ...newTrip(0), ...j.trip };
    t.lastTrip = j.lastTrip ? { ...newTrip(0), ...j.lastTrip } : null;
    t.distance = j.distance;
    if (j.trail && j.trail.length >= 2 && j.trail.every(([, , sx, sy]) => track.has(sx, sy))) {
      t.restoreTrail(j.trail, !!j.reversed);
    } else if (j.head) {
      t.spawnAt(track, j.head.x, j.head.y, j.head.in as Dir);
    }
    t.state = 'noRoute';
    t.stateTime = 10;
    return t;
  }
}
