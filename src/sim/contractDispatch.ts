import type { Contract, ContractBoard, ContractEvent } from './contracts';
import { Fleet } from './fleet';
import type { Train } from './trains';
import type { Station } from './stations';
import type { Builder } from './build';
import type { TrackGraph } from '../world/track';
import { findPath, type PathSegment } from '../world/pathfinding';
import { DIR_DX, DIR_DY, DIRS } from '../engine/iso';
import { cargoDef } from './cargo';
import type { Notices } from './notices';
import { STR } from '../strings';

/** How much a train's versatility counts against it: cost × (options / fewest options) ^ this. */
const VERSATILITY_POWER = 0.5;
/** search budget for one leg */
const PATH_LIMIT = 20000;

interface Candidate {
  train: Train;
  /** estimated completion time in game seconds */
  time: number;
  /** contract pairs the train could serve at all: fewer = more exclusive = preferred */
  options: number;
}

/**
 * Hands accepted contracts to trains. On acceptance the eligible trains are scored and the best
 * one queues the contract as a job; when a contract closes the train drops it and resumes its
 * program. A recalled train's contracts are handed on; unassigned ones are retried when the fleet
 * changes.
 */
export class ContractDispatcher {
  constructor(
    private readonly fleet: Fleet,
    private readonly board: ContractBoard,
    private readonly builder: Builder,
    private readonly track: TrackGraph,
    private readonly notices: Notices,
  ) {
    const prev = fleet.onChanged;
    fleet.onChanged = () => {
      prev?.();
      this.reassignOrphans();
    };
  }

  onEvent(e: ContractEvent) {
    const c = e.contract;
    if (e.kind === 'accepted') this.assign(c);
    else if (e.kind === 'completed' || e.kind === 'failed' || e.kind === 'cancelled')
      this.release(c);
  }

  /** The train working a contract, if it is still in service. */
  trainFor(c: Contract): Train | null {
    return c.trainId === null ? null : (this.fleet.byId(c.trainId) ?? null);
  }
  /** Destination station of the contract a train is on (or has queued next), for the map. */
  jobDest(t: Train): Station | null {
    const j = t.job ?? t.jobs[0];
    return j ? (this.builder.stationById(j.destId) ?? null) : null;
  }

  /** Score every train and queue the contract on the best one. Returns it, or null. */
  assign(c: Contract): Train | null {
    if (c.status !== 'active') return null;
    const origin = this.builder.stationById(c.originId);
    const dest = this.builder.stationById(c.destId);
    if (!origin || !dest) return null;
    const cands: Candidate[] = [];
    for (const t of this.fleet.trains) {
      const cand = this.evaluate(t, c, origin, dest);
      if (cand) cands.push(cand);
    }
    if (!cands.length) {
      c.trainId = null;
      this.notices.push(
        {
          key: `contract:${c.id}:train`,
          kind: 'warn',
          text: STR.notice.contractNoTrain(c.name),
          target: { kind: 'tile', x: dest.x, y: dest.y },
        },
        60,
      );
      return null;
    }
    const fewest = Math.max(1, Math.min(...cands.map((k) => k.options)));
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const k of cands) {
      // a train kept for contracts is chosen ahead of one that would drop its own work
      const score =
        k.time *
        Math.pow(Math.max(1, k.options) / fewest, VERSATILITY_POWER) *
        (k.train.mode === 'contract' ? 0.4 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (!best) return null;
    best.train.addJob({
      contractId: c.id,
      name: c.name,
      originId: c.originId,
      destId: c.destId,
      cargo: c.cargo,
    });
    c.trainId = best.train.id;
    return best.train;
  }

  /** The contract is over: its train drops the job and goes back to its program. */
  release(c: Contract) {
    for (const t of this.fleet.trains) t.dropJob(c.id);
  }

  /** Active contracts whose train is gone (or never existed) get another look. */
  reassignOrphans() {
    for (const c of this.board.active) if (!this.trainFor(c)) this.assign(c);
  }
  /** After a load: jobs without a live contract are dropped, contracts without a train handed out. */
  reconcile() {
    for (const t of this.fleet.trains)
      for (const j of [...(t.job ? [t.job] : []), ...t.jobs])
        if (this.board.byId(j.contractId)?.status !== 'active') t.dropJob(j.contractId);
    this.reassignOrphans();
  }

  // ------------------------------------------------------------ scoring
  /**
   * Eligibility and cost of one train for a contract: a wagon for the cargo with tonnage to spare,
   * origin and destination reachable over the rails from where it stands, both legs within a full
   * tank. Time = distance / top speed, distance being the leg still under way, queued jobs, the
   * run to the origin and as many origin–destination rounds as the wagons need, plus a fuel
   * detour when the tanks do not cover the first leg.
   */
  private evaluate(t: Train, c: Contract, origin: Station, dest: Station): Candidate | null {
    const cap = Fleet.capacityFor(t, c.cargo);
    if (cap <= 0) return null;
    const unitWeight = cargoDef(c.cargo).weight;
    const spare = t.power - t.emptyWeight;
    if (spare < unitWeight) return null;
    const head = t.headSeg;
    if (!head) return null;
    const legA = this.legLength(head, origin);
    if (!legA) return null;
    const legB = this.legLength(legA.end, dest);
    if (!legB) return null;
    const fullRange = t.rangeAt(1);
    if (legA.len * 1.15 + 4 > fullRange || legB.len * 1.15 + 4 > fullRange) return null;
    const haul = Math.max(1, Math.min(cap, spare / unitWeight));
    const trips = Math.max(1, Math.ceil((c.amount - c.delivered) / haul));
    const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    let dist = 0;
    if (t.state === 'moving') dist += Math.max(0, t.pathTotal - t.pathProgress);
    // work already promised: the job under way and every queued one, as crow-flies rounds
    const pending = t.job ? [t.job, ...t.jobs] : t.jobs;
    for (const j of pending) {
      const a = this.builder.stationById(j.originId);
      const b = this.builder.stationById(j.destId);
      if (a && b) dist += manhattan(a, b) * 2 * 1.3;
    }
    dist += legA.len + (2 * trips - 1) * legB.len;
    // tanks short of the first leg: count the way to the nearest fuel point and back
    if (t.rangeTiles < legA.len * 1.15 + 4) {
      let nearest = Infinity;
      for (const s of this.builder.stations)
        if (s.refuelsFuel && s.refuelsWater && this.builder.platformTiles(s).length)
          nearest = Math.min(nearest, manhattan(s, head));
      dist += nearest === Infinity ? legA.len : nearest * 2 * 1.3;
    }
    const time = dist / Math.max(0.05, t.maxSpeed);
    return { train: t, time, options: this.options(t, head) };
  }

  /** Track length from a segment to a station's platform, trying both ways of standing. */
  private legLength(from: PathSegment, st: Station): { len: number; end: PathSegment } | null {
    const plat = this.builder.platformTiles(st);
    if (!plat.length) return null;
    const w = this.track.w;
    const set = new Set(plat.map((p) => p.y * w + p.x));
    const isTarget = (x: number, y: number) => set.has(y * w + x);
    if (isTarget(from.x, from.y)) return { len: 0, end: from };
    const p =
      findPath(this.track, { x: from.x, y: from.y, in: from.in }, isTarget, PATH_LIMIT) ??
      findPath(this.track, { x: from.x, y: from.y, in: from.out }, isTarget, PATH_LIMIT);
    return p ? { len: p.length, end: p[p.length - 1] } : null;
  }

  /**
   * How many (origin, destination, cargo) contract pairs the train could serve at all: cargo
   * kinds its wagons take, both stations on rails it can reach. A train with few options is the
   * one to spend on a contract it can do.
   */
  private options(t: Train, head: PathSegment) {
    const kinds = new Set<string>();
    for (const w of t.wagons) for (const c of w.def.accepts ?? []) kinds.add(c);
    const reach = this.reachFrom(head);
    const w = this.track.w;
    const canReach = (s: Station) =>
      this.builder.platformTiles(s).some((p) => reach.has(p.y * w + p.x));
    let n = 0;
    for (const pr of this.board.pairs())
      if (kinds.has(pr.cargo) && canReach(pr.from) && canReach(pr.to)) n++;
    return n;
  }

  /** Track tiles reachable from a tile over the rails, ignoring direction. */
  private reachFrom(from: { x: number; y: number }): Set<number> {
    const w = this.track.w;
    const out = new Set<number>();
    const stack = [from.y * w + from.x];
    out.add(stack[0]);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = Math.floor(k / w);
      for (const d of DIRS) {
        if (!this.track.connected(x, y, d)) continue;
        const nk = (y + DIR_DY[d]) * w + (x + DIR_DX[d]);
        if (!out.has(nk)) {
          out.add(nk);
          stack.push(nk);
        }
      }
    }
    return out;
  }
}
