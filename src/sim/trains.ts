import { type Vec2, angleToFacing8, Dir } from '../engine/iso';
import type { TrackGraph } from '../world/track';
import { linkPoints, isCurveLink } from '../world/trackGeom';
import { findPath, walkBack, type PathSegment } from '../world/pathfinding';
import { Terrain, terrainAt, type GameMap } from '../world/tiles';
import { locoDef, wagonDef, levelMul, type LocoDef, type WagonDef } from '../gacha/items';
import type { Builder } from './build';
import type { Station } from './stations';
import { cargoDef } from './cargo';
import trackData from '../data/track.json';
import { sfx } from '../engine/audio';

export type TrainState = 'moving' | 'loading' | 'waiting' | 'noRoute' | 'stranded';

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
const MAX_DWELL = 40;

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
  locoUid: number;
  locoDef: LocoDef;
  locoLevel: number;
  wagons: WagonSlot[] = [];
  route: number[] = [];
  routeIndex = 0;
  state: TrainState = 'noRoute';
  stateTime = 0;
  reversed = false;
  speed = 0;
  distance = 0;
  private fuelAcc = 0;
  // geometry
  private trail: TrailPoint[] = [];
  private trailCum: number[] = [];
  private path: PathSegment[] | null = null;
  private pathPts: { x: number; y: number; seg: PathSegment; factor: number }[] = [];
  private pathCum: number[] = [];
  private pathPos = 0;
  private trackVersion = -1;
  poses: CarPose[] = [];
  prevPoses: CarPose[] = [];
  atStation: Station | null = null;
  lastMessage = '';

  constructor(locoUid: number, locoDefId: string, locoLevel: number, name?: string, id?: number) {
    this.id = id ?? nextTrainId++;
    if (id !== undefined) nextTrainId = Math.max(nextTrainId, id + 1);
    this.locoUid = locoUid;
    this.locoDef = locoDef(locoDefId);
    this.locoLevel = locoLevel;
    this.name = name ?? `${this.locoDef.name} ${this.id}`;
  }

  // ------------------------------------------------------------ stats
  get maxSpeed() {
    return this.locoDef.speed * levelMul(this.locoLevel);
  }
  get power() {
    return this.locoDef.power * levelMul(this.locoLevel);
  }
  get weight() {
    let w = 0;
    for (const s of this.wagons)
      w += s.def.weight + (s.cargo ? s.amount * cargoDef(s.cargo).weight * 0.25 : 0);
    return w;
  }
  /** Speed multiplier from load: heavy trains crawl. */
  get loadFactor() {
    const r = this.weight / Math.max(1, this.power);
    return r <= 0.8 ? 1 : Math.max(0.4, 1 - (r - 0.8) * 0.6);
  }
  get length() {
    return LOCO_LEN + this.wagons.reduce((a, w) => a + w.def.capacity * 0 + WAGON_LEN + GAP, 0);
  }
  get carLengths(): number[] {
    return [LOCO_LEN, ...this.wagons.map(() => WAGON_LEN)];
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
  dispatch(track: TrackGraph, builder: Builder, map: GameMap): boolean {
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
    let path = findPath(track, { x: seg.x, y: seg.y, in: seg.in }, isTarget);
    if (!path) {
      // reverse the consist and try the other way
      const alt = findPath(track, { x: seg.x, y: seg.y, in: seg.out }, isTarget);
      if (alt) {
        this.reverseConsist();
        path = alt;
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
  tick(
    gdt: number,
    ctx: {
      track: TrackGraph;
      builder: Builder;
      map: GameMap;
      onDelivery: (e: DeliveryEvent) => void;
      spend: (v: number) => void;
      earn: (v: number) => void;
    },
  ) {
    this.prevPoses = this.poses.map((p) => ({ ...p }));
    this.stateTime += gdt;
    if (ctx.track.version !== this.trackVersion && this.state === 'moving') {
      this.trackVersion = ctx.track.version;
      const head = this.headTile;
      if (!head || !ctx.track.has(head.x, head.y)) {
        this.state = 'stranded';
        this.speed = 0;
        return;
      }
      if (!this.pathStillValid(ctx.track)) {
        if (!this.dispatch(ctx.track, ctx.builder, ctx.map)) this.setState('noRoute');
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

  private setState(s: TrainState) {
    this.state = s;
    this.stateTime = 0;
  }

  /** After dispatch(): either start moving or handle "already at target". */
  onPathReady(ctx: { builder: Builder }) {
    const target = ctx.builder.stationById(this.route[this.routeIndex % this.route.length]);
    if (!this.path) {
      if (target) this.arrive(target);
      else this.setState('noRoute');
      return;
    }
    this.setState('moving');
  }

  private tickMove(
    gdt: number,
    ctx: { track: TrackGraph; builder: Builder; map: GameMap; spend: (v: number) => void },
  ) {
    const remaining = this.pathTotal - this.pathPos;
    const vmax = this.maxSpeed * this.loadFactor * this.factorAt(this.pathPos + 0.3);
    const vStop = Math.sqrt(2 * DECEL * Math.max(0, remaining));
    const target = Math.min(vmax, vStop);
    if (target > this.speed) this.speed = Math.min(target, this.speed + ACCEL * gdt);
    else this.speed = Math.max(target, this.speed - DECEL * gdt * 1.5);
    const step = Math.min(remaining, Math.max(0.02 * gdt, this.speed * gdt));
    this.pathPos += step;
    this.distance += step;
    this.fuelAcc += step * this.locoDef.costPerTile;
    if (this.fuelAcc >= 1) {
      ctx.spend(Math.floor(this.fuelAcc));
      this.fuelAcc -= Math.floor(this.fuelAcc);
    }
    // append head sample(s)
    const p = this.samplePath(this.pathPos);
    this.pushTrail(p);
    this.updatePoses();
    if (this.pathTotal - this.pathPos < 1e-3) {
      const seg = this.path![this.path!.length - 1];
      const st = ctx.builder.stationForTrackTile(seg.x, seg.y);
      const want = ctx.builder.stationById(this.route[this.routeIndex % this.route.length]);
      this.path = null;
      this.speed = 0;
      if (want && st === want) this.arrive(want);
      else if (want && ctx.builder.platformTiles(want).some((t) => t.x === seg.x && t.y === seg.y))
        this.arrive(want);
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

  private arrive(st: Station) {
    this.atStation = st;
    sfx('train.arrive');
    if (st.hasFreePlatform()) {
      st.occupants.add(this.id);
      this.setState('loading');
    } else this.setState('waiting');
  }

  private tickLoad(
    gdt: number,
    ctx: {
      track: TrackGraph;
      builder: Builder;
      map: GameMap;
      onDelivery: (e: DeliveryEvent) => void;
      earn: (v: number) => void;
    },
  ) {
    const st = this.atStation;
    if (!st) {
      this.setState('noRoute');
      return;
    }
    let busy = false;
    let budget = st.loadRate * gdt;
    // unload accepted cargo
    for (const w of this.wagons) {
      if (!w.cargo || w.amount <= 0) continue;
      if (!st.accepts(w.cargo)) continue;
      const n = Math.min(w.amount, budget);
      if (n <= 0) continue;
      w.amount -= n;
      budget -= n;
      busy = true;
      ctx.earn(n * cargoDef(w.cargo).price * 0.5);
      ctx.onDelivery({
        cargo: w.cargo,
        amount: n,
        origin: w.origin ?? -1,
        station: st,
        train: this,
      });
      if (w.amount < 1e-3) {
        w.amount = 0;
        w.cargo = null;
        w.origin = null;
      }
    }
    // load produced cargo that some later station on the route accepts
    const produced = st.producedCargo();
    const routeStations = this.route
      .map((id) => ctx.builder.stationById(id))
      .filter((s): s is Station => !!s && s !== st);
    for (const w of this.wagons) {
      if (budget <= 0) break;
      if (w.cargo && w.amount >= w.def.capacity * levelMul(w.level) - 1e-3) continue;
      const options = produced.filter(
        (c) =>
          w.def.accepts.includes(c) &&
          (!w.cargo || w.cargo === c) &&
          routeStations.some((s) => s.accepts(c)),
      );
      if (!options.length) continue;
      // prefer the cargo with the most in storage
      options.sort((a, b) => st.stored(b) - st.stored(a));
      const c = options[0];
      const cap = w.def.capacity * levelMul(w.level);
      const room = cap - (w.cargo === c ? w.amount : 0);
      const want = Math.min(room, budget);
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
      if (n >= want * 0.5) busy = true;
    }
    if ((!busy && this.stateTime >= MIN_DWELL) || this.stateTime >= MAX_DWELL) this.depart(ctx);
  }

  private depart(ctx: { track: TrackGraph; builder: Builder; map: GameMap }) {
    const st = this.atStation;
    if (st) st.occupants.delete(this.id);
    this.atStation = null;
    if (this.route.length < 1) {
      this.setState('noRoute');
      return;
    }
    this.routeIndex = (this.routeIndex + 1) % this.route.length;
    sfx('train.whistle');
    if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
    else this.setState('noRoute');
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
      locoUid: this.locoUid,
      locoDefId: this.locoDef.id,
      locoLevel: this.locoLevel,
      wagons: this.wagons.map((w) => ({
        uid: w.uid,
        defId: w.def.id,
        level: w.level,
        cargo: w.cargo,
        amount: w.amount,
        origin: w.origin,
      })),
      route: this.route,
      routeIndex: this.routeIndex,
      distance: this.distance,
      head: head
        ? { x: head.seg.x, y: head.seg.y, in: head.seg.in, reversed: this.reversed }
        : null,
    };
  }

  static fromJSON(j: ReturnType<Train['toJSON']>, track: TrackGraph): Train {
    const t = new Train(j.locoUid, j.locoDefId, j.locoLevel, j.name, j.id);
    t.wagons = j.wagons.map((w) => ({
      uid: w.uid,
      def: wagonDef(w.defId),
      level: w.level,
      cargo: w.cargo,
      amount: w.amount,
      origin: w.origin,
    }));
    t.route = j.route;
    t.routeIndex = j.routeIndex;
    t.distance = j.distance;
    if (j.head) {
      t.spawnAt(track, j.head.x, j.head.y, j.head.in as Dir);
      // spawnAt resets reversed; the loco orientation relative to travel is restored on next dispatch
    }
    t.state = 'noRoute';
    t.stateTime = 10;
    return t;
  }
}
