import type { TrackGraph } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Builder } from './build';
import type { Train } from './trains';

/** How far ahead (tiles) a moving train claims track beyond the section it is entering. */
const HORIZON = 6;
/** No head movement for this long while wanting to move counts as stuck (game seconds). */
const STUCK_AFTER = 30;
/** Minimum head movement (tiles) that counts as progress. */
const PROGRESS_EPS = 0.05;

export type EpisodeKind = 'stuck' | 'unstuck' | 'deadlock' | 'overlap' | 'yield' | 'headOn';
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
  private sections = new Map<number, number>();
  private sectionTiles = new Map<number, number[]>();
  private trackVersion = -1;
  readonly stats = new Map<number, TrainTraffic>();
  readonly episodes: TrafficEpisode[] = [];
  readonly counters = { stuck: 0, deadlocks: 0, overlaps: 0, yields: 0, headOn: 0, waits: 0 };
  private overlapSeen = new Map<string, number>();
  onEpisode: ((e: TrafficEpisode) => void) | null = null;

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
      if (p.links.length > 1 || platform.has(this.key(x, y))) return true;
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
    const id = this.claims.get(this.key(x, y));
    return id === undefined || id === self ? null : id;
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
    const out: number[] = [];
    for (const p of t.poses) {
      const k = this.key(Math.floor(p.x + 0.5), Math.floor(p.y + 0.5));
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }
  /** Direction of travel of a train through a tile of its path, or of its head when standing. */
  private headingOf(t: Train): { x: number; y: number } {
    const a = t.pathAhead(2);
    if (a.length >= 2) return { x: a[1].x - a[0].x, y: a[1].y - a[0].y };
    const p0 = t.poses[0];
    const p1 = t.poses[1];
    if (p0 && p1) return { x: p0.x - p1.x, y: p0.y - p1.y };
    return { x: 0, y: 0 };
  }

  /**
   * Recompute every train's claims and claim limit for this tick. Trains that already hold
   * tiles keep them; the rest is handed out in order of need (moving trains first, then the
   * ones that yielded least, then the heavier ones).
   */
  assign(trains: Train[], now: number) {
    if (this.track.version !== this.trackVersion) {
      this.rebuildSections();
      this.claims.clear();
    }
    const byId = new Map<number, Train>();
    for (const t of trains) byId.set(t.id, t);
    // release: anything held by a train that is gone, or not under its cars nor on its path ahead
    const keep = new Map<number, Set<number>>();
    for (const t of trains) {
      const set = new Set<number>(this.carTiles(t));
      if (t.state === 'moving') for (const p of t.pathAhead()) set.add(this.key(p.x, p.y));
      keep.set(t.id, set);
    }
    for (const [k, id] of [...this.claims]) {
      const set = keep.get(id);
      if (!set || !set.has(k)) this.claims.delete(k);
    }
    const order = [...trains].sort(
      (a, b) =>
        Number(b.state === 'moving') - Number(a.state === 'moving') ||
        a.yieldCount - b.yieldCount ||
        b.weight - a.weight ||
        a.id - b.id,
    );
    for (const t of order) {
      // the ground under the cars is always ours; sharing it is a collision to record
      for (const k of this.carTiles(t)) {
        const holder = this.claims.get(k);
        if (holder !== undefined && holder !== t.id && byId.has(holder)) {
          const other = byId.get(holder)!;
          if (this.carTiles(other).includes(k)) this.overlap(t, other, k, now);
        }
        this.claims.set(k, t.id);
      }
      t.claimLimit = Infinity;
      t.claimBlocker = null;
      if (t.state !== 'moving' || t.holding) continue;
      const ahead = t.pathAhead();
      const pos = t.pathProgress;
      const added: number[] = [];
      let sectionStart = -1; // index in `added` where the current plain section began
      let curSection = 0;
      const mine = this.headingOf(t);
      for (let i = 0; i < ahead.length; i++) {
        const p = ahead[i];
        const k = this.key(p.x, p.y);
        const sec = this.sectionOf(p.x, p.y);
        if (sec !== curSection) {
          // a new section begins: beyond the horizon only start it if it is a node
          if (p.arc - pos > HORIZON && sectionStart < 0 && i > 0) break;
          curSection = sec;
          sectionStart = sec > 0 ? added.length : -1;
        }
        const holder = this.claims.get(k);
        if (holder !== undefined && holder !== t.id) {
          const other = byId.get(holder);
          let same = false;
          if (other && other.state === 'moving') {
            const h = this.headingOf(other);
            same = h.x * mine.x + h.y * mine.y > 0.1;
          }
          if (same) {
            // following: may enter behind it, spacing is kept by the occupancy rule
            t.claimLimit = Math.max(0, p.arc - pos);
            t.claimBlocker = holder;
            break;
          }
          // an oncoming (or standing) train holds it: never enter a section we cannot own
          const hx = Math.floor(t.poses[0].x + 0.5);
          const hy = Math.floor(t.poses[0].y + 0.5);
          const headIn = sec > 0 && this.sectionOf(hx, hy) === sec;
          if (sec > 0 && sectionStart >= 0 && !headIn) {
            const cars = this.carTiles(t);
            for (let j = sectionStart; j < added.length; j++)
              if (!cars.includes(added[j])) this.claims.delete(added[j]);
            const entryArc = ahead[i - (added.length - sectionStart)]?.arc ?? p.arc;
            added.length = sectionStart;
            t.claimLimit = Math.max(0, entryArc - pos);
          } else t.claimLimit = Math.max(0, p.arc - pos);
          t.claimBlocker = holder;
          this.counters.waits++;
          break;
        }
        this.claims.set(k, t.id);
        added.push(k);
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
        if (s.stuckSince !== null && moved > 0.5) {
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
  report(trains: Train[]) {
    return {
      counters: { ...this.counters },
      trains: trains.map((t) => {
        const s = this.stats.get(t.id);
        return {
          id: t.id,
          name: t.name,
          mode: t.mode,
          state: t.state,
          blockedSeconds: Math.round(s?.blocked ?? 0),
          yields: s?.yields ?? 0,
          stuck: s?.stuck ?? 0,
          stuckNow: s?.stuckSince !== null && s?.stuckSince !== undefined,
          overlaps: s?.overlaps ?? 0,
          message: t.lastMessage,
        };
      }),
      episodes: this.episodes.slice(-60),
    };
  }
}
