import { type Vec2, Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { TrackGraph, TrackPiece } from '../world/track';
import { curveFactor } from '../world/trackGeom';
import { findPath, walkBack, type PathSegment } from '../world/pathfinding';
import { consistAccess, pieceClassFor, type ConsistAccess } from './compat';
import { Terrain, terrainAt, type GameMap } from '../world/tiles';
import { locoDef, wagonDef, levelMul, type LocoDef, type WagonDef } from '../gacha/items';
import type { LocoType } from '../data/content';
import type { Stockpile } from './stockpile';
import type { Builder } from './build';
import type { Station } from './stations';
import { cargoDef, cargoClass } from './cargo';
import { content } from '../data/content';
import { rules } from './rules';
import {
  Polyline,
  poseVehicle,
  vehicleSpec,
  vehicleFronts,
  consistLength,
  facingOf,
  type VehiclePose,
  type VehicleSpec,
} from './body';
import { dieselFuelId, sandPerTile, supplyMode } from './supply';

const trackData = content.track;
import { sfx } from '../engine/audio';

export type TrainState =
  | 'moving'
  | 'loading'
  | 'waiting'
  | 'idle'
  | 'yielding'
  | 'noRoute'
  | 'stranded'
  | 'noFuel'
  | 'noPower'
  | 'overweight';

export interface LocoSlot {
  uid: number;
  def: LocoDef;
  level: number;
}
/** What a train does at one stop of its looped schedule. */
/**
 * Static: `schedule` follows the player's stop list to the letter. Dynamic: `production` sweeps
 * producers into the nearest warehouse (or depot), `collection` empties warehouses into depots,
 * `transport` carries passengers between town stations; all three pick their stops on the fly.
 */
export type RouteMode = 'schedule' | 'production' | 'collection' | 'transport';
export const DYNAMIC_MODES: RouteMode[] = ['production', 'collection', 'transport'];
export interface StopPlan {
  stationId: number;
  load: 'auto' | 'none';
  /** auto: only at a warehouse (stockpile) or where a contract / passengers want it */
  unload: 'auto' | 'all' | 'none';
  waitFull: boolean;
  refuel: boolean;
  depart: 'auto' | 'forward' | 'reverse';
  /** pass through without stopping */
  pass: boolean;
  /** stay at least this long (game seconds; 0 = only as long as loading takes) */
  minDwell?: number;
  /** leave after this long at the latest (game seconds; 0 = the default limit) */
  maxDwell?: number;
}
export function defaultStop(stationId: number): StopPlan {
  return {
    stationId,
    load: 'auto',
    unload: 'auto',
    waitFull: true,
    refuel: true,
    depart: 'auto',
    pass: false,
    minDwell: 0,
    maxDwell: 0,
  };
}
/**
 * A contract handed to a train: fetch `cargo` at `originId`, bring it to `destId`. Worked as a
 * plain two-stop job once the current leg is done; the standing program resumes afterwards.
 */
export interface TrainJob {
  contractId: number;
  /** contract name, for the panels */
  name: string;
  originId: number;
  destId: number;
  cargo: string;
}
/** The two stops of a job: wait for a load at the origin, take nothing on at the destination. */
export function jobStop(stationId: number, phase: 'origin' | 'dest'): StopPlan {
  return {
    ...defaultStop(stationId),
    load: phase === 'origin' ? 'auto' : 'none',
    waitFull: phase === 'origin',
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

const ACCEL = 0.7;
const DECEL = 1.1;
const MIN_DWELL = 2;
/** tiles of path scanned ahead for other trains */
const LOOKAHEAD = 2.5;
/** distance kept before an occupied tile */
const HOLD_GAP = 0.45;
/** seconds blocked before trying another path */
const REROUTE_AFTER = 6;
/** blocked this long: try rerouting again */
const RETRY_EVERY = 20;
/** tank fraction below which the economy mode kicks in */
const ECO_BELOW = 0.3;
/** speed and consumption multiplier while saving fuel */
const ECO_MUL = 0.6;
const MAX_DWELL = 40;
/** longest a train waits for full wagons */
const MAX_DWELL_FULL = 240;

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
  /** passengers boarded (true) or alighted (false) at a station */
  onPassengers: (station: Station, n: number, boarding: boolean) => void;
  /** tile keys (y*w+x) of another train's remaining path plus the tiles it stands on */
  trainPath: (id: number) => Set<number>;
  /** traffic control: train holding a tile (other than self), or null */
  claimedBy: (x: number, y: number, self: number) => number | null;
  /** which other train has the next few tiles of its path through here (0 = nobody) */
  reservedBy: (x: number, y: number, self: number) => number;
  /** dynamic routing: the station a train should head for next, or null to keep its schedule */
  chooseNext: (t: Train) => number | null;
  spend: (v: number) => void;
  earn: (v: number) => void;
  /** is a tile occupied by any train other than `self`? */
  occupied: (x: number, y: number, self: number) => boolean;
  /** ids of the trains standing on a tile */
  occupants: (x: number, y: number) => number[];
  now: number;
  /** weather / season speed multiplier */
  speedFactor: number;
  /** biome under a tile: speed and water-use multipliers */
  biomeAt: (x: number, y: number) => { speedMul: number; waterUseMul: number };
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
  /** what the diesel tanks hold: oil in the simple production chain, diesel in the full one */
  oilKind: 'oil' | 'diesel' = 'oil';
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
      const p = this.pathTo(
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
    for (const [k, v] of Object.entries(this.flowAcc))
      if (Math.abs(v) > 0.05) ctx.onFlow(st.x, st.y, k, v);
    this.flowAcc = {};
    this.flowTimer = 0;
  }
  /** Range in tiles if every tank were topped up to at least `frac` of capacity. */
  rangeAt(frac: number) {
    const r: number[] = [];
    if (this.coalRate > 0) r.push(Math.max(this.coal, this.coalCap * frac) / this.coalRate);
    if (this.waterRate > 0) r.push(Math.max(this.water, this.waterCap * frac) / this.waterRate);
    if (this.oilRate > 0) r.push(Math.max(this.oil, this.oilCap * frac) / this.oilRate);
    return r.length ? Math.min(...r) : Infinity;
  }
  /**
   * Fuel first. A leg is only started when the tanks cover it and the run on from its end to the
   * nearest fuel point (a depot, or a station with both a coaling stage and a water tower in
   * reach). Otherwise the train diverts to the best fuel point it can still reach: supplied ones
   * first, then the one that costs the least extra distance. Returns true when a detour was set.
   */
  private planFuelDetour(ctx: TickCtx): boolean {
    if (this.detour !== null || !this.path) return false;
    if (this.rangeTiles === Infinity) return false;
    const w = ctx.track.w;
    const want = this.route[this.routeIndex % this.route.length];
    const target = ctx.builder.stationById(want);
    const fuelPoints = ctx.builder.stations.filter(
      (s) => s.refuelsFuel && s.refuelsWater && ctx.builder.platformTiles(s).length > 0,
    );
    const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    // distance from the target on to the nearest fuel point (as the crow flies, padded)
    let onward = 0;
    if (target && !(target.refuelsFuel && target.refuelsWater)) {
      let nearest = Infinity;
      for (const f of fuelPoints) nearest = Math.min(nearest, manhattan(f, target));
      onward = nearest === Infinity ? 0 : nearest * 1.3 + 4;
    }
    const need = this.pathTotal * 1.15 + onward + 2;
    if (this.rangeTiles >= need) return false;
    const head = this.trail[this.trail.length - 1].seg;
    let best: { id: number; cost: number; supplied: boolean } | null = null;
    for (const st of ctx.builder.stations) {
      if (st.id === want) continue;
      const supplied = st.refuelsFuel && st.refuelsWater;
      // a plain station only helps when carts can bring something from the stockpile
      if (!supplied && !st.def.pool && !st.def.stockpile) continue;
      const plat = ctx.builder.platformTiles(st);
      if (!plat.length) continue;
      const set = new Set(plat.map((p) => p.y * w + p.x));
      const isT = (x: number, y: number) => set.has(y * w + x);
      const p =
        this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.in }, isT, 4000) ??
        this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.out }, isT, 4000);
      if (!p) continue;
      const len = p.length;
      if (len > this.rangeTiles * 0.9) continue;
      // extra distance the detour adds on the way to the target
      const cost = len + (target ? manhattan(st, target) : 0);
      if (!best || (supplied && !best.supplied) || (supplied === best.supplied && cost < best.cost))
        best = { id: st.id, cost, supplied };
    }
    if (!best) return false;
    this.detour = best.id;
    const wasReversed = this.reversed;
    if (this.dispatch(ctx.track, ctx.builder, ctx.map)) {
      this.lastMessage = 'diverting to refuel';
      if (!this.path) {
        this.pathPts = [];
        this.pathCum = [];
        this.onPathReady(ctx);
      } else if (wasReversed !== this.reversed) this.updatePoses();
      return true;
    }
    this.detour = null;
    return false;
  }
  poses: CarPose[] = [];
  prevPoses: CarPose[] = [];
  atStation: Station | null = null;
  lastMessage = '';
  /** held behind another train */
  /** free-running speed target of the last move tick (before braking for holds or the stop) */
  freeSpeed = 0;
  /** distance to the hold point ahead of the last move tick (occupancy or claim limit); Infinity when clear */
  holdDist = Infinity;
  blocked = false;
  /** id of the train currently blocking this one */
  blockedBy: number | null = null;
  blockedTime = 0;
  private rerouted = false;
  /** while set, the train is backing off for an oncoming one and must not be asked to yield again */
  yieldUntil = 0;
  /** the current path ends at a holding spot, not a station */
  holding = false;
  /** distance along the path to the first tile the traffic control did not grant (Infinity: free) */
  claimLimit = Infinity;
  /** train holding that tile */
  claimBlocker: number | null = null;
  /** seconds spent in the yielding state without a way forward */
  private yieldWait = 0;
  /** units taken on since arriving at the current stop */
  private loadedHere = 0;
  /** the train we pulled aside for */
  /** times this train pulled aside since it last reached a station: jams take turns */
  yieldCount = 0;
  /** station id of a refuelling detour taken before the scheduled stop */
  detour: number | null = null;
  /**
   * How the next stop is chosen: `fixed` follows the schedule, `dynamic` asks the fleet for the
   * station whose cargo the stockpile lacks most, `collect` sweeps the fullest producers and
   * warehouses into the nearest depot.
   */
  mode: RouteMode = 'schedule';
  /** true for every mode that picks stops on the fly */
  get dynamic() {
    return this.mode !== 'schedule';
  }
  /** contracts waiting for this train, in order */
  jobs: TrainJob[] = [];
  /** the contract being worked right now */
  job: TrainJob | null = null;
  /** heading for the job's origin to load, or for its destination to deliver */
  jobPhase: 'origin' | 'dest' = 'origin';
  /** the standing program set aside while a job runs */
  private suspended: { schedule: StopPlan[]; routeIndex: number } | null = null;
  /** a job was closed under a moving train: re-route to the resumed program on the next tick */
  private resumePending = false;
  /** Queue a contract; it starts once the current leg is done. */
  addJob(j: TrainJob) {
    if (
      this.job?.contractId === j.contractId ||
      this.jobs.some((q) => q.contractId === j.contractId)
    )
      return;
    this.jobs.push(j);
  }
  /**
   * Drop a contract from the queue, or close the one being worked: the train falls back to its
   * program at the next stop, or right away when it is under way.
   */
  dropJob(contractId: number) {
    this.jobs = this.jobs.filter((j) => j.contractId !== contractId);
    if (this.job?.contractId !== contractId) return;
    this.job = null;
    if (this.state === 'moving' && !this.holding) this.resumePending = true;
  }
  /** Set the program aside and take up the next queued contract as a two-stop schedule. */
  private startJob() {
    const j = this.jobs.shift();
    if (!j) return;
    if (!this.suspended) this.suspended = { schedule: this.schedule, routeIndex: this.routeIndex };
    this.job = j;
    this.jobPhase = 'origin';
    this.schedule = [jobStop(j.originId, 'origin'), jobStop(j.destId, 'dest')];
    this.routeIndex = 0;
    this.detour = null;
    this.lastMessage = `on contract: ${j.name}`;
  }
  /**
   * Back to the standing program. A schedule train rejoins at the stop after the one it left
   * for the job (`advance`: the caller does not step the index itself); a roaming train simply
   * chooses again.
   */
  private resumeProgram(advance: boolean) {
    const s = this.suspended;
    this.suspended = null;
    this.job = null;
    if (!s) return;
    this.schedule = s.schedule;
    const n = Math.max(1, s.schedule.length);
    this.routeIndex = advance ? (s.routeIndex + 1) % n : s.routeIndex % n;
    this.lastMessage = 'back on the regular run';
  }
  /** Any of the job's cargo aboard, taken on at its origin. */
  private hasJobCargo() {
    const j = this.job;
    return (
      !!j && this.wagons.some((w) => w.cargo === j.cargo && w.amount > 0 && w.origin === j.originId)
    );
  }
  /**
   * Job bookkeeping when a stop is done, before the program chooses the next stop. Returns what
   * the job wants: `go` (the job's own schedule and index are in force), `stay` (wait here for
   * the load), `none` (no job: the program decides, its index stepped by the caller as usual).
   */
  private stepJob(st: Station | null): 'go' | 'stay' | 'none' {
    if (this.job) {
      if (this.jobPhase === 'origin' && st?.id === this.job.originId) {
        if (!this.hasJobCargo()) return 'stay';
        this.jobPhase = 'dest';
        this.routeIndex = 1;
        return 'go';
      }
      if (this.jobPhase === 'dest' && st?.id === this.job.destId) {
        // delivered a load: another round until the book closes the contract
        this.jobPhase = 'origin';
        this.routeIndex = 0;
        return 'go';
      }
      return 'go';
    }
    if (this.suspended) this.resumeProgram(false);
    if (this.jobs.length) {
      this.startJob();
      return 'go';
    }
    return 'none';
  }
  /** stations a roaming train could not reach, with the time the memory expires */
  private badTargets = new Map<number, number>();
  isBadTarget(id: number, now: number) {
    const until = this.badTargets.get(id);
    return until !== undefined && until > now;
  }
  private anticipateAt = 0;
  /** tile keys of the plain path a holding train would take once the line clears */
  private wantKeys: number[] | null = null;

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
    return consistLength(this.carLengths);
  }
  get carLengths(): number[] {
    return this.vehicleSpecs.map((s) => s.L);
  }
  /** Body geometry of every vehicle, loco first. */
  get vehicleSpecs(): VehicleSpec[] {
    return [
      ...this.locos.map((l) => vehicleSpec(l.def)),
      ...this.wagons.map((w) => vehicleSpec(w.def)),
    ];
  }
  /** Poses of every body segment and bogie, in car order (loco first). */
  vehiclePoses: VehiclePose[] = [];
  private accessCache: { key: string; access: ConsistAccess } | null = null;
  /** Track classes every vehicle of the consist may use, and who bars the rest. */
  get access(): ConsistAccess {
    const key = [...this.locos.map((l) => l.def.id), ...this.wagons.map((w) => w.def.id)].join(',');
    if (!this.accessCache || this.accessCache.key !== key)
      this.accessCache = {
        key,
        access: consistAccess([...this.locos.map((l) => l.def), ...this.wagons.map((w) => w.def)]),
      };
    return this.accessCache.access;
  }
  /** Pathfinding predicate: may the consist enter this piece through `entry`? */
  readonly canUse = (p: TrackPiece, entry: Dir) => this.access.classes.has(pieceClassFor(p, entry));
  /** findPath with this consist's class access applied. */
  private pathTo(
    track: TrackGraph,
    start: { x: number; y: number; in: Dir },
    isTarget: (x: number, y: number) => boolean,
    maxCost = 100000,
    avoid?: (x: number, y: number) => boolean,
  ) {
    return findPath(track, start, isTarget, maxCost, avoid, this.canUse);
  }
  prevVehiclePoses: VehiclePose[] = [];
  /** Points along the consist every half tile from head to tail: what the train stands on. */
  occupancyPoints(): Vec2[] {
    const out: Vec2[] = [];
    const total = this.trailCum[this.trailCum.length - 1] ?? 0;
    const len = Math.min(total, this.length);
    if (!this.trail.length) return out;
    for (let s = 0; s <= len + 1e-6; s += 0.5) {
      const p = this.sampleTrail(total - Math.min(s, len));
      out.push({ x: p.x, y: p.y });
    }
    const tail = this.sampleTrail(total - len);
    out.push({ x: tail.x, y: tail.y });
    return out;
  }
  /** Tile keys under the consist. */
  occupancyKeys(w: number): number[] {
    const out: number[] = [];
    for (const p of this.occupancyPoints()) {
      const k = Math.floor(p.y + 0.5) * w + Math.floor(p.x + 0.5);
      if (!out.includes(k)) out.push(k);
    }
    return out;
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
  /** Lowest tank as a fraction of its capacity (1 for pure electric). */
  get tankFraction() {
    const f: number[] = [];
    if (this.coalCap > 0) f.push(this.coal / this.coalCap);
    if (this.waterCap > 0) f.push(this.water / this.waterCap);
    if (this.oilCap > 0) f.push(this.oil / this.oilCap);
    return f.length ? Math.min(...f) : 1;
  }
  /** Economy mode: a tank is low, so the train crawls and burns proportionally less. */
  get eco() {
    return this.tankFraction < ECO_BELOW;
  }
  /** Pushing the consist backwards is slow; a heavy train is slower still. */
  get reverseFactor() {
    const load = this.power > 0 ? Math.min(1, this.weight / this.power) : 1;
    return 0.7 - 0.35 * load;
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
    if (this.eco) step *= ECO_MUL;
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
  refuel(
    stock: Stockpile,
    opts: { fuel: boolean; water: boolean; fuelFrac?: number; waterFrac?: number },
    mul = 1,
  ) {
    const taken: Record<string, number> = {};
    const coalTarget = this.coalCap * (opts.fuelFrac ?? 1);
    if (opts.fuel && this.coalCap > 0 && this.coal < coalTarget - 1e-6) {
      const order = this.fuelPreference === 'coal' ? ['coal', 'wood'] : ['wood', 'coal'];
      for (const kind of order) {
        const per = kind === 'coal' ? 1 : 0.5; // coal-equivalent per unit
        const need = (coalTarget - this.coal) / per;
        if (need <= 0.01) break;
        const got = stock.take(kind, need * mul) / mul;
        if (got > 0) {
          if (this.coal < 1e-6) this.fuelKind = kind as 'coal' | 'wood';
          this.coal = Math.min(this.coalCap, this.coal + got * per);
          taken[kind] = (taken[kind] ?? 0) + got;
        }
      }
    }
    const oilTarget = this.oilCap * (opts.fuelFrac ?? 1);
    if (opts.fuel && this.oilCap > 0 && this.oil < oilTarget - 1e-6) {
      const liquid = dieselFuelId();
      const got = stock.take(liquid, (oilTarget - this.oil) * mul) / mul;
      this.oil = Math.min(this.oilCap, this.oil + got);
      if (got > 0) {
        this.oilKind = liquid;
        taken[liquid] = got;
      }
    }
    const waterTarget = this.waterCap * (opts.waterFrac ?? 1);
    if (opts.water && this.waterCap > 0 && this.water < waterTarget - 1e-6) {
      const got = stock.take('water', (waterTarget - this.water) * mul) / mul;
      this.water = Math.min(this.waterCap, this.water + got);
      if (got > 0) taken.water = got;
    }
    return taken;
  }
  /** Fill the tanks from a warehouse's own store (coal, wood, oil or diesel, water it holds). */
  refuelFromStation(st: Station) {
    const taken: Record<string, number> = {};
    const takeInto = (kind: string, need: number) => {
      const got = st.take(kind, need);
      if (got > 0) taken[kind] = (taken[kind] ?? 0) + got;
      return got;
    };
    if (this.coalCap > 0 && this.coal < this.coalCap - 1e-6) {
      const order = this.fuelPreference === 'coal' ? ['coal', 'wood'] : ['wood', 'coal'];
      for (const kind of order) {
        const per = kind === 'coal' ? 1 : 0.5;
        const need = (this.coalCap - this.coal) / per;
        if (need <= 0.01) break;
        const got = takeInto(kind, need);
        if (got > 0) {
          if (this.coal < 1e-6) this.fuelKind = kind as 'coal' | 'wood';
          this.coal = Math.min(this.coalCap, this.coal + got * per);
        }
      }
    }
    if (this.oilCap > 0 && this.oil < this.oilCap - 1e-6) {
      const liquid = dieselFuelId();
      const got = takeInto(liquid, this.oilCap - this.oil);
      if (got > 0) this.oilKind = liquid;
      this.oil = Math.min(this.oilCap, this.oil + got);
    }
    if (this.waterCap > 0 && this.water < this.waterCap - 1e-6)
      this.water = Math.min(
        this.waterCap,
        this.water + takeInto('water', this.waterCap - this.water),
      );
    return taken;
  }
  /** Give the tanks' contents back (recall). */
  drainTo(stock: Stockpile) {
    if (this.coal > 0)
      stock.add(this.fuelKind, this.fuelKind === 'coal' ? this.coal : this.coal * 2, Infinity);
    if (this.oil > 0) stock.add(this.oilKind, this.oil, Infinity);
    if (this.water > 0) stock.add('water', this.water, Infinity);
    this.coal = this.oil = this.water = 0;
  }
  get headTile(): { x: number; y: number } | null {
    const p = this.trail[this.trail.length - 1];
    return p ? { x: p.seg.x, y: p.seg.y } : null;
  }
  /** Track segment under the leading car, the start of any path search from here. */
  get headSeg(): PathSegment | null {
    return this.trail[this.trail.length - 1]?.seg ?? null;
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
    // the consist stands behind the gate: where the rails end (inside the shed) a straight
    // virtual run carries the rest of the cars, hidden under the shed until they roll out
    const first = back[0] ?? seg;
    const firstPts = track.segGeom(first.x, first.y, first.in, first.out, first.route).pts;
    const p0 = { x: first.x + firstPts[0].x, y: first.y + firstPts[0].y };
    const behind = this.length + 1 - back.length;
    const dx = DIR_DX[first.in];
    const dy = DIR_DY[first.in];
    for (let d = Math.ceil(behind / 0.125); d >= 1; d--)
      this.pushTrail({ x: p0.x + dx * d * 0.125, y: p0.y + dy * d * 0.125, seg: first });
    for (const s of [...back, seg]) {
      const pts = track.segGeom(s.x, s.y, s.in, s.out, s.route).pts;
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
    this.prevVehiclePoses = this.vehiclePoses;
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
    this.prevVehiclePoses = this.vehiclePoses;
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
    const specs = this.vehicleSpecs;
    const order = this.reversed ? [...specs].reverse() : specs;
    const fronts = vehicleFronts(order.map((s) => s.L));
    const pl = new Polyline(this.trail);
    const total = pl.length;
    const vposes = order.map((s, i) => poseVehicle(pl, total - fronts[i], s));
    // keep the arrays in car order (loco first) regardless of travel direction
    if (this.reversed) vposes.reverse();
    this.vehiclePoses = vposes;
    this.poses = vposes.map((v) => ({ x: v.x, y: v.y, heading: v.heading }));
  }

  /** Facing index (of 24) for a car (loco faces backwards when pushed). */
  facingOf(_carIndex: number, pose: CarPose) {
    return facingOf(pose.heading + (this.reversed ? Math.PI : 0));
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
    const target = builder.stationById(
      this.detour ?? this.route[this.routeIndex % this.route.length],
    );
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
        : this.pathTo(track, { x: seg.x, y: seg.y, in: seg.in }, isTarget, 100000, avoid);
    if (!path && mode !== 'forward') {
      // reverse the consist and try the other way
      const alt = this.pathTo(track, { x: seg.x, y: seg.y, in: seg.out }, isTarget, 100000, avoid);
      if (alt) {
        this.reverseConsist();
        // the head is now the old rear car: re-anchor the path on its actual tile
        const nh = this.trail[this.trail.length - 1].seg;
        if (isTarget(nh.x, nh.y)) {
          this.path = null;
          this.trackVersion = track.version;
          return true;
        }
        path = this.pathTo(track, { x: nh.x, y: nh.y, in: nh.in }, isTarget, 100000, avoid) ?? alt;
      }
    }
    if (!path) return false;
    this.setPath(path, map, track);
    this.trackVersion = track.version;
    return true;
  }

  private reverseConsist() {
    const total = this.trailCum[this.trailCum.length - 1];
    const newHeadArc = Math.min(total, this.length); // arc behind head of the rear end
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

  private setPath(path: PathSegment[], map: GameMap, track: TrackGraph) {
    this.path = path;
    this.pathPts = [];
    this.pathCum = [];
    track.resolveRoutes(path);
    for (let s = 0; s < path.length; s++) {
      const seg = path[s];
      const geom = track.segGeom(seg.x, seg.y, seg.in, seg.out, seg.route);
      const pts = geom.pts;
      const last = s === path.length - 1;
      const upto = last ? Math.floor(pts.length / 2) + 1 : pts.length;
      let factor = curveFactor(geom.radius, trackData.curveSpeed);
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

  /** arc position along the current path */
  get pathProgress() {
    return this.pathPos;
  }
  /** Tiles of the path from the head onwards (one entry per tile, with the arc it starts at). */
  pathAhead(maxTiles = Infinity): { x: number; y: number; arc: number }[] {
    const out: { x: number; y: number; arc: number }[] = [];
    if (!this.path) return out;
    let last: PathSegment | null = null;
    for (let i = 0; i < this.pathPts.length; i++) {
      if (this.pathCum[i] < this.pathPos - 0.5) continue;
      const seg = this.pathPts[i].seg;
      if (seg === last) continue;
      last = seg;
      out.push({ x: seg.x, y: seg.y, arc: this.pathCum[i] });
      if (out.length >= maxTiles) break;
    }
    return out;
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
    this.prevVehiclePoses = this.vehiclePoses;
    this.stateTime += gdt;
    if (this.resumePending) {
      // the contract closed under way: head for the program's next stop instead
      this.resumePending = false;
      if (!this.job && this.suspended && this.state === 'moving' && !this.holding) {
        if (this.jobs.length) this.startJob();
        else this.resumeProgram(true);
        const wasReversed = this.reversed;
        if (this.dispatch(ctx.track, ctx.builder, ctx.map)) {
          if (!this.path) {
            this.pathPts = [];
            this.pathCum = [];
            this.onPathReady(ctx);
          } else if (wasReversed !== this.reversed) this.updatePoses();
        } else this.setState('noRoute');
        return;
      }
    }
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
      case 'idle':
        if (this.stateTime > 10) this.depart(ctx);
        break;
      case 'yielding': {
        // wait on the siding until a path to the target avoids every tile other trains stand on
        if (this.stateTime < 2) break;
        const held = this.stateTime;
        this.stateTime = 0;
        const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
        const wasReversed = this.reversed;
        if (
          this.dispatch(ctx.track, ctx.builder, ctx.map, avoid) ||
          (ctx.now > this.yieldUntil + 60 && this.dispatch(ctx.track, ctx.builder, ctx.map))
        ) {
          this.wantKeys = null;
          this.yieldWait = 0;
          this.clearHold();
          if (!this.path) {
            this.pathPts = [];
            this.pathCum = [];
            this.onPathReady(ctx);
          } else {
            if (wasReversed !== this.reversed) this.updatePoses();
            this.setState('moving');
          }
        } else {
          this.noteBlockerOnPlainPath(ctx, held);
          this.yieldWait += held;
          // a roaming train with no way to its pick stays parked here and chooses again later
          if (this.dynamic && this.yieldWait > 20 && this.blockedBy === null) {
            this.badTargets.set(this.route[this.routeIndex % this.route.length], ctx.now + 240);
            this.yieldWait = 0;
            this.atStation = null;
            this.lastMessage = 'parked: no way to the chosen stop';
            this.setState('idle');
          }
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
          // a train with nowhere to go takes up a queued contract right away
          if (!this.job && this.jobs.length) this.startJob();
          if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
          else this.stateTime = 0;
        }
        break;
    }
  }

  /**
   * A train already holding on a siding still has to report who stands in its way, otherwise the
   * fleet's jam resolution never sees a ring of holding trains waiting on each other. Records the
   * plain path it wants to take and the first train standing on it.
   */
  private noteBlockerOnPlainPath(ctx: TickCtx, held: number) {
    if (!this.trail.length || !this.route.length) return;
    const target = ctx.builder.stationById(
      this.detour ?? this.route[this.routeIndex % this.route.length],
    );
    const plat = target ? ctx.builder.platformTiles(target) : [];
    const w = ctx.track.w;
    const targetSet = new Set(plat.map((p) => p.y * w + p.x));
    const isTarget = (x: number, y: number) => targetSet.has(y * w + x);
    const head = this.trail[this.trail.length - 1].seg;
    const path =
      this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.in }, isTarget, 100000) ??
      this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.out }, isTarget, 100000);
    this.wantKeys = path ? path.map((s) => s.y * w + s.x) : null;
    let by: number | null = null;
    if (path)
      for (const s of path) {
        const o = ctx.occupants(s.x, s.y).filter((id) => id !== this.id);
        if (o.length) {
          by = o[0];
          break;
        }
      }
    this.blocked = by !== null;
    this.blockedBy = by;
    this.blockedTime = by !== null ? this.blockedTime + held : 0;
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
    const target = ctx.builder.stationById(
      this.detour ?? this.route[this.routeIndex % this.route.length],
    );
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
    {
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
    // traffic control: stop short of track another train holds (not while pulling aside)
    if (!this.holding && this.claimLimit - HOLD_GAP < blockDist) {
      blockDist = Math.max(0, this.claimLimit - HOLD_GAP);
      blocker = this.claimBlocker;
    }
    this.blocked = blockDist < 0.3;
    this.blockedBy = this.blocked ? blocker : null;
    this.holdDist = blockDist;
    if (this.dynamic && ctx.now >= this.anticipateAt && this.path) {
      // look 8 tiles ahead: if another train has reserved that stretch coming our way, try a
      // path around it now instead of stopping later
      this.anticipateAt = ctx.now + 4;
      let oncoming = 0;
      for (let i = 0; i < this.pathPts.length; i++) {
        const arc = this.pathCum[i];
        if (arc < this.pathPos + 0.5) continue;
        if (arc > this.pathPos + 8) break;
        const s = this.pathPts[i].seg;
        const other = ctx.reservedBy(s.x, s.y, this.id);
        if (other) {
          const theirs = ctx.trainPath(other);
          const head = this.headTile;
          // they are heading into us when our head tile is on their path too
          if (head && theirs.has(head.y * ctx.track.w + head.x)) oncoming = other;
          break;
        }
      }
      if (oncoming) {
        const avoid = (x: number, y: number) =>
          ctx.occupied(x, y, this.id) || ctx.reservedBy(x, y, this.id) === oncoming;
        const wasReversed = this.reversed;
        if (this.dispatch(ctx.track, ctx.builder, ctx.map, avoid, 'forward')) {
          this.lastMessage = 'detouring around an oncoming train';
          if (!this.path) {
            this.pathPts = [];
            this.pathCum = [];
            this.onPathReady(ctx);
            return;
          }
          if (wasReversed !== this.reversed) this.updatePoses();
          return;
        }
      }
    }
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
      if (this.blockedTime > REROUTE_AFTER + RETRY_EVERY) {
        // still stuck: allow another reroute attempt
        this.blockedTime = REROUTE_AFTER * 0.5;
        this.rerouted = false;
      }
    } else {
      this.blockedTime = 0;
    }
    const ecoMul = this.eco ? ECO_MUL : 1;
    const headT = this.headTile;
    const bio = headT ? ctx.biomeAt(headT.x, headT.y) : { speedMul: 1, waterUseMul: 1 };
    const vmax =
      this.maxSpeed *
      this.loadFactor *
      this.factorAt(this.pathPos + 0.3) *
      ctx.speedFactor *
      bio.speedMul *
      ecoMul *
      (this.reversed ? this.reverseFactor : 1);
    this.freeSpeed = vmax;
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
      const burn = step * ecoMul;
      if (this.coalRate > 0) {
        this.coal -= this.coalRate * burn;
        bump(
          this.trip.fuel,
          this.fuelKind,
          (this.coalRate * burn) / (this.fuelKind === 'coal' ? 1 : 0.5),
        );
      }
      if (this.waterRate > 0) {
        const wb = this.waterRate * burn * bio.waterUseMul;
        this.water -= wb;
        bump(this.trip.fuel, 'water', wb);
      }
      if (this.oilRate > 0) {
        this.oil -= this.oilRate * burn;
        bump(this.trip.fuel, this.oilKind, this.oilRate * burn);
      }
      // traction sand (full production chain): spread on the rails, never a reason to stop
      const sand = sandPerTile();
      if (sand > 0) {
        const got = ctx.stockpile.take('sand', sand * step);
        if (got > 0) bump(this.trip.fuel, 'sand', got);
      }
      if (this.powerRate > 0) {
        ctx.stockpile.take('power', this.powerRate * burn);
        bump(this.trip.fuel, 'power', this.powerRate * burn);
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
      const want = ctx.builder.stationById(
        this.detour ?? this.route[this.routeIndex % this.route.length],
      );
      this.path = null;
      this.speed = 0;
      if (this.holding) {
        this.holding = false;
        this.setState('yielding');
        return;
      }
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
    this.yieldCount = 0;
    this.loadedHere = 0;
    this.clearHold();
    if (this.detour === st.id) {
      // fuel stop on the way: fill up, then carry on to the scheduled stop
      sfx('train.arrive');
      if (st.hasFreePlatform()) {
        st.occupants.add(this.id);
        this.setState('loading');
      } else this.setState('waiting');
      return;
    }
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
    const atDetour = this.detour === st.id;
    const stop: StopPlan = atDetour
      ? { ...defaultStop(st.id), load: 'none', unload: 'none', waitFull: false }
      : (this.currentStop ?? defaultStop(st.id));
    if (stop.refuel && this.stateTime < gdt * 1.5) {
      // top up once on arrival: supplied stations (and a fuel detour) fill the tanks; elsewhere
      // carts bring half a tank, or a full one when the next leg would otherwise be out of reach
      // fill the tanks: from the stockpile at a depot or a supplied station, from a warehouse's
      // own store elsewhere in a town, and from the stockpile by cart anywhere else
      // (in the simple production chain a warehouse also tops up from the stockpile; in the
      // full one it only has what trains brought it)
      const local = st.def.stockpile && !st.def.pool ? st : null;
      const taken = local
        ? this.refuelFromStation(local)
        : this.refuel(ctx.stockpile, { fuel: true, water: true, fuelFrac: 1, waterFrac: 1 });
      if (local && supplyMode() === 'simple')
        for (const [k, v] of Object.entries(
          this.refuel(ctx.stockpile, { fuel: true, water: true, fuelFrac: 1, waterFrac: 1 }),
        ))
          taken[k] = (taken[k] ?? 0) + v;
      for (const [k, v] of Object.entries(taken)) {
        bump(this.trip.fuel, `refuel_${k}`, v);
        this.flowAcc[k] = (this.flowAcc[k] ?? 0) - v;
      }
    }
    if (atDetour) {
      if (this.stateTime >= MIN_DWELL) this.depart(ctx);
      return;
    }
    let busy = false;
    let budget = st.loadRate * st.loadBoost * rules.loadRateMul * gdt;
    // unload: contract cargo is credited first, everything else enters the stockpile
    this.flowTimer += gdt;
    for (const w of this.wagons) {
      if (stop.unload === 'none') break;
      if (!w.cargo || w.amount <= 0) continue;
      // never hand back what was taken on right here (a warehouse would just refill the wagon)
      if (w.origin === st.id) continue;
      if (cargoClass(w.cargo) === 'people') {
        // passengers only alight at a station that takes them (a town) and pay per head
        if (!st.accepts(w.cargo)) continue;
        const n = Math.min(w.amount, budget);
        if (n <= 1e-6) continue;
        const origin = w.origin !== null ? ctx.builder.stationById(w.origin) : undefined;
        const dist = origin ? Math.abs(origin.x - st.x) + Math.abs(origin.y - st.y) : 10;
        const fare = n * cargoDef(w.cargo).price * (1 + Math.min(3, dist / 40));
        ctx.earn(fare);
        this.trip.income += fare;
        ctx.onPassengers(st, n, false);
        w.amount -= n;
        budget -= n;
        busy = true;
        bump(this.trip.delivered, w.cargo, n);
        if (w.amount < 1e-3) {
          w.amount = 0;
          w.cargo = null;
          w.origin = null;
        }
        continue;
      }
      // where the load can go: the stockpile only at a depot, a warehouse's own store, or a
      // station that wants it (contract or spot market)
      const room = st.def.pool
        ? Math.max(0, ctx.stockCap(w.cargo) - ctx.stockpile.get(w.cargo))
        : st.def.stockpile
          ? st.room
          : 0;
      const contractable = !st.def.pool && !st.def.stockpile && st.accepts(w.cargo);
      if (!st.def.pool && !st.def.stockpile && !contractable) continue;
      let n = Math.min(w.amount, budget, contractable ? w.amount : room);
      if (n <= 1e-6) continue;
      let credited = 0;
      if (contractable || st.def.stockpile)
        credited = ctx.onDelivery({
          cargo: w.cargo,
          amount: n,
          origin: w.origin ?? -1,
          station: st,
          train: this,
        });
      const toStore = Math.min(n - credited, room);
      n = credited + toStore;
      if (n <= 1e-6) continue;
      if (toStore > 0) {
        if (st.def.pool) ctx.stockpile.add(w.cargo, toStore, Infinity);
        else st.store(w.cargo, toStore);
        this.flowAcc[w.cargo] = (this.flowAcc[w.cargo] ?? 0) + toStore;
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
    if (this.flowTimer >= 90) this.flushFlow(ctx, st);
    // load what the station makes (or, at a warehouse, keeps) when a later stop takes it: a
    // depot takes anything, a warehouse anything from a producer, a town what it accepts
    // what may be taken on here: a production train only takes from producers, a collection
    // train only from warehouses, a transport train only passengers
    const job = this.job;
    const produced = st.availableCargo().filter((c) => {
      // at a contract's origin only the contract's cargo comes aboard
      if (job && st.id === job.originId) return c === job.cargo;
      if (this.mode === 'production') return !st.def.stockpile || st.producedCargo().includes(c);
      if (this.mode === 'collection') return st.def.stockpile && cargoClass(c) !== 'people';
      if (this.mode === 'transport') return cargoClass(c) === 'people';
      return true;
    });
    // a dynamic train has no fixed route: any other station may take what it loads here; a
    // train on a contract follows the job's two stops
    const routeStations = (
      this.dynamic && !job
        ? ctx.builder.stations.filter((s) => ctx.builder.platformTiles(s).length > 0)
        : this.route.map((id) => ctx.builder.stationById(id))
    ).filter((s): s is Station => !!s && s !== st);
    const taker = (c: string) =>
      routeStations.some((s) =>
        cargoClass(c) === 'people'
          ? s.accepts(c)
          : s.def.pool ||
            (s.def.stockpile && !st.def.stockpile) ||
            (!s.def.stockpile && s.accepts(c)),
      );
    let allFull = true;
    let canLoadAny = false;
    for (const w of this.wagons) {
      if (stop.load === 'none') break;
      if (budget <= 0) break;
      if (w.cargo && w.amount >= w.def.capacity * levelMul(w.level) - 1e-3) continue;
      const options = produced.filter(
        (c) => (w.def.accepts ?? []).includes(c) && (!w.cargo || w.cargo === c) && taker(c),
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
      canLoadAny = true;
      allFull = false;
      // nothing on hand right now: wait for output (the wait-for-full rule decides how long)
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
      this.loadedHere += n;
      bump(this.trip.loaded, c, n);
      if (cargoClass(c) === 'people') ctx.onPassengers(st, n, true);
      // still taking goods on: stay while the station keeps handing them over
      if (n > 1e-6 && (st.stored(c) >= 1 || n >= want * 0.5)) busy = true;
      if (w.amount < cap - 1e-3) allFull = false;
    }
    // wait for full wagons only while the station still has something to give, and never when
    // the tanks are low (fuel comes first)
    // a scheduled train waits for its wagons to fill while the station keeps producing (up to
    // the dwell limit); a roaming train only waits while there is still a pile to take from
    const canFill = this.dynamic
      ? produced.some((c) => st.stored(c) >= 1)
      : produced.some((c) => st.stored(c) >= 1 || st.productionPerDay > 0);
    const waitFull = stop.load !== 'none' && stop.waitFull && canFill && canLoadAny && !this.eco;
    if (waitFull && !allFull && this.stateTime < MAX_DWELL_FULL) busy = true;
    const maxDwell =
      stop.maxDwell && stop.maxDwell > 0 ? stop.maxDwell : waitFull ? MAX_DWELL_FULL : MAX_DWELL;
    const minDwell = Math.max(MIN_DWELL, stop.minDwell ?? 0);
    if ((!busy && this.stateTime >= minDwell) || this.stateTime >= maxDwell) this.depart(ctx);
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
    const wasDetour = this.detour !== null && st?.id === this.detour;
    this.detour = null;
    const leaving = wasDetour ? undefined : this.currentStop;
    const jobWants = wasDetour ? 'none' : this.stepJob(st);
    if (jobWants === 'stay' && st) {
      // at the contract's origin with nothing aboard yet: keep waiting for the load
      this.atStation = st;
      st.occupants.add(this.id);
      this.loadedHere = 0;
      this.setState('loading');
      return;
    }
    // otherwise the job's two-stop schedule is in force, its index set by the job bookkeeping
    const program = jobWants !== 'go' && !wasDetour;
    if (program && this.dynamic) {
      let next = ctx.chooseNext(this);
      if (next !== null && st && next === st.id && this.loadedHere < 1) {
        // nothing came aboard here: the pick is stale, look elsewhere for a minute
        this.badTargets.set(st.id, ctx.now + 60);
        next = ctx.chooseNext(this);
      }
      if (next !== null && next !== st?.id) {
        this.schedule = [defaultStop(next)];
        this.routeIndex = 0;
      } else if (next !== null && st) {
        // this station is still the best pick: keep loading as its output comes in
        this.schedule = [defaultStop(st.id)];
        this.routeIndex = 0;
        this.atStation = st;
        st.occupants.add(this.id);
        this.loadedHere = 0;
        this.setState('loading');
        return;
      } else {
        // nothing worth doing right now: stay on the platform and ask again in a while
        this.atStation = st;
        if (st) st.occupants.add(this.id);
        this.setState('idle');
        return;
      }
    } else if (program) this.routeIndex = (this.routeIndex + 1) % this.route.length;
    if (this.routeIndex === 0 && !wasDetour) {
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
    // prefer a path that keeps clear of tiles other trains stand on (takes the loop when one is
    // free); fall back to the plain shortest path
    const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
    const mode = leaving?.depart ?? 'auto';
    if (
      this.dispatch(ctx.track, ctx.builder, ctx.map, avoid, mode) ||
      this.dispatch(ctx.track, ctx.builder, ctx.map, undefined, mode)
    ) {
      if (!this.planFuelDetour(ctx)) this.onPathReady(ctx);
      else if (this.path) this.setState('moving');
    } else if (this.dynamic) {
      // a roaming train remembers the station it could not reach and picks another one soon
      this.badTargets.set(this.route[this.routeIndex % this.route.length], ctx.now + 240);
      this.atStation = st;
      if (st) st.occupants.add(this.id);
      this.lastMessage = 'no track to the chosen stop';
      this.setState('idle');
    } else this.setState('noRoute');
  }

  /**
   * Head-on meeting: back off to the previous stop (or any path that avoids the other train)
   * and let the oncoming train through. Returns false when there is nowhere to go.
   */
  retreat(ctx: TickCtx): boolean {
    if (!this.trail.length || this.blockedBy === null) return false;
    const other = this.blockedBy;
    // leaving a platform to make room frees it for the next train
    const leavePlatform = () => {
      if (this.atStation) {
        this.atStation.occupants.delete(this.id);
        this.atStation = null;
      }
    };
    const theirs = ctx.trainPath(other);
    const w = ctx.track.w;
    const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
    const ownLen = this.carLengths.reduce((a, b) => a + b, 0) + 0.5;
    // a holding spot: a track tile off the other train's path with room behind it; never a
    // platform tile someone else needs
    const isHold = (x: number, y: number) => {
      if (theirs.has(y * w + x) || avoid(x, y)) return false;
      if (ctx.claimedBy(x, y, this.id) !== null) return false; // track someone else holds
      const p = ctx.track.get(x, y);
      if (!p || p.links.length > 1 || p.unit) return false; // not on a switch or a wide curve
      return true;
    };
    // already standing clear of their line: shuffling further along would not help anyone
    if (this.occupancyKeys(w).every((k) => !theirs.has(k))) return false;
    const head = this.trail[this.trail.length - 1].seg;
    let path = this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.in }, isHold, 600, avoid);
    let flip = false;
    if (!path || path.length < 2) {
      const alt = this.pathTo(
        ctx.track,
        { x: head.x, y: head.y, in: head.out },
        isHold,
        600,
        avoid,
      );
      if (alt && alt.length >= 2) {
        path = alt;
        flip = true;
      } else path = null;
    }
    if (!path) return false;
    // extend the hold: keep going until the whole consist is clear of their path
    const tail = path[path.length - 1];
    // as deep as the free track allows: a dead-end siding shorter than the ideal still helps
    let deeper: PathSegment[] | null = null;
    for (let depth = Math.ceil(ownLen); depth >= 1 && !deeper; depth--)
      deeper = this.pathTo(
        ctx.track,
        { x: tail.x, y: tail.y, in: tail.in },
        (x, y) => {
          if (!isHold(x, y)) return false;
          const d = Math.abs(x - tail.x) + Math.abs(y - tail.y);
          return d >= depth;
        },
        400,
        (x, y) => avoid(x, y) || theirs.has(y * w + x),
      );
    if (deeper && deeper.length > 1) path = [...path, ...deeper.slice(1)];
    // no point holding where the rear cars would still stand on their line
    const need = Math.min(path.length, Math.ceil(ownLen - 0.5));
    for (let i = path.length - need; i < path.length; i++)
      if (theirs.has(path[i].y * w + path[i].x)) return false;
    if (flip) {
      this.reverseConsist();
      const nh = this.trail[this.trail.length - 1].seg;
      const p2 = this.pathTo(
        ctx.track,
        { x: nh.x, y: nh.y, in: nh.in },
        (x, y) => x === path![path!.length - 1].x && y === path![path!.length - 1].y,
        800,
        avoid,
      );
      if (p2) path = p2;
      this.updatePoses();
    }
    leavePlatform();
    this.setPath(path, ctx.map, ctx.track);
    this.trackVersion = ctx.track.version;
    this.holding = true;
    this.yieldCount++;
    this.yieldUntil = ctx.now + 30;
    this.clearHold();
    this.lastMessage = 'pulling aside for an oncoming train';
    this.setState('moving');
    return true;
  }
  /** Tile keys of the remaining path and every tile under the cars. */
  pathTileKeys(w: number, ahead = Infinity): Set<number> {
    const out = new Set<number>();
    for (const p of this.poses) out.add(Math.floor(p.y + 0.5) * w + Math.floor(p.x + 0.5));
    if (this.state === 'yielding' && this.wantKeys) for (const k of this.wantKeys) out.add(k);
    if (this.path)
      for (let i = 0; i < this.pathPts.length; i++) {
        if (this.pathCum[i] < this.pathPos - 0.5) continue;
        if (this.pathCum[i] > this.pathPos + ahead) break;
        const s = this.pathPts[i].seg;
        out.add(s.y * w + s.x);
      }
    return out;
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
        oilKind: this.oilKind,
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
      detour: this.detour,
      mode: this.mode,
      jobs: this.jobs,
      job: this.job,
      jobPhase: this.jobPhase,
      suspended: this.suspended,
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
    t.detour = j.detour ?? null;
    t.jobs = j.jobs ?? [];
    t.job = j.job ?? null;
    t.jobPhase = j.jobPhase === 'dest' ? 'dest' : 'origin';
    t.suspended = j.suspended
      ? {
          schedule: j.suspended.schedule.map((s) => ({ ...defaultStop(s.stationId), ...s })),
          routeIndex: j.suspended.routeIndex,
        }
      : null;
    const legacy: Record<string, RouteMode> = {
      fixed: 'schedule',
      dynamic: 'production',
      collect: 'collection',
    };
    const m = j.mode as string | undefined;
    t.mode = m
      ? (legacy[m] ?? (DYNAMIC_MODES.includes(m as RouteMode) ? (m as RouteMode) : 'schedule'))
      : (j as { dynamic?: boolean }).dynamic
        ? 'production'
        : 'schedule';
    t.coal = j.tanks.coal;
    t.oil = j.tanks.oil;
    t.water = j.tanks.water;
    t.fuelKind = j.tanks.kind;
    t.fuelPreference = j.tanks.pref;
    t.oilKind = j.tanks.oilKind === 'diesel' ? 'diesel' : 'oil';
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
