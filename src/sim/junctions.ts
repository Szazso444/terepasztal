import type { TrackGraph } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Train } from './trains';
import type { NoticeKind } from './notices';

/**
 * Junction detection thresholds. Live-tunable (`game.fleet.junctions.rules`); seconds are
 * game seconds, distances tiles.
 */
export const JUNCTION_RULES = {
  /** Chebyshev radius of the square each switch or crossing contributes to its junction's area */
  radius: 6,
  /** switches this many track tiles apart (walking the rails) belong to one junction */
  reach: 6,
  /** rolling statistics window */
  window: 60,
  /** a notice at the same level is not repeated within this long */
  cooldown: 60,
  /** a junction that stays quiet this long has its notice withdrawn */
  clearAfter: 30,
  /** speed below this fraction of the free-running target counts as slowed */
  slowFraction: 0.6,
  /** severity evaluation period */
  evalEvery: 1,
  /** info: at least this many trains inside with at least `infoMinWait` seconds lost */
  infoTrains: 3,
  infoMinWait: 1,
  /** minor: total wait above this */
  minorWait: 30,
  /** major: total wait above this, or one train delayed longer than `majorLongest` */
  majorWait: 90,
  majorLongest: 45,
  /** critical: total wait above this, or one train standing still longer than `criticalStopped` */
  criticalWait: 180,
  criticalStopped: 60,
};

export type JunctionLevel = 'none' | 'info' | 'minor' | 'major' | 'critical';
const LEVEL_RANK: Record<JunctionLevel, number> = {
  none: 0,
  info: 1,
  minor: 2,
  major: 3,
  critical: 4,
};
/** Notice colour for a junction severity. */
export function junctionNoticeKind(level: JunctionLevel): NoticeKind {
  return level === 'info' ? 'info' : level === 'minor' ? 'warn' : 'bad';
}

export interface JunctionStats {
  id: number;
  /** centre tile (a member switch or crossing nearest the centroid) */
  x: number;
  y: number;
  members: number;
  /** trains whose head is inside the area right now */
  trainCount: number;
  /** seconds lost by all trains inside the area over the window */
  totalWait: number;
  /** most seconds lost by a single train over the window */
  longestWait: number;
  /** longest current unbroken standstill of a train inside the area */
  longestStop: number;
  level: JunctionLevel;
}
export interface JunctionAlert {
  id: number;
  x: number;
  y: number;
  level: JunctionLevel;
  kind: NoticeKind;
  stats: JunctionStats;
  /** contended switch/crossing tiles plus where delayed trains have been standing */
  tiles: { x: number; y: number }[];
}

/** Rolling per-second buckets of one train's delay inside one junction. */
interface TrainWindow {
  buckets: Float64Array;
  stamps: Int32Array;
  /** unbroken seconds standing still inside the area */
  stoppedFor: number;
  lastSeen: number;
}

interface Junction {
  id: number;
  x: number;
  y: number;
  members: { x: number; y: number }[];
  trains: Map<number, TrainWindow>;
  /** tile key -> game time a delayed train last stood there */
  queue: Map<number, number>;
  present: number;
  level: JunctionLevel;
  /** level of the notice currently standing ('none' when withdrawn) */
  notified: JunctionLevel;
  lastFired: Partial<Record<JunctionLevel, number>>;
  quietSince: number;
  stats: JunctionStats;
}

/**
 * Junction detection and congestion notifications, layered on top of the traffic control:
 * nothing here influences how trains move, it only watches them.
 *
 * Clustering: every switch and crossing tile (2×2 unit members included) is a seed; two seeds
 * join one junction when one can be reached from the other along connected rails within
 * `reach` tiles (union-find over rail-walk adjacency). The rail walk rather than plain
 * Chebyshev distance keeps switches of two unrelated parallel lines apart while still merging
 * crossovers, passing-loop ends and yard throats, whose switches are always linked by short
 * track. The junction's area is the union of the members' Chebyshev-`radius` squares, so a
 * train is "inside" when its head tile lies within `radius` of any member.
 *
 * Statistics per junction over a rolling `window`: trains inside, aggregate seconds lost to
 * standing or crawling behind traffic, the worst single train, and the longest unbroken
 * standstill. Delay per tick is the full tick while the train is blocked, otherwise the
 * fraction of the tick lost when the train runs well below its free-running target because of
 * a hold ahead (occupancy or claim limit). Everything resets when the track changes.
 */
export class Junctions {
  rules = JUNCTION_RULES;
  private trackVersion = -1;
  private junctions: Junction[] = [];
  /** tile key -> ids of the junctions whose area covers it */
  private areaOf = new Map<number, number[]>();
  private nextEval = 0;
  onAlert: ((a: JunctionAlert) => void) | null = null;
  onClear: ((id: number) => void) | null = null;

  constructor(private readonly track: TrackGraph) {}

  private key(x: number, y: number) {
    return y * this.track.w + x;
  }

  // ------------------------------------------------------------------ clustering
  rebuild() {
    for (const j of this.junctions) if (j.notified !== 'none') this.onClear?.(j.id);
    this.trackVersion = this.track.version;
    this.junctions = [];
    this.areaOf.clear();
    this.nextEval = 0;
    const seeds: { x: number; y: number }[] = [];
    const seedIndex = new Map<number, number>();
    const unitOf: (number | null)[] = [];
    for (const t of this.track.tiles())
      if (t.piece.kind === 'switch' || t.piece.kind === 'crossing') {
        seedIndex.set(this.key(t.x, t.y), seeds.length);
        seeds.push({ x: t.x, y: t.y });
        unitOf.push(t.piece.unit ? this.key(t.piece.unit.ax, t.piece.unit.ay) : null);
      }
    const parent = seeds.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    // the tiles of one 2×2 piece are one switch whatever their individual links open onto
    const anchorSeed = new Map<number, number>();
    for (let i = 0; i < seeds.length; i++) {
      const u = unitOf[i];
      if (u === null) continue;
      const first = anchorSeed.get(u);
      if (first === undefined) anchorSeed.set(u, i);
      else union(first, i);
    }
    // rail walk from every seed, `reach` hops deep
    for (let i = 0; i < seeds.length; i++) {
      const start = this.key(seeds[i].x, seeds[i].y);
      const dist = new Map<number, number>([[start, 0]]);
      const queue = [start];
      for (let q = 0; q < queue.length; q++) {
        const cur = queue[q];
        const d = dist.get(cur)!;
        const cx = cur % this.track.w;
        const cy = Math.floor(cur / this.track.w);
        for (const dir of DIRS) {
          if (!this.track.connected(cx, cy, dir)) continue;
          const nk = this.key(cx + DIR_DX[dir], cy + DIR_DY[dir]);
          if (dist.has(nk)) continue;
          dist.set(nk, d + 1);
          const s = seedIndex.get(nk);
          if (s !== undefined) union(i, s);
          if (d + 1 < this.rules.reach) queue.push(nk);
        }
      }
    }
    const groups = new Map<number, { x: number; y: number }[]>();
    for (let i = 0; i < seeds.length; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(seeds[i]);
    }
    const r = this.rules.radius;
    for (const members of groups.values()) {
      const id = this.junctions.length;
      let cx = 0;
      let cy = 0;
      for (const m of members) {
        cx += m.x;
        cy += m.y;
      }
      cx /= members.length;
      cy /= members.length;
      let centre = members[0];
      let best = Infinity;
      for (const m of members) {
        const d = Math.hypot(m.x - cx, m.y - cy);
        if (d < best) {
          best = d;
          centre = m;
        }
      }
      const j: Junction = {
        id,
        x: centre.x,
        y: centre.y,
        members,
        trains: new Map(),
        queue: new Map(),
        present: 0,
        level: 'none',
        notified: 'none',
        lastFired: {},
        quietSince: -Infinity,
        stats: {
          id,
          x: centre.x,
          y: centre.y,
          members: members.length,
          trainCount: 0,
          totalWait: 0,
          longestWait: 0,
          longestStop: 0,
          level: 'none',
        },
      };
      this.junctions.push(j);
      for (const m of members)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const x = m.x + dx;
            const y = m.y + dy;
            if (x < 0 || y < 0 || x >= this.track.w || y >= this.track.h) continue;
            const k = this.key(x, y);
            const ids = this.areaOf.get(k);
            if (!ids) this.areaOf.set(k, [id]);
            else if (!ids.includes(id)) ids.push(id);
          }
    }
  }

  // ------------------------------------------------------------------ observation
  /** Seconds of this tick lost by a train to traffic ahead of it. */
  private delayOf(t: Train, gdt: number) {
    if (t.blocked) return gdt;
    if (t.state !== 'moving' || t.freeSpeed <= 0 || t.holdDist === Infinity) return 0;
    const frac = t.speed / t.freeSpeed;
    return frac < this.rules.slowFraction ? gdt * (1 - frac) : 0;
  }
  private addDelay(w: TrainWindow, now: number, delay: number) {
    const sec = Math.floor(now);
    const i = sec % w.buckets.length;
    if (w.stamps[i] !== sec) {
      w.stamps[i] = sec;
      w.buckets[i] = 0;
    }
    w.buckets[i] += delay;
  }
  private sumWindow(w: TrainWindow, now: number) {
    const sec = Math.floor(now);
    let sum = 0;
    for (let i = 0; i < w.buckets.length; i++)
      if (sec - w.stamps[i] < w.buckets.length) sum += w.buckets[i];
    return sum;
  }

  /** Per-tick bookkeeping; call after the trains have moved and the traffic was observed. */
  tick(trains: Train[], now: number, gdt: number) {
    if (this.track.version !== this.trackVersion) this.rebuild();
    if (!this.junctions.length) return;
    for (const j of this.junctions) j.present = 0;
    const win = Math.max(1, Math.round(this.rules.window));
    for (const t of trains) {
      const head = t.headTile;
      if (!head) continue;
      const ids = this.areaOf.get(this.key(head.x, head.y));
      if (!ids) continue;
      const delay = this.delayOf(t, gdt);
      const cars = delay > 0 ? t.occupancyKeys(this.track.w) : null;
      for (const id of ids) {
        const j = this.junctions[id];
        j.present++;
        let w = j.trains.get(t.id);
        if (!w || w.buckets.length !== win) {
          w = {
            buckets: new Float64Array(win),
            stamps: new Int32Array(win).fill(-1e9),
            stoppedFor: 0,
            lastSeen: now,
          };
          j.trains.set(t.id, w);
        }
        w.lastSeen = now;
        w.stoppedFor = t.blocked ? w.stoppedFor + gdt : 0;
        if (delay > 0) {
          this.addDelay(w, now, delay);
          for (const k of cars!) j.queue.set(k, now);
        }
      }
    }
    if (now < this.nextEval) return;
    this.nextEval = now + this.rules.evalEvery;
    for (const j of this.junctions) this.evaluate(j, now);
  }

  private evaluate(j: Junction, now: number) {
    const R = this.rules;
    let total = 0;
    let longest = 0;
    let longestStop = 0;
    for (const [id, w] of j.trains) {
      if (now - w.lastSeen > R.window) {
        j.trains.delete(id);
        continue;
      }
      const sum = this.sumWindow(w, now);
      total += sum;
      if (sum > longest) longest = sum;
      // a standstill only counts while the train is still here
      if (now - w.lastSeen < R.evalEvery && w.stoppedFor > longestStop) longestStop = w.stoppedFor;
    }
    for (const [k, t] of j.queue) if (now - t > R.window) j.queue.delete(k);
    let level: JunctionLevel = 'none';
    if (total > R.criticalWait || longestStop > R.criticalStopped) level = 'critical';
    else if (total > R.majorWait || longest > R.majorLongest) level = 'major';
    else if (total > R.minorWait) level = 'minor';
    else if (j.present >= R.infoTrains && total >= R.infoMinWait) level = 'info';
    j.level = level;
    j.stats = {
      id: j.id,
      x: j.x,
      y: j.y,
      members: j.members.length,
      trainCount: j.present,
      totalWait: total,
      longestWait: longest,
      longestStop,
      level,
    };
    if (level === 'none') {
      if (j.quietSince === -Infinity) j.quietSince = now;
      if (j.notified !== 'none' && now - j.quietSince >= R.clearAfter) {
        j.notified = 'none';
        this.onClear?.(j.id);
      }
      return;
    }
    j.quietSince = -Infinity;
    // escalation above the standing notice always goes out; the same level, or a step down,
    // repeats only after the cooldown for that level
    const since = now - (j.lastFired[level] ?? -Infinity);
    if (LEVEL_RANK[level] <= LEVEL_RANK[j.notified] && since < R.cooldown) return;
    j.lastFired[level] = now;
    j.notified = level;
    this.onAlert?.({
      id: j.id,
      x: j.x,
      y: j.y,
      level,
      kind: junctionNoticeKind(level),
      stats: { ...j.stats },
      tiles: this.contributingTiles(j.id) ?? [],
    });
  }

  // ------------------------------------------------------------------ queries
  /** Member switch/crossing tiles plus the tiles delayed trains stood on within the window. */
  contributingTiles(id: number): { x: number; y: number }[] | null {
    const j = this.junctions[id];
    if (!j) return null;
    const keys = new Set<number>();
    for (const m of j.members) keys.add(this.key(m.x, m.y));
    for (const k of j.queue.keys()) keys.add(k);
    return [...keys].map((k) => ({ x: k % this.track.w, y: Math.floor(k / this.track.w) }));
  }
  /** Current statistics of every junction. */
  report(): JunctionStats[] {
    return this.junctions.map((j) => ({ ...j.stats }));
  }
  /** The junction in the worst state, or null when all is quiet. */
  worst(): JunctionStats | null {
    let best: JunctionStats | null = null;
    for (const j of this.junctions) {
      const s = j.stats;
      if (
        !best ||
        LEVEL_RANK[s.level] > LEVEL_RANK[best.level] ||
        (LEVEL_RANK[s.level] === LEVEL_RANK[best.level] && s.totalWait > best.totalWait)
      )
        best = s;
    }
    return best;
  }
  get count() {
    return this.junctions.length;
  }
}
