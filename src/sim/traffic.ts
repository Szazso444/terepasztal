import type { TrackGraph } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Builder } from './build';
import type { Train } from './trains';
import type { JunctionStats } from './junctions';
import type { PathSegment } from '../world/pathfinding';
import { blockingGroups, RecoveryReservations } from './recovery';
import { STR } from '../strings';

/** How far ahead (tiles) a moving train claims track beyond the section it is entering. */
const HORIZON = 6;
/** No head movement for this long while wanting to move counts as stuck (game seconds). */
const STUCK_AFTER = 30;
/** Minimum head movement (tiles) that counts as progress. */
const PROGRESS_EPS = 0.05;

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
 * Statistics: per-train blocked time, yields, stuck episodes, overlaps; an episode log; a
 * report for the debug panel and the console.
 */
export class Traffic {
  /** print every episode to the console */
  verbose = false;
  /** tile key -> train id */
  readonly claims = new Map<number, number>();
  readonly recoveries = new RecoveryReservations();
  private recoveryRetry = new Map<number, number>();
  private sections = new Map<number, number>();
  private sectionTiles = new Map<number, number[]>();
  private trackVersion = -1;
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
  /** Node tiles (switches, crossings, platforms, dead ends) stand alone; plain track chains form sections. */
  rebuildSections() {
    this.sections.clear();
    this.sectionTiles.clear();
    this.trackVersion = this.track.version;
    const platform = new Set<number>();
    for (const s of this.builder.stations)
      for (const g of s.gateTiles()) if (this.track.has(g.x, g.y)) platform.add(this.key(g.x, g.y));
    const isNode = (x: number, y: number) => {
      const p = this.track.get(x, y);
      if (!p) return true;
      if (p.links.length > 1 || p.unit || platform.has(this.key(x, y))) return true;
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
  private carTiles(t: Train): number[] {
    return t.occupancyKeys(this.track.w);
  }
  reserveRecovery(t: Train, path: PathSegment[], group: number[], trains: Train[], now: number) {
    const tiles = new Set(path.map((p) => this.key(p.x, p.y)));
    for (const other of trains)
      if (other.id !== t.id && this.carTiles(other).some((key) => tiles.has(key))) return false;
    for (const key of tiles) {
      const owner = this.claims.get(key);
      if (owner !== undefined && owner !== t.id && !group.includes(owner)) return false;
    }
    if (!this.recoveries.reserve(t.id, group, tiles, now, this.track.version)) return false;
    for (const key of tiles) this.claims.set(key, t.id);
    return true;
  }

  /** Rate-limit failed searches; an active group keeps its plan until it clears or stalls. */
  canRecover(group: Train[], now: number) {
    const ids = group.map((t) => t.id);
    if (this.recoveries.hasGroup(ids)) return false;
    if (ids.some((id) => (this.recoveryRetry.get(id) ?? 0) > now)) return false;
    for (const id of ids) this.recoveryRetry.set(id, now + 4);
    return true;
  }

  private maintainRecoveries(trains: Train[], now: number) {
    const live = new Map(trains.map((t) => [t.id, t]));
    for (const [id, plan] of this.recoveries.active) {
      const t = live.get(id);
      if (t?.holding && t.state === 'moving') {
        const needed = new Set([
          ...this.carTiles(t),
          ...t.pathAhead().map((p) => this.key(p.x, p.y)),
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
    // A restored save carries physical train state, but never stale reservation ownership.
    for (const t of trains)
      if (t.holding && !this.recoveries.active.has(t.id)) t.cancelRetreat(now);
    for (const id of this.recoveryRetry.keys()) if (!live.has(id)) this.recoveryRetry.delete(id);
  }
  /** Recompute claims before any train moves; occupied track always wins over future claims. */
  assign(trains: Train[], now: number) {
    this.maintainRecoveries(trains, now);
    if (this.track.version !== this.trackVersion) {
      this.rebuildSections();
      this.claims.clear();
    }
    const byId = new Map(trains.map((t) => [t.id, t]));
    const occupied = new Map<number, number>();
    const paths = new Map(trains.map((t) => [t.id, t.pathAhead()]));
    const keep = new Map<number, Set<number>>();
    for (const t of trains) {
      const cars = this.carTiles(t);
      const retained = new Set(cars);
      if (t.state === 'moving') for (const p of paths.get(t.id)!) retained.add(this.key(p.x, p.y));
      keep.set(t.id, retained);
      for (const key of cars) {
        const owner = occupied.get(key);
        if (owner !== undefined && owner !== t.id) this.overlap(t, byId.get(owner)!, key, now);
        occupied.set(key, t.id);
      }
    }
    for (const [key, owner] of this.claims) if (!keep.get(owner)?.has(key)) this.claims.delete(key);
    for (const plan of this.recoveries.active.values())
      for (const key of plan.tiles) this.claims.set(key, plan.owner);
    for (const [key, owner] of occupied) this.claims.set(key, owner);
    const order = [...trains].sort(
      (a, b) =>
        Number(this.recoveries.active.has(b.id)) - Number(this.recoveries.active.has(a.id)) ||
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
      const pos = t.pathProgress;
      for (let i = 0; i < ahead.length;) {
        const first = ahead[i];
        if (i > 0 && first.arc - pos > HORIZON) break;
        const section = this.sectionOf(first.x, first.y);
        let end = i + 1;
        if (section > 0) {
          while (end < ahead.length && this.sectionOf(ahead[end].x, ahead[end].y) === section)
            end++;
        } else {
          // Reserve a junction's exit far enough for the rear to clear it before entering.
          // Adjacent junctions extend the required exit; a queue cannot occupy the crossing.
          const junction = (p: { x: number; y: number }) => {
            const piece = this.track.get(p.x, p.y);
            return !!piece && (piece.links.length > 1 || !!piece.unit);
          };
          if (junction(first)) {
            let exitArc = first.arc;
            while (end < ahead.length) {
              const next = ahead[end++];
              if (junction(next)) exitArc = next.arc;
              else if (next.arc - exitArc >= t.length + 1) break;
            }
          }
        }
        let conflict = -1;
        let holder: number | null = null;
        for (let j = i; j < end; j++) {
          const p = ahead[j];
          holder = this.claimedBy(p.x, p.y, t.id);
          if (holder !== null) {
            conflict = j;
            break;
          }
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
        for (let j = i; j < end; j++) this.claims.set(this.key(ahead[j].x, ahead[j].y), t.id);
        i = end;
      }
    }
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
