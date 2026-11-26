import type { TrackGraph, TrackPiece } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Builder } from './build';
import { aheadRun, type AheadTile, type PathTiles, type Train } from './trains';
import type { JunctionStats } from './junctions';
import type { PathSegment } from '../world/pathfinding';
import { blockingGroups, RecoveryReservations, turnIndex } from './recovery';
import { STR } from '../strings';
import { classRank } from './compat';

/** How far ahead (tiles) a moving train claims track beyond the section it is entering. */
const HORIZON = 6;
/** No head movement for this long while wanting to move counts as stuck (game seconds). */
const STUCK_AFTER = 30;
/** Minimum head movement (tiles) that counts as progress. */
const PROGRESS_EPS = 0.05;
/** Room (tiles) beyond its stopping distance a train needs to give a claimed stretch away. */
const GIVE_WAY_ROOM = 1;

type Ahead = { x: number; y: number; in: number; out: number; arc: number }[];

export type EpisodeKind =
  'stuck' | 'unstuck' | 'deadlock' | 'overlap' | 'yield' | 'headOn' | 'recovery';
export interface TrafficEpisode {
  /** game time */
  t: number;
  kind: EpisodeKind;
  train: number;
  name: string;
  other: number | null;
  x: number;
  y: number;
  text: string;
}
export interface TrainTraffic {
  /** seconds spent held behind or before another train */
  blocked: number;
  /** times the train pulled aside */
  yields: number;
  /** stuck episodes (no movement for STUCK_AFTER while trying to move) */
  stuck: number;
  /** ticks in which a car shared a tile with another train's car */
  overlaps: number;
  /** distance-free progress clock */
  lastMoveAt: number;
  lastX: number;
  lastY: number;
  /** set while a stuck episode is open */
  stuckSince: number | null;
  movedSinceStuck: number;
}

/**
 * The claims map, tile key -> train id: a Map (its order and API unchanged) with a dense copy of
 * the owners of non-negative integer keys, so the per-tile lookups of `assign` read an array.
 * `beginKeep`, `keep` and `dropUnkept` delete every claim not marked in between.
 */
export class ClaimMap extends Map<number, number> {
  /** owner of tile key k at [k], NaN when unclaimed */
  private owners = new Float64Array(0);
  /** keep pass of tile key k at [k] */
  private marks = new Int32Array(0);
  private pass = 0;
  /** keys outside the dense range marked in this pass */
  private keptOther = new Set<number>();

  private dense(key: number) {
    return (key | 0) === key && key >= 0 && key < 1 << 26;
  }
  private grow(key: number) {
    if (key < this.owners.length) return;
    const n = Math.max(key + 1, this.owners.length * 2, 1024);
    const owners = new Float64Array(n).fill(NaN);
    owners.set(this.owners);
    const marks = new Int32Array(n);
    marks.set(this.marks);
    this.owners = owners;
    this.marks = marks;
  }
  override get(key: number): number | undefined {
    if (!this.dense(key)) return super.get(key);
    const v = key < this.owners.length ? this.owners[key] : NaN;
    return v === v ? v : undefined;
  }
  override set(key: number, owner: number): this {
    super.set(key, owner);
    if (this.dense(key)) {
      this.grow(key);
      this.owners[key] = owner;
    }
    return this;
  }
  override delete(key: number): boolean {
    if (this.dense(key) && key < this.owners.length) this.owners[key] = NaN;
    return super.delete(key);
  }
  override clear(): void {
    this.owners.fill(NaN);
    super.clear();
  }
  beginKeep() {
    this.pass++;
    this.keptOther.clear();
  }
  keep(key: number) {
    if (!this.dense(key)) this.keptOther.add(key);
    else if (key < this.marks.length) this.marks[key] = this.pass;
  }
  dropUnkept() {
    for (const key of this.keys()) {
      const kept = this.dense(key) ? this.marks[key] === this.pass : this.keptOther.has(key);
      if (!kept) this.delete(key);
    }
  }
}

/** A path ahead by tile: `ahead[i]` stands on `keys[k0 + i]`, in section `secs[k0 + i]`. */
interface AheadIndex {
  keys: ArrayLike<number>;
  secs: ArrayLike<number>;
  k0: number;
}

/** A multi-tile piece where roads part or meet: a switch. A multi-tile curve is plain track. */
function isJunctionUnit(p: TrackPiece) {
  return !!p.unit && p.kind !== 'curve';
}

/**
 * Traffic control and traffic statistics.
 *
 * Control: the track is cut into sections (plain track between switches, platforms and dead
 * ends). A moving train claims the tiles of its path ahead, but only whole sections: it may not
 * enter a section unless every tile of it up to the next node is free of other trains' claims,
 * so two trains never meet head-on inside single track. Claims persist while the train is on
 * or ahead of them, which gives the first claimant the section. A train following another in
 * the same direction may enter behind it. Trains stop short of the first tile they could not
 * claim ("claim limit"), which the fleet uses to park waiting trains off the holder's path.
 *
 * Priority: a bigger train class goes first (`classRank`). It is served before smaller trains,
 * and it takes over a stretch a smaller train has claimed but not yet reached when that train
 * can still stop short of it (`giveWay`).
 *
 * Statistics: per-train blocked time, yields, stuck episodes, overlaps; an episode log; a
 * report for the debug panel and the console.
 */
export class Traffic {
  /** print every episode to the console */
  verbose = false;
  /** tile key -> train id */
  readonly claims = new ClaimMap();
  readonly recoveries = new RecoveryReservations();
  private sections = new Map<number, number>();
  private sectionTiles = new Map<number, number[]>();
  private trackVersion = -1;
  /** bumped by every `rebuildSections`, so the section ids kept per path go stale with it */
  private sectionsBuilt = 0;
  /** section id (`sectionOf`) of every tile of a path, per path, from `runSections` */
  private pathSections = new WeakMap<PathTiles, { built: number; secs: Int32Array }>();
  /** scratch for `assign`: keys of the stretch it is about to claim */
  private toClaim: number[] = [];
  readonly stats = new Map<number, TrainTraffic>();
  readonly episodes: TrafficEpisode[] = [];
  readonly counters = { stuck: 0, deadlocks: 0, overlaps: 0, yields: 0, headOn: 0, waits: 0 };
  private overlapSeen = new Map<string, number>();
  onEpisode: ((e: TrafficEpisode) => void) | null = null;
  /** set by the fleet: junction statistics for `report()` */
  junctionReport: (() => JunctionStats[]) | null = null;

  constructor(
    private readonly track: TrackGraph,
    private readonly builder: Builder,
  ) {}

  private key(x: number, y: number) {
    return y * this.track.w + x;
  }

  // ------------------------------------------------------------------ sections
  /**
   * Node tiles (switches, crossings, platforms, dead ends) stand alone; plain track chains form
   * sections. A multi-tile curve has one road, so its tiles chain like straights.
   */
  rebuildSections() {
    this.sections.clear();
    this.sectionTiles.clear();
    this.trackVersion = this.track.version;
    this.sectionsBuilt++;
    const platform = new Set<number>();
    for (const s of this.builder.stations)
      for (const g of s.gateTiles())
        if (this.builder.gateTrack(g)) platform.add(this.key(g.x, g.y));
    const isNode = (x: number, y: number) => {
      const p = this.track.get(x, y);
      if (!p) return true;
      if (p.links.length > 1 || isJunctionUnit(p) || platform.has(this.key(x, y))) return true;
      let open = 0;
      for (const d of DIRS) if (this.track.connected(x, y, d)) open++;
      return open < 2;
    };
    let next = 1;
    for (const t of this.track.tiles()) {
      const k = this.key(t.x, t.y);
      if (this.sections.has(k)) continue;
      if (isNode(t.x, t.y)) {
        this.sections.set(k, -(k + 1));
        continue;
      }
      // flood the chain of plain tiles
      const id = next++;
      const list: number[] = [];
      const stack = [k];
      this.sections.set(k, id);
      while (stack.length) {
        const cur = stack.pop()!;
        list.push(cur);
        const cx = cur % this.track.w;
        const cy = Math.floor(cur / this.track.w);
        for (const d of DIRS) {
          if (!this.track.connected(cx, cy, d)) continue;
          const nx = cx + DIR_DX[d];
          const ny = cy + DIR_DY[d];
          const nk = this.key(nx, ny);
          if (this.sections.has(nk) || isNode(nx, ny)) continue;
          this.sections.set(nk, id);
          stack.push(nk);
        }
      }
      this.sectionTiles.set(id, list);
    }
  }
  /** Train holding a tile other than `self`, or null. */
  claimedBy(x: number, y: number, self: number): number | null {
    const recovery = this.recoveries.ownerAt(this.key(x, y), self);
    if (recovery !== null) return recovery;
    const id = this.claims.get(this.key(x, y));
    return id === undefined || id === self ? null : id;
  }
  /** Tile keys and sections of a train's path ahead; a list `Train.pathAhead` built is indexed once per path. */
  private aheadIndex(ahead: readonly { x: number; y: number }[]): AheadIndex {
    const run = aheadRun(ahead as readonly AheadTile[], this.track.w);
    if (run) return { keys: run.keys, secs: this.runSections(run.tiles, run.keys), k0: run.from };
    const keys = ahead.map((p) => this.key(p.x, p.y));
    return { keys, secs: keys.map((k) => this.sections.get(k) ?? -(k + 1)), k0: 0 };
  }
  /** `sectionOf` every tile of a path (`keys`, its tile keys), kept until the sections change. */
  private runSections(tiles: PathTiles, keys: Int32Array): Int32Array {
    const kept = this.pathSections.get(tiles);
    if (kept && kept.built === this.sectionsBuilt && kept.secs.length === keys.length)
      return kept.secs;
    const secs = new Int32Array(keys.length);
    for (let r = 0; r < keys.length; r++) secs[r] = this.sections.get(keys[r]) ?? -(keys[r] + 1);
    this.pathSections.set(tiles, { built: this.sectionsBuilt, secs });
    return secs;
  }
  /** tile keys of a plain section (empty for nodes) */
  tilesOfSection(id: number): number[] {
    return this.sectionTiles.get(id) ?? [];
  }
  sectionOf(x: number, y: number) {
    return this.sections.get(this.key(x, y)) ?? -(this.key(x, y) + 1);
  }
  /** length of the plain section a tile belongs to (1 for node tiles) */
  sectionLength(x: number, y: number) {
    const id = this.sectionOf(x, y);
    return id > 0 ? (this.sectionTiles.get(id)?.length ?? 1) : 1;
  }

  // ------------------------------------------------------------------ claims
  /** Tiles under a train's cars. */
  private carTiles(t: Train): readonly number[] {
    return t.occupancyKeys(this.track.w);
  }
  /**
   * Lease an escape to `t` whole, or nothing: every tile of `path`, which for a shunt holds both
   * legs, the second from where the way turns (`turnIndex`). The second leg is kept whole until
   * the train turns to run it (`maintainRecoveries`).
   */
  reserveRecovery(
    t: Train,
    path: readonly PathSegment[],
    group: number[],
    trains: Train[],
    now: number,
  ) {
    const tiles = new Set(path.map((p) => this.key(p.x, p.y)));
    for (const other of trains)
      if (other.id !== t.id && this.carTiles(other).some((key) => tiles.has(key))) return false;
    for (const key of tiles) {
      const owner = this.claims.get(key);
      if (owner !== undefined && owner !== t.id && !group.includes(owner)) return false;
    }
    const rest = new Set(path.slice(turnIndex(path)).map((p) => this.key(p.x, p.y)));
    if (!this.recoveries.reserve(t.id, group, tiles, now, this.track.version, rest)) return false;
    for (const key of tiles) this.claims.set(key, t.id);
    return true;
  }

  /**
   * Rate-limit failed searches; an active group keeps its plan until it clears or stalls. Each
   * train keeps when it may be searched again (`Train.recoveryRetry`), so a game loaded from a save
   * searches when the saved one would have.
   */
  canRecover(group: Train[], now: number) {
    if (this.recoveries.hasGroup(group.map((t) => t.id))) return false;
    if (group.some((t) => t.recoveryRetry > now)) return false;
    for (const t of group) t.recoveryRetry = now + 4;
    return true;
  }

  private maintainRecoveries(trains: Train[], now: number) {
    const live = new Map(trains.map((t) => [t.id, t]));
    for (const [id, plan] of this.recoveries.active) {
      const t = live.get(id);
      // a holding train's path starts afresh only where a shunt turns: it runs its second leg now,
      // and the turn is progress
      if (t && plan.rest.size && t.pathProgress < plan.progress) {
        plan.rest.clear();
        plan.progress = t.pathProgress;
        plan.progressed = now;
      }
      if (t?.holding && t.state === 'moving') {
        const needed = new Set([
          ...this.carTiles(t),
          ...t.pathAhead().map((p) => this.key(p.x, p.y)),
          ...plan.rest,
        ]);
        for (const key of plan.tiles) if (!needed.has(key)) plan.tiles.delete(key);
      }
      if (t && t.pathProgress > plan.progress + PROGRESS_EPS) {
        plan.progress = t.pathProgress;
        plan.progressed = now;
      }
      const stale = plan.version !== this.track.version || now - plan.progressed > STUCK_AFTER;
      if (!t || !t.holding || t.state !== 'moving' || stale) {
        this.recoveries.active.delete(id);
        // Release future reservations immediately, keeping the train's actual footprint.
        const occupied = new Set(t ? this.carTiles(t) : []);
        for (const key of plan.tiles)
          if (this.claims.get(key) === id && !occupied.has(key)) this.claims.delete(key);
        if (t) {
          if (t.holding) t.cancelRetreat(now);
          const p = t.poses[0] ?? { x: 0, y: 0 };
          this.log({
            t: now,
            kind: 'recovery',
            train: id,
            name: t.name,
            other: null,
            x: p.x,
            y: p.y,
            text: stale ? STR.traffic.stalled(t.name) : STR.traffic.released(t.name),
          });
        }
      }
    }
    // A train backing off with no reservation behind it (its escape was not reserved again after
    // a load) never runs on along a stale escape.
    for (const t of trains)
      if (t.holding && !this.recoveries.active.has(t.id)) t.cancelRetreat(now);
  }
  /** Recompute claims before any train moves; occupied track always wins over future claims. */
  assign(trains: Train[], now: number) {
    // Trains loaded from a save take their platforms, escapes and paths before anything is
    // claimed, every one of them before any train moves.
    for (const t of trains)
      t.resumeAfterLoad(this.builder, now, (path, group) =>
        this.reserveRecovery(t, path, group, trains, now),
      );
    this.maintainRecoveries(trains, now);
    if (this.track.version !== this.trackVersion) {
      this.rebuildSections();
      this.claims.clear();
    }
    const byId = new Map(trains.map((t) => [t.id, t]));
    const occupied = new Map<number, number>();
    const paths = new Map(trains.map((t) => [t.id, t.pathAhead()]));
    // tile keys and sections of every moving train's path ahead
    const index = new Map<number, AheadIndex>();
    for (const t of trains)
      if (t.state === 'moving') index.set(t.id, this.aheadIndex(paths.get(t.id)!));
    // a train keeps the claims under its cars and, moving, those on the path ahead of it
    this.claims.beginKeep();
    for (const t of trains) {
      const cars = this.carTiles(t);
      for (const key of cars) {
        if (this.claims.get(key) === t.id) this.claims.keep(key);
        const owner = occupied.get(key);
        if (owner !== undefined && owner !== t.id) this.overlap(t, byId.get(owner)!, key, now);
        occupied.set(key, t.id);
      }
      const ix = index.get(t.id);
      if (ix)
        for (let r = ix.k0; r < ix.keys.length; r++)
          if (this.claims.get(ix.keys[r]) === t.id) this.claims.keep(ix.keys[r]);
    }
    this.claims.dropUnkept();
    for (const plan of this.recoveries.active.values())
      for (const key of plan.tiles) this.claims.set(key, plan.owner);
    for (const [key, owner] of occupied) this.claims.set(key, owner);
    const order = [...trains].sort(
      (a, b) =>
        Number(this.recoveries.active.has(b.id)) - Number(this.recoveries.active.has(a.id)) ||
        classRank(b.trainClass) - classRank(a.trainClass) ||
        (this.stats.get(a.id)?.lastMoveAt ?? now) - (this.stats.get(b.id)?.lastMoveAt ?? now) ||
        b.yieldCount - a.yieldCount ||
        b.weight - a.weight ||
        a.id - b.id,
    );
    for (const t of order) {
      t.claimLimit = Infinity;
      t.claimBlocker = null;
      if (t.state !== 'moving') continue;
      const ahead = paths.get(t.id)!;
      // ahead[j] stands on keys[k0 + j], in section secs[k0 + j]
      const { keys, secs, k0 } = index.get(t.id)!;
      const pos = t.pathProgress;
      for (let i = 0; i < ahead.length;) {
        const first = ahead[i];
        if (i > 0 && first.arc - pos > HORIZON) break;
        const section = secs[k0 + i];
        const end = this.claimGroupEnd(ahead, i, t.length, secs, k0);
        let conflict = -1;
        let holder: number | null = null;
        // the tiles not yet claimed by this train, to claim when the whole stretch is free
        let unclaimed = 0;
        for (let j = i; j < end; j++) {
          const key = keys[k0 + j];
          holder = this.recoveries.active.size ? this.recoveries.ownerAt(key, t.id) : null;
          if (holder === null) {
            const id = this.claims.get(key);
            if (id === undefined) this.toClaim[unclaimed++] = key;
            else if (id !== t.id) holder = id;
          }
          if (holder !== null) {
            conflict = j;
            break;
          }
        }
        if (
          conflict >= 0 &&
          holder !== null &&
          this.giveWay(t, ahead, i, end, paths, byId, occupied)
        ) {
          conflict = -1;
          holder = null;
          // the scan stopped at the holder: the rest of the stretch is t's to claim as well
          unclaimed = 0;
          for (let j = i; j < end; j++)
            if (this.claims.get(keys[k0 + j]) !== t.id) this.toClaim[unclaimed++] = keys[k0 + j];
        }
        if (conflict >= 0 && holder !== null) {
          const p = ahead[conflict];
          const otherPath = paths.get(holder) ?? [];
          const other = otherPath.find((q) => q.x === p.x && q.y === p.y);
          // Compare direction at the contested tile, not headings on unrelated curves.
          const following =
            section > 0 &&
            byId.get(holder)?.state === 'moving' &&
            other?.in === p.in &&
            other?.out === p.out &&
            this.recoveries.ownerAt(this.key(p.x, p.y), t.id) === null;
          const head = ahead[0];
          const inside = section > 0 && head && this.sectionOf(head.x, head.y) === section;
          const stop = following || inside ? p.arc : first.arc;
          t.claimLimit = Math.max(0, stop - pos);
          t.claimBlocker = holder;
          // No partial section/exit claim may remain after a failed acquisition.
          for (let j = i; j < end; j++) {
            const key = this.key(ahead[j].x, ahead[j].y);
            if (
              this.claims.get(key) === t.id &&
              occupied.get(key) !== t.id &&
              !this.recoveries.active.get(t.id)?.tiles.has(key)
            )
              this.claims.delete(key);
          }
          // Trains already inside a contested section still acquire the free prefix. Without
          // this, both ends can advance into the same unclaimed tile before either occupies it.
          if (inside || following)
            for (let j = i; j < conflict; j++) {
              const p = ahead[j];
              if (this.claimedBy(p.x, p.y, t.id) === null)
                this.claims.set(this.key(p.x, p.y), t.id);
            }
          this.counters.waits++;
          break;
        }
        // tiles this train already holds keep their claim (and their place in `claims`)
        for (let u = 0; u < unclaimed; u++) this.claims.set(this.toClaim[u], t.id);
        i = end;
      }
    }
  }

  /**
   * May `t` take tiles `from`..`to` of its path from the smaller trains that claimed them? Only
   * when every holder is a smaller class on the standard network, has no escape leased, stands
   * neither on that stretch nor anywhere on `t`'s path, and can still stop before the claim group
   * of its own the stretch falls in. On success the holders' claims from that group on are
   * dropped, so they claim again behind `t` (they come later in the order).
   */
  private giveWay(
    t: Train,
    ahead: readonly Ahead[number][],
    from: number,
    to: number,
    paths: Map<number, readonly Ahead[number][]>,
    byId: Map<number, Train>,
    occupied: Map<number, number>,
  ) {
    const rank = classRank(t.trainClass);
    if (rank <= 1 || this.recoveries.active.has(t.id)) return false;
    const contested = new Set<number>();
    const holders = new Set<number>();
    for (let j = from; j < to; j++) {
      const key = this.key(ahead[j].x, ahead[j].y);
      if (this.recoveries.ownerAt(key, t.id) !== null) return false;
      const h = this.claims.get(key);
      if (h === undefined || h === t.id) continue;
      if (occupied.get(key) === h) return false;
      const other = byId.get(h);
      if (!other || this.recoveries.active.has(h) || classRank(other.trainClass) >= rank)
        return false;
      contested.add(key);
      holders.add(h);
    }
    if (!holders.size) return false;
    const onPath = new Set(ahead.map((p) => this.key(p.x, p.y)));
    const release: [number, number][] = [];
    for (const h of holders) {
      const other = byId.get(h)!;
      for (const key of this.carTiles(other)) if (onPath.has(key)) return false;
      const hp = paths.get(h) ?? [];
      const k = hp.findIndex((p) => contested.has(this.key(p.x, p.y)));
      if (k <= 0) return false;
      const g = this.groupStart(hp, k, other.length);
      if (g <= 0 || hp[g].arc - other.pathProgress < other.stopDistance + GIVE_WAY_ROOM)
        return false;
      for (let m = g; m < hp.length; m++) {
        const key = this.key(hp[m].x, hp[m].y);
        if (this.claims.get(key) === h && occupied.get(key) !== h) release.push([key, h]);
      }
    }
    for (const [key] of release) this.claims.delete(key);
    return true;
  }
  /**
   * End (exclusive) of the claim group that starts at `path[i]`: the rest of a plain section, or
   * a junction with its exit long enough for a train of `length` to clear it.
   */
  private claimGroupEnd(
    path: readonly Ahead[number][],
    i: number,
    length: number,
    secs?: ArrayLike<number>,
    k0 = 0,
  ) {
    const first = path[i];
    const sectionAt = (j: number) => (secs ? secs[k0 + j] : this.sectionOf(path[j].x, path[j].y));
    const section = sectionAt(i);
    let end = i + 1;
    if (section > 0) {
      while (end < path.length && sectionAt(end) === section) end++;
      return end;
    }
    // Reserve a junction's exit far enough for the rear to clear it before entering.
    // Adjacent junctions extend the required exit; a queue cannot occupy the crossing.
    const junction = (p: { x: number; y: number }) => {
      const piece = this.track.get(p.x, p.y);
      return !!piece && (piece.links.length > 1 || isJunctionUnit(piece));
    };
    if (junction(first)) {
      let exitArc = first.arc;
      while (end < path.length) {
        const next = path[end++];
        if (junction(next)) exitArc = next.arc;
        else if (next.arc - exitArc >= length + 1) break;
      }
    }
    return end;
  }
  /** Start of the claim group holding `path[k]`, as the train on `path` groups its claims. */
  private groupStart(path: readonly Ahead[number][], k: number, length: number) {
    for (let i = 0; i < path.length;) {
      const end = this.claimGroupEnd(path, i, length);
      if (k < end) return i;
      i = end;
    }
    return -1;
  }

  // ------------------------------------------------------------------ statistics
  private stat(t: Train, now: number): TrainTraffic {
    let s = this.stats.get(t.id);
    if (!s) {
      const p = t.poses[0] ?? { x: 0, y: 0 };
      s = {
        blocked: 0,
        yields: 0,
        stuck: 0,
        overlaps: 0,
        lastMoveAt: now,
        lastX: p.x,
        lastY: p.y,
        stuckSince: null,
        movedSinceStuck: 0,
      };
      this.stats.set(t.id, s);
    }
    return s;
  }
  private log(e: TrafficEpisode) {
    this.episodes.push(e);
    if (this.episodes.length > 400) this.episodes.splice(0, this.episodes.length - 400);
    if (this.verbose) console.log(`[traffic ${e.t.toFixed(0)}s] ${e.kind}: ${e.text}`);
    this.onEpisode?.(e);
  }
  private overlap(a: Train, b: Train, k: number, now: number) {
    const id = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    const last = this.overlapSeen.get(id) ?? -Infinity;
    this.stat(a, now).overlaps++;
    if (now - last < 5) return;
    this.overlapSeen.set(id, now);
    this.counters.overlaps++;
    this.log({
      t: now,
      kind: 'overlap',
      train: a.id,
      name: a.name,
      other: b.id,
      x: k % this.track.w,
      y: Math.floor(k / this.track.w),
      text: `${a.name} and ${b.name} share tile ${k % this.track.w},${Math.floor(k / this.track.w)}`,
    });
  }
  /** Called by the fleet when a train pulled aside for another. */
  yielded(t: Train, other: number | null, now: number) {
    this.stat(t, now).yields++;
    this.counters.yields++;
    const p = t.poses[0] ?? { x: 0, y: 0 };
    this.log({
      t: now,
      kind: 'yield',
      train: t.id,
      name: t.name,
      other,
      x: Math.round(p.x),
      y: Math.round(p.y),
      text: `${t.name} pulls aside${other !== null ? ` for #${other}` : ''}`,
    });
  }
  /** Called by the fleet when a ring of blocked trains found nobody able to make room. */
  private deadlockSeen = new Map<string, number>();
  deadlock(chain: Train[], now: number) {
    const sig = chain
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',');
    const last = this.deadlockSeen.get(sig) ?? -Infinity;
    if (now - last < 60) return;
    this.deadlockSeen.set(sig, now);
    this.counters.deadlocks++;
    const p = chain[0].poses[0] ?? { x: 0, y: 0 };
    this.log({
      t: now,
      kind: 'deadlock',
      train: chain[0].id,
      name: chain[0].name,
      other: chain[1]?.id ?? null,
      x: Math.round(p.x),
      y: Math.round(p.y),
      text: `no room to pass: ${chain.map((c) => c.name).join(' ⇄ ')}`,
    });
  }
  /** Per-tick bookkeeping: blocked time, movement, stuck episodes. */
  observe(trains: Train[], now: number, gdt: number) {
    const live = new Set<number>();
    for (const t of trains) {
      live.add(t.id);
      const s = this.stat(t, now);
      const p = t.poses[0];
      if (!p) continue;
      if (t.blocked) s.blocked += gdt;
      const moved = Math.hypot(p.x - s.lastX, p.y - s.lastY);
      const wants = t.state === 'moving' || t.state === 'yielding' || t.state === 'waiting';
      if (moved > PROGRESS_EPS) {
        s.lastX = p.x;
        s.lastY = p.y;
        s.lastMoveAt = now;
        if (s.stuckSince !== null) s.movedSinceStuck += moved;
        if (s.stuckSince !== null && s.movedSinceStuck > 0.5) {
          this.log({
            t: now,
            kind: 'unstuck',
            train: t.id,
            name: t.name,
            other: null,
            x: Math.round(p.x),
            y: Math.round(p.y),
            text: `${t.name} moves again after ${(now - s.stuckSince).toFixed(0)} s`,
          });
          s.stuckSince = null;
        }
      } else if (!wants) {
        s.lastMoveAt = now;
        s.stuckSince = null;
      } else if (s.stuckSince === null && now - s.lastMoveAt > STUCK_AFTER) {
        s.stuckSince = s.lastMoveAt;
        s.movedSinceStuck = 0;
        s.stuck++;
        this.counters.stuck++;
        const by = t.blockedBy !== null ? trains.find((o) => o.id === t.blockedBy) : undefined;
        this.log({
          t: now,
          kind: 'stuck',
          train: t.id,
          name: t.name,
          other: by?.id ?? null,
          x: Math.round(p.x),
          y: Math.round(p.y),
          text: `${t.name} has not moved for ${STUCK_AFTER} s at ${Math.round(p.x)},${Math.round(p.y)} (${t.state}${by ? `, behind ${by.name}` : ''}${t.lastMessage ? `, ${t.lastMessage}` : ''})`,
        });
      }
    }
    for (const id of [...this.stats.keys()]) if (!live.has(id)) this.stats.delete(id);
  }
  /** Trains currently in a stuck episode with how long. */
  stuckTrains(now: number): { id: number; since: number }[] {
    const out: { id: number; since: number }[] = [];
    for (const [id, s] of this.stats)
      if (s.stuckSince !== null) out.push({ id, since: now - s.stuckSince });
    return out;
  }
  /** Summary for the debug panel and `game.traffic.report()`. */
  recoverySummary(trains: Train[]) {
    return STR.traffic.recoverySummary(
      blockingGroups(trains).length,
      [...this.recoveries.active.keys()]
        .map((id) => trains.find((t) => t.id === id)?.name ?? `#${id}`)
        .join(', '),
    );
  }

  report(trains: Train[]) {
    return {
      counters: { ...this.counters },
      blockingGroups: blockingGroups(trains).map((group) => ({
        trains: group.map((t) => t.id),
        waits: group.map((t) => ({ train: t.id, for: t.blockedBy ?? t.claimBlocker })),
        recovery:
          [...this.recoveries.active.values()].find((p) =>
            p.group.some((id) => group.some((t) => t.id === id)),
          )?.owner ?? null,
      })),
      recoveries: [...this.recoveries.active.values()].map((p) => ({
        owner: p.owner,
        group: p.group,
        started: p.started,
        progressed: p.progressed,
        tiles: [...p.tiles].map((k) => ({ x: k % this.track.w, y: Math.floor(k / this.track.w) })),
      })),
      trains: trains.map((t) => {
        const s = this.stats.get(t.id);
        return {
          id: t.id,
          name: t.name,
          mode: t.mode,
          state: t.state,
          blockedBy: t.blockedBy ?? t.claimBlocker,
          recovering: this.recoveries.active.has(t.id),
          blockedSeconds: Math.round(s?.blocked ?? 0),
          yields: s?.yields ?? 0,
          stuck: s?.stuck ?? 0,
          stuckNow: s?.stuckSince !== null && s?.stuckSince !== undefined,
          overlaps: s?.overlaps ?? 0,
          message: t.lastMessage,
        };
      }),
      episodes: this.episodes.slice(-60),
      junctions: this.junctionReport?.() ?? [],
    };
  }
}
