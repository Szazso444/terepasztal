import { type Vec2, Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { TrackGraph, TrackPiece } from '../world/track';
import { curveFactor } from '../world/trackGeom';
import { findPath, walkBack, type PathSegment, type PathStart } from '../world/pathfinding';
import { lineSpeedCap, approachCap } from './lineSpeed';
import type { MaintenanceBoard, MaintJob } from './maintenance';
import {
  consistAccess,
  consistGauge,
  lineToll,
  pieceClassFor,
  trainClassOf,
  type ConsistAccess,
} from './compat';
import { collectorCeiling, type SupplyKind } from './catenary';
import { BRIDGE_SLOW_FACTOR, slowsOnBridge } from './bridges';
import type { Signals } from './signals';
import { Terrain, terrainAt, type GameMap } from '../world/tiles';
import { locoDef, wagonDef, levelMul, type LocoDef, type WagonDef } from '../gacha/items';
import type { LocoType, TrainClass } from '../data/content';
import type { ResourceStore, StoreRegistry } from './stores';
import type { Builder } from './build';
import type { Station } from './stations';
import { cargoDef, cargoClass } from './cargo';
import { content } from '../data/content';
import { rules, daySeconds, weekSeconds } from './rules';
import { stateOf } from './wear';
import { findRefugePath, findShuntPath, stateKey, statesReaching } from './recovery';
import { ENGLISH } from '../strings';
import {
  Polyline,
  poseVehicle,
  vehicleSpec,
  vehicleFronts,
  consistLength,
  facingOf,
  type VehiclePose,
  type VehicleSpec,
  type BodyFields,
} from './body';
import { dieselFuelId, sandPerTile } from './supply';
import { savedTrainColour } from './trainColours';

const trackData = content.track;
import { sfx } from '../engine/audio';

export type TrainState =
  | 'moving'
  | 'loading'
  | 'waiting'
  | 'idle'
  | 'yielding'
  | 'repairing'
  | 'noRoute'
  | 'stranded'
  | 'noFuel'
  | 'noPower'
  | 'overweight';

/**
 * How a unit works in the consist. The first unit leads; a unit of the leader's control class
 * runs in multiple (full effort); anything else, and every steam engine, is double-headed (the
 * summed effort is derated); a standby unit rides along dead until the pulling units lose their
 * power, then takes over until they recover.
 */
export type LocoMode = 'leading' | 'multiple' | 'doubleHeaded' | 'standby';
export interface LocoSlot {
  uid: number;
  def: LocoDef;
  level: number;
  /** as set by the player (or the default rule) */
  mode: LocoMode;
  /** runtime: pulling right now. A unit without usable power drops out; a standby unit steps in. */
  engaged: boolean;
  /** fitted with in-cab signalling equipment (the model may carry it by itself) */
  inCab?: boolean;
}
/** A slot as handed to the constructor: mode and engagement are filled in by the rule. */
export type LocoSlotInit = Omit<LocoSlot, 'mode' | 'engaged'> &
  Partial<Pick<LocoSlot, 'mode' | 'engaged'>>;
/** Default mode of a unit by its position and control class. */
export function defaultLocoMode(i: number, def: LocoDef, leader: LocoDef): LocoMode {
  if (i === 0) return 'leading';
  const cc = def.controlClass;
  return cc && cc === leader.controlClass ? 'multiple' : 'doubleHeaded';
}
/** Which locomotive type a refuelling cart serves. */
export function serviceLocoType(service: 'coal' | 'fuel' | 'battery'): LocoType {
  return service === 'coal' ? 'steam' : service === 'fuel' ? 'diesel' : 'electric';
}
const PHYS = content.track.physics;
export interface ConsistPhysics {
  /** effort of the pulling units, derated when any of them works double-headed */
  effort: number;
  /** every vehicle plus cargo, tonnes */
  mass: number;
  /** tiles/s² the effort gives the mass, clamped; 0 when nothing pulls */
  acceleration: number;
  /** tiles/s: the slowest vehicle of the consist */
  vMax: number;
  /** tonnes the units on duty (not standby, or a standby that has stepped in) may haul: a hard cap */
  haul: number;
  /** a pulling unit works double-headed */
  doubleHeaded: boolean;
  /** units pulling */
  engaged: number;
}
/**
 * Consist physics from the vehicles alone, so the depot can show a train before it exists.
 * Effort is the haul rating times a data constant; acceleration is effort over mass; the top
 * speed is the slowest vehicle's. A slower engine therefore caps the speed and adds effort.
 */
export function consistPhysics(
  locos: readonly { def: LocoDef; level: number; mode: LocoMode; engaged: boolean }[],
  wagons: readonly { def: WagonDef; level: number; cargo: string | null; amount: number }[],
): ConsistPhysics {
  const leader = locos[0]?.def;
  let effort = 0;
  let haul = 0;
  let mass = 0;
  let vMax = Infinity;
  let doubleHeaded = false;
  let engaged = 0;
  for (let i = 0; i < locos.length; i++) {
    const l = locos[i];
    mass += l.def.weight;
    vMax = Math.min(vMax, l.def.speed * levelMul(l.level));
    const rating = l.def.power * levelMul(l.level);
    if (l.mode !== 'standby' || l.engaged) haul += rating;
    if (!l.engaged) continue;
    engaged++;
    effort += rating * PHYS.effortPerTonne;
    // a unit set to multiple whose class no longer matches the leader's works double-headed
    const cc = l.def.controlClass;
    if (i > 0 && (l.mode === 'doubleHeaded' || !(cc && leader && cc === leader.controlClass)))
      doubleHeaded = true;
  }
  if (doubleHeaded) effort *= PHYS.doubleHeadEfficiency;
  for (const w of wagons) {
    mass += w.def.weight + (w.cargo ? w.amount * cargoDef(w.cargo).weight : 0);
    vMax = Math.min(vMax, w.def.vmax ?? PHYS.wagonVmax);
  }
  const acceleration =
    effort > 0 ? Math.min(PHYS.maxAccel, Math.max(0.05, effort / Math.max(1, mass))) : 0;
  return {
    effort,
    mass,
    acceleration,
    vMax: (vMax === Infinity ? 0 : vMax) * rules.trainSpeedMul,
    haul,
    doubleHeaded,
    engaged,
  };
}
/**
 * Static: `schedule` follows the player's stop list to the letter. Dynamic: `freight` heads for
 * the fullest producer or warehouse and hauls its goods on (producer goods into the nearest
 * warehouse or a depot, warehouse goods into a depot), `transport` carries passengers between
 * town stations, `contract` works the contracts handed to it; all three pick their stops on the
 * fly. `maintenance` looks after the track and needs a maintenance wagon; it is not among
 * `DYNAMIC_MODES`, since only a consist with the wagon is offered it (`dispatchModes`).
 */
export type RouteMode = 'schedule' | 'freight' | 'transport' | 'contract' | 'maintenance';
export const DYNAMIC_MODES: RouteMode[] = ['freight', 'transport', 'contract'];
/** What a train does at one stop of its looped schedule. */
export interface StopPlan {
  stationId: number;
  load: 'auto' | 'none';
  /** auto: only at a warehouse or where a contract / passengers want it */
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
/**
 * The store a train fills its tanks from at a station: its dock (a depot's or a warehouse's own, a
 * Townhouse's and a warehouse's in a town the town's); at another station that refuels, its
 * trackside supplier within `rules.fuelReach` (`StoreRegistry.fuelSupplierFor`); none at any
 * other.
 */
export function stationStore(stores: StoreRegistry, st: Station): ResourceStore | null {
  const dock = stores.dockOf(st);
  if (dock) return dock;
  return st.refuelsFuel || st.refuelsWater ? stores.fuelSupplierFor(st.x, st.y) : null;
}

/** What a train owes as its save holds it: optional, as a file written before has none. */
function owedJSON(owed: { food: number; sand: number }): {
  owed?: { food: number; sand: number };
} {
  return { owed: { ...owed } };
}
/** A maintenance train's job, waiting place and repair debt in its save: only when it has them. */
function maintJSON(
  maint: MaintJob | null,
  parkAt: { x: number; y: number } | null,
  repairOwed: Record<string, number>,
): {
  maint?: MaintJob;
  parkAt?: { x: number; y: number };
  repairOwed?: Record<string, number>;
} {
  return {
    ...(maint && { maint: { ...maint } }),
    ...(parkAt && { parkAt: { ...parkAt } }),
    ...(Object.keys(repairOwed).length && { repairOwed: { ...repairOwed } }),
  };
}
/** A maintenance train's job as a file holds it: null unless whole. */
function maintOf(v: MaintJob | undefined): MaintJob | null {
  if (typeof v !== 'object' || v === null) return null;
  const { ax, ay, tier, x, y } = v;
  const tiles = [ax, ay, x, y].every(Number.isInteger);
  return tiles && (tier === 0 || tier === 1 || tier === 2) ? { ax, ay, tier, x, y } : null;
}
/** A waiting place as a file holds it: null unless a whole tile. */
function parkAtOf(v: { x: number; y: number } | undefined): { x: number; y: number } | null {
  if (typeof v !== 'object' || v === null) return null;
  const { x, y } = v;
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}
/** What repairs left owing as a file holds it: the finite amounts above 0. */
function repairOwedOf(v: Record<string, number> | undefined): Record<string, number> {
  const owed = typeof v === 'object' && v !== null ? Object.entries(v) : [];
  return Object.fromEntries(owed.filter(([, n]) => owedOf(n) > 0));
}
/** An amount owed as a file holds it: 0 unless a finite amount above 0. */
const owedOf = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

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

/** One tile of a train's path ahead: the tile, how it is run, and the arc it starts at. */
export interface AheadTile {
  readonly x: number;
  readonly y: number;
  readonly in: Dir;
  readonly out: Dir;
  readonly arc: number;
}
const NO_TILES: readonly AheadTile[] = [];

/** A path's points grouped into runs on one segment (one per tile), with a tile lookup. */
export interface PathTiles {
  /** the points it was built from, and how many there were */
  readonly pts: readonly unknown[];
  readonly n: number;
  /** one entry per run, at the arc of its first point */
  readonly tiles: AheadTile[];
  /** for every point, the index of its run */
  readonly run: Int32Array;
  /** map width `keys` is for (-1 before the first lookup) */
  w: number;
  /** tile key of every run */
  keys: Int32Array;
}

/** The run each list `pathAhead` built starts at, in the grouping it came from. */
const AHEAD_RUNS = new WeakMap<readonly AheadTile[], { tiles: PathTiles; from: number }>();

/**
 * For a list `Train.pathAhead()` returned whole: the tile keys (`y * w + x`) of its path's tiles,
 * `list[i]` standing on `keys[from + i]`, and the grouping they belong to (the same object for as
 * long as the train runs that path). Null for any other list.
 */
export function aheadRun(
  list: readonly AheadTile[],
  w: number,
): { keys: Int32Array; from: number; tiles: PathTiles } | null {
  const run = AHEAD_RUNS.get(list);
  if (!run) return null;
  const tiles = run.tiles;
  if (tiles.w !== w) {
    tiles.w = w;
    tiles.keys = Int32Array.from(tiles.tiles, (t) => t.y * w + t.x);
  }
  return { keys: tiles.keys, from: run.from, tiles };
}

/** Whether two lists of bodies pose alike: the same lengths and segments, vehicle by vehicle. */
function sameSpecs(a: readonly VehicleSpec[], b: readonly VehicleSpec[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.L !== q.L || p.segments.length !== q.segments.length) return false;
    for (let k = 0; k < p.segments.length; k++) {
      const s = p.segments[k];
      const t = q.segments[k];
      if (
        s.part !== t.part ||
        s.L !== t.L ||
        s.W !== t.W ||
        s.nb !== t.nb ||
        s.bogie !== t.bogie ||
        s.front !== t.front ||
        !!s.mirror !== !!t.mirror
      )
        return false;
    }
  }
  return true;
}

/** The first index from 1 on whose running sum reaches `arc` (`cum.length` when none does). */
function reach(cum: readonly number[], arc: number) {
  let lo = 1;
  let hi = cum.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < arc) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How much trail a train lays crossing `seg`, up to the tile's centre with `head` (where a head
 * stops): the chords between the tile's geometry points, which `spawnAt` lays and a moving train
 * lays where its path turns or crosses a tile edge (`layTrail`). A curve's chords fall a little
 * short of its arc (`segLength`), so the cars stand by these, not by the arcs.
 */
function trailLength(track: TrackGraph, seg: PathSegment, head = false) {
  const pts = track.segGeom(seg.x, seg.y, seg.in, seg.out, seg.route).pts;
  const upto = head ? Math.floor(pts.length / 2) + 1 : pts.length;
  let sum = 0;
  for (let i = 1; i < upto; i++)
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
}

/**
 * The index in `path` of the tile the rear end of a train `length` long stands on once its head
 * stops at the centre of the last tile, counted back along the trail the way lays (`trailLength`),
 * or -1 when the way is shorter than the train. A rear end on a tile edge (within `EDGE_SLACK`)
 * stands on the tile beyond it, the one `reversedTrail` sets off from.
 */
function rearOn(track: TrackGraph, path: readonly PathSegment[], length: number) {
  let behind = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    behind += trailLength(track, path[i], i === path.length - 1);
    if (behind > length + EDGE_SLACK) return i;
  }
  return -1;
}

/** Trail laid past the rear of a train placed on the track (`spawnAt`): a tile and a half. */
const SPAWN_REACH = 1.5;

/**
 * The track behind a train `length` long whose head stops on `seg`: the tiles `walkBack` finds,
 * as many as it takes for the trail laid along them and the head's half of its own tile
 * (`trailLength`) to reach SPAWN_REACH past the rear, or as many as there are before the rails
 * end; the trail that must reach, and how much the tiles lay. A straight tile lays a tile of
 * trail and a curve less, so the walk asks for a tile per tile of train and one more, then for
 * what the curves left short.
 */
function trackBehind(track: TrackGraph, seg: PathSegment, length: number) {
  const need = length + SPAWN_REACH;
  const head = trailLength(track, seg, true);
  let tiles = Math.ceil(length) + 1;
  let before = -1;
  for (;;) {
    const back = walkBack(track, seg.x, seg.y, seg.in, tiles);
    let laid = head;
    for (const s of back) laid += trailLength(track, s);
    // done when the trail reaches, when the rails end, or (never on built track) when it stalls
    if (laid >= need || back.length < tiles || laid <= before) return { back, need, laid };
    before = laid;
    tiles += Math.ceil(need - laid) + 1;
  }
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

const DECEL = 1.1;
const MIN_DWELL = 2;
/** tiles of path scanned ahead for other trains */
const LOOKAHEAD = 2.5;
/** distance kept before an occupied tile */
const HOLD_GAP = 0.45;
/** tiles short of the end of its path at which a train has arrived */
const ARRIVE = 1e-3;
/**
 * Tiles within which a point of the trail counts as on a tile edge: rounding in the car lengths
 * and in the trail's sums. A head on an edge stands on the tile it is leaving; a rear end on the
 * tile beyond it, which the train sets off from reversing and `onwardTest` counts from.
 */
const EDGE_SLACK = 1e-6;
/** seconds blocked before trying another path */
const REROUTE_AFTER = 6;
/** blocked this long: try rerouting again */
const RETRY_EVERY = 20;
/** states of a train that cannot work: it gives up its job (`Train.maint`) */
const STOPS_WORK: readonly TrainState[] = ['stranded', 'noFuel', 'noPower'];
/** states of a train standing with no way on (`Train.noWayOn`) */
const NO_WAY_ON: readonly TrainState[] = ['noRoute', ...STOPS_WORK];
/** notes about a yield, dropped when the train sets off from it */
const YIELD_NOTES: readonly string[] = [
  ENGLISH.traffic.pullingAside,
  ENGLISH.traffic.keptBack,
  ENGLISH.traffic.replan,
  ENGLISH.traffic.noWayOn,
  ENGLISH.traffic.jammed,
];
/** tank fraction below which the economy mode kicks in */
const ECO_BELOW = 0.3;
/** speed and consumption multiplier while saving fuel */
const ECO_MUL = 0.6;
/** Speed multiplier of a hungry train (`Train.hungry`), on top of the weather's. */
export const FAMINE_SPEED_MUL = 0.7;
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
  /** where goods are kept: trains fill their tanks from them, electric ones run on the grid */
  stores: StoreRegistry;
  /** is the tile inside a live electric network? */
  powered: (x: number, y: number) => boolean;
  /** electrification kind on a tile (null: bare rails) */
  supplyAt: (x: number, y: number) => SupplyKind | null;
  /** share of its draw a substation can deliver to trains under it (1 = all) */
  gridFactor: (x: number, y: number) => number;
  /** a train reports what it draws, units per second */
  gridDraw: (x: number, y: number, unitsPerSecond: number) => void;
  /** block signals (null when the game runs without) */
  signals: Signals | null;
  /** token working: is this plain section held by another train? */
  tokenBlocked: (x: number, y: number, self: number) => boolean;
  /** tiles a train keeps behind the one ahead under the signalling level */
  headway: (t: Train) => number;
  /** a resource entered (+) or left (-) a store at a tile: drives the floating indicators */
  onFlow: (x: number, y: number, resource: string, delta: number) => void;
  /** passengers boarded (true) or alighted (false) at a station */
  onPassengers: (station: Station, n: number, boarding: boolean) => void;
  /** tile keys (y*w+x) of another train's remaining path plus the tiles it stands on */
  trainPath: (id: number) => Set<number>;
  /** traffic control: train holding a tile (other than self), or null */
  claimedBy: (x: number, y: number, self: number) => number | null;
  /**
   * Atomically reserve a retreat before changing direction or leaving a platform: for a shunt,
   * both legs one after the other (`Traffic.reserveRecovery`).
   */
  reserveRecovery: (t: Train, path: PathSegment[], group: number[]) => boolean;
  /** Exclusive escape corridor of a different recovery, if any. */
  recoveryOwner: (x: number, y: number, self: number) => number | null;
  /** which other train has the next few tiles of its path through here (0 = nobody) */
  reservedBy: (x: number, y: number, self: number) => number;
  /** dynamic routing: the station a train should head for next, or null to keep its schedule */
  chooseNext: (t: Train) => number | null;
  /** the pieces maintenance trains look after */
  maintenance: MaintenanceBoard;
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
  /** speed multiplier for crossing a segment: slower climbing a hill, faster coming down */
  gradeAt?: (seg: PathSegment) => number;
  /**
   * The fleet captured the render poses at the start of this loop tick (`Fleet.beginFrame`), so a
   * tick leaves prevPoses alone and the renderer interpolates across every step of the loop tick.
   */
  framed?: boolean;
}

export interface RetreatPlan {
  path: PathSegment[];
  flip: boolean;
  group: number[];
  /** how far the move runs: both legs of a shunt */
  distance: number;
  /**
   * A shunt's second leg (`findShuntPath`): at the end of `path`, at rest and clear of the switch,
   * the train turns where it stands and runs it from the tile its rear end is on.
   */
  back?: PathSegment[];
}
/**
 * A save's way of a train under way (`Train.wayJSON`, since v17): the rest of its path, from the
 * first tile the train still counts as ahead of it or still stands on, and how far the head has
 * left to run along it.
 */
export interface WaySave {
  path: PathSegment[];
  left: number;
}
/**
 * A save's escape of a train backing off for another: the rest of its path, and its group. Since
 * v17 the path is a way (`WaySave`) with how far the head has left to run; before, it started on
 * the tile the head stood on, or the one it was leaving.
 */
export interface RetreatSave {
  path: PathSegment[];
  group: number[];
  left?: number;
  /**
   * The second leg of a shunt still to run after the path (`RetreatPlan.back`), with no format
   * version of its own: a save without it holds no shunt, as no save before it did.
   */
  back?: PathSegment[];
  /**
   * The escape gives way to the same train again (`Train.gaveWay`), with no format version of its
   * own either: a save without it was not kept back, as no save before it was.
   */
  kept?: boolean;
}
/** Reserves an escape for the train being resumed, as `TickCtx.reserveRecovery` does. */
export type ReserveEscape = (path: PathSegment[], group: number[]) => boolean;
/** The track tile of a fuel or water service a train is heading to, and what it hands out. */
export interface ServiceStop {
  x: number;
  y: number;
  fuel: boolean;
  water: boolean;
}

/** Where an idle train may stand to make way (`Train.planAside`), as tile keys. */
export interface AsideSpots {
  /** the routes of the other trains: never a place to stand */
  theirs: Set<number>;
  /** platforms of the stations other trains are bound for: never a place to stand */
  bound: Set<number>;
  /** sidings: dead-end track with no platform on it, which no train runs through; tried first */
  sidings: Set<number>;
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
  /** the player's colour code, an index into `TRAIN_COLOURS`: the outliner groups trains by it */
  colour = 0;
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
  /** power units in the battery carts */
  battery = 0;
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
  /** `trailLen[i]`: length from trail point i - 1 to i, kept by `pushTrail` for `trailLenOf` */
  private trailLen: number[] = [];
  private trailLenOf: TrailPoint[] | null = null;
  private path: PathSegment[] | null = null;
  private pathPts: { x: number; y: number; seg: PathSegment; factor: number }[] = [];
  private pathCum: number[] = [];
  private pathPos = 0;
  /** the path ends where failed track stops it, not at a stop: held on it, the train has no way on */
  private shortWay = false;
  /** the piece whose wear the head last paid for (not saved): one hit per piece entered */
  lastWornPiece: TrackPiece['wear'] | null = null;
  /** `pathPts` grouped by tile, built once per path (`pathTiles`) */
  private tilesOfPath: PathTiles | null = null;
  /** the last `pathAhead` list, kept while the head stays at the same path point */
  private aheadList: { tiles: PathTiles; from: number; list: readonly AheadTile[] } | null = null;
  private trackVersion = -1;
  /** store deliveries at the current stop, flushed to `onFlow` every second or so */
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
    if (!cursor || !this.route.length || this.maintaining) return out;
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
  /** A temporary service stop leaves the scheduled destination and cargo program intact. */
  private serviceStop: ServiceStop | null = null;
  /** game time of the next look for a service */
  private nextFuelCheck = 0;
  /** Route to the closest reachable, stocked service that replenishes the limiting tank. */
  planFuelDetour(ctx: TickCtx): boolean {
    if (
      this.holding ||
      this.serviceStop ||
      this.detour !== null ||
      this.rangeTiles === Infinity ||
      !this.trail.length
    )
      return false;
    const remaining = this.path ? this.pathTotal - this.pathPos : 0;
    if (this.tankFraction > 0.4 && this.rangeTiles > remaining * 1.6 + 12) return false;
    const coalNeed =
      this.coalCap > 0 &&
      this.coal < this.coalCap * 0.9 &&
      (this.coal / this.coalCap < 0.5 ||
        this.coal / Math.max(1e-6, this.coalRate) < remaining * 1.6 + 12);
    const oilNeed =
      this.oilCap > 0 &&
      this.oil < this.oilCap * 0.9 &&
      (this.oil / this.oilCap < 0.5 ||
        this.oil / Math.max(1e-6, this.oilRate) < remaining * 1.6 + 12);
    const waterNeed =
      this.waterCap > 0 &&
      this.water < this.waterCap * 0.9 &&
      (this.water / this.waterCap < 0.5 ||
        this.water / Math.max(1e-6, this.waterRate) < remaining * 1.6 + 12);
    const hasFuel = (store: ResourceStore) =>
      (!coalNeed || store.get('coal') + store.get('wood') / 2 > 0.1) &&
      (!oilNeed || store.get(dieselFuelId()) > 0.1);
    const fuelRange = Math.min(
      coalNeed ? this.coal / Math.max(1e-6, this.coalRate) : Infinity,
      oilNeed ? this.oil / Math.max(1e-6, this.oilRate) : Infinity,
    );
    const waterRange = waterNeed ? this.water / Math.max(1e-6, this.waterRate) : Infinity;
    const wantsFuel = (coalNeed || oilNeed) && fuelRange <= waterRange;
    const wantsWater = waterNeed && waterRange <= fuelRange;
    // a point is worth the detour only when the store it fills from holds what is wanted
    const candidates = ctx.builder.serviceTiles().filter((p) => {
      const store = this.serviceStoreAt(ctx, p.x, p.y);
      return (
        !!store &&
        ((wantsFuel && p.fuel && hasFuel(store)) ||
          (wantsWater && p.water && store.get('water') > 0.1))
      );
    });
    if (!candidates.length) return false;
    const points = new Map(candidates.map((p) => [p.y * ctx.track.w + p.x, p]));
    const target = (x: number, y: number) => points.has(y * ctx.track.w + x);
    const head = this.trail[this.trail.length - 1].seg;
    // A scheduled destination already offering the needed service is the planned fuel stop.
    const end = this.path?.[this.path.length - 1];
    if (end && target(end.x, end.y) && remaining * 1.6 + 2 < this.rangeTiles) {
      const supply = points.get(end.y * ctx.track.w + end.x)!;
      if (((!coalNeed && !oilNeed) || supply.fuel) && (!waterNeed || supply.water)) return false;
    }
    const reverse = this.reversedTrail();
    const rear = reverse.trail[reverse.trail.length - 1]?.seg;
    const plans = [{ flip: false, head }, ...(rear ? [{ flip: true, head: rear }] : [])]
      .flatMap((p) => {
        const route = this.pathTo(
          ctx.track,
          { x: p.head.x, y: p.head.y, in: p.head.in },
          target,
          6000,
        );
        if (!route) return [];
        const distance = route.reduce((n, s) => n + ctx.track.segLength(s.x, s.y, s.in, s.out), 0);
        return distance * 1.6 + 1 < this.rangeTiles ? [{ ...p, route, distance }] : [];
      })
      .sort((a, b) => a.distance - b.distance);
    const best = plans[0];
    if (!best) return false;
    if (best.flip) this.reverseConsist();
    const last = best.route[best.route.length - 1];
    this.serviceStop = points.get(last.y * ctx.track.w + last.x)!;
    this.atStation?.occupants.delete(this.id);
    this.atStation = null;
    this.setPath(best.route, ctx.map, ctx.track);
    this.trackVersion = ctx.track.version;
    this.setState('moving');
    this.lastMessage = ENGLISH.trainNote.service;
    return true;
  }
  /**
   * The store a fuel or water point on a track tile fills from: on the platforms of a depot or a
   * supplied station, that station's (`stationStore`); elsewhere the tile's trackside supplier.
   */
  private serviceStoreAt(ctx: TickCtx, x: number, y: number): ResourceStore | null {
    const st = ctx.builder.stations.find(
      (s) =>
        !s.def.stockpile &&
        (s.refuelsFuel || s.refuelsWater) &&
        s.distTo(x, y) <= 1 &&
        ctx.builder.platformTiles(s).some((p) => p.x === x && p.y === y),
    );
    return st ? stationStore(ctx.stores, st) : ctx.stores.fuelSupplierFor(x, y);
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
  /**
   * Game time from which an idle train in another train's way may look again for a way aside
   * (`Fleet.makeWay`): each look puts it ASIDE_RETRY seconds on.
   */
  asideRetry = 0;
  /**
   * Game time from which a jam the train is in may be searched again for one to back off
   * (`Traffic.canRecover`): each search puts it 4 s on for every train of the jam.
   */
  recoveryRetry = 0;
  /** the current path ends at a holding spot, not a station */
  holding = false;
  /** the holding path is an idle train making way: at its end the train idles there again */
  private aside = false;
  /**
   * An idle train on its way out of other trains' route (`retreat` from the idle state, or from
   * standing with no stop at all).
   */
  get makingWay() {
    return this.aside;
  }
  /** distance along the path to the first tile the traffic control did not grant (Infinity: free) */
  claimLimit = Infinity;
  /** train holding that tile */
  claimBlocker: number | null = null;
  /** seconds spent in the yielding state without a way forward */
  private yieldWait = 0;
  /** units taken on since arriving at the current stop */
  private loadedHere = 0;
  /**
   * A freight train has put goods down at the stop it stands at. It takes nothing on there and
   * does not pick the stop again, so what it put down is not hauled straight back out. Saved.
   */
  private dropped = false;
  /** a roaming train sitting at a station with nothing coming aboard: it has nowhere urgent to be */
  get waitingForCargo() {
    return this.dynamic && this.loadedHere < 1 && this.stateTime > 6;
  }
  /** the train we pulled aside for */
  /** times this train pulled aside since it last reached a station: jams take turns */
  yieldCount = 0;
  /** station id of a refuelling detour taken before the scheduled stop */
  detour: number | null = null;
  /**
   * How the next stop is chosen: `schedule` follows the stop list, every other mode asks the fleet
   * (`Fleet.chooseNext`).
   */
  mode: RouteMode = 'schedule';
  /** true for every mode that picks stops on the fly */
  get dynamic() {
    return this.mode !== 'schedule';
  }
  /** the piece it looks after (`MaintenanceBoard`), kept until the job is done or left */
  maint: MaintJob | null = null;
  /** the tile it waits on with no job, or heads for to wait (`MaintenanceBoard.park`) */
  parkAt: { x: number; y: number } | null = null;
  /** what its repairs have cost short of a whole unit, by resource */
  repairOwed: Record<string, number> = {};
  /** at work with no store able to pay the next units: it stands and waits (not saved) */
  repairUnpaid = false;
  /** On the Maintenance mode, its work and not its stop list decides where it goes. */
  get maintaining() {
    return this.mode === 'maintenance' && !this.job;
  }
  /** Stopped with no way on, for now or for good: it needs no more track than it stands on. */
  get noWayOn() {
    return NO_WAY_ON.includes(this.state);
  }
  /** A maintenance train on no refuelling detour is bound for its job, its waiting place or nowhere. */
  private get boundForWork() {
    return this.maintaining && this.detour === null;
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
  /**
   * Set by `fromJSON` until `resumeAfterLoad` runs: the id of the station the train stood at when
   * saved, which a train cannot look up before it meets the builder, the escape it was backing
   * off along, which the traffic control has to reserve again, and the way it was running.
   */
  private loaded: {
    station: number | null;
    retreat: RetreatSave | null;
    way: WaySave | null;
  } | null = null;
  /** the waiting group the escape being run (`holding`) was reserved for */
  private retreatGroup: number[] = [];
  /** the second leg of the shunt being run, reserved with the path: run after the turn */
  private shunt: PathSegment[] | null = null;
  /**
   * the train the last escape in a jam gave way to (`gaveWay`) since the train last reached a stop,
   * not kept in a save
   */
  private gaveWayTo: number | null = null;
  /** the escape being run gives way to the same train again (`gaveWay`): said where it ends */
  private kept = false;
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
   * program at the next stop, or right away when it is under way or stands with no route to the
   * job (which has no next stop).
   */
  dropJob(contractId: number) {
    this.jobs = this.jobs.filter((j) => j.contractId !== contractId);
    if (this.job?.contractId !== contractId) return;
    this.job = null;
    if ((this.state === 'moving' && !this.holding) || this.state === 'noRoute')
      this.resumePending = true;
  }
  /**
   * The train's own program: the one set aside while a contract job runs, or after the job closed
   * until the train takes it up again; else the schedule it runs.
   */
  get program(): readonly StopPlan[] {
    return this.suspended?.schedule ?? this.schedule;
  }
  /**
   * Give the train a new program of its own. While one is set aside, the new one takes its place
   * and starts at its first stop once the train goes back to it; otherwise the train runs it now,
   * at the same index where it can.
   */
  setProgram(schedule: StopPlan[]) {
    if (this.suspended) {
      this.suspended = { schedule, routeIndex: Math.max(0, schedule.length - 1) };
      return;
    }
    this.schedule = schedule;
    this.routeIndex = Math.min(this.routeIndex, Math.max(0, schedule.length - 1));
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
    this.lastMessage = ENGLISH.trainNote.onContract(j.name);
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
    this.lastMessage = ENGLISH.trainNote.regularRun;
  }
  /**
   * The job closed with the train away from its stops: under way, or standing with no route to
   * them. It takes up the next queued contract, or goes back to its program at the stop after the
   * one it left for the job, a roaming train choosing again (with nothing worth picking it keeps
   * the stop it had). A roaming train with no way to its stop marks it bad and waits, as at a
   * platform; anything else with no way stands without a route and retries.
   */
  private resumeAway(ctx: TickCtx) {
    if (this.jobs.length) this.startJob();
    else {
      this.resumeProgram(true);
      const next = this.dynamic ? ctx.chooseNext(this) : null;
      if (next !== null) {
        this.schedule = [defaultStop(next)];
        this.routeIndex = 0;
      }
    }
    const moving = this.state === 'moving';
    const wasReversed = this.reversed;
    if (this.dispatch(ctx.track, ctx.builder, ctx.map)) {
      if (!moving) {
        if (!this.planFuelDetour(ctx)) this.onPathReady(ctx);
      } else if (!this.path) {
        this.pathPts = [];
        this.pathCum = [];
        this.onPathReady(ctx);
      } else if (wasReversed !== this.reversed) this.updatePoses();
    } else if (this.dynamic && !this.job) {
      this.badTargets.set(this.route[this.routeIndex % this.route.length], ctx.now + 240);
      this.idle(ENGLISH.trainNote.noTrackToStop);
    } else if (moving) this.setState('noRoute');
    else this.stateTime = 0;
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
  /**
   * the tiles of the way a waiting train would take once the line clears: on from a siding
   * (`yielding`), or aside out of another train's way (`idle`, `wantAside`)
   */
  private wantTiles: { x: number; y: number }[] | null = null;
  /** the states that run on to the stop `onwardTest` checks, kept for the rest of the tick */
  private onwardMemo: { key: string; states: Set<number> } | null = null;

  constructor(locos: LocoSlotInit[], name?: string, id?: number) {
    if (!locos.length) throw new Error('a train needs a locomotive');
    this.id = id ?? nextTrainId++;
    if (id !== undefined) nextTrainId = Math.max(nextTrainId, id + 1);
    this.locos = locos.map((l, i) => {
      const mode = i === 0 ? 'leading' : (l.mode ?? defaultLocoMode(i, l.def, locos[0].def));
      return { uid: l.uid, def: l.def, level: l.level, mode, engaged: mode !== 'standby' };
    });
    this.name = name ?? `${this.locoDef.name} ${this.id}`;
  }

  // ------------------------------------------------------------ stats
  /** Effort, mass, acceleration and top speed of the consist as it stands. */
  get physics(): ConsistPhysics {
    return consistPhysics(this.locos, this.wagons);
  }
  /** Slowest vehicle sets the pace. */
  get maxSpeed() {
    return this.physics.vMax;
  }
  /** Tonnes the pulling engines can haul together (haul capacity). */
  get power() {
    return this.physics.haul;
  }
  get effort() {
    return this.physics.effort;
  }
  /** Every vehicle plus cargo, tonnes. */
  get mass() {
    return this.physics.mass;
  }
  /** Tiles/s² the pulling engines give the whole consist. */
  get acceleration() {
    return this.physics.acceleration;
  }
  /**
   * Set a non-leading unit to standby (dead weight, no fuel, steps in when the pulling units lose
   * their power) or back to its default mode.
   */
  setStandby(i: number, standby: boolean) {
    if (i <= 0 || i >= this.locos.length) return;
    const l = this.locos[i];
    l.mode = standby ? 'standby' : defaultLocoMode(i, l.def, this.locos[0].def);
    l.engaged = !standby;
  }
  /** Does a refuelling cart have an engine of its type to serve? */
  cartMatched(w: WagonSlot) {
    const svc = w.def.service;
    if (!svc) return true;
    if (svc === 'coal' && this.fuelKind !== 'coal') return false;
    return this.locos.some((l) => l.def.type === serviceLocoType(svc));
  }
  /** Refuelling carts of a kind with a matching engine aboard. */
  private cartsFor(kind: 'coal' | 'fuel' | 'battery') {
    return this.wagons.filter((w) => w.def.service === kind && this.cartMatched(w));
  }
  private cartCap(kind: 'coal' | 'fuel' | 'battery') {
    return this.cartsFor(kind).reduce((a, w) => a + (w.def.serviceCap ?? 0), 0);
  }
  /** Consumption multiplier from matching carts: each cuts a share, up to a cap. */
  private cartSaving(kind: 'coal' | 'fuel' | 'battery') {
    return 1 - Math.min(PHYS.cartSavingCap, PHYS.cartSaving * this.cartsFor(kind).length);
  }
  /** Does the train haul a maintenance wagon? Only then may it take the Maintenance mode. */
  get hasMaintenanceWagon(): boolean {
    return this.wagons.some((w) => w.def.maintenance === true);
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
    return this.bodies().length;
  }
  get carLengths(): number[] {
    return this.vehicleSpecs.map((s) => s.L);
  }
  /** Body geometry of every vehicle, loco first. Shared while the consist stays the same: read only. */
  get vehicleSpecs(): VehicleSpec[] {
    return this.bodies().specs;
  }
  /** The bodies of the consist and its length, kept while it is made of the same vehicles. */
  private bodiesOf: { defs: BodyFields[]; specs: VehicleSpec[]; length: number } | null = null;
  private bodies() {
    const kept = this.bodiesOf;
    const nl = this.locos.length;
    if (kept && kept.defs.length === nl + this.wagons.length) {
      let same = true;
      for (let i = 0; i < nl && same; i++) same = kept.defs[i] === this.locos[i].def;
      for (let i = 0; i < this.wagons.length && same; i++)
        same = kept.defs[nl + i] === this.wagons[i].def;
      if (same) return kept;
    }
    const defs: BodyFields[] = [...this.locos.map((l) => l.def), ...this.wagons.map((w) => w.def)];
    const specs = defs.map((d) => vehicleSpec(d));
    const built = { defs, specs, length: consistLength(specs.map((s) => s.L)) };
    this.bodiesOf = built;
    return built;
  }
  /** Poses of every body segment and bogie, in car order (loco first). */
  vehiclePoses: VehiclePose[] = [];
  private accessCache: { of: object; access: ConsistAccess; cls: TrainClass | null } | null = null;
  private consistInfo() {
    // kept with the bodies: the same record means the same vehicles
    const of = this.bodies();
    if (this.accessCache?.of !== of) {
      const defs = [...this.locos.map((l) => l.def), ...this.wagons.map((w) => w.def)];
      this.accessCache = { of, access: consistAccess(defs), cls: trainClassOf(defs) };
    }
    return this.accessCache;
  }
  /** Track lines every vehicle of the consist may use, and who bars the rest. */
  get access(): ConsistAccess {
    return this.consistInfo().access;
  }
  /** Distance (tiles) the train needs to stop from its current speed. */
  get stopDistance() {
    return (this.speed * this.speed) / (2 * DECEL);
  }
  /** Train class: its biggest vehicle's (null for an empty consist). */
  get trainClass(): TrainClass | null {
    return this.consistInfo().cls;
  }
  /** Pathfinding predicate: may the consist enter this piece through `entry`? */
  readonly canUse = (p: TrackPiece, entry: Dir) => this.fits(p, entry) && p.wear.health > 0;
  /** May the consist run on this piece through `entry`, whatever its health? */
  private fits(p: TrackPiece, entry: Dir) {
    return (
      this.access.classes.has(pieceClassFor(p, entry)) &&
      this.mass <= (p.bridgeCapacity ?? Infinity)
    );
  }
  /** Route cost multiplier: a smaller train pays extra on a bigger line (`lineToll`). */
  readonly tollOf = (p: TrackPiece, entry: Dir) =>
    lineToll(this.trainClass, pieceClassFor(p, entry));
  /** findPath with this consist's class access and line tolls applied. */
  pathTo(
    track: TrackGraph,
    start: PathStart | readonly PathStart[],
    isTarget: (x: number, y: number) => boolean,
    maxCost = 100000,
    avoid?: (x: number, y: number) => boolean,
  ) {
    return findPath(track, start, isTarget, maxCost, avoid, this.canUse, this.tollOf);
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
  /**
   * Tile keys of the plain line behind the consist, from its rear back to the first switch or
   * dead end (at most `max` tiles): the track it would back over, and cross again going on.
   */
  lineBehind(track: TrackGraph, max = 64): number[] {
    const out: number[] = [];
    const rear = this.reversedTrail().trail.at(-1)?.seg;
    if (!rear) return out;
    let { x, y } = rear;
    let dir = rear.out;
    for (let i = 0; i < max && track.connected(x, y, dir); i++) {
      x += DIR_DX[dir];
      y += DIR_DY[dir];
      const piece = track.get(x, y);
      if (!piece || piece.links.length !== 1 || (piece.unit && piece.kind !== 'curve')) break;
      out.push(y * track.w + x);
      const exits = track.exits(x, y, ((dir + 2) % 4) as Dir);
      if (exits.length !== 1) break;
      dir = exits[0];
    }
    return out;
  }
  /** Tile keys under the consist. Shared until the train moves: read only. */
  occupancyKeys(w: number): readonly number[] {
    const trail = this.trail;
    const n = trail.length;
    const kept = this.occupiedKept;
    if (
      kept &&
      kept.w === w &&
      kept.trail === trail &&
      kept.n === n &&
      kept.last === trail[n - 1] &&
      kept.length === this.length
    )
      return kept.keys;
    const keys: number[] = [];
    for (const p of this.occupancyPoints()) {
      const k = Math.floor(p.y + 0.5) * w + Math.floor(p.x + 0.5);
      if (!keys.includes(k)) keys.push(k);
    }
    this.occupiedKept = {
      w,
      trail,
      n,
      last: trail[n - 1],
      length: this.length,
      keys,
    };
    return keys;
  }
  /** What the kept `occupancyKeys` were worked out from: several passes of a tick ask for them. */
  private occupiedKept: {
    w: number;
    trail: TrailPoint[];
    n: number;
    last: TrailPoint | undefined;
    length: number;
    keys: number[];
  } | null = null;
  // ------------------------------------------------------------ fuel
  /** Tanks are pooled per type over every unit (a standby unit's tank is filled and kept). */
  private sumBy(type: LocoType, f: (l: LocoSlot) => number) {
    let sum = 0;
    for (const l of this.locos) if (l.def.type === type) sum += f(l);
    return sum;
  }
  /** Only the pulling units burn. */
  private burnBy(type: LocoType, f: (l: LocoSlot) => number) {
    let sum = 0;
    for (const l of this.locos) if (l.def.type === type && l.engaged) sum += f(l);
    return sum;
  }
  get coalCap() {
    return (
      this.sumBy('steam', (l) => (l.def.fuelCap ?? 0) * levelMul(l.level)) + this.cartCap('coal')
    );
  }
  get oilCap() {
    return (
      this.sumBy('diesel', (l) => (l.def.fuelCap ?? 0) * levelMul(l.level)) + this.cartCap('fuel')
    );
  }
  get waterCap() {
    return this.sumBy('steam', (l) => (l.def.waterCap ?? 0) * levelMul(l.level));
  }
  /** Power the battery carts can hold for an electric. */
  get batteryCap() {
    return this.cartCap('battery');
  }
  get coalRate() {
    return (
      this.burnBy('steam', (l) => l.def.fuelPerTile ?? 0) *
      rules.runningCostMul *
      this.cartSaving('coal')
    );
  }
  get oilRate() {
    return (
      this.burnBy('diesel', (l) => l.def.fuelPerTile ?? 0) *
      rules.runningCostMul *
      this.cartSaving('fuel')
    );
  }
  get waterRate() {
    return this.burnBy('steam', (l) => l.def.waterPerTile ?? 0) * rules.runningCostMul;
  }
  get powerRate() {
    return (
      this.burnBy('electric', (l) => l.def.powerPerTile ?? 0) *
      rules.runningCostMul *
      this.cartSaving('battery')
    );
  }
  get hasSteam() {
    return this.coalCap > 0;
  }
  get hasDiesel() {
    return this.oilCap > 0;
  }
  get hasElectric() {
    return this.locos.some((l) => l.def.type === 'electric');
  }
  /** Lowest tank as a fraction of its capacity (1 for pure electric). */
  get tankFraction() {
    // the least full of the tanks the consist has (Math.min, so NaN wins as it did)
    let f = Infinity;
    let tanks = 0;
    if (this.coalCap > 0) {
      f = Math.min(f, this.coal / this.coalCap);
      tanks++;
    }
    if (this.waterCap > 0) {
      f = Math.min(f, this.water / this.waterCap);
      tanks++;
    }
    if (this.oilCap > 0) {
      f = Math.min(f, this.oil / this.oilCap);
      tanks++;
    }
    return tanks ? f : 1;
  }
  /** Economy mode: a tank is low, so the train crawls and burns proportionally less. */
  get eco() {
    return this.tankFraction < ECO_BELOW;
  }
  /** The whole consist is on the bridge until its rear leaves it. */
  bridgeSpeed(track: TrackGraph) {
    let factor = 1;
    for (const k of this.occupancyKeys(track.w)) {
      const cap = track.get(k % track.w, Math.floor(k / track.w))?.bridgeCapacity;
      if (cap && slowsOnBridge(this.mass, cap)) factor = Math.min(factor, BRIDGE_SLOW_FACTOR);
    }
    return factor;
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
  /**
   * Speed ceiling the wire under the head allows the consist's collectors, or null when no
   * electric unit can draw from what is there (bare rails, dead wire, wrong collector).
   */
  wireCeiling(ctx: TickCtx): number | null {
    const head = this.headTile;
    if (!head || !ctx.powered(head.x, head.y)) return null;
    const kind = ctx.supplyAt(head.x, head.y);
    if (!kind) return null;
    let best: number | null = null;
    for (const l of this.locos) {
      if (l.def.type !== 'electric') continue;
      const c = collectorCeiling(l.def.collector, kind);
      if (c !== null && (best === null || c > best)) best = c;
    }
    return best;
  }
  /** Is the head on live track with power to draw? */
  private onWire(ctx: TickCtx) {
    return this.wireCeiling(ctx) !== null && ctx.stores.grid.get('power') > 0.1;
  }
  /**
   * Which units pull. A unit in a working mode pulls while it has usable power (fuel and water,
   * oil, or the wire or a charged battery); when none of them has any, the first standby unit
   * that does steps in, and steps back the moment a working unit recovers.
   */
  refreshModes(ctx: TickCtx) {
    const wired = this.onWire(ctx);
    const usable = (l: LocoSlot) =>
      l.def.type === 'steam'
        ? this.coal > 1e-6 && this.water > 1e-6
        : l.def.type === 'diesel'
          ? this.oil > 1e-6
          : wired || this.battery > 1e-6;
    let any = false;
    for (const l of this.locos)
      if (l.mode !== 'standby') {
        l.engaged = usable(l);
        any ||= l.engaged;
      }
    let promoted = false;
    for (const l of this.locos)
      if (l.mode === 'standby') {
        l.engaged = !any && !promoted && usable(l);
        promoted ||= l.engaged;
      }
  }
  /** Why the train cannot move right now, or null. */
  fuelProblem(ctx: TickCtx, step: number): 'noFuel' | 'noPower' | null {
    this.refreshModes(ctx);
    if (this.eco) step *= ECO_MUL;
    if (!this.locos.some((l) => l.engaged))
      return this.locoDef.type === 'electric' ? 'noPower' : 'noFuel';
    if (this.coalRate > 0 && this.coal < this.coalRate * step) return 'noFuel';
    if (this.waterRate > 0 && this.water < this.waterRate * step) return 'noFuel';
    if (this.oilRate > 0 && this.oil < this.oilRate * step) return 'noFuel';
    if (this.powerRate > 0) {
      const need = this.powerRate * step;
      const head = this.headTile;
      const wired = !!head && this.wireCeiling(ctx) !== null;
      if ((wired ? Math.max(ctx.stores.grid.get('power'), this.battery) : this.battery) < need)
        return 'noPower';
    }
    return null;
  }
  /**
   * Fill tanks from what a store holds: coal or wood, oil or diesel, water, and power for the
   * battery (only the grid holds power: `fillUp` charges the battery there). `mul` > 1 charges
   * extra (emergency delivery).
   */
  refuel(
    store: ResourceStore,
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
        const got = store.take(kind, need * mul) / mul;
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
      const got = store.take(liquid, (oilTarget - this.oil) * mul) / mul;
      this.oil = Math.min(this.oilCap, this.oil + got);
      if (got > 0) {
        this.oilKind = liquid;
        taken[liquid] = got;
      }
    }
    const waterTarget = this.waterCap * (opts.waterFrac ?? 1);
    if (opts.water && this.waterCap > 0 && this.water < waterTarget - 1e-6) {
      const got = store.take('water', (waterTarget - this.water) * mul) / mul;
      this.water = Math.min(this.waterCap, this.water + got);
      if (got > 0) taken.water = got;
    }
    const batteryTarget = this.batteryCap * (opts.fuelFrac ?? 1);
    if (opts.fuel && this.batteryCap > 0 && this.battery < batteryTarget - 1e-6) {
      const got = store.take('power', (batteryTarget - this.battery) * mul) / mul;
      this.battery = Math.min(this.batteryCap, this.battery + got);
      if (got > 0) taken.power = got;
    }
    return taken;
  }
  /**
   * Fill up at a store: the tanks from it (`refuel`), the battery from the grid, and the crew
   * settles what it owes there (`settle`). Returns what was taken.
   */
  fillUp(
    store: ResourceStore,
    grid: ResourceStore,
    what: { fuel: boolean; water: boolean; fuelFrac?: number; waterFrac?: number },
    mul = 1,
  ) {
    const taken = this.refuel(store, what, mul);
    if (what.fuel && this.batteryCap > 0)
      for (const [k, v] of Object.entries(
        this.refuel(grid, { fuel: true, water: false, fuelFrac: what.fuelFrac }, mul),
      ))
        taken[k] = (taken[k] ?? 0) + v;
    this.settle(store);
    return taken;
  }
  /**
   * Give the tanks' contents back (recall): fuel and water to the store, up to its caps, the
   * battery to the grid. What does not fit is lost.
   */
  drainTo(store: ResourceStore | null, grid: ResourceStore) {
    if (store) {
      if (this.coal > 0)
        store.add(this.fuelKind, this.fuelKind === 'coal' ? this.coal : this.coal * 2);
      if (this.oil > 0) store.add(this.oilKind, this.oil);
      if (this.water > 0) store.add('water', this.water);
    }
    if (this.battery > 0) grid.add('power', this.battery);
    this.coal = this.oil = this.water = this.battery = 0;
  }
  /**
   * Food and sand the train owes: its crew eats `rules.wheatPerCrew` a week each, and in the full
   * production chain it spreads sand on every tile it runs. Both are taken at the next store it
   * fills up at (`settle`).
   */
  owed = { food: 0, sand: 0 };
  /** Food the crew eats in a game day. */
  get dailyFood() {
    return (this.crew * rules.wheatPerCrew * daySeconds()) / weekSeconds();
  }
  /** It owes more than a day of its crew's food: it runs at FAMINE_SPEED_MUL until fed. */
  get hungry() {
    return this.owed.food > this.dailyFood;
  }
  /**
   * Pay what is owed at a store: it gives the food and sand owed, as much of them as it holds, and
   * the debt is cleared.
   */
  settle(store: ResourceStore) {
    store.take('food', this.owed.food);
    store.take('sand', this.owed.sand);
    this.owed = { food: 0, sand: 0 };
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
  /**
   * Place the train stopped on a track tile entered by `entry`, its head halfway across facing
   * on, and its cars back along a trail that reaches SPAWN_REACH past the rear however the track
   * behind it winds (`trackBehind`).
   */
  spawnAt(track: TrackGraph, x: number, y: number, entry: Dir) {
    const piece = track.get(x, y);
    if (!piece) return false;
    const exits = track.exits(x, y, entry);
    const out = exits.find((e) => e === (entry + 2) % 4) ?? exits[0];
    if (out === undefined) return false;
    const seg: PathSegment = { x, y, in: entry, out };
    const { back, need, laid } = trackBehind(track, seg, this.length);
    this.trail = [];
    this.trailCum = [];
    this.trailLen = [];
    this.trailLenOf = this.trail;
    // the consist stands behind the gate: where the rails end (inside the shed) a straight
    // virtual run carries the rest of the cars, hidden under the shed until they roll out
    const first = back[0] ?? seg;
    const firstPts = track.segGeom(first.x, first.y, first.in, first.out, first.route).pts;
    const p0 = { x: first.x + firstPts[0].x, y: first.y + firstPts[0].y };
    const behind = need - laid;
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
    this.capturePoses();
    return true;
  }

  /**
   * Rebuild the trail (car positions and travel direction) from a save: `[x, y, tile x, tile y,
   * in, out]` per point, and since v14 the route of a multi-tile piece the point lies on.
   */
  restoreTrail(points: number[][], reversed: boolean) {
    this.trail = [];
    this.trailCum = [];
    this.trailLen = [];
    this.trailLenOf = this.trail;
    const segs = new Map<string, PathSegment>();
    for (const [x, y, sx, sy, sin, sout, route] of points) {
      const key = `${sx},${sy},${sin},${sout},${route}`;
      let seg = segs.get(key);
      if (!seg) {
        seg = { x: sx, y: sy, in: sin as Dir, out: sout as Dir };
        if (route !== undefined) seg.route = route;
        segs.set(key, seg);
      }
      const last = this.trail[this.trail.length - 1];
      const d = last ? Math.hypot(x - last.x, y - last.y) : 0;
      this.trailCum.push(last ? this.trailCum[this.trailCum.length - 1] + d : 0);
      this.trailLen.push(d);
      this.trail.push({ x, y, seg });
    }
    this.reversed = reversed;
    this.speed = 0;
    this.path = null;
    this.updatePoses();
    this.capturePoses();
  }

  /** Take the current poses as the ones the renderer interpolates from. */
  capturePoses() {
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
      this.trailLen.push(d);
    } else {
      this.trailCum.push(0);
      this.trailLen.push(0);
    }
    this.trail.push(p);
    // trim
    const total = this.trailCum[this.trailCum.length - 1];
    const keep = this.length + 2;
    while (this.trail.length > 2 && total - this.trailCum[1] > keep) {
      this.trail.shift();
      this.trailCum.shift();
      this.trailLen.shift();
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
    const i = reach(cum, arc);
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
    // poses follow from the trail, the direction and the bodies alone: with none of them changed
    // since the last call (a standing train) they are the ones already there
    const trail = this.trail;
    const kept = this.posedFor;
    if (
      kept &&
      kept.trail === trail &&
      kept.n === trail.length &&
      kept.first === trail[0] &&
      kept.last === trail[trail.length - 1] &&
      kept.reversed === this.reversed &&
      sameSpecs(kept.specs, specs)
    )
      return;
    const order = this.reversed ? [...specs].reverse() : specs;
    const fronts = vehicleFronts(order.map((s) => s.L));
    // the lengths between trail points, kept with the trail (`pushTrail`); worked out again for a
    // trail set some other way
    if (this.trailLenOf !== trail || this.trailLen.length !== trail.length) {
      this.trailLen = trail.map((p, i) =>
        i ? Math.hypot(p.x - trail[i - 1].x, p.y - trail[i - 1].y) : 0,
      );
      this.trailLenOf = trail;
    }
    const pl = new Polyline(trail, this.trailLen);
    const total = pl.length;
    const vposes = order.map((s, i) => poseVehicle(pl, total - fronts[i], s, this.reversed));
    // keep the arrays in car order (loco first) regardless of travel direction
    if (this.reversed) vposes.reverse();
    this.vehiclePoses = vposes;
    this.poses = vposes.map((v) => ({ x: v.x, y: v.y, heading: v.heading }));
    this.posedFor = {
      trail,
      n: trail.length,
      first: trail[0],
      last: trail[trail.length - 1],
      reversed: this.reversed,
      specs,
    };
  }
  /** What the current poses were worked out from (`updatePoses`). */
  private posedFor: {
    trail: TrailPoint[];
    n: number;
    first: TrailPoint | undefined;
    last: TrailPoint | undefined;
    reversed: boolean;
    specs: VehicleSpec[];
  } | null = null;

  /** Facing index (of 24) for a car (loco faces backwards when pushed). */
  facingOf(_carIndex: number, pose: CarPose) {
    return facingOf(pose.heading + (this.reversed ? Math.PI : 0));
  }

  // ------------------------------------------------------------ routing
  /** The tiles the train is bound for: its job's, or the platforms of its stop or detour. */
  private boundTiles(builder: Builder): { x: number; y: number }[] {
    if (this.boundForWork) {
      const to = this.maint ?? this.parkAt;
      return to ? [to] : [];
    }
    const id = this.detour ?? this.route[this.routeIndex % this.route.length];
    const target = builder.stationById(id);
    return target ? builder.platformTiles(target) : [];
  }
  /** Try to path to the next station. Returns false when nothing is reachable. */
  dispatch(
    track: TrackGraph,
    builder: Builder,
    map: GameMap,
    avoid?: (x: number, y: number) => boolean,
    mode: 'auto' | 'forward' | 'reverse' = 'auto',
  ): boolean {
    if ((this.route.length === 0 && !this.maintaining) || !this.trail.length) return false;
    this.serviceStop = null;
    const plat = this.boundTiles(builder);
    if (!plat.length) {
      const target = this.boundForWork
        ? undefined
        : builder.stationById(this.detour ?? this.route[this.routeIndex % this.route.length]);
      if (target) this.lastMessage = ENGLISH.trainNote.noPlatform(target.storedName);
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
    if (!path && mode === 'auto' && avoid) {
      // a forward route exists but other trains stand on it: keep facing forward and let the
      // traffic control hold us, rather than turning the consist around
      const busy = this.pathTo(track, { x: seg.x, y: seg.y, in: seg.in }, isTarget, 100000);
      if (busy) path = busy;
    }
    if (!path && mode !== 'forward') {
      // Preview from the actual rear. A failed search must never flip or relocate the consist.
      const reversed = this.reversedTrail();
      const rear = reversed.trail[reversed.trail.length - 1]?.seg;
      if (rear) {
        if (isTarget(rear.x, rear.y)) {
          this.reverseConsist();
          this.path = null;
          this.trackVersion = track.version;
          return true;
        }
        const alt = this.pathTo(
          track,
          { x: rear.x, y: rear.y, in: rear.in },
          isTarget,
          100000,
          avoid,
        );
        if (alt) {
          this.reverseConsist();
          path = alt;
        }
      }
    }
    if (!path) return false;
    this.setPath(path, map, track);
    this.trackVersion = track.version;
    return true;
  }

  /**
   * The trail turned round at the rear end, which becomes the head: the points from the head back
   * to the rear end, each crossing reversed. The new head sets off from the tile the rear end
   * stands on (`crossingBehind`).
   */
  private reversedTrail() {
    const total = this.trailCum[this.trailCum.length - 1];
    const newHeadArc = Math.min(total, this.length); // arc behind head of the rear end
    const pts = [...this.trail].reverse();
    const cumR = pts.map((_, i) => total - this.trailCum[this.trail.length - 1 - i]);
    const flip = (s: PathSegment): PathSegment => ({ x: s.x, y: s.y, in: s.out, out: s.in });
    // truncate at newHeadArc
    const nt: TrailPoint[] = [];
    const nc: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (cumR[i] <= newHeadArc) {
        nt.push({ ...pts[i], seg: flip(pts[i].seg) });
        nc.push(cumR[i]);
      } else {
        const prev = i > 0 ? pts[i - 1] : pts[i];
        const pc = i > 0 ? cumR[i - 1] : 0;
        const t = (newHeadArc - pc) / Math.max(1e-6, cumR[i] - pc);
        nt.push({
          x: prev.x + (pts[i].x - prev.x) * t,
          y: prev.y + (pts[i].y - prev.y) * t,
          seg: flip(pts[i].seg),
        });
        nc.push(newHeadArc);
        break;
      }
    }
    const rear = this.crossingBehind(newHeadArc);
    if (rear && nt.length) nt[nt.length - 1].seg = flip(rear);
    return { trail: nt, cum: nc };
  }

  /**
   * The crossing of the tile under the trail `back` behind the head: the tile the point there lies
   * in, or for a point on a tile edge (within `EDGE_SLACK`) the tile beyond it, away from the head,
   * where a rear end stands and `onwardTest` counts from. A point of the trail on an edge may carry
   * either tile (`spawnAt` gives it the one nearer the head, `layTrail` the one farther), so the
   * tile is read from where the point lies, and its crossing from the nearest point of the trail
   * within a tile and a half that carries that tile; failing one, from the point just beyond.
   * A train turned round where it stands has a trail that starts at its rear end (`reversedTrail`
   * cuts it there), so a point short of the trail's start is read on along its first chord.
   */
  private crossingBehind(back: number): PathSegment | undefined {
    const pts = this.trail;
    const cum = this.trailCum;
    if (!pts.length) return undefined;
    const end = cum[cum.length - 1] - back;
    const at = end - EDGE_SLACK;
    let p: Vec2 = this.sampleTrail(Math.max(cum[0], at));
    if (at < cum[0]) {
      // the trail may start on two points that coincide, where `reversedTrail` cut it on a point
      const q = pts.find((r) => Math.hypot(r.x - pts[0].x, r.y - pts[0].y) > 1e-6);
      if (q) {
        const a = pts[0];
        const k = (cum[0] - at) / Math.hypot(q.x - a.x, q.y - a.y);
        p = { x: a.x - (q.x - a.x) * k, y: a.y - (q.y - a.y) * k };
      }
    }
    const x = Math.floor(p.x + 0.5);
    const y = Math.floor(p.y + 0.5);
    let found: PathSegment | undefined;
    let near = 1.5;
    let beyond = 0;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] < end) beyond = i;
      const s = pts[i].seg;
      const d = Math.abs(cum[i] - at);
      if (s.x === x && s.y === y && d < near) {
        found = s;
        near = d;
      }
    }
    return found ?? pts[beyond].seg;
  }

  private reverseConsist() {
    const next = this.reversedTrail();
    this.trail = next.trail;
    this.trailCum = next.cum;
    this.reversed = !this.reversed;
    this.updatePoses();
    this.capturePoses();
  }

  /**
   * Follow `path` from the head. `headRoute` is the route of a multi-tile piece the head already
   * runs along on the path's first tile, where that tile alone cannot tell the routes apart.
   */
  private setPath(path: PathSegment[], map: GameMap, track: TrackGraph, headRoute?: number) {
    this.path = path;
    this.shortWay = false;
    this.pathPts = [];
    this.pathCum = [];
    track.resolveRoutes(path);
    if (headRoute !== undefined && path[0]?.route !== undefined) path[0].route = headRoute;
    for (let s = 0; s < path.length; s++) {
      const seg = path[s];
      const geom = track.segGeom(seg.x, seg.y, seg.in, seg.out, seg.route);
      const pts = geom.pts;
      const last = s === path.length - 1;
      const upto = last ? Math.floor(pts.length / 2) + 1 : pts.length;
      let factor = curveFactor(geom.radius, trackData.curveSpeed);
      if (seg.x !== undefined) {
        const t = terrainAt(map, seg.x, seg.y);
        if (t === Terrain.Water && !track.get(seg.x, seg.y)?.bridgeCapacity)
          factor = Math.min(factor, trackData.bridgeSpeed);
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
      const a = this.pathPts[i],
        b = this.pathPts[i + 1] ?? a;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const along = Math.max(
        0,
        Math.min(
          1,
          ((head.x - a.x) * dx + (head.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy),
        ),
      );
      const d = Math.hypot(a.x + dx * along - head.x, a.y + dy * along - head.y);
      if (d < bd) {
        bd = d;
        best = this.pathCum[i] + Math.hypot(dx, dy) * along;
      }
    }
    this.pathPos = best;
    this.speed = 0;
  }

  /** arc position along the current path */
  get pathProgress() {
    return this.pathPos;
  }
  /**
   * Tiles of the path from the head onwards (one entry per tile, with the arc it starts at): the
   * first from half a tile behind the head. The list is shared by every caller until the head
   * passes the next path point, so it is read-only.
   */
  pathAhead(maxTiles = Infinity): readonly AheadTile[] {
    if (!this.path) return NO_TILES;
    const from = this.firstPointFrom(this.pathPos - 0.5);
    if (from >= this.pathPts.length) return NO_TILES;
    const tiles = this.pathTiles();
    const kept = this.aheadList;
    let list: readonly AheadTile[];
    if (kept && kept.tiles === tiles && kept.from === from) list = kept.list;
    else {
      // the first entry starts at the first point ahead, which may lie inside its tile
      const run = tiles.run[from];
      const seg = this.pathPts[from].seg;
      const out: AheadTile[] = [
        { x: seg.x, y: seg.y, in: seg.in, out: seg.out, arc: this.pathCum[from] },
      ];
      for (let r = run + 1; r < tiles.tiles.length; r++) out.push(tiles.tiles[r]);
      list = out;
      this.aheadList = { tiles, from, list };
      AHEAD_RUNS.set(list, { tiles, from: run });
    }
    return maxTiles < list.length ? list.slice(0, maxTiles) : list;
  }
  /** The first path point at or beyond `arc` (`pathPts.length` when none is). */
  private firstPointFrom(arc: number) {
    const cum = this.pathCum;
    let lo = 0;
    let hi = cum.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** `pathPts` grouped into runs on one segment, one per tile, rebuilt when the path changes. */
  private pathTiles(): PathTiles {
    const pts = this.pathPts;
    const kept = this.tilesOfPath;
    if (kept && kept.pts === pts && kept.n === pts.length) return kept;
    const tiles: AheadTile[] = [];
    const run = new Int32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const seg = pts[i].seg;
      if (i === 0 || seg !== pts[i - 1].seg)
        tiles.push({ x: seg.x, y: seg.y, in: seg.in, out: seg.out, arc: this.pathCum[i] });
      run[i] = tiles.length - 1;
    }
    const built: PathTiles = {
      pts,
      n: pts.length,
      tiles,
      run,
      w: -1,
      keys: new Int32Array(0),
    };
    this.tilesOfPath = built;
    return built;
  }
  get pathTotal() {
    return this.pathCum[this.pathCum.length - 1] ?? 0;
  }

  private factorAt(arc: number) {
    const i = Math.min(reach(this.pathCum, arc), this.pathCum.length) - 1;
    const p = this.pathPts[Math.min(i + 1, this.pathPts.length - 1)];
    let f = p.factor;
    if (p.seg && p.factor === 1) {
      // straight through a switch
      f = 1;
    }
    return f;
  }

  /**
   * Validate the remaining path after a track edit (or `path`, before following it). A piece the
   * head has run past may have failed: only the tail is on it, and the crawl sees to the tail.
   */
  pathStillValid(track: TrackGraph, path = this.path): boolean {
    if (!path) return true;
    const head = path === this.path && this.headSeg ? path.indexOf(this.headSeg) : -1;
    return path.every(
      (s, i) =>
        track.opensTo(s.x, s.y, s.in) &&
        track.opensTo(s.x, s.y, s.out) &&
        (i < head || this.canUse(track.get(s.x, s.y)!, s.in)),
    );
  }

  /**
   * A train standing on a failed piece runs off it: on over every failed piece in a row, then over
   * sound track until the whole train is clear, the way its path goes where it can, and stops
   * there to look for a way on (`noRoute`). It never runs from sound track onto a failed piece or
   * into a train, so a stretch of sound track too short for it, or the end of the line, leaves its
   * tail behind. False when no vehicle stands on a failed piece, or the head would reach no new
   * tile, or no sound one: a train with no room stands, and does not go to and fro.
   */
  leaveBroken(ctx: TickCtx): boolean {
    const track = ctx.track;
    const head = this.headSeg;
    const failed = ctx.builder.wear.unusable;
    if (!head || !track.has(head.x, head.y)) return false;
    if (!this.headFailed(track) && !this.occupancyKeys(track.w).some((k) => failed.has(k)))
      return false;
    const stateKey = (s: { x: number; y: number; in: Dir }) => track.key(s.x, s.y) * 4 + s.in;
    const planned = new Map(this.path?.map((s) => [stateKey(s), s.out]));
    planned.set(stateKey(head), head.out);
    const seen = new Set<number>();
    const path: PathSegment[] = [];
    let at = { x: head.x, y: head.y, in: head.in };
    /** arc of the sound tiles walked, to the far edge of the last; null before the first */
    let sound: number | null = null;
    while (!seen.has(stateKey(at))) {
      seen.add(stateKey(at));
      const onSound = stateOf(track.get(at.x, at.y)!) !== 'unusable';
      const ways = track.exits(at.x, at.y, at.in).filter((out) => {
        const next = track.get(at.x + DIR_DX[out], at.y + DIR_DY[out]);
        return (
          !!next &&
          track.connected(at.x, at.y, out) &&
          this.fits(next, opposite(out)) &&
          !(onSound && stateOf(next) === 'unusable') &&
          !ctx.occupied(at.x + DIR_DX[out], at.y + DIR_DY[out], this.id)
        );
      });
      const want = planned.get(stateKey(at)) ?? opposite(at.in);
      const out = ways.includes(want) ? want : (ways[0] ?? want);
      path.push({ ...at, out });
      if (onSound) {
        const len = track.segLength(at.x, at.y, at.in, out);
        sound = (sound ?? 0) + len;
        // the head stops halfway across the last tile
        if (sound - len / 2 >= this.length + 0.5) break;
      }
      if (!ways.length) break;
      at = { x: at.x + DIR_DX[out], y: at.y + DIR_DY[out], in: opposite(out) };
    }
    if (sound === null || path.length < 2) return false;
    this.serviceStop = null;
    this.setPath(path, ctx.map, track, path[0].out === head.out ? head.route : undefined);
    this.shortWay = true;
    this.trackVersion = track.version;
    this.setState('moving');
    return true;
  }
  /** Does the head stand on a failed piece? */
  private headFailed(track: TrackGraph) {
    const head = this.headSeg;
    const under = head && track.get(head.x, head.y);
    return !!under && stateOf(under) === 'unusable';
  }
  /**
   * With no way round a failed piece on its path, run on at the speed the train has as far as the
   * last sound tile before it. False when no failed piece cuts the path.
   */
  private stopShort(ctx: TickCtx): boolean {
    const path = this.path;
    const head = this.headSeg;
    if (!path || !head) return false;
    const from = Math.max(0, path.indexOf(head));
    const cut = path.findIndex((s, i) => {
      const p = ctx.track.get(s.x, s.y);
      return i > from && !!p && stateOf(p) === 'unusable';
    });
    if (cut < 0) return false;
    const way = path.slice(from, cut);
    if (!this.pathStillValid(ctx.track, way)) return false;
    this.followAfterLoad(way, ctx.builder, way[0].route);
    this.shortWay = true;
    return true;
  }

  // ------------------------------------------------------------ tick
  /** Advance by in-game seconds. */
  tick(gdt: number, ctx: TickCtx) {
    if (!ctx.framed) this.capturePoses();
    // the fleet's traffic control resumes every loaded train before any of them ticks; a train
    // ticked on its own does it here
    this.resumeAfterLoad(ctx.builder, ctx.now, (path, group) =>
      ctx.reserveRecovery(this, path, group),
    );
    this.stateTime += gdt;
    // the crew eats wherever the train is: it pays at the next store it fills up at
    this.owed.food += (this.dailyFood * gdt) / daySeconds();
    this.refreshModes(ctx);
    if (this.resumePending) {
      // the contract closed under way or with no route to it: head for the program's next stop
      this.resumePending = false;
      if (
        !this.job &&
        this.suspended &&
        ((this.state === 'moving' && !this.holding) || this.state === 'noRoute')
      ) {
        this.resumeAway(ctx);
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
      if (
        !this.pathStillValid(ctx.track) &&
        !(this.headFailed(ctx.track) && this.leaveBroken(ctx))
      ) {
        if (this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
        else if (!this.stopShort(ctx)) this.setState('noRoute');
      }
    }
    if (['moving', 'idle', 'noRoute'].includes(this.state) && ctx.now >= this.nextFuelCheck) {
      this.nextFuelCheck = ctx.now + 5;
      if (this.planFuelDetour(ctx)) return;
    }
    switch (this.state) {
      case 'moving':
        if (this.lookingOnTheWay) this.tickMaintenance(gdt, ctx);
        if (this.state === 'moving') this.tickMove(gdt, ctx);
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
        if (this.maintaining) this.tickMaintenance(gdt, ctx);
        else if (this.stateTime > 10) this.depart(ctx);
        break;
      case 'repairing':
        this.tickMaintenance(gdt, ctx);
        break;
      case 'yielding': {
        // wait on the siding until a path to the target avoids every tile other trains stand on
        if (this.stateTime < 2) break;
        const held = this.stateTime;
        this.stateTime = 0;
        const avoid = (x: number, y: number) =>
          ctx.occupied(x, y, this.id) || ctx.claimedBy(x, y, this.id) !== null;
        const wasReversed = this.reversed;
        if (
          this.dispatch(ctx.track, ctx.builder, ctx.map, avoid) ||
          (ctx.now > this.yieldUntil + 60 && this.dispatch(ctx.track, ctx.builder, ctx.map))
        ) {
          this.wantTiles = null;
          this.yieldWait = 0;
          this.clearHold();
          // on its way again: a note about pulling aside, or about the jam, no longer holds
          if (YIELD_NOTES.includes(this.lastMessage)) this.lastMessage = '';
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
            if (!this.maintaining)
              this.badTargets.set(this.route[this.routeIndex % this.route.length], ctx.now + 240);
            this.yieldWait = 0;
            this.atStation = null;
            this.idle(ENGLISH.trainNote.parked);
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
          if (this.headFailed(ctx.track) && this.leaveBroken(ctx)) break;
          // a contract closed while the train stood here (or before a reload): never retry its
          // stops, go back to the program
          if (!this.job && this.suspended) {
            this.resumeAway(ctx);
            break;
          }
          // a train with nowhere to go takes up a queued contract right away
          if (!this.job && this.jobs.length) this.startJob();
          if (this.maintaining) {
            if (!this.leaveBroken(ctx)) this.nextWork(ctx);
          } else if (this.dispatch(ctx.track, ctx.builder, ctx.map)) {
            if (!this.planFuelDetour(ctx)) this.onPathReady(ctx);
          } else if (!this.leaveBroken(ctx)) this.stateTime = 0;
        }
        break;
    }
  }

  /**
   * A maintenance train's own step, in place of the route logic: at work it mends the piece at the
   * repair rate, paid as it goes, and at 100 % takes the next job; with no job it looks again every
   * `trackLookSeconds` game seconds, standing or on its way to wait. When no store can pay it waits
   * at the piece.
   */
  tickMaintenance(gdt: number, ctx: TickCtx): void {
    if (this.state === 'moving') {
      this.stateTime = 0;
      this.takeJob(ctx, true);
      return;
    }
    if (this.state === 'idle') {
      if (this.stateTime >= rules.trackLookSeconds && !this.leaveBroken(ctx)) this.nextWork(ctx);
      return;
    }
    if (!this.maintaining) {
      this.leaveWork();
      return;
    }
    const job = this.maint;
    const piece = job && ctx.track.get(job.ax, job.ay);
    if (piece && piece.wear.health < 1) {
      const share = Math.min(1 - piece.wear.health, gdt / rules.trackRepairSeconds);
      this.repairUnpaid = !this.payRepair(piece, share, ctx);
      if (this.repairUnpaid) return;
      ctx.builder.wear.restore(job.ax, job.ay, share);
      if (piece.wear.health < 1) return;
    }
    this.nextWork(ctx);
  }
  /**
   * Add what `share` of the piece comes to, and pay the whole units of it from the nearest store
   * that holds them, however far. False, with nothing changed, when none can.
   */
  private payRepair(piece: TrackPiece, share: number, ctx: TickCtx): boolean {
    if (ctx.builder.free) return true;
    const owed = { ...this.repairOwed };
    const whole: Record<string, number> = {};
    for (const [k, v] of Object.entries(ctx.builder.wear.repairDue(piece, share))) {
      const due = (owed[k] ?? 0) + v;
      const units = Math.floor(due + 1e-9);
      owed[k] = Math.max(0, due - units);
      if (units > 0) whole[k] = units;
    }
    if (Object.keys(whole).length) {
      const head = this.headTile!;
      const payer = ctx.stores.payerAnywhere(whole, head.x, head.y);
      if (!payer) return false;
      payer.spend(whole);
    }
    this.repairOwed = owed;
    return true;
  }
  /** On its way to wait, is it time to look for work again? */
  private get lookingOnTheWay() {
    return (
      this.boundForWork &&
      this.parkAt !== null &&
      !this.holding &&
      !this.serviceStop &&
      this.stateTime >= rules.trackLookSeconds
    );
  }
  /** Take the next job, if there is one it can reach; `ahead`, past its head (`pick`). */
  private takeJob(ctx: TickCtx, ahead = false): boolean {
    const found = ctx.maintenance.pick(this, ctx.track, ahead);
    if (!found) return false;
    this.parkAt = null;
    if (!this.setOff(found.path, ctx)) this.startWork();
    return true;
  }
  /**
   * The next job. With none it goes to wait by the nearest depot (`MaintenanceBoard.park`), or
   * stands where it is with no depot in reach. A train already waiting stays: it may have made way
   * for another, and going back would only put it in the way again.
   */
  private nextWork(ctx: TickCtx) {
    this.detour = null;
    this.serviceStop = null;
    if (this.takeJob(ctx)) return;
    if (this.state === 'idle' && this.parkAt) {
      this.idle();
      return;
    }
    const spot = ctx.maintenance.park(this, ctx.track);
    this.parkAt = spot?.at ?? null;
    if (!spot || !this.setOff(spot.path, ctx)) this.idle(ENGLISH.trainNote.noWork);
  }
  /** Follow a way from either end of the train; false when it stands where the way ends. */
  private setOff(path: PathSegment[], ctx: TickCtx): boolean {
    const head = this.headSeg!;
    const from = path[0];
    if (from.x !== head.x || from.y !== head.y || from.in !== head.in) this.reverseConsist();
    if (path.length < 2) return false;
    this.atStation?.occupants.delete(this.id);
    this.atStation = null;
    this.setPath(path, ctx.map, ctx.track);
    this.trackVersion = ctx.track.version;
    this.setState('moving');
    sfx('train.whistle');
    return true;
  }
  /** The head stands on the job's tile: it stops here and the work begins. */
  private startWork() {
    this.atStation?.occupants.delete(this.id);
    this.atStation = null;
    this.dropPath();
    this.speed = 0;
    this.lastMessage = '';
    this.setState('repairing');
  }
  /**
   * The train was given the Maintenance mode: it looks for work now, unless it is at a platform,
   * backing off, stopped or in any other wait, whose end asks for the same.
   */
  takeUpWork(ctx: TickCtx): void {
    if (!this.holding && ['moving', 'idle', 'noRoute'].includes(this.state)) this.nextWork(ctx);
  }
  /**
   * The train leaves the Maintenance mode: its job is off. At work, or running to the job or to wait
   * on a way of its own, it drops the way and stands free to plan again; a detour, a service stop or a
   * back-off it is on ends as usual.
   */
  leaveWork(): void {
    this.maint = null;
    this.parkAt = null;
    this.repairUnpaid = false;
    const onItsWay =
      this.state === 'moving' && !this.holding && !this.serviceStop && this.detour === null;
    if (this.state !== 'repairing' && !onItsWay) return;
    this.dropPath();
    this.standAfterLoad();
  }
  /** Where a search for this train may start: its head, and its rear end for the train turned round. */
  pathEnds(): PathStart[] {
    const head = this.headSeg;
    if (!head) return [];
    const rear = this.reversedTrail().trail.at(-1)?.seg;
    const ends: PathStart[] = [{ x: head.x, y: head.y, in: head.in }];
    if (rear) ends.push({ x: rear.x, y: rear.y, in: rear.in });
    return ends;
  }

  /**
   * A train already holding on a siding still has to report who stands in its way, otherwise the
   * fleet's jam resolution never sees a ring of holding trains waiting on each other. Records the
   * plain path it wants to take and the first train standing on it.
   */
  private noteBlockerOnPlainPath(ctx: TickCtx, held: number) {
    if (!this.trail.length || (!this.route.length && !this.maintaining)) return;
    const plat = this.boundTiles(ctx.builder);
    const w = ctx.track.w;
    const targetSet = new Set(plat.map((p) => p.y * w + p.x));
    const isTarget = (x: number, y: number) => targetSet.has(y * w + x);
    const head = this.trail[this.trail.length - 1].seg;
    const path =
      this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.in }, isTarget, 100000) ??
      this.pathTo(ctx.track, { x: head.x, y: head.y, in: head.out }, isTarget, 100000);
    this.wantTiles = path ? path.map((s) => ({ x: s.x, y: s.y })) : null;
    // with no track on at all it is not waiting for traffic: say so rather than stand silent
    if (!path) this.lastMessage = ENGLISH.traffic.noWayOn;
    else if (this.lastMessage === ENGLISH.traffic.noWayOn) this.lastMessage = '';
    let by: number | null = null;
    if (path)
      for (const s of path) {
        const o = ctx.occupants(s.x, s.y).filter((id) => id !== this.id);
        if (o.length) {
          by = o[0];
          break;
        }
        const claim = ctx.claimedBy(s.x, s.y, this.id);
        if (claim !== null) {
          by = claim;
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
    // the way an idle train wants aside is its own (`wantAside`): never a later yield's way on
    if (s !== this.state && (s === 'idle' || this.state === 'idle')) this.wantTiles = null;
    this.state = s;
    this.stateTime = 0;
    if (s === 'noRoute' && this.consistProblem) this.lastMessage = this.consistProblem;
  }
  /**
   * Nothing worth hauling (or no way to the stop it picked): stand where the train is and choose
   * again in a while. An idle train keeps nothing it does not need: no platform of the station it
   * stands at, so a train that comes there can load, and no path or wanted path, so no other train
   * plans around a route it is not taking. It still stands on its tiles; the fleet moves it aside
   * when another train needs them (`Fleet.makeWay`). `note` replaces the panel's note.
   */
  idle(note?: string) {
    this.atStation?.occupants.delete(this.id);
    this.path = null;
    this.pathPts = [];
    this.pathCum = [];
    this.speed = 0;
    if (note !== undefined) this.lastMessage = note;
    this.setState('idle');
  }
  /** Why the consist can run on no track at all: narrow and regular stock coupled together. */
  get consistProblem(): string | null {
    const defs = [...this.locos.map((l) => l.def), ...this.wagons.map((w) => w.def)];
    return consistGauge(defs) === 'mixed' ? ENGLISH.fleet.mixedGaugeTrain : null;
  }

  /** After dispatch(): either start moving or handle "already at target". */
  onPathReady(ctx: { builder: Builder } | TickCtx) {
    const target = ctx.builder.stationById(
      this.detour ?? this.route[this.routeIndex % this.route.length],
    );
    if (!this.path) {
      if (this.boundForWork && this.maint) this.startWork();
      else if (this.boundForWork) this.idle(ENGLISH.trainNote.noWork);
      else if (target) this.arrive(target, 'track' in ctx ? ctx : undefined);
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
      // under block working a train keeps a whole headway behind the one ahead
      const gap = Math.max(HOLD_GAP, ctx.headway(this));
      const from = this.pathPos + 0.3;
      const to = this.pathPos + LOOKAHEAD + gap;
      // tiles under this train's own cars never block it (two trains that already overlap
      // must be allowed to separate)
      const own = new Set<number>();
      for (const p of this.poses)
        own.add(Math.floor(p.y + 0.5) * ctx.track.w + Math.floor(p.x + 0.5));
      for (let i = this.firstPointFrom(from); i < this.pathPts.length; i++) {
        const arc = this.pathCum[i];
        if (arc > to) break;
        const p = this.pathPts[i];
        if (own.has(p.seg.y * ctx.track.w + p.seg.x)) continue;
        if (
          ctx.occupied(p.seg.x, p.seg.y, this.id) ||
          ctx.tokenBlocked(p.seg.x, p.seg.y, this.id)
        ) {
          blockDist = Math.max(0, arc - this.pathPos - gap);
          blocker = ctx.occupants(p.seg.x, p.seg.y).find((id) => id !== this.id) ?? null;
          break;
        }
      }
    }
    // Escape moves use the same interlocking as scheduled trains.
    if (this.claimLimit - HOLD_GAP < blockDist) {
      blockDist = Math.max(0, this.claimLimit - HOLD_GAP);
      blocker = this.claimBlocker;
    }
    // block signals: stop short of a semaphore at danger; under caution approach the next one
    // slowly enough to stop there
    let cautionArc: number | null = null;
    if (ctx.signals && ctx.signals.count && this.path && !this.holding) {
      const sig = ctx.signals.ahead(this.pathAhead(), (x, y) => ctx.occupied(x, y, this.id));
      if (sig.stopArc !== null) {
        const d = sig.stopArc - HOLD_GAP - this.pathPos;
        if (d >= -0.1 && d < blockDist) {
          blockDist = Math.max(0, d);
          blocker = null;
        }
      }
      if (sig.cautionArc !== null && sig.cautionArc - this.pathPos > 0.2)
        cautionArc = sig.cautionArc;
    }
    this.blocked = blockDist < 0.3;
    this.blockedBy = this.blocked ? blocker : null;
    this.holdDist = blockDist;
    if (!this.holding && this.dynamic && ctx.now >= this.anticipateAt && this.path) {
      // look 8 tiles ahead: if another train has reserved that stretch coming our way, try a
      // path around it now instead of stopping later
      this.anticipateAt = ctx.now + 4;
      let oncoming = 0;
      for (let i = this.firstPointFrom(this.pathPos + 0.5); i < this.pathPts.length; i++) {
        const arc = this.pathCum[i];
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
          this.lastMessage = ENGLISH.trainNote.detouring;
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
      if (this.shortWay && this.speed === 0) {
        // nothing lies past this way but failed track: it waits for the repair, not for the train
        this.setState('noRoute');
        return;
      }
      this.blockedTime += gdt;
      if (!this.holding && this.blockedTime > REROUTE_AFTER && !this.rerouted) {
        this.rerouted = true;
        // try a path that avoids the tiles other trains are sitting on
        const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
        const wasReversed = this.reversed;
        if (this.dispatch(ctx.track, ctx.builder, ctx.map, avoid)) {
          this.lastMessage = ENGLISH.trainNote.rerouted;
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
    const bridgeFactor = this.bridgeSpeed(ctx.track);
    const vmax =
      this.maxSpeed *
      this.loadFactor *
      bridgeFactor *
      this.factorAt(this.pathPos + 0.3) *
      ctx.speedFactor *
      bio.speedMul *
      (this.headSeg && ctx.gradeAt ? ctx.gradeAt(this.headSeg) : 1) *
      ecoMul *
      (this.hungry ? FAMINE_SPEED_MUL : 1) *
      (this.reversed ? this.reverseFactor : 1);
    this.freeSpeed = vmax;
    let cap = vmax;
    // electric traction: the wire's ceiling for the collectors, and the substation's share
    const electricPulling = this.locos.some((l) => l.engaged && l.def.type === 'electric');
    if (electricPulling) {
      const ceil = this.wireCeiling(ctx);
      if (ceil !== null) cap = Math.min(cap, ceil);
      if (headT) cap *= ctx.gridFactor(headT.x, headT.y);
    }
    // Brake on the approach as well as under the span; a one-tile bridge is still a speed limit.
    for (const s of this.pathAhead()) {
      const d = s.arc - this.pathPos;
      if (d < 0) continue;
      if (d > 2 + (this.speed * this.speed) / (2 * DECEL)) break;
      const limit = ctx.track.get(s.x, s.y)?.bridgeCapacity;
      if (limit && slowsOnBridge(this.mass, limit)) {
        const crossing = (vmax / bridgeFactor) * BRIDGE_SLOW_FACTOR;
        cap = Math.min(cap, Math.sqrt(crossing * crossing + 2 * DECEL * Math.max(0, d - 0.25)));
      }
    }
    // line speed: some lines cap top speed, braking ahead of a lower cap
    for (const s of this.pathAhead(12)) {
      const piece = ctx.track.get(s.x, s.y);
      if (!piece) continue;
      let limit = lineSpeedCap(pieceClassFor(piece, s.in));
      if (stateOf(piece) === 'degraded')
        limit = Math.min(limit, this.maxSpeed * rules.trackDegradedSpeed);
      if (limit === Infinity) continue;
      const d = s.arc - this.pathPos;
      if (d > 2 + (this.speed * this.speed) / (2 * DECEL)) break;
      cap = Math.min(cap, approachCap(limit, d, DECEL));
    }
    // on failed track it crawls until its last vehicle is off
    const failed = ctx.builder.wear.unusable;
    if (failed.size > 0 && this.occupancyKeys(ctx.track.w).some((k) => failed.has(k)))
      cap = Math.min(cap, rules.trackCrawlSpeed);
    if (cautionArc !== null)
      cap = Math.min(
        cap,
        Math.max(0.25, Math.sqrt(2 * DECEL * Math.max(0, cautionArc - HOLD_GAP - this.pathPos))),
      );
    const vStop = Math.sqrt(2 * DECEL * Math.max(0, Math.min(remaining, blockDist)));
    const target = Math.min(cap, vStop);
    const prevSpeed = this.speed;
    const accelerating = target > this.speed;
    if (target > this.speed) this.speed = Math.min(target, this.speed + this.acceleration * gdt);
    else this.speed = Math.max(target, this.speed - DECEL * gdt * 1.5);
    if (bridgeFactor < 1) this.speed = Math.min(this.speed, cap);
    const braking = this.speed < prevSpeed - 1e-6;
    const travel = Math.min(
      remaining,
      Math.max(0, blockDist),
      Math.max(0.02 * gdt, this.speed * gdt),
    );
    // a head that comes within ARRIVE of the end of its path runs the rest: it stops on the end,
    // the last tile's centre, which `onwardTest` counts the cars back from
    const step = remaining - travel < ARRIVE ? remaining : travel;
    const problem = this.fuelProblem(ctx, step * ecoMul * Math.max(1, bio.waterUseMul));
    if (step > 0 && problem) {
      this.speed = 0;
      this.setState(problem);
      this.lastMessage = ENGLISH.trainNote.ranDry;
      return;
    }
    const from = this.pathPos;
    this.pathPos += step;
    this.distance += step;
    if (step > 0) {
      const problem = this.fuelProblem(ctx, step);
      if (problem) {
        this.speed = 0;
        this.setState(problem);
        this.lastMessage =
          problem === 'noFuel' ? ENGLISH.trainNote.outOfFuel : ENGLISH.trainNote.noPower;
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
      // traction sand (full production chain): spread on the rails, never a reason to stop; it
      // is paid for at the next store (`settle`)
      const sand = sandPerTile();
      if (sand > 0) {
        this.owed.sand += sand * step;
        bump(this.trip.fuel, 'sand', sand * step);
      }
      if (this.powerRate > 0) {
        // accelerating draws far more than cruising; braking gives a share back (regeneration)
        const need = this.powerRate * burn * (accelerating ? 3 : 1);
        if (headT && this.wireCeiling(ctx) !== null) {
          // on the wire: the grid feeds the motors and tops the battery carts up
          const grid = ctx.stores.grid;
          const got = grid.take('power', need);
          ctx.gridDraw(headT.x, headT.y, need / Math.max(1e-6, gdt));
          if (braking) grid.add('power', 0.3 * this.powerRate * step);
          if (got < need) this.battery = Math.max(0, this.battery - (need - got));
          if (this.batteryCap > 0 && this.battery < this.batteryCap - 1e-6) {
            const room = this.batteryCap - this.battery;
            const charge = grid.take('power', Math.min(room, PHYS.batteryChargePerTile * step));
            this.battery += charge;
            if (charge > 0) bump(this.trip.fuel, 'refuel_power', charge);
          }
        } else this.battery = Math.max(0, this.battery - need);
        bump(this.trip.fuel, 'power', need);
      }
      if (this.waterRate > 0 && this.water < this.waterCap * 0.5) this.drawTankerWater();
      this.trip.distance += step;
    }
    this.layTrail(from, this.pathPos);
    this.wearTrack(ctx);
    this.updatePoses();
    if (this.pathTotal - this.pathPos < ARRIVE) {
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
      if (this.serviceStop) {
        const service = ctx.builder.serviceAt(seg.x, seg.y);
        const store = this.serviceStoreAt(ctx, seg.x, seg.y);
        const taken = store ? this.fillUp(store, ctx.stores.grid, service) : {};
        for (const [k, v] of Object.entries(taken)) bump(this.trip.fuel, 'refuel_' + k, v);
        this.serviceStop = null;
        this.nextFuelCheck = ctx.now + 10;
        if (this.dispatch(ctx.track, ctx.builder, ctx.map)) {
          if (!this.planFuelDetour(ctx)) this.onPathReady(ctx);
        } else if (this.boundForWork) this.nextWork(ctx);
        else this.setState('noRoute');
        return;
      }
      if (this.holding) {
        if (this.shunt) {
          this.turn(ctx, this.shunt);
          return;
        }
        this.holding = false;
        if (this.aside) {
          // made way: it waits here for something worth hauling, not to go back where it stood
          this.aside = false;
          this.idle(ENGLISH.traffic.madeWay);
          return;
        }
        this.setState('yielding');
        if (this.kept) this.lastMessage = ENGLISH.traffic.keptBack;
        this.kept = false;
        return;
      }
      if (this.boundForWork) {
        // at the job's tile, at its waiting place, or at the end of a way failed track cut short
        const to = this.maint ?? this.parkAt;
        if (to?.x !== seg.x || to.y !== seg.y) this.setState('noRoute');
        else if (this.maint) this.startWork();
        else this.idle(ENGLISH.trainNote.noWork);
        return;
      }
      if (want && st === want) this.arrive(want, ctx);
      else if (want && ctx.builder.platformTiles(want).some((t) => t.x === seg.x && t.y === seg.y))
        this.arrive(want, ctx);
      else this.setState('noRoute');
    }
  }

  /** A tank wagon of water tops the boiler tanks up once they fall below half. */
  private drawTankerWater() {
    for (const w of this.wagons) {
      if (w.def.body !== 'tank' || w.cargo !== 'water' || w.amount <= 0) continue;
      const take = Math.min(w.amount, this.waterCap - this.water);
      if (take <= 1e-6) break;
      w.amount -= take;
      this.water += take;
      bump(this.trip.fuel, 'refuel_water', take);
      if (w.amount < 1e-3) {
        w.amount = 0;
        w.cargo = null;
        w.origin = null;
      }
    }
  }

  /**
   * The point `arc` along the path, on the tile it lies in. A point on a tile edge (within
   * `EDGE_SLACK`) stands on the tile it is leaving, the one the path's own point on that edge
   * carries: the path keeps the point that ends a tile and drops the same point starting the next.
   */
  private samplePath(arc: number): TrailPoint {
    const cum = this.pathCum;
    const pts = this.pathPts;
    const i = reach(cum, arc);
    if (i >= cum.length) {
      const l = pts[pts.length - 1];
      return { x: l.x, y: l.y, seg: l.seg };
    }
    const t = (arc - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const a = pts[i - 1];
    const b = pts[i];
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const leaving = Math.max(Math.abs(x - a.seg.x), Math.abs(y - a.seg.y)) <= 0.5 + EDGE_SLACK;
    return { x, y, seg: leaving ? a.seg : b.seg };
  }

  /** The head ran onto a piece it was not on: one hit, however many tiles the piece spans. */
  private wearTrack(ctx: TickCtx) {
    const head = this.headSeg;
    const piece = head && ctx.track.get(head.x, head.y);
    if (!head || !piece || piece.wear === this.lastWornPiece) return;
    this.lastWornPiece = piece.wear;
    ctx.builder.wear.hit(head.x, head.y, head.in, this.mass);
  }

  /**
   * Lay the trail the head ran along the path from arc `from` to `to`: each geometry point between
   * them at which the path turns or crosses a tile edge, then the head. The trail then runs along
   * the chords `trailLength` measures, and every tile edge it crosses is a point of it.
   */
  private layTrail(from: number, to: number) {
    const pts = this.pathPts;
    const cum = this.pathCum;
    let i = reach(cum, from);
    while (i < cum.length && cum[i] <= from) i++;
    for (; i + 1 < pts.length && cum[i] < to; i++) {
      const a = pts[i - 1];
      const p = pts[i];
      const b = pts[i + 1];
      const turn = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      if (b.seg !== p.seg || Math.abs(turn) > 1e-12) this.pushTrail({ x: p.x, y: p.y, seg: p.seg });
    }
    this.pushTrail(this.samplePath(to));
  }

  private arrive(st: Station, ctx?: TickCtx) {
    this.atStation = st;
    this.yieldCount = 0;
    this.gaveWayTo = null;
    this.loadedHere = 0;
    this.dropped = false;
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
      // top up once on arrival (a fuel detour too): a station with a dock (a depot, a warehouse,
      // a Townhouse) fills every tank from its store, a station supplied with fuel or water what
      // it supplies from its trackside supplier in reach (`stationStore`); the crew settles what
      // it owes there. Elsewhere nothing.
      const store = stationStore(ctx.stores, st);
      const all = !!ctx.stores.dockOf(st);
      const taken = store
        ? this.fillUp(store, ctx.stores.grid, {
            fuel: all || st.refuelsFuel,
            water: all || st.refuelsWater,
          })
        : {};
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
    // unload: contract cargo is credited first, everything else enters the station's store
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
      // where the load can go: a contract for it here first, then the store of a depot, a
      // warehouse or a Townhouse, up to its room
      const contractable = !st.def.pool && st.accepts(w.cargo);
      if (!st.isStore && !contractable) continue;
      let n = Math.min(w.amount, budget);
      if (n <= 1e-6) continue;
      const credited = contractable
        ? ctx.onDelivery({
            cargo: w.cargo,
            amount: n,
            origin: w.origin ?? -1,
            station: st,
            train: this,
          })
        : 0;
      const toStore = st.isStore ? Math.min(n - credited, st.roomFor(w.cargo)) : 0;
      n = credited + toStore;
      if (n <= 1e-6) continue;
      if (toStore > 0) {
        st.store(w.cargo, toStore);
        this.flowAcc[w.cargo] = (this.flowAcc[w.cargo] ?? 0) + toStore;
      }
      w.amount -= n;
      budget -= n;
      busy = true;
      if (this.mode === 'freight' && !this.job) this.dropped = true;
      bump(this.trip.delivered, w.cargo, n);
      if (w.amount < 1e-3) {
        w.amount = 0;
        w.cargo = null;
        w.origin = null;
      }
    }
    if (this.flowTimer >= 90) this.flushFlow(ctx, st);
    // load what the station makes, or its store holds, when a later stop takes it. A roaming
    // train takes goods on only at a producer's own pile (`pickupPile`): never out of a store,
    // so what it puts down there stays; a transport train only takes passengers
    const job = this.job;
    const roaming = this.dynamic && !job;
    const produced =
      roaming && !st.pickupPile
        ? []
        : st.availableCargo().filter((c) => {
            // at a contract's origin only the contract's cargo comes aboard
            if (job && st.id === job.originId) return c === job.cargo;
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
    // goods go on to a station that wants them, or to a store that is not the one they came out
    // of (two warehouses of one town are one store; two unbound warehouses count as one too)
    const oneStore = (a: Station, b: Station) =>
      a.dock && b.dock ? a.dock.key === b.dock.key : !!a.def.stockpile && !!b.def.stockpile;
    const taker = (c: string) =>
      routeStations.some((s) =>
        cargoClass(c) === 'people' ? s.accepts(c) : s.isStore ? !oneStore(s, st) : s.accepts(c),
      );
    let allFull = true;
    let canLoadAny = false;
    for (const w of this.wagons) {
      if (stop.load === 'none') break;
      if (budget <= 0) break;
      // a wagon that holds nothing (the maintenance wagon) is never waited on
      if (w.def.capacity <= 0) continue;
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
      : produced.some((c) => st.stored(c) >= 1 || st.productionPerWeek > 0);
    const waitFull = stop.load !== 'none' && stop.waitFull && canFill && canLoadAny && !this.eco;
    if (waitFull && !allFull && this.stateTime < MAX_DWELL_FULL) busy = true;
    const maxDwell =
      stop.maxDwell && stop.maxDwell > 0 ? stop.maxDwell : waitFull ? MAX_DWELL_FULL : MAX_DWELL;
    const minDwell = Math.max(MIN_DWELL, stop.minDwell ?? 0);
    if ((!busy && this.stateTime >= minDwell) || this.stateTime >= maxDwell) this.depart(ctx);
  }

  private depart(ctx: TickCtx) {
    const st = this.atStation;
    // an idle train asking again: it never tried to load where it stands
    const wasIdle = this.state === 'idle';
    if (st) {
      st.occupants.delete(this.id);
      this.flushFlow(ctx, st);
      // the crew pays for what it ate while it stood here: at the store it fills up from, else at
      // the store of the town the station stands in
      const store = stationStore(ctx.stores, st) ?? ctx.stores.townStore(st.x, st.y);
      if (store) this.settle(store);
    }
    this.atStation = null;
    if (this.maintaining) {
      const job = this.maint;
      this.detour = null;
      if (this.tooHeavy()) return;
      // a stop on the way: it goes on with the job it holds
      if (job && this.dispatch(ctx.track, ctx.builder, ctx.map)) this.onPathReady(ctx);
      else this.nextWork(ctx);
      return;
    }
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
      if (
        next !== null &&
        st &&
        next === st.id &&
        (this.dropped || (this.loadedHere < 1 && !wasIdle))
      ) {
        // nothing came aboard here, or what the train put down here is what makes the stop
        // worth picking: the pick is stale, look elsewhere for a minute
        this.badTargets.set(st.id, ctx.now + 60);
        next = ctx.chooseNext(this);
      }
      if (next !== null && next !== st?.id) {
        this.schedule = [defaultStop(next)];
        this.routeIndex = 0;
      } else if (next !== null && st) {
        // this station is still the best pick, or something worth hauling turned up where the
        // train stood idle: load as its output comes in, once a platform is free
        this.schedule = [defaultStop(st.id)];
        this.routeIndex = 0;
        this.atStation = st;
        this.loadedHere = 0;
        if (st.hasFreePlatform()) {
          st.occupants.add(this.id);
          this.setState('loading');
        } else this.setState('waiting');
        return;
      } else {
        // nothing worth doing right now: stay where it stands, holding no platform, and ask again
        // in a while (a train that just finished here drops the note of its last run)
        this.atStation = st;
        this.idle(wasIdle ? undefined : '');
        return;
      }
    } else if (program) this.routeIndex = (this.routeIndex + 1) % this.route.length;
    if (this.routeIndex === 0 && !wasDetour) {
      this.trip.endedAt = ctx.now;
      this.lastTrip = this.trip;
      this.trip = newTrip(ctx.now);
    }
    if (this.tooHeavy()) return;
    sfx('train.whistle');
    // prefer a path that keeps clear of tiles other trains stand on (takes the loop when one is
    // free); fall back to the plain shortest path
    const avoid = (x: number, y: number) => ctx.occupied(x, y, this.id);
    const mode = leaving?.depart ?? 'auto';
    if (
      this.dispatch(ctx.track, ctx.builder, ctx.map, avoid, mode) ||
      this.dispatch(ctx.track, ctx.builder, ctx.map, undefined, mode)
    ) {
      // setting off: what it put down at this stop stays behind
      this.dropped = false;
      if (!this.planFuelDetour(ctx)) this.onPathReady(ctx);
      else if (this.path) this.setState('moving');
    } else if (this.leaveBroken(ctx)) {
      // no way on from the failed piece it stands on: it gets off that first
    } else if (this.dynamic) {
      // a roaming train remembers the station it could not reach and picks another one soon
      this.badTargets.set(this.route[this.routeIndex % this.route.length], ctx.now + 240);
      this.atStation = st;
      this.idle(ENGLISH.trainNote.noTrackToStop);
    } else this.setState('noRoute');
  }

  /** Too much on the hook to set off: it stands and says so. */
  private tooHeavy(): boolean {
    if (this.weight <= this.power + 1e-6) return false;
    this.setState('overweight');
    this.lastMessage = ENGLISH.trainNote.tooHeavy;
    return true;
  }

  /**
   * Head-on meeting: back off to the previous stop (or any path that avoids the other train)
   * and let the oncoming train through. Returns false when there is nowhere to go. With `shunt`,
   * when no refuge can be run straight into, a move that reverses once partway (`findShuntPath`).
   */
  planRetreat(ctx: TickCtx, group: number[] = [], shunt = false): RetreatPlan | null {
    if (!this.trail.length || this.blockedBy === null || this.holding) return null;
    if (['noFuel', 'noPower', 'overweight', 'stranded'].includes(this.state)) return null;
    const members = [...new Set([this.id, this.blockedBy, ...group])];
    const theirs = new Set<number>();
    for (const id of members)
      if (id !== this.id) for (const key of ctx.trainPath(id)) theirs.add(key);
    const w = ctx.track.w;
    if (this.occupancyKeys(w).every((key) => !theirs.has(key))) return null;
    const platforms = new Set<number>();
    for (const station of ctx.builder.stations)
      for (const tile of ctx.builder.platformTiles(station)) platforms.add(tile.y * w + tile.x);
    return (
      this.refugePlan(ctx, members, theirs, platforms) ??
      (shunt ? this.refugePlan(ctx, members, theirs, platforms, undefined, undefined, true) : null)
    );
  }

  /**
   * Where an idle train, or one at work on a piece (`Fleet.yieldWork`), can go to get out of the way
   * of `group`, the trains whose route crosses the tiles it stands on: the nearest place that holds
   * the whole consist off every route in `spots.theirs`, in a siding when one is free, else on plain
   * track, a platform or a depot gate no other train is bound for. The way there crosses no other
   * train, no other escape and no claim of a train outside the group; the group's claims give way to
   * the move. With `through` the way may cross the trains of the group: the way it would take were
   * they to back off. With `shunt`, when no such place can be run straight into, a move that
   * reverses once partway to one, a siding first. Null when there is nowhere to go.
   */
  planAside(
    ctx: TickCtx,
    group: number[],
    spots: AsideSpots,
    through = false,
    shunt = false,
  ): RetreatPlan | null {
    if (this.state !== 'idle' && this.state !== 'repairing') return null;
    if (this.holding || !this.trail.length) return null;
    const members = [...new Set([this.id, ...group])];
    const past = through ? new Set(group) : undefined;
    const plan = (only?: Set<number>, turn = false) =>
      this.refugePlan(ctx, members, spots.theirs, spots.bound, past, only, turn);
    return (
      plan(spots.sidings) ??
      plan() ??
      (shunt ? (plan(spots.sidings, true) ?? plan(undefined, true)) : null)
    );
  }
  /**
   * The way an idle train in the way would take aside were the trains in that way gone (from
   * `planAside` with `through`), or null. It counts as the idle train's route (`pathTileKeys`), so
   * the jam resolution sees a train standing in it and can back that train off.
   */
  wantAside(path: readonly PathSegment[] | null) {
    this.wantTiles = path ? path.map((s) => ({ x: s.x, y: s.y })) : null;
  }

  /**
   * Whether a refuge leaves the train a way on (`refugePlan`): from where the way there ends, it
   * can run, either end first, to its next stop, or, idle, back to the station it stood at. Null
   * when there is nothing to check: no such stop, or no way there from where the train stands
   * now either, so no refuge leaves it worse off.
   */
  private onwardTest(ctx: TickCtx): ((path: readonly PathSegment[]) => boolean) | null {
    const stop = this.route.length ? this.route[this.routeIndex % this.route.length] : null;
    const id = this.state === 'idle' ? (this.atStation?.id ?? stop) : (this.detour ?? stop);
    const head = this.trail.at(-1)?.seg;
    if (id === null || !head) return null;
    const station = ctx.builder.stationById(id);
    const plat = station ? ctx.builder.platformTiles(station) : [];
    if (!plat.length) return null;
    const w = ctx.track.w;
    const key = `${id}|${ctx.track.version}|${ctx.now}`;
    if (this.onwardMemo?.key !== key)
      this.onwardMemo = { key, states: statesReaching(ctx.track, plat, this.canUse) };
    const { states } = this.onwardMemo;
    const on = (x: number, y: number, entry: Dir) => states.has(stateKey(w, x, y, entry));
    const rear = this.reversedTrail().trail.at(-1)?.seg;
    if (!on(head.x, head.y, head.in) && !(rear && on(rear.x, rear.y, rear.in))) return null;
    const length = this.length;
    return (path) => {
      // the head stops at the last tile's centre: on through it, head first
      const last = path[path.length - 1];
      if (on(last.x, last.y, last.in)) return true;
      // or rear first, from the tile the rear stands on (`rearOn`; the first, when the way is
      // shorter than the train): looking back from the head would count a stop under the cars,
      // which the rear runs away from
      const s = path[Math.max(0, rearOn(ctx.track, path, length))];
      return on(s.x, s.y, s.out);
    };
  }

  /**
   * The shorter way, either end first, to a refuge that holds the whole consist: plain track off
   * the routes in `theirs` and off the tiles in `barred` (and on the tiles of `only`, when given),
   * from which the train has a way on (`onwardTest`). The way never crosses another train or
   * another escape, nor a claim of a train outside `members`; with `through`, it may cross the
   * trains in that set. With `shunt` the way reverses once partway (`findShuntPath`).
   */
  private refugePlan(
    ctx: TickCtx,
    members: number[],
    theirs: Set<number>,
    barred: Set<number>,
    through?: Set<number>,
    only?: Set<number>,
    shunt = false,
  ): RetreatPlan | null {
    const w = ctx.track.w;
    const standing = through
      ? (x: number, y: number) =>
          ctx.occupants(x, y).some((id) => id !== this.id && !through.has(id))
      : (x: number, y: number) => ctx.occupied(x, y, this.id);
    const avoid = (x: number, y: number) => {
      if (standing(x, y) || ctx.recoveryOwner(x, y, this.id) !== null) return true;
      const owner = ctx.claimedBy(x, y, this.id);
      // Waiting group members surrender future claims to the chosen escape move. Physical
      // occupancy and other groups' reservations are never surrendered.
      return owner !== null && !members.includes(owner);
    };
    const refuge = (x: number, y: number) => {
      const key = y * w + x;
      const piece = ctx.track.get(x, y);
      return (
        !!piece &&
        piece.links.length === 1 &&
        !piece.unit &&
        !theirs.has(key) &&
        !barred.has(key) &&
        (!only || only.has(key)) &&
        !avoid(x, y)
      );
    };
    const onward = this.onwardTest(ctx) ?? undefined;
    const reversed = this.reversedTrail();
    const track = ctx.track;
    const arc = (way: PathSegment[]) =>
      way.reduce((sum, p) => sum + track.segLength(p.x, p.y, p.in, p.out), 0);
    // the tiles under the cars, one crossing each from the head to the rear end, as the
    // turned-round trail runs over them: those behind its head a shunt counts on (`findShuntPath`)
    const under: PathSegment[] = [];
    if (shunt)
      for (const { seg } of reversed.trail) {
        const last = under.at(-1);
        if (!last || last.x !== seg.x || last.y !== seg.y) under.push(seg);
      }
    const plans: RetreatPlan[] = [];
    for (const flip of [false, true]) {
      const points = flip ? reversed.trail : this.trail;
      const head = points[points.length - 1]?.seg;
      if (!head) continue;
      if (shunt) {
        const rear = (way: readonly PathSegment[]) => rearOn(track, way, this.length);
        // the tiles behind its head, rear end first, crossed the way it sets off
        const behind = flip
          ? under.slice(0, -1)
          : under
              .slice(1)
              .reverse()
              .map((s) => ({ x: s.x, y: s.y, in: s.out, out: s.in }));
        const legs = findShuntPath(
          track,
          head,
          this.length,
          avoid,
          refuge,
          this.canUse,
          rear,
          onward,
          behind,
        );
        if (legs) {
          const distance = arc(legs.out) + arc(legs.back);
          plans.push({ path: legs.out, back: legs.back, flip, group: members, distance });
        }
        continue;
      }
      const path = findRefugePath(track, head, this.length, avoid, refuge, this.canUse, onward);
      if (path) plans.push({ path, flip, group: members, distance: arc(path) });
    }
    return plans.sort((a, b) => a.distance - b.distance)[0] ?? null;
  }

  /**
   * Pull aside along a plan (from `planRetreat`, or `planAside` for an idle train), reserved before
   * anything changes, both legs of a shunt with it. An idle train, one at work on a piece, or one
   * standing with no stop at all, makes way and idles where the way ends; any other waits there to
   * go on (`yielding`).
   */
  retreat(ctx: TickCtx, group: number[] = [], plan = this.planRetreat(ctx, group)): boolean {
    if (!plan) return false;
    const way = plan.back ? [...plan.path, ...plan.back] : plan.path;
    if (!ctx.reserveRecovery(this, way, plan.group)) return false;
    // The complete plan is reserved before changing direction or leaving the platform.
    this.aside =
      this.state === 'idle' ||
      this.state === 'repairing' ||
      (this.state === 'noRoute' && !this.route.length);
    this.serviceStop = null;
    if (plan.flip) this.reverseConsist();
    if (this.atStation) this.atStation.occupants.delete(this.id);
    this.atStation = null;
    this.setPath(plan.path, ctx.map, ctx.track);
    this.shunt = plan.back ?? null;
    this.trackVersion = ctx.track.version;
    this.holding = true;
    this.kept = false;
    this.retreatGroup = plan.group;
    this.yieldCount++;
    this.yieldUntil = ctx.now + 30;
    this.clearHold();
    this.lastMessage = this.aside ? ENGLISH.traffic.makingWay : ENGLISH.traffic.pullingAside;
    this.setState('moving');
    return true;
  }
  /**
   * Note that the escape a working train has just set off along in a jam (`retreat`) gives way to
   * train `other`. True when the last escape it gave way on in a jam was for that train too and it
   * has reached no stop since (`gaveWayTo`, which `arrive` clears): the line keeps the two from
   * passing, and where the escape ends the train says it is kept back (`ENGLISH.traffic.keptBack`).
   * Making way while idle counts for nothing here, though it adds to `yieldCount`. Always false for
   * a train with no stop, or making way.
   */
  gaveWay(other: number): boolean {
    if (!this.holding || this.aside || !this.route.length) return false;
    this.kept = this.gaveWayTo === other;
    this.gaveWayTo = other;
    return this.kept;
  }

  /**
   * A shunt's turn, at the end of its first leg: at rest, wholly on plain track past the switch,
   * the train turns where it stands, no car moving (`reverseConsist`), and sets off along `back`
   * from the tile its rear end was on. When that is not where `back` starts, it neither turns nor
   * goes on (`cancelRetreat`).
   */
  private turn(ctx: TickCtx, back: PathSegment[]) {
    this.shunt = null;
    const rear = this.reversedTrail().trail.at(-1)?.seg;
    const from = back[0];
    if (!rear || rear.x !== from.x || rear.y !== from.y || rear.in !== from.in) {
      this.cancelRetreat(ctx.now);
      return;
    }
    this.reverseConsist();
    this.setPath(back, ctx.map, ctx.track);
    this.trackVersion = ctx.track.version;
  }

  /** Stop a stale recovery at its current position; physical occupancy remains protected. */
  cancelRetreat(now: number) {
    if (!this.holding) return;
    this.holding = false;
    this.shunt = null;
    this.kept = false;
    this.speed = 0;
    this.yieldUntil = now + 4;
    if (this.aside) {
      // making way: it stops where it is and idles; the fleet moves it on if still in the way
      this.aside = false;
      if (this.state === 'moving') this.idle(ENGLISH.traffic.replan);
      return;
    }
    if (this.state === 'moving' || this.state === 'yielding') {
      this.lastMessage = ENGLISH.traffic.replan;
      this.setState('yielding');
    }
  }
  /**
   * Tile keys of the remaining path and every tile under the cars, plus the way a waiting train
   * wants to take: on from a siding (`yielding`), or aside out of another train's way (`idle`),
   * and the second leg of a shunt.
   */
  pathTileKeys(w: number, ahead = Infinity): Set<number> {
    const out = new Set<number>();
    for (const p of this.poses) out.add(Math.floor(p.y + 0.5) * w + Math.floor(p.x + 0.5));
    if ((this.state === 'yielding' || this.state === 'idle') && this.wantTiles)
      for (const s of this.wantTiles) out.add(s.y * w + s.x);
    for (const s of this.shunt ?? []) out.add(s.y * w + s.x);
    if (this.path)
      for (let i = this.firstPointFrom(this.pathPos - 0.5); i < this.pathPts.length; i++) {
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

  /**
   * After a load, once, before the train's first tick: it stands at the station it was saved at
   * again (among the station's occupants only while loading: a train waiting for a platform holds
   * none, and an idle one none either), a train backing off for another or making way for it has
   * its escape reserved again (`reserve`) and runs on along it, and any other train with a way
   * runs on along the way it had (`wayJSON`), keeping its speed. The fleet's traffic control
   * calls this for every train before any claim is made or any train moves, so loaded trains find
   * each other on the platforms and their paths are claimed from the first tick. What the save
   * does not hold is settled as play would settle it: a train backing off whose escape cannot be
   * reserved again stops and plans again (making way, it stops and idles), a train under way whose
   * way the save does not hold (a save before v17) or the track no longer carries plans its path
   * again (`replanAfterLoad`), a contract that closed under it (the hand-back was pending, not
   * saved) hands the program back on the first tick, and a train whose station or way is gone
   * stands without a route and looks for one at once.
   */
  resumeAfterLoad(builder: Builder, now: number, reserve: ReserveEscape) {
    const loaded = this.loaded;
    if (!loaded) return;
    this.loaded = null;
    // a train backing off runs on along its escape or stops: it has no other way
    const backing = this.holding;
    if (backing && !this.resumeRetreat(builder, loaded.retreat, reserve)) this.cancelRetreat(now);
    if (this.state === 'loading' || this.state === 'waiting' || this.state === 'idle') {
      const st = loaded.station === null ? undefined : builder.stationById(loaded.station);
      if (st) {
        this.atStation = st;
        if (this.state === 'loading') st.occupants.add(this.id);
      } else if (this.state !== 'idle') this.standAfterLoad();
    }
    if (
      !this.job &&
      this.suspended &&
      ((this.state === 'moving' && !this.holding) || this.state === 'noRoute')
    )
      this.resumePending = true;
    else if (
      backing ||
      !loaded.way ||
      !this.leadsOn(builder, loaded.way.path) ||
      !this.followSaved(builder, loaded.way)
    ) {
      if (this.state === 'moving' && !this.path && !this.replanAfterLoad(builder))
        this.standAfterLoad();
    }
  }
  /**
   * The path of a loaded train under way whose save holds no way it can run on, planned again
   * from its head to where it was bound at the speed it had: the fuel or water service it was
   * heading to, or else the stop (a refuelling detour's station first). The head may already
   * stand on the tile it halts on, short of the middle. A service it can no longer reach is
   * dropped for the stop, as `dispatch` drops it. False when the stop or every way there is gone.
   */
  private replanAfterLoad(builder: Builder): boolean {
    const track = builder.track;
    const head = this.trail[this.trail.length - 1]?.seg;
    if (!head) return false;
    const keys = new Set<number>();
    const service = this.serviceStop;
    if (service) keys.add(service.y * track.w + service.x);
    else for (const p of this.boundTiles(builder)) keys.add(p.y * track.w + p.x);
    const isTarget = (x: number, y: number) => keys.has(y * track.w + x);
    const path = !keys.size
      ? null
      : isTarget(head.x, head.y)
        ? [{ ...head }]
        : this.pathTo(track, { x: head.x, y: head.y, in: head.in }, isTarget);
    if (!path) {
      if (!service) return false;
      this.serviceStop = null;
      return this.replanAfterLoad(builder);
    }
    // leaving the head's tile the way the head runs, it stays on the route it stands on
    this.followAfterLoad(path, builder, path[0].out === head.out ? head.route : undefined);
    return true;
  }
  /**
   * The escape of a loaded train that was backing off for another: the rest of the path it was
   * running and a shunt's second leg, reserved again for the same waiting group. False when the
   * save holds none, the train no longer stands on it or is not under way, the track no longer
   * carries it, or another train or escape is in the way.
   */
  private resumeRetreat(
    builder: Builder,
    retreat: RetreatSave | null,
    reserve: ReserveEscape,
  ): boolean {
    if (this.state !== 'moving' || !retreat || !this.followSaved(builder, retreat)) return false;
    const back = retreat.back?.length ? retreat.back.map((s) => ({ ...s })) : null;
    if (
      (back && !this.pathStillValid(builder.track, back)) ||
      !reserve(back ? [...this.path!, ...back] : this.path!, retreat.group)
    ) {
      this.dropPath();
      return false;
    }
    this.shunt = back;
    this.kept = retreat.kept === true;
    this.retreatGroup = retreat.group;
    return true;
  }
  /**
   * Run on along a saved way from where the head stands, at the speed the train had: true when
   * the track still carries it and the head stands on it where the save has it. A way saved
   * before v17, which holds no `left`, starts on the head's tile or on the one the head is just
   * leaving for it.
   */
  private followSaved(builder: Builder, way: { path: PathSegment[]; left?: number }): boolean {
    const head = this.trail[this.trail.length - 1]?.seg;
    const path = way.path.map((s) => ({ ...s }));
    if (!head || !path.length || !this.pathStillValid(builder.track, path)) return false;
    const under = (s?: PathSegment) => s?.x === head.x && s.y === head.y && s.in === head.in;
    if (way.left === undefined && !under(path[0]) && !under(path[1])) return false;
    this.followAfterLoad(path, builder, path[0].route);
    if (way.left === undefined) return true;
    const at = this.pathTotal - way.left;
    this.pathPos = Math.max(0, at);
    if (at > -1e-6 && under(this.samplePath(this.pathPos).seg)) return true;
    this.dropPath();
    return false;
  }
  /**
   * Whether a saved way still ends where the train is bound: at the fuel or water service it
   * heads to, or else on a platform of its stop (a refuelling detour's station first). What is
   * left of an escape cut short, which a yielding train may still have, ends where it was to pull
   * aside.
   */
  private leadsOn(builder: Builder, path: readonly PathSegment[]): boolean {
    const end = path[path.length - 1];
    if (this.state === 'yielding' || !end) return !!end;
    const service = this.serviceStop;
    if (service) return end.x === service.x && end.y === service.y;
    return this.boundTiles(builder).some((p) => p.x === end.x && p.y === end.y);
  }
  /** Run on along `path` from the head at the speed the train had. */
  private followAfterLoad(path: PathSegment[], builder: Builder, headRoute?: number) {
    const speed = this.speed;
    this.setPath(path, builder.map, builder.track, headRoute);
    this.trackVersion = builder.track.version;
    this.speed = speed;
  }
  /** Forget a way taken up after a load that cannot be run after all. */
  private dropPath() {
    this.path = null;
    this.pathPts = [];
    this.pathCum = [];
    this.pathPos = 0;
  }
  /**
   * The rest of the path the train runs, for a save: from the first tile it still counts as ahead
   * (`pathAhead`, from half a tile behind the head) or, when nearer, the tile of the last point
   * the head has passed, and how far the head has left to run along it.
   */
  private wayJSON(): WaySave | null {
    const path = this.path;
    if (!path || !this.pathPts.length) return null;
    let k = 0;
    while (
      k + 1 < this.pathPts.length &&
      this.pathCum[k] < this.pathPos - 0.5 &&
      this.pathCum[k + 1] <= this.pathPos
    )
      k++;
    const from = Math.max(0, path.indexOf(this.pathPts[k].seg));
    return { path: path.slice(from).map((s) => ({ ...s })), left: this.pathTotal - this.pathPos };
  }
  /**
   * The rest of the escape a train backing off runs (`wayJSON`), and the group it is for; a shunt's
   * second leg too, before the turn, and that it is kept back.
   */
  private retreatJSON(): RetreatSave | null {
    const way = this.holding ? this.wayJSON() : null;
    const back = this.shunt && { back: this.shunt.map((s) => ({ ...s })) };
    const kept = this.kept && { kept: true };
    return (
      way && { path: way.path, group: [...this.retreatGroup], left: way.left, ...back, ...kept }
    );
  }
  /** Nothing to carry on with after a load: stand without a route and look for one at once. */
  private standAfterLoad() {
    this.serviceStop = null;
    this.speed = 0;
    this.setState('noRoute');
    this.stateTime = 10;
  }

  toJSON() {
    const head = this.trail[this.trail.length - 1];
    return {
      id: this.id,
      name: this.name,
      colour: this.colour,
      locos: this.locos.map((l) => ({
        uid: l.uid,
        defId: l.def.id,
        level: l.level,
        mode: l.mode,
        inCab: l.inCab,
      })),
      schedule: this.schedule,
      tanks: {
        coal: this.coal,
        oil: this.oil,
        water: this.water,
        battery: this.battery,
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
      // v14: what the train was doing, so it carries on after a load
      state: this.state,
      stateTime: this.stateTime,
      speed: this.speed,
      // the station it stands at: loading, waiting for a platform, or idle there (a train loaded
      // and saved again before its first tick has not looked it up yet)
      station: this.atStation?.id ?? this.loaded?.station ?? null,
      holding: this.holding,
      // v17: the escape is an idle train making way, which idles where it ends
      aside: this.aside,
      // the escape it is backing off along, and the group it was reserved for
      retreat: this.loaded ? this.loaded.retreat : this.retreatJSON(),
      // v17: the way any other train with one runs, which it runs on along after a load (before,
      // a train under way planned its path again)
      way: this.loaded ? this.loaded.way : this.holding ? null : this.wayJSON(),
      blockedTime: this.blockedTime,
      // v17: the train a yielding train last found in its way, and the tiles of the way a waiting
      // train would take once the line clears: on from a siding, or aside (`wantAside`)
      blockedBy: this.state === 'yielding' ? this.blockedBy : null,
      want: this.wantTiles && this.wantTiles.map((s) => [s.x, s.y]),
      yieldCount: this.yieldCount,
      // the game time until which it is not asked to back off again, and a yielding train sets
      // off ignoring other trains a minute after it
      yieldUntil: this.yieldUntil,
      // v17: the game time from which it may look again for a way aside, and from which a jam it
      // is in may be searched again
      asideRetry: this.asideRetry,
      recoveryRetry: this.recoveryRetry,
      // the stations a roaming train ruled out, with the game time each comes back
      badTargets: [...this.badTargets],
      // the fuel or water service it is heading to before its stop, and the game time it next
      // looks for one
      serviceStop: this.serviceStop && { ...this.serviceStop },
      nextFuelCheck: this.nextFuelCheck,
      head: head
        ? { x: head.seg.x, y: head.seg.y, in: head.seg.in, reversed: this.reversed }
        : null,
      reversed: this.reversed,
      // at full precision, since a car placed a hair off can reach its stop a tick early or late;
      // since v14 with the route of a multi-tile piece, which the tile alone may not tell
      trail: this.trail.map((p) => [
        p.x,
        p.y,
        p.seg.x,
        p.seg.y,
        p.seg.in,
        p.seg.out,
        ...(p.seg.route === undefined ? [] : [p.seg.route]),
      ]),
      // v17: the note it shows
      note: this.lastMessage,
      // v18: a freight train has put goods down at the stop it stands at
      dropped: this.dropped,
      // the food and sand it owes the next store; a file without them owes nothing
      ...owedJSON(this.owed),
      // the job it holds, where it waits and what its repairs left owing; a file without them has
      // none of these
      ...maintJSON(this.maint, this.parkAt, this.repairOwed),
    };
  }

  static fromJSON(j: ReturnType<Train['toJSON']>, track: TrackGraph): Train {
    const t = new Train(
      j.locos.map((l) => ({
        uid: l.uid,
        def: locoDef(l.defId),
        level: l.level,
        mode: l.mode,
        inCab: l.inCab,
      })),
      j.name,
      j.id,
    );
    t.colour = savedTrainColour(j.colour);
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
    // the migration steps map the old mode names to the current ones and fill the battery
    t.mode = DYNAMIC_MODES.includes(j.mode) || j.mode === 'maintenance' ? j.mode : 'schedule';
    t.coal = j.tanks.coal;
    t.oil = j.tanks.oil;
    t.water = j.tanks.water;
    t.battery = Math.min(t.batteryCap, j.tanks.battery);
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
    // placing the consist stopped it: the speed it had comes after
    t.state = j.state;
    t.stateTime = j.stateTime;
    t.speed = j.speed;
    t.holding = j.holding;
    t.aside = j.aside;
    t.blockedTime = j.blockedTime;
    t.yieldCount = j.yieldCount;
    t.yieldUntil = j.yieldUntil;
    t.asideRetry = j.asideRetry;
    t.recoveryRetry = j.recoveryRetry;
    t.badTargets = new Map(j.badTargets);
    t.serviceStop = j.serviceStop && { ...j.serviceStop };
    t.nextFuelCheck = j.nextFuelCheck;
    t.dropped = j.dropped === true;
    t.owed = { food: owedOf(j.owed?.food), sand: owedOf(j.owed?.sand) };
    t.maint = maintOf(j.maint);
    t.parkAt = parkAtOf(j.parkAt);
    t.repairOwed = repairOwedOf(j.repairOwed);
    // a yielding train looks again only every two seconds: until then what it last found holds
    if (t.state === 'yielding') {
      t.blockedBy = j.blockedBy;
      t.blocked = j.blockedBy !== null;
    }
    t.wantTiles = j.want && j.want.map(([x, y]) => ({ x, y }));
    // the station, the escape and the way wait for the builder (`resumeAfterLoad`)
    t.loaded = { station: j.station, retreat: j.retreat, way: j.way };
    // the note it showed, but that it is jammed: the fleet says so again while the jam lasts, and
    // keeps what it would say after only while it runs (`Fleet.keepJamNotes`)
    t.lastMessage = j.note === ENGLISH.traffic.jammed ? '' : j.note;
    if (t.consistProblem) t.lastMessage = t.consistProblem;
    return t;
  }
}
